# 编辑器交互方案补齐计划（2026-07-17）

本文档对照 `docs/editor-interaction-shortcuts-proposal.html` 的设计原型，列出当前代码实现与方案之间的差距，并给出逐项补齐的实现方案。目标是在不破坏现有块数据模型与协同层的前提下，补齐交互层缺口。

## 当前已对齐的能力
- Focus Rail 蓝色焦点轨道（`.block-row.focused`）
- Slash 菜单：锚定光标、分类、别名搜索、键盘导航
- `@` 行内提及：People/Docs/Tasks/Dates 分组、过滤、插入 mention 节点
- 远程协作光标：姓名标签 + 共享人员色
- Markdown 快捷转换（标题/待办/引用/代码）
- `/` 仅空块触发

## 待补齐项（按优先级）

### 1. Mention 分类 Tab（高）
方案：弹窗顶部 `All / People / Docs / Tasks / Dates` 可点击切换过滤。
实现：
- `MentionPopover` 增加 `activeTab` 受控状态与 `onTabChange`
- `BlockRow` 维护 `mentionTab` state，默认 `all`
- 过滤逻辑：`all` 显示全部，其余按 `item.kind` 匹配
- 无匹配时仍显示"无匹配结果"
测试：`MentionPopover.test.tsx` 增加 tab 切换用例。

### 2. 隐藏本地协作光标姓名标签（高）
方案：本地光标保持 TipTap 默认样式且不显示名称；仅远程光标显示姓名。
实现：
- `RichTextBlockEditor` 给 `CollaborationCursor` 传 `render` 自定义函数：当 `user.clientId === provider.awareness.clientID` 时只渲染 caret 不渲染 label
- 需要在 `render` 中判断本地状态；`CollaborationCursor` 的 render 回调拿到 `user` 字段，需把 `clientId` 也写入 awareness user 字段
- `useDocumentCollaboration` 的 awareness `user` 增加 `clientId`
测试：通过 `remoteCursorColors.test.ts` 或新增轻量测试确认本地不渲染 label（DOM 断言较贵，用单测验证 render 函数分支）。

### 3. 选中文字浮动工具栏（高）
方案：选中文字出现黑色浮动工具栏（B / I / S / 链接 / 评论）。
实现：
- 新增 `SelectionToolbar.tsx`，监听 editor 的 `selectionUpdate`，当存在非空文本选区时定位到选区上方
- 加粗/斜体/删除线调用 TipTap `toggleBold` 等（StarterKit 已含）；链接调 `setLink`；评论触发现有的 `onAddBlockComment`
- 复用现有 `BlockActionBar` 的评论入口或回调
- 仅在非只读、且选区在块内时出现
测试：组件测试验证选区出现工具栏、点击加粗调用命令。

### 4. 补齐 Slash 命令（中）
方案独有命令：`Divider`、`Bullet List`、`Numbered List`、`Toggle`、`Formula`、`Link Card`。
实现策略：
- 在 `BlockType` 增加 `divider`、`bulletedList`、`numberedList`、`toggle`、`formula`、`linkCard`（数据模型扩展）
- `editorCommands.ts` 增加对应命令（category 沿用现有分组）
- `DocumentEditor`/`BlockRow` 的 `onChangeType` 已支持任意 `BlockType`，需为每种新类型补渲染分支：
  - `divider`：渲染 `<hr>`，无编辑器
  - `bulletedList`/`numberedList`：复用 TipTap list（或作为 paragraph 容器，MVP 用简单列表渲染）
  - `toggle`：标题 + 可折叠内容（MVP 用 details/summary）
  - `formula`：行内/块级公式占位（MVP 用 code 样式 + KaTeX 可选）
  - `linkCard`：URL 卡片（MVP 用链接预览占位）
- 持久化：`documentOperations` 需支持新类型（content/data 兼容）
- 风险：新 BlockType 影响协同快照、迁移、历史；MVP 阶段先用最小渲染 + 标记为实验。
测试：每种新类型一个渲染测试 + 命令注册测试。

### 5. macOS ⌘ 适配 + 快捷键中心条目对齐（中）
现状：`EditorShortcutCenter` 已用 `formatShortcutKeys` + `isApplePlatform` 做 ⌘/Ctrl 适配；`EDITOR_SHORTCUTS` 已有加粗/斜体/链接/移动/缩进/撤销重做/搜索/插入/快捷键中心。
补齐：
- 增加：删除线（`Mod+Shift+X`）、完成待办（`Mod+Enter`）、空块合并（`Backspace`）、聚焦上/下块（`↑/↓`）、添加评论（`Mod+Shift+M`）
- 保留"第一版不支持自定义"说明
测试：`editorShortcuts.test.ts` 增加新条目匹配。

### 6. 块手柄 + 加号 + 拖拽排序（中）
现状：`BlockControls` 已有 `Plus`（添加块）与 `GripVertical`（块菜单，含上移/下移）。
补齐：
- 给 grip 增加 HTML5 拖拽（`draggable` + `onDragStart/onDragOver/onDrop`），调用新的 `onReorder(fromId, toId)` 或复用 `onMove`
- 拖拽时显示插入指示线
- 由于虚拟列表，拖拽排序在虚拟模式下需谨慎；先在非虚拟模式启用
测试：拖拽事件触发 `onMove`/`onReorder` 的单元测试。

### 7. 协作光标边缘翻转 + 断线清除（低）
实现：
- 边缘翻转：CSS 用 `:root` 媒体查询或 JS 判断 `anchor.left` 接近视口右缘时 `data-side="top"`（label 已在 MentionPopover 有 side 逻辑，但协作光标 label 由 tiptap 渲染，需在 `render` 里根据 `window.innerWidth` 决定 label 翻转）
- 断线清除：provider `status` 为 `disconnected` 时 awareness 自动清除，无需额外处理；补充：本地断网时隐藏所有远程光标（监听 `status`）
测试：render 函数分支单测。

### 8. 连续聚焦精细化（低）
现状：Text/H1-H6/Quote/Code/Todo 选择后聚焦正文；Table/Board 已聚焦首格/首卡；Image 聚焦上传区。
补齐：
- 确认 Image/File 选择后聚焦上传或说明输入
- Mention 插入后光标停在引用后方（已实现）
- 其余遵循规则 08
测试：现有 EditorPage 测试已覆盖主要路径。

## 实施顺序
1. 文档（本文件）
2. Mention 分类 Tab
3. 隐藏本地光标标签
4. 选中浮动工具栏
5. Slash 新命令（Divider/Bullet/Numbered/Toggle/Formula/Link Card）
6. 快捷键条目对齐
7. 拖拽排序
8. 光标边缘翻转
9. 连续聚焦确认
10. 全量测试 + 提交

## 风险与范围说明
- 第 4 项（新 BlockType）影响数据模型、迁移、协同快照与历史版本；MVP 以"最小可用渲染 + 命令注册"为目标，不追求完整编辑能力。
- 第 6 项拖拽在虚拟化列表下交互复杂，先在非虚拟（块数 < 100）模式实现。
- 所有改动保持现有 635 个测试通过，新增测试覆盖新行为。
