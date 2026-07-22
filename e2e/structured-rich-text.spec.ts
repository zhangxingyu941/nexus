import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
  await page.goto("/");
});

test("persists formatting, safe links, and hard breaks after refresh", async ({ page }) => {
  const editor = page.getByLabel("块内容").first();

  await editor.click();
  await page.keyboard.type("Formatted note");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("next line");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await expect(page.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();

  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Link" }).click();
  const linkEditor = page.getByRole("form", { name: "Link editor" });
  await linkEditor.getByLabel("Link URL").fill("example.com/docs");
  await linkEditor.getByLabel("Link URL").press("Enter");

  await expect(editor.locator('a[href="https://example.com/docs"]')).toHaveText("Formatted note");
  await expect(editor).toContainText("Formatted note");
  await expect(editor).toContainText("next line");
  await expect(page.getByText("本地已保存", { exact: true })).toBeVisible();

  await page.reload();

  const reloadedEditor = page.getByLabel("块内容").first();
  await expect(reloadedEditor.locator("strong").filter({ hasText: "Formatted note" })).toHaveText("Formatted note");
  await expect(reloadedEditor.locator('a[href="https://example.com/docs"]')).toHaveText("Formatted note");
  await expect(reloadedEditor.locator("br")).toHaveCount(1);
  await expect(reloadedEditor).toContainText("next line");
});

test("keeps the selection toolbar and link editor within desktop and mobile viewports", async ({ page }, testInfo) => {
  const viewports = [
    { height: 1000, name: "desktop", width: 1440 },
    { height: 844, name: "mobile", width: 390 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    const editor = page.getByLabel("块内容").first();
    await editor.click();
    await page.keyboard.type("Responsive link");
    await page.keyboard.press("Control+A");

    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(toolbar).toBeVisible();
    const toolbarBox = await toolbar.boundingBox();
    await page.getByRole("button", { name: "Link" }).click();
    const linkEditor = page.getByRole("form", { name: "Link editor" });
    await expect(linkEditor).toBeVisible();
    await expect(toolbar).not.toBeVisible();

    const popoverBox = await linkEditor.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(popoverBox).not.toBeNull();
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(0);
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`structured-rich-text-${viewport.name}.png`),
    });
    await page.keyboard.press("Escape");
  }
});
