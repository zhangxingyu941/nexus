import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharePopover } from "./SharePopover";
import type { DocumentPolicySnapshot } from "../../persistence/documentRepository";

const documentRepositoryMock = vi.hoisted(() => ({
  createDocumentRepository: vi.fn(),
}));
const documentShareRepositoryMock = vi.hoisted(() => ({
  createDocumentShareRepository: vi.fn(),
}));

vi.mock("../../persistence/documentRepository", () => documentRepositoryMock);
vi.mock("../../persistence/documentShareRepository", () => documentShareRepositoryMock);

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
  beforeEach(() => {
    documentRepositoryMock.createDocumentRepository.mockReset();
    documentShareRepositoryMock.createDocumentShareRepository.mockReset();
    documentShareRepositoryMock.createDocumentShareRepository.mockReturnValue(
      createShareRepository(),
    );
  });

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

  it("creates a link with the default 24 hour expiration", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      access: ownerAccess,
      policy: { accessMode: "private" as const, permissions: [] },
    });
    const shareRepository = createShareRepository();
    shareRepository.create.mockResolvedValue({
      expiresAt: Date.now() + 24 * 60 * 60_000,
      id: "share-1",
      status: "active",
      url: "http://localhost/share/raw-token",
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);
    documentShareRepositoryMock.createDocumentShareRepository.mockReturnValue(shareRepository);

    render(
      <SharePopover
        documentPublicId="public-document-1"
        onClose={vi.fn()}
        workspaceMembers={[]}
      />,
    );

    await user.click(await screen.findByRole("radio", { name: "拥有链接的人可查看" }));
    expect(screen.getByRole("combobox", { name: "链接有效期" })).toHaveValue("86400000");
    const beforeCreate = Date.now();
    await user.click(screen.getByRole("button", { name: "创建分享链接" }));

    await waitFor(() => expect(shareRepository.create).toHaveBeenCalled());
    const expiresAt = shareRepository.create.mock.calls[0][1] as number;
    expect(expiresAt).toBeGreaterThanOrEqual(beforeCreate + 24 * 60 * 60_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000);
    expect(await screen.findByRole("textbox", { name: "分享链接" }))
      .toHaveValue("http://localhost/share/raw-token");
    expect(screen.getByRole("button", { name: "复制分享链接" })).toBeEnabled();
  });

  it("does not disclose a loaded URL and supports regeneration and revocation", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      access: { ...ownerAccess, accessMode: "link" as const },
      policy: { accessMode: "link" as const, permissions: [] },
    });
    const shareRepository = createShareRepository({
      expiresAt: Date.now() + 60 * 60_000,
      id: "share-1",
      status: "active",
    });
    shareRepository.create.mockResolvedValue({
      expiresAt: Date.now() + 24 * 60 * 60_000,
      id: "share-2",
      status: "active",
      url: "http://localhost/share/new-token",
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);
    documentShareRepositoryMock.createDocumentShareRepository.mockReturnValue(shareRepository);

    render(
      <SharePopover
        documentPublicId="public-document-1"
        onClose={vi.fn()}
        workspaceMembers={[]}
      />,
    );

    expect(await screen.findByText("链接有效")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "分享链接" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制分享链接" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "重新生成分享链接" }));
    expect(await screen.findByRole("textbox", { name: "分享链接" }))
      .toHaveValue("http://localhost/share/new-token");

    await user.click(screen.getByRole("button", { name: "关闭分享链接" }));
    await waitFor(() => expect(shareRepository.revoke)
      .toHaveBeenCalledWith("public-document-1"));
    expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument();
  });

  it("creates a link with a valid custom expiration", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      access: { ...ownerAccess, accessMode: "link" as const },
      policy: { accessMode: "link" as const, permissions: [] },
    });
    const shareRepository = createShareRepository();
    shareRepository.create.mockResolvedValue({
      expiresAt: Date.now() + 2 * 60 * 60_000,
      id: "share-1",
      status: "active",
      url: "http://localhost/share/custom-token",
    });
    documentRepositoryMock.createDocumentRepository.mockReturnValue(repository);
    documentShareRepositoryMock.createDocumentShareRepository.mockReturnValue(shareRepository);

    render(
      <SharePopover
        documentPublicId="public-document-1"
        onClose={vi.fn()}
        workspaceMembers={[]}
      />,
    );

    await screen.findByRole("combobox", { name: "链接有效期" });
    await user.selectOptions(screen.getByRole("combobox", { name: "链接有效期" }), "custom");
    const customExpiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    const localValue = toDateTimeLocalValue(customExpiresAt);
    await user.type(screen.getByLabelText("自定义过期时间"), localValue);
    await user.click(screen.getByRole("button", { name: "创建分享链接" }));

    await waitFor(() => expect(shareRepository.create).toHaveBeenCalledWith(
      "public-document-1",
      new Date(localValue).getTime(),
    ));
  });
});

function createRepository(snapshot: DocumentPolicySnapshot) {
  return {
    load: vi.fn(),
    loadPolicy: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn(),
    updatePolicy: vi.fn().mockImplementation(
      async (_publicId: string, policy: DocumentPolicySnapshot["policy"]) => ({
        ...snapshot,
        access: { ...snapshot.access, accessMode: policy.accessMode },
        policy,
      }),
    ),
  };
}

function createShareRepository(shareLink: {
  expiresAt: number;
  id: string;
  status: "active" | "expired";
} | null = null) {
  return {
    create: vi.fn(),
    load: vi.fn().mockResolvedValue(shareLink),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
}

function toDateTimeLocalValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
