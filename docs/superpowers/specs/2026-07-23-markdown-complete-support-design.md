# Markdown 完整支持设计

状态：已确认
日期：2026-07-23

## 目标

扩展现有的文档级 Markdown 导入和导出流程，使 CommonMark 与 GFM 内容要么转换为 Nexus 原生块，要么无损保留在安全的 Markdown 块中。增加客户端 Mermaid 和数学公式渲染，但绝不执行原始 HTML、SVG、iframe、脚本或任意第三方扩展。

本设计取代 `2026-07-22-m8-editor-operations-markdown-design-zh.md` 中“原始 HTML 必须拒绝”和“不支持节点必须拒绝”的部分。既有的大小限制、授权、压缩包校验和原子导入行为继续生效。

## 范围

支持下列内容的编辑与往返转换：

- CommonMark 的块级和行内语法。
- GFM 表格、任务列表、删除线、自动链接和脚注。
- 块级与行内数学公式。
- 在客户端渲染的 Mermaid 围栏图表。
- 使用现有资源流程的本地图片和附件压缩包。
- 保留为源码的 front matter、原始 HTML、SVG、iframe、PlantUML、Vega 和未知扩展语法。

“完整支持”指任何被接受的 Markdown 源码都不会被静默丢弃，并不表示应用会执行所有第三方 Markdown 扩展。本里程碑仅渲染 Mermaid；其他扩展保持可编辑并在导出时原样写回。

## 架构

### 原生块与源码保留块

标题、段落、引用、列表、待办、表格、代码、分隔线、图片、附件和已支持的富文本标记继续沿用当前映射。新增 `markdown` 块类型及其 `BlockData` 变体：

```ts
type MarkdownBlockFlavor = "footnote" | "frontmatter" | "mermaid" | "rawHtml" | "unknownExtension";

interface MarkdownBlockData {
  kind: "markdown";
  flavor: MarkdownBlockFlavor;
  language: string;
}
```

Markdown 块的 `Block.content` 保存精确的源码切片。`language` 保存围栏代码块的语言；非代码片段使用空字符串。保存和导出都不得规范化这段源码。

导入器检查每个顶层 mdast 节点及其后代。整个节点能够无损映射到现有原生模型时才转为原生块；若其中包含无法保持原意的结构，则根据该节点在原文中的范围创建一个 Markdown 块。这样行内脚注引用、行内公式、原始 HTML 和未知行内扩展不会发生部分转换和文本丢失。

### 解析与序列化

共享 Markdown 模块仍是文档数据与 Markdown 之间唯一的转换位置，使用 Unified、CommonMark 解析器、`remark-gfm` 和 `remark-math`。

导入使用 mdast 源码位置切取保留块的原文。仅当第一个顶层 H1 可原生映射时，才将它用作文档标题；被保留的 H1 片段仍留在正文中，以确保源文不被改写。

导出将原生块序列化为确定性的 Markdown。Markdown 块直接写回存储的源码，仅在相邻块输出需要时补一个空行。这保证保留内容经过“导入-导出-导入”后保持不变。

### 渲染

`MarkdownBlockEditor` 提供“预览”和“源码”模式。源码模式使用普通可编辑文本框；预览模式使用仅在客户端运行的渲染器：

- 数学公式使用 `remark-math`、`rehype-katex` 和 KaTeX CSS。
- Mermaid 仅在浏览器中动态加载，并以 `securityLevel: "strict"` 渲染。
- Mermaid 源码无效时显示行内诊断，同时保留源码。
- 无安全语义渲染器的脚注和未知扩展以可读源码显示。
- 原始 HTML、SVG、iframe 和脚本以转义后的源码显示；渲染器不得启用 `rehype-raw`，也不得注入不可信 HTML。

导入和预览期间均不得抓取远程内容。现有本地压缩包资源继续使用已授权文件 URL；远程图片继续降级为安全链接。

## 用户体验

普通 Markdown 保持现有的块级编辑体验。复杂语法显示为独立 Markdown 块，并提供“预览 / 源码”切换。切换模式不得修改源码。命令菜单增加 Markdown 块和 Mermaid 块，使用户无需导入文件也能创建保留内容和可渲染图表。

导入退回到 Markdown 块时，预览会显示包含源码行号和原因（如 `markdown_preserved`）的警告。该警告不阻塞导入；语法、大小、授权、压缩包和不安全链接错误仍应原子性阻塞导入。

## 安全与限制

- Mermaid 隔离在客户端组件中，并使用严格安全配置。
- 原始 HTML 不得解析进 DOM 或执行。
- Markdown 链接复用现有的安全协议校验。
- 服务端重新解析 Markdown，不能信任浏览器的转换结果。
- 现有源码大小、块数量、嵌套深度、压缩包和附件限制保持不变。
- Mermaid 图表语法错误是非阻塞展示诊断，不能阻止源码编辑或导出。

## 兼容性

既有文档不包含 `markdown` 块，必须继续正常加载。新块类型需要被本地持久化、PostgreSQL 校验、协作结构映射、剪贴板校验、模板、命令定义、共享只读视图和 Markdown 导出接受。

不认识新块类型的旧客户端不要求渲染该块，因此部署时需同时发布服务端和 Web 客户端。数据库继续存储现有的判别式块载荷，只需扩展类型与数据变体的校验，无需数据迁移。

## 测试

增加以下聚焦测试：

- 覆盖脚注、删除线、自动链接、表格、任务列表、嵌套内容和源码范围的 CommonMark/GFM 固件。
- 块级和行内数学公式的导入、预览和确定性导出。
- 有效 Mermaid 的预览、无效 Mermaid 的诊断和源码模式编辑。
- 原始 HTML、SVG 和 iframe 的保留，确保不会执行 DOM 内容。
- PlantUML、Vega、front matter 和任意围栏语言的往返转换。
- 未知行内扩展会保留完整源码节点，而不是丢失部分文本。
- 原生块的“导入-导出-导入”语义一致性，以及 Markdown 块的字节级保留。
- 既有 Markdown 压缩包、授权、协作初始化、剪贴板和共享视图行为。
- 在浏览器中导入含 Mermaid、脚注、公式和原始 HTML 的文档后，再连接延迟到达的协作状态。

## 验收标准

1. 任意 CommonMark/GFM 输入要么映射为原生块，要么保留在 Markdown 块中，绝不静默省略。
2. Mermaid 围栏块能在预览模式渲染、保留可编辑源码，并以原始围栏形式导出。
3. 数学 Markdown 安全渲染，导出时不改变其预期记法。
4. 原始 HTML、SVG、iframe 和脚本在应用中绝不执行，但导出时保持原样。
5. 无效图表显示局部诊断，不丢失内容，也不阻塞导出。
6. Markdown 导入在阻塞错误下仍是原子的，延迟协作初始化不得替换已导入内容。
