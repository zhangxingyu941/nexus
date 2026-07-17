# Contextual Editor Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first usable slice of the approved contextual editor: H1-H6, one command registry, a categorized caret-adjacent Slash popover, direct Todo editing, continuous focus, Nexus Focus Rail, and a fixed shortcut reference.

**Architecture:** Keep `Block` as the persisted block boundary and add only `headingLevel` in this phase. A single command catalog drives Slash results, type conversion labels, Markdown mappings, and shortcut labels. `RichTextBlockEditor` remains the TipTap/Yjs owner; `BlockRow` owns transient UI state such as the active command popover and focus handoff. The Yjs fragment remains the only collaborative text source after its one-time seed.

**Tech Stack:** React 18, TypeScript, TipTap 2.27.2, Yjs 13, lucide-react, Vitest, Testing Library, existing CSS/Tailwind primitives.

**Scope boundary:** Mention atoms, persisted TipTap JSON, BubbleMenu formatting, and remote caret rendering are separate follow-up plans. This phase creates the command/focus interfaces they will reuse without adding placeholder UI.

---

### Task 1: Persist Heading Levels And Centralize Editor Commands

**Files:**
- Create: `src/features/editor/commands/editorCommands.ts`
- Create: `src/features/editor/commands/editorCommands.test.ts`
- Modify: `src/features/editor/model/block.ts`
- Modify: `src/features/editor/model/documentBlockOperations.ts`
- Modify: `src/features/editor/model/documentOperations.test.ts`
- Modify: `src/features/editor/model/workspaceNormalization.ts`
- Modify: `src/features/editor/model/workspaceOperations.test.ts`
- Modify: `src/server/database/migrations.ts`
- Modify: `src/server/postgresWorkspaceStore.ts`
- Modify: `src/server/postgresWorkspaceStore.test.ts`
- Modify: `src/features/editor/collaboration/useDocumentCollaboration.ts`
- Modify: `src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- Modify: `src/features/editor/components/blocks/blockMenuOptions.ts`
- Modify: `src/features/editor/components/markdownShortcuts.ts`
- Modify: `src/features/editor/components/markdownShortcuts.test.ts`

- [x] **Step 1: Write failing model and catalog tests**

Add tests proving that new blocks default to H1 when they become headings, stored H4 blocks normalize as H4, invalid levels normalize to H1, and command IDs are unique and grouped.

```ts
it("persists a requested heading level", () => {
  const changed = changeBlockType(document, blockId, "heading", 2000, 4);
  expect(changed.blocks[0]).toMatchObject({ type: "heading", headingLevel: 4 });
});

it("normalizes invalid heading levels to H1", () => {
  const workspace = normalizeWorkspace(createStoredWorkspace({ type: "heading", headingLevel: 9 }));
  expect(workspace.documents[0].blocks[0].headingLevel).toBe(1);
});

it("defines unique categorized command IDs", () => {
  expect(new Set(EDITOR_COMMANDS.map((command) => command.id)).size).toBe(EDITOR_COMMANDS.length);
  expect(getEditorCommand("heading-6")).toMatchObject({ label: "H6", headingLevel: 6 });
});
```

- [x] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm test --run src/features/editor/commands/editorCommands.test.ts src/features/editor/model/documentOperations.test.ts src/features/editor/model/workspaceOperations.test.ts src/features/editor/components/markdownShortcuts.test.ts
```

Expected: FAIL because `HeadingLevel`, `headingLevel`, and `EDITOR_COMMANDS` do not exist.

- [x] **Step 3: Add the exact heading-level model**

In `block.ts` add:

```ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Block {
  // existing fields
  headingLevel: HeadingLevel;
}
```

Set `headingLevel: 1` in `createBlock`. Extend `changeBlockType` without changing existing callers:

```ts
export function changeBlockType(
  document: EditorDocument,
  blockId: string,
  type: BlockType,
  now = Date.now(),
  headingLevel: HeadingLevel = 1,
): EditorDocument {
  // existing map
  return {
    ...block,
    type,
    headingLevel: type === "heading" ? headingLevel : block.headingLevel,
    // existing fields
  };
}
```

Normalize only valid integer levels:

```ts
function normalizeHeadingLevel(value: unknown): HeadingLevel {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : 1;
}
```

Persist `headingLevel` through a new idempotent PostgreSQL migration that adds `editor_blocks.heading_level INTEGER NOT NULL DEFAULT 1 CHECK (heading_level BETWEEN 1 AND 6)`. Read and write that exact column in `PostgresWorkspaceStore`. Include `headingLevel` in collaboration structure equality so an H1-to-H4-only change publishes a new structure record.

- [x] **Step 4: Create the single command catalog**

Define these public contracts in `editorCommands.ts`:

```ts
export type EditorCommandCategory = "text" | "list" | "media" | "data";

export interface EditorCommandDefinition {
  aliases: string[];
  category: EditorCommandCategory;
  description: string;
  headingLevel?: HeadingLevel;
  icon: LucideIcon;
  id: string;
  label: string;
  markdown?: string;
  type: BlockType;
}

export const EDITOR_COMMANDS: EditorCommandDefinition[] = [
  { id: "text", label: "Text", category: "text", type: "paragraph", icon: Type, aliases: ["paragraph", "正文", "段落"], description: "Plain text" },
  { id: "heading-1", label: "H1", category: "text", type: "heading", headingLevel: 1, markdown: "#", icon: Heading1, aliases: ["title", "一级标题"], description: "Large heading" },
  // Repeat explicitly for H2-H6 with matching level and markdown trigger.
  { id: "todo", label: "Todo", category: "list", type: "todo", icon: ListTodo, aliases: ["task", "待办"], description: "Track a task" },
  { id: "quote", label: "Quote", category: "text", type: "quote", icon: Quote, aliases: ["引用"], description: "Quoted text" },
  { id: "code", label: "Code", category: "data", type: "code", icon: Code2, aliases: ["代码"], description: "Code block" },
  { id: "image", label: "Image", category: "media", type: "image", icon: ImageIcon, aliases: ["图片"], description: "Upload an image" },
  { id: "file", label: "File", category: "media", type: "file", icon: FileText, aliases: ["文件"], description: "Attach a file" },
  { id: "table", label: "Table", category: "data", type: "table", icon: Table2, aliases: ["表格"], description: "Structured rows and columns" },
  { id: "board", label: "Board", category: "data", type: "kanban", icon: Columns3, aliases: ["kanban", "看板"], description: "Cards grouped by status" },
];
```

Export `getEditorCommand`, `getEditorCommandsByCategory`, and `searchEditorCommands`. Make `SLASH_COMMANDS` a compatibility export of this array during this task; delete duplicate labels/icons.

- [x] **Step 5: Drive Markdown resolution from the catalog**

Return a command selection rather than only `BlockType`:

```ts
export interface MarkdownCommandMatch {
  headingLevel?: HeadingLevel;
  type: BlockType;
}

export function resolveMarkdownShortcut(text: string): MarkdownCommandMatch | null {
  const command = EDITOR_COMMANDS.find((item) => item.markdown && `${item.markdown} ` === text);
  return command ? { type: command.type, headingLevel: command.headingLevel } : null;
}
```

Keep quote, Todo, and Code triggers in the same registry. Update call sites only after the new return shape is covered by tests.

- [x] **Step 6: Run focused tests and confirm GREEN**

Run the command from Step 2. Expected: all focused tests PASS.

---

### Task 2: Add A Caret-Anchored Categorized Slash Popover

**Files:**
- Create: `src/features/editor/components/commands/EditorCommandPopover.tsx`
- Create: `src/features/editor/components/commands/EditorCommandPopover.test.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.test.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/blocks/SlashMenu.tsx`
- Modify: `src/features/editor/components/EditorPage.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing popover behavior tests**

Cover these behaviors:

```ts
it("groups short command labels and exposes listbox semantics", () => {
  render(<EditorCommandPopover anchor={{ left: 80, top: 120 }} activeIndex={0} commands={EDITOR_COMMANDS} onSelect={vi.fn()} />);
  expect(screen.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  expect(screen.getByRole("option", { name: /H6/ })).toBeVisible();
  expect(screen.getByText("Media")).toBeVisible();
});

it("preserves editor focus on pointer down and executes once", async () => {
  const onSelect = vi.fn();
  render(/* popover */);
  fireEvent.pointerDown(screen.getByRole("option", { name: /Todo/ }));
  fireEvent.click(screen.getByRole("option", { name: /Todo/ }));
  expect(onSelect).toHaveBeenCalledTimes(1);
});
```

In the page test, type `/`, choose H2, and assert the editor remains focused without a second click.

- [x] **Step 2: Run tests and confirm RED**

```bash
pnpm test --run src/features/editor/components/commands/EditorCommandPopover.test.tsx src/features/editor/components/RichTextBlockEditor.test.tsx src/features/editor/components/EditorPage.test.tsx
```

Expected: FAIL because the popover and focus handoff do not exist.

- [x] **Step 3: Report a stable caret anchor from TipTap**

Add a shared value type:

```ts
export interface EditorPopoverAnchor {
  bottom: number;
  left: number;
  top: number;
}
```

Change `onOpenCommandMenu` to accept the anchor. Inside `handleKeyDown`, calculate it before preventing the slash insertion:

```ts
const caret = view.coordsAtPos(view.state.selection.from);
onOpenCommandMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
```

Use the same helper for slash text detected in `onUpdate`.

- [x] **Step 4: Render a non-modal listbox near the caret**

`EditorCommandPopover` must:

- use `role="listbox"` and `role="option"`;
- group results under `Text & Headings`, `Lists & Tasks`, `Media`, and `Data & Advanced`;
- use compact labels such as `H1`, `Image`, and `Table`;
- call `event.preventDefault()` on option `pointerdown`;
- constrain width to `min(390px, calc(100vw - 24px))` and max height to `min(420px, calc(100vh - 24px))`;
- flip above the caret when less than 320px remains below;
- keep the editor as the DOM focus owner.

Replace `SlashMenu` with a re-export or delete it after all imports move to the new component.

- [x] **Step 5: Add deterministic focus handoff in BlockRow**

Store a local request flag:

```ts
const [restoreEditorFocus, setRestoreEditorFocus] = useState(false);

function selectCommand(command: EditorCommandDefinition) {
  setOpenMenu(null);
  setRestoreEditorFocus(true);
  onChangeType(block.id, command.type, command.headingLevel);
}
```

Pass `focusRequest={focusRequest || restoreEditorFocus}` and clear the local flag in the editor's `onFocused` callback before calling the parent callback. This must work when a RichText block changes to Todo, Image/File, Table, or Board; structured editors receive their own focus target in later tasks rather than a fake text focus.

- [x] **Step 6: Add keyboard filtering and navigation**

Keep `ArrowUp`, `ArrowDown`, `Enter`, and `Escape` handling in `BlockRow`, but index the filtered flat command list. Typing after `/` filters by label, alias, description, and Markdown trigger without moving DOM focus into a search input.

- [x] **Step 7: Run focused tests and confirm GREEN**

Run Step 2 command. Expected: all focused tests PASS.

---

### Task 3: Make Todo A Direct Collaborative Editor Surface

**Files:**
- Modify: `src/features/editor/components/TodoBlockEditor.tsx`
- Create: `src/features/editor/components/TodoBlockEditor.test.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.integration.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing direct-edit and collaboration tests**

Assert that Todo uses a contenteditable TipTap surface, has no `input[type="text"]`, preserves the checkbox, receives Yjs collaboration configuration, and focuses immediately after a Slash conversion.

```ts
expect(screen.queryByRole("textbox", { name: "待办内容" })?.tagName).not.toBe("INPUT");
expect(screen.getByRole("checkbox", { name: "待办完成状态" })).toBeVisible();
expect(collaborationExtension.options.field).toBe(`block-content:${blockId}`);
```

- [x] **Step 2: Run tests and confirm RED**

```bash
pnpm test --run src/features/editor/components/TodoBlockEditor.test.tsx src/features/editor/components/RichTextBlockEditor.integration.test.tsx src/features/editor/components/EditorPage.test.tsx
```

Expected: FAIL because Todo still renders a text input and does not bind the collaboration fragment.

- [x] **Step 3: Reuse RichTextBlockEditor inside TodoBlockEditor**

Keep `TodoBlockEditor` as the checkbox layout owner, but render `RichTextBlockEditor` for its text:

```tsx
<div className="todo-editor">
  <Checkbox checked={checked} disabled={isReadOnly} onCheckedChange={onToggle} />
  <RichTextBlockEditor
    blockId={blockId}
    collaborationDocument={collaborationDocument}
    content={content}
    focusRequest={focusRequest}
    isReadOnly={isReadOnly}
    variant="todo"
    {...editorCallbacks}
  />
</div>
```

Extend the `variant` union with `todo`; use the same plain paragraph TipTap schema and a Todo-specific placeholder.

- [x] **Step 4: Remove input styling and preserve layout dimensions**

Delete `.todo-input` rules. Keep a stable 28px checkbox column and let the contenteditable occupy `minmax(0, 1fr)`. Focus styling comes only from the Focus Rail, not an input border or filled field.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run Step 2 command. Expected: all focused tests PASS.

---

### Task 4: Add Nexus Focus Rail And A Contextual Action Bar

**Files:**
- Create: `src/features/editor/components/blocks/BlockActionBar.tsx`
- Create: `src/features/editor/components/blocks/BlockActionBar.test.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/blocks/BlockControls.tsx`
- Modify: `src/features/editor/components/blocks/BlockInlineActions.tsx`
- Modify: `src/features/editor/components/blocks/BlockMetaStrip.tsx`
- Modify: `src/features/editor/components/BlockList.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing visibility and layout tests**

Cover the approved states:

```ts
expect(row).toHaveAttribute("data-active", "false");
fireEvent.focus(screen.getByTestId(`block-editor-${block.id}`));
expect(row).toHaveAttribute("data-active", "true");
expect(screen.getByRole("toolbar", { name: "当前块操作" })).toBeVisible();
```

Assert normal text blocks do not permanently render metadata, while task blocks with status/assignee/due date still expose those values.

- [x] **Step 2: Run tests and confirm RED**

```bash
pnpm test --run src/features/editor/components/blocks/BlockActionBar.test.tsx src/features/editor/components/BlockList.test.tsx src/features/editor/components/EditorPage.test.tsx
```

Expected: FAIL because active-block state and the contextual toolbar are missing.

- [x] **Step 3: Track active state without global rerenders**

Use local `onFocusCapture` and `onBlurCapture` in `BlockRow`. Keep the row active while focus moves into its toolbar/popovers:

```ts
function handleBlur(event: FocusEvent<HTMLElement>) {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
    setIsActive(false);
  }
}
```

Render `data-active={isActive || openMenu !== null}`.

- [x] **Step 4: Build the compact action bar from existing public controls**

The toolbar uses existing Button, Tooltip, Popover, and DropdownMenu primitives. It contains:

- current short type label (`Text`, `H1-H6`, `Todo`, etc.);
- comment command;
- task status/assignee/due date only for task-context blocks;
- a More menu for move, indent, outdent, and delete.

Keep the gutter Plus and Grip icons. Remove duplicated right-side floating controls only after their behavior exists in `BlockActionBar`.

- [x] **Step 5: Apply the visual system**

Use these stable rules:

```css
.block-row::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 34px;
  width: 3px;
  border-radius: 2px;
  background: #2563eb;
  content: "";
  opacity: 0;
}

.block-row[data-active="true"]::before { opacity: 1; }
.block-row[data-active="true"] .block-action-bar { opacity: 1; pointer-events: auto; }
```

The row itself remains borderless and white. The toolbar uses a white background, `#e4e4e7` border, radius no larger than 6px, and a restrained shadow. Do not add a card around the block.

- [x] **Step 6: Run focused tests and confirm GREEN**

Run Step 2 command. Expected: all focused tests PASS.

---

### Task 5: Add A Fixed Shortcut Registry And Reference Panel

**Files:**
- Create: `src/features/editor/commands/editorShortcuts.ts`
- Create: `src/features/editor/commands/editorShortcuts.test.ts`
- Create: `src/features/editor/components/commands/EditorShortcutCenter.tsx`
- Create: `src/features/editor/components/commands/EditorShortcutCenter.test.tsx`
- Modify: `src/features/editor/components/DocumentEditor.tsx`
- Modify: `src/features/editor/components/document/DocumentTopbar.tsx`
- Modify: `src/features/editor/components/EditorPage.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing registry and panel tests**

```ts
it("uses one definition for dispatch and display", () => {
  expect(getEditorShortcut("shortcut-center")).toMatchObject({ keys: ["Mod", "/"] });
});

it("opens the shortcut center with Mod+/ and exposes fixed shortcuts", async () => {
  render(/* document editor */);
  fireEvent.keyDown(document, { key: "/", ctrlKey: true });
  expect(screen.getByRole("dialog", { name: "快捷键" })).toBeVisible();
  expect(screen.getByText(/Alt.*ArrowUp/)).toBeVisible();
});
```

- [x] **Step 2: Run tests and confirm RED**

```bash
pnpm test --run src/features/editor/commands/editorShortcuts.test.ts src/features/editor/components/commands/EditorShortcutCenter.test.tsx src/features/editor/components/EditorPage.test.tsx
```

Expected: FAIL because the registry and reference panel do not exist.

- [x] **Step 3: Define immutable shortcut records**

```ts
export interface EditorShortcutDefinition {
  category: "format" | "block" | "navigation" | "workspace";
  description: string;
  id: string;
  keys: string[];
}

export const EDITOR_SHORTCUTS = [
  { id: "shortcut-center", category: "workspace", description: "快捷键", keys: ["Mod", "/"] },
  { id: "move-up", category: "block", description: "上移当前块", keys: ["Alt", "ArrowUp"] },
  { id: "move-down", category: "block", description: "下移当前块", keys: ["Alt", "ArrowDown"] },
  { id: "indent", category: "block", description: "缩进当前块", keys: ["Tab"] },
  { id: "outdent", category: "block", description: "取消缩进", keys: ["Shift", "Tab"] },
] as const;
```

Add Bold, Italic, Inline Code, Link, Undo, Redo, Search, and Slash entries even when the browser/TipTap already dispatches them. Do not add customization state.

- [x] **Step 4: Add the topbar keyboard icon and reference panel**

Use lucide `Keyboard` in an icon button with Tooltip. `EditorShortcutCenter` may use the existing Dialog primitive because it is a reference view, not an inline insertion menu. Group shortcuts by category and render semantic `<kbd>` elements. `Ctrl/Cmd + /` toggles it; Escape closes it.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run Step 2 command. Expected: all focused tests PASS.

---

### Task 6: Regression, Responsive, And Visual Verification

**Files:**
- Modify: `e2e/collaboration.spec.ts`
- Create: `e2e/contextual-editor.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-17-contextual-editor-interaction-design.md`

- [x] **Step 1: Add end-to-end workflows**

Cover:

```ts
test("selects H2 from slash and continues typing without another click", async ({ page }) => {
  const editor = page.locator('[data-testid^="block-editor-"]').first();
  await editor.fill("");
  await editor.press("/");
  await page.getByRole("option", { name: /H2/ }).click();
  await page.keyboard.type("Roadmap");
  await expect(editor).toContainText("Roadmap");
});
```

Also verify Todo direct editing, H6 persistence after reload, shortcut-center keyboard access, and B rapid input settling identically in A and B.

- [ ] **Step 2: Run all unit tests**

Result: editor regressions pass. The workspace-wide run currently reports 603 passed, 2 failed, and 1 skipped because the concurrently added `PostgresWorkspaceMemberStore.transferOwnership` tests do not yet have an implementation.

```bash
pnpm test --run
```

Expected: all tests PASS; PostgreSQL-only tests may remain explicitly skipped under the default config.

- [x] **Step 3: Build the production application**

```bash
pnpm build
```

Expected: exit 0 with successful type checking and static page generation.

- [x] **Step 4: Start the full local stack and run Playwright**

```bash
pnpm dev:fullstack
pnpm test:e2e -- e2e/contextual-editor.spec.ts e2e/collaboration.spec.ts
```

Expected: both specs PASS. If PostgreSQL/Redis/object storage prerequisites are unavailable, record the missing service explicitly and still run browser checks in local-storage mode.

Result: the contextual editor suite and a two-context rapid-input collaboration flow pass against local storage plus an isolated `y-websocket` service. The authenticated Docker flow was not rerun because the local Next process cannot reach the Compose-only PostgreSQL host.

- [x] **Step 5: Inspect desktop and mobile screenshots**

Capture `1440x1000`, `1024x768`, and `390x844`. Verify:

- no text overlaps the action bar or popover;
- Slash stays within the viewport and remains caret-adjacent;
- Focus Rail is visible only for the active block;
- Todo has no text input border;
- H1-H6 retain distinct but restrained sizes;
- gray/white remains dominant, blue is limited to focus/progress, green to saved, and red to failure/destructive state.

- [x] **Step 6: Update the design spec with implementation decisions**

Record final file boundaries, command IDs, shortcut IDs, and any accepted deviation from the prototype. Do not mark Mention or remote cursors implemented in this phase.

---

## Follow-Up Plans

After this plan is complete and visually accepted:

1. **Rich text and Mention:** persisted TipTap JSON migration, marks, People/Docs/Tasks/Dates atom nodes, BubbleMenu.
2. **Remote collaboration cursor:** expose provider/awareness, stable user colors, remote caret/name/selection, local caret without label, same-block soft warning.
3. **Advanced block commands:** lists, toggle, divider, formula, link card, and structured focus targets for Table/Image/File/Board.
