import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function getCssRule(css: string, selector: string) {
  const matchedBodies: string[] = [];
  const rules = css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^}]*)\}/g);

  for (const rule of rules) {
    const selectorText = rule.groups?.selectors.replace(/\/\*[\s\S]*?\*\//g, "") ?? "";
    const selectors = selectorText.split(",").map((item) => item.trim());

    if (selectors.includes(selector)) {
      matchedBodies.push(rule.groups?.body ?? "");
    }
  }

  return matchedBodies.join("\n");
}

function getFirstCssRule(css: string, selector: string) {
  const rules = css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^}]*)\}/g);

  for (const rule of rules) {
    const selectorText = rule.groups?.selectors.replace(/\/\*[\s\S]*?\*\//g, "") ?? "";
    const selectors = selectorText.split(",").map((item) => item.trim());

    if (selectors.includes(selector)) {
      return rule.groups?.body ?? "";
    }
  }

  return "";
}

describe("global layering styles", () => {
  it("uses the shadcn border token as the default border color", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const universalRule = getCssRule(css, "*");

    expect(universalRule).toMatch(/border-color:\s*var\(--border\)/);
  });

  it("keeps the desktop sidebar below modal overlays", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const workspaceSidebarRule = getCssRule(css, ".workspace-sidebar");

    expect(workspaceSidebarRule).toMatch(/z-index:\s*10\b/);
  });

  it("keeps task center list scrolling inside the dialog", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const taskCenterDialogRule = getCssRule(css, ".task-center-dialog");
    const taskCenterListRule = getCssRule(css, ".task-center-list");

    expect(taskCenterDialogRule).toMatch(/display:\s*grid\b/);
    expect(taskCenterDialogRule).toMatch(/grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/);
    expect(taskCenterDialogRule).toMatch(/overflow:\s*hidden\b/);
    expect(taskCenterListRule).toMatch(/min-height:\s*0\b/);
    expect(taskCenterListRule).toMatch(/max-height:\s*none\b/);
  });

  it("keeps workspace dialogs constrained to the viewport with internal scrolling", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const quickDialogRule = getCssRule(css, ".quick-search-dialog");
    const quickResultsRule = getCssRule(css, ".quick-search-results");
    const activityDialogRule = getCssRule(css, ".activity-dialog");
    const activityListRule = getCssRule(css, ".activity-list");

    expect(quickDialogRule).toMatch(/z-index:\s*130\b/);
    expect(quickDialogRule).toMatch(/display:\s*grid\b/);
    expect(quickDialogRule).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
    expect(quickDialogRule).toMatch(/overflow:\s*hidden\b/);
    expect(quickResultsRule).toMatch(/min-height:\s*0\b/);
    expect(quickResultsRule).toMatch(/max-height:\s*none\b/);

    expect(activityDialogRule).toMatch(/z-index:\s*130\b/);
    expect(activityDialogRule).toMatch(/display:\s*grid\b/);
    expect(activityDialogRule).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
    expect(activityDialogRule).toMatch(/overflow:\s*hidden\b/);
    expect(activityListRule).toMatch(/min-height:\s*0\b/);
    expect(activityListRule).toMatch(/max-height:\s*none\b/);
  });

  it("keeps the desktop document context panel closed until it is explicitly opened", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const contextPanelRule = getFirstCssRule(css, ".document-context-panel");
    const openPanelRule = getCssRule(css, ".document-context-panel-open");

    expect(contextPanelRule).toMatch(/position:\s*fixed\b/);
    expect(contextPanelRule).toMatch(/opacity:\s*0\b/);
    expect(contextPanelRule).toMatch(/pointer-events:\s*none\b/);
    expect(openPanelRule).toMatch(/opacity:\s*1\b/);
    expect(openPanelRule).toMatch(/pointer-events:\s*auto\b/);
  });

  it("uses an above-block action bar without reserving a right-side editor column", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const editorShellRule = getFirstCssRule(css, ".block-editor-shell");
    const actionBarRule = getFirstCssRule(css, ".block-action-bar");

    expect(editorShellRule).toMatch(/display:\s*grid\b/);
    expect(editorShellRule).not.toMatch(/padding-right:\s*116px\b/);
    expect(actionBarRule).toMatch(/grid-row:\s*1\b/);
    expect(actionBarRule).toMatch(/position:\s*relative\b/);
  });

  it("uses the blue focus semantic for native controls", () => {
    const css = readFileSync(join(currentDir, "styles.css"), "utf8");
    const focusRule = getCssRule(css, "button:focus-visible");

    expect(focusRule).toMatch(/rgba\(37,\s*99,\s*235,/);
  });
});
