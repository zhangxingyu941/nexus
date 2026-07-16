import { test, expect } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  waitForWorkspaceCatalog,
  waitForCapturedCode,
} from "./support";

const sensitiveAuthEndpoints = [
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/password/reset",
  "/api/auth/session",
] as const;

test.beforeEach(() => {
  cleanupAcceptanceData();
});

test.afterAll(() => {
  cleanupAcceptanceData();
});

test("registers, verifies, logs in, persists an empty workspace, and resets the password", async ({ page }, testInfo) => {
  const identity = createAcceptanceIdentity("e2e");
  const capturedAuthBodies = new Map<string, unknown[]>();
  page.on("request", (request) => {
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "POST" || !sensitiveAuthEndpoints.includes(
      endpoint as typeof sensitiveAuthEndpoints[number],
    )) {
      return;
    }
    const bodies = capturedAuthBodies.get(endpoint) ?? [];
    bodies.push(request.postDataJSON());
    capturedAuthBodies.set(endpoint, bodies);
  });
  await page.goto("/");

  await expect(page.getByRole("form", { name: "Nexus 身份认证" })).toBeVisible();
  const githubLogin = page.getByRole("link", { name: "使用 GitHub 登录" });
  if (await githubLogin.count()) {
    await expect(githubLogin).toHaveAttribute("href", "/api/auth/oauth/github");
  }
  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByLabel("姓名").fill(identity.displayName);
  await page.getByLabel("邮箱").fill(identity.email);
  await page.getByLabel("密码", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByText(`验证码已发送至 ${identity.email}`)).toBeVisible();
  const verificationCode = await waitForCapturedCode(identity.email, "verify-email");
  await page.getByLabel("邮箱验证码").fill(verificationCode);
  const initialCatalog = waitForWorkspaceCatalog(page);
  await page.getByRole("button", { name: "验证并进入工作区" }).click();
  await initialCatalog;
  await expect(page.getByLabel("文档标题")).toHaveValue("未命名文档");
  await expect(page.getByTestId(/^document-nav-/)).toHaveCount(1);
  await expect(page.getByText("需求 PRD")).toHaveCount(0);

  await page.getByLabel("文档标题").fill("E2E 持久化文档");
  await page.getByLabel("块内容").fill("端到端持久化正文");
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("文档标题")).toHaveValue("E2E 持久化文档");
  await expect(page.getByLabel("块内容")).toContainText("端到端持久化正文");

  await page.screenshot({ path: testInfo.outputPath("editor-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "打开工作区导航" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("editor-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "打开工作区导航" }).click();
  await page.getByRole("button", { name: "任务中心" }).click();
  const taskCenter = page.getByRole("dialog", { name: "任务中心" });
  await expect(taskCenter).toBeVisible();
  await taskCenter.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const taskTabLayout = await taskCenter.getByRole("tab").evaluateAll((tabs) =>
    tabs.map((tab) => ({
      clientHeight: tab.clientHeight,
      scrollHeight: tab.scrollHeight,
      whiteSpace: window.getComputedStyle(tab).whiteSpace,
    })),
  );
  expect(taskTabLayout.every((tab) => tab.whiteSpace === "nowrap" && tab.scrollHeight <= tab.clientHeight)).toBe(true);
  await taskCenter.screenshot({ path: testInfo.outputPath("task-center-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(taskCenter).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: `退出 ${identity.displayName}` }).click();
  await page.getByRole("button", { name: "忘记密码" }).click();
  await page.getByLabel("邮箱").fill(identity.email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByText(`验证码已发送至 ${identity.email}`)).toBeVisible();
  const resetCode = await waitForCapturedCode(identity.email, "reset-password");
  await page.getByLabel("邮箱验证码").fill(resetCode);
  await page.getByLabel("新密码").fill(identity.replacementPassword);
  const resetCatalog = waitForWorkspaceCatalog(page);
  await page.getByRole("button", { name: "重置密码并进入工作区" }).click();
  await resetCatalog;
  await expect(page.getByLabel("文档标题")).toHaveValue("E2E 持久化文档");

  await page.getByRole("button", { name: `退出 ${identity.displayName}` }).click();
  await page.getByLabel("邮箱").fill(identity.email);
  await page.getByLabel("密码", { exact: true }).fill(identity.replacementPassword);
  const loginCatalog = waitForWorkspaceCatalog(page);
  await page.getByRole("button", { name: "登录" }).click();
  await loginCatalog;
  await expect(page.getByLabel("文档标题")).toHaveValue("E2E 持久化文档");

  for (const endpoint of sensitiveAuthEndpoints) {
    const bodies = capturedAuthBodies.get(endpoint) ?? [];
    expect(bodies, `captured POST body for ${endpoint}`).toHaveLength(1);
    for (const body of bodies) {
      expect(isRecord(body), `${endpoint} body is a JSON object`).toBe(true);
      if (!isRecord(body)) {
        continue;
      }
      expect(typeof body.credential, `${endpoint} credential is a string`).toBe("string");
      expect(Object.hasOwn(body, "password"), `${endpoint} omits password`).toBe(false);
      expect(Object.hasOwn(body, "code"), `${endpoint} omits code`).toBe(false);
    }
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
