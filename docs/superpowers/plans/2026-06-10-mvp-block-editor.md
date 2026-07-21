# MVP 块编辑器实施计划

> **给自动化开发代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 构建第一版本地单机 Notion 风格块编辑器，支持段落、标题、待办、排序和 IndexedDB 持久化。

**架构：** 使用 Vite + React + TypeScript 搭建应用壳。文档行为保留在纯模型函数中，IndexedDB 通过仓储层隔离，React 组件只负责渲染和分发操作。TipTap 负责段落和标题文本编辑；MVP 阶段只保存纯文本。

**技术栈：** React、TypeScript、Vite、TipTap、IndexedDB（idb）、Vitest、Testing Library、fake-indexeddb。

---

## 文件结构

- `package.json`：脚本和依赖。
- `vite.config.ts`：Vite 与 Vitest 配置。
- `src/main.tsx`：React 入口。
- `src/App.tsx`：应用壳。
- `src/features/editor/model/block.ts`：块和文档类型。
- `src/features/editor/model/documentOperations.ts`：纯文档操作。
- `src/features/editor/model/documentOperations.test.ts`：操作测试。
- `src/features/editor/persistence/editorRepository.ts`：IndexedDB 仓储层。
- `src/features/editor/persistence/editorRepository.test.ts`：仓储层测试。
- `src/features/editor/components/EditorPage.tsx`：编辑器状态、加载和保存流程。
- `src/features/editor/components/EditorToolbar.tsx`：标题和保存状态。
- `src/features/editor/components/BlockList.tsx`：按顺序渲染块。
- `src/features/editor/components/BlockRow.tsx`：块控制和编辑器选择。
- `src/features/editor/components/RichTextBlockEditor.tsx`：TipTap 文本编辑封装。
- `src/features/editor/components/TodoBlockEditor.tsx`：待办勾选框和文本输入。
- `src/features/editor/components/EditorPage.test.tsx`：面向用户的编辑器测试。
- `src/test/setup.ts`：测试环境初始化。
- `src/styles.css`：应用样式。

## 任务

### 任务 1：搭建 React TypeScript 项目

**文件：**
- 创建：`package.json`
- 创建：`index.html`
- 创建：`vite.config.ts`
- 创建：`tsconfig.json`
- 创建：`tsconfig.node.json`
- 创建：`src/main.tsx`
- 创建：`src/App.tsx`
- 创建：`src/styles.css`
- 创建：`src/test/setup.ts`

- [ ] **步骤 1：创建 Vite React TypeScript 项目文件**

创建项目并加入 React、Vite、TypeScript、Vitest、Testing Library、TipTap、idb、fake-indexeddb 和 lucide-react 依赖。

- [ ] **步骤 2：安装依赖**

运行：`npm install`
预期：依赖安装无错误。

- [ ] **步骤 3：验证 starter app 可构建**

运行：`npm run build`
预期：TypeScript 与 Vite 构建成功完成。

- [ ] **步骤 4：提交脚手架**

运行：`git add . && git commit -m "chore: scaffold react editor app"`

### 任务 2：用 TDD 实现文档模型

**文件：**
- 创建：`src/features/editor/model/block.ts`
- 创建：`src/features/editor/model/documentOperations.ts`
- 创建：`src/features/editor/model/documentOperations.test.ts`

- [ ] **步骤 1：为文档操作编写失败测试**

测试必须覆盖默认文档、插入、更新内容、修改类型、切换待办、删除和移动。

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm test -- src/features/editor/model/documentOperations.test.ts --run`
预期：失败，因为模型文件缺失或操作尚未实现。

- [ ] **步骤 3：实现模型和操作**

实现类型和纯函数，使测试通过。

- [ ] **步骤 4：运行测试并确认通过**

运行：`npm test -- src/features/editor/model/documentOperations.test.ts --run`
预期：通过。

- [ ] **步骤 5：提交模型**

运行：`git add src/features/editor/model && git commit -m "feat: add block document model"`

### 任务 3：用 TDD 实现 IndexedDB 仓储层

**文件：**
- 创建：`src/features/editor/persistence/editorRepository.ts`
- 创建：`src/features/editor/persistence/editorRepository.test.ts`
- 修改：`src/test/setup.ts`

- [ ] **步骤 1：编写失败的仓储层测试**

测试必须覆盖使用 fake-indexeddb 保存、加载和清空。

- [ ] **步骤 2：运行仓储层测试并确认失败**

运行：`npm test -- src/features/editor/persistence/editorRepository.test.ts --run`
预期：失败，因为仓储层尚未实现。

- [ ] **步骤 3：实现仓储层**

使用 `idb` 打开 `nexus` 数据库，并把一个文档保存到 `default` key 下。

- [ ] **步骤 4：运行仓储层测试并确认通过**

运行：`npm test -- src/features/editor/persistence/editorRepository.test.ts --run`
预期：通过。

- [ ] **步骤 5：提交仓储层**

运行：`git add src/features/editor/persistence src/test/setup.ts && git commit -m "feat: persist editor document locally"`

### 任务 4：构建编辑器 UI 和组件测试

**文件：**
- 创建：`src/features/editor/components/EditorPage.tsx`
- 创建：`src/features/editor/components/EditorToolbar.tsx`
- 创建：`src/features/editor/components/BlockList.tsx`
- 创建：`src/features/editor/components/BlockRow.tsx`
- 创建：`src/features/editor/components/RichTextBlockEditor.tsx`
- 创建：`src/features/editor/components/TodoBlockEditor.tsx`
- 创建：`src/features/editor/components/EditorPage.test.tsx`
- 修改：`src/App.tsx`
- 修改：`src/styles.css`

- [ ] **步骤 1：编写失败的组件测试**

测试必须覆盖初始渲染、编辑内容、新增块、修改块类型、切换待办、删除块和移动块。

- [ ] **步骤 2：运行组件测试并确认失败**

运行：`npm test -- src/features/editor/components/EditorPage.test.tsx --run`
预期：失败，因为 UI 组件尚未实现。

- [ ] **步骤 3：实现编辑器组件**

围绕文档操作构建 UI。段落和标题编辑器使用 TipTap；待办块使用勾选框和文本输入。

- [ ] **步骤 4：运行组件测试并确认通过**

运行：`npm test -- src/features/editor/components/EditorPage.test.tsx --run`
预期：通过。

- [ ] **步骤 5：提交 UI**

运行：`git add src && git commit -m "feat: build local block editor ui"`

### 任务 5：最终验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：补充 README 用法**

记录安装、开发、测试和构建命令。

- [ ] **步骤 2：运行完整测试**

运行：`npm test -- --run`
预期：通过。

- [ ] **步骤 3：运行生产构建**

运行：`npm run build`
预期：通过。

- [ ] **步骤 4：启动开发服务**

运行：`npm run dev -- --host 127.0.0.1`
预期：Vite 在本地 URL 提供应用。

- [ ] **步骤 5：浏览器冒烟测试**

打开本地 URL，确认编辑器可以渲染、可以新增块、编辑内容、转换为待办、切换待办状态并移动块。

- [ ] **步骤 6：提交最终文档**

运行：`git add README.md docs/superpowers/plans/2026-06-10-mvp-block-editor.md && git commit -m "docs: add mvp implementation plan"`
