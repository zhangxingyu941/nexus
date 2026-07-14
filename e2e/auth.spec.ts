import { test, expect } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  waitForCapturedCode,
} from "./support";

test.beforeEach(() => {
  cleanupAcceptanceData();
});

test.afterAll(() => {
  cleanupAcceptanceData();
});

test("registers, verifies, logs in, persists an empty workspace, and resets the password", async ({ page }, testInfo) => {
  const identity = createAcceptanceIdentity("e2e");
  await page.goto("/");

  await expect(page.getByRole("form", { name: "Nexus 身份认证" })).toBeVisible();
  await expect(page.getByRole("link", { name: "使用 GitHub 登录" })).toHaveCount(0);
  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByLabel("姓名").fill(identity.displayName);
  await page.getByLabel("邮箱").fill(identity.email);
  await page.getByLabel("密码", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByText(`验证码已发送至 ${identity.email}`)).toBeVisible();
  const verificationCode = await waitForCapturedCode(identity.email, "verify-email");
  await page.getByLabel("邮箱验证码").fill(verificationCode);
  await page.getByRole("button", { name: "验证并进入工作区" }).click();
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
  await expect(page.getByText("如果账号存在，验证码已发送")).toBeVisible();
  const resetCode = await waitForCapturedCode(identity.email, "reset-password");
  await page.getByLabel("邮箱验证码").fill(resetCode);
  await page.getByLabel("新密码").fill(identity.replacementPassword);
  await page.getByRole("button", { name: "重置密码并进入工作区" }).click();
  await expect(page.getByLabel("文档标题")).toHaveValue("E2E 持久化文档");

  await page.getByRole("button", { name: `退出 ${identity.displayName}` }).click();
  await page.getByLabel("邮箱").fill(identity.email);
  await page.getByLabel("密码", { exact: true }).fill(identity.replacementPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByLabel("文档标题")).toHaveValue("E2E 持久化文档");
});
