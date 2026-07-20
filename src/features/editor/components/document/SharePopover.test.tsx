import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SharePopover } from "./SharePopover";
import type { DocumentPolicySnapshot } from "../../persistence/documentRepository";

const documentRepositoryMock = vi.hoisted(() => ({
  createDocumentRepository: vi.fn(),
}));

vi.mock("../../persistence/documentRepository", () => documentRepositoryMock);

const ownerAccess = {
  accessMode: "private" as const,
  canManage: true,
  canRead: true,
  canWrite: true,
  documentId: "document-1",
  publicId: "public-document-1",
  role: "owner" as const,
  source: "workspace-owner" as const,
  workspaceId: "workspace-1",
};

describe("SharePopover", () => {
  it("loads the server policy and persists a team visibility change", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      access: ownerAccess,
      policy: { accessMode: "private" as const, permissions: [] },
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);

    render(
      <SharePopover
        documentPublicId="public-document-1"
        onClose={vi.fn()}
        workspaceMembers={[]}
      />,
    );

    expect(await screen.findByText("仅自己与获授权成员可查看")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "团队可查看" }));

    await waitFor(() => expect(repository.updatePolicy).toHaveBeenCalledWith(
      "public-document-1",
      { accessMode: "workspace", permissions: [] },
    ));
  });

  it("does not show policy controls to a user without manage permission", async () => {
    const repository = createRepository({
      access: { ...ownerAccess, canManage: false, role: "editor" as const, source: "explicit" as const },
      policy: { accessMode: "private" as const, permissions: [] },
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);

    render(
      <SharePopover
        documentPublicId="public-document-1"
        onClose={vi.fn()}
        workspaceMembers={[]}
      />,
    );

    expect(await screen.findByText("仅工作区所有者可以管理访问权限")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

function createRepository(snapshot: DocumentPolicySnapshot) {
  return {
    load: vi.fn(),
    loadPolicy: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn(),
    updatePolicy: vi.fn().mockResolvedValue(snapshot),
  };
}
