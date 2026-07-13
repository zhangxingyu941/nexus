# 多文档协作布局实施计划

> **给自动化开发代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 构建已确认的 Notion 风格多文档工作区，包含左侧页面树、协作顶部栏和聚焦的右侧块编辑器。

**架构：** 新增 `EditorWorkspace` 模型，持有多个 `EditorDocument` 和当前文档 ID。保留现有纯文档操作，通过工作区操作组合使用；IndexedDB 保存整份工作区，并兼容旧的单文档 key 迁移。

**技术栈：** React、TypeScript、TipTap、IndexedDB（`idb`）、Vitest、Testing Library、Vite。

---

### 任务 1：工作区模型

**文件：**
- 修改：`src/features/editor/model/block.ts`
- 创建：`src/features/editor/model/workspaceOperations.ts`
- 创建：`src/features/editor/model/workspaceOperations.test.ts`

- [ ] **步骤 1：为工作区操作编写失败测试**

添加以下测试：

```ts
import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  getActiveDocument,
  switchActiveDocument,
  updateActiveDocument,
} from "./workspaceOperations";
import { updateBlockContent } from "./documentOperations";

describe("workspace 操作", () => {
  it("创建包含一个当前文档的默认工作区", () => {
    const workspace = createDefaultWorkspace(1000);

    expect(workspace.activeDocumentId).toBe("document-1000");
    expect(workspace.updatedAt).toBe(1000);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0]).toMatchObject({
      id: "document-1000",
      title: "未命名文档",
      updatedAt: 1000,
    });
  });

  it("创建并选中新文档", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000);

    expect(next.documents).toHaveLength(2);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(getActiveDocument(next)?.id).toBe("document-2000");
  });

  it("只允许切换到已存在文档", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const switched = switchActiveDocument(workspace, "document-1000", 3000);
    const unchanged = switchActiveDocument(switched, "missing", 4000);

    expect(switched.activeDocumentId).toBe("document-1000");
    expect(switched.updatedAt).toBe(3000);
    expect(unchanged).toBe(switched);
  });

  it("只更新当前文档", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const activeId = workspace.activeDocumentId;
    const next = updateActiveDocument(
      workspace,
      (document) => updateBlockContent(document, document.blocks[0].id, "当前文档内容", 3000),
      3000,
    );

    expect(getActiveDocument(next)?.blocks[0].content).toBe("当前文档内容");
    expect(next.documents.find((document) => document.id !== activeId)?.blocks[0].content).toBe("");
  });
});
```

- [ ] **步骤 2：确认测试失败**

运行：`npm test -- src/features/editor/model/workspaceOperations.test.ts --run`

预期：失败，因为 `workspaceOperations.ts` 尚不存在。

- [ ] **步骤 3：实现工作区操作**

在 `block.ts` 中加入 `EditorWorkspace`，并在 `workspaceOperations.ts` 中实现纯辅助函数。复用 `createDefaultDocument`；如需测试确定性 ID，可增加可选文档 ID 参数。

- [ ] **步骤 4：确认模型测试通过**

运行：`npm test -- src/features/editor/model/workspaceOperations.test.ts --run`

预期：通过。

### 任务 2：工作区持久化

**文件：**
- 修改：`src/features/editor/persistence/editorRepository.ts`
- 修改：`src/features/editor/persistence/editorRepository.test.ts`

- [ ] **步骤 1：编写失败的持久化测试**

覆盖保存/加载工作区、清空工作区，以及把旧单文档数据迁移为工作区。

- [ ] **步骤 2：确认持久化测试失败**

运行：`npm test -- src/features/editor/persistence/editorRepository.test.ts --run`

预期：失败，因为 `loadWorkspace`、`saveWorkspace` 或迁移行为尚未实现。

- [ ] **步骤 3：实现仓储层变更**

只有迁移测试需要时才保留 `loadDocument`、`saveDocument` 和 `clearDocument`；应用主流程改为使用：

```ts
loadWorkspace(): Promise<EditorWorkspace | null>
saveWorkspace(workspace: EditorWorkspace): Promise<void>
clearWorkspace(): Promise<void>
```

使用同一个对象存储，并新增一个 key，例如 `workspace`。

- [ ] **步骤 4：确认持久化测试通过**

运行：`npm test -- src/features/editor/persistence/editorRepository.test.ts --run`

预期：通过。

### 任务 3：工作区界面行为

**文件：**
- 修改：`src/features/editor/components/EditorPage.test.tsx`
- 修改：`src/features/editor/components/EditorPage.tsx`
- 创建：`src/features/editor/components/WorkspaceSidebar.tsx`
- 创建：`src/features/editor/components/DocumentEditor.tsx`
- 修改：`src/features/editor/components/EditorToolbar.tsx`，或由 `DocumentEditor` 替代。

- [ ] **步骤 1：编写失败的组件测试**

更新组件测试，期望出现：

- `团队知识库`
- `新建文档`
- `项目空间`
- `产品方案草稿` 或 `未命名文档`
- `评论 3`
- `分享`
- 右侧 `文档编辑区`

增加测试：点击 `新建文档` 后文档数量增加，并切换到新文档。

- [ ] **步骤 2：确认组件测试失败**

运行：`npm test -- src/features/editor/components/EditorPage.test.tsx --run`

预期：失败，因为当前 UI 仍是单文档。

- [ ] **步骤 3：在 `EditorPage` 中实现工作区状态**

加载/保存 `EditorWorkspace`，提供创建文档和切换文档处理函数，并包装现有块操作，使其只作用于当前文档。

- [ ] **步骤 4：实现 `WorkspaceSidebar`**

渲染 Notion 风格页面树，包括工作区标题、快捷操作、`新建文档`、文档按钮、当前状态和同步提示。

- [ ] **步骤 5：实现 `DocumentEditor`**

渲染协作顶部栏、封面、文档图标、标题、保存状态、元信息标签和 `BlockList`。

- [ ] **步骤 6：确认组件测试通过**

运行：`npm test -- src/features/editor/components/EditorPage.test.tsx --run`

预期：通过。

### 任务 4：Notion 风格样式

**文件：**
- 修改：`src/styles.css`

- [ ] **步骤 1：迁移预览稿视觉语言**

应用已确认的色板、页面树布局、吸顶协作顶部栏、文档封面、文档图标、大标题、元信息标签、悬停显示的块控制、内联评论提示、斜杠提示和响应式行为。

- [ ] **步骤 2：验证构建**

运行：`npm run build`

预期：TypeScript 和 Vite 构建通过。

### 任务 5：完整验证

**文件：**
- 除非失败暴露 bug，否则不改代码。

- [ ] **步骤 1：运行全部自动化测试**

运行：`npm test -- --run`

预期：全部测试通过。

- [ ] **步骤 2：运行生产构建**

运行：`npm run build`

预期：构建通过。

- [ ] **步骤 3：浏览器冒烟测试**

打开 `http://127.0.0.1:5173/` 并验证：

- 侧边栏显示 `团队知识库`、`新建文档` 和文档列表。
- 右侧显示文档封面、标题、保存状态、在线头像、`评论 3`、`历史` 和 `分享`。
- 现有块编辑仍可用。
- `新建文档` 会创建并选中新文档。
- 切换文档会更换当前编辑器内容。

- [ ] **步骤 4：提交实现**

测试、构建和浏览器冒烟测试通过后提交。
