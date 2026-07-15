import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

describe("Nexus brand mark", () => {
  it("provides one geometric SVG logo that stays crisp at favicon sizes", () => {
    const logoPath = join(projectRoot, "public", "nexus-logo.svg");
    expect(existsSync(logoPath)).toBe(true);

    const svg = existsSync(logoPath) ? readFileSync(logoPath, "utf8") : "";
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#18181b"');
    expect(svg).toContain('fill="#fafafa"');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    const pathData = svg.match(/<path d="([^"]+)"/)?.[1] ?? "";
    expect(pathData).toMatch(/^M.+Z$/);
  });

  it("uses the shared logo on every brand surface and in page metadata", () => {
    const layout = readProjectFile("src/app/layout.tsx");
    const brandSources = [
      readProjectFile("src/app/AuthScreen.tsx"),
      readProjectFile("src/app/EditorApp.tsx"),
      readProjectFile("src/features/editor/components/WorkspaceSidebar.tsx"),
    ].join("\n");

    expect(layout).toContain('icon: "/nexus-logo.svg"');
    expect(brandSources.match(/<BrandMark\b/g) ?? []).toHaveLength(5);
  });
});
