import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useSortable } from "@dnd-kit/sortable";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../model/block";
import { BlockDndContext } from "./BlockDndContext";

const blocks: Block[] = [
  {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content: "First block",
    createdAt: 0,
    data: null,
    dueDate: "",
    headingLevel: 1,
    id: "block-a",
    parentId: null,
    richText: null,
    status: "unset",
    type: "paragraph",
    updatedAt: 0,
  },
  {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content: "Target block",
    createdAt: 0,
    data: null,
    dueDate: "",
    headingLevel: 1,
    id: "block-b",
    parentId: null,
    richText: null,
    status: "unset",
    type: "paragraph",
    updatedAt: 0,
  },
];

function SortableProbe({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef } = useSortable({ id });
  return (
    <button data-testid={`drag-${id}`} ref={setNodeRef} type="button" {...attributes} {...listeners}>
      {id}
    </button>
  );
}

describe("BlockDndContext", () => {
  it("moves selected roots as one keyboard drag transaction", async () => {
    const onDrop = vi.fn();
    const { getByTestId } = render(
      <BlockDndContext blocks={blocks} onDrop={onDrop} selectedRootIds={["block-a"]}>
        <SortableProbe id="block-a" />
        <SortableProbe id="block-b" />
      </BlockDndContext>,
    );

    const source = getByTestId("drag-block-a");
    const target = getByTestId("drag-block-b");
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 40));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 48, 100, 40));

    source.focus();
    act(() => {
      fireEvent.keyDown(source, { code: "Space", key: " " });
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => {
      fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => {
      fireEvent.keyDown(document, { code: "Space", key: " " });
    });

    await waitFor(() => expect(onDrop).toHaveBeenCalledWith(["block-a"], "block-b", "after"));
  });
});
