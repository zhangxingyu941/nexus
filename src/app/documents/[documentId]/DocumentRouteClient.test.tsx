import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/features/editor/persistence/apiClient";
import { createDefaultWorkspace } from "@/features/editor/model/workspaceOperations";
import { DocumentRouteClient } from "./DocumentRouteClient";

const documentRepositoryMock = vi.hoisted(() => ({
  createDocumentRepository: vi.fn(),
}));

vi.mock("@/features/editor/persistence/documentRepository", () => documentRepositoryMock);
vi.mock("@/features/editor/components/DocumentEditor", () => ({
  DocumentEditor: ({ document, isReadOnly }: { document: { title: string }; isReadOnly: boolean }) => (
    <main aria-label="文档编辑器">
      <h1>{document.title}</h1>
      <span>{isReadOnly ? "只读" : "可编辑"}</span>
    </main>
  ),
}));
vi.mock("../../AuthScreen", () => ({
  AuthScreen: () => <main aria-label="登录">登录</main>,
}));

const document = { ...createDefaultWorkspace(1000).documents[0], title: "预算草案" };
const snapshot = {
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

    render(<DocumentRouteClient publicId="public-document-1" />);

    expect(await screen.findByRole("heading", { name: "预算草案" })).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(repository.load).toHaveBeenCalledWith("public-document-1");
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

function createRepository() {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    loadPolicy: vi.fn(),
    save: vi.fn().mockResolvedValue(snapshot),
    updatePolicy: vi.fn(),
  };
}
