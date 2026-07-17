import { test, expect } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
  requestEncryptedAuthApi,
  restartCollaborationService,
  waitForWorkspaceCatalog,
} from "./support";

test.beforeEach(() => {
  cleanupAcceptanceData();
});

test.afterAll(() => {
  cleanupAcceptanceData();
});

test("synchronizes two browser contexts and recovers after collaboration restart", async ({ browser, request }, testInfo) => {
  const identity = createAcceptanceIdentity("collab");
  await registerAndVerify(request, identity);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    for (const context of [contextA, contextB]) {
      const login = await requestEncryptedAuthApi(context.request, {
        email: identity.email,
        purpose: "login",
        secrets: { password: identity.password },
      });
      expect(login.ok()).toBe(true);
    }

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await Promise.all([
      waitForWorkspaceCatalog(pageA),
      waitForWorkspaceCatalog(pageB),
      pageA.goto("/"),
      pageB.goto("/"),
    ]);
    await expect(pageA.getByText("协同已连接", { exact: true })).toBeVisible();
    await expect(pageB.getByText("协同已连接", { exact: true })).toBeVisible();

    await pageA.getByLabel("块内容").fill("双窗口实时同步正文");
    await expect(pageB.getByLabel("块内容")).toContainText("双窗口实时同步正文");
    await expect(pageA.getByText(/2 在线/)).toBeVisible();

    const rapidInput = "B快速连续输入不会回灌";
    const editorB = pageB.getByLabel("块内容");
    await editorB.fill("");
    await editorB.pressSequentially(rapidInput, { delay: 0 });
    await expect(pageA.getByLabel("块内容")).toHaveText(rapidInput);
    await expect(editorB).toHaveText(rapidInput);

    const settledInput = `${rapidInput}，A继续编辑`;
    const editorA = pageA.getByLabel("块内容");
    await editorA.click();
    await editorA.press("End");
    await pageA.keyboard.type("，A继续编辑", { delay: 0 });
    await expect(editorA).toHaveText(settledInput);
    await expect(editorB).toHaveText(settledInput);
    await pageA.screenshot({ path: testInfo.outputPath("collaboration-desktop.png"), fullPage: true });

    restartCollaborationService();
    await expect(pageA.getByText("协同已连接", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("协同已连接", { exact: true })).toBeVisible({ timeout: 30_000 });
    await pageB.reload();
    await expect(pageB.getByLabel("块内容")).toContainText(settledInput);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("settles rapid collaborative input without echoing parent snapshots", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    for (const page of [pageA, pageB]) {
      await page.route("**/api/auth/session", async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            body: JSON.stringify({ mode: "local", user: null }),
            contentType: "application/json",
            status: 200,
          });
          return;
        }

        await route.continue();
      });
      await page.goto("/api/health");
      await seedSharedLocalWorkspace(page);
    }

    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await expect(pageA.getByText("协同已连接", { exact: true })).toBeVisible();
    await expect(pageB.getByText("协同已连接", { exact: true })).toBeVisible();

    const rapidInput = "B在同一个块中快速连续输入0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const editorA = pageA.getByLabel("块内容");
    const editorB = pageB.getByLabel("块内容");
    await editorB.click();
    await editorB.pressSequentially(rapidInput, { delay: 0 });

    await expect(editorA).toHaveText(rapidInput);
    await expect(editorB).toHaveText(rapidInput);

    await editorA.click();
    await editorA.press("End");
    await pageA.keyboard.type("，A确认", { delay: 0 });
    await expect(editorA).toHaveText(`${rapidInput}，A确认`);
    await expect(editorB).toHaveText(`${rapidInput}，A确认`);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function seedSharedLocalWorkspace(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("notion-block-editor", 2);
      request.onupgradeneeded = () => {
        for (const storeName of ["documents", "workspaceCatalog", "workspaceContents", "preferences"]) {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["workspaceCatalog", "workspaceContents", "preferences"],
          "readwrite",
        );
        transaction.objectStore("workspaceCatalog").put({
          createdAt: 1000,
          id: "local-default",
          name: "Nexus 工作区",
          updatedAt: 1000,
        }, "local-default");
        transaction.objectStore("workspaceContents").put({
          activeDocumentId: "shared-document",
          documents: [{
            blocks: [{
              assignee: "",
              checked: false,
              children: [],
              comments: [],
              content: "",
              createdAt: 1000,
              data: null,
              dueDate: "",
              headingLevel: 1,
              id: "shared-block",
              parentId: null,
              status: "unset",
              type: "paragraph",
              updatedAt: 1000,
            }],
            id: "shared-document",
            pinned: false,
            title: "协作回环验证",
            updatedAt: 1000,
          }],
          updatedAt: 1000,
        }, "local-default");
        transaction.objectStore("preferences").put("local-default", "selectedWorkspaceId");
        transaction.objectStore("preferences").put(true, "v2MigrationComplete");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
}
