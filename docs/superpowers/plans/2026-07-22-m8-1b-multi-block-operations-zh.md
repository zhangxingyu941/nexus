# M8.1B 多块操作实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Nexus 编辑器交付可访问的多块选择、一次保存的批量变更、受限内部剪贴板和 dnd-kit 拖拽排序，并保持协同与权限边界。

**Architecture:** Block 选择只存在于 React 瞬态状态；所有选择解析、复制和批量变更都在无副作用模型函数中完成。`EditorPage` 每次命令只应用一个新 `EditorDocument`，随后沿既有工作区保存和协同结构补丁链路持久化。浏览器剪贴板只承载白名单快照，带附件的同工作区粘贴交由受授权的服务端事务复制对象。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、Playwright、Yjs、`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`。

---

## 文件结构

- `src/features/editor/model/blockSelection.ts`：扁平可见顺序、父子展开、根集合去重和选择修剪。
- `src/features/editor/model/batchBlockOperations.ts`：纯文档批量删除、移动、缩进、类型转换、marks 和复制块变换。
- `src/features/editor/model/blockClipboard.ts`：`application/x-nexus-blocks+json` v1 编解码、大小/关系校验和跨工作区降级。
- `src/features/editor/components/useBlockSelection.ts`：把纯选择模型接入 React 生命周期和键盘事件。
- `src/features/editor/components/BlockSelectionToolbar.tsx`：桌面浮动/移动底部批量工具条及状态播报。
- `src/features/editor/components/BlockDndContext.tsx`：dnd-kit 传感器、拖拽覆盖层和受控 Drop 适配。
- `src/features/editor/components/BlockList.tsx`、`BlockRow.tsx`、`blocks/BlockControls.tsx`：选中视觉、侧栏选择入口、可拖拽行和 ARIA。
- `src/features/editor/components/EditorPage.tsx`、`DocumentEditor.tsx`：单次批量命令、撤销记录、剪贴板和协同保存接线。
- `src/server/blockClipboardPasteService.ts`、`src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.ts`：同工作区附件对象复制的授权原子服务。

### Task 1: 固定拖拽依赖并建立选择模型

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/editor/model/blockSelection.ts`
- Create: `src/features/editor/model/blockSelection.test.ts`

- [ ] **Step 1: 写出选择解析的失败测试**

```ts
it("expands selected parents, keeps document order, and removes descendant roots", () => {
  const result = resolveBlockSelection(blocks, {
    anchorBlockId: "parent",
    selectedBlockIds: ["parent", "child", "sibling"],
  });

  expect(result.orderedBlockIds).toEqual(["parent", "child", "grandchild", "sibling"]);
  expect(result.rootBlockIds).toEqual(["parent", "sibling"]);
});

it("selects the visible anchor range and prunes removed ids", () => {
  expect(selectBlock({ anchorBlockId: "a", selectedBlockIds: ["a"] }, "c", "range", ["a", "b", "c"]))
    .toEqual({ anchorBlockId: "a", selectedBlockIds: ["a", "b", "c"] });
  expect(pruneBlockSelection({ anchorBlockId: "b", selectedBlockIds: ["a", "b"] }, ["a"]))
    .toEqual({ anchorBlockId: null, selectedBlockIds: ["a"] });
});
```

- [ ] **Step 2: 运行测试，确认当前缺少模块**

Run: `pnpm test --run src/features/editor/model/blockSelection.test.ts`

Expected: FAIL，提示无法解析 `./blockSelection`。

- [ ] **Step 3: 实现确定性的选择函数**

```ts
export interface BlockSelectionState {
  anchorBlockId: string | null;
  selectedBlockIds: string[];
}

export interface ResolvedBlockSelection {
  orderedBlockIds: string[];
  rootBlockIds: string[];
}

export function resolveBlockSelection(blocks: Block[], state: BlockSelectionState): ResolvedBlockSelection {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const selected = new Set(state.selectedBlockIds.filter((id) => byId.has(id)));
  const pending = [...selected];
  while (pending.length) {
    const id = pending.pop()!;
    for (const childId of byId.get(id)?.children ?? []) {
      if (byId.has(childId) && !selected.has(childId)) {
        selected.add(childId);
        pending.push(childId);
      }
    }
  }
  const orderedBlockIds = blocks.filter((block) => selected.has(block.id)).map((block) => block.id);
  const rootBlockIds = orderedBlockIds.filter((id) => !hasSelectedAncestor(id, selected, byId));
  return { orderedBlockIds, rootBlockIds };
}
```

实现 `selectBlock` 的 `replace`、`toggle`、`range` 三种模式；`range` 必须使用传入的可见顺序而不是数组索引缓存。实现 `pruneBlockSelection` 和 `EMPTY_BLOCK_SELECTION`，不可读取或写入持久化存储。

- [ ] **Step 4: 加入精确版本的 dnd-kit 依赖**

Run: `pnpm add @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`

Expected: `package.json` 和锁文件包含三个运行时依赖，未升级无关包。

- [ ] **Step 5: 运行选择单元测试和类型检查**

Run: `pnpm test --run src/features/editor/model/blockSelection.test.ts && pnpm exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交模型基础**

```powershell
git add package.json pnpm-lock.yaml src/features/editor/model/blockSelection.ts src/features/editor/model/blockSelection.test.ts
git commit -m "feat: add block selection model"
```

### Task 2: 以一个文档变换实现批量结构操作

**Files:**
- Create: `src/features/editor/model/batchBlockOperations.ts`
- Create: `src/features/editor/model/batchBlockOperations.test.ts`
- Modify: `src/features/editor/model/documentBlockOperations.ts`

- [ ] **Step 1: 写出批量操作失败测试**

```ts
it("deletes selected roots with their descendants and leaves one empty paragraph", () => {
  const result = deleteBlocks(documentWithOnlyTree, ["parent"], 100);
  expect(result.document.blocks).toMatchObject([{ type: "paragraph", content: "" }]);
  expect(result.affectedBlockIds).toEqual(["parent", "child"]);
});

it("moves a root set once without allowing a drop into its own subtree", () => {
  expect(moveBlockRoots(document, ["a", "c"], "target", "after", 100).document.blocks.map(({ id }) => id))
    .toEqual(["target", "a", "a-child", "c"]);
  expect(moveBlockRoots(document, ["a"], "a-child", "before", 100).error)
    .toBe("不能移动到所选块的子树中");
});

it("updates only compatible text blocks for a mixed mark command", () => {
  const result = toggleMarkForBlocks(document, ["paragraph", "code", "todo"], "bold", 100);
  expect(result.affectedBlockIds).toEqual(["paragraph", "todo"]);
  expect(result.document.blocks.find((block) => block.id === "code")?.richText).toBeNull();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/features/editor/model/batchBlockOperations.test.ts`

Expected: FAIL，提示找不到批量操作导出。

- [ ] **Step 3: 实现统一结果和不变量**

```ts
export interface BatchBlockMutationResult {
  affectedBlockIds: string[];
  document: EditorDocument;
  error?: string;
  focusBlockId: string | null;
}

function unchanged(document: EditorDocument, error?: string): BatchBlockMutationResult {
  return { affectedBlockIds: [], document, error, focusBlockId: null };
}
```

实现 `deleteBlocks`、`moveBlockRoots`、`indentBlockRoots`、`outdentBlockRoots`、`changeBlockTypes`、`toggleMarkForBlocks` 和 `duplicateBlockRoots`。每个函数先用 `resolveBlockSelection` 验证全部前置条件；若任一根不成立、目标不存在或会造成环，返回 `unchanged`，不得做部分修改。修改时仅触及实际变化的块，且通过 `touchDocument` 恰好刷新一次文档 `updatedAt`。

批量 marks 必须调用 `normalizeRichText`：所有兼容文本块都已含 mark 时移除，否则为所有兼容文本块添加；`code`、附件、表格、看板和其它复杂块保持不变。将单块 `deleteBlock` 的“提升子块”行为保留给现有菜单，批量删除改为删除根的整个子树。

- [ ] **Step 4: 运行模型测试**

Run: `pnpm test --run src/features/editor/model/batchBlockOperations.test.ts src/features/editor/model/documentOperations.test.ts`

Expected: PASS，现有单块行为无回归。

- [ ] **Step 5: 提交批量文档变换**

```powershell
git add src/features/editor/model/batchBlockOperations.ts src/features/editor/model/batchBlockOperations.test.ts src/features/editor/model/documentBlockOperations.ts
git commit -m "feat: add atomic batch block mutations"
```

### Task 3: 定义安全的内部块剪贴板

**Files:**
- Create: `src/features/editor/model/blockClipboard.ts`
- Create: `src/features/editor/model/blockClipboard.test.ts`
- Modify: `src/features/editor/model/block.ts`

- [ ] **Step 1: 写出白名单、重映射和降级的失败测试**

```ts
it("serializes root subtrees without comments or timestamps", () => {
  const payload = createBlockClipboardPayload(document, ["parent"], "workspace-a", 100);
  expect(payload.blocks[0]).not.toHaveProperty("comments");
  expect(JSON.stringify(payload)).not.toContain("private-object-key");
});

it("rejects unknown versions and relation escapes before mutation", () => {
  expect(parseBlockClipboardPayload({ version: 2 })).toEqual({ payload: null, reason: "不支持的块剪贴板版本" });
  expect(parseBlockClipboardPayload(payloadWithOutsideChild)).toEqual({ payload: null, reason: "块剪贴板关系无效" });
});

it("clears assignee and turns cross-workspace attachments into paragraphs", () => {
  const inserted = materializeClipboardBlocks(payloadWithImage, { targetWorkspaceId: "workspace-b", now: 200, nextId });
  expect(inserted[0]).toMatchObject({ assignee: "", type: "paragraph" });
  expect(inserted[0].content).toContain("diagram.png");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/features/editor/model/blockClipboard.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现 JSON 契约和纯转换**

```ts
export const NEXUS_BLOCK_CLIPBOARD_MIME = "application/x-nexus-blocks+json";

export interface NexusBlockClipboardPayload {
  blocks: ClipboardBlockSnapshot[];
  copiedAt: number;
  sourceDocumentId: string;
  sourceWorkspaceId: string;
  version: 1;
}
```

创建 `ClipboardBlockSnapshot` 时逐字段构造，禁止对象展开 `Block`；只保留设计文档列出的字段，`richText` 使用 `normalizeRichText`，`data` 深拷贝并在 HTML/plain-text 输出中排除对象 key。`parseBlockClipboardPayload` 限制单富文本 256 KB、总 UTF-8 JSON 2 MB、只接受已知 `BlockType`，并验证 `sourceChildren` 都在负载内且没有环。`materializeClipboardBlocks` 为每个块生成新 ID 和时间、仅重映射包内 parent/children；跨工作区清空 `assignee`，使附件成为普通段落，移除内部 URL 和对象 key。

同时导出 `clipboardPayloadToPlainText` 和 `clipboardPayloadToSafeHtml`，HTML 仅输出语义段落/标题/列表和 M8.1A 支持 marks，不能输出 `data-*` 私有标识。

- [ ] **Step 4: 运行剪贴板和富文本测试**

Run: `pnpm test --run src/features/editor/model/blockClipboard.test.ts src/shared/richText.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交内部剪贴板模型**

```powershell
git add src/features/editor/model/block.ts src/features/editor/model/blockClipboard.ts src/features/editor/model/blockClipboard.test.ts
git commit -m "feat: add validated block clipboard payload"
```

### Task 4: 接入选择状态、键盘和批量工具条

**Files:**
- Create: `src/features/editor/components/useBlockSelection.ts`
- Create: `src/features/editor/components/useBlockSelection.test.tsx`
- Create: `src/features/editor/components/BlockSelectionToolbar.tsx`
- Create: `src/features/editor/components/BlockSelectionToolbar.test.tsx`
- Modify: `src/features/editor/components/BlockList.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/blocks/BlockControls.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 写出交互失败测试**

```tsx
await user.click(screen.getByLabelText("选择块 block-a"));
await user.keyboard("{Shift>}");
await user.click(screen.getByLabelText("选择块 block-c"));
await user.keyboard("{/Shift}");
expect(screen.getAllByRole("article", { selected: true })).toHaveLength(3);
expect(screen.getByRole("status")).toHaveTextContent("已选择 3 个块");

await user.keyboard("{Escape}");
expect(screen.queryByRole("toolbar", { name: "批量块操作" })).not.toBeInTheDocument();
```

- [ ] **Step 2: 运行组件测试，确认失败**

Run: `pnpm test --run src/features/editor/components/useBlockSelection.test.tsx src/features/editor/components/BlockSelectionToolbar.test.tsx`

Expected: FAIL，因为尚无选择入口和工具条。

- [ ] **Step 3: 实现受控状态和访问性**

```ts
export function useBlockSelection(blocks: Block[]) {
  const [state, setState] = useState<BlockSelectionState>(EMPTY_BLOCK_SELECTION);
  const visibleIds = useMemo(() => blocks.map((block) => block.id), [blocks]);
  useEffect(() => setState((current) => pruneBlockSelection(current, visibleIds)), [visibleIds]);
  return { clear: () => setState(EMPTY_BLOCK_SELECTION), resolved: resolveBlockSelection(blocks, state), select, state };
}
```

`BlockControls` 增加固定尺寸的选择按钮，桌面支持 Shift/Ctrl/Meta，移动端用 180 ms 长按进入选择。`BlockRow` 根据解析后的选择加 `aria-selected`、灰白背景、浅灰边框和左强调线；进入任一可编辑正文、文档切换、只读状态或 Escape 时清除。`BlockSelectionToolbar` 仅在存在选择且允许写入时渲染，桌面锚定首个选择块、移动端固定在安全区上方；使用 Lucide `Copy`、`Scissors`、`Clipboard`、`Trash2`、`IndentIncrease`、`IndentDecrease`、`Bold`、`Italic`、`Strikethrough`、`Code2`，每个图标按钮有 `tooltip`、固定尺寸、`aria-label` 和正确的 `aria-pressed`。

- [ ] **Step 4: 运行选择 UI 测试**

Run: `pnpm test --run src/features/editor/components/useBlockSelection.test.tsx src/features/editor/components/BlockSelectionToolbar.test.tsx src/features/editor/components/BlockRow.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交选择交互**

```powershell
git add src/features/editor/components/useBlockSelection.ts src/features/editor/components/useBlockSelection.test.tsx src/features/editor/components/BlockSelectionToolbar.tsx src/features/editor/components/BlockSelectionToolbar.test.tsx src/features/editor/components/BlockList.tsx src/features/editor/components/BlockRow.tsx src/features/editor/components/blocks/BlockControls.tsx src/styles.css
git commit -m "feat: add accessible multi-block selection"
```

### Task 5: 以 dnd-kit 替换原生拖拽并接线批量命令

**Files:**
- Create: `src/features/editor/components/BlockDndContext.tsx`
- Create: `src/features/editor/components/BlockDndContext.test.tsx`
- Modify: `src/features/editor/components/BlockList.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/DocumentEditor.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/features/editor/components/EditorPage.test.tsx`

- [ ] **Step 1: 写出拖拽适配和一次保存的失败测试**

```tsx
it("moves the selected roots as one DnD transaction", async () => {
  render(<BlockDndContext blocks={blocks} selectedRootIds={["a", "c"]} onDrop={onDrop} />);
  await user.keyboard("{Space}{ArrowDown}{Space}");
  expect(onDrop).toHaveBeenCalledWith(["a", "c"], "target", "after");
});

it("applies a batch deletion once and offers one undo record", async () => {
  await selectRows("block-a", "block-b");
  await user.click(screen.getByRole("button", { name: "删除所选块" }));
  expect(onWorkspaceChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "撤销批量操作" })).toBeVisible();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/features/editor/components/BlockDndContext.test.tsx src/features/editor/components/EditorPage.test.tsx`

Expected: FAIL，因为当前使用原生 `draggable` 事件且没有批量撤销记录。

- [ ] **Step 3: 实现拖拽和单事务调度**

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
```

移除 `BlockRow` 的原生 `draggable`、`onDragStart` 和 `dataTransfer` 处理，改为 `useSortable`。`BlockDndContext` 只将 `active.id` 与当前选择根解析为 `moveBlockRoots` 的输入，Drop 只传 `before|after`；目标在移动子树中、目标失效或只读时取消。`DragOverlay` 使用首块纯文本摘要和总数量，绝不复刻 TipTap DOM。

在 `EditorPage` 增加 `applyBatchMutation(operation)`：捕获操作前 `EditorDocument`，调用纯函数一次，只有 `affectedBlockIds.length > 0` 才调用一次 `applyActiveDocumentChange`、清除选择、设置 `focusBlockId`，并写入一个可撤销记录。`Mod+Z` 仅撤销本地最近批量记录；远端更新不写栈。复制块、剪切后成功粘贴、删除、移动、缩进、转换和 marks 都必须通过该函数。

- [ ] **Step 4: 运行拖拽和编辑器测试**

Run: `pnpm test --run src/features/editor/components/BlockDndContext.test.tsx src/features/editor/components/EditorPage.test.tsx src/features/editor/collaboration/useDocumentCollaboration.test.tsx`

Expected: PASS，现有协同结构补丁测试仍通过。

- [ ] **Step 5: 提交 dnd-kit 和批量调度**

```powershell
git add src/features/editor/components/BlockDndContext.tsx src/features/editor/components/BlockDndContext.test.tsx src/features/editor/components/BlockList.tsx src/features/editor/components/BlockRow.tsx src/features/editor/components/DocumentEditor.tsx src/features/editor/components/EditorPage.tsx src/features/editor/components/EditorPage.test.tsx
git commit -m "feat: support batch drag and undo"
```

### Task 6: 浏览器剪贴板、跨文档粘贴和附件服务

**Files:**
- Create: `src/features/editor/components/useBlockClipboard.ts`
- Create: `src/features/editor/components/useBlockClipboard.test.tsx`
- Create: `src/server/blockClipboardPasteService.ts`
- Create: `src/server/blockClipboardPasteService.test.ts`
- Create: `src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.test.ts`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/server/applicationServices.ts`

- [ ] **Step 1: 写出剪贴板优先级和附件事务的失败测试**

```ts
it("prefers valid Nexus MIME, otherwise falls back to sanitized HTML then plain text", async () => {
  await paste({ [NEXUS_BLOCK_CLIPBOARD_MIME]: invalidPayload, "text/html": "<p>safe</p>", "text/plain": "plain" });
  expect(onPaste).toHaveBeenCalledWith(expect.objectContaining({ fallback: "html" }));
});

it("does not delete the cut source when the target attachment transaction fails", async () => {
  await expect(service.paste(payload, context)).rejects.toThrow("附件复制失败");
  expect(deleteSource).not.toHaveBeenCalled();
  expect(storage.deleteObject).toHaveBeenCalledWith("temporary-copy-key");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/features/editor/components/useBlockClipboard.test.tsx src/server/blockClipboardPasteService.test.ts`

Expected: FAIL，剪贴板 hook 和服务尚不存在。

- [ ] **Step 3: 实现浏览器读写和服务端附件复制**

浏览器 hook 同时写入 `NEXUS_BLOCK_CLIPBOARD_MIME`、`text/html` 和 `text/plain`。读取时先严格解析自定义 MIME，再使用现有 M8.1A HTML 清洗器，最后创建纯文本段落；浏览器权限拒绝时返回 `{ ok: false, message: "系统剪贴板不可用" }`，UI 不显示成功状态。剪切只将源根标记为待删除，只有目标粘贴完整成功后才调用 `deleteBlocks`。

服务端路由只接受同工作区结构化快照和目标文档写权限；服务读取源文档授权、复制每个附件到新 key，验证对象归属后在一个数据库事务中创建目标块/附件记录。任一步失败均删除本请求已创建对象并回滚数据库；跨工作区不能调用该路由，客户端先走 `materializeClipboardBlocks` 的降级分支。路由对未知 payload、超限、无读/写权限返回稳定中文 400/403。

- [ ] **Step 4: 运行剪贴板、服务和 API 测试**

Run: `pnpm test --run src/features/editor/components/useBlockClipboard.test.tsx src/server/blockClipboardPasteService.test.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交剪贴板粘贴实现**

```powershell
git add src/features/editor/components/useBlockClipboard.ts src/features/editor/components/useBlockClipboard.test.tsx src/server/blockClipboardPasteService.ts src/server/blockClipboardPasteService.test.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/block-paste/route.test.ts src/features/editor/components/EditorPage.tsx src/server/applicationServices.ts
git commit -m "feat: add secure block clipboard paste"
```

### Task 7: 协同保护、端到端验收和状态文档

**Files:**
- Modify: `src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- Modify: `src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`
- Modify: `src/features/editor/components/EditorPageCollaboration.test.tsx`
- Create: `e2e/multi-block-operations.spec.ts`
- Modify: `docs/m8-status-zh.md`

- [ ] **Step 1: 写出协同回归和浏览器验收测试**

```ts
it("prunes a remotely deleted selected block without moving the remaining selection", () => {
  renderCollaborativeEditor();
  select("a", "b");
  applyRemoteStructureDelete("a");
  expect(selectionState()).toEqual({ anchorBlockId: "b", selectedBlockIds: ["b"] });
});
```

```ts
test("selects, formats, drags and pastes blocks in desktop and mobile viewports", async ({ page }) => {
  await selectByGutter(page, ["block-1", "block-3"], { modifier: "Control" });
  await page.getByRole("button", { name: "加粗所选块" }).click();
  await dragSelectionAfter(page, "block-4");
  await expect(page.getByRole("toolbar", { name: "批量块操作" })).toBeVisible();
  await expectViewportBounds(page, "[role=toolbar]");
});
```

- [ ] **Step 2: 运行定向回归，确认新增断言先失败**

Run: `pnpm test --run src/features/editor/collaboration/useDocumentCollaboration.test.tsx src/features/editor/collaboration/yjsWorkspaceMapping.test.ts src/features/editor/components/EditorPageCollaboration.test.tsx`

Expected: FAIL，直到选择修剪与批量结构补丁接线完整。

- [ ] **Step 3: 完成协同与只读边界**

在接收远端工作区快照后，使用 `pruneBlockSelection`，不重新解释选中块的相对顺序；协同 XmlFragment 继续只承载块内文本，批量 marks 对每个文本块写回相应 fragment，但调用方仍仅调度一次保存。只读 viewer 显示选中和复制入口，隐藏删除、粘贴、类型、格式和拖拽；匿名分享不创建 `useBlockSelection`、不注册剪贴板/拖拽传感器。

- [ ] **Step 4: 运行全量验证**

Run: `pnpm exec tsc --noEmit && pnpm test --run && pnpm build && pnpm exec playwright test e2e/multi-block-operations.spec.ts`

Expected: 全部通过；若 `TEST_DATABASE_URL` 已配置，额外运行 `pnpm test:postgres --run src/server/blockClipboardPasteService.test.ts`。

- [ ] **Step 5: 更新状态并提交验收**

```powershell
git add src/features/editor/collaboration/useDocumentCollaboration.test.tsx src/features/editor/collaboration/yjsWorkspaceMapping.test.ts src/features/editor/components/EditorPageCollaboration.test.tsx e2e/multi-block-operations.spec.ts docs/m8-status-zh.md
git commit -m "test: verify multi-block operations"
```

## 计划自检

- 选择模型、根去重、批量结构变换、marks、Dnd、三格式剪贴板、附件复制、协同、权限、只读和桌面/移动验收均有对应任务。
- 批量操作与 Markdown 被拆分；本计划不引入 Markdown AST、ZIP 或导入导出 UI。
- 所有变更路径都通过纯模型函数和单次 `applyActiveDocumentChange`，避免逐块保存与不完整撤销。
