import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
} from "./support";

test.describe("document permissions acceptance", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("hides private documents and enforces explicit editor and viewer roles", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-permissions-owner");
    const member = createAcceptanceIdentity("workspace-permissions-member");
    const memberContext = await browser.newContext();

    try {
      await registerAndVerify(page.context().request, owner);
      await registerAndVerify(memberContext.request, member);
      const ownerRequest = page.context().request;
      const workspaceId = await currentWorkspaceId(ownerRequest);
      const memberId = await currentUserId(memberContext.request);
      await inviteAndAccept(ownerRequest, memberContext.request, workspaceId, member.email);

      const document = {
        blocks: [],
        id: `document-permissions-${Date.now()}`,
        title: "预算草案",
        updatedAt: Date.now(),
      };
      const createResponse = await ownerRequest.post(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/documents`,
        { data: { document, position: 1 } },
      );
      expect(createResponse.ok()).toBe(true);
      const created = await createResponse.json() as {
        access: { publicId: string };
        document: typeof document;
      };
      const documentUrl = `/api/documents/${encodeURIComponent(created.access.publicId)}`;
      const policyUrl = `${documentUrl}/permissions`;

      const makePrivateResponse = await ownerRequest.patch(policyUrl, {
        data: { accessMode: "private", permissions: [] },
      });
      expect(makePrivateResponse.ok()).toBe(true);

      const memberWorkspaceResponse = await memberContext.request.get(
        `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      );
      expect(memberWorkspaceResponse.ok()).toBe(true);
      const memberWorkspace = await memberWorkspaceResponse.json() as {
        content: { documents: Array<{ title: string }> };
      };
      expect(memberWorkspace.content.documents.map((item) => item.title)).not.toContain("预算草案");
      expect((await memberContext.request.get(documentUrl)).status()).toBe(404);
      expect((await memberContext.request.put(documentUrl, { data: { document } })).status()).toBe(404);

      const memberPage = await memberContext.newPage();
      await memberPage.goto(`/documents/${encodeURIComponent(created.access.publicId)}`);
      await expect(memberPage.getByText("文档不可用", { exact: true })).toBeVisible();

      const grantEditorResponse = await ownerRequest.patch(policyUrl, {
        data: {
          accessMode: "private",
          permissions: [{ role: "editor", userId: memberId }],
        },
      });
      expect(grantEditorResponse.ok()).toBe(true);
      const editorSnapshotResponse = await memberContext.request.get(documentUrl);
      expect(editorSnapshotResponse.ok()).toBe(true);
      const editorSnapshot = await editorSnapshotResponse.json() as {
        access: { canWrite: boolean };
        document: typeof document;
      };
      expect(editorSnapshot.access.canWrite).toBe(true);

      const updatedDocument = {
        ...editorSnapshot.document,
        title: "预算草案（编辑）",
        updatedAt: Date.now(),
      };
      expect((await memberContext.request.put(documentUrl, {
        data: { document: updatedDocument },
      })).ok()).toBe(true);

      const grantViewerResponse = await ownerRequest.patch(policyUrl, {
        data: {
          accessMode: "private",
          permissions: [{ role: "viewer", userId: memberId }],
        },
      });
      expect(grantViewerResponse.ok()).toBe(true);
      const viewerSnapshotResponse = await memberContext.request.get(documentUrl);
      expect(viewerSnapshotResponse.ok()).toBe(true);
      await expect(viewerSnapshotResponse.json()).resolves.toMatchObject({
        access: { canRead: true, canWrite: false, role: "viewer" },
        document: { title: "预算草案（编辑）" },
      });
      expect((await memberContext.request.put(documentUrl, {
        data: { document: { ...updatedDocument, title: "不应写入", updatedAt: Date.now() } },
      })).status()).toBe(404);
    } finally {
      await memberContext.close();
    }
  });
});

async function currentWorkspaceId(request: APIRequestContext) {
  const response = await request.get("/api/workspaces");
  expect(response.ok()).toBe(true);
  const catalog = await response.json() as { currentWorkspaceId: string };
  return catalog.currentWorkspaceId;
}

async function currentUserId(request: APIRequestContext) {
  const response = await request.get("/api/auth/session");
  expect(response.ok()).toBe(true);
  const session = await response.json() as { user: { id: string } };
  return session.user.id;
}

async function inviteAndAccept(
  ownerRequest: APIRequestContext,
  memberRequest: APIRequestContext,
  workspaceId: string,
  memberEmail: string,
) {
  const createResponse = await ownerRequest.post(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/invites`,
    { data: { email: memberEmail, role: "editor" } },
  );
  expect(createResponse.status()).toBe(201);

  const receivedResponse = await memberRequest.get("/api/workspace-invites");
  expect(receivedResponse.ok()).toBe(true);
  const received = await receivedResponse.json() as { invites: Array<{ id: string }> };
  expect(received.invites).toHaveLength(1);
  const acceptResponse = await memberRequest.post(
    `/api/workspace-invites/${encodeURIComponent(received.invites[0].id)}/accept`,
  );
  expect(acceptResponse.ok()).toBe(true);
}
