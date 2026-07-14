import { test, expect } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
  restartCollaborationService,
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
      const login = await context.request.post("/api/auth/session", {
        data: { email: identity.email, password: identity.password },
      });
      expect(login.ok()).toBe(true);
    }

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await expect(pageA.getByText("协同已连接", { exact: true })).toBeVisible();
    await expect(pageB.getByText("协同已连接", { exact: true })).toBeVisible();

    await pageA.getByLabel("块内容").fill("双窗口实时同步正文");
    await expect(pageB.getByLabel("块内容")).toContainText("双窗口实时同步正文");
    await expect(pageA.getByText(/2 在线/)).toBeVisible();
    await pageA.screenshot({ path: testInfo.outputPath("collaboration-desktop.png"), fullPage: true });

    restartCollaborationService();
    await expect(pageA.getByText("协同已连接", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("协同已连接", { exact: true })).toBeVisible({ timeout: 30_000 });
    await pageB.reload();
    await expect(pageB.getByLabel("块内容")).toContainText("双窗口实时同步正文");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
