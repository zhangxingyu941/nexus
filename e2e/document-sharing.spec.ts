import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { EditorDocument } from "../src/features/editor/model/block";
import type {
  CreatedDocumentShare,
  SharedDocumentSnapshot,
} from "../src/shared/documentShare";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
} from "./support";

const DAY_MS = 24 * 60 * 60_000;

test.describe("anonymous document sharing acceptance", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("creates a 24-hour read-only link and revokes regenerated documents and files", async ({
    browser,
    page,
  }, testInfo) => {
    const owner = createAcceptanceIdentity("e2e-document-sharing-owner");
    const anonymousContext = await browser.newContext();

    try {
      await registerAndVerify(page.context().request, owner);
      const fixture = await createSharedDocumentFixture(page.context().request);
      await openShareDialog(page, fixture.publicId);

      const createdAt = Date.now();
      const firstShare = await createLinkFromDialog(page);
      expect(firstShare.expiresAt).toBeGreaterThanOrEqual(createdAt + DAY_MS - 5_000);
      expect(firstShare.expiresAt).toBeLessThanOrEqual(Date.now() + DAY_MS + 5_000);

      const first = await loadAnonymousShare(anonymousContext, firstShare.url);
      expect(first.snapshot.document.title).toBe(fixture.document.title);
      expect(JSON.stringify(first.snapshot)).toContain("公开正文");
      expect(JSON.stringify(first.snapshot)).not.toContain(fixture.privateComment);
      expect(JSON.stringify(first.snapshot)).not.toContain(fixture.privateAssignee);
      expect(JSON.stringify(first.snapshot)).not.toContain(fixture.privateDueDate);
      expect(JSON.stringify(first.snapshot)).not.toContain(fixture.document.id);
      expect(JSON.stringify(first.snapshot)).not.toContain(fixture.attachmentKey);
      expect(first.snapshot.document).not.toHaveProperty("id");

      const firstAttachmentUrl = sharedAttachmentUrl(first.snapshot);
      const firstAttachment = await anonymousContext.request.get(firstAttachmentUrl);
      expect(firstAttachment.status()).toBe(200);
      await expect(firstAttachment.text()).resolves.toBe(fixture.attachmentBody);

      const anonymousPage = await anonymousContext.newPage();
      const openedWebSockets: string[] = [];
      anonymousPage.on("websocket", (socket) => openedWebSockets.push(socket.url()));
      await anonymousPage.goto(first.pagePath);
      await expect(anonymousPage.getByRole("main", { name: "共享文档" })).toBeVisible();
      await expect(anonymousPage.getByRole("heading", { name: fixture.document.title })).toBeVisible();
      await expect(anonymousPage.getByText("公开正文", { exact: true })).toBeVisible();
      await expect(anonymousPage.getByRole("link", { name: "打开文件 share-proof.txt" })).toBeVisible();
      await expect(anonymousPage.getByRole("button", { name: "分享" })).toHaveCount(0);
      await expect(anonymousPage.getByRole("button", { name: "评论" })).toHaveCount(0);
      await expect(anonymousPage.getByRole("button", { name: "历史" })).toHaveCount(0);
      await expect(anonymousPage.getByRole("button", { name: "成员" })).toHaveCount(0);
      await expect(anonymousPage.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
      expect(openedWebSockets).toEqual([]);
      await anonymousPage.screenshot({
        fullPage: false,
        path: testInfo.outputPath("m7-2-shared-document-desktop.png"),
      });

      const secondShare = await createLinkFromDialog(page, true);
      expect(secondShare.url).not.toBe(firstShare.url);
      expect((await anonymousContext.request.get(first.apiPath)).status()).toBe(410);
      expect((await anonymousContext.request.get(firstAttachmentUrl)).status()).toBe(410);

      const second = await loadAnonymousShare(anonymousContext, secondShare.url);
      const secondAttachmentUrl = sharedAttachmentUrl(second.snapshot);
      expect((await anonymousContext.request.get(secondAttachmentUrl)).status()).toBe(200);

      const revokeResponse = page.waitForResponse((response) => (
        response.request().method() === "DELETE"
        && new URL(response.url()).pathname === shareLinksPath(fixture.publicId)
      ));
      await page.getByRole("button", { name: "关闭分享链接" }).click();
      expect((await revokeResponse).status()).toBe(204);
      await expect(page.getByText("分享链接已关闭", { exact: true })).toBeVisible();
      expect((await anonymousContext.request.get(second.apiPath)).status()).toBe(410);
      expect((await anonymousContext.request.get(secondAttachmentUrl)).status()).toBe(410);
      expect((await anonymousContext.request.get("/api/shared-documents/unknown-token")).status())
        .toBe(404);
    } finally {
      await anonymousContext.close();
    }
  });

  test("uses an owner-defined expiration and keeps the mobile dialog inside the viewport", async ({
    page,
  }, testInfo) => {
    const owner = createAcceptanceIdentity("e2e-document-sharing-custom");
    await page.setViewportSize({ height: 844, width: 390 });
    await registerAndVerify(page.context().request, owner);
    const fixture = await createSharedDocumentFixture(page.context().request, false);
    await openShareDialog(page, fixture.publicId);

    await page.getByRole("combobox", { name: "链接有效期" }).selectOption("custom");
    const customExpiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    customExpiresAt.setSeconds(0, 0);
    await page.getByLabel("自定义过期时间").fill(toDateTimeLocalValue(customExpiresAt));

    const created = await createLinkFromDialog(page);
    expect(created.expiresAt).toBe(customExpiresAt.getTime());
    await expect(page.getByText("分享链接已创建", { exact: true })).toBeVisible();
    await expect(page.locator(`time[datetime="${customExpiresAt.toISOString()}"]`)).toBeVisible();

    const dialog = page.getByRole("dialog", { name: "分享文档" });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    const dialogWidth = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dialogWidth.scrollWidth).toBeLessThanOrEqual(dialogWidth.clientWidth);
    await page.screenshot({
      fullPage: false,
      path: testInfo.outputPath("m7-2-share-dialog-mobile.png"),
    });
  });
});

async function createSharedDocumentFixture(
  request: APIRequestContext,
  includeAttachment = true,
) {
  const workspaceResponse = await request.get("/api/workspaces");
  expect(workspaceResponse.ok()).toBe(true);
  const { currentWorkspaceId: workspaceId } = await workspaceResponse.json() as {
    currentWorkspaceId: string;
  };
  const now = Date.now();
  const privateComment = "仅成员可见的评论";
  const privateAssignee = "private-owner@example.com";
  const privateDueDate = "2030-12-31";
  const document: EditorDocument = {
    blocks: [{
      assignee: privateAssignee,
      checked: false,
      children: [],
      comments: [{
        author: "Owner",
        body: privateComment,
        createdAt: now,
        id: `comment-${now}`,
        resolved: false,
        time: "刚刚",
      }],
      content: "公开正文",
      createdAt: now,
      data: null,
      dueDate: privateDueDate,
      headingLevel: 1,
      id: `paragraph-${now}`,
      parentId: null,
      status: "in-progress",
      type: "paragraph",
      updatedAt: now,
    }],
    id: `document-sharing-${now}`,
    title: `匿名分享验收 ${now}`,
    updatedAt: now,
  };
  const createResponse = await request.post(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/documents`,
    { data: { document, position: 1 } },
  );
  expect(createResponse.ok()).toBe(true);
  const created = await createResponse.json() as {
    access: { publicId: string };
  };

  let attachmentBody = "";
  let attachmentKey = "";
  if (includeAttachment) {
    attachmentBody = `share-proof-${now}`;
    const uploadResponse = await request.post("/api/files", {
      multipart: {
        documentId: document.id,
        file: {
          buffer: Buffer.from(attachmentBody),
          mimeType: "text/plain",
          name: "share-proof.txt",
        },
        kind: "file",
        workspaceId,
      },
    });
    expect(uploadResponse.status()).toBe(201);
    const upload = await uploadResponse.json() as {
      attachment: {
        key: string;
        kind: "file";
        mimeType: string;
        name: string;
        size: number;
        url: string;
      };
    };
    attachmentKey = upload.attachment.key;
    document.blocks.push({
      assignee: privateAssignee,
      checked: false,
      children: [],
      comments: [],
      content: "公开附件",
      createdAt: now,
      data: upload.attachment,
      dueDate: privateDueDate,
      headingLevel: 1,
      id: `file-${now}`,
      parentId: null,
      status: "review",
      type: "file",
      updatedAt: now,
    });
    document.updatedAt = Date.now();
    const saveResponse = await request.put(
      `/api/documents/${encodeURIComponent(created.access.publicId)}`,
      { data: { document } },
    );
    expect(saveResponse.ok()).toBe(true);
  }

  return {
    attachmentBody,
    attachmentKey,
    document,
    privateAssignee,
    privateComment,
    privateDueDate,
    publicId: created.access.publicId,
  };
}

async function openShareDialog(page: Page, publicId: string) {
  await page.goto(`/documents/${encodeURIComponent(publicId)}`);
  await expect(page.getByRole("textbox", { name: "文档标题" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "分享" }).click();
  const dialog = page.getByRole("dialog", { name: "分享文档" });
  await expect(dialog).toBeVisible();
  const policyResponse = page.waitForResponse((response) => (
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname === `/api/documents/${encodeURIComponent(publicId)}/permissions`
  ));
  await dialog.getByRole("radio", { name: "拥有链接的人可查看" }).click();
  expect((await policyResponse).ok()).toBe(true);
  await expect(dialog.getByRole("region", { name: "匿名分享链接" })).toBeVisible();
}

async function createLinkFromDialog(page: Page, regenerate = false) {
  const publicId = decodeURIComponent(new URL(page.url()).pathname.slice("/documents/".length));
  const createResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname === shareLinksPath(publicId)
  ));
  await page.getByRole("button", {
    name: regenerate ? "重新生成分享链接" : "创建分享链接",
  }).click();
  const response = await createResponse;
  expect(response.status()).toBe(201);
  const payload = await response.json() as { shareLink: CreatedDocumentShare };
  await expect(page.getByRole("textbox", { name: "分享链接" }))
    .toHaveValue(payload.shareLink.url);
  return payload.shareLink;
}

async function loadAnonymousShare(context: BrowserContext, shareUrl: string) {
  const pagePath = new URL(shareUrl).pathname;
  const token = decodeURIComponent(pagePath.slice("/share/".length));
  const apiPath = `/api/shared-documents/${encodeURIComponent(token)}`;
  const response = await context.request.get(apiPath);
  expect(response.status()).toBe(200);
  return {
    apiPath,
    pagePath,
    snapshot: await response.json() as SharedDocumentSnapshot,
  };
}

function sharedAttachmentUrl(snapshot: SharedDocumentSnapshot) {
  const attachment = snapshot.document.blocks.find((block) => block.type === "file")?.data;
  if (!attachment || attachment.kind !== "file") {
    throw new Error("Shared file attachment is missing");
  }
  return attachment.url;
}

function shareLinksPath(publicId: string) {
  return `/api/documents/${encodeURIComponent(publicId)}/share-links`;
}

function toDateTimeLocalValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
