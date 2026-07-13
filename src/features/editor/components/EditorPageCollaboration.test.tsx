import { act, render, screen, waitFor } from "@testing-library/react";
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
      roomName: "document:document-1000",
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

vi.mock("../persistence/workspaceSyncRepository", async () => {
  const { createDefaultWorkspace } = await import("../model/workspaceOperations");

  return {
    loadSyncedWorkspace: vi.fn(async () => ({
      source: "local",
      workspace: createDefaultWorkspace(1000),
    })),
    saveSyncedWorkspace: vi.fn(async () => "local"),
  };
});

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
    render(<EditorPage />);

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

  it("passes the active Yjs document into rich text block editors", async () => {
    render(<EditorPage />);

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
    render(<EditorPage />);

    await waitFor(() => expect(screen.getByText(/2 在线/)).toBeInTheDocument());
  });

  it("lists live collaboration presence in the members panel", async () => {
    const user = userEvent.setup();

    render(<EditorPage />);

    await user.click(await screen.findByRole("button", { name: /成员/ }));

    expect(screen.getByRole("region", { name: "实时在线成员" })).toHaveTextContent("Remote teammate");
  });
});
