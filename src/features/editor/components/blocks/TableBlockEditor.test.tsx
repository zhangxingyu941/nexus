import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TableBlockData } from "../../model/block";
import { TableBlockEditor } from "./TableBlockEditor";

const data: TableBlockData = {
  kind: "table",
  columns: [
    { id: "name", name: "名称" },
    { id: "owner", name: "负责人" },
  ],
  rows: [{ id: "row-1", cells: { name: "路线图", owner: "林夏" } }],
};

describe("TableBlockEditor", () => {
  it("edits cells and adds rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TableBlockEditor data={data} isReadOnly={false} onChange={onChange} />);

    const nameCell = screen.getByLabelText("单元格 路线图 名称");
    await user.clear(nameCell);
    await user.type(nameCell, "产品路线图");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({ cells: expect.objectContaining({ name: "产品路线图" }) })],
    }));

    const editedData = onChange.mock.lastCall?.[0] as TableBlockData;
    rerender(<TableBlockEditor data={editedData} isReadOnly={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "添加行" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      rows: [editedData.rows[0], expect.objectContaining({ cells: { name: "", owner: "" } })],
    }));
  });

  it("renders a read-only table without editing controls", () => {
    render(<TableBlockEditor data={data} isReadOnly onChange={() => undefined} />);

    expect(screen.getByRole("table", { name: "表格块" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加行" })).not.toBeInTheDocument();
    expect(screen.getByText("路线图")).toBeInTheDocument();
  });
});
