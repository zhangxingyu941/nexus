# 上下文编辑器基础实施计划

> **致智能代理工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 交付已批准的上下文编辑器的第一个可用切片：H1-H6、统一命令注册表、分类的光标相邻 Slash 弹出层、直接 Todo 编辑、连续焦点、Nexus Focus Rail 和固定快捷键参考。

**Architecture:** 保持 `Block` 作为持久化块边界，本阶段仅添加 `headingLevel`。统一命令目录驱动 Slash 结果、类型转换标签、Markdown 映射和快捷键标签。`RichTextBlockEditor` 仍是 TipTap/Yjs 的所有者；`BlockRow` 拥有瞬态 UI 状态，如活动命令弹出层和焦点交接。Yjs fragment 在一次性种子之后仍是唯一的协作文本源。

**Tech Stack:** React 18、TypeScript、TipTap 2.27.2、Yjs 13、lucide-react、Vitest、Testing Library、现有 CSS/Tailwind 原语。

**Scope boundary:** Mention 原子、持久化 TipTap JSON、BubbleMenu 格式化和远程光标渲染是独立的后续计划。本阶段创建它们将复用的命令/焦点接口，但不添加占位符 UI。

---

### 步骤 1：持久化标题级别并集中编辑器命令

**文件：**
- 创建： `src/features/editor/commands/editorCommands.ts`
- 创建： `src/features/editor/commands/editorCommands.test.ts`
- 修改： `src/features/editor/model/block.ts`
- 修改： `src/features/editor/model/documentBlockOperations.ts`
- 修改： `src/features/editor/model/documentOperations.test.ts`
- 修改： `src/features/editor/model/workspaceNormalization.ts`
- 修改： `src/features/editor/model/workspaceOperations.test.ts`
- 修改： `src/server/database/migrations.ts`
- 修改： `src/server/postgresWorkspaceStore.ts`
- 修改： `src/server/postgresWorkspaceStore.test.ts`
- 修改： `src/features/editor/collaboration/useDocumentCollaboration.ts`
- 修改： `src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- 修改： `src/features/editor/components/blocks/blockMenuOptions.ts`
- 修改： `src/features/editor/components/markdownShortcuts.ts`
- 修改： `src/features/editor/components/markdownShortcuts.test.ts`

- [x] **步骤 1：编写失败的模型和目录测试**

添加测试证明：新块在成为标题时默认为 H1，存储的 H4 块规范化为 H4，无效级别规范化为 H1，命令 ID 唯一且分组。

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

- [x] **步骤 2：运行聚焦测试并确认 RED**

运行：

```bash
pnpm test --run src/features/editor/commands/editorCommands.test.ts src/features/editor/model/documentOperations.test.ts src/features/editor/model/workspaceOperations.test.ts src/features/editor/components/markdownShortcuts.test.ts
```

预期： FAIL because `HeadingLevel`, `headingLevel`, and `EDITOR_COMMANDS` do not exist.

- [x] **步骤 3：添加精确的标题级别模型**

在 `block.ts` 中添加：

```ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Block {
  // existing fields
  headingLevel: HeadingLevel;
}
```

Set `headingLevel: 1` in `createBlock`. 扩展 `changeBlockType` 而不更改现有调用方：

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

仅规范化有效整数级别：

```ts
function normalizeHeadingLevel(value: unknown): HeadingLevel {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : 1;
}
```

通过新的幂等 PostgreSQL 迁移持久化 `headingLevel`，添加 `editor_blocks.heading_level INTEGER NOT NULL DEFAULT 1 CHECK (heading_level BETWEEN 1 AND 6)`。在 `PostgresWorkspaceStore` 中读写该列。在协作结构相等性中包含 `headingLevel`，使 H1 到 H4 的更改发布新的结构记录。

- [x] **步骤 4：创建统一命令目录**

在 `editorCommands.ts` 中定义以下公共契约：

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

导出 `getEditorCommand`、`getEditorCommandsByCategory` 和 `searchEditorCommands`。在本任务中将 `SLASH_COMMANDS` 作为此数组的兼容性导出；删除重复的标签/图标。

- [x] **步骤 5：从目录驱动 Markdown 解析**

返回命令选择而非仅 `BlockType`：

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

保持 quote、Todo 和 Code 触发器在同一注册表中。仅在测试覆盖新返回结构后更新调用方。

- [x] **步骤 6：运行聚焦测试并确认 GREEN**

运行步骤 2 的命令。预期：所有聚焦测试 PASS。

---

### 步骤 2：添加光标锚定的分类 Slash 弹出层

**文件：**
- 创建： `src/features/editor/components/commands/EditorCommandPopover.tsx`
- 创建： `src/features/editor/components/commands/EditorCommandPopover.test.tsx`
- 修改： `src/features/editor/components/RichTextBlockEditor.tsx`
- 修改： `src/features/editor/components/RichTextBlockEditor.test.tsx`
- 修改： `src/features/editor/components/BlockRow.tsx`
- 修改： `src/features/editor/components/blocks/SlashMenu.tsx`
- 修改： `src/features/editor/components/EditorPage.test.tsx`
- 修改： `src/styles.css`

- [x] **步骤 1：编写失败的弹出层行为测试**

覆盖以下行为：

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

在页面测试中，输入 `/`，选择 H2，并断言编辑器保持焦点且无需再次点击。

- [x] **步骤 2：运行测试并确认 RED**

```bash
pnpm test --run src/features/editor/components/commands/EditorCommandPopover.test.tsx src/features/editor/components/RichTextBlockEditor.test.tsx src/features/editor/components/EditorPage.test.tsx
```

预期：FAIL，因为弹出层和焦点交接不存在。

- [x] **步骤 3：从 TipTap 报告稳定的光标锚点**

添加共享值类型：

```ts
export interface EditorPopoverAnchor {
  bottom: number;
  left: number;
  top: number;
}
```

将 `onOpenCommandMenu` 改为接受锚点。在 `handleKeyDown` 中，在阻止 slash 插入之前计算它：

```ts
const caret = view.coordsAtPos(view.state.selection.from);
onOpenCommandMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
```

在 `onUpdate` 中检测到 slash 文本时使用相同的辅助函数。

- [x] **步骤 4：在光标附近渲染非模态 listbox**

`EditorCommandPopover` 必须：

- 使用 `role="listbox"` 和 `role="option"`；
- 将结果分组为 `Text & Headings`、`Lists & Tasks`、`Media` 和 `Data & Advanced`；
- 使用紧凑标签如 `H1`、`Image` 和 `Table`；
- 在选项 `pointerdown` 上调用 `event.preventDefault()`；
- 将宽度限制为 `min(390px, calc(100vw - 24px))`，最大高度限制为 `min(420px, calc(100vh - 24px))`；
- 当下方剩余空间不足 320px 时翻转到光标上方；
- 保持编辑器为 DOM 焦点所有者。

在所有导入移至新组件后，将 `SlashMenu` 替换为重新导出或删除它。

- [x] **步骤 5：在 BlockRow 中添加确定性焦点交接**

存储本地请求标志：

```ts
const [restoreEditorFocus, setRestoreEditorFocus] = useState(false);

function selectCommand(command: EditorCommandDefinition) {
  setOpenMenu(null);
  setRestoreEditorFocus(true);
  onChangeType(block.id, command.type, command.headingLevel);
}
```

传递 `focusRequest={focusRequest || restoreEditorFocus}` 并在编辑器的 `onFocused` 回调中清除本地标志，然后再调用父级回调。当 RichText 块更改为 Todo、Image/File、Table 或 Board 时必须正常工作；结构化编辑器在后续任务中接收自己的焦点目标，而不是伪造的文本焦点。

- [x] **步骤 6：添加键盘过滤和导航**

保持 `ArrowUp`、`ArrowDown`、`Enter` 和 `Escape` 处理在 `BlockRow` 中，但索引过滤后的扁平命令列表。在 `/` 后输入按标签、别名、描述和 Markdown 触发器过滤，而不将 DOM 焦点移入搜索输入框。

- [x] **步骤 7：运行聚焦测试并确认 GREEN**

运行步骤 2 的命令。预期：所有聚焦测试 PASS。

---

### 步骤 3：使 Todo 成为直接协作编辑器表面

**文件：**
- 修改： `src/features/editor/components/TodoBlockEditor.tsx`
- 创建： `src/features/editor/components/TodoBlockEditor.test.tsx`
- 修改： `src/features/editor/components/BlockRow.tsx`
- 修改： `src/features/editor/components/RichTextBlockEditor.tsx`
- 修改： `src/features/editor/components/RichTextBlockEditor.integration.test.tsx`
- 修改： `src/styles.css`

- [x] **步骤 1：编写失败的直接编辑和协作测试**

断言 Todo 使用 contenteditable TipTap 表面，没有 `input[type="text"]`，保留复选框，接收 Yjs 协作配置，并在 Slash 转换后立即聚焦。

```ts
expect(screen.queryByRole("textbox", { name: "待办内容" })?.tagName).not.toBe("INPUT");
expect(screen.getByRole("checkbox", { name: "待办完成状态" })).toBeVisible();
expect(collaborationExtension.options.field).toBe(`block-content:${blockId}`);
```

- [x] **步骤 2：运行测试并确认 RED**

```bash
pnpm test --run src/features/editor/components/TodoBlockEditor.test.tsx src/features/editor/components/RichTextBlockEditor.integration.test.tsx src/features/editor/components/EditorPage.test.tsx
```

预期：FAIL，因为 Todo 仍然渲染文本输入且未绑定协作 fragment。

- [x] **步骤 3：在 TodoBlockEditor 中复用 RichTextBlockEditor**

保持 `TodoBlockEditor` 作为复选框布局所有者，但为其文本渲染 `RichTextBlockEditor`：

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

用 `todo` 扩展 `variant` 联合类型；使用相同的纯段落 TipTap schema 和 Todo 专用占位符。

- [x] **步骤 4：移除输入样式并保留布局尺寸**

删除 `.todo-input` 规则。保持稳定的 28px 复选框列，让 contenteditable 占据 `minmax(0, 1fr)`。焦点样式仅来自 Focus Rail，而非输入边框或填充字段。

- [x] **步骤 5：运行聚焦测试并确认 GREEN**

运行步骤 2 的命令。预期：所有聚焦测试 PASS。

---

### 步骤 4：添加 Nexus Focus Rail 和上下文操作栏

**文件：**
- 创建： `src/features/editor/components/blocks/BlockActionBar.tsx`
- 创建： `src/features/editor/components/blocks/BlockActionBar.test.tsx`
- 修改： `src/features/editor/components/BlockRow.tsx`
- 修改： `src/features/editor/components/blocks/BlockControls.tsx`
- 修改： `src/features/editor/components/blocks/BlockInlineActions.tsx`
- 修改： `src/features/editor/components/blocks/BlockMetaStrip.tsx`
- 修改： `src/features/editor/components/BlockList.test.tsx`
- 修改： `src/styles.css`

- [x] **步骤 1：编写失败的可见性和布局测试**

覆盖已批准的状态：

```ts
expect(row).toHaveAttribute("data-active", "false");
fireEvent.focus(screen.getByTestId(`block-editor-${block.id}`));
expect(row).toHaveAttribute("data-active", "true");
expect(screen.getByRole("toolbar", { name: "当前块操作" })).toBeVisible();
```

断言普通文本块不会永久渲染元数据，而带有状态/负责人/截止日期的任务块仍会暴露这些值。

- [x] **步骤 2：运行测试并确认 RED**

```bash
pnpm test --run src/features/editor/components/blocks/BlockActionBar.test.tsx src/features/editor/components/BlockList.test.tsx src/features/editor/components/EditorPage.test.tsx
```

预期：FAIL，因为活动块状态和上下文工具栏缺失。

- [x] **步骤 3：在不全局重渲染的情况下跟踪活动状态**

在 `BlockRow` 中使用本地 `onFocusCapture` 和 `onBlurCapture`。当焦点移入其工具栏/弹出层时保持行活动：

```ts
function handleBlur(event: FocusEvent<HTMLElement>) {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
    setIsActive(false);
  }
}
```

渲染 `data-active={isActive || openMenu !== null}`。

- [x] **步骤 4：从现有公共控件构建紧凑操作栏**

工具栏使用现有的 Button、Tooltip、Popover 和 DropdownMenu 原语。包含：

- 当前短类型标签（`Text`、`H1-H6`、`Todo` 等）；
- 评论命令；
- 仅任务上下文块的任务状态/负责人/截止日期；
- 用于移动、缩进、取消缩进和删除的更多菜单。

保持 gutter Plus 和 Grip 图标。仅在行为存在于 `BlockActionBar` 中后才删除重复的右侧浮动控件。

- [x] **步骤 5：应用视觉系统**

使用以下稳定规则：

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

行本身保持无边框和白色。工具栏使用白色背景、`#e4e4e7` 边框、圆角不大于 6px 和适度阴影。不要在块周围添加卡片。

- [x] **步骤 6：运行聚焦测试并确认 GREEN**

运行步骤 2 的命令。预期：所有聚焦测试 PASS。

---

### 步骤 5：添加固定快捷键注册表和参考面板

**文件：**
- 创建： `src/features/editor/commands/editorShortcuts.ts`
- 创建： `src/features/editor/commands/editorShortcuts.test.ts`
- 创建： `src/features/editor/components/commands/EditorShortcutCenter.tsx`
- 创建： `src/features/editor/components/commands/EditorShortcutCenter.test.tsx`
- 修改： `src/features/editor/components/DocumentEditor.tsx`
- 修改： `src/features/editor/components/document/DocumentTopbar.tsx`
- 修改： `src/features/editor/components/EditorPage.test.tsx`
- 修改： `src/styles.css`

- [x] **步骤 1：编写失败的注册表和面板测试**

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

- [x] **步骤 2：运行测试并确认 RED**

```bash
pnpm test --run src/features/editor/commands/editorShortcuts.test.ts src/features/editor/components/commands/EditorShortcutCenter.test.tsx src/features/editor/components/EditorPage.test.tsx
```

预期：FAIL，因为注册表和参考面板不存在。

- [x] **步骤 3：定义不可变快捷键记录**

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

即使浏览器/TipTap 已经调度它们，也要添加 Bold、Italic、Inline Code、Link、Undo、Redo、Search 和 Slash 条目。不要添加自定义状态。

- [x] **步骤 4：添加顶部栏键盘图标和参考面板**

在带 Tooltip 的图标按钮中使用 lucide `Keyboard`。`EditorShortcutCenter` 可以使用现有的 Dialog 原语，因为它是参考视图而非内联插入菜单。按类别分组快捷键并渲染语义化 `<kbd>` 元素。`Ctrl/Cmd + /` 切换；Escape 关闭。

- [x] **步骤 5：运行聚焦测试并确认 GREEN**

运行步骤 2 的命令。预期：所有聚焦测试 PASS。

---

### 步骤 6：回归、响应式和视觉验证

**文件：**
- 修改： `e2e/collaboration.spec.ts`
- 创建： `e2e/contextual-editor.spec.ts`
- 修改： `docs/superpowers/specs/2026-07-17-contextual-editor-interaction-design.md`

- [x] **步骤 1：添加端到端工作流**

覆盖：

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

同时验证 Todo 直接编辑、刷新后 H6 持久化、shortcut-center 键盘访问，以及 B 中快速输入与 A 和 B 相同的稳定行为。

- [ ] **步骤 2：运行所有单元测试**

结果：编辑器回归通过。工作区范围的运行当前报告 603 通过、2 失败、1 跳过，因为并发添加的 `PostgresWorkspaceMemberStore.transferOwnership` 测试尚无实现。

```bash
pnpm test --run
```

预期：所有测试 PASS；PostgreSQL 专属测试在默认配置下可能保持显式跳过。

- [x] **步骤 3：构建生产应用**

```bash
pnpm build
```

预期：退出码 0，类型检查和静态页面生成成功。

- [x] **步骤 4：启动完整本地栈并运行 Playwright**

```bash
pnpm dev:fullstack
pnpm test:e2e -- e2e/contextual-editor.spec.ts e2e/collaboration.spec.ts
```

预期：两个规格 PASS。如果 PostgreSQL/Redis/对象存储前提条件不可用，显式记录缺失的服务，并仍在 local-storage 模式下运行浏览器检查。

结果：上下文编辑器套件和双上下文快速输入协作流程在 local storage 加上隔离的 `y-websocket` 服务上通过。认证 Docker 流程未重新运行，因为本地 Next 进程无法到达仅 Compose 的 PostgreSQL 主机。

- [x] **步骤 5：检查桌面和移动端截图**

捕获 `1440x1000`、`1024x768` 和 `390x844`。验证：

- 没有文本与操作栏或弹出层重叠；
- Slash 保持在视口内且保持光标相邻；
- Focus Rail 仅对活动块可见；
- Todo 没有文本输入边框；
- H1-H6 保持不同但适度的大小；
- 灰色/白色仍占主导，蓝色仅限于焦点/进度，绿色仅限于已保存，红色仅限于失败/破坏性状态。

- [x] **步骤 6：用实施决策更新设计规格**

记录最终文件边界、命令 ID、快捷键 ID 和任何已接受的与原型的偏差。不要标记本阶段已实现 Mention 或远程光标。

---

## 后续计划

本计划完成并通过视觉验收后：

1. **富文本和提及：** 持久化 TipTap JSON 迁移、marks、People/Docs/Tasks/Dates 原子节点、BubbleMenu。
2. **远程协作光标：** 暴露 provider/awareness、稳定用户颜色、远程光标/名称/选择、无标签本地光标、同块软警告。
3. **高级块命令：** 列表、toggle、divider、formula、link card，以及 Table/Image/File/Board 的结构化焦点目标。
