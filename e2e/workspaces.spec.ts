import { expect, test, type Page } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
  waitForWorkspaceCatalog,
} from "./support";

test.describe("multi-workspace acceptance", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("keeps database workspace content and active documents isolated", async ({ page }) => {
    const identity = createAcceptanceIdentity("workspace");
    await registerAndVerify(page.context().request, identity);
    const originalWorkspaceName = `${identity.displayName}的工作区`;

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await expect(currentWorkspaceButton(page, originalWorkspaceName)).toBeVisible();

    await createWorkspace(page, "研发中心");
    await expect(currentWorkspaceButton(page, "研发中心")).toBeVisible();
    await page.getByLabel("文档标题").fill("研发文档");
    await page.getByLabel("块内容").fill("研发中心独有内容");
    await expect(page.getByText("已同步", { exact: true })).toBeVisible();

    await switchWorkspace(page, originalWorkspaceName);
    await expect(page.getByLabel("文档标题")).toHaveValue("未命名文档");
    await expect(page.getByText("研发中心独有内容")).toHaveCount(0);

    await switchWorkspace(page, "研发中心");
    await expect(page.getByLabel("文档标题")).toHaveValue("研发文档");
    await expect(page.getByLabel("块内容")).toContainText("研发中心独有内容");

    await createBlankDocument(page);
    await page.getByLabel("文档标题").fill("研发活动文档");
    await expect(page.getByText("已同步", { exact: true })).toBeVisible();
    await switchWorkspace(page, originalWorkspaceName);
    await switchWorkspace(page, "研发中心");
    await expect(page.getByLabel("文档标题")).toHaveValue("研发活动文档");

    await renameCurrentWorkspace(page, "产品研发");
    await expect(currentWorkspaceButton(page, "产品研发")).toBeVisible();
    await page.reload();
    await expect(currentWorkspaceButton(page, "产品研发")).toBeVisible();
    await expect(page.getByLabel("文档标题")).toHaveValue("研发活动文档");
  });

  test("migrates IndexedDB v1 and persists isolated local workspaces", async ({ page }) => {
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
    await seedLegacyWorkspace(page);
    await page.goto("/");

    await expect(currentWorkspaceButton(page, "Nexus 工作区")).toBeVisible();
    await expect(page.getByLabel("文档标题")).toHaveValue("旧工作区文档");
    await expect(page.getByLabel("块内容")).toContainText("v1 保留内容");

    await createWorkspace(page, "本地研发");
    await page.getByLabel("文档标题").fill("本地研发文档");
    await page.getByLabel("块内容").fill("本地研发独有内容");
    await expect(page.getByText("本地已保存", { exact: true })).toBeVisible();

    await switchWorkspace(page, "Nexus 工作区");
    await expect(page.getByLabel("文档标题")).toHaveValue("旧工作区文档");
    await expect(page.getByLabel("块内容")).toContainText("v1 保留内容");

    await switchWorkspace(page, "本地研发");
    await expect(page.getByLabel("文档标题")).toHaveValue("本地研发文档");
    await page.reload();
    await expect(currentWorkspaceButton(page, "本地研发")).toBeVisible();
    await expect(page.getByLabel("块内容")).toContainText("本地研发独有内容");
  });
});

function currentWorkspaceButton(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^当前工作区 ${escapeRegExp(name)}，`) });
}

async function openWorkspaceManager(page: Page) {
  await page.getByRole("button", { name: /^当前工作区 / }).click();
  await expect(page.getByRole("dialog", { name: "工作区管理" })).toBeVisible();
}

async function createWorkspace(page: Page, name: string) {
  await openWorkspaceManager(page);
  await page.getByRole("button", { name: "新建工作区" }).click();
  await page.getByLabel("工作区名称").fill(name);
  await page.getByRole("button", { name: "创建并切换" }).click();
  await expect(currentWorkspaceButton(page, name)).toBeVisible();
}

async function switchWorkspace(page: Page, name: string) {
  await openWorkspaceManager(page);
  await page.getByRole("button", { name: `切换到${name}` }).click();
  await expect(currentWorkspaceButton(page, name)).toBeVisible();
}

async function renameCurrentWorkspace(page: Page, name: string) {
  const currentName = await page.getByRole("button", { name: /^当前工作区 / }).getAttribute("aria-label");
  const match = /^当前工作区 (.+)，/.exec(currentName ?? "");
  if (!match) throw new Error("Unable to resolve current workspace name");
  await openWorkspaceManager(page);
  await page.getByRole("button", { name: `重命名 ${match[1]}` }).click();
  await page.getByLabel("工作区名称").fill(name);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.keyboard.press("Escape");
}

async function createBlankDocument(page: Page) {
  await page.getByRole("button", { name: "新建文档" }).click();
  const dialog = page.getByRole("dialog", { name: "新建文档" });
  await dialog.getByRole("button", { name: /空白文档/ }).click();
  await expect(page.getByLabel("文档标题")).toHaveValue("未命名文档");
}

async function seedLegacyWorkspace(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("nexus", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("documents")) {
          request.result.createObjectStore("documents");
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("documents", "readwrite");
        transaction.objectStore("documents").put({
          activeDocumentId: "legacy-document",
          documents: [{
            blocks: [{
              checked: false,
              children: [],
              comments: [],
              content: "v1 保留内容",
              createdAt: 1000,
              id: "legacy-block",
              parentId: null,
              type: "paragraph",
              updatedAt: 1000,
            }],
            id: "legacy-document",
            title: "旧工作区文档",
            updatedAt: 1000,
          }],
          updatedAt: 1000,
        }, "workspace");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
