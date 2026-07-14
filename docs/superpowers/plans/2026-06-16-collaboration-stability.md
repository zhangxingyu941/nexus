# 协同稳定化与工作区一致性实施计划

> **给自动化开发代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 修复协同开发服务、文档切换数据隔离和工作区弹窗滚动/遮挡问题，让 M3 协同雏形可稳定开发和回归验证。

**架构：** 保留当前 Next App Router、React 编辑器和 Yjs 协同边界。脚本稳定化放在 `scripts/`，协同隔离回归覆盖模型与 hook，弹窗互斥和滚动约束分别由组件测试和 CSS 结构测试保护。

**技术栈：** Next.js App Router、React、TypeScript、Vitest、Testing Library、Yjs、`y-websocket`、Node.js 脚本。

---

### 任务 1：协同开发服务端口检测

**文件：**
- 创建：`scripts/devServerUtils.mjs`
- 修改：`scripts/processTree.test.ts`
- 修改：`scripts/dev-collab.mjs`

- [x] **步骤 1：写失败测试**

在 `scripts/processTree.test.ts` 中新增测试，期望存在端口检测工具：

```ts
import { createServer } from "node:net";
import { describe, expect, test, vi } from "vitest";

import {
  formatPortInUseMessage,
  isTcpPortAvailable,
  resolveExecutable,
  stopProcessTree,
} from "./processTree.mjs";

test("detects when a tcp port is already occupied", async () => {
  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected a tcp address.");
  }

  await expect(isTcpPortAvailable("127.0.0.1", String(address.port))).resolves.toBe(false);

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("formats a clear collaboration port conflict message", () => {
  expect(formatPortInUseMessage("0.0.0.0", "1234")).toContain("协同服务端口 1234 已被占用");
  expect(formatPortInUseMessage("0.0.0.0", "1234")).toContain("COLLAB_PORT");
});
```

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm test --run scripts/processTree.test.ts`

预期：失败，因为 `isTcpPortAvailable` 和 `formatPortInUseMessage` 尚未导出。

- [x] **步骤 3：实现端口检测**

在 `scripts/processTree.mjs` 中新增 `isTcpPortAvailable` 和 `formatPortInUseMessage`，用 `node:net` 真实监听端口检测占用。

- [x] **步骤 4：接入 `dev-collab`**

`scripts/dev-collab.mjs` 启动 `y-websocket` 前先检查端口。端口不可用时输出 `formatPortInUseMessage(host, port)` 并以非零退出码结束，不再启动子进程。

- [x] **步骤 5：运行测试确认通过**

运行：`pnpm test --run scripts/processTree.test.ts`

预期：通过。

### 任务 2：工作区弹窗互斥

**文件：**
- 修改：`src/features/editor/components/EditorPage.test.tsx`
- 修改：`src/features/editor/components/WorkspaceSidebar.tsx`

- [x] **步骤 1：写失败测试**

在 `EditorPage.test.tsx` 中新增测试：

```ts
it("keeps workspace utility dialogs mutually exclusive", async () => {
  const user = userEvent.setup();
  await renderEditor();

  await user.click(screen.getByRole("button", { name: "最近更新" }));
  expect(screen.getByRole("dialog", { name: "最近动态" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "新建文档" }));

  expect(screen.queryByRole("dialog", { name: "最近动态" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "新建文档" })).toBeInTheDocument();
});
```

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm test --run src/features/editor/components/EditorPage.test.tsx -t "keeps workspace utility dialogs mutually exclusive"`

预期：失败，因为打开模板弹窗时不会关闭最近动态。

- [x] **步骤 3：实现互斥打开**

在 `WorkspaceSidebar.tsx` 中新增 `openTemplateCenter`，打开模板弹窗前关闭快速搜索、任务中心和最近动态，并在按钮回调中使用它。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm test --run src/features/editor/components/EditorPage.test.tsx -t "keeps workspace utility dialogs mutually exclusive"`

预期：通过。

### 任务 3：弹窗滚动和层级样式

**文件：**
- 修改：`src/styles.test.ts`
- 修改：`src/styles.css`

- [x] **步骤 1：写失败测试**

在 `src/styles.test.ts` 中新增或扩展测试，要求快速搜索、任务中心、最近动态都使用视口内固定高度、内部滚动区和更高浮层：

```ts
it("keeps workspace dialogs constrained to the viewport with internal scrolling", () => {
  const css = readFileSync(join(currentDir, "styles.css"), "utf8");
  const quickDialogRule = getCssRule(css, ".quick-search-dialog");
  const quickResultsRule = getCssRule(css, ".quick-search-results");
  const activityDialogRule = getCssRule(css, ".activity-dialog");
  const activityListRule = getCssRule(css, ".activity-list");

  expect(quickDialogRule).toMatch(/z-index:\s*130\b/);
  expect(quickDialogRule).toMatch(/display:\s*grid\b/);
  expect(quickDialogRule).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  expect(quickDialogRule).toMatch(/overflow:\s*hidden\b/);
  expect(quickResultsRule).toMatch(/min-height:\s*0\b/);
  expect(quickResultsRule).toMatch(/max-height:\s*none\b/);

  expect(activityDialogRule).toMatch(/z-index:\s*130\b/);
  expect(activityDialogRule).toMatch(/display:\s*grid\b/);
  expect(activityDialogRule).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  expect(activityDialogRule).toMatch(/overflow:\s*hidden\b/);
  expect(activityListRule).toMatch(/min-height:\s*0\b/);
  expect(activityListRule).toMatch(/max-height:\s*none\b/);
});
```

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm test --run src/styles.test.ts`

预期：失败，因为当前快速搜索和最近动态没有完整内部滚动约束，浮层层级也低于新要求。

- [x] **步骤 3：实现样式约束**

更新 `src/styles.css`：
- `.quick-search-dialog` 增加 `display: grid`、`grid-template-rows: auto minmax(0, 1fr)`、`max-height`、`overflow: hidden`、`z-index: 130`。
- `.quick-search-results` 增加 `min-height: 0`，把 `max-height` 改为 `none`。
- `.task-center-dialog, .activity-dialog` 提升到 `z-index: 130`。
- `.activity-dialog` 增加 grid 布局、固定高度和 `overflow: hidden`。
- `.activity-list` 增加 `min-height: 0`，把 `max-height` 改为 `none`。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm test --run src/styles.test.ts`

预期：通过。

### 任务 4：协同隔离回归

**文件：**
- 修改：`src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- 修改：`src/features/editor/model/workspaceEvents.test.ts`
- 视测试结果修改：`src/features/editor/collaboration/useDocumentCollaboration.ts`
- 视测试结果修改：`src/features/editor/model/workspaceEvents.ts`

- [x] **步骤 1：写回归测试**

补充测试覆盖：
- 切换到第二个文档后，第二个 provider 初始同步只发布第二个文档块记录。
- 跨文档远端块内容补丁不会修改当前工作区。

- [x] **步骤 2：运行测试观察结果**

运行：`pnpm test --run src/features/editor/collaboration/useDocumentCollaboration.test.tsx src/features/editor/model/workspaceEvents.test.ts`

预期：如果测试失败，按 TDD 修复；如果测试已经通过，只保留测试作为回归保护，不改生产代码。

- [x] **步骤 3：按失败点做最小实现**

仅在测试失败时修改协同 hook 或模型层，保持 documentId 和 updatedAt 防护集中在现有边界。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm test --run src/features/editor/collaboration/useDocumentCollaboration.test.tsx src/features/editor/model/workspaceEvents.test.ts`

预期：通过。

### 任务 5：文档和最终验证

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-06-16-collaboration-stability.md`

- [x] **步骤 1：更新 README**

补充协同服务端口占用和构建前停止开发服务的说明。

- [x] **步骤 2：运行完整验证**

运行：
- `pnpm test --run`
- `pnpm exec tsc --noEmit`

如果本机仍在运行 `pnpm dev` 或 `pnpm dev:fullstack`，不运行 `pnpm build`，并报告原因；如果没有开发服务占用 `.next`，运行 `pnpm build`。

- [x] **步骤 3：检查状态**

运行：`git status --short`

预期：只报告本次计划相关变更和已有未提交变更，不回滚用户改动。
