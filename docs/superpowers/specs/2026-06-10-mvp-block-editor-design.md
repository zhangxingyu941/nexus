# 第一版块编辑器设计

## 概览

第一版构建一个本地单机 Notion 风格块编辑器。在引入协同或后端前，先验证块数据模型、编辑流程、本地持久化和基础 UI。

本版本刻意不包含实时协同、登录、服务端持久化、嵌套块、文件、图片、历史记录和斜杠菜单。这些能力属于 `docs/prd.md` 中的后续里程碑。

## 产品范围

应用打开后直接进入一个可编辑文档。用户可以本地创建、编辑、删除、排序和持久化块。

支持的块类型：

- 段落块：普通文本。
- 标题块：突出显示章节文本。
- 待办块：包含勾选状态和可编辑标签。

必需操作：

- 在当前块后创建新的段落块。
- 删除块，同时保证文档内至少保留一个空段落。
- 在段落、标题、待办之间切换块类型。
- 编辑块文本。
- 切换待办块状态。
- 上移或下移块。
- 保存文档到 IndexedDB，并在刷新后恢复。

## 架构

应用使用 React 和 Vite。编辑状态保存在 React 中，并通过聚焦的文档状态更新函数处理。持久化隔离在 IndexedDB 仓储层后面，UI 组件不需要知道存储细节。

段落和标题文本编辑使用 TipTap，这样第一版就使用后续可接入 Yjs 的编辑器体系。为了保持第一版小而可测，每个块只保存纯文本，不保存完整 TipTap JSON。

## 主要单元

### 文档模型

核心模型位于 `src/features/editor/model/block.ts`。

```ts
export type BlockType = "paragraph" | "heading" | "todo";

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  checked: boolean;
  parentId: string | null;
  children: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EditorDocument {
  id: string;
  title: string;
  blocks: Block[];
  updatedAt: number;
}
```

待办块使用 `checked`；段落和标题块也保留该属性并固定为 `false`，保持统一数据形状。

### 文档操作

状态操作位于 `src/features/editor/model/documentOperations.ts`。

它提供以下纯函数：

- `createDefaultDocument`
- `insertBlockAfter`
- `updateBlockContent`
- `changeBlockType`
- `toggleTodo`
- `deleteBlock`
- `moveBlock`

这些函数由单元测试覆盖，不依赖 React、TipTap、IndexedDB 或 DOM。

### 持久化

IndexedDB 访问位于 `src/features/editor/persistence/editorRepository.ts`。

仓储层暴露：

- `loadDocument(): Promise<EditorDocument | null>`
- `saveDocument(document: EditorDocument): Promise<void>`
- `clearDocument(): Promise<void>`

文档变更后，应用会防抖保存。保存状态展示以下状态之一：

- `已保存`
- `保存中`
- `未保存`
- `保存失败`

如果保存失败，当前内存中的文档仍可继续编辑。

### React 组件

UI 拆分为小组件：

- `App`：页面壳和编辑器组合。
- `EditorPage`：加载持久化数据，持有文档状态并触发持久化。
- `EditorToolbar`：标题和保存状态。
- `BlockList`：按顺序渲染块。
- `BlockRow`：渲染块控制，并把编辑委托给不同类型的 UI。
- `RichTextBlockEditor`：封装 TipTap，用于段落和标题文本。
- `TodoBlockEditor`：渲染勾选框和文本编辑器。

## 数据流

1. 应用挂载。
2. `EditorPage` 调用 `loadDocument`。
3. 如果存在已保存文档，则作为当前状态。
4. 如果不存在文档，则用 `createDefaultDocument` 创建一个空段落块。
5. 用户通过 UI 编辑块。
6. UI 分发纯文档操作。
7. 文档变化触发防抖后的 `saveDocument`。
8. 保存状态根据仓储层结果更新。

## 交互细节

文本编辑：

- 段落和标题块使用 TipTap。
- 如果待办块的 checkbox 布局与 TipTap 集成不顺，可以先用普通输入框编辑待办文本。
- 在文本块中按 Enter，会在当前块后插入一个段落块。

块控制：

- 类型选择器提供段落、标题、待办。
- 图标按钮支持新增、删除、上移和下移。
- 第一个块禁用上移。
- 最后一个块禁用下移。
- 删除操作至少保留一个空段落块。

## 样式

界面应像聚焦的编辑工具，而不是营销页。布局保持克制：

- 居中的文档画布。
- 紧凑顶部栏，包含标题和保存状态。
- 清晰且稳定的块控制。
- 舒适的文字间距。
- 标题和待办有明显呈现差异。

不要嵌套卡片。编辑器表面是主要工作区，块以重复行呈现。

## 错误处理

- 加载失败时回退到默认空文档，并展示非阻塞错误状态。
- 保存失败时保存指示变为 `保存失败`，编辑继续可用。
- 操作遇到无效块 ID 时返回原文档。
- 删除和移动操作在 UI 路径中处理边界情况，不直接抛错。

## 测试策略

文档操作单元测试覆盖：

- 默认文档包含一个段落块。
- 插入操作会在正确位置创建段落。
- 内容更新只修改目标块并更新时间戳。
- 离开待办类型时会重置待办勾选状态。
- 待办切换只修改目标待办块。
- 删除会移除块并至少保留一个块。
- 上移和下移能正确重排块。

持久化测试使用模拟 IndexedDB 覆盖：

- 保存后再加载会返回同一文档。
- 清空会移除已保存文档。

组件测试覆盖：

- 渲染默认编辑器。
- 编辑块内容。
- 新增和删除块。
- 移动块。
- 切换待办。

## 验收标准

- `npm run dev` 可以启动应用。
- `npm test` 通过。
- 编辑器打开后进入可用的单文档页面。
- 段落、标题和待办块均可编辑。
- 块可以新增、删除、转换和移动。
- 刷新浏览器后恢复已保存文档。
- 保存状态能反映本地持久化状态。
