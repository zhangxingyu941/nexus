import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBlock } from "../model/documentOperations";
import { useBlockSelection } from "./useBlockSelection";

describe("useBlockSelection", () => {
  it("resolves range selections and clears them on demand", () => {
    const blocks = [
      createBlock("paragraph", 1, "A", "a"),
      createBlock("paragraph", 2, "B", "b"),
      createBlock("paragraph", 3, "C", "c"),
    ];
    const { result } = renderHook(() => useBlockSelection(blocks));

    act(() => result.current.select("a", "replace"));
    act(() => result.current.select("c", "range"));

    expect(result.current.resolved.orderedBlockIds).toEqual(["a", "b", "c"]);
    expect(result.current.resolved.rootBlockIds).toEqual(["a", "b", "c"]);

    act(() => result.current.clear());
    expect(result.current.state.selectedBlockIds).toEqual([]);
  });

  it("prunes a remote-deleted block from the current selection", () => {
    const blocks = [
      createBlock("paragraph", 1, "A", "a"),
      createBlock("paragraph", 2, "B", "b"),
    ];
    const { result, rerender } = renderHook(({ currentBlocks }) => useBlockSelection(currentBlocks), {
      initialProps: { currentBlocks: blocks },
    });

    act(() => result.current.select("a", "replace"));
    act(() => result.current.select("b", "toggle"));
    rerender({ currentBlocks: [blocks[1]] });

    expect(result.current.state).toEqual({ anchorBlockId: "b", selectedBlockIds: ["b"] });
  });
});
