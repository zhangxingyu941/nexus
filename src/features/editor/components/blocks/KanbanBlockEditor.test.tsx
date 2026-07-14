import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KanbanBlockData } from "../../model/block";
import { KanbanBlockEditor } from "./KanbanBlockEditor";

const data: KanbanBlockData = {
  kind: "kanban",
  columns: [
    { id: "todo", title: "待处理", cards: [{ id: "card-1", title: "确认范围" }] },
    { id: "done", title: "已完成", cards: [] },
  ],
};

describe("KanbanBlockEditor", () => {
  it("adds cards and moves them between columns", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<KanbanBlockEditor data={data} isReadOnly={false} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "在待处理中添加卡片" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      columns: [expect.objectContaining({ cards: [data.columns[0].cards[0], expect.objectContaining({ title: "新卡片" })] }), data.columns[1]],
    }));

    rerender(<KanbanBlockEditor data={data} isReadOnly={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "向右移动 确认范围" }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "kanban",
      columns: [
        { ...data.columns[0], cards: [] },
        { ...data.columns[1], cards: [data.columns[0].cards[0]] },
      ],
    });
  });

  it("renders cards without controls for viewers", () => {
    render(<KanbanBlockEditor data={data} isReadOnly onChange={() => undefined} />);

    expect(screen.getByText("确认范围")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "向右移动 确认范围" })).not.toBeInTheDocument();
  });
});
