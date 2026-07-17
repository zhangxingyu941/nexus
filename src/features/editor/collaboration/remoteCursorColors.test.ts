import { describe, expect, it } from "vitest";

import { CURSOR_COLORS, getCursorColor, getCursorColorName } from "./remoteCursorColors";

describe("remoteCursorColors", () => {
  it("returns a hex color string starting with '#'", () => {
    const color = getCursorColor("user-123");
    expect(color).toMatch(/^#/);
    expect(color).toHaveLength(7);
  });

  it("returns a color from the CURSOR_COLORS array", () => {
    const color = getCursorColor("user-123");
    expect(CURSOR_COLORS).toContain(color);
  });

  it("is deterministic for the same userId", () => {
    expect(getCursorColor("user-123")).toBe(getCursorColor("user-123"));
    expect(getCursorColor("alice")).toBe(getCursorColor("alice"));
  });

  it("different userIds can return different colors", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(getCursorColor(`user-${i}`));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("getCursorColorName returns a non-empty string", () => {
    const name = getCursorColorName("user-123");
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("all cursor colors have corresponding color names", () => {
    CURSOR_COLORS.forEach((color) => {
      const matchingName = getCursorColorName(
        CURSOR_COLORS.indexOf(color).toString(),
      );
      expect(matchingName).toBeTruthy();
    });
  });
});
