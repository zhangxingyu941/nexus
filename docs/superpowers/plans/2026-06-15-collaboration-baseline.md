# 协同基线实施计划

> **给自动化开发代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 稳定当前 Next 结构，增加经过测试的同步事件层，并接入最小 Yjs/WebSocket 协同能力。

**架构：** 保留现有工作区 reducer 风格纯函数和持久化路径。在模型旁增加事件描述能力，再在其上叠加轻量协同适配层，使 UI 状态继续保持本地优先，同时可以接收来自 Yjs 的远端块内容补丁。

**技术栈：** Next.js App Router、React、TypeScript、Vitest、Yjs、`y-websocket` 或最小 `ws` 服务。

---

### 任务 1：基线验证

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-06-15-next-structure-refactor.md`

- [x] 运行 `pnpm test --run`。
- [x] 运行 `npm run build`。
- [x] 标记结构重构计划中已完成的任务。
- [x] 在 README 增加当前 M2+/M3 前置阶段状态说明。
- [x] 不提交 commit。

### 任务 2：Workspace 事件层

**文件：**
- 创建：`src/features/editor/model/workspaceEvents.ts`
- 创建：`src/features/editor/model/workspaceEvents.test.ts`
- 修改：`src/features/editor/model/workspaceOperations.ts`

- [x] 定义文档和块变更的事件类型。
- [x] 增加从前后工作区快照构造事件的辅助函数。
- [x] 增加把远端块内容补丁应用到工作区的辅助函数。
- [x] 从工作区统一出口导出事件辅助函数。
- [x] 运行 `pnpm test --run src/features/editor/model/workspaceEvents.test.ts`。

### 任务 3：协同映射

**文件：**
- 创建：`src/features/editor/collaboration/collaborationTypes.ts`
- 创建：`src/features/editor/collaboration/yjsWorkspaceMapping.ts`
- 创建：`src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`

- [x] 定义协同连接状态。
- [x] 将文档块内容映射为适合 Yjs 存储的记录结构。
- [x] 将 Yjs 块内容记录转换为工作区内容补丁。
- [x] 运行 `pnpm test --run src/features/editor/collaboration/yjsWorkspaceMapping.test.ts`。

### 任务 4：最小协同运行时

**文件：**
- 创建：`src/features/editor/collaboration/useDocumentCollaboration.ts`
- 创建：`src/features/editor/collaboration/useDocumentCollaboration.test.tsx`
- 修改：`package.json`
- 修改：`src/features/editor/components/EditorPage.tsx`
- 修改：`src/features/editor/components/DocumentEditor.tsx`

- [x] 增加 Yjs 和本地 WebSocket 协同依赖。
- [x] 增加使用 `y-websocket` 命令行工具的开发协同服务脚本。
- [x] 增加 React hook，将当前文档连接到协同房间。
- [x] 在编辑器顶部栏/状态区域展示连接状态。
- [x] 协同服务离线时，本地编辑仍保持可用。
- [x] 使用 `pnpm test --run src/features/editor/collaboration/useDocumentCollaboration.test.tsx` 覆盖“远端补丁使用最新文档快照”的行为。

### 任务 5：最终验证

**文件：**
- 全部已修改文件。

- [x] 运行 `pnpm test --run`。
- [x] 运行 `npm run build`。
- [x] 报告精确验证输出和剩余风险。

### 任务 6：协同加固

**文件：**
- 修改：`src/features/editor/collaboration/useDocumentCollaboration.ts`
- 修改：`src/features/editor/collaboration/yjsWorkspaceMapping.ts`
- 修改：`src/features/editor/model/workspaceEvents.ts`
- 修改：`src/features/editor/components/EditorPage.tsx`
- 修改：`next.config.mjs`
- 创建：`scripts/dev-collab.mjs`
- 创建：`scripts/dev-fullstack.mjs`

- [x] 同步当前文档结构快照，使标题、块新增、删除、排序和类型变化无需刷新即可在其它窗口渲染。
- [x] 在 `EditorPage` 应用远端文档结构补丁时，不切换当前文档。
- [x] 按 `updatedAt` 忽略过期远端块内容记录和过期内容补丁。
- [x] 内容编辑不发布 document-structure 记录，避免结构映射与内容映射互相覆盖。
- [x] 应用较新的远端结构快照时，保留较新的本地块内容。
- [x] 根据当前页面主机名推导默认协同 WebSocket URL，便于局域网测试。
- [x] 增加跨平台开发脚本，同时运行 Next 和 Yjs WebSocket 服务。
- [x] 运行 `pnpm test --run`、`pnpm exec tsc --noEmit` 和 `pnpm build`。
