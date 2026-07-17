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

test("selects H2 from Slash and continues typing without another click", async ({ page }) => {
  const editor = page.getByLabel("块内容").first();

  await editor.fill("");
  await editor.press("/");
  await page.getByRole("option", { name: /H2/ }).click();
  await page.keyboard.type("Roadmap");

  await expect(page.locator('[data-heading-level="2"]')).toContainText("Roadmap");
});

test("directly edits Todo, persists H6, and opens the shortcut center", async ({ page }) => {
  const editor = page.getByLabel("块内容").first();

  await editor.press("/");
  await page.getByRole("option", { name: /Todo/ }).click();
  const todoEditor = page.getByLabel("待办内容");
  await expect(todoEditor).toHaveAttribute("contenteditable", "true");
  await page.keyboard.type("发布前检查");
  await expect(todoEditor).toContainText("发布前检查");

  await todoEditor.press("/");
  await page.getByRole("option", { name: /H6/ }).click();
  await page.keyboard.type("Release notes");
  await expect(page.getByText("本地已保存", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-heading-level="6"]')).toContainText("Release notes");

  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "快捷键" })).toBeVisible();
  await expect(page.getByText("上移当前块")).toBeVisible();
});

test("keeps the active block and Slash popover within responsive viewports", async ({ page }, testInfo) => {
  const viewports = [
    { height: 1000, name: "desktop", width: 1440 },
    { height: 768, name: "tablet", width: 1024 },
    { height: 844, name: "mobile", width: 390 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    const editor = page.getByLabel("块内容").first();
    await editor.click();
    await editor.press("/");

    await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
    expect(await editor.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
    expect(await editor.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`contextual-editor-${viewport.name}.png`),
    });
    await page.keyboard.press("Escape");
  }
});
