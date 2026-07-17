# 远程协作光标与 @Mention 实施计划

> 致智能代理工作者：本计划分为两个阶段依次实施。先实现协作光标（阶段一），再实现 @Mention（阶段二）。

**目标：** 在现有 Yjs awareness 基础上渲染远程光标、姓名标签和选区；新增 `@` Mention 搜索与插入，支持 People、Docs、Tasks、Dates 四类。

**技术栈：** React 18、TypeScript、TipTap 2.27.2、Yjs 13、`@tiptap/extension-collaboration-cursor@2.27.2`、Vitest、Testing Library。

**范围边界：** 富文本 JSON 持久化、BubbleMenu 格式工具栏、列表/toggle/divider 等新块类型不在本计划范围。

---

## 阶段一：远程协作光标

### 任务 1：安装依赖并创建用户颜色映射

**文件：**
- 修改：`package.json`
- 创建：`src/features/editor/collaboration/remoteCursorColors.ts`
- 创建：`src/features/editor/collaboration/remoteCursorColors.test.ts`

- [ ] **步骤 1：安装 collaboration-cursor 扩展**

```bash
pnpm add @tiptap/extension-collaboration-cursor@2.27.2
```

- [ ] **步骤 2：创建确定性颜色映射**

基于用户 ID 哈希映射到蓝、紫、青、品红等调色板，避开绿色（保存）和红色（错误）：

```ts
const CURSOR_COLORS = [
  { color: "#3b82f6", name: "blue" },
  { color: "#8b5cf6", name: "violet" },
  { color: "#06b6d4", name: "cyan" },
  { color: "#ec4899", name: "pink" },
  { color: "#f59e0b", name: "amber" },
  { color: "#6366f1", name: "indigo" },
  { color: "#14b8a6", name: "teal" },
  { color: "#a855f7", name: "purple" },
];

export function getCursorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length].color;
}
```

- [ ] **步骤 3：编写并运行测试**

### 任务 2：暴露 provider 并集成 CollaborationCursor

**文件：**
- 修改：`src/features/editor/collaboration/useDocumentCollaboration.ts`
- 修改：`src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- 修改：`src/features/editor/collaboration/collaborationTypes.ts`
- 修改：`src/features/editor/components/RichTextBlockEditor.tsx`
- 修改：`src/features/editor/components/EditorPage.tsx`

- [ ] **步骤 1：从 useDocumentCollaboration 暴露 provider**

在 hook 返回值中增加 `provider: WebsocketProvider | null`。

- [ ] **步骤 2：在 RichTextBlockEditor 中添加 CollaborationCursor 扩展**

```ts
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";

// 在 extensions 数组中增加：
CollaborationCursor.configure({
  provider,
  user: {
    name: localUserName,
    color: getCursorColor(localUserId),
  },
}),
```

- [ ] **步骤 3：编写并运行测试**

### 任务 3：远程光标样式与姓名标签

**文件：**
- 修改：`src/styles.css`
- 创建：`src/features/editor/components/RemoteCursorRenderer.tsx`
- 创建：`src/features/editor/components/RemoteCursorRenderer.test.tsx`

- [ ] **步骤 1：添加远程光标 CSS**

```css
/* 远程光标竖线 */
.ProseMirror .collaboration-cursor__caret {
  border-left: 2px solid var(--cursor-color);
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

/* 远程光标姓名标签 */
.ProseMirror .collaboration-cursor__label {
  background-color: var(--cursor-color);
  border-radius: 3px;
  color: white;
  font-size: 11px;
  font-weight: 500;
  left: -1px;
  line-height: normal;
  padding: 1px 4px;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
  pointer-events: none;
}
```

- [ ] **步骤 2：远程 caret 选区高亮**

```css
.ProseMirror .collaboration-cursor__selection {
  background-color: var(--cursor-color);
  opacity: 0.2;
}
```

- [ ] **步骤 3：编写并运行测试**

### 任务 4：同块软冲突提示

**文件：**
- 修改：`src/features/editor/components/blocks/BlockFocusRail.tsx`（或 `BlockRow.tsx`）
- 修改：`src/styles.css`

- [ ] **步骤 1：检测当前块是否有远程 caret**

通过 awareness 的 `cursor` 字段判断是否有远程用户在同一块编辑。如果有，显示轻量提示"某某正在此处编辑"。

- [ ] **步骤 2：编写并运行测试**

---

## 阶段二：@Mention

### 任务 5：创建 Mention TipTap 扩展

**文件：**
- 创建：`src/features/editor/extensions/mention.ts`
- 创建：`src/features/editor/extensions/mention.test.ts`

- [ ] **步骤 1：定义 MentionAttrs 接口**

```ts
interface MentionAttrs {
  kind: "person" | "document" | "task" | "date";
  targetId: string;
  label: string;
}
```

- [ ] **步骤 2：创建 TipTap Node 扩展**

使用 `Node.create` 创建 inline atom node，渲染为 `<span class="mention" data-kind="..." data-target-id="..." data-label="...">`。

- [ ] **步骤 3：编写并运行测试**

### 任务 6：创建 MentionPopover 搜索组件

**文件：**
- 创建：`src/features/editor/components/commands/MentionPopover.tsx`
- 创建：`src/features/editor/components/commands/MentionPopover.test.tsx`

- [ ] **步骤 1：实现四类搜索**

搜索来源：
- People：工作区成员列表
- Docs：当前工作区文档
- Tasks：Todo 或带任务状态的块
- Dates：今天、明天、具体日期

- [ ] **步骤 2：实现 caret 锚定 popover**

复用 `EditorCommandPopover` 的定位逻辑，使用 `listbox` / `option` 语义。

- [ ] **步骤 3：键盘导航**

ArrowUp/ArrowDown 选择，Enter 插入，Esc 关闭。

- [ ] **步骤 4：编写并运行测试**

### 任务 7：@ 触发与插入集成

**文件：**
- 修改：`src/features/editor/components/RichTextBlockEditor.tsx`
- 修改：`src/features/editor/components/BlockRow.tsx`

- [ ] **步骤 1：在 handleKeyDown 中拦截 @**

```ts
if (event.key === "@") {
  // 不阻止默认行为，让 @ 字符插入正文
  // 在 nextTick 计算 caret 坐标并打开 MentionPopover
}
```

- [ ] **步骤 2：选择后插入 Mention atom node**

```ts
editor.commands.insertContent({
  type: "mention",
  attrs: { kind, targetId, label },
});
```

- [ ] **步骤 3：插入后 caret 放到节点后方**

- [ ] **步骤 4：编写并运行测试**

### 任务 8：搜索数据源集成

**文件：**
- 修改：`src/features/editor/components/EditorPage.tsx`
- 创建：`src/features/editor/components/commands/useMentionSearch.ts`

- [ ] **步骤 1：从 workspace 成员列表获取 People**

- [ ] **步骤 2：从 workspace 文档列表获取 Docs**

- [ ] **步骤 3：从 workspace 块列表获取 Tasks**

- [ ] **步骤 4：硬编码 Dates 选项（今天、明天、上周等）**

- [ ] **步骤 5：防抖搜索，限制首屏结果数**

### 任务 9：全量回归测试

- [ ] **步骤 1：运行全部单元测试**

```bash
pnpm test --run
```

- [ ] **步骤 2：运行 E2E 测试**

```bash
pnpm test:e2e
```

- [ ] **步骤 3：构建验证**

```bash
pnpm build
```
