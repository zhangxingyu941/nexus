import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  ageWorkspaceInviteForResend,
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  expireWorkspaceInvite,
  registerAndVerify,
  waitForCapturedCode,
  waitForCapturedInvite,
  waitForWorkspaceCatalog,
} from "./support";

test.describe("workspace invitation lifecycle", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("lets an unregistered recipient register and accept from the email link", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-invite-owner");
    const recipient = createAcceptanceIdentity("workspace-invite-new");
    const workspaceName = personalWorkspaceName(owner.displayName);
    await openOwnerWorkspace(page, owner);
    await sendWorkspaceInvite(page, workspaceName, recipient.email);
    const inviteUrl = await waitForCapturedInvite(recipient.email);

    const recipientContext = await browser.newContext();
    try {
      const recipientPage = await recipientContext.newPage();
      const resolution = waitForInviteResolution(recipientPage);
      await recipientPage.goto(inviteNavigationTarget(inviteUrl));
      expect((await resolution).status()).toBe(200);
      await expect(recipientPage.getByRole("form", { name: "Nexus 身份认证" })).toBeVisible();

      await recipientPage.getByRole("tab", { name: "注册" }).click();
      await recipientPage.getByLabel("姓名").fill(recipient.displayName);
      await recipientPage.getByLabel("邮箱").fill(recipient.email);
      await recipientPage.getByLabel("密码", { exact: true }).fill(recipient.password);
      await recipientPage.getByRole("button", { name: "创建账号" }).click();
      await expect(recipientPage.getByText(`验证码已发送至 ${recipient.email}`)).toBeVisible();
      await recipientPage.getByLabel("邮箱验证码").fill(
        await waitForCapturedCode(recipient.email, "verify-email"),
      );
      await recipientPage.getByRole("button", { name: "验证并进入工作区" }).click();

      await expect(recipientPage.getByRole("heading", { name: workspaceName })).toBeVisible();
      await recipientPage.getByRole("button", { name: "接受并进入" }).click();
      await expect(recipientPage).toHaveURL(/\/$/);
      await expect(currentWorkspaceButton(recipientPage, workspaceName, "编辑者")).toBeVisible();
    } finally {
      await recipientContext.close();
    }
  });

  test("lets a registered recipient accept from the in-app invitation center", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-invite-owner");
    const recipient = createAcceptanceIdentity("workspace-invite-member");
    const workspaceName = personalWorkspaceName(owner.displayName);
    const recipientContext = await browser.newContext();

    try {
      await registerAndVerify(recipientContext.request, recipient);
      await openOwnerWorkspace(page, owner);
      await sendWorkspaceInvite(page, workspaceName, recipient.email);

      const recipientPage = await recipientContext.newPage();
      await Promise.all([waitForWorkspaceCatalog(recipientPage), recipientPage.goto("/")]);
      await recipientPage.getByRole("button", { name: "工作区邀请 1" }).click();
      const invitationCenter = recipientPage.getByRole("dialog", { name: "工作区邀请" });
      await expect(invitationCenter.getByRole("heading", { name: workspaceName })).toBeVisible();
      await invitationCenter.getByRole("button", { name: "接受并进入" }).click();

      await expect(currentWorkspaceButton(recipientPage, workspaceName, "编辑者")).toBeVisible();
      await expect(recipientPage.getByRole("button", { name: "工作区邀请 0" })).toBeVisible();
    } finally {
      await recipientContext.close();
    }
  });

  test("shows an in-app decline in the owner invitation history", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-invite-owner");
    const recipient = createAcceptanceIdentity("workspace-invite-decline");
    const workspaceName = personalWorkspaceName(owner.displayName);
    const recipientContext = await browser.newContext();

    try {
      await registerAndVerify(recipientContext.request, recipient);
      await openOwnerWorkspace(page, owner);
      await sendWorkspaceInvite(page, workspaceName, recipient.email);

      const recipientPage = await recipientContext.newPage();
      await Promise.all([waitForWorkspaceCatalog(recipientPage), recipientPage.goto("/")]);
      await recipientPage.getByRole("button", { name: "工作区邀请 1" }).click();
      const invitationCenter = recipientPage.getByRole("dialog", { name: "工作区邀请" });
      recipientPage.once("dialog", (dialog) => void dialog.accept());
      await invitationCenter.getByRole("button", { name: "拒绝", exact: true }).click();
      await expect(invitationCenter.getByText("暂无待处理邀请")).toBeVisible();

      await page.reload();
      const ownerDialog = await openOwnerInvites(page, workspaceName);
      await expect(sentInviteRow(ownerDialog, recipient.email)).toContainText("已拒绝");
    } finally {
      await recipientContext.close();
    }
  });

  test("invalidates the old email URL when an owner resends an invitation", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-invite-owner");
    const recipient = createAcceptanceIdentity("workspace-invite-resend");
    const workspaceName = personalWorkspaceName(owner.displayName);
    await openOwnerWorkspace(page, owner);
    await sendWorkspaceInvite(page, workspaceName, recipient.email);
    const firstInviteUrl = await waitForCapturedInvite(recipient.email);

    ageWorkspaceInviteForResend(recipient.email);
    await page.reload();
    const ownerDialog = await openOwnerInvites(page, workspaceName);
    const row = sentInviteRow(ownerDialog, recipient.email);
    const resendResponse = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST"
        && new URL(response.url()).pathname.endsWith("/resend");
    });
    await row.getByRole("button", { name: "重发", exact: true }).click();
    expect((await resendResponse).ok()).toBe(true);
    await expect(ownerDialog.getByRole("status")).toHaveText("邀请已重新发送");

    const secondInviteUrl = await waitForCapturedInvite(recipient.email);
    expect(secondInviteUrl).not.toBe(firstInviteUrl);
    await expectInviteUrlRejected(browser, firstInviteUrl, "invite_not_found");
    await expectInviteUrlResolved(browser, secondInviteUrl);
  });

  test("does not allow revoked or expired email invitations to be accepted", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("workspace-invite-owner");
    const revokedRecipient = createAcceptanceIdentity("workspace-invite-revoked");
    const expiredRecipient = createAcceptanceIdentity("workspace-invite-expired");
    const workspaceName = personalWorkspaceName(owner.displayName);
    await openOwnerWorkspace(page, owner);
    const ownerDialog = await sendWorkspaceInvite(page, workspaceName, revokedRecipient.email);
    const revokedInviteUrl = await waitForCapturedInvite(revokedRecipient.email);

    const revokedRow = sentInviteRow(ownerDialog, revokedRecipient.email);
    const revokeResponse = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "DELETE"
        && new URL(response.url()).pathname.includes("/invites/");
    });
    await revokedRow.getByRole("button", { name: "撤销" }).click();
    expect((await revokeResponse).status()).toBe(204);
    await expect(revokedRow).toContainText("已撤销");

    await submitWorkspaceInvite(page, ownerDialog, expiredRecipient.email);
    const expiredInviteUrl = await waitForCapturedInvite(expiredRecipient.email);
    expireWorkspaceInvite(expiredRecipient.email);

    await expectInviteUrlRejected(browser, revokedInviteUrl, "invite_revoked");
    await expectInviteUrlRejected(browser, expiredInviteUrl, "invite_expired");
  });
});

async function openOwnerWorkspace(
  page: Page,
  identity: ReturnType<typeof createAcceptanceIdentity>,
) {
  await registerAndVerify(page.context().request, identity);
  await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
  await expect(currentWorkspaceButton(
    page,
    personalWorkspaceName(identity.displayName),
    "所有者",
  )).toBeVisible();
}

async function sendWorkspaceInvite(page: Page, workspaceName: string, email: string) {
  const dialog = await openOwnerInvites(page, workspaceName);
  await submitWorkspaceInvite(page, dialog, email);
  return dialog;
}

async function openOwnerInvites(page: Page, workspaceName: string) {
  await currentWorkspaceButton(page, workspaceName, "所有者").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "工作区管理" })).toBeVisible();
  await dialog.getByRole("button", { name: `管理 ${workspaceName}` }).click();
  await dialog.getByRole("tab", { name: "邀请" }).click();
  await expect(dialog.getByLabel("成员邮箱")).toBeVisible();
  return dialog;
}

async function submitWorkspaceInvite(page: Page, dialog: Locator, email: string) {
  await dialog.getByLabel("成员邮箱").fill(email);
  await dialog.getByRole("combobox", { name: "邀请角色" }).click();
  await page.getByRole("option", { name: "编辑者", exact: true }).click();
  const createResponse = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST"
      && /\/api\/workspaces\/[^/]+\/invites$/.test(new URL(response.url()).pathname);
  });
  await dialog.getByRole("button", { name: "发送邀请" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(sentInviteRow(dialog, email)).toBeVisible();
}

function sentInviteRow(dialog: Locator, email: string) {
  return dialog.locator('[data-testid^="workspace-invite-"]').filter({ hasText: email });
}

function currentWorkspaceButton(
  page: Page,
  workspaceName: string,
  role: "所有者" | "编辑者",
) {
  return page.getByRole("button", { name: `当前工作区 ${workspaceName}，${role}` });
}

function personalWorkspaceName(displayName: string) {
  return `${displayName}的工作区`;
}

function waitForInviteResolution(page: Page) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST"
      && new URL(response.url()).pathname === "/api/workspace-invites/resolve";
  });
}

async function expectInviteUrlResolved(browser: Browser, inviteUrl: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const resolution = waitForInviteResolution(page);
    await page.goto(inviteNavigationTarget(inviteUrl));
    expect((await resolution).status()).toBe(200);
    await expect(page.getByRole("form", { name: "Nexus 身份认证" })).toBeVisible();
  } finally {
    await context.close();
  }
}

async function expectInviteUrlRejected(
  browser: Browser,
  inviteUrl: string,
  code: "invite_expired" | "invite_not_found" | "invite_revoked",
) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const resolution = waitForInviteResolution(page);
    await page.goto(inviteNavigationTarget(inviteUrl));
    const response = await resolution;
    expect(await response.json()).toMatchObject({ code });
    await expect(page.getByRole("button", { name: "接受并进入" })).toHaveCount(0);
  } finally {
    await context.close();
  }
}

function inviteNavigationTarget(inviteUrl: string) {
  const url = new URL(inviteUrl);
  return `${url.pathname}${url.search}${url.hash}`;
}
