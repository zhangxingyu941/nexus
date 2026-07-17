# Nexus 情境化编辑器交互优化设计

## 概览

本次改版把现有块编辑器从“功能入口围绕正文分散堆叠”调整为“正文优先、情境显露、键盘高效”的协作编辑体验。

整体采用已经确认的 C「情境化混合模式」，并组合 B「Nexus Focus Rail」与命令优先交互：用户点击正文即可直接编辑，当前块通过蓝色 Focus Rail 表示焦点；块操作、Slash Command、Mention、快捷键和协作光标围绕当前输入位置出现，不要求用户离开正文或额外点击才能继续输入。

配套视觉评审稿：

- `docs/editor-revamp-options.html`：三种总体方向对比。
- `docs/editor-contextual-hybrid-proposal.html`：情境化混合布局与状态色。
- `docs/editor-interaction-shortcuts-proposal.html`：Focus Rail、行内 Popover、Markdown、Mention、快捷键与协作光标。

## 目标

- 保留 Notion 成熟的块编辑心智，但形成 Nexus 自己的 Focus Rail 和团队上下文交互语言。
- 正文点击即编辑，不显示表单式文本输入框。
- 高频操作既有可见入口，也有固定快捷键。
- Slash Command 和 `@` Mention 跟随光标出现，不使用居中弹窗或页面遮罩。
- 支持 H1-H6、列表、任务、媒体、数据和高级内容的分类插入。
- 支持 Markdown 快捷输入，但不提供 Markdown 源码模式。
- 选择命令后自动聚焦正确的输入目标，消除二次点击。
- 通过 Yjs awareness 显示远程光标、人员名称和远程选区。
- 保持灰白主色，颜色只承担清晰的状态和人员识别语义。

## 非目标

- 第一版不支持自定义快捷键。
- 第一版不提供 Markdown 源码编辑器或双栏预览。
- 第一版不加入块级硬锁，不禁止多人同时编辑同一内容。
- 第一版不升级到 TipTap 3；协作光标使用与现有 TipTap 2.27.2 匹配的扩展。
- 不在本次改版中重做工作区、权限、邀请、历史版本或对象存储业务。
- 不用动画、装饰色或卡片堆叠替代清晰的信息层级。

## 当前问题

现有实现已经拥有段落、标题、待办、引用、代码、图片、文件、表格、看板、评论、协作属性、Slash Command 和 Yjs awareness，但交互入口仍然割裂：

- `BlockControls` 在左侧承载新增、类型、缩进、移动和删除。
- `BlockInlineActions` 在右侧单独承载协作属性和评论。
- `BlockMetaStrip` 在正文下方长期占用纵向空间。
- `SlashMenu` 平铺全部类型，没有分类、搜索、别名或最近使用。
- `TodoBlockEditor` 使用可见的原生输入框，和 TipTap 文本块手感不一致。
- `RichTextBlockEditor` 只向上提交纯文本，无法可靠持久化文本格式和 Mention 实体。
- 类型切换后缺少统一的焦点交接，用户必须再次点击才能继续输入。
- awareness 已同步用户姓名和颜色，但没有同步编辑器 selection 和远程 caret。

## 总体布局

### 默认写作态

- 左侧保持紧凑工作区导航。
- 中间正文画布保持约 720-780px 阅读宽度。
- 右侧上下文面板默认关闭。
- 顶栏只保留面包屑、同步状态、成员头像、评论入口和分享。
- 普通区块不显示边框、底色或长期驻留的属性条。

### 情境化面板

- 聚焦普通文本块时不打开右侧面板。
- 聚焦带负责人、截止时间、状态或未解决评论的任务块时，可打开任务上下文面板。
- 点击普通正文、按 `Esc` 或关闭按钮后收起面板。
- 桌面端面板从右侧进入；移动端仍使用覆盖式侧栏，但正文输入焦点不能丢失。

## 视觉系统

基础色直接沿用项目现有锌灰色系：

- 画布：`#ffffff`
- 侧栏：`#fafafa`
- 悬停：`#f4f4f5`
- 分隔线：`#e4e4e7`
- 主文字：`#27272a`
- 强文字和主按钮：`#09090b` / `#18181b`

特殊颜色只表达特定语义：

- 绿色：保存和同步成功。
- 蓝色：本地 Focus Rail、当前选择和任务进度。
- 琥珀色：临近截止或需要注意。
- 红色：同步失败、删除等破坏性动作。
- 蓝、紫、青等稳定人员色：远程光标和远程选区；人员色不使用绿色或红色。

## 直接编辑

### 文本型块

`Text`、`H1-H6`、`Todo`、`Quote`、`Code`、列表项和 Toggle 标题统一使用 TipTap 编辑表面：

- 点击字符位置直接定位 caret。
- 聚焦时不出现输入框边框或表单底色。
- 只通过 caret、Focus Rail 和必要的块操作条表达聚焦。
- 空块显示轻量 placeholder：`输入内容，或输入 / 插入`。
- `Todo` 保留独立 checkbox，但正文不再使用 `<input type="text">`。
- `Table` 单元格、日期选择、文件上传等结构化控件可以继续使用语义正确的表单控件。

### 键盘行为

- `Enter`：拆分当前内容或创建下一个块，并聚焦新块。
- `Shift + Enter`：在当前块内部换行。
- 空块 `Backspace`：合并到上一块；如果块类型特殊，先转换为 `Text`，再次 Backspace 才合并。
- `Tab` / `Shift + Tab`：缩进或取消缩进。
- `Alt + ArrowUp` / `Alt + ArrowDown`：移动当前块。
- `ArrowUp` / `ArrowDown`：在到达块边界时进入相邻块。
- `Esc`：关闭当前 Popover 或上下文面板，并保留/恢复编辑器焦点。

## Nexus Focus Rail

Focus Rail 是 Nexus 与 Notion 视觉和交互上的主要差异点：

- 悬停块时只显示新增按钮和拖拽手柄。
- 聚焦块时，块左侧显示 3px 蓝色竖向轨道。
- 当前块上方显示紧凑操作条，内容根据块类型变化。
- 普通文本块操作条包含类型、格式、评论和更多操作。
- Todo 操作条包含状态、负责人、截止时间、评论和更多操作。
- 复杂属性仍进入右侧上下文面板，避免在正文中堆叠表单。
- 属性摘要只在块聚焦或确实存在未处理状态时出现。

## 行内选择层

### Slash Command

输入 `/` 后，在当前 caret 附近打开 Select 风格的 `inline-popover`：

- 不显示遮罩，不居中，不阻断正文。
- 默认显示在 caret 下方；空间不足时翻转到上方。
- 宽度约 360-420px，最多显示 7-8 项并内部滚动。
- 支持中文描述、英文标签、Markdown 触发符和别名搜索。
- 支持最近使用；最近使用只排序，不复制命令定义。
- `ArrowUp/ArrowDown` 选择，`Enter` 执行，`Esc` 关闭并恢复原 selection。
- 鼠标或触控选择必须在 `pointerdown` 阶段保留编辑器 selection，避免点击菜单造成失焦。

命令按以下类别展示：

#### Recent

- 动态展示最近使用的 4-6 个命令。

#### Text & Headings

- `Text`
- `H1`
- `H2`
- `H3`
- `H4`
- `H5`
- `H6`
- `Quote`
- `Divider`

#### Lists & Tasks

- `Todo`
- `Bullet List`
- `Numbered List`
- `Toggle`

#### Media

- `Image`
- `Link Card`
- `File`

#### Data & Advanced

- `Code`
- `Table`
- `Board`
- `Formula`

#### Collaboration

- `Mention`

### Mention

输入 `@` 后，在 caret 附近打开同样的 `inline-popover`，统一搜索：

- `People`：工作区成员。
- `Docs`：当前工作区文档。
- `Tasks`：Todo 或带任务状态的块。
- `Dates`：今天、明天、具体日期等日期引用。

Mention 插入为 TipTap inline atom node，而不是拼接后的普通字符串。节点至少保存：

```ts
interface MentionAttrs {
  kind: "person" | "document" | "task" | "date";
  targetId: string;
  label: string;
}
```

显示标签可随目标更新；如果目标被删除，节点保留原始 label 并显示失效状态，不删除用户正文。

## 标题与 Markdown 快捷输入

标题仍使用一个块类型和层级属性，不创建六个互不相关的 BlockType：

```ts
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
```

命令菜单向用户显示 `H1-H6`，数据层使用 `type: "heading"` 和 `headingLevel`。

Markdown 仅作为快捷输入：触发成功后立即转为富文本块，原始触发符消失，用户继续直接编辑。

- `# ` 到 `###### `：H1-H6。
- `- `：Bullet List。
- `1. `：Numbered List。
- `- [ ] `：Todo。
- `> `：Quote。
- 输入三个反引号后按空格：Code。
- `---` 后按 Enter：Divider。
- `**text**`：Bold。
- `_text_`：Italic。
- `` `text` ``：Inline Code。
- `~~text~~`：Strike。

只有在块开头、空 selection 或明确的行内闭合规则满足时才触发，避免把代码、路径和普通符号误转换。

## 连续聚焦

所有插入和转换命令返回明确的焦点目标，由统一 Focus Manager 执行：

- `Text`、`H1-H6`、`Todo`、`Quote`、`Code`、列表和 Toggle：聚焦当前或新建文本表面的目标位置。
- `Table`：聚焦第一个可编辑单元格。
- `Image` / `File`：聚焦上传控件；上传完成后聚焦 caption/说明区域。
- `Board`：聚焦第一列的首个卡片标题入口。
- `Formula`：聚焦公式输入区域。
- `Mention`：插入节点后把 caret 放到节点后方。
- `Divider`：插入后创建并聚焦下一个 `Text` 块。
- `Esc`：取消命令并恢复打开 Popover 前的 selection。

焦点恢复不能依赖各组件零散调用 `element.focus()`；命令层需要保存 TipTap bookmark/selection，并在 React 提交和编辑器实例就绪后完成一次统一交接。

## 文本选择工具栏

选择非空文本后，在选区附近显示深色紧凑工具栏：

- Bold
- Italic
- Strike
- Inline Code
- Link
- Comment

工具栏使用 TipTap BubbleMenu 或等价定位机制。点击按钮时保留 selection；格式执行后焦点返回正文。取消选区、按 Esc 或切换块后关闭。

## 固定快捷键体系

第一版不支持自定义快捷键。所有快捷键由一个注册表定义，行为分发、菜单右侧标签、Tooltip 和快捷键中心共用这份数据。

快捷键作用域优先级：

1. 当前 Dialog/Popover。
2. 文本 selection。
3. 当前块。
4. 当前编辑器。
5. 全局工作区。

主要快捷键：

- `Ctrl/Cmd + K`：选中文字时添加 Link；没有文本 selection 时打开全局搜索。
- `Ctrl/Cmd + /`：打开快捷键中心。
- `Ctrl/Cmd + Z`：Undo。
- `Ctrl/Cmd + Shift + Z`：Redo。
- `Ctrl/Cmd + B`：Bold。
- `Ctrl/Cmd + I`：Italic。
- `Ctrl/Cmd + Shift + X`：Strike。
- `Ctrl/Cmd + Shift + M`：Comment。
- `Ctrl/Cmd + Enter`：切换当前 Todo 完成状态。
- `/`：Slash Command。
- `@`：Mention。
- `Esc`：关闭当前交互层并恢复编辑焦点。

界面根据平台显示 `Ctrl` 或 `Cmd`，内部定义使用 `Mod` 抽象。低频和高风险操作，例如权限变更、删除文档和永久清理，不分配快捷键。

## 协作光标

参考 Tiptap collaborative editing 示例，使用 Yjs awareness 同步 selection 和用户身份。

项目当前使用 TipTap 2.27.2，因此实现时使用匹配版本的 `@tiptap/extension-collaboration-cursor@2.27.2`，不为了光标功能升级 TipTap 主版本。

显示规则：

- 本地 caret 使用 TipTap/浏览器默认样式，不显示“我”或本地姓名标签。
- 远程 caret 使用 2px 人员色竖线。
- 远程 caret 右上方显示姓名标签。
- 姓名标签背景、远程 caret 和远程选区使用同一个人员色。
- 人员颜色由稳定用户 ID 映射，在不同文档和重连后保持一致。
- 人员色使用蓝、紫、青、品红等调色板，避开保存绿色和错误红色。
- 标签接近右侧或顶部边界时自动翻转位置。
- 多个 caret 非常接近时错层显示标签，避免完全覆盖。
- 用户断线、离开文档或 awareness 超时后立即清除 caret 和 selection。

第一版采用 awareness + 软冲突提示，不做硬锁：

- 如果远程 caret 已在同一块，本地用户仍可点击编辑。
- Focus Rail 或轻量提示显示“某某正在此处编辑”。
- Yjs 继续合并并发修改。
- 不引入锁 TTL、锁抢占、断线残留锁和只读切换。

## 数据模型

### 富文本成为文本型块的规范来源

当前 `Block.content: string` 无法保存 marks 和 Mention。改版后文本型块增加规范的 TipTap JSON 内容，同时保留纯文本投影用于搜索、摘要和旧接口兼容：

```ts
interface Block {
  id: string;
  type: BlockType;
  content: string;       // 由 richText 派生的纯文本投影
  richText: JSONContent | null;
  headingLevel: HeadingLevel | null;
  listStyle: "bullet" | "numbered" | null;
  // 其余现有字段保持不变
}
```

规则：

- `richText` 是文本型块的编辑规范来源。
- 所有富文本更新通过一个模型操作同时生成 `content` 投影。
- 搜索、任务摘要和旧数据读取继续使用 `content`。
- 非文本结构块可以让 `richText` 为 `null`，caption/title 使用明确字段或独立文本子块。
- H1-H6 共享 `type: "heading"`。
- Bullet/Numbered 共享 `type: "list-item"` 和 `listStyle`。
- Todo 保持独立 `checked` 字段。
- Toggle 使用现有 `children` 关系承载折叠内容。

### BlockType 扩展

现有类型继续保留，并增加：

- `list-item`
- `toggle`
- `divider`
- `link-card`
- `formula`

`Mention` 是行内节点，不是 BlockType。H1-H6 也不是六个 BlockType。

### 旧数据迁移

- 没有 `richText` 的文本块在 normalization 阶段把 `content` 包装为一个段落 JSON。
- 旧 `heading` 默认迁移为 `headingLevel: 1`。
- 旧 Todo 文本迁移到 Todo 的 `richText`，保留 `checked`、负责人、状态和评论。
- 持久化层在读旧数据时迁移，在下一次保存时写新结构。
- 迁移必须幂等，重复加载不能产生嵌套 doc 或重复 Mention。

## 协作数据流

现有 `useDocumentCollaboration` 已经创建 `WebsocketProvider` 并维护 awareness，但只向组件暴露 `ydoc` 和 presence 摘要。改版后协作会话需要暴露一个受控对象：

```ts
interface CollaborationSession {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
}
```

数据流：

1. 会话层创建 Y.Doc、provider 和 awareness。
2. awareness 本地状态写入稳定用户 ID、名称、人员色和当前文档。
3. 每个可见文本块的 TipTap Collaboration 扩展绑定相应 Y.XmlFragment。
4. 每个 Y.XmlFragment 是该文本块的唯一协作正文源；`Block.content` 和后续 `richText` 只作为搜索、摘要、保存与兼容接口使用的派生投影，父级 prop 变化不能再次通过 `setContent` 写回 fragment。
5. provider 完成首次同步后，如果 fragment 为空，只允许把持久化正文注入一次；如果 fragment 已有内容，以 fragment 为准。初始化完成后，即使延迟的父级快照到达，也不能覆盖或重放 CRDT 正文。
6. TipTap 的本地或远程 transaction 可以更新父级纯文本投影，但投影更新不得反向触发 TipTap transaction，避免 A/B 客户端互相回灌。
7. CollaborationCursor 绑定同一个 provider，并渲染远程 caret/selection。
8. 当前活动块 ID 作为自定义 awareness 字段同步，用于同块软提示。
9. 离开文档时清除 awareness 本地状态，再销毁 provider 和 Y.Doc。

远程 selection 是临时 awareness，不写入 PostgreSQL、IndexedDB 或历史版本。

## 组件边界

建议把现有 `BlockRow` 中混合的菜单、焦点和协作状态拆成清晰单元：

- `BlockEditorSurface`：根据块类型渲染直接编辑表面。
- `BlockFocusRail`：渲染本地 Focus Rail、远程同块提示和块手柄。
- `BlockActionBar`：根据块能力渲染情境化操作。
- `EditorCommandPopover`：Slash Command 的 caret 锚定选择层。
- `MentionPopover`：四类统一引用搜索与插入。
- `TextSelectionToolbar`：非空文本 selection 的格式入口。
- `EditorShortcutCenter`：固定快捷键浏览。
- `EditorFocusManager`：捕获 selection、执行命令后的焦点交接。
- `RemoteCursorRenderer`：渲染远程人员标签和边界翻转。
- `editorCommands`：唯一命令定义、分类、别名、Markdown 触发与 focus target。
- `editorShortcuts`：唯一快捷键定义、作用域和平台显示。

每个命令至少声明：

```ts
interface EditorCommandDefinition {
  id: string;
  label: string;
  category: string;
  aliases: string[];
  focusTarget: FocusTarget;
  run(context: EditorCommandContext): EditorCommandResult;
}
```

Slash Menu、块类型菜单、Markdown shortcut 和快捷键行为必须复用命令 ID，避免同一种转换出现多套实现。

## 错误与边界处理

- 命令执行失败：不清空原内容，关闭 loading 状态，恢复原 selection，并显示轻量错误。
- 不支持的块转换：菜单项 disabled，并说明原因；不静默丢弃结构数据。
- Mention 目标删除：保留 label，显示失效样式，点击后提示目标不存在。
- 上传失败：保留附件占位和本地说明，提供重试；焦点返回说明区域。
- 协作断线：清除远程 caret，保留本地编辑，顶栏显示离线状态。
- awareness 收到缺少 name/color 的状态：不渲染姓名标签，使用 presence 列表的安全降级。
- Popover 超出视口：自动 flip/shift，不覆盖 caret 或被屏幕裁切。
- 虚拟列表卸载当前远程块：caret 随编辑器卸载，滚回块后由 awareness selection 恢复。

## 可访问性

- Slash 和 Mention 使用 `listbox` / `option` 或等价的可访问菜单语义。
- 当前选项通过 `aria-activedescendant` 表达，不把焦点从编辑器移动到搜索结果。
- 远程 caret 和标签主要是视觉提示，设置 `aria-hidden`，避免每次光标移动触发读屏播报。
- 在线成员和正在编辑位置在成员面板中提供稳定的文本摘要。
- 所有图标按钮有可访问名称和 Tooltip。
- 人员色不是唯一信息，远程 caret 同时显示成员名称。
- `prefers-reduced-motion` 下关闭 Popover 和面板位移动画。

## 响应式

- 桌面端 Popover 宽 360-420px，锚定 caret。
- 小屏端宽度限制为 `calc(100vw - 24px)`，仍锚定 caret 并使用 flip/shift，不改成居中弹窗。
- 触控设备长按块手柄打开块操作，单击正文仍直接放置 caret。
- 文本选择工具栏根据选区上下空间自动翻转。
- 远程姓名标签在窄屏优先向左展开，不能遮住下一行输入。
- 快捷键中心在移动端可以查看，但隐藏不适用于触控的快捷键提示。

## 性能

- awareness 光标更新使用 provider 自带的合并机制，不进入 React 工作区状态树。
- 远程 caret 由 ProseMirror decoration 渲染，避免每次移动重渲染整个 `BlockList`。
- 当前 200 块虚拟化阈值继续保留。
- 命令搜索对静态定义使用预计算别名；最近使用只保存少量命令 ID。
- Mention 搜索防抖，并限制首屏结果数。
- 人员颜色由用户 ID 的确定性映射计算，不依赖服务端随机分配。

## 测试策略

### 模型测试

- 旧纯文本块迁移为 richText，且迁移幂等。
- H1-H6 转换只修改 `headingLevel`。
- richText 更新同步生成正确 `content` 投影。
- Mention JSON 保留 kind、targetId 和 label。
- List、Toggle、Divider 和 Formula 创建默认数据正确。

### 命令与 Markdown 测试

- 每个命令 ID 唯一，并归属一个类别。
- Slash 别名搜索覆盖英文标签、中文描述和 Markdown 触发符。
- `# ` 到 `###### ` 分别生成 H1-H6。
- 列表、Todo、Quote、Code 和 Divider shortcut 正确转换。
- 普通代码、路径和未闭合文本不会误触发 Markdown 转换。

### 焦点测试

- 鼠标点击 Slash 选项后正文立即获得焦点。
- 键盘 Enter 选择命令后正文立即获得焦点。
- Mention 插入后 caret 位于节点后方。
- Table、Image/File、Board 和 Formula 聚焦各自的首个输入目标。
- Esc 关闭 Popover 后恢复原 selection。
- Popover pointerdown 不导致 TipTap selection 丢失。

### 组件测试

- 普通文本块聚焦不显示输入框样式。
- Focus Rail 只在悬停、聚焦或菜单打开时出现。
- Slash 和 Mention 无页面遮罩，并锚定当前 caret。
- 菜单显示固定快捷键标签。
- 快捷键中心按类别显示并映射当前平台。

### 协作测试

- A 和 B 打开同一文档时，A 可以看到 B 的 caret、名称和选区。
- A 的本地 caret 不显示本地姓名标签。
- 远程 caret、标签和选区颜色一致。
- 用户离开房间后远程 caret 被移除。
- 同一块存在远程 caret 时显示软提示，但不阻止本地输入。
- B 快速连续输入时，A 能收到最终正文，A 的父级投影更新不会通过 `setContent` 回灌给 B。
- 协作 fragment 初始化后到达的延迟父级快照不会覆盖当前正文；空 fragment 的持久化正文只注入一次。
- 多实例 Redis Pub/Sub 继续传播 awareness selection。

### 端到端测试

- 两个浏览器上下文打开同一文档，输入和 caret 实时同步。
- Slash 插入 H2 后无需第二次点击即可连续输入。
- `@` 插入成员后无需第二次点击即可继续输入。
- 刷新后富文本格式、标题层级和 Mention 恢复。
- 断开协作服务后本地编辑仍可继续，恢复连接后重新同步。

## 本阶段实现记录（2026-07-17）

### 最终文件边界

- `commands/editorCommands.ts` 是 Slash、Markdown 映射、块类型短标签和命令搜索的唯一命令源。
- `commands/editorShortcuts.ts` 同时负责快捷键匹配和快捷键中心展示，不维护第二份显示配置。
- `components/commands/EditorCommandPopover.tsx` 只负责 caret 邻近的非模态分类列表；键盘查询和选择后的焦点交还由 `BlockRow` 管理。
- `components/commands/EditorShortcutCenter.tsx` 使用 Dialog 展示固定快捷键，不提供自定义入口。
- `RichTextBlockEditor.tsx` 是 paragraph、heading、quote、code 和 Todo 正文的 TipTap/Yjs owner；`TodoBlockEditor` 只保留 checkbox 布局。
- `BlockActionBar.tsx` 与 `BlockRow` 共同管理 Focus Rail、当前类型、协作属性和块评论，正文自身不再显示表单式边框或焦点底色。

### 已落地 ID

- 命令 ID：`text`、`heading-1` 到 `heading-6`、`todo`、`quote`、`code`、`image`、`file`、`table`、`board`。
- 快捷键 ID：`bold`、`italic`、`inline-code`、`link`、`move-up`、`move-down`、`indent`、`outdent`、`undo`、`redo`、`search`、`slash`、`shortcut-center`。

### 协作正文约束

- 协作 fragment 为空时，只允许用持久化 `content` 初始化一次。
- 初始化后 `Y.XmlFragment` 是正文的唯一写入源；父级 `content` 仅作为保存/搜索投影，不再通过 `setContent` 回写 TipTap。
- B 快速连续输入和延迟父级快照已由真实 TipTap/Yjs 集成测试及双浏览器本地 WebSocket 流程覆盖。

### 本阶段边界

- Mention atoms、富文本 JSON 持久化、BubbleMenu 和远程 caret/name/selection 未在本阶段伪实现，继续按后续独立计划交付。
- Image、File、Table 和 Board 已接入 Slash 类型转换；其结构化首输入焦点仍由后续高级块命令阶段统一完善。

## 分阶段交付

### 第一阶段：编辑基础与数据模型

- richText 数据模型与旧数据迁移。
- 统一文本型块编辑表面。
- 命令注册表、快捷键注册表和 Focus Manager。
- Focus Rail 与连续聚焦。

### 第二阶段：命令输入

- 分类 Slash Popover。
- H1-H6 和新增 BlockType。
- Markdown 快捷输入。
- Mention 四类统一引用。
- 文本选择工具栏和快捷键中心。

### 第三阶段：协作光标

- 暴露 collaboration provider/awareness。
- 接入匹配 TipTap 2.27.2 的 CollaborationCursor。
- 稳定人员色、远程 caret、姓名标签和选区。
- 当前活动块 awareness 与软冲突提示。

### 第四阶段：响应式与回归

- caret Popover 的 flip/shift。
- 移动端触控行为。
- 200 块性能与协作回归。
- 双浏览器端到端测试。

## 验收标准

- 用户点击正文即可在点击位置输入，不出现表单式文本框。
- 选择任何输入类命令后无需再次点击即可继续输入。
- Slash 和 Mention 是 caret 锚定 Popover，不显示居中弹窗或遮罩。
- Slash 类型按类别展示，并使用 `Text`、`H1-H6`、`Todo`、`Image`、`File`、`Table` 等短标签。
- H1-H6 和主要 Markdown shortcut 可用。
- `@` 可搜索并插入 People、Docs、Tasks 和 Dates。
- 快捷键在菜单、Tooltip 和快捷键中心显示一致，第一版不可自定义。
- 保存成功用绿色，任务进度用蓝色，同步失败用红色。
- 本地 caret 不显示姓名，远程 caret 显示同色姓名标签和选区。
- 协作断线不会丢失本地编辑内容。
- 富文本格式、Mention 和标题层级在刷新后可恢复。
- 关键模型、命令、焦点、组件、协作和端到端测试通过。
