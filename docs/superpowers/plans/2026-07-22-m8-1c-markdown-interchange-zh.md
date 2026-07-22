# M8.1C Markdown 导入导出实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让有权限的用户以确定性的 Markdown/ZIP 格式导入新文档和导出当前文档，同时保证诊断可定位、附件和链接安全、失败不留下半成品。

**Architecture:** `src/shared` 中的纯函数将 Unified/Remark AST 转换为规范化 `EditorDocument` 草稿，或将授权后的文档快照转换为 Markdown 和资源清单。浏览器只负责文件选择、预览、下载和本地无附件 `.md`；PostgreSQL 模式由服务端重新解析上传的原文/ZIP、在事务内创建文档和附件，并从服务端授权快照流式导出。

**Tech Stack:** TypeScript、Unified、remark-parse、remark-gfm、remark-stringify、fflate、React、Next.js Route Handlers、Vitest、Playwright、PostgreSQL/ObjectStorage。

---

## 文件结构

- `src/shared/markdownDocument.ts`：Markdown AST 与 `EditorDocument` 草稿的纯解析、序列化、诊断和标题解析。
- `src/shared/markdownArchive.ts`：ZIP 相对路径校验、manifest 编解码、大小上限和浏览器/服务端通用 archive 解包。
- `src/shared/markdownDocument.test.ts`、`markdownArchive.test.ts`：黄金文件、诊断、确定性和安全边界。
- `src/server/markdownDocumentTransferService.ts`：授权重解析导入、对象暂存/提升、数据库事务和导出资源读取。
- `src/app/api/workspaces/[workspaceId]/markdown-import/route.ts`：认证写入端点。
- `src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.ts`：认证读取端点。
- `src/features/editor/components/MarkdownTransferDialog.tsx`：文件选择、预览、诊断、确认和下载状态。
- `src/features/editor/components/document/DocumentTopbar.tsx`、`DocumentEditor.tsx`、`EditorPage.tsx`：导入/导出入口与新文档导航。
- `src/features/editor/persistence/markdownTransferRepository.ts`：本地模式 `.md` 与远程 API 的统一调用。

### Task 1: 固定解析和 ZIP 依赖，定义诊断契约

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/shared/markdownDocument.ts`
- Create: `src/shared/markdownDocument.test.ts`

- [ ] **Step 1: 写出失败的诊断与标题测试**

```ts
it("uses the first top-level h1 as title and does not emit it as a body block", () => {
  const result = parseMarkdownDocument("# 设计说明\n\n正文", { filename: "fallback.md", now: 1 });
  expect(result.document?.title).toBe("设计说明");
  expect(result.document?.blocks.map((block) => block.type)).toEqual(["paragraph"]);
});

it("reports line and column for unsafe links and raw HTML", () => {
  const result = parseMarkdownDocument("[x](javascript:alert(1))\n\n<div>bad</div>", { filename: "safe.md", now: 1 });
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "markdown_link_invalid", line: 1, severity: "error" }),
    expect.objectContaining({ code: "markdown_html_unsupported", line: 3, severity: "error" }),
  ]));
  expect(result.document).toBeNull();
});
```

- [ ] **Step 2: 运行测试，确认缺少实现**

Run: `pnpm test --run src/shared/markdownDocument.test.ts`

Expected: FAIL，提示找不到 `markdownDocument`。

- [ ] **Step 3: 安装固定依赖并定义公共类型**

Run: `pnpm add unified@11.0.5 remark-parse@11.0.0 remark-gfm@4.0.1 remark-stringify@11.0.0 fflate@0.8.2`

在 `markdownDocument.ts` 建立如下稳定接口：

```ts
export interface MarkdownDiagnostic {
  code: string;
  column: number;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface MarkdownParseResult {
  diagnostics: MarkdownDiagnostic[];
  document: EditorDocument | null;
  resources: MarkdownResourceReference[];
}

export interface MarkdownSerializeResult {
  diagnostics: MarkdownDiagnostic[];
  markdown: string;
  resources: MarkdownExportResource[];
}
```

`parseMarkdownDocument` 接收 UTF-8 源文、文件名、固定 `now` 和 ID 生成器；先以 Unified + `remarkParse` + `remarkGfm` 生成带 position 的 AST，再把每个节点映射为标准现有 Block。不得使用 DOM、React、`window` 或下载 API。

- [ ] **Step 4: 运行依赖、类型和诊断测试**

Run: `pnpm test --run src/shared/markdownDocument.test.ts && pnpm exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交依赖和基础契约**

```powershell
git add package.json pnpm-lock.yaml src/shared/markdownDocument.ts src/shared/markdownDocument.test.ts
git commit -m "feat: define markdown conversion contract"
```

### Task 2: 以 TDD 完成 Markdown 到 Block 映射

**Files:**
- Modify: `src/shared/markdownDocument.ts`
- Modify: `src/shared/markdownDocument.test.ts`
- Modify: `src/features/editor/model/documentBlockOperations.ts`

- [ ] **Step 1: 添加覆盖支持结构的黄金失败测试**

```ts
it("maps headings, quotes, tasks, lists, tables, code, formulas and hard breaks", () => {
  const result = parseMarkdownDocument([
    "## 二级标题", "> 引用", "- [x] 完成", "1. 第一项", "   - 子项", "", "| A | B |", "| - | - |", "| 1 | 2 |",
    "", "```math", "x^2", "```", "", "a  ", "b",
  ].join("\n"), { filename: "mapping.md", now: 10 });
  expect(result.document?.blocks).toMatchObject([
    { type: "heading", headingLevel: 2 }, { type: "quote" }, { type: "todo", checked: true },
    { type: "numberedList" }, { type: "bulletedList", parentId: expect.any(String) }, { type: "table" },
    { type: "formula", content: "x^2" }, { richText: expect.objectContaining({ type: "doc" }) },
  ]);
});

it("fails atomically for unsupported nodes, depth greater than ten, and more than 5000 blocks", () => {
  expect(parseMarkdownDocument(twelveNestedLists, options).document).toBeNull();
  expect(parseMarkdownDocument(tooManyParagraphs, options).diagnostics[0].code).toBe("markdown_block_limit");
});
```

- [ ] **Step 2: 运行映射测试，确认失败**

Run: `pnpm test --run src/shared/markdownDocument.test.ts`

Expected: FAIL，AST 节点尚未被转换。

- [ ] **Step 3: 实现白名单 AST 遍历**

为 paragraph/heading/blockquote/code/thematicBreak/list/listItem/table/tableRow/tableCell 逐项实现转换。内联 `strong`、`emphasis`、`delete`、`inlineCode`、`link` 转为 M8.1A `RichTextDocument`，统一用 `normalizeRichText` 和 `normalizeRichTextLink`；换行转 `hardBreak`。首个顶层 H1 仅设置文档标题，后续 H1 生成 `heading` block。空正文创建一个空 paragraph。

嵌套 list 维持 `parentId`/`children`，拒绝深度大于 10。GFM table 生成现有 `TableBlockData`；`math` fenced code 生成 formula，其它 fenced code 生成 code。远程图片生成带 alt 的安全 link 并添加 warning，不主动抓取。未知 node、原始 HTML、非安全链接和不支持自定义指令创建带位置的 error，最终将 `document` 置为 `null`，不返回部分草稿。

- [ ] **Step 4: 运行黄金与现有富文本测试**

Run: `pnpm test --run src/shared/markdownDocument.test.ts src/shared/richText.test.ts src/features/editor/model/documentOperations.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 Markdown 解析器**

```powershell
git add src/shared/markdownDocument.ts src/shared/markdownDocument.test.ts src/features/editor/model/documentBlockOperations.ts
git commit -m "feat: parse markdown into editor blocks"
```

### Task 3: 实现确定性导出和兼容性报告

**Files:**
- Modify: `src/shared/markdownDocument.ts`
- Modify: `src/shared/markdownDocument.test.ts`
- Modify: `src/shared/documentShare.ts`

- [ ] **Step 1: 写出导出与再导入失败测试**

```ts
it("serializes documents deterministically and round-trips supported blocks", () => {
  const first = serializeDocumentToMarkdown(document, { attachmentPath: stableAssetPath });
  const second = serializeDocumentToMarkdown(document, { attachmentPath: stableAssetPath });
  expect(second).toEqual(first);
  expect(parseMarkdownDocument(first.markdown, options).document?.blocks.map((block) => block.type))
    .toEqual(document.blocks.filter(isMarkdownRoundTrippable).map((block) => block.type));
});

it("downgrades mentions and complex blocks with warnings rather than silently dropping them", () => {
  const result = serializeDocumentToMarkdown(documentWithMentionToggleAndKanban, options);
  expect(result.markdown).toContain("@林夏");
  expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    "markdown_mention_downgraded", "markdown_toggle_downgraded", "markdown_kanban_downgraded",
  ]));
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/shared/markdownDocument.test.ts`

Expected: FAIL，因为尚无序列化函数。

- [ ] **Step 3: 实现文档到 Markdown 转换**

`serializeDocumentToMarkdown` 按 `document.blocks` 顺序写出 paragraph、heading、quote、code、todo、无序/有序列表、divider、table、formula 和 M8.1A marks/安全链接。list 用 parent 关系生成缩进；关联缺失或循环时产出 error 而不是猜测层级。文档 mention 转公开 `/documents/{publicId}` 链接，person/task/date mention 转 `@label`；toggle、linkCard、kanban 生成可读降级正文并记录 warning；不可读取附件返回 error，禁止生成残缺 archive。

附件路径使用 `assets/<sanitized-name>-<stable-short-hash>`，相同输入始终产生相同路径。导出诊断绝不写进 Markdown 正文；匿名快照继续不暴露内部 mention target 和私有对象 key。

- [ ] **Step 4: 运行序列化、分享与快照测试**

Run: `pnpm test --run src/shared/markdownDocument.test.ts src/server/sharedDocumentSnapshot.test.ts src/shared/documentShare.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交确定性导出器**

```powershell
git add src/shared/markdownDocument.ts src/shared/markdownDocument.test.ts src/shared/documentShare.ts
git commit -m "feat: serialize documents to markdown"
```

### Task 4: 构建安全 ZIP archive 编解码

**Files:**
- Create: `src/shared/markdownArchive.ts`
- Create: `src/shared/markdownArchive.test.ts`
- Modify: `src/shared/markdownDocument.ts`

- [ ] **Step 1: 写出 ZIP 安全失败测试**

```ts
it.each(["../escape", "/absolute", "assets\\escape", "assets/a/../../b"]) 
("rejects unsafe archive path %s", (path) => {
  expect(validateMarkdownArchive([{ path, size: 1 }])).toMatchObject({ ok: false, code: "markdown_archive_path_invalid" });
});

it("requires document.md, verifies manifest hashes, and enforces entries and total size", () => {
  expect(validateMarkdownArchive(validEntries)).toEqual({ ok: true });
  expect(validateMarkdownArchive(entriesWithWrongHash)).toMatchObject({ ok: false, code: "markdown_archive_hash_invalid" });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/shared/markdownArchive.test.ts`

Expected: FAIL，archive 校验器尚不存在。

- [ ] **Step 3: 实现 archive 清单与限制**

```ts
export const MARKDOWN_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MARKDOWN_ARCHIVE_MAX_ENTRIES = 200;
export const MARKDOWN_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export function validateMarkdownArchive(entries: MarkdownArchiveEntry[]): MarkdownArchiveValidationResult;
```

使用 `fflate` 解包；拒绝加密条目、符号链接、绝对路径、反斜杠逃逸、`..`、规范化后重复路径、超过 200 条目、解压后超过 100 MB 和缺失 `document.md`。`manifest.json` 仅包含 formatVersion、相对资源路径、size、sha256；使用 Web Crypto/Node WebCrypto 的 SHA-256 校验所有声明资源。普通 `.md` 限制 2 MB 并要求严格 UTF-8 解码。

- [ ] **Step 4: 运行 archive 与 Markdown 测试**

Run: `pnpm test --run src/shared/markdownArchive.test.ts src/shared/markdownDocument.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 ZIP 编解码**

```powershell
git add src/shared/markdownArchive.ts src/shared/markdownArchive.test.ts src/shared/markdownDocument.ts
git commit -m "feat: validate markdown archives"
```

### Task 5: 服务端原子导入与授权导出

**Files:**
- Create: `src/server/markdownDocumentTransferService.ts`
- Create: `src/server/markdownDocumentTransferService.test.ts`
- Create: `src/app/api/workspaces/[workspaceId]/markdown-import/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/markdown-import/route.test.ts`
- Create: `src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.test.ts`
- Modify: `src/server/applicationServices.ts`
- Modify: `src/server/postgresWorkspaceStore.ts`

- [ ] **Step 1: 写出原子导入/导出失败测试**

```ts
it("reparses the uploaded bytes and leaves no document or object after any attachment failure", async () => {
  await expect(service.importArchive(request)).rejects.toMatchObject({ code: "markdown_attachment_copy_failed" });
  expect(store.createDocument).not.toHaveBeenCalled();
  expect(storage.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^imports\//));
});

it("exports only an authorized server snapshot as markdown or a complete zip", async () => {
  const response = await handlers.export(requestForReader, { workspaceId: "ws", documentId: "doc" });
  expect(response.headers.get("content-type")).toContain("application/zip");
  expect(await unzipResponse(response)).toHaveProperty("document.md");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/server/markdownDocumentTransferService.test.ts src/app/api/workspaces/[workspaceId]/markdown-import/route.test.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.test.ts`

Expected: FAIL，服务和路由尚不存在。

- [ ] **Step 3: 实现服务端导入**

导入路由接受单个 `multipart/form-data` 文件和客户端 SHA-256；先检查会话与工作区写权限、文件扩展名、源大小、摘要，再将 raw `.md` 或 ZIP 交给共享模块重新解码、校验和解析。任何 error 诊断直接返回 `400 { diagnostics }`，不创建文档。成功时由服务生成新文档 ID，使用首 H1/文件名标题，在数据库事务中插入 document、blocks、attachment records；ZIP 附件先写临时 `imports/<requestId>/` 前缀，校验 MIME/尺寸/哈希后提升。事务或提升失败时清理已创建对象并回滚。

- [ ] **Step 4: 实现服务端导出**

导出路由从会话验证读权限，重新读取 PostgreSQL 文档快照和附件，不接收客户端正文。无附件返回 `text/markdown; charset=utf-8`、清洗后的 `<title>.md`；有附件先确保所有对象可读，再流式返回含 `document.md`、`assets/` 和最小 `manifest.json` 的 ZIP。缺失任一对象时返回稳定错误而不是残缺包；匿名 share route 不注册导出。

- [ ] **Step 5: 运行服务/API 与 PostgreSQL 测试**

Run: `pnpm test --run src/server/markdownDocumentTransferService.test.ts src/app/api/workspaces/[workspaceId]/markdown-import/route.test.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.test.ts`

Expected: PASS。若 `TEST_DATABASE_URL` 可用，再运行 `pnpm test:postgres --run src/server/markdownDocumentTransferService.test.ts`。

- [ ] **Step 6: 提交服务端交换能力**

```powershell
git add src/server/markdownDocumentTransferService.ts src/server/markdownDocumentTransferService.test.ts src/app/api/workspaces/[workspaceId]/markdown-import/route.ts src/app/api/workspaces/[workspaceId]/markdown-import/route.test.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.ts src/app/api/workspaces/[workspaceId]/documents/[documentId]/markdown-export/route.test.ts src/server/applicationServices.ts src/server/postgresWorkspaceStore.ts
git commit -m "feat: add atomic markdown transfer APIs"
```

### Task 6: 实现本地/远程传输仓库和编辑器入口

**Files:**
- Create: `src/features/editor/persistence/markdownTransferRepository.ts`
- Create: `src/features/editor/persistence/markdownTransferRepository.test.ts`
- Create: `src/features/editor/components/MarkdownTransferDialog.tsx`
- Create: `src/features/editor/components/MarkdownTransferDialog.test.tsx`
- Modify: `src/features/editor/components/document/DocumentTopbar.tsx`
- Modify: `src/features/editor/components/DocumentEditor.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 写出预览和权限 UI 失败测试**

```tsx
await user.upload(screen.getByLabelText("选择 Markdown 文件"), markdownFile("# 计划\n\n正文"));
expect(await screen.findByText("计划")).toBeVisible();
expect(screen.getByText("1 个块")).toBeVisible();
expect(screen.getByRole("button", { name: "导入为新文档" })).toBeEnabled();

await user.upload(screen.getByLabelText("选择 Markdown 文件"), markdownFile("<script>alert(1)</script>"));
expect(screen.getByRole("button", { name: "导入为新文档" })).toBeDisabled();
expect(screen.getByRole("alert")).toHaveTextContent("不支持原始 HTML");
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test --run src/features/editor/persistence/markdownTransferRepository.test.ts src/features/editor/components/MarkdownTransferDialog.test.tsx`

Expected: FAIL，因为仓库和对话框尚不存在。

- [ ] **Step 3: 实现传输仓库**

本地模式用共享 parser 读取单一 `.md` 并调用既有 `onCreateDocument`/工作区变换创建新文档；隐藏 ZIP 导入入口。远程模式将原文件和 SHA-256 上传到导入 API，使用返回的 public ID 导航。导出本地无附件时在浏览器构造 `Blob` 下载 `.md`；本地有附件仅导出安全可访问 URL 和显式 warning；远程模式打开服务端下载 URL。所有 API 错误保留原文件、预览和诊断，绝不覆盖当前文档。

- [ ] **Step 4: 实现紧凑的工具界面**

在 `DocumentTopbar` 增加两个带 Tooltip 的图标按钮（`FileUp`、`FileDown`），只对有相应写/读权限的登录用户显示；点击打开一个非嵌套、最大宽度受限的 `MarkdownTransferDialog`。导入弹层有文件输入、解析中的固定高度状态、标题/块数/附件数摘要、warning/error 列表、取消和明确“导入为新文档”命令；导出操作直接下载，并在兼容性 warning 时显示可关闭状态。移动端弹层和按钮必须不溢出安全区，匿名共享页没有入口。

- [ ] **Step 5: 运行 UI 和编辑器测试**

Run: `pnpm test --run src/features/editor/persistence/markdownTransferRepository.test.ts src/features/editor/components/MarkdownTransferDialog.test.tsx src/features/editor/components/EditorPage.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交编辑器 Markdown 入口**

```powershell
git add src/features/editor/persistence/markdownTransferRepository.ts src/features/editor/persistence/markdownTransferRepository.test.ts src/features/editor/components/MarkdownTransferDialog.tsx src/features/editor/components/MarkdownTransferDialog.test.tsx src/features/editor/components/document/DocumentTopbar.tsx src/features/editor/components/DocumentEditor.tsx src/features/editor/components/EditorPage.tsx src/styles.css
git commit -m "feat: add markdown transfer interface"
```

### Task 7: 完成 E2E、文档和回归验证

**Files:**
- Create: `e2e/markdown-transfer.spec.ts`
- Modify: `README.md`
- Modify: `docs/m8-status-zh.md`

- [ ] **Step 1: 写出浏览器验收测试**

```ts
test("previews markdown diagnostics, imports a new document, and exports deterministic content", async ({ page }) => {
  await page.getByRole("button", { name: "导入 Markdown" }).click();
  await page.getByLabel("选择 Markdown 文件").setInputFiles(markdownFixture);
  await expect(page.getByRole("button", { name: "导入为新文档" })).toBeEnabled();
  await page.getByRole("button", { name: "导入为新文档" }).click();
  await expect(page.getByRole("heading", { name: "导入标题" })).toBeVisible();
  const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "导出 Markdown" }).click()]);
  expect(await download[0].suggestedFilename()).toBe("导入标题.md");
});
```

- [ ] **Step 2: 运行定向 E2E，确认新增流程先失败**

Run: `pnpm exec playwright test e2e/markdown-transfer.spec.ts`

Expected: FAIL，直到入口、预览和下载实现完成。

- [ ] **Step 3: 补足权限、匿名和性能边界**

增加 E2E/组件断言：viewer 可以导出但不能导入；匿名分享无导入导出 UI；大于 2 MB、损坏 ZIP、路径穿越、非法链接和资源哈希不匹配均显示定位错误且不创建文档。用 500 个普通文本块和 100 MB 边界 archive 验证解析不阻塞主界面并且 UI 不产生横向溢出。

- [ ] **Step 4: 执行完整验证**

Run: `pnpm exec tsc --noEmit && pnpm test --run && pnpm build && pnpm exec playwright test e2e/markdown-transfer.spec.ts`

Expected: 全部通过。若完整 PostgreSQL/对象存储环境可用，额外执行导入附件和 ZIP 导出真实集成测试。

- [ ] **Step 5: 更新公开说明并提交验收**

```powershell
git add e2e/markdown-transfer.spec.ts README.md docs/m8-status-zh.md
git commit -m "test: verify markdown interchange"
```

## 计划自检

- 每个 Markdown 映射、降级、诊断、大小限制、ZIP 路径/哈希、原子服务端事务、权限和本地模式差异均已落实到独立测试任务。
- 本计划不实现多块选择、批量剪贴板或 dnd-kit；这些由 `2026-07-22-m8-1b-multi-block-operations-zh.md` 负责。
- 服务端始终重新解析原始上传字节并从授权快照导出，浏览器预览从不作为安全边界。
