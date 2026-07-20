# M7 文档权限与真实分享设计

**日期：** 2026-07-20  
**状态：** 待评审  
**范围：** M7.1 文档路由与服务端页面权限；M7.2 只读分享链接

## 1. 背景与问题

当前应用以工作区成员角色控制访问。`GET /api/workspaces/:workspaceId` 返回整个工作区内容，`PUT /api/workspaces/:workspaceId` 以整个工作区快照保存；文件下载和协作 WebSocket 同样只检查工作区权限。编辑器中的 `SharePopover` 只维护前端状态，复制的 `/documents/:documentId` 路由也尚不存在。

这与 M7 的私有文档要求冲突：工作区成员即使不应访问某篇私有文档，也可以从工作区快照读到内容，并可能在全量保存时覆盖它。因此 M7.1 不能只增加一张权限表，必须先建立按文档强制执行的读取和写入边界。

## 2. 目标与非目标

### 目标

- 为已登录用户提供稳定的 `/documents/:documentId` 文档入口。
- 支持 `workspace`、`private`、`link` 三种访问模式，默认继承工作区访问。
- 让文档读取、保存、历史、文件和协作连接使用同一个服务端判定结果。
- 使用不可逆 HMAC 存储分享令牌，支持关闭、重新生成和可选过期时间。
- 让无权访问对外统一表现为资源不存在，避免通过文档 ID、文件 key 或房间名枚举内容。
- 为权限改变、分享操作和分享访问失败记录不含正文和原始令牌的审计事件。

### 非目标

- 分享密码、下载限制、域名白名单和匿名协作编辑。
- 复杂的组织、群组或部门主体授权。
- M8 的富文本 JSON、全文搜索、通知和页面树。
- M9 的块级增量写入和通用后台任务队列。M7 只引入文档级快照 API 以保证权限边界。

## 3. 方案比较

### 方案 A：在现有工作区 API 上追加权限过滤

`loadWorkspace` 过滤私有文档，`saveWorkspace` 对提交快照逐项校验。

- 优点：客户端改动较少。
- 缺点：删除、移动、重排和并发保存难以可靠区分；全量快照会持续扩大越权与误覆盖风险；文件、历史和 WebSocket 仍会各自实现判断。

不采用。

### 方案 B：建立统一文档授权服务并引入文档级 API

工作区接口只负责目录、成员和工作区切换；文档内容通过文档级读取、保存和历史接口访问。所有资源调用统一的文档授权服务。

- 优点：资源归属、读取、写入与审计有唯一判定点；能够逐步衔接 M9 的增量保存；私有文档不再进入无权用户的工作区快照。
- 缺点：需要重构远端仓库和编辑器会话的数据加载边界。

采用。

### 方案 C：以 PostgreSQL Row-Level Security 取代应用层权限

将会话用户映射到数据库连接变量，由 RLS 过滤每一次查询。

- 优点：数据库层提供额外保护。
- 缺点：当前连接池、迁移和后台任务没有用户上下文；文件存储和 WebSocket 仍需应用层授权；首次引入成本高。

暂不采用。M9 再评估是否将它作为纵深防御，而不是唯一授权机制。

## 4. 授权模型

### 4.1 数据模型

在 `editor_documents` 增加：

- `created_by TEXT NOT NULL REFERENCES app_users(id)`：私有文档的作者；历史数据回填为所属工作区 owner。
- `access_mode TEXT NOT NULL DEFAULT 'workspace'`，约束为 `workspace`、`private`、`link`。

新增 `document_permissions`：

- `workspace_id`、`document_id`：联合外键指向文档。
- `user_id`：首批只支持用户主体。
- `role`：`editor` 或 `viewer`。
- `created_by`、`created_at`、`updated_at`。
- 主键为 `(workspace_id, document_id, user_id)`。

新增 `document_share_links`：

- `id`、`workspace_id`、`document_id`、`token_hash`、`created_by`、`created_at`。
- `expires_at` 可空，`revoked_at` 可空；同一文档最多一个未撤销链接。
- `token_hash` 使用服务端密钥对随机令牌计算 HMAC，令牌本身只出现在创建响应和 URL 中。

现有 `workspace_audit_events` 复用为 M7 审计载体，新增文档权限和分享相关事件类型。事件元数据只存文档/工作区/分享 ID、执行人、结果和失效时间，不存正文、原始令牌或完整 URL。

### 4.2 权限判定与优先级

新建 `DocumentAuthorizationService`，其输入为用户或分享令牌、文档 ID 和所需动作，输出标准化的 `DocumentAccess`：`workspaceId`、`documentId`、`canRead`、`canWrite`、`canManage`、`source`。

对已登录用户，优先级如下：

1. 工作区 owner 总是可读、可写、可管理。
2. 文档作者总是可读、可写；仅 owner 可调整访问模式和成员授权。
3. 显式 `document_permissions` 按 `editor` 或 `viewer` 生效。
4. `workspace` 或 `link` 模式下，工作区成员继承自身工作区角色。
5. `private` 模式下，非 owner 的工作区成员不继承访问权。

分享令牌只产生 `canRead: true`、`canWrite: false` 的 `source: "share-link"` 访问；令牌撤销、过期、哈希不匹配或文档已删除时一律不返回文档。链接模式不会提升无权登录用户的写入能力。

未通过权限判定的文档、版本、附件和协作资源统一返回 404；缺少会话且资源不允许匿名分享时返回 401。

## 5. M7.1 架构与 API

### 5.1 文档级数据边界

远端会话改为先请求可访问文档目录，再按当前文档 ID 请求内容。工作区成员目录不包含其无权访问的私有文档，目录记录只保留 `id`、`title`、`updatedAt`、`accessMode` 和当前访问角色。

新增文档接口：

- `GET /api/documents/:documentId`：返回当前用户可读的文档快照、工作区摘要和 `DocumentAccess`。
- `PUT /api/documents/:documentId`：保存单篇文档快照；仅 `canWrite` 用户可调用。
- `GET /api/documents/:documentId/permissions`：owner 获取访问模式和显式成员。
- `PATCH /api/documents/:documentId/permissions`：owner 更新访问模式和显式成员，使用完整且经过校验的目标状态，避免部分更新留下错误授权。
- `GET|POST|DELETE /api/documents/:documentId/share-links`：owner 获取、创建/重新生成和关闭分享链接。

现有工作区 `GET`/`PUT` 在 M7.1 迁移期保留给本地模式和兼容读取，但 PostgreSQL 远端编辑器不再通过它读取或保存文档内容。新文档 API 到位后移除远端仓库对整工作区 `save` 的调用，并为旧端点补充拒绝私有文档混合快照的保护，防止过渡期绕过。

`/documents/:documentId` 作为已登录入口。页面先解析会话，再调用文档接口；无权时展示通用的“文档不可用”状态而非文档标题。根入口继续承载工作区目录与切换，选中文档后导航到规范文档路由。

### 5.2 文件、历史与协作

- 附件元数据必须建立文档归属。上传接口新增 `documentId`，并在对象 key 前缀仍保持 `workspaceId/` 的同时记录 `workspace_id + document_id + key` 映射。
- 下载接口从附件元数据反查文档，再调用 `DocumentAuthorizationService`；不得只按 workspace key 授权。
- 历史版本查询和恢复改为按文档授权；分享访问者没有历史接口。
- WebSocket 握手在解析 room 后由授权服务验证文档写入权限。workspace viewer、显式 viewer 和分享链接访问者都不得加入可写 Yjs room。
- M7 不为匿名分享者提供 Yjs 实时订阅。`/share/:token` 使用只读文档快照，刷新后获取最新持久化内容。这样不需要在 y-websocket 协议中实现不可信客户端的更新过滤。
- 权限变更、撤销分享和删除授权记录后，调用现有协作失效发布机制，关闭受影响用户的已建立写入连接。

### 5.3 客户端与交互

`SharePopover` 从本地 `sharePermission` 状态改为服务器返回的 `DocumentAccessPolicy`。只有 owner 看见权限管理控件；其他用户只看自己的访问角色。

- “私有”显示显式授权成员列表，可添加工作区现有成员并指定 editor/viewer。
- “团队可查看”保持显式授权记录，但工作区成员按自身角色继承访问。
- “拥有链接的人可查看”显示链接状态、可选过期时间、复制、关闭和重新生成。创建与重新生成后才显示完整 URL；刷新后的 UI 只显示链接状态。
- 保存、角色变化和链接操作使用禁用态与明确错误提示；页面在权限被收回后返回工作区目录。

## 6. M7.2 匿名分享读取

新增 `GET /api/shared-documents/:token` 和 `/share/:token`。服务端以 HMAC 验证令牌，返回一个最小只读文档视图：标题、块内容、允许展示的附件 URL 与失效时间。该响应不得包含工作区成员、评论作者邮箱、历史、任务分配、内部审计或编辑控制。

附件读取不接受裸分享令牌作为长期凭据。分享页面在服务端验证后，为该页面关联的附件签发短时、单文件、只读签名 URL；签名 URL 同样在撤销分享后失效。

## 7. 错误处理、迁移与兼容

- 所有新表和列通过幂等迁移创建，并为旧文档回填 `created_by` 与 `access_mode = 'workspace'`。
- 迁移前导出数据库和对象存储清单；迁移后检查每篇文档都有作者、每条权限/分享记录的复合外键有效。
- 权限策略更改使用事务，提交后发布协作权限失效事件；发布失败记录可重试审计，不回滚已提交的授权数据。
- 分享令牌生成使用至少 256 bit 的加密随机数。比较采用恒定时间语义，由 HMAC 查找避免保存明文。
- 旧 `/documents/:id` 前端链接在路由上线后保持有效；旧模拟分享状态不迁移为真实链接，避免误公开内容。

## 8. 测试与验收

### 单元与集成

- 授权矩阵覆盖 owner、作者、editor、viewer、显式 editor/viewer、非成员、已删除工作区和过期/撤销分享令牌。
- PostgreSQL 迁移覆盖旧文档回填、复合外键、唯一未撤销分享链接与幂等重复执行。
- 文档读取、保存、删除、目录过滤、历史、附件和 WebSocket 都验证相同的 `DocumentAccess` 结果。
- 验证全量工作区保存端点不能通过过渡路径读取或覆盖私有文档。
- 验证审计日志不含正文、原始分享令牌或完整分享 URL。

### Playwright

- owner 创建私有文档，普通工作区 editor 无法从目录、直接路由、历史、附件或 WebSocket 访问。
- owner 显式授予 editor 后，该成员可编辑；降级为 viewer 后现有协作连接被关闭且 API 写入被拒绝。
- 团队模式下 viewer 只读、editor 可编辑，刷新与跨浏览器一致。
- 创建链接后未登录浏览器可只读打开；过期、关闭或重新生成后旧链接立即失效。
- 桌面和移动宽度下分享面板的链接管理、错误和权限回收状态可访问且无布局遮挡。

## 9. 交付顺序

1. 建立共享类型、`DocumentAuthorizationService` 和单元测试。
2. 添加文档策略、显式授权、作者回填与审计迁移；补 PostgreSQL 集成测试。
3. 建立文档目录/读取/保存 API，并将远端编辑器会话切换到文档级加载与保存。
4. 改造历史、附件与协作握手，关闭整工作区授权绕过路径。
5. 增加 `/documents/:documentId` 和真实权限管理 UI，完成 M7.1 E2E。
6. 实现分享令牌、只读分享页、短时附件签名 URL 与撤销失效，完成 M7.2 E2E。
7. 在 Docker、真实 PostgreSQL、Redis、对象存储和浏览器环境跑完整回归与回滚演练。

## 10. 风险与后续衔接

- 文档级 API 是 M7 的安全必要最小改造，但仍保存文档级快照。M9 将其演进为版本化、幂等的块级增量写入。
- 匿名分享不接入实时 Yjs，避免只读客户端可伪造更新的协议风险；需要实时匿名预览时单独设计只读广播通道。
- M8 搜索、通知、页面树和提及必须调用本授权服务，不能自行根据工作区成员关系过滤。
- M10 的检索、缓存和引用同样以 `DocumentAccess` 为唯一权限来源。
