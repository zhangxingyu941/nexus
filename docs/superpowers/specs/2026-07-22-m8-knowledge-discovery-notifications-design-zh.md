# M8 知识发现：页面树、搜索、反向链接与通知设计

状态：已确认

日期：2026-07-22

范围：M8.2 + M8.3

## 1. 背景

Nexus 已有平铺文档列表、浏览器内工作区搜索、People/Docs/Tasks/Dates mention、块评论、任务负责人和 M7 文档权限。当前搜索只遍历已经加载到浏览器的工作区快照，无法覆盖服务端全部授权内容；文档没有父子关系和反向链接；mention 只参与编辑显示，不生成可靠通知；评论正文仍是纯字符串，无法稳定识别重名成员。

本阶段把 M8.2 与 M8.3 合并为“页面组织、知识检索和回流”能力：文档树负责组织，搜索和反向链接负责发现，通知负责把用户带回准确的文档、块或评论。三者必须统一使用 M7 授权服务，不能各自实现权限判断。

## 2. 目标

- 为文档建立单父级、最多 10 层的工作区内页面树和权限安全的面包屑。
- 使用 PostgreSQL `tsvector + pg_trgm` 提供中英文混合服务端搜索。
- 搜索标题、正文纯文本投影、任务和评论，并支持工作区、作者、更新时间和内容类型筛选。
- 从结构化文档 mention 和内部文档链接生成可查询的反向链接。
- 把评论升级为带稳定人员目标的受限结构化正文。
- 为正文人员提及、评论人员提及和任务负责人变更生成幂等站内通知。
- 提供未读数、分类筛选、单条/全部已读和精确目标跳转。
- 使用认证 SSE 推送变更信号，并以轮询和窗口聚焦刷新作为兜底。
- 成员移除或文档权限回收后，搜索、反向链接和历史通知都不能泄露原内容。

## 3. 非目标

- 不引入 Elasticsearch、Meilisearch 或其他独立搜索服务。
- 不提供跨工作区页面父子关系或超过 10 层的树。
- 不支持任意关系数据库、公式聚合、标签图谱或可视化知识图。
- 不从普通文本猜测文档引用；只处理结构化 document mention 和规范内部链接。
- 不提供邮件即时通知、短信、移动推送、Webhook 或用户级渠道偏好。
- 不在本阶段建设 M9 通用事务 Outbox、后台任务队列和通知保留策略。
- 不向匿名分享访问者提供搜索、反向链接或通知能力。
- 不把 SSE 当作内容传输通道；SSE 只发送失效信号，数据仍由授权 API 拉取。

## 4. 已确认决策

- 页面树使用同工作区单父级模型，最大深度 10。
- 搜索使用 PostgreSQL `tsvector + pg_trgm`，不增加独立基础设施。
- 搜索索引在文档/评论写入事务内同步更新，后台索引队列留到 M9。
- document mention 和 `/documents/...` 内部链接都生成反向链接。
- 评论使用“文本 + person mention + 安全链接”的结构化 JSON 与纯文本投影。
- 通知与业务内容在同一 PostgreSQL 事务内直接写入，唯一事件键去重。
- 通知中心使用顶部栏铃铛、桌面右侧抽屉和移动端全屏布局。
- 通知变化使用专用 SSE，30 秒轮询和窗口聚焦刷新兜底。

## 5. 总体架构

### 5.1 领域模块

- `DocumentTreeService`：树读取、移动、循环/深度校验和面包屑。
- `DocumentSearchStore`：同步索引、混合检索、筛选、排序和权限约束。
- `DocumentReferenceStore`：从规范富文本提取引用并提供反向链接。
- `CommentContentCodec`：评论结构校验、纯文本投影和人员 mention 提取。
- `NotificationStore`：事件差异计算、幂等插入、列表、未读和权限清理。
- `NotificationSignalHub`：PostgreSQL 通知监听、用户 SSE 连接和失效广播。

模块共享 M7 `DocumentAuthorizationService` 和工作区成员存储。API handler 只负责身份验证、输入解析和错误映射，不自行拼接权限 SQL 或解析富文本。

### 5.2 一致性边界

文档保存事务同时完成：

1. 规范化并写入文档和 Block。
2. 重建该文档的搜索条目。
3. 重建该文档的结构化引用。
4. 比较保存前后人员 mention 与任务负责人，插入新增通知。
5. 提交 PostgreSQL `NOTIFY` 失效信号。

评论创建事务同时写入评论、搜索条目、人员 mention 通知和失效信号。事务失败时四类派生数据都不变化。

## 6. 页面树数据模型

### 6.1 PostgreSQL

共享 `EditorDocument` 契约增加 `parentDocumentId: string | null` 和 `treePosition: number`，工作区 API、文档目录 API、IndexedDB 归一化和历史快照都显式携带这两个字段。旧对象缺字段时读取为根页面，并用原数组索引生成 treePosition。

`editor_documents` 增加：

```sql
parent_document_id TEXT NULL,
tree_position INTEGER NOT NULL DEFAULT 0,
FOREIGN KEY (workspace_id, parent_document_id)
  REFERENCES editor_documents(workspace_id, id)
  ON DELETE RESTRICT,
CHECK (parent_document_id IS NULL OR parent_document_id <> id)
```

`tree_position` 表示同一 `parent_document_id` 下的兄弟顺序。根页面的父级为 `NULL`。迁移后所有历史文档都是根页面，`tree_position` 从现有 `position` 回填。现有 `position` 保留为兼容旧服务的扁平先序投影；每次树移动后在同一事务重算受影响工作区的扁平 position。

折叠状态使用独立用户偏好表：

```sql
document_tree_preferences (
  user_id TEXT,
  workspace_id TEXT,
  document_id TEXT,
  collapsed BOOLEAN,
  updated_at BIGINT,
  PRIMARY KEY (user_id, workspace_id, document_id)
)
```

折叠状态不进入共享文档、工作区快照或 Yjs。

本地模式把折叠偏好写入 IndexedDB `preferences` store，键包含 workspaceId、documentId 和当前本地身份；不升级 object store。远程模式使用上述 PostgreSQL 偏好表。

### 6.2 树不变量

- 父子文档必须属于同一工作区。
- 文档不能成为自身或任一子孙的子级。
- 从根到任一节点最多 10 层，根为第 1 层。
- 每组兄弟的 tree_position 从 0 连续排列。
- 移动父页面时整体移动其子树，不重写子节点相对顺序。
- 树操作锁定源、目标和受影响兄弟行，并在事务内通过递归 CTE 复验。

### 6.3 权限与不可见祖先

- 树 API 先取得用户可读文档集合，再构造响应。
- 可读子页面的父级不可读时，响应把该子页面作为虚拟根节点；不返回父级 ID、标题或层级占位。
- 面包屑只包含连续可读祖先；遇到不可读祖先即截断。
- 移动文档要求源文档写权限、目标父级写权限和工作区成员身份。
- 删除父页面时，直接子页面提升到原父级并保持顺序；执行者必须拥有所有受影响子页面的写权限，工作区 owner 除外。条件不满足返回 `409`，不部分删除。
- viewer、匿名分享和无写权限用户不看到树拖拽或移动入口。

## 7. 页面树交互

- 侧栏按树结构显示折叠按钮、文档图标、标题和现有操作菜单。
- 复用 M8 编辑能力引入的 `dnd-kit` 传感器，支持鼠标、触摸和键盘移动页面。
- Drop zone 明确区分目标前、目标内和目标后；预览线不能依靠颜色单独表达。
- 创建子页面从父页面操作菜单触发；新页面插入父级最后。
- 当前页面的全部可见祖先自动展开，但不覆盖用户对其他分支的折叠偏好。
- 文档顶部显示可点击面包屑；移动端只显示最近两级并提供向上导航菜单。
- 删除、移动和循环错误使用稳定中文状态，失败后保留原树和焦点。

## 8. 搜索数据模型

### 8.1 扩展与索引表

迁移启用：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

统一搜索表建议为：

```ts
interface DocumentSearchEntry {
  workspaceId: string;
  documentId: string;
  sourceType: "document" | "block" | "task" | "comment";
  sourceId: string;
  authorUserId: string | null;
  contentType: string;
  title: string;
  body: string;
  updatedAt: number;
}
```

数据库保存同等字段及 `search_vector TSVECTOR`。主键为 `(workspace_id, document_id, source_type, source_id)`。建立：

- `search_vector` GIN 索引，用 `simple` 配置覆盖英文 token 和无词干精确词。
- `lower(title) gin_trgm_ops` 与 `lower(body) gin_trgm_ops` 索引，覆盖中文、拼写片段和子串。
- `(workspace_id, updated_at DESC)` 与内容类型筛选索引。

### 8.2 索引内容

- document 条目：文档标题。
- block 条目：段落、标题、引用、代码和普通复杂块的纯文本投影。
- task 条目：待办正文、负责人显示名、到期日和状态的可读投影。
- comment 条目：评论纯文本投影和作者显示名。
- 附件对象 key、私有 URL、mention targetId、审计元数据和匿名令牌永不进入索引。

文档保存时删除并重建该文档的 document/block/task 条目；评论创建、解决或删除只更新对应 comment 条目。重建在原业务事务内完成，失败则正文保存一并回滚。

作者筛选含义固定：document、block 和 task 使用文档 `created_by`；comment 使用评论 `author_user_id`。旧评论没有稳定作者 ID 时可以被关键词检索，但不命中作者筛选。

### 8.3 查询与排序

搜索 API 接受：

```ts
interface SearchRequest {
  query: string;
  workspaceIds?: string[];
  authorUserIds?: string[];
  contentTypes?: Array<"document" | "block" | "task" | "comment">;
  updatedAfter?: number;
  updatedBefore?: number;
  cursor?: string;
  limit?: number;
}
```

- query 去首尾空白后最大 100 个 Unicode code point。
- 一字符查询只匹配标题前缀；正文检索至少两个可见字符。
- 默认 limit 为 20，最大 50，使用签名游标而非 offset。
- 排序依次为标题精确匹配、标题前缀、`ts_rank`、trigram similarity、更新时间和稳定 ID。
- 结果片段由服务端从授权正文生成，最多 160 字；客户端只按返回范围高亮，不渲染服务端 HTML。

### 8.4 权限过滤

搜索 SQL 必须先限制为用户可访问工作区，再按 M7 规则过滤文档：工作区 owner、作者、非 private 工作区文档或显式授权。匿名链接不进入登录用户搜索授权，也不能扩大其他成员权限。

未授权结果不得参与总数、排序、片段生成或游标。权限在索引写入后变化时无需重建索引，因为读取时实时过滤。

本地 IndexedDB 模式继续使用相同 `SearchRequest` / `SearchResult` 契约在当前本地工作区内存中检索，不显示服务端作者筛选和跨工作区选项。远程模式只使用服务端结果，失败时不回退到已加载快照。

## 9. 搜索交互

- 现有快速搜索对话框改为服务端搜索，输入 200 ms 防抖并取消过期请求。
- 空查询显示最近访问的授权文档，不返回全量正文。
- 筛选器使用菜单和可移除筛选项，支持工作区、作者、更新时间和类型。
- 结果显示文档标题、内容类型、上下文片段、更新时间和面包屑摘要。
- 点击 Block、任务或评论结果导航到 `/documents/{publicId}#block-{blockId}`，滚动后短暂高亮目标。
- 评论结果同时打开评论面板并聚焦目标评论。
- 加载、空结果、失败和重试状态保持对话框稳定尺寸，不因结果变化跳动。

## 10. 反向链接

### 10.1 数据模型

```ts
interface DocumentReference {
  workspaceId: string;
  sourceDocumentId: string;
  sourceBlockId: string;
  targetDocumentId: string;
  kind: "mention" | "link";
  updatedAt: number;
}
```

数据库主键包含来源文档、来源块、目标文档和 kind，外键限定同工作区。目标只接受：

- `kind: "document"` 的结构化 mention。
- 规范化后指向 `/documents/{publicId}` 的内部链接 mark。

普通文本、外部 URL、匿名分享 URL 和无法解析的旧标题不生成引用。

### 10.2 同步与读取

- 文档保存事务从规范化 `richText` 提取目标集合，按文档删除旧引用并插入新引用。
- 同一块对同一目标的重复引用合并为一条。
- 目标文档不存在、跨工作区或当前保存者不能读取时不创建引用，并返回非阻断警告。
- 删除来源块或文档通过外键级联清理引用。
- “引用此页面”只返回当前用户同时有权读取来源和目标的记录。
- UI 按来源文档分组，显示块片段；点击后复用搜索结果的块定位。

## 11. 结构化评论

### 11.1 契约

评论使用 M8.1A 文档外壳的受限子集：

```ts
type CommentInlineNode =
  | { type: "text"; text: string; marks?: Array<{ type: "link"; attrs: { href: string } }> }
  | { type: "mention"; attrs: { kind: "person"; label: string; targetId: string } }
  | { type: "hardBreak" };

interface CommentContent {
  richText: CommentRichTextDocument;
  body: string;
}
```

评论只允许 person mention、安全链接和 hardBreak，不支持粗体、标题、任务/文档/date mention 或嵌套段落。服务端从 JSON 重新计算 body。单条 JSON 最大 32 KB，纯文本投影最大 4000 字。

### 11.2 存储迁移

`block_comments` 增加可空 `rich_text JSONB` 和可空 `author_user_id`。旧评论保持 `rich_text = NULL`，读取时从 body 生成普通文本评论；旧作者无法可靠反查时 `author_user_id` 保持 NULL。新评论必须使用当前会话用户 ID 和显示名。

匿名分享继续完全排除评论。评论搜索只索引 body 和公开显示名，不索引 targetId。

## 12. 通知数据模型

### 12.1 任务负责人身份

通知不能依赖自由文本负责人。`Block` 增加 `assigneeUserId: string | null`，现有 `assignee` 继续作为显示投影；`editor_blocks` 增加可空 `assignee_user_id` 外键。新分配操作只提交 userId，服务端验证目标仍是工作区成员并从成员记录重算 assignee 显示值。

历史自由文本负责人无法可靠区分重名或已移除成员，因此迁移不猜测回填，`assignee_user_id` 保持 NULL 且不生成历史通知。成员被移除时同一事务清空其工作区任务的 assigneeUserId 和显示投影。搜索使用当前规范投影，通知只使用稳定 userId。

### 12.2 表结构

```ts
type NotificationType =
  | "block.mentioned"
  | "comment.mentioned"
  | "task.assigned";

interface NotificationRecord {
  id: string;
  recipientUserId: string;
  actorUserId: string;
  workspaceId: string;
  documentId: string;
  blockId: string;
  commentId: string | null;
  type: NotificationType;
  eventKey: string;
  preview: string;
  createdAt: number;
  readAt: number | null;
}
```

`user_notifications` 以 id 为主键，`event_key` 唯一；建立 `(recipient_user_id, read_at, created_at DESC)` 和 `(workspace_id, document_id)` 索引。外键删除源文档或工作区时级联清理。

另建 `user_notification_state (user_id PRIMARY KEY, version BIGINT, updated_at BIGINT)`。通知插入、标记已读、全部已读和权限清理都在同一事务把 version 加一；SSE 使用提交后的 version 去重失效信号。

preview 只保存最多 160 字的纯文本摘要，不保存完整正文、链接凭据、附件 URL、mention targetId 或成员邮箱。

### 12.3 生成规则

- 正文保存前后比较每块 person mention 的目标集合，只对新增目标生成 `block.mentioned`。
- 评论创建时对每个有效 person mention 生成 `comment.mentioned`；编辑评论时同样只处理新增目标。
- todo assigneeUserId 从其他值变为某用户时生成 `task.assigned`；清空、未改变或仅编辑正文不生成。
- actor 与 recipient 相同时跳过自通知。
- recipient 必须是有效工作区成员并在事务执行时拥有目标文档读权限。
- 事件键由类型、来源实体、来源版本和 recipient 构成；同一请求重试不重复，删除后重新添加 mention 可产生新版本通知。
- 一次保存中的重复 mention 对同一用户只产生一条通知。

### 12.4 权限回收

- 移除成员时在同一事务删除该用户对目标工作区的通知。
- 撤销显式文档权限或把文档改为 private 时，删除已不再可读的该文档通知。
- 通知列表、未读数和跳转都再次执行实时权限过滤，清理失败也不能导致泄露。
- 无权限通知不返回占位标题，不计入未读数；后台惰性清理可以删除它，但不是授权保障。

## 13. 通知 API

- `GET /api/notifications`：游标分页、类型筛选和未读筛选，默认 30 条、最大 100 条。
- `GET /api/notifications/unread-count`：返回实时授权后的未读数。
- `POST /api/notifications/{id}/read`：幂等标记单条已读。
- `POST /api/notifications/read-all`：按当前筛选或全部标记已读。
- `GET /api/notifications/stream`：认证 SSE，只发送失效信号。

单条点击流程先请求目标解析 API。服务端确认权限并返回当前 public ID、blockId 和 commentId；成功后标记已读并导航。目标已删除返回 `410` 并移除通知，无权限返回 `404` 并清理通知。

## 14. SSE 与一致性

### 14.1 服务端信号

业务事务在插入通知后调用 PostgreSQL `pg_notify`，载荷只包含 recipientUserId 和单调递增变更版本，不包含通知正文。PostgreSQL 只在事务提交后投递，因此回滚不会产生假提醒。

应用进程中的 `NotificationSignalHub` 监听频道并向该用户已认证的 SSE 连接发送：

```text
event: changed
data: {"version":123}
```

SSE 每 20 秒发送 heartbeat，连接在 session 失效时关闭。多实例分别监听 PostgreSQL，因此不依赖进程内唯一状态。

### 14.2 客户端兜底

- 收到 `changed` 后重新请求未读数；抽屉已打开时同时刷新第一页。
- EventSource 断线使用浏览器退避重连。
- 无 SSE 时每 30 秒刷新未读数，窗口重新聚焦和网络恢复时立即刷新。
- 版本号小于等于最近处理版本时忽略，避免重复请求风暴。
- SSE 永不直接修改通知列表，REST 响应始终是显示权威源。

本地 IndexedDB 模式没有跨用户身份和服务端事件，隐藏通知铃铛与 SSE；页面树和本地搜索仍可用。

## 15. 通知中心交互

- 顶部栏 Bell 图标显示未读 badge；`99+` 为视觉上限，`aria-label` 使用真实数量。
- 桌面打开右侧抽屉，移动端使用全屏页面；不使用居中卡片覆盖正文工作流。
- 顶部使用“全部、提及、评论、任务”标签，提供“全部已读”命令。
- 通知按日期分组，每项显示类型图标、actor、文档标题、最小预览和相对时间。
- 未读项使用浅灰底和明确圆点，不只依赖文字粗细。
- 点击成功导航后关闭移动端面板；桌面端保留抽屉状态，方便连续处理。
- 空状态、加载、失败和重试保持抽屉尺寸稳定，不显示功能说明性营销文本。

## 16. 错误处理

- 页面树循环、超深、目标消失和权限不足分别使用稳定 `400`、`409`、`404`、`403` 错误。
- `pg_trgm` 扩展不可用时迁移失败并阻止启用服务端搜索，不静默退回全表扫描。
- 索引写入失败回滚正文写入，避免搜索结果与已确认保存状态不一致。
- 搜索请求超时可重试，不回退到可能泄露未授权数据的浏览器全量搜索。
- 引用目标无效作为保存警告，不阻断正文；危险链接仍按 M8.1A 规则拒绝。
- 通知唯一键冲突按幂等成功处理；其他通知写入失败回滚业务变更。
- SSE 失败不影响内容保存，客户端进入轮询兜底并显示离线状态。

## 17. 迁移、回填与回滚

### 17.1 数据库迁移

- 为文档增加父级外键并把现有文档保留为根页面。
- 创建树偏好、搜索条目、文档引用和通知表。
- 为评论增加 `rich_text` 与 `author_user_id` 可空列。
- 为 Block 增加 `assignee_user_id` 可空列；不猜测回填历史自由文本负责人。
- 启用 `pg_trgm` 并建立 GIN/筛选索引。
- 所有迁移使用现有 `schema_migrations` 锁并保持幂等。

### 17.2 搜索回填

模式迁移不在单个事务中解析全部历史文档。新增幂等 `db:reindex-search` 命令按 workspace/document 游标分批重建，并记录最后完成位置。发布流程先迁移、再回填、校验数量，最后启用服务端搜索入口。

回填进度保存在 `search_index_backfill_state`，包含固定任务 ID、最后 workspace/document 游标、处理数量、更新时间和完成时间。命令重启后从已提交游标继续；单批失败只回滚该批，不把未完成状态标记为可用。

新写入从迁移完成起同步建索引。回填期间 API 只返回已索引结果，并通过部署开关保持旧 UI 不切换，避免向用户展示不完整搜索。

### 17.3 回滚

- 父级列、tree_position 和新表均为附加结构；旧服务忽略后仍按持续维护的平铺 position 读取确定性文档顺序。
- 回滚 UI 前先关闭搜索与通知入口，再回滚服务镜像；不删除新表或评论 JSON。
- 旧评论 body、文档 content 和 M8.1A richText 保持不变。
- PostgreSQL 扩展与索引留存，不在紧急回滚中执行破坏性 DROP。

## 18. 测试策略

- 树模型单元测试覆盖循环、10 层边界、同级顺序、子树移动、删除提升和不可见祖先。
- 真实 PostgreSQL 测试覆盖递归 CTE 锁、并发移动、复合外键和 `pg_trgm` 索引。
- 搜索测试覆盖中文子串、英文 token、排序稳定性、游标、筛选和 500 块性能。
- 权限矩阵覆盖 owner、作者、显式 editor/viewer、普通成员、已移除成员和匿名用户。
- 索引一致性测试注入写入失败，断言正文、索引、引用和通知共同回滚。
- 反向链接测试覆盖 mention/link 去重、删除清理、跨工作区拒绝和双向权限过滤。
- 评论测试覆盖旧纯文本兼容、person mention 白名单、链接安全、大小限制和纯文本投影。
- 通知测试覆盖新增差异、自通知跳过、任务重新分配、唯一键重试、全部已读和权限清理。
- SSE 测试覆盖提交后推送、回滚不推送、用户隔离、heartbeat、session 失效和重连版本去重。
- 组件测试覆盖树键盘拖拽、搜索筛选、块定位、通知抽屉和移动端全屏。
- Playwright 覆盖多用户私有文档搜索隔离、反向链接跳转、mention 通知和权限回收后的立即消失。

## 19. 验收标准

- 页面树支持创建、折叠、移动和面包屑，且不允许循环、跨工作区关系或超过 10 层。
- 用户看不到任何不可访问祖先、搜索结果、反向链接、通知标题或预览。
- 中文和英文查询能稳定命中标题、正文、任务和评论，并支持已确认筛选项。
- 保存成功后搜索和反向链接立即反映最新内容，失败时正文与派生数据共同回滚。
- document mention 和内部链接均出现在“引用此页面”，普通文本不会误报。
- 新增正文/评论人员 mention 和任务负责人变更各产生一次通知，重试不重复。
- 点击通知能准确定位文档、块或评论；权限回收后旧通知不能继续访问或泄露内容。
- SSE 正常时未读数及时刷新，断线时轮询和聚焦刷新能恢复一致。
- 页面树、搜索对话框和通知中心在桌面与移动视口内无溢出、重叠或明显布局跳动。
