import { render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBlock } from "../model/documentOperations";
import { BlockList } from "./BlockList";

const noop = () => undefined;
const largeBlocks = Array.from({ length: 200 }, (_, index) => ({
  ...createBlock("todo", index + 1, `任务 ${index + 1}`, `block-${index + 1}`),
}));

function LargeBlockList({ focusBlockId = null }: { focusBlockId?: string | null }) {
  const scrollElementRef = useRef<HTMLDivElement>(null);

  return (
    <TooltipProvider>
      <div ref={scrollElementRef} style={{ height: 600, overflow: "auto" }}>
        <BlockList
        blocks={largeBlocks}
        collaborationDocument={null}
        documentId="document-1"
        focusBlockId={focusBlockId}
        isReadOnly={false}
        onAddAfter={noop}
        onAddBlockComment={noop}
        onChangeBlockAssignee={noop}
        onChangeBlockData={noop}
        onChangeBlockDueDate={noop}
        onChangeBlockStatus={noop}
        onChangeContent={noop}
        onChangeType={noop}
        onDelete={noop}
        onFocusedBlock={noop}
        onIndent={noop}
        onMove={noop}
        onOutdent={noop}
        onResolveBlockComment={noop}
        onToggleTodo={noop}
        scrollElementRef={scrollElementRef}
        sessionUser={null}
        showBlockActions
        workspaceId="workspace-a"
        />
      </div>
    </TooltipProvider>
  );
}

describe("BlockList large document rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("mounts only the visible window for a 200 block document", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.style.overflow === "auto" ? 600 : 48;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1024);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.style.overflow === "auto" ? 600 : 48;
      return {
        bottom: height,
        height,
        left: 0,
        right: 1024,
        top: 0,
        width: 1024,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    render(<LargeBlockList />);

    await waitFor(() => expect(screen.queryAllByTestId(/^block-row-/).length).toBeGreaterThan(0));
    const renderedRows = screen.getAllByTestId(/^block-row-/);
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(80);
  });

  it("scrolls an offscreen focus request into the virtual window", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.style.overflow === "auto" ? 600 : 48;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1024);
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    const { rerender } = render(<LargeBlockList />);
    scrollTo.mockClear();

    rerender(<LargeBlockList focusBlockId="block-200" />);

    await waitFor(() => {
      const targetOffsets = scrollTo.mock.calls.map(([options]) => Number(options?.top ?? 0));
      expect(Math.max(...targetOffsets, 0)).toBeGreaterThan(5000);
    });
  });
});
