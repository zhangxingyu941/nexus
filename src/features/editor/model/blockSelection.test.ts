import { describe, expect, it } from "vitest";
import type { Block } from "./block";
import {
  EMPTY_BLOCK_SELECTION,
  pruneBlockSelection,
  resolveBlockSelection,
  selectBlock,
} from "./blockSelection";

function block(
  id: string,
  options: Pick<Partial<Block>, "parentId" | "children"> = {},
): Block {
  return {
    id,
    type: "paragraph",
    headingLevel: 1,
    content: "",
    richText: null,
    data: null,
    checked: false,
    comments: [],
    assignee: "",
    dueDate: "",
    status: "unset",
    parentId: null,
    children: [],
    createdAt: 0,
    updatedAt: 0,
    ...options,
  };
}

describe("block selection", () => {
  it("expands selected parents in document order and removes descendant roots", () => {
    const blocks = [
      block("parent", { children: ["child"] }),
      block("child", { parentId: "parent", children: ["grandchild"] }),
      block("grandchild", { parentId: "child" }),
      block("sibling"),
    ];

    expect(
      resolveBlockSelection(blocks, {
        anchorBlockId: "parent",
        selectedBlockIds: ["parent", "child", "sibling"],
      }),
    ).toEqual({
      orderedBlockIds: ["parent", "child", "grandchild", "sibling"],
      rootBlockIds: ["parent", "sibling"],
    });
  });

  it("selects the inclusive visible range from the anchor", () => {
    expect(
      selectBlock(
        { anchorBlockId: "a", selectedBlockIds: ["a"] },
        "c",
        "range",
        ["a", "b", "c"],
      ),
    ).toEqual({ anchorBlockId: "a", selectedBlockIds: ["a", "b", "c"] });
  });

  it("toggles blocks and maintains the updated anchor", () => {
    const added = selectBlock(EMPTY_BLOCK_SELECTION, "a", "toggle", ["a", "b"]);
    const expanded = selectBlock(added, "b", "toggle", ["a", "b"]);
    const reduced = selectBlock(expanded, "b", "toggle", ["a", "b"]);

    expect(added).toEqual({ anchorBlockId: "a", selectedBlockIds: ["a"] });
    expect(expanded).toEqual({ anchorBlockId: "b", selectedBlockIds: ["a", "b"] });
    expect(reduced).toEqual({ anchorBlockId: "b", selectedBlockIds: ["a"] });
    expect(selectBlock(reduced, "a", "toggle", ["a", "b"])).toEqual(EMPTY_BLOCK_SELECTION);
  });

  it("prunes ids removed from the current visible document", () => {
    expect(
      pruneBlockSelection(
        { anchorBlockId: "b", selectedBlockIds: ["a", "b", "a"] },
        ["a"],
      ),
    ).toEqual({ anchorBlockId: null, selectedBlockIds: ["a"] });
  });

  it("does not loop for child cycles or missing child ids", () => {
    const blocks = [
      block("a", { children: ["b", "missing"] }),
      block("b", { parentId: "a", children: ["a"] }),
    ];

    expect(
      resolveBlockSelection(blocks, {
        anchorBlockId: "a",
        selectedBlockIds: ["a"],
      }),
    ).toEqual({
      orderedBlockIds: ["a", "b"],
      rootBlockIds: ["a"],
    });
  });
});
