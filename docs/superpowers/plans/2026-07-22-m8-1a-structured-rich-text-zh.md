# M8.1A 结构化富文本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the current workspace. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为段落、标题、引用和待办建立可校验、可持久化、可协同、可匿名降级的结构化富文本契约，同时保留准确的纯文本投影和旧数据惰性升级。

**Architecture:** `src/shared/richText.ts` 是浏览器、API、PostgreSQL、历史和匿名分享共用的唯一契约实现。Block 模型增加 `richText`，文本块通过独立的 `RichTextUpdate` 回调写入 JSON 与投影，代码及复杂块继续使用现有字符串回调；服务端在写入前再次规范化并重算 `content`，读取异常或旧数据时从纯文本安全恢复。

**Tech Stack:** TypeScript、React 18、Next.js 15、TipTap/ProseMirror、Yjs、PostgreSQL JSONB、IndexedDB、Vitest、Testing Library、Playwright。

---

## 文件结构

新增文件：

- `src/shared/richText.ts`：唯一的富文本类型、规范化、投影、链接安全、匿名降级与大小限制实现。
- `src/shared/richText.test.ts`：公共契约和安全边界单元测试。
- `src/server/richTextPersistence.postgres.test.ts`：真实 PostgreSQL 的 JSONB 迁移与读写验收。
- `src/features/editor/components/richTextPaste.ts`：外部 HTML 与 Nexus 内部剪贴板到单段 inline nodes 的转换器。
- `src/features/editor/components/richTextPaste.test.ts`：粘贴白名单、段落折叠和 mention 来源测试。
- `src/features/editor/components/commands/LinkPopover.tsx`：链接创建、修改、打开、复制和移除的锚定浮层。
- `src/features/editor/components/commands/LinkPopover.test.tsx`：链接浮层表单、键盘和错误状态测试。
- `e2e/structured-rich-text.spec.ts`：M8.1A 专用保存、协同、匿名与响应式浏览器验收。

主要修改文件：

- `src/features/editor/model/block.ts`、`documentBlockOperations.ts`、`workspaceNormalization.ts`、`workspaceEvents.ts`：Block 双字段和惰性升级。
- `src/server/workspacePayload.ts`、API handlers：严格解析 JSON 并由服务端重算 `content`。
- `src/server/database/migrations.ts`：增加可空 `editor_blocks.rich_text JSONB`。
- `src/server/postgresWorkspaceStore.ts`、`postgresDocumentStore.ts`、`postgresDocumentShareStore.ts`：富文本、历史和匿名读取持久化。
- `src/features/editor/collaboration/*`：结构快照显式复制 `richText`，同时保护 XmlFragment 的实时权威地位。
- `src/features/editor/components/RichTextBlockEditor.tsx` 及 Block 回调链：传递 `RichTextUpdate`，代码块保留字符串更新。
- `src/features/editor/components/commands/SelectionToolbar.tsx`、`src/styles.css`：灰白图标工具条和链接浮层样式。
- `src/shared/documentShare.ts`、`src/server/sharedDocumentSnapshot.ts`、`SharedDocumentClient.tsx`：匿名富文本白名单与只读渲染。

---

### Task 1: 共享富文本契约与编解码

**Files:**
- Create: `src/shared/richText.ts`
- Create: `src/shared/richText.test.ts`

- [ ] **Step 1: 写入失败测试**

覆盖以下可观察行为：

```ts
expect(createRichTextFromPlainText("alpha\nbeta")).toEqual({
  type: "doc",
  content: [{
    type: "paragraph",
    content: [
      { type: "text", text: "alpha" },
      { type: "hardBreak" },
      { type: "text", text: "beta" },
    ],
  }],
});
expect(projectRichTextContent(documentWithMention)).toBe("Hi @Ada\nnext");
expect(normalizeRichTextLink("example.com/docs")).toBe("https://example.com/docs");
expect(normalizeRichTextLink("javascript:alert(1)")).toBeNull();
expect(toAnonymousRichText(documentWithMention)).not.toContain("target-1");
expect(() => normalizeRichText(unknownNodeDocument)).toThrow(RichTextValidationError);
expect(getRichTextSize(oversizedDocument)).toBeGreaterThan(RICH_TEXT_MAX_BYTES);
```

同时断言 marks 按 `bold`、`italic`、`strike`、`code`、`link` 排序并去重，空文本删除，相邻相同 marks 文本合并；`person`、`document`、`task`、`date` 四种 mention 均被保留，其他 kind、非法链接和错误根结构被拒绝。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/shared/richText.test.ts`

Expected: FAIL，模块 `src/shared/richText.ts` 尚不存在。

- [ ] **Step 3: 实现稳定公共 API**

导出下列精确接口：

```ts
export const RICH_TEXT_MAX_BYTES = 256 * 1024;
export type MentionKind = "person" | "document" | "task" | "date";
export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" }
  | { type: "code" }
  | { attrs: { href: string }; type: "link" };
export type RichTextInlineNode =
  | { marks?: RichTextMark[]; text: string; type: "text" }
  | { type: "hardBreak" }
  | { attrs: { kind: MentionKind; label: string; targetId: string }; type: "mention" };
export interface RichTextDocument {
  content: [{ content?: RichTextInlineNode[]; type: "paragraph" }];
  type: "doc";
}
export interface RichTextUpdate {
  content: string;
  richText: RichTextDocument;
}
export class RichTextValidationError extends Error {}
export function createRichTextFromPlainText(content: string): RichTextDocument;
export function normalizeRichText(value: unknown): RichTextDocument;
export function projectRichTextContent(document: RichTextDocument): string;
export function normalizeRichTextLink(value: string): string | null;
export function toAnonymousRichText(document: RichTextDocument): RichTextDocument;
export function getRichTextSize(value: unknown): number;
```

`normalizeRichText` 先检查 UTF-8 JSON 大小，再严格校验单 `paragraph` 根、节点和 marks；输出只包含白名单字段。普通域名补 `https://`，只允许 `http:`、`https:`、`mailto:` 与 `/documents/...`，拒绝协议相对地址。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/shared/richText.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交共享契约**

```bash
git add src/shared/richText.ts src/shared/richText.test.ts
git commit -m "feat: define structured rich text contract"
```

### Task 2: Block 模型、归一化与更新操作

**Files:**
- Modify: `src/features/editor/model/block.ts`
- Modify: `src/features/editor/model/workspaceTypes.ts`
- Modify: `src/features/editor/model/documentBlockOperations.ts`
- Modify: `src/features/editor/model/workspaceNormalization.ts`
- Modify: `src/features/editor/model/workspaceEvents.ts`
- Modify: `src/features/editor/collaboration/collaborationTypes.ts`
- Modify: `src/features/editor/collaboration/yjsWorkspaceMapping.ts`
- Modify: `src/features/editor/model/documentOperations.test.ts`
- Modify: `src/features/editor/model/workspaceOperations.test.ts`
- Modify: `src/features/editor/model/workspaceEvents.test.ts`
- Modify: `src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`

- [ ] **Step 1: 写入失败测试**

断言 `createBlock("paragraph", now, "hello")` 自动带标准 JSON，`createBlock("code", ...)` 的 `richText` 为 `null`；旧 StoredBlock 缺字段时文本块惰性生成 JSON；异常 JSON 回退为 `content`；`updateBlockRichText` 在纯文本不变但 marks 变化时仍刷新 block/document 时间；类型转为非文本块时清空 JSON。

文档结构记录显式深复制 `richText`，但旧的 `BlockContentRecord` 继续只承载 `content` 与 `checked`；marks、mention 与 hardBreak 的实时权威源仍是每块的 Yjs `XmlFragment`。延迟结构快照合并时必须保留本地块的 `content`、`richText` 与 `checked`：

```ts
expect(applyRemoteDocumentStructurePatch(localWorkspace, delayedPatch)
  .documents[0].blocks[0].richText).toEqual(localBoldDocument);
expect(createDocumentStructureRecord(document).blocks[0].richText)
  .not.toBe(document.blocks[0].richText);
```

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/features/editor/model/documentOperations.test.ts src/features/editor/model/workspaceOperations.test.ts src/features/editor/model/workspaceEvents.test.ts src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`

Expected: FAIL，`Block.richText` 与 `updateBlockRichText` 尚不存在。

- [ ] **Step 3: 实现模型边界**

`Block` 增加 `richText: RichTextDocument | null`。新增：

```ts
export function isRichTextBlockType(type: BlockType): boolean;
export function updateBlockRichText(
  document: EditorDocument,
  blockId: string,
  update: RichTextUpdate,
  now?: number,
): EditorDocument;
```

所有创建器、复制、远程 clone 和结构补丁显式复制/规范化 `richText`。远程结构合并只对远端新块采用快照正文；已有块始终保留本地 `content`、`richText` 与 `checked`，避免父快照覆盖 XmlFragment。`updateBlockContent` 仅更新代码及复杂块并保证非富文本类型的 `richText` 为 `null`；文本编辑器只调用 `updateBlockRichText`。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/features/editor/model/documentOperations.test.ts src/features/editor/model/workspaceOperations.test.ts src/features/editor/model/workspaceEvents.test.ts src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 Block 双字段模型**

```bash
git add src/features/editor/model src/features/editor/collaboration
git commit -m "feat: add rich text to editor blocks"
```

### Task 3: API 严格校验与 PostgreSQL 幂等迁移

**Files:**
- Modify: `src/server/workspacePayload.ts`
- Modify: `src/server/workspacePayload.test.ts`
- Modify: `src/app/api/documents/handlers.ts`
- Modify: `src/app/api/documents/handlers.test.ts`
- Modify: `src/app/api/workspaces/handlers.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/route.test.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/documents/handlers.test.ts`
- Modify: `src/server/database/migrations.ts`
- Modify: `src/server/database/migrations.test.ts`

- [ ] **Step 1: 写入失败测试**

断言 API 接受合法富文本，但对未知 node/mark、危险链接、超 256 KB、错误根结构和非文本块携带 JSON 返回 `400`；客户端伪造的 `content` 在验证结果中被规范投影覆盖。迁移测试断言只执行一次：

```sql
ALTER TABLE editor_blocks ADD COLUMN rich_text JSONB
```

且不存在全表 `UPDATE editor_blocks SET rich_text ...`。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/server/workspacePayload.test.ts src/app/api/documents/handlers.test.ts "src/app/api/workspaces/[workspaceId]/route.test.ts" "src/app/api/workspaces/[workspaceId]/documents/handlers.test.ts" src/server/database/migrations.test.ts`

Expected: FAIL，payload 尚未校验/规范化 `richText`，迁移尚未登记。

- [ ] **Step 3: 实现严格解析**

把布尔型校验替换/补充为返回规范化快照的解析函数：

```ts
export function parseDocumentPayload(value: unknown): EditorDocument;
export function parseWorkspacePayload(value: unknown): EditorWorkspace;
```

保留 `isDocumentPayload`/`isWorkspacePayload` 给现有调用方，但 API handler 使用 parse 函数捕获 `RichTextValidationError` 并返回稳定中文错误。文本类块必须携带合法 `richText`，解析结果从 JSON 重算 `content`；代码和复杂块的字段必须为 `null`。旧数据兼容只发生在 PostgreSQL、IndexedDB 与历史快照读取边界，不放宽新的 API 写入契约。

增加 migration id `2026-07-22-structured-rich-text`，在迁移锁事务内执行可空 JSONB 列新增并写入 `schema_migrations`。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/server/workspacePayload.test.ts src/app/api/documents/handlers.test.ts "src/app/api/workspaces/[workspaceId]/route.test.ts" "src/app/api/workspaces/[workspaceId]/documents/handlers.test.ts" src/server/database/migrations.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 API 契约与迁移**

```bash
git add src/server/workspacePayload.ts src/server/workspacePayload.test.ts src/app/api/documents/handlers.ts src/app/api/documents/handlers.test.ts src/app/api/workspaces/handlers.ts "src/app/api/workspaces/[workspaceId]/route.test.ts" "src/app/api/workspaces/[workspaceId]/documents/handlers.test.ts" src/server/database/migrations.ts src/server/database/migrations.test.ts
git commit -m "feat: validate and migrate rich text payloads"
```

### Task 4: PostgreSQL 文档、工作区与历史读写

**Files:**
- Modify: `src/server/postgresDocumentStore.ts`
- Modify: `src/server/postgresDocumentStore.test.ts`
- Modify: `src/server/postgresWorkspaceStore.ts`
- Modify: `src/server/postgresWorkspaceStore.test.ts`
- Create: `src/server/richTextPersistence.postgres.test.ts`

- [ ] **Step 1: 写入失败测试**

验证 insert/update 参数包含规范化 `rich_text::jsonb`，写入时忽略伪造的纯文本投影；读取旧 `NULL` 或异常 JSONB 时从 `content` 生成安全文档；历史恢复保留 marks/mention/hardBreak，旧历史缺 JSON 时惰性升级；仅 marks 变化会创建不同 snapshot hash。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/server/postgresDocumentStore.test.ts src/server/postgresWorkspaceStore.test.ts`

Expected: FAIL，SQL 尚未选择或写入 `rich_text`。

- [ ] **Step 3: 实现存储规范化**

两个 store 的 SELECT 增加 `rich_text`；行映射统一调用共享规范化函数并对异常值回退 `createRichTextFromPlainText(content)`。INSERT 列顺序增加 `rich_text`，值使用 `JSON.stringify(block.richText)` 或 `null`。保存/版本化前构造规范化 document，确保数据库、响应和历史 snapshot 中的 `content` 均来自 JSON。

- [ ] **Step 4: 验证单元 GREEN**

Run: `pnpm test --run src/server/postgresDocumentStore.test.ts src/server/postgresWorkspaceStore.test.ts`

Expected: PASS。

- [ ] **Step 5: 验证真实 PostgreSQL**

Run: `pnpm test:postgres -- src/server/richTextPersistence.postgres.test.ts`

Expected: 在可用测试数据库上 PASS；若环境未提供 PostgreSQL，记录明确阻塞信息，不用 pg-mem 结果冒充真实数据库。

- [ ] **Step 6: 提交 PostgreSQL 与历史读写**

```bash
git add src/server/postgresDocumentStore.ts src/server/postgresDocumentStore.test.ts src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts src/server/richTextPersistence.postgres.test.ts
git commit -m "feat: persist structured rich text in postgres"
```

### Task 5: IndexedDB 与匿名分享兼容

**Files:**
- Modify: `src/features/editor/persistence/localWorkspaceRepository.test.ts`
- Modify: `src/server/sharedDocumentSnapshot.ts`
- Modify: `src/server/sharedDocumentSnapshot.test.ts`
- Modify: `src/shared/documentShare.ts`
- Modify: `src/server/postgresDocumentShareStore.ts`
- Modify: `src/server/postgresDocumentShareStore.test.ts`
- Modify: `src/features/editor/components/shared/SharedDocumentClient.tsx`
- Modify: `src/features/editor/components/shared/SharedDocumentClient.test.tsx`

- [ ] **Step 1: 写入失败测试**

断言 IndexedDB 仍为 version 2，旧对象读取时生成富文本，保存后 JSON 原样保留。匿名快照保留 bold/link/hardBreak，把 mention 转换为普通 `@label` 文本且响应 JSON 不含 `targetId`/`kind`；共享页面只读渲染格式并且没有 toolbar/link 编辑入口。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/features/editor/persistence/localWorkspaceRepository.test.ts src/server/sharedDocumentSnapshot.test.ts src/server/postgresDocumentShareStore.test.ts src/features/editor/components/shared/SharedDocumentClient.test.tsx`

Expected: FAIL，共享契约与渲染尚未携带 `richText`。

- [ ] **Step 3: 实现兼容和隐私降级**

`SharedBlock` 增加 `richText: RichTextDocument | null`。快照构造对文本块调用 `toAnonymousRichText` 并重新投影正文；share store 读取 `rich_text` 时按普通存储回退；`toEditorBlock` 显式复制匿名 JSON。IndexedDB 不升级版本，仅依赖 `normalizeWorkspace` 的惰性转换。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/features/editor/persistence/localWorkspaceRepository.test.ts src/server/sharedDocumentSnapshot.test.ts src/server/postgresDocumentShareStore.test.ts src/features/editor/components/shared/SharedDocumentClient.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交本地存储与匿名降级**

```bash
git add src/features/editor/persistence/localWorkspaceRepository.test.ts src/server/sharedDocumentSnapshot.ts src/server/sharedDocumentSnapshot.test.ts src/shared/documentShare.ts src/server/postgresDocumentShareStore.ts src/server/postgresDocumentShareStore.test.ts src/features/editor/components/shared/SharedDocumentClient.tsx src/features/editor/components/shared/SharedDocumentClient.test.tsx
git commit -m "feat: preserve safe rich text in shared documents"
```

### Task 6: 富文本更新回调链

**Files:**
- Modify: `src/features/editor/components/TodoBlockEditor.tsx`
- Modify: `src/features/editor/components/BlockRow.tsx`
- Modify: `src/features/editor/components/BlockList.tsx`
- Modify: `src/features/editor/components/DocumentEditor.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/app/documents/[documentId]/DocumentRouteClient.tsx`
- Modify: `src/features/editor/components/BlockRow.test.tsx`
- Modify: `src/features/editor/components/EditorPage.test.tsx`
- Modify: `src/app/documents/[documentId]/DocumentRouteClient.test.tsx`

- [ ] **Step 1: 写入失败测试**

断言段落/标题/引用/待办把 `{ content, richText }` 逐层传入 `updateBlockRichText`，代码块仍调用 `onChangeContent(string)`；mention 搜索继续从 `update.content` 读取纯文本。只改变 marks 时顶层 workspace/document 仍更新并进入保存队列。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/features/editor/components/BlockRow.test.tsx src/features/editor/components/EditorPage.test.tsx src/app/documents/[documentId]/DocumentRouteClient.test.tsx`

Expected: FAIL，组件尚无 `onChangeRichText` 属性。

- [ ] **Step 3: 实现双通道回调**

在 `BlockRow`、`BlockList`、`DocumentEditor` 增加：

```ts
onChangeRichText: (blockId: string, update: RichTextUpdate) => void;
```

`EditorPage` 和独立文档路由调用 `updateBlockRichText`。现有 `onChangeContent` 不改签名，只供代码/附件/列表/切换/公式/链接卡等非 M8.1A 类型使用。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/features/editor/components/BlockRow.test.tsx src/features/editor/components/EditorPage.test.tsx src/app/documents/[documentId]/DocumentRouteClient.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交富文本回调链**

```bash
git add src/features/editor/components/TodoBlockEditor.tsx src/features/editor/components/BlockRow.tsx src/features/editor/components/BlockList.tsx src/features/editor/components/DocumentEditor.tsx src/features/editor/components/EditorPage.tsx "src/app/documents/[documentId]/DocumentRouteClient.tsx" src/features/editor/components/BlockRow.test.tsx src/features/editor/components/EditorPage.test.tsx "src/app/documents/[documentId]/DocumentRouteClient.test.tsx"
git commit -m "feat: propagate rich text block updates"
```

### Task 7: TipTap 结构化更新、粘贴与 Yjs 权威源

**Files:**
- Create: `src/features/editor/components/richTextPaste.ts`
- Create: `src/features/editor/components/richTextPaste.test.ts`
- Modify: `src/features/editor/extensions/mention.ts`
- Modify: `src/features/editor/components/RichTextBlockEditor.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.test.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.integration.test.tsx`
- Modify: `src/features/editor/components/EditorPageCollaboration.test.tsx`

- [ ] **Step 1: 写入失败测试**

覆盖：初始化优先使用 `richText`；`onUpdate` 对 `editor.getJSON()` 规范化并上报投影；纯文本不变的 bold 变化仍回调；`Shift+Enter` 产生 `hardBreak` 而普通 `Enter` 创建下一块；非协同时只有未聚焦才接收父 JSON；协同时空 fragment 只种子一次并忽略延迟父快照；两个编辑器通过同一 Y.Doc 同步 marks、四种 mention 与 hardBreak。

粘贴测试传入外部 HTML，期望脚本/样式/事件/未知 marks 删除，多段转 hardBreak，危险链接退化为普通文本，外部伪 mention 变文本；只有 `application/x-nexus-rich-text` 中通过共享校验的 mention 才保留。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/features/editor/components/richTextPaste.test.ts src/features/editor/components/RichTextBlockEditor.test.tsx src/features/editor/components/RichTextBlockEditor.integration.test.tsx src/features/editor/components/EditorPageCollaboration.test.tsx`

Expected: FAIL，编辑器仍只上报 `getText()`。

- [ ] **Step 3: 实现编辑器数据流**

`RichTextBlockEditor` 使用 props 联合：文本 variant 接收 `richText: RichTextDocument` 与 `onChange(RichTextUpdate)`，code variant 接收 `richText: null` 与 `onChange(string)`。文本 variant 用 JSON 初始化；code variant 保留纯文本模式、禁用 marks/mention/工具条并上报字符串通道。文本 `onUpdate` 始终调用共享 normalize/project。协同模式一旦绑定 fragment 就不执行父级 `setContent`；空 fragment 只在首次绑定时写入持久化 JSON。

粘贴处理使用 DOM API 遍历节点白名单，不直接拼 HTML；selection 内容通过 TipTap `insertContent` 插入单 paragraph 的 inline nodes。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/features/editor/components/richTextPaste.test.ts src/features/editor/components/RichTextBlockEditor.test.tsx src/features/editor/components/RichTextBlockEditor.integration.test.tsx src/features/editor/components/EditorPageCollaboration.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交 TipTap 与 Yjs 数据流**

```bash
git add src/features/editor/components/richTextPaste.ts src/features/editor/components/richTextPaste.test.ts src/features/editor/extensions/mention.ts src/features/editor/components/RichTextBlockEditor.tsx src/features/editor/components/RichTextBlockEditor.test.tsx src/features/editor/components/RichTextBlockEditor.integration.test.tsx src/features/editor/components/EditorPageCollaboration.test.tsx
git commit -m "feat: persist tiptap rich text updates"
```

### Task 8: 灰白选区工具条与链接锚定浮层

**Files:**
- Modify: `src/features/editor/components/commands/SelectionToolbar.tsx`
- Modify: `src/features/editor/components/commands/SelectionToolbar.test.tsx`
- Create: `src/features/editor/components/commands/LinkPopover.tsx`
- Create: `src/features/editor/components/commands/LinkPopover.test.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.tsx`
- Modify: `src/features/editor/components/RichTextBlockEditor.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 写入失败测试**

断言 Lucide `Bold`、`Italic`、`Strikethrough`、`Code2`、`Link2`、`MessageSquare` 按钮均有 tooltip、`aria-label`、固定尺寸与 `aria-pressed`；组合 marks 可同时激活；收起选区/失焦/只读隐藏。

链接浮层测试覆盖 Enter 保存、Escape 关闭并恢复焦点、非法值显示字段错误且文档不变、空值移除、已有链接的打开/复制/修改/移除；打开使用 `_blank` 和 `noreferrer`。

- [ ] **Step 2: 验证 RED**

Run: `pnpm test --run src/features/editor/components/commands/SelectionToolbar.test.tsx src/features/editor/components/commands/LinkPopover.test.tsx src/features/editor/components/RichTextBlockEditor.test.tsx`

Expected: FAIL，现有工具条仍是文本按钮且使用 `window.prompt`。

- [ ] **Step 3: 实现可访问 UI**

`SelectionToolbar` 接收 `activeMarks` 与 `onCode`，用项目 Tooltip 和 Lucide 图标渲染。`LinkPopover` 是固定定位的锚定表单，边界位置用 `clamp()` 保持在 viewport 内；打开时保存 `{ from, to }`，所有链接命令先恢复该选区。工具条 `pointerdown` 阻止编辑器选区丢失，链接输入例外。

CSS 使用白色/`zinc-50`、`zinc-200` 边框、`zinc-800` 图标、浅灰激活态和轻阴影；按钮保持稳定尺寸，移动端浮层宽度限制为 `calc(100vw - 24px)`。

- [ ] **Step 4: 验证 GREEN**

Run: `pnpm test --run src/features/editor/components/commands/SelectionToolbar.test.tsx src/features/editor/components/commands/LinkPopover.test.tsx src/features/editor/components/RichTextBlockEditor.test.tsx`

Expected: PASS，且测试中不存在 `window.prompt` 调用。

- [ ] **Step 5: 提交富文本工具界面**

```bash
git add src/features/editor/components/commands/SelectionToolbar.tsx src/features/editor/components/commands/SelectionToolbar.test.tsx src/features/editor/components/commands/LinkPopover.tsx src/features/editor/components/commands/LinkPopover.test.tsx src/features/editor/components/RichTextBlockEditor.tsx src/features/editor/components/RichTextBlockEditor.test.tsx src/styles.css
git commit -m "feat: add rich text selection tools"
```

### Task 9: M8.1A 专用浏览器验收

**Files:**
- Create: `e2e/structured-rich-text.spec.ts`

- [ ] **Step 1: 写入失败的 Playwright 场景**

新文件使用唯一标题和块内容隔离数据，测试名固定为：

```ts
test("M8.1A saves marks links and hard breaks across reload and history", async ({ page }) => {
  // 创建文档后依次应用 bold、italic、inline code 与安全链接，Shift+Enter 插入块内换行。
  // 等待“已保存”，刷新后断言 strong/em/code/a/br，再恢复旧版本并断言 JSON 对应格式。
});

test("M8.1A syncs marks mentions and hard breaks between two browsers", async ({ browser }) => {
  // 两个已登录 context 打开同一文档；一端格式化并插入 mention，另一端等待相同 DOM 结构。
});

test("M8.1A anonymizes mention targets while preserving public formatting", async ({ page, request }) => {
  // 通过文档 API 保存含 bold、link 和 person mention 的 richText，创建匿名链接。
  // API JSON 不含 targetId/kind；匿名页面保留 strong/a 和文本 @label，且无编辑入口。
});

test("M8.1A keeps the gray toolbar and link popover inside responsive viewports", async ({ page }, testInfo) => {
  // 在 1440x1000 与 390x844 下选择文本并打开链接浮层。
  // 分别断言 boundingBox 位于 viewport 内、documentElement.scrollWidth 不超宽，并保存截图。
});
```

实现时直接复用 `e2e/support.ts` 的 `createAcceptanceIdentity`、`registerAndVerify` 与 `cleanupAcceptanceData`，不从 M6 失败场景复制等待时序。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec playwright test e2e/structured-rich-text.spec.ts`

Expected: 至少因富文本尚未持久化、匿名 mention 未降级或链接仍使用 prompt 而 FAIL。

- [ ] **Step 3: 在前述任务完成后重跑专用 E2E**

Run: `pnpm exec playwright test e2e/structured-rich-text.spec.ts`

Expected: 4 项 PASS；不运行包含 10 项既有 M6 基线失败的完整 E2E。

- [ ] **Step 4: 执行浏览器视觉检查**

使用 `browser:control-in-app-browser` 在桌面与移动视口打开本地页面，确认工具条和浮层采用白色/浅灰面板而非纯黑或深灰背景；检查无水平溢出、无控件重叠、选区关键内容可见、匿名页面没有编辑控件。保留 Playwright 截图作为验收证据。

- [ ] **Step 5: 提交专用 E2E**

```bash
git add e2e/structured-rich-text.spec.ts
git commit -m "test: verify M8.1A structured rich text"
```

### Task 10: 全量非 E2E 回归、构建与状态文档

**Files:**
- Create: `docs/m8-status-zh.md`
- Modify: `docs/prd.md`
- Modify: `README.md`

- [ ] **Step 1: 运行完整 Vitest**

Run: `pnpm test --run`

Expected: 所有单元、组件、API 和 pg-mem 测试 PASS。

- [ ] **Step 2: 运行真实 PostgreSQL 套件**

Run: `pnpm test:postgres`

Expected: 包括 `richTextPersistence.postgres.test.ts` 在内的全部真实 PostgreSQL 测试 PASS；若 `TEST_DATABASE_URL` 未配置，明确记录为未执行，不用跳过结果声明通过。

- [ ] **Step 3: 运行类型和生产构建**

Run: `pnpm exec tsc --noEmit`

Expected: exit 0。

Run: `pnpm build`

Expected: exit 0。

- [ ] **Step 4: 验证迁移回滚条件**

确认 `editor_blocks.content` 仍为非空 TEXT、`rich_text` 为可空 JSONB、迁移没有删除或重写 `content`。用旧格式行（`rich_text IS NULL`）执行读取测试，确保新服务仍生成安全富文本；不实际删除数据库列。

- [ ] **Step 5: 更新中文进度文档**

`docs/m8-status-zh.md` 记录 M8.1A 已完成范围、验证命令与结果、M8.1B/M8.1C/M8.2/M8.3 待办；`docs/prd.md` 和 `README.md` 只更新对应里程碑状态，不改写 M6/M7 历史。

- [ ] **Step 6: 检查并提交状态文档**

Run: `git diff --check`

Expected: 无空白错误。

```bash
git add docs/m8-status-zh.md docs/prd.md README.md
git commit -m "docs: record M8.1A completion"
```
