import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRichTextFromPlainText } from "@/shared/richText";
import { BlockRow } from "./BlockRow";
import { MentionSearchProvider } from "./MentionSearchContext";
import type { Block } from "../model/block";
import type { DatabaseWorkspaceMember } from "../session/sessionTypes";

const baseBlock: Block = {
  id: "block-1",
  type: "paragraph",
  headingLevel: 1,
  content: "",
  richText: createRichTextFromPlainText(""),
  parentId: null,
  children: [],
  checked: false,
  data: null,
  comments: [],
  assignee: "",
  dueDate: "",
  status: "unset",
  createdAt: 0,
  updatedAt: 0,
};

const workspaceMembers: DatabaseWorkspaceMember[] = [
  { id: "user-1", email: "alice@example.com", displayName: "Alice", role: "owner" },
];

describe("BlockRow mention menu", () => {
  it("forwards a structured update from a text block", async () => {
    const user = userEvent.setup();
    const onChangeRichText = vi.fn();

    render(
      <TooltipProvider>
        <MentionSearchProvider value={() => []}>
          <BlockRow
            block={baseBlock}
            canIndent={false}
            canOutdent={false}
            collaborationDocument={null}
            depth={0}
            documentId="document-1"
            focusRequest={false}
            isFirst={true}
            isLast={true}
            isReadOnly={false}
            onAddAfter={vi.fn()}
            onAddBlockComment={vi.fn()}
            onChangeBlockAssignee={vi.fn()}
            onChangeBlockDueDate={vi.fn()}
            onChangeBlockStatus={vi.fn()}
            onChangeBlockData={vi.fn()}
            onChangeContent={vi.fn()}
            onChangeRichText={onChangeRichText}
            onChangeType={vi.fn()}
            onDelete={vi.fn()}
            onFocused={vi.fn()}
            onIndent={vi.fn()}
            onMove={vi.fn()}
            onOutdent={vi.fn()}
            onResolveBlockComment={vi.fn()}
            onToggleTodo={vi.fn()}
            sessionUser={{ id: "me", email: "me@example.com", displayName: "Me" }}
            showBlockActions
            workspaceId="ws-1"
          />
        </MentionSearchProvider>
      </TooltipProvider>,
    );

    const editor = screen.getByTestId("block-editor-block-1");
    await user.click(editor);
    await user.type(editor, "Rich update");

    await waitFor(() => expect(onChangeRichText).toHaveBeenLastCalledWith("block-1", {
      content: "Rich update",
      richText: createRichTextFromPlainText("Rich update"),
    }));
  });

  it("opens the mention popover when @ is pressed in the editor", () => {
    const mentionSearch = (query: string) => {
      if (query.toLowerCase().includes("ali")) {
        return [{ id: "user-1", kind: "person" as const, label: "Alice", subtext: "alice@example.com" }];
      }
      return [];
    };

    render(
      <TooltipProvider>
        <MentionSearchProvider value={mentionSearch}>
          <BlockRow
            block={baseBlock}
            canIndent={false}
            canOutdent={false}
            collaborationDocument={null}
            depth={0}
            documentId="document-1"
            focusRequest={false}
            isFirst={true}
            isLast={true}
            isReadOnly={false}
            onAddAfter={vi.fn()}
            onAddBlockComment={vi.fn()}
            onChangeBlockAssignee={vi.fn()}
            onChangeBlockDueDate={vi.fn()}
            onChangeBlockStatus={vi.fn()}
            onChangeBlockData={vi.fn()}
            onChangeContent={vi.fn()}
            onChangeRichText={vi.fn()}
            onChangeType={vi.fn()}
            onDelete={vi.fn()}
            onFocused={vi.fn()}
            onIndent={vi.fn()}
            onMove={vi.fn()}
            onOutdent={vi.fn()}
            onResolveBlockComment={vi.fn()}
            onToggleTodo={vi.fn()}
            sessionUser={{ id: "me", email: "me@example.com", displayName: "Me" }}
            showBlockActions
            workspaceId="ws-1"
          />
        </MentionSearchProvider>
      </TooltipProvider>,
    );

    const editor = screen.getByTestId("block-editor-block-1");
    fireEvent.keyDown(editor, { key: "@" });

    expect(screen.getByRole("listbox", { name: /提及/i })).toBeDefined();
  });
});
