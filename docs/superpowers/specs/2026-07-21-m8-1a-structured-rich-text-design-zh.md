# M8.1A 结构化富文本设计

状态：已确认

日期：2026-07-21

## 1. 背景

Nexus 当前已使用 TipTap 渲染和编辑段落、标题、引用、待办与代码块，也已经提供粗体、斜体、删除线和链接命令。但 `RichTextBlockEditor` 的更新回调只保存 `editor.getText()`，因此格式、链接和结构化 mention 在文档快照、PostgreSQL、IndexedDB、历史版本与匿名分享中都会丢失。协同会话中的 Yjs `XmlFragment` 能暂时保留 ProseMirror 结构，但它尚未投影到 Block 数据模型。

M8.1A 先建立稳定的结构化正文契约，不在本批同时引入多块选择、页面树、全文搜索或通知。

## 2. 目标

- 为文本类 Block 保存可版本化、可校验的 TipTap/ProseMirror JSON。
- 保留纯文本投影，继续服务搜索、任务摘要、评论定位与旧数据兼容。
- 第一批支持粗体、斜体、删除线、行内代码、安全链接、结构化 mention 和块内换行。
- 格式在本地保存、PostgreSQL 保存、刷新、历史恢复、Yjs 协同和匿名分享后保持一致。
- 使用读取兼容、首次保存升级的方式迁移现有纯文本数据，不执行全表内容回填。
- 保持“一块一段”：`Enter` 创建下一个 Block，`Shift+Enter` 在当前块插入 `hardBreak`。

## 3. 非目标

- 多块选择、批量格式、批量删除、跨块复制粘贴和拖拽增强归入 M8.1B。
- Markdown 导入导出归入 M8.1C。
- 父子页面、面包屑、全文搜索和反向链接归入 M8.2。
- 通知中心、未读状态和由 mention 触发的通知归入 M8.3。
- 代码块继续使用纯文本语义，不支持行内富文本 marks。
- 本批不改变 PostgreSQL 与 Yjs 的整体部署方式，也不以解析 Yjs 二进制替代结构化文档快照。
- 按当前决策不处理完整 E2E 中 10 项既有 M6 基线失败。

## 4. 已确认决策

- 采用 `richText JSON + content 纯文本投影` 双字段。
- PostgreSQL 使用可空 JSONB，旧数据读取时转换，首次合法保存时升级。
- 文本类块为段落、标题、引用和待办；代码及复杂块的 `richText` 固定为 `null`。
- mention 保留结构化目标，为 M8.3 复用；匿名分享时降级为普通文本。
- 选区工具使用项目灰白色的浮动工具条，不使用纯黑或深灰面板。
- 链接使用工具条锚定浮层，不使用 `window.prompt` 或居中对话框。
- 粘贴 HTML 只保留支持的行内结构，多段内容转为当前块内换行。

## 5. 富文本契约

### 5.1 公共类型

共享模块定义不依赖 TipTap 运行时的稳定类型：

```ts
export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" }
  | { type: "code" }
  | { attrs: { href: string }; type: "link" };

export type RichTextInlineNode =
  | { marks?: RichTextMark[]; text: string; type: "text" }
  | { type: "hardBreak" }
  | {
      attrs: {
        kind: "person" | "document" | "task" | "date";
        label: string;
        targetId: string;
      };
      type: "mention";
    };

export interface RichTextDocument {
  content: [{ content?: RichTextInlineNode[]; type: "paragraph" }];
  type: "doc";
}
```

`Block` 新增：

```ts
richText: RichTextDocument | null;
```

所有 Block 创建器、克隆函数、工作区归一化、远程补丁和共享响应都显式处理该字段，不通过对象展开隐式信任未知 JSON。

### 5.2 白名单与规范化

- 根节点必须为 `doc`，且 `content` 必须恰好包含一个 `paragraph`。
- paragraph 只允许 `text`、`hardBreak` 和 `mention`。
- text 只允许 `bold`、`italic`、`strike`、`code` 和 `link` marks；重复 marks 去重并按固定顺序输出，保证 JSON 稳定。
- 空文本节点删除；相邻且 marks 完全相同的文本节点合并。
- mention 必须具有非空的 `targetId`、`label`，且 `kind` 只能是 `person`、`document`、`task` 或 `date`。
- 普通域名补全为 `https://`。允许 `https://`、`http://`、`mailto:` 和 `/documents/...`；拒绝 `javascript:`、`data:`、协议相对地址及无法解析的值。
- JSON 使用 UTF-8 序列化后单块最大 256 KB，超过上限的 API 写入返回 `400`。

### 5.3 纯文本投影

- text 投影为自身文本。
- `hardBreak` 投影为 `\n`。
- mention 投影为 `@${label}`。
- 服务端收到非空 `richText` 后，始终从规范化 JSON 重新计算 `content`，不信任客户端提供的投影。
- 旧记录的 `richText` 为 `null` 时，使用 `content` 生成一个只有 text 和 hardBreak 的标准文档。

## 6. 数据所有权与数据流

### 6.1 非协同模式

1. 编辑器以规范化后的 `Block.richText` 初始化；字段为空时由 `content` 生成。
2. TipTap `onUpdate` 读取 `editor.getJSON()`，经客户端规范化后生成 `{ richText, content }`。
3. Block 更新操作一次写入两个字段并刷新块与文档 `updatedAt`。仅 marks 改变、纯文本不变时也必须产生更新。
4. 父状态只在编辑器未聚焦时回灌，避免保存响应或延迟状态覆盖正在编辑的格式。

### 6.2 协同模式

1. 每个 Block 继续使用 `block-content:${blockId}` Yjs `XmlFragment`。
2. Fragment 为空时只执行一次种子写入：优先写入 `richText`，否则写入由 `content` 生成的文档。
3. 初始化后，Yjs Fragment 是该协同会话内的实时权威源；父级 Block 快照不得反向 `setContent`。
4. TipTap 每次 Yjs 更新都生成结构化 JSON 和纯文本投影，供现有文档保存、历史和非协同读取使用。
5. 延迟到达的父快照不得覆盖本地或远端已合并的 Yjs 格式。

### 6.3 服务端与存储

- `editor_blocks` 新增 `rich_text JSONB` 可空列，迁移必须幂等。
- PostgreSQL 文档存储在插入和更新时写入规范化 JSONB；读取异常结构时退回 `content` 生成的安全文档。
- IndexedDB v2 不升级数据库版本，仅在现有文档对象中增加可选字段；归一化读取旧对象。
- 文档 API、工作区 API、文档历史和 Yjs 结构补丁携带相同的 `richText` 契约。
- 历史恢复直接恢复 JSON 与投影；旧历史快照缺少 JSON 时使用同一惰性转换。

## 7. 组件边界

### 7.1 共享编解码模块

新增共享纯函数模块，职责限定为：

- `createRichTextFromPlainText(content)`
- `normalizeRichText(value)`
- `projectRichTextContent(document)`
- `normalizeRichTextLink(value)`
- `toAnonymousRichText(document)`
- 计算 UTF-8 序列化大小

服务端、浏览器、历史和匿名分享都复用同一实现，避免分别维护 JSON 规则。

### 7.2 Block 操作

文本更新接口从单一字符串改为：

```ts
interface RichTextUpdate {
  content: string;
  richText: RichTextDocument;
}
```

`RichTextBlockEditor`、`TodoBlockEditor`、`BlockRow`、`BlockList`、`DocumentEditor` 和 `EditorPage` 沿现有回调链传递该对象。代码块保留原字符串更新接口，避免伪造富文本结构。

### 7.3 灰白浮动工具条

- 选区非空时显示，选区收起、编辑器失焦或只读时隐藏。
- 使用现有项目色：白色或 `zinc-50` 面板、`zinc-200` 边框、`zinc-800` 图标、轻阴影和浅灰激活态。
- 使用 Lucide `Bold`、`Italic`、`Strikethrough`、`Code2`、`Link2` 和 `MessageSquare` 图标；所有按钮提供 tooltip、明确 `aria-label` 和固定尺寸。
- 工具条根据当前选区 marks 显示激活状态，组合格式可同时激活。
- 保留 TipTap 原生格式快捷键；行内代码使用 `Mod-E`。

### 7.4 链接锚定浮层

- 从浮动工具条的 `Link2` 打开，锚定当前选区并保留选区范围。
- 使用带标签输入框和明确字段错误，不使用浏览器 prompt。
- `Enter` 确认，`Escape` 关闭并恢复编辑器焦点。
- 已有链接提供打开、复制、修改和移除操作；打开使用新标签页并设置 `rel="noreferrer"`。
- 空值执行移除链接；危险或无效协议不改变文档。

### 7.5 粘贴

- 外部 HTML 删除脚本、样式、事件属性、未知节点和未知 marks。
- 支持的段落分隔转换为 `hardBreak`，不创建新 Block。
- 只保留安全链接。
- 只有 Nexus 内部结构化剪贴板且 mention 属性完整时才保留 mention 节点；普通外部 HTML 中形似 mention 的内容降级为文本。

## 8. 匿名分享与隐私

- 匿名共享快照携带白名单 `richText`，以便保留公开格式和安全链接。
- mention 在匿名响应中转换为普通 text `@label`，不得返回 `targetId` 或 `kind`。
- 匿名页面继续不加载工作区壳、评论、历史、成员、任务元数据或 Yjs。
- 只读 TipTap 渲染不得暴露格式编辑按钮、链接修改入口或可编辑 DOM。

## 9. 错误处理

- 浏览器粘贴采用宽松清洗；API 写入采用严格校验。
- API 收到未知节点、未知 mark、错误根结构、非法链接、超限 JSON，或非文本块携带 `richText` 时返回 `400` 和稳定中文错误。
- 数据库读取到空或异常结构时退回纯文本，不阻断整个文档；下一次合法保存修复 JSONB。
- 保存失败保留编辑器内当前 JSON，并沿用现有保存失败状态；不得用旧父快照回滚未持久化格式。
- 链接浮层显示字段级错误，错误输入不关闭浮层、不修改选区内容。

## 10. 迁移与回滚

### 10.1 迁移

- 新增幂等迁移，为 `editor_blocks` 添加 `rich_text JSONB`。
- 不执行全表 UPDATE，不在迁移事务内解析正文。
- 新服务读取旧行时惰性转换；写入时保存 JSONB 和重新计算的纯文本。
- IndexedDB 旧对象通过归一化兼容，无需升级 object store。

### 10.2 回滚

- 数据库列为可空且不替换 `content`，旧服务镜像可忽略新列并继续读取纯文本。
- 应用回滚必须同时回滚 Web 和服务端镜像，避免新前端向旧服务提交其不认识的字段。
- 回滚不删除 `rich_text`，再次升级后可继续使用已保存格式。

## 11. 测试策略

严格执行 RED-GREEN-REFACTOR：

- 编解码单元测试覆盖纯文本转换、JSON 规范化、marks 组合、mention、hardBreak、投影、链接协议、大小上限和匿名降级。
- 迁移和存储测试覆盖 JSONB 幂等迁移、PostgreSQL/IndexedDB 读写、服务端重算投影、旧数据读取与历史恢复。
- 编辑器组件测试覆盖格式按钮、激活状态、行内代码、链接浮层键盘操作、复制/打开/移除、粘贴清洗和只读隐藏。
- Yjs 测试覆盖两个编辑器同步 marks 与 mention、纯文本未变的格式更新、首次种子和延迟父快照保护。
- 匿名分享测试断言格式保留、mention 目标移除、无编辑入口。
- 定向 Playwright 覆盖刷新、历史恢复、双浏览器格式同步、匿名分享，以及桌面/移动工具条与链接浮层截图和边界检查。
- 验证执行定向 Vitest、真实 PostgreSQL、TypeScript、生产构建和 M8.1A E2E；暂不运行存在 10 项 M6 基线失败的完整 E2E。

## 12. 验收标准

- 段落、标题、引用和待办的支持格式在保存、刷新和历史恢复后完全一致。
- 两个浏览器能同步 marks、链接、mention 和 hardBreak，且不会被延迟父快照覆盖。
- 纯文本投影始终与规范化 JSON 一致；仅格式变化也会持久化。
- 旧纯文本数据无需批量回填即可打开，首次保存后获得 JSONB。
- 危险链接和超限/未知 JSON 被拒绝，错误不会破坏当前内容。
- 匿名分享保留公开格式，但不暴露 mention 目标、内部标识或编辑能力。
- 灰白浮动工具条和链接锚定浮层在桌面与移动视口内不溢出、不遮挡选区关键内容。
