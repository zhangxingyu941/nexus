# Next 结构重构实施计划

> **给自动化开发代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 将项目整理为清晰的 Next.js App Router 结构，并在不改变行为的前提下拆分过大的编辑器模块。

**架构：** 路由层迁移到 `src/app`，功能代码保留在 `src/features/editor`，通过统一出口文件保留已有公开导入路径，同时按职责抽取更聚焦的模块。现有 Vitest 测试套件作为重构回归保护。

**技术栈：** Next.js App Router、React、TypeScript、Vitest、Testing Library、TipTap。

---

### 任务 1：Next App Router 布局

**文件：**
- 移动：`app/**` 到 `src/app/**`
- 修改：`src/app/page.tsx`
- 删除：`src/App.tsx`
- 修改：`src/App.test.tsx`
- 修改：`tsconfig.json`

- [x] 将 App Router 文件移到 `src/app`。
- [x] 将路由处理器导入从相对路径 `../../../src/...` 更新为 `../../server/...` 或功能模块内路径。
- [x] 用靠近路由层的小客户端边界组件替换 Vite 时代的 `src/App.tsx` 包装组件。
- [x] 更新引用包装组件的测试。
- [x] 运行 `npm test -- --run`。

### 任务 2：测试和工具清理

**文件：**
- 移动：`vite.config.ts` 到 `vitest.config.ts`
- 修改：`tsconfig.node.json`
- 修改：`.gitignore`
- 修改：`package.json`
- 修改：`README.md`

- [x] 将测试配置重命名为 `vitest.config.ts`。
- [x] 更新 TypeScript 配置中对重命名后配置的引用。
- [x] 保留测试需要的 Vite/Vitest 依赖，移除 Vite 应用入口残留。
- [x] 忽略生成的日志和构建信息。
- [x] 按新结构和命令重写 README。
- [x] 运行 `npm test -- --run`。

### 任务 3：模型模块拆分

**文件：**
- 创建：`src/features/editor/model/documentTemplates.ts`
- 创建：`src/features/editor/model/documentBlockOperations.ts`
- 创建：`src/features/editor/model/workspaceDocuments.ts`
- 创建：`src/features/editor/model/workspaceQueries.ts`
- 创建：`src/features/editor/model/workspaceNormalization.ts`
- 修改：`src/features/editor/model/documentOperations.ts`
- 修改：`src/features/editor/model/workspaceOperations.ts`

- [x] 抽取文档模板数据和文档创建辅助函数。
- [x] 抽取块变更辅助函数。
- [x] 抽取工作区文档 CRUD 和当前文档辅助函数。
- [x] 抽取工作区搜索、任务、活动、协作者等派生查询辅助函数。
- [x] 抽取持久化工作区规范化和数据载荷修复逻辑。
- [x] 保持原公开文件作为统一出口。
- [x] 运行模型测试。

### 任务 4：组件模块拆分

**文件：**
- 在 `src/features/editor/components/blocks` 下创建文件。
- 在 `src/features/editor/components/document` 下创建文件。
- 在 `src/features/editor/components/sidebar` 下创建文件。
- 修改：`BlockRow.tsx`
- 修改：`DocumentEditor.tsx`
- 修改：`WorkspaceSidebar.tsx`

- [x] 从 `BlockRow.tsx` 抽取展示型/控制型子组件。
- [x] 从 `DocumentEditor.tsx` 抽取文档页头和各类面板。
- [x] 从 `WorkspaceSidebar.tsx` 抽取侧边栏弹窗、面板和文档列表。
- [x] 保持公开组件属性契约稳定。
- [x] 运行组件测试。

### 任务 5：最终验证

**文件：**
- 全部已修改文件。

- [x] 运行 `npm test -- --run`。
- [x] 运行 `npm run build`。
- [x] 检查 `git status --short`。
- [x] 报告结构变化和剩余风险。
