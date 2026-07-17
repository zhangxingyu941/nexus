import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorShortcutCenter } from "./EditorShortcutCenter";

describe("EditorShortcutCenter", () => {
  it("groups fixed shortcuts without exposing customization", () => {
    render(<EditorShortcutCenter isOpen onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "快捷键" })).toBeVisible();
    expect(screen.getByText("块操作")).toBeVisible();
    expect(screen.getByText("上移当前块")).toBeVisible();
    expect(screen.queryByRole("button", { name: /自定义/ })).not.toBeInTheDocument();
  });
});
