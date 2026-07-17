import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  cleanupAcceptanceData,
  createAcceptanceIdentity,
  registerAndVerify,
  requestEncryptedAuthApi,
  waitForCapturedInvite,
  waitForWorkspaceCatalog,
} from "./support";

test.describe("workspace member lifecycle", () => {
  test.beforeEach(() => {
    cleanupAcceptanceData();
  });

  test.afterAll(() => {
    cleanupAcceptanceData();
  });

  test("owner changes member role between editor and viewer", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-owner");
    const editor = createAcceptanceIdentity("members-editor");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);
    await registerAndVerify(page.context().request, editor);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await sendInvite(page, owner, workspaceName, editor.email, "编辑者");
    await acceptInviteAs(browser, editor, workspaceName, "编辑者");

    await page.reload();
    await openMembersTab(page, workspaceName);

    const memberDialog = page.getByRole("dialog", { name: workspaceName });
    const editorSelect = memberDialog.locator('[data-slot="select-trigger"]').filter({ hasText: "编辑者" }).first();
    await editorSelect.click();
    await page.getByRole("option", { name: "访客", exact: true }).click();

    await expect(memberDialog.getByText(editor.displayName)).toBeVisible();
  });

  test("transfers ownership with retention toggle", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-own-t");
    const target = createAcceptanceIdentity("members-target");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);
    await registerAndVerify(page.context().request, target);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await sendInvite(page, owner, workspaceName, target.email, "编辑者");
    await acceptInviteAs(browser, target, workspaceName, "编辑者");

    await page.reload();
    await openMembersTab(page, workspaceName);

    const memberDialog = page.getByRole("dialog", { name: workspaceName });
    await memberDialog.getByRole("button", { name: /转让所有权/ }).click();

    const transferDialog = page.getByRole("dialog", { name: "转让所有权" });
    await expect(transferDialog.getByRole("checkbox")).toBeChecked();

    await transferDialog.getByRole("combobox", { name: "转让目标" }).click();
    await page.getByRole("option", { name: new RegExp(target.displayName) }).click();
    await expect(transferDialog.getByRole("button", { name: "确认转让" })).toBeEnabled();

    await transferDialog.getByRole("checkbox").uncheck();
    await expect(transferDialog.getByRole("checkbox")).not.toBeChecked();

    await transferDialog.getByRole("button", { name: "取消" }).click();
    await expect(transferDialog).toHaveCount(0);
  });

  test("owner removes a non-owner member", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-rm-o");
    const editor = createAcceptanceIdentity("members-rm-e");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);
    await registerAndVerify(page.context().request, editor);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await sendInvite(page, owner, workspaceName, editor.email, "编辑者");
    await acceptInviteAs(browser, editor, workspaceName, "编辑者");

    await page.reload();
    await openMembersTab(page, workspaceName);

    const memberDialog = page.getByRole("dialog", { name: workspaceName });
    const editorRow = memberDialog.locator("div.flex").filter({ hasText: editor.email });
    await editorRow.getByRole("button", { name: "" }).click();
    await page.getByRole("menuitem", { name: "移除成员" }).click();

    const confirmDialog = page.getByRole("dialog", { name: "确认移除成员" });
    await expect(confirmDialog.getByText(editor.displayName)).toBeVisible();
    await confirmDialog.getByRole("button", { name: "确认移除" }).click();
    await expect(confirmDialog).toHaveCount(0);
  });

  test("member leaves the workspace", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-leave-o");
    const member = createAcceptanceIdentity("members-leave-m");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);
    await registerAndVerify(page.context().request, member);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await sendInvite(page, owner, workspaceName, member.email, "编辑者");
    await acceptInviteAs(browser, member, workspaceName, "编辑者");

    const memberContext = await browser.newContext();
    try {
      const login = await requestEncryptedAuthApi(memberContext.request, {
        email: member.email,
        purpose: "login",
        secrets: { password: member.password },
      });
      expect(login.ok()).toBe(true);

      const memberPage = await memberContext.newPage();
      await Promise.all([waitForWorkspaceCatalog(memberPage), memberPage.goto("/")]);
      await currentWorkspaceButton(memberPage, workspaceName, "编辑者").click();
      await expect(memberPage.getByRole("dialog", { name: "工作区管理" })).toBeVisible();
      await openMembersTab(memberPage, workspaceName);

      await memberPage.getByRole("button", { name: "退出工作区" }).click();
      const leaveDialog = memberPage.getByRole("dialog", { name: "确认退出" });
      await expect(leaveDialog.getByText("退出后你将无法再访问此工作区")).toBeVisible();
      await leaveDialog.getByRole("button", { name: "确认退出" }).click();
      await expect(memberPage.getByRole("heading", { name: workspaceName })).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });

  test("last owner cannot leave or be removed without transferring", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-last-o");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await openMembersTab(page, workspaceName);

    await expect(page.getByText("最后一名所有者必须先转让所有权")).toBeVisible();
    await expect(page.getByRole("button", { name: /转让所有权/ })).toHaveCount(0);
  });

  test("removing an online member closes their collaboration connection and blocks access", async ({ browser, page }) => {
    const owner = createAcceptanceIdentity("members-cross-o");
    const editor = createAcceptanceIdentity("members-cross-e");
    const workspaceName = personalWorkspaceName(owner.displayName);

    await registerAndVerify(page.context().request, owner);
    await registerAndVerify(page.context().request, editor);

    await Promise.all([waitForWorkspaceCatalog(page), page.goto("/")]);
    await sendInvite(page, owner, workspaceName, editor.email, "编辑者");

    const editorContext = await browser.newContext();
    try {
      const editorLogin = await requestEncryptedAuthApi(editorContext.request, {
        email: editor.email,
        purpose: "login",
        secrets: { password: editor.password },
      });
      expect(editorLogin.ok()).toBe(true);

      const editorPage = await editorContext.newPage();
      await Promise.all([waitForWorkspaceCatalog(editorPage), editorPage.goto("/")]);
      await editorPage.getByRole("button", { name: "工作区邀请 1" }).click();
      const invitationCenter = editorPage.getByRole("dialog", { name: "工作区邀请" });
      await invitationCenter.getByRole("button", { name: "接受并进入" }).click();
      await expect(currentWorkspaceButton(editorPage, workspaceName, "编辑者")).toBeVisible();
      await expect(editorPage.getByText("协同已连接", { exact: true })).toBeVisible();

      await page.reload();
      await openMembersTab(page, workspaceName);

      const memberDialog = page.getByRole("dialog", { name: workspaceName });
      const editorRow = memberDialog.locator("div.flex").filter({ hasText: editor.email });
      await editorRow.getByRole("button", { name: "" }).click();
      await page.getByRole("menuitem", { name: "移除成员" }).click();
      const confirmDialog = page.getByRole("dialog", { name: "确认移除成员" });
      await confirmDialog.getByRole("button", { name: "确认移除" }).click();
      await expect(confirmDialog).toHaveCount(0);

      const blockedResponse = await editorContext.request.get(`/api/workspaces`);
      expect(blockedResponse.status()).toBe(200);
      const catalog = await blockedResponse.json() as { workspaces: Array<{ id: string }> };
      expect(catalog.workspaces.map((w) => w.id)).not.toContain(expect.stringContaining(workspaceName));
    } finally {
      await editorContext.close();
    }
  });
});

async function openMembersTab(page: Page, workspaceName: string) {
  const dialog = page.getByRole("dialog", { name: "工作区管理" });
  await dialog.getByRole("button", { name: `管理 ${workspaceName}` }).click();
  await dialog.getByRole("tab", { name: "成员" }).click();
}

async function sendInvite(
  page: Page,
  owner: ReturnType<typeof createAcceptanceIdentity>,
  workspaceName: string,
  email: string,
  role: "编辑者" | "访客",
) {
  await currentWorkspaceButton(page, workspaceName, "所有者").click();
  await expect(page.getByRole("dialog", { name: "工作区管理" })).toBeVisible();
  await openMembersTab(page, workspaceName);

  const memberDialog = page.getByRole("dialog", { name: workspaceName });
  await memberDialog.getByRole("tab", { name: "邀请" }).click();
  await memberDialog.getByLabel("成员邮箱").fill(email);
  await memberDialog.getByRole("combobox", { name: "邀请角色" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
  const createResponse = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST"
      && /\/api\/workspaces\/[^/]+\/invites$/.test(new URL(response.url()).pathname);
  });
  await memberDialog.getByRole("button", { name: "发送邀请" }).click();
  expect((await createResponse).status()).toBe(201);
  await page.keyboard.press("Escape");
}

async function acceptInviteAs(
  browser: Browser,
  identity: ReturnType<typeof createAcceptanceIdentity>,
  workspaceName: string,
  expectedRole: "编辑者" | "访客",
) {
  const context = await browser.newContext();
  try {
    const login = await requestEncryptedAuthApi(context.request, {
      email: identity.email,
      purpose: "login",
      secrets: { password: identity.password },
    });
    expect(login.ok()).toBe(true);

    const inviteUrl = await waitForCapturedInvite(identity.email);
    const memberPage = await context.newPage();
    await Promise.all([waitForWorkspaceCatalog(memberPage), memberPage.goto("/")]);
    await memberPage.getByRole("button", { name: "工作区邀请 1" }).click();
    const invitationCenter = memberPage.getByRole("dialog", { name: "工作区邀请" });
    await expect(invitationCenter.getByRole("heading", { name: workspaceName })).toBeVisible();
    await invitationCenter.getByRole("button", { name: "接受并进入" }).click();
    await expect(currentWorkspaceButton(memberPage, workspaceName, expectedRole)).toBeVisible();
  } finally {
    await context.close();
  }
}

function currentWorkspaceButton(page: Page, name: string, role: "所有者" | "编辑者" | "访客") {
  return page.getByRole("button", { name: `当前工作区 ${name}，${role}` });
}

function personalWorkspaceName(displayName: string) {
  return `${displayName}的工作区`;
}
