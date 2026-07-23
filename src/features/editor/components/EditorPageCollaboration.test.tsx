import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertBlockAfter, updateDocumentTitle } from "../model/documentOperations";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { EditorPage } from "./EditorPage";

type TiptapExtensionConfig = {
  name?: string;
  options: {
    document?: unknown;
    field?: string;
  };
};

type TiptapEditorOptions = {
  extensions: TiptapExtensionConfig[];
};

const collaborationMock = vi.hoisted(() => {
  type CollaborationOptions = {
    onRemoteDocumentStructurePatch?: (patch: unknown) => void;
  };
  let latestOptions: CollaborationOptions | null = null;
  const ydoc = {
    getXmlFragment: vi.fn(() => ({ length: 1 })),
  };

  return {
    getLatestOptions: () => latestOptions,
    resetLatestOptions: () => {
      latestOptions = null;
    },
    useDocumentCollaboration: vi.fn((options: CollaborationOptions) => {
      latestOptions = options;

      return {
      connectionState: "connected",
      presence: [
        {
          clientId: 1,
          color: "amber",
          documentId: "document-1000",
          documentTitle: "未命名文档",
          isLocal: true,
          name: "Me",
        },
        {
          clientId: 2,
          color: "blue",
          documentId: "document-1000",
          documentTitle: "未命名文档",
          isLocal: false,
          name: "Remote teammate",
        },
      ],
      roomName: "workspace:workspace-test:document:document-1000",
      ydoc,
      };
    }),
    ydoc,
  };
});
const tiptapMock = vi.hoisted(() => ({
  useEditor: vi.fn((_: TiptapEditorOptions, _deps?: unknown[]) => ({
    commands: {
      focus: vi.fn(),
      setContent: vi.fn(),
    },
    getText: vi.fn(() => ""),
  })),
}));

vi.mock("../collaboration/useDocumentCollaboration", () => ({
  useDocumentCollaboration: collaborationMock.useDocumentCollaboration,
}));

vi.mock("@tiptap/react", async () => {
  const React = await import("react");

  return {
    EditorContent: () => React.createElement("div", { "data-testid": "mock-editor-content" }),
    useEditor: tiptapMock.useEditor,
  };
});

describe("EditorPage collaboration wiring", () => {
  beforeEach(() => {
    collaborationMock.resetLatestOptions();
    collaborationMock.useDocumentCollaboration.mockClear();
    collaborationMock.ydoc.getXmlFragment.mockClear();
    tiptapMock.useEditor.mockClear();
  });

  it("applies remote document structure patches to the editor workspace", async () => {
    renderControlledEditor();

    await waitFor(() => expect(collaborationMock.getLatestOptions()).not.toBeNull());

    const document = createDefaultWorkspace(1000).documents[0];
    const renamedDocument = updateDocumentTitle(document, "Remote title", 3000);
    const remoteDocument = insertBlockAfter(renamedDocument, document.blocks[0].id, 4000, "block-remote");

    act(() => {
      collaborationMock.getLatestOptions()?.onRemoteDocumentStructurePatch?.({
        blocks: remoteDocument.blocks,
        documentId: remoteDocument.id,
        title: remoteDocument.title,
        updatedAt: remoteDocument.updatedAt,
      });
    });

    await waitFor(() => expect(screen.getByDisplayValue("Remote title")).toBeInTheDocument());
    expect(screen.getByTestId("block-row-block-remote")).toBeInTheDocument();
  });

  it("prunes remotely deleted blocks from the current selection", async () => {
    const user = userEvent.setup();
    const initialWorkspace = createDefaultWorkspace(1000);
    const documentWithSecondBlock = insertBlockAfter(
      initialWorkspace.documents[0],
      initialWorkspace.documents[0].blocks[0].id,
      2000,
      "block-b",
    );
    const workspace = { ...initialWorkspace, documents: [documentWithSecondBlock], updatedAt: 2000 };
    renderControlledEditor(workspace);

    const [firstRow, secondRow] = await screen.findAllByTestId(/^block-row-/);
    await user.click(within(firstRow).getByRole("button", { name: /选择块/ }));
    await user.keyboard("{Control>}");
    await user.click(within(secondRow).getByRole("button", { name: /选择块/ }));
    await user.keyboard("{/Control}");

    act(() => {
      collaborationMock.getLatestOptions()?.onRemoteDocumentStructurePatch?.({
        blocks: [documentWithSecondBlock.blocks[1]],
        documentId: documentWithSecondBlock.id,
        title: documentWithSecondBlock.title,
        updatedAt: 3000,
      });
    });

    await waitFor(() => expect(screen.queryByTestId(`block-row-${documentWithSecondBlock.blocks[0].id}`)).not.toBeInTheDocument());
    expect(screen.getByTestId(`block-row-${documentWithSecondBlock.blocks[1].id}`)).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("toolbar", { name: "批量块操作" })).getByRole("status")).toHaveTextContent("已选择 1 个块");
  });

  it("passes the active Yjs document into rich text block editors", async () => {
    renderControlledEditor();

    await waitFor(() => expect(tiptapMock.useEditor).toHaveBeenCalled());

    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];
    const collaborationExtension = editorOptions.extensions.find(
      (extension: { name?: string }) => extension.name === "collaboration",
    );

    if (!collaborationExtension) {
      throw new Error("Expected collaboration extension to be configured.");
    }

    expect(collaborationExtension.options.document).toBe(collaborationMock.ydoc);
    expect(collaborationExtension.options.field).toBe("block-content:block-1000");
  });

  it("surfaces live collaboration presence in the editor chrome", async () => {
    renderControlledEditor();

    await waitFor(() => expect(screen.getByText(/2 在线/)).toBeInTheDocument());
  });

  it("lists live collaboration presence in the members panel", async () => {
    const user = userEvent.setup();

    renderControlledEditor();

    await user.click(await screen.findByRole("button", { name: /成员/ }));

    expect(screen.getByRole("region", { name: "实时在线成员" })).toHaveTextContent("Remote teammate");
  });
});

function renderControlledEditor(initialWorkspace = createDefaultWorkspace(1000)) {
  function ControlledEditor() {
    const [workspace, setWorkspace] = useState(initialWorkspace);
    return (
      <EditorPage
        membersEnabled={false}
        onManageWorkspaces={vi.fn()}
        onWorkspaceChange={(updater) => setWorkspace(updater)}
        saveStatus="local"
        workspace={workspace}
        workspaceId="workspace-test"
        workspaceSummary={{ createdAt: 1000, id: "workspace-test", name: "Nexus 工作区", role: "owner", updatedAt: workspace.updatedAt }}
      />
    );
  }
  return render(<ControlledEditor />);
}
