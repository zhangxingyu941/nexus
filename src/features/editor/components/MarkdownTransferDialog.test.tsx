import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownTransferDialog } from "./MarkdownTransferDialog";

describe("MarkdownTransferDialog", () => {
  it("previews a valid local Markdown file before importing", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(
      <MarkdownTransferDialog
        onImported={onImported}
        onOpenChange={vi.fn()}
        open
        target="local"
        workspaceId="workspace-1"
      />,
    );
    const file = new File(["# Imported\n\nBody"], "import.md", { type: "text/markdown" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("# Imported\n\nBody").buffer,
    });

    await user.upload(screen.getByLabelText("Select Markdown file"), file);

    expect(await screen.findByText("Imported")).toBeVisible();
    expect(screen.getByText("1 blocks")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import as new document" }));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ title: "Imported" }));
  });

  it("disables import after parser errors", async () => {
    const user = userEvent.setup();
    render(
      <MarkdownTransferDialog
        onImported={vi.fn()}
        onOpenChange={vi.fn()}
        open
        target="local"
        workspaceId="workspace-1"
      />,
    );
    const file = new File(["<div>bad</div>"], "import.md", { type: "text/markdown" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("<div>bad</div>").buffer,
    });

    await user.upload(screen.getByLabelText("Select Markdown file"), file);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Import as new document" })).toBeDisabled();
  });
});
