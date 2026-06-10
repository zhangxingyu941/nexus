import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { clearDocument } from "../persistence/editorRepository";
import { EditorPage } from "./EditorPage";

async function renderEditor() {
  render(<EditorPage />);
  await screen.findByRole("heading", { name: "Untitled" });
}

async function getRows() {
  return screen.findAllByTestId(/^block-row-/);
}

describe("EditorPage", () => {
  beforeEach(async () => {
    await clearDocument();
  });

  it("renders a default editable document", async () => {
    await renderEditor();

    expect(screen.getByRole("heading", { name: "Untitled" })).toBeInTheDocument();
    expect(await getRows()).toHaveLength(1);
    expect(screen.getByLabelText("Block type")).toHaveValue("paragraph");
  });

  it("edits paragraph block content", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const editor = screen.getByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("Project notes");

    await waitFor(() => expect(editor).toHaveTextContent("Project notes"));
  });

  it("adds and deletes blocks while preserving one block", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByLabelText("Add block after"));
    expect(await getRows()).toHaveLength(2);

    const rowsAfterAdd = await getRows();
    await user.click(within(rowsAfterAdd[1]).getByLabelText("Delete block"));
    expect(await getRows()).toHaveLength(1);

    const remainingRow = (await getRows())[0];
    await user.click(within(remainingRow).getByLabelText("Delete block"));
    expect(await getRows()).toHaveLength(1);
  });

  it("changes a block to todo and toggles it", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.selectOptions(screen.getByLabelText("Block type"), "todo");
    const checkbox = await screen.findByRole("checkbox", { name: "Todo complete" });

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("moves blocks up and down", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByLabelText("Add block after"));
    const originalRows = await getRows();
    const firstId = originalRows[0].getAttribute("data-testid");
    const secondId = originalRows[1].getAttribute("data-testid");

    await user.click(within(originalRows[1]).getByLabelText("Move block up"));
    const movedUpRows = await getRows();
    expect(movedUpRows[0]).toHaveAttribute("data-testid", secondId);
    expect(movedUpRows[1]).toHaveAttribute("data-testid", firstId);

    await user.click(within(movedUpRows[0]).getByLabelText("Move block down"));
    const movedDownRows = await getRows();
    expect(movedDownRows[0]).toHaveAttribute("data-testid", firstId);
    expect(movedDownRows[1]).toHaveAttribute("data-testid", secondId);
  });
});
