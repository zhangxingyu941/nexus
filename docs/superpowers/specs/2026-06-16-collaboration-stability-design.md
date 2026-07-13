# 协同稳定化与工作区一致性设计

## 目标

下一版本聚焦把现有 M3 协同雏形变成可稳定开发、可重复验证的版本。重点修复三类问题：开发服务启动和退出不可靠、文档切换时协同数据串线或重复同步、工作区弹窗遮挡和滚动越界。

本版本不引入登录、权限、数据库、历史版本、复杂光标或新块类型。

## 当前基线

- `pnpm test --run` 已通过 17 个测试文件、124 个测试。
- `pnpm exec tsc --noEmit` 已通过。
- `pnpm build` 在本机失败于 `.next/trace` 的 `EPERM`，调查显示当前仍有 `pnpm dev:fullstack`、`next dev` 和 `y-websocket` 进程在同一仓库运行，占用 `.next` 输出目录。这是开发进程占用导致的环境问题，不是 TypeScript 或测试失败。
- 当前仓库存在大量未提交改动，本版本继续保持不自动提交。

## 范围

### 1. 开发服务稳定化

- `scripts/dev-collab.mjs` 启动前检查协同端口是否可用。
- 端口被占用时输出明确错误，包含端口号、可用环境变量和处理建议。
- `scripts/dev-fullstack.mjs` 任一子进程退出时要可靠清理另一个子进程树，避免留下 `next dev` 或 `y-websocket`。
- 文档补充：不要在 `next dev` 运行时执行 `next build`；如需构建，先停止开发服务。

### 2. 文档协同隔离

- 协同房间继续以 `document:${documentId}` 为边界。
- 本地发布到 Yjs 的块内容记录必须包含 `documentId`，远端记录只允许应用到同一文档。
- 文档切换时，新文档进入初始同步完成前，不向编辑器暴露旧的 Yjs 文档。
- 远端文档结构补丁只更新目标文档，不切换当前文档。
- 过期远端记录按 `updatedAt` 丢弃，避免旧窗口覆盖新内容。

### 3. 防止重复数据同步

- 当用户从左侧切换文档时，不把上一个当前文档的块内容写入新文档房间。
- 内容变更只发布块内容记录，不发布文档结构记录。
- 文档结构变更只在标题、块新增、删除、排序、类型、任务属性或评论变化时发布。
- 建立回归测试，覆盖“编辑 A 文档后切到 B 文档，B 文档不会出现 A 文档内容”。

### 4. 工作区弹窗布局修复

- 快速搜索、任务中心、最近动态需要有统一的浮层层级和视口边界。
- 弹窗不得遮住彼此；打开一个弹窗时关闭其它工作区弹窗。
- 任务中心内容必须限制在弹窗内部滚动，不允许列表撑破弹窗高度。
- 最近动态和快速搜索也需要内部滚动区，不允许在小屏或窄屏下溢出视口。
- 移动端保持全宽浮层，桌面端保持靠近左侧工作区的工具型弹窗。

## 架构

### 开发服务

`scripts/processTree.mjs` 继续提供跨平台进程树清理。新增端口检测应放在脚本层，而不是业务代码层：

- `dev-collab.mjs` 负责协同端口检测和启动 `y-websocket`。
- `dev-fullstack.mjs` 负责同时启动协同服务和 Next 开发服务，并在任一进程退出时清理另一方。

### 协同层

`src/features/editor/collaboration/useDocumentCollaboration.ts` 继续作为 UI 与 Yjs 的边界：

- 监听当前文档 ID 变化并销毁旧 provider。
- 初始同步完成后才写入本地快照。
- 对外只返回当前房间对应的 `ydoc`。
- 接收远端块内容补丁和文档结构补丁时，交给模型层做 documentId 和 updatedAt 防护。

`src/features/editor/collaboration/yjsWorkspaceMapping.ts` 继续承载纯映射逻辑，避免 React hook 中堆积数据转换。

### 模型层

`src/features/editor/model/workspaceEvents.ts` 和 `workspaceOperations.ts` 继续作为远端补丁落地边界：

- `applyRemoteBlockContentPatch` 只修改目标文档和目标块。
- `applyRemoteDocumentStructurePatch` 只修改目标文档。
- 新增或加强测试时优先覆盖纯函数，再覆盖 hook 连接行为。

### UI 层

工作区弹窗继续拆在 `src/features/editor/components/sidebar/`：

- `QuickSearchDialog.tsx`
- `TaskCenterDialog.tsx`
- `ActivityDialog.tsx`
- `WorkspaceSidebar.tsx`

样式集中修复在 `src/styles.css`，通过稳定的高度、`min-height: 0`、内部 `overflow-y: auto` 和一致的 `z-index` 处理滚动和遮挡。

## 数据流

### 本地编辑同步

1. 用户编辑当前文档块。
2. `EditorPage` 更新本地工作区状态。
3. 保存逻辑继续调用 `saveSyncedWorkspace`。
4. 协同 hook 在当前文档初始同步完成后，把当前文档块内容写入 Yjs。
5. 其它窗口收到同一 `documentId` 的记录后，生成远端补丁并应用。

### 文档切换

1. 用户在左侧选择另一个文档。
2. `EditorPage` 切换 `activeDocumentId`。
3. 协同 hook 销毁旧 provider，清空旧 `ydoc` 暴露值。
4. 新 provider 加入新文档房间。
5. 新房间初始同步完成后，才发布新文档快照。

### 弹窗打开

1. 用户打开快速搜索、任务中心或最近动态。
2. `WorkspaceSidebar` 关闭其它工作区弹窗。
3. 当前弹窗固定在视口内。
4. 弹窗头部和筛选区保持固定高度，列表区域独立滚动。

## 错误处理

- 协同服务离线时，UI 显示离线状态，本地编辑和本地/服务端保存继续可用。
- 协同端口被占用时，脚本直接失败并输出可执行处理建议，不让开发者误以为 Next 卡住。
- 构建遇到 `.next/trace` 占用时，文档说明先停止开发服务再运行 build。
- 收到过期或跨文档远端记录时静默忽略，不弹错误，不污染工作区。

## 测试策略

- 进程脚本：补充端口占用检测和进程清理单元测试。
- 模型层：补充跨文档远端补丁不生效、过期补丁不生效的测试。
- 协同 hook：补充文档切换时旧房间不再发布、新房间同步前不暴露旧 `ydoc` 的测试。
- UI 组件：补充快速搜索、任务中心、最近动态互斥打开和任务中心滚动容器样式回归测试。
- 最终验证：运行 `pnpm test --run`、`pnpm exec tsc --noEmit`；停止开发服务后再运行 `pnpm build`。

## 验收标准

- 端口 1234 被占用时，`pnpm dev:collab` 给出明确错误和处理建议。
- `pnpm dev:fullstack` 退出时不会残留本项目的 Next 或协同子进程。
- 两个窗口打开不同文档时，A 文档内容不会同步到 B 文档。
- 左侧切换项目/文档不会产生重复块或重复内容。
- 快速搜索、任务中心、最近动态不会互相遮挡。
- 任务中心列表只在自身列表区域滚动，不撑破弹窗。
- 测试和类型检查通过。
