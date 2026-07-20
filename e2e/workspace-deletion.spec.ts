import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import WebSocket from "ws";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  queryScalar,
  registerAndVerify,
  requestEncryptedAuthApi,
  setUploadsDirectoryMode,
  setWorkspacePurgeAfter,
  waitForCapturedInvite,
  waitForWorkspaceCatalog,
} from "./support";

type WorkspaceCatalogResponse = {
  currentWorkspaceId: string;
  workspaces: Array<{ id: string; name: string }>;
};

type WorkspaceSnapshotResponse = {
  content: {
    activeDocumentId: string;
    documents: Array<{
      blocks: Array<Record<string, unknown>>;
      id: string;
    }>;
  };
  summary: { id: string; name: string };
};

test.describe("workspace deletion and recovery", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("requires the exact name, invalidates access, then restores preserved content and files", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("deletion-owner");
    const member = createAcceptanceIdentity("deletion-member");
    const pendingRecipient = createAcceptanceIdentity("deletion-pending");
    const workspaceName = "删除恢复验收工作区";
    const memberContext = await browser.newContext();

    try {
      await registerAndVerify(page.context().request, owner);
      await registerAndVerify(memberContext.request, member);
      const workspaceId = await createWorkspace(page, workspaceName);
      const acceptedInvite = await createInvite(page.context().request, workspaceId, member.email);
      const pendingInvite = await createInvite(
        page.context().request,
        workspaceId,
        pendingRecipient.email,
      );
      const pendingInviteUrl = await waitForCapturedInvite(pendingRecipient.email);

      const memberLogin = await requestEncryptedAuthApi(memberContext.request, {
        email: member.email,
        purpose: "login",
        secrets: { password: member.password },
      });
      expect(memberLogin.ok()).toBe(true);
      const memberAcceptance = await memberContext.request.post(
        `/api/workspace-invites/${acceptedInvite.id}/accept`,
      );
      expect(memberAcceptance.ok()).toBe(true);

      const attachment = await uploadTextFile(page, workspaceId, "restore-proof.txt", "restore-proof");
      await saveWorkspaceWithAttachment(page, workspaceId, attachment);
      const initialWorkspace = await loadWorkspace(page.context().request, workspaceId);
      const socket = await openWorkspaceSocket(
        memberContext,
        workspaceId,
        initialWorkspace.content.activeDocumentId,
      );

      await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
      await deleteWorkspaceFromManager(page, workspaceId, workspaceName);
      await expect(socket.closed).resolves.toBe(4403);

      const ownerCatalog = await getWorkspaceCatalog(page.context().request);
      const memberCatalog = await getWorkspaceCatalog(memberContext.request);
      for (const catalog of [ownerCatalog, memberCatalog]) {
        expect(catalog.currentWorkspaceId).not.toBe(workspaceId);
        expect(catalog.workspaces.map((workspace) => workspace.id))
          .toContain(catalog.currentWorkspaceId);
        expect(catalog.workspaces.map((workspace) => workspace.id)).not.toContain(workspaceId);
      }

      const deniedWorkspace = await memberContext.request.get(`/api/workspaces/${workspaceId}`);
      expect(deniedWorkspace.ok()).toBe(false);
      const deniedFile = await memberContext.request.get(String(attachment.url));
      expect(deniedFile.status()).toBe(403);

      const revokedInvite = await page.context().request.post("/api/workspace-invites/resolve", {
        data: { token: inviteToken(pendingInviteUrl) },
      });
      expect(revokedInvite.status()).toBe(410);
      await expect(revokedInvite.json()).resolves.toMatchObject({ code: "invite_revoked" });
      expect(pendingInvite.id).toBeTruthy();

      await page.reload();
      await openWorkspaceTrash(page);
      const trashedWorkspace = page.getByTestId(`trashed-workspace-${workspaceId}`);
      await expect(trashedWorkspace).toContainText(workspaceName);
      const restoreResponse = page.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/workspaces/${workspaceId}/restore`
      ));
      await trashedWorkspace.getByRole("button", { name: "恢复并进入" }).click();
      expect((await restoreResponse).ok()).toBe(true);
      await page.keyboard.press("Escape");
      await expect(currentWorkspaceButton(page, workspaceName)).toBeVisible();
      await expect(page.getByLabel("块内容")).toContainText("恢复后仍需存在的内容");

      const restoredFile = await page.context().request.get(String(attachment.url));
      expect(restoredFile.ok()).toBe(true);
      expect((await restoredFile.body()).toString()).toBe("restore-proof");

      const stillRevoked = await page.context().request.post("/api/workspace-invites/resolve", {
        data: { token: inviteToken(pendingInviteUrl) },
      });
      expect(stillRevoked.status()).toBe(410);
      await expect(stillRevoked.json()).resolves.toMatchObject({ code: "invite_revoked" });
    } finally {
      await memberContext.close();
    }
  });

  test("retains an expired tombstone when object deletion fails and retries after storage is writable", async ({ page }) => {
    const owner = createAcceptanceIdentity("deletion-purge");
    await registerAndVerify(page.context().request, owner);
    const workspaceId = await createWorkspace(page, "清理重试工作区");
    const attachment = await uploadTextFile(page, workspaceId, "purge-proof.txt", "purge-proof");
    await saveWorkspaceWithAttachment(page, workspaceId, attachment);

    const deletion = await page.context().request.delete(`/api/workspaces/${workspaceId}`, {
      data: { confirmationName: "清理重试工作区" },
    });
    expect(deletion.ok()).toBe(true);
    setWorkspacePurgeAfter(workspaceId);

    try {
      setUploadsDirectoryMode("read-only");
      const expiredRestore = await page.context().request.post(`/api/workspaces/${workspaceId}/restore`);
      expect(expiredRestore.status()).toBe(410);
      await expect(expiredRestore.json()).resolves.toMatchObject({ code: "workspace_purge_expired" });

      await triggerWorkspacePurge(page);
      await page.waitForTimeout(750);
      expect(workspaceRowCount(workspaceId)).toBe("1");
    } finally {
      setUploadsDirectoryMode("writable");
    }

    await triggerWorkspacePurge(page);
    await expect.poll(() => workspaceRowCount(workspaceId)).toBe("0");
    expect(auditEventCount(workspaceId)).not.toBe("0");
  });
});

async function createWorkspace(page: Page, name: string) {
  const response = await page.context().request.post("/api/workspaces", { data: { name } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as WorkspaceSnapshotResponse;
  return workspace.summary.id;
}

async function createInvite(request: APIRequestContext, workspaceId: string, email: string) {
  const response = await request.post(`/api/workspaces/${workspaceId}/invites`, {
    data: { email, role: "editor" },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { invite: { id: string } }).invite;
}

async function uploadTextFile(
  page: Page,
  workspaceId: string,
  name: string,
  body: string,
) {
  const response = await page.context().request.post("/api/files", {
    multipart: {
      file: { buffer: Buffer.from(body), mimeType: "text/plain", name },
      kind: "file",
      workspaceId,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { attachment: Record<string, unknown> }).attachment;
}

async function saveWorkspaceWithAttachment(
  page: Page,
  workspaceId: string,
  attachment: Record<string, unknown>,
) {
  const loaded = await page.context().request.get(`/api/workspaces/${workspaceId}`);
  expect(loaded.ok()).toBe(true);
  const workspace = await loaded.json() as WorkspaceSnapshotResponse;
  const document = workspace.content.documents[0];
  const paragraph = document.blocks[0];
  document.blocks = [
    {
      ...paragraph,
      content: "恢复后仍需存在的内容",
    },
    {
      ...paragraph,
      content: "恢复后仍可下载的文件",
      data: attachment,
      id: `${String(paragraph.id)}-attachment`,
      position: Number(paragraph.position ?? 0) + 1,
      type: "file",
    },
  ];
  const saved = await page.context().request.put(`/api/workspaces/${workspaceId}`, {
    data: { content: workspace.content },
  });
  expect(saved.ok()).toBe(true);
}

async function loadWorkspace(request: APIRequestContext, workspaceId: string) {
  const response = await request.get(`/api/workspaces/${workspaceId}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<WorkspaceSnapshotResponse>;
}

async function getWorkspaceCatalog(request: APIRequestContext) {
  const response = await request.get("/api/workspaces");
  expect(response.ok()).toBe(true);
  return response.json() as Promise<WorkspaceCatalogResponse>;
}

async function deleteWorkspaceFromManager(page: Page, workspaceId: string, workspaceName: string) {
  await currentWorkspaceButton(page, workspaceName).click();
  const manager = page.getByRole("dialog", { name: "工作区管理" });
  await expect(manager).toBeVisible();
  await manager.getByRole("button", { name: `管理 ${workspaceName}` }).click();
  await manager.getByRole("tab", { name: "危险区域" }).click();
  await expect(manager.getByText("危险区域", { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "移至回收站" }).click();

  const confirmation = page.getByRole("dialog", { name: "移至回收站" });
  const confirmDelete = confirmation.getByRole("button", { name: "移至回收站" });
  await confirmation.getByLabel("输入完整工作区名称以确认").fill(`${workspaceName} `);
  await expect(confirmDelete).toBeDisabled();
  await confirmation.getByLabel("输入完整工作区名称以确认").fill(workspaceName);
  await expect(confirmDelete).toBeEnabled();
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === "DELETE"
    && new URL(candidate.url()).pathname === `/api/workspaces/${workspaceId}`
  ));
  await confirmDelete.click();
  expect((await response).ok()).toBe(true);
}

async function openWorkspaceTrash(page: Page) {
  await page.getByRole("button", { name: /^当前工作区 / }).click();
  const manager = page.getByRole("dialog", { name: "工作区管理" });
  await expect(manager).toBeVisible();
  await manager.getByRole("button", { name: "打开回收站" }).click();
}

function currentWorkspaceButton(page: Page, workspaceName: string) {
  return page.getByRole("button", {
    name: new RegExp(`^当前工作区 ${escapeRegExp(workspaceName)}，`),
  });
}

function inviteToken(inviteUrl: string) {
  const token = new URLSearchParams(new URL(inviteUrl).hash.slice(1)).get("token");
  if (!token) throw new Error("Workspace invitation URL is missing its token");
  return token;
}

async function openWorkspaceSocket(
  context: BrowserContext,
  workspaceId: string,
  documentId: string,
) {
  const session = (await context.cookies()).find((cookie) => cookie.name === "notion_editor_session");
  if (!session) throw new Error("Authenticated collaboration socket requires a session cookie");
  const webOrigin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
  const collaborationBase = process.env.E2E_COLLABORATION_URL ?? "ws://localhost:1234";
  const room = `workspace:${workspaceId}:document:${documentId}`;
  const socket = new WebSocket(`${collaborationBase}/${encodeURIComponent(room)}`, {
    headers: {
      Cookie: `${session.name}=${encodeURIComponent(session.value)}`,
      Origin: webOrigin,
    },
  });
  const closed = new Promise<number>((resolve, reject) => {
    socket.once("close", (code) => resolve(code));
    socket.once("error", reject);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return { closed };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function triggerWorkspacePurge(page: Page) {
  const response = await page.context().request.get("/api/workspaces/trash");
  expect(response.ok()).toBe(true);
}

function workspaceRowCount(workspaceId: string) {
  return queryScalar(
    "SELECT COUNT(*) FROM editor_workspaces WHERE id = :'workspace_id'",
    { workspace_id: workspaceId },
  );
}

function auditEventCount(workspaceId: string) {
  return queryScalar(
    "SELECT COUNT(*) FROM workspace_audit_events WHERE workspace_id = :'workspace_id'",
    { workspace_id: workspaceId },
  );
}
