import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkPopover } from "./LinkPopover";

describe("LinkPopover", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("keeps invalid URLs open with a field error", () => {
    const onSubmit = vi.fn();
    render(
      <LinkPopover
        anchor={{ left: 120, top: 80 }}
        initialHref=""
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(screen.getByLabelText("Link URL"), { key: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid link");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clamps its centered position inside the viewport", () => {
    render(
      <LinkPopover
        anchor={{ left: 120, top: 80 }}
        initialHref=""
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("form", { name: "Link editor" })).toHaveStyle({
      left: "clamp(172px, 120px, calc(100vw - 172px))",
      top: "clamp(12px, 88px, calc(100vh - 164px))",
    });
  });

  it("submits an empty value to remove the current link and closes on escape", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <LinkPopover
        anchor={{ left: 120, top: 80 }}
        initialHref="https://example.com"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByLabelText("Link URL"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("");
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Link URL"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers existing-link open, copy, and remove actions", async () => {
    const onSubmit = vi.fn();
    render(
      <LinkPopover
        anchor={{ left: 120, top: 80 }}
        initialHref="https://example.com"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute("rel", "noreferrer");
    fireEvent.click(screen.getByLabelText("Copy link"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com");

    fireEvent.click(screen.getByLabelText("Remove link"));
    expect(onSubmit).toHaveBeenCalledWith("");
  });
});
