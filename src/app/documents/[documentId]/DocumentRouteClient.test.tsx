import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/features/editor/persistence/apiClient";
import type { DocumentSnapshot } from "@/features/editor/persistence/documentRepository";
import { createDefaultWorkspace } from "@/features/editor/model/workspaceOperations";
import type { RichTextUpdate } from "@/shared/richText";
import { DocumentRouteClient } from "./DocumentRouteClient";

const documentRepositoryMock = vi.hoisted(() => ({
  createDocumentRepository: vi.fn(),
}));
const workspaceMemberRepositoryMock = vi.hoisted(() => ({
  loadWorkspaceMembers: vi.fn(),
}));

vi.mock("@/features/editor/persistence/documentRepository", () => documentRepositoryMock);
vi.mock("@/features/editor/persistence/workspaceMemberRepository", () => workspaceMemberRepositoryMock);
vi.mock("@/features/editor/components/DocumentEditor", () => ({
  DocumentEditor: ({
    document,
    isReadOnly,
    onChangeRichText,
    workspaceMembers,
  }: {
    document: { blocks: Array<{ id: string }>; title: string };
    isReadOnly: boolean;
    onChangeRichText: (blockId: string, update: RichTextUpdate) => void;
    workspaceMembers: unknown[];
  }) => (
    <main aria-label="文档编辑器">
      <h1>{document.title}</h1>
      <button
        onClick={() => onChangeRichText(document.blocks[0].id, {
          content: "Persistent format",
          richText: {
            content: [{
              content: [{ marks: [{ type: "bold" }], text: "Persistent format", type: "text" }],
              type: "paragraph",
            }],
            type: "doc",
          },
        })}
        type="button"
      >
        Apply structured format
      </button>
      <span>{isReadOnly ? "只读" : "可编辑"}</span>
      <span>{workspaceMembers.length} 位成员</span>
    </main>
  ),
}));
vi.mock("../../AuthScreen", () => ({
  AuthScreen: () => <main aria-label="登录">登录</main>,
}));

const document = { ...createDefaultWorkspace(1000).documents[0], title: "预算草案" };
const snapshot: DocumentSnapshot = {
  access: {
    accessMode: "private" as const,
    canManage: false,
    canRead: true,
    canWrite: false,
    documentId: document.id,
    publicId: "public-document-1",
    role: "viewer" as const,
    source: "explicit" as const,
    workspaceId: "workspace-1",
  },
  document,
};

describe("DocumentRouteClient", () => {
  it("loads the direct document and renders it as readonly for a viewer", async () => {
    const repository = createRepository();
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);
    workspaceMemberRepositoryMock.loadWorkspaceMembers.mockResolvedValueOnce([
      { displayName: "Owner", email: "owner@example.com", id: "owner-1", role: "owner" },
    ]);

    render(<DocumentRouteClient publicId="public-document-1" />);

    expect(await screen.findByRole("heading", { name: "预算草案" })).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(await screen.findByText("1 位成员")).toBeInTheDocument();
    expect(repository.load).toHaveBeenCalledWith("public-document-1");
    expect(workspaceMemberRepositoryMock.loadWorkspaceMembers).toHaveBeenCalledWith("workspace-1");
  });

  it("saves structured text changes from the document editor", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      ...snapshot,
      access: { ...snapshot.access, canWrite: true, role: "editor" as const },
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);
    workspaceMemberRepositoryMock.loadWorkspaceMembers.mockResolvedValueOnce([]);

    render(<DocumentRouteClient publicId="public-document-1" />);
    await user.click(await screen.findByRole("button", { name: "Apply structured format" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledWith(
      "public-document-1",
      expect.objectContaining({
        blocks: [expect.objectContaining({
          content: "Persistent format",
          richText: expect.objectContaining({ type: "doc" }),
        })],
      }),
    ));
  });

  it("shows the existing authentication flow when the document API returns 401", async () => {
    const repository = createRepository();
    vi.mocked(repository.load).mockRejectedValueOnce(
      new ApiRequestError("请先登录", "unauthorized", undefined, 401),
    );
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);

    render(<DocumentRouteClient publicId="public-document-1" />);

    expect(await screen.findByRole("main", { name: "登录" })).toBeInTheDocument();
  });

  it("does not reveal an unavailable document", async () => {
    const repository = createRepository();
    vi.mocked(repository.load).mockRejectedValueOnce(
      new ApiRequestError("文档不存在或无权访问", "not_found", undefined, 404),
    );
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);

    render(<DocumentRouteClient publicId="private-document" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("文档不可用"));
    expect(screen.queryByText("预算草案")).not.toBeInTheDocument();
  });
});

function createRepository(loadedSnapshot = snapshot) {
  return {
    load: vi.fn().mockResolvedValue(loadedSnapshot),
    loadPolicy: vi.fn(),
    save: vi.fn().mockResolvedValue(snapshot),
    updatePolicy: vi.fn(),
  };
}
