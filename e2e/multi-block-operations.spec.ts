import { expect, test, type Locator, type Page } from "@playwright/test";

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
});

async function addBlocks(page: Page, count: number) {
  const rows = page.locator('[data-testid^="block-row-"]');
  for (let index = 0; index < count; index += 1) {
    const lastRow = rows.nth((await rows.count()) - 1);
    await lastRow.getByRole("button", { name: "在下方添加块" }).click();
  }
  return rows;
}

async function setBlockContent(page: Page, row: Locator, content: string) {
  await row.getByTestId(/^block-editor-/).click();
  await page.keyboard.type(content);
  await expect(row).toContainText(content);
}

test("selects, formats, drags, and pastes blocks across desktop and mobile viewports", async ({ page }, testInfo) => {
  const viewports = [
    { height: 1000, name: "desktop", width: 1440 },
    { height: 844, name: "mobile", width: 390 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    const rows = await addBlocks(page, 2);
    await setBlockContent(page, rows.nth(0), "First selected block");
    await setBlockContent(page, rows.nth(1), "Second selected block");
    await setBlockContent(page, rows.nth(2), "Drop target block");

    await rows.nth(0).getByRole("button", { name: /^选择块 / }).click();
    await rows.nth(1).getByRole("button", { name: /^选择块 / }).click({ modifiers: ["Control"] });
    const toolbar = page.getByRole("toolbar", { name: "批量块操作" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "加粗所选块" }).click();
    await expect(rows.nth(0).locator("strong")).toContainText("First selected block");
    await expect(rows.nth(1).locator("strong")).toContainText("Second selected block");

    await rows.nth(0).getByRole("button", { name: /^选择块 / }).click();
    await rows.nth(0).getByRole("button", { name: "拖动块" }).dragTo(rows.nth(2), { force: true });
    await expect(rows.nth(2)).toContainText("First selected block");

    await rows.nth(2).getByRole("button", { name: /^选择块 / }).click();
    await page.evaluate(() => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "Pasted multi-block text");
      document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(3)).toContainText("Pasted multi-block text");

    await rows.nth(0).getByRole("button", { name: /^选择块 / }).click();
    await expect(toolbar).toBeVisible();
    const bounds = await toolbar.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`multi-block-operations-${viewport.name}.png`),
    });
  }
});
