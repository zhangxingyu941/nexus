# M6.2A 工作区邀请闭环设计

日期：2026-07-16

状态：已确认，待实现计划

## 1. 背景

M6 第一批已经完成多工作区目录、显式 `workspaceId` 作用域、工作区切换、owner 重命名、IndexedDB v2 迁移，以及成员、历史、文件和 Yjs 房间隔离。

当前成员添加仍要求目标邮箱已经注册，缺少真实团队进入工作区所需的邀请闭环。M6 第二批按以下顺序拆分：

1. M6.2A：工作区邀请闭环。
2. M6.2B：成员角色修改、移除、退出和所有权转让。
3. M6.2C：工作区删除、级联清理和删除审计。

本文只设计 M6.2A。

## 2. 目标

- owner 可以邀请已注册或尚未注册的邮箱加入当前工作区。
- 收件人可以通过邮件链接或站内邀请中心接受或拒绝邀请。
- 邀请接受前不产生任何工作区访问权限。
- 接受成功后创建成员关系，并主动切换进入目标工作区。
- 邀请支持 24 小时过期、撤销、重发、邮件失败重试和稳定状态展示。
- 邀请令牌只以 HMAC 形式持久化，不进入日志、审计或 API 响应。
- 为后续成员生命周期和工作区删除建立可复用的工作区审计基础。

## 3. 非目标

本阶段不实现：

- 修改现有成员角色。
- 移除成员或普通成员主动退出。
- 所有权转让和最后一名 owner 保护。
- 工作区删除和对象文件清理。
- 账号设置、密码修改和会话管理。
- 真实文档分享链接和文档级权限。
- 站内通知中心的通用消息类型；本阶段只提供邀请入口。

## 4. 已确认产品规则

- 采用独立 `workspace_invites` 表，pending 邀请不写入 `workspace_members`。
- 邮件邀请和站内邀请中心同时交付。
- 收到的邀请使用全局入口；owner 发出的邀请在当前工作区管理 Dialog 中处理。
- 邀请有效期为 24 小时。
- 同一工作区和邮箱只能存在一个有效 pending 邀请。
- 重发立即废弃旧令牌、生成新令牌，并重新计算 24 小时。
- 已是工作区成员的邮箱不能再次邀请；角色只能在 M6.2B 的成员管理中修改。
- 创建邀请时角色没有默认值，owner 必须明确选择 `editor` 或 `viewer`。
- 邀请不能直接授予 `owner`。
- 接受邀请后加入并切换到目标工作区。
- 收件人可以主动拒绝；拒绝后的邀请不能重发，只能重新创建。
- owner 页面显示所有 pending 邀请和最近 30 天的终态记录。
- 同一邀请 60 秒内不能重发；同一工作区每小时最多发送 20 封；同一收件邮箱每小时最多接收 5 封。

## 5. 总体架构

邀请系统分为四个边界：

1. `PostgresWorkspaceInviteStore` 负责邀请状态、约束、接受事务和审计写入。
2. 工作区 owner API 负责创建、列表、重发和撤销。
3. 收件人 API 负责全局待处理列表、令牌解析、接受和拒绝。
4. `WorkspaceInviteMailer` 负责构造邮件链接并发送，不拥有邀请状态。

权限关系：

- owner API 必须先验证当前用户是目标工作区 owner。
- 收件人站内 API 只按当前会话用户的规范化邮箱读取和操作邀请。
- 邮件令牌 API 先验证令牌 HMAC，再要求登录邮箱与邀请邮箱一致，才能接受或拒绝。
- pending、expired、revoked 和 declined 邀请均不产生工作区访问权。
- 只有接受事务成功写入 `workspace_members` 后，REST、文件和 WebSocket 权限才生效。

## 6. 数据模型

### 6.1 `workspace_invites`

```sql
CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')
  ),
  delivery_status TEXT NOT NULL CHECK (
    delivery_status IN ('pending', 'sent', 'failed')
  ),
  invited_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  accepted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  declined_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_delivery_attempt_at BIGINT,
  last_sent_at BIGINT,
  accepted_at BIGINT,
  declined_at BIGINT,
  revoked_at BIGINT
);

CREATE UNIQUE INDEX workspace_invites_pending_email_idx
  ON workspace_invites(workspace_id, email)
  WHERE status = 'pending';

CREATE INDEX workspace_invites_recipient_idx
  ON workspace_invites(email, status, expires_at);

CREATE INDEX workspace_invites_workspace_history_idx
  ON workspace_invites(workspace_id, created_at DESC);
```

字段规则：

- `email` 在进入 Store 前统一 trim 和 lowercase。
- `token_hash` 使用 `AUTH_HASH_SECRET` 和 `workspace-invite` 域隔离计算 HMAC。
- 原始令牌只在创建或重发调用栈中短暂存在，并只传给 Mailer。
- `last_delivery_attempt_at` 同时约束成功和失败后的 60 秒重发冷却。
- `last_sent_at` 只在邮件发送成功后更新。
- 接受、拒绝和撤销时间只在对应终态写入；接受和拒绝同时记录对应用户。

### 6.2 `workspace_audit_events`

```sql
CREATE TABLE workspace_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX workspace_audit_events_workspace_idx
  ON workspace_audit_events(workspace_id, created_at DESC);
```

`workspace_id` 刻意不设置外键，使 M6.2C 删除工作区后仍能保留审计。`workspace_name` 保存事件发生时的名称快照。

邀请审计事件：

- `workspace_invite_created`
- `workspace_invite_sent`
- `workspace_invite_delivery_failed`
- `workspace_invite_resent`
- `workspace_invite_revoked`
- `workspace_invite_accepted`
- `workspace_invite_declined`
- `workspace_invite_expired`

`metadata` 只允许角色、邮箱 HMAC、发送结果和稳定失败码，不保存原始邮箱正文、原始令牌或邮件供应商响应。

## 7. 状态机

### 7.1 合法转换

- `pending -> accepted`
- `pending -> declined`
- `pending -> revoked`
- `pending -> expired`
- `pending -> pending`：仅用于重发，必须轮换令牌并重置过期时间。

终态不能再次转换。重复接受、拒绝、撤销和重发必须返回对应稳定错误。

### 7.2 过期处理

不引入定时任务。Store 在以下操作开始前，把 `expires_at <= now` 的 pending 邀请惰性更新为 expired，并写一次审计：

- owner 列表、创建、重发和撤销。
- 收件人列表、令牌解析、接受和拒绝。

状态更新必须使用条件更新，保证并发请求只写一条 expired 审计。

### 7.3 接受事务

接受必须在一个 PostgreSQL 事务内完成：

1. `SELECT ... FOR UPDATE` 锁定邀请。
2. 处理过期并验证状态仍为 pending。
3. 验证当前登录邮箱与邀请邮箱完全一致。
4. 再次确认目标邮箱尚未是工作区成员。
5. 插入 `workspace_members`，角色来自邀请。
6. 把邀请更新为 accepted，记录 `accepted_by` 和 `accepted_at`。
7. 写 `workspace_invite_accepted` 审计。
8. 提交事务。
9. 调用现有显式工作区选择逻辑并返回目标工作区快照。

如果成员插入或状态更新失败，事务必须整体回滚，不能出现成员已创建但邀请仍 pending 的状态。

## 8. API 契约

所有 API 使用精确字段名。错误响应统一为：

```ts
interface ApiError {
  code: string;
  error: string;
  retryAfterSeconds?: number;
}
```

### 8.1 Owner API

#### `GET /api/workspaces/:workspaceId/invites`

返回：

- 全部 pending 邀请。
- 最近 30 天的 accepted、declined、revoked 和 expired 邀请。
- 每项包含 `id`、`workspaceId`、`email`、`role`、`status`、`deliveryStatus`、`createdAt`、`expiresAt`、`lastSentAt` 和邀请人摘要。

#### `POST /api/workspaces/:workspaceId/invites`

请求：

```json
{ "email": "member@example.com", "role": "editor" }
```

处理顺序：

1. 验证 owner、邮箱和显式角色。
2. 应用 Redis 工作区与邮箱限流。
3. 过期旧 pending 邀请。
4. 拒绝已有成员和仍有效的 pending 邀请。
5. 创建邀请并提交事务。
6. 发送邮件并更新 delivery 状态。

资源创建成功但邮件失败时仍返回 `201`：

```ts
interface CreateWorkspaceInviteResponse {
  invite: WorkspaceInviteSummary;
  deliveryWarning: null | {
    code: "invite_delivery_failed";
    error: string;
  };
}
```

此时 `invite.deliveryStatus` 为 `failed`。前端必须显示“邀请已创建，但邮件发送失败”。

#### `POST /api/workspaces/:workspaceId/invites/:inviteId/resend`

- 只允许 pending 邀请。
- 同一邀请距离上次发送尝试不足 60 秒时返回 429。
- 轮换令牌 HMAC，旧邮件链接立即失效。
- 重置 `expiresAt = now + 24h`。
- 邮件失败仍保留 pending 邀请和失败状态。

#### `DELETE /api/workspaces/:workspaceId/invites/:inviteId`

- 只允许 pending 邀请。
- 更新为 revoked，不物理删除。
- 已接受、拒绝、撤销或过期邀请不能再次撤销。

### 8.2 收件人 API

#### `GET /api/workspace-invites`

- 必须登录。
- 只返回 `email = session.user.email` 的有效 pending 邀请。
- 返回工作区名称、邀请人、角色和剩余有效时间。
- 不返回原始令牌或 token hash。

#### `POST /api/workspace-invites/:inviteId/accept`

- 必须登录。
- 通过邀请 ID 锁定记录，并验证登录邮箱。
- 接受成功后返回新工作区目录和目标工作区快照。

#### `POST /api/workspace-invites/:inviteId/decline`

- 必须登录。
- 通过邀请 ID 锁定记录，并验证登录邮箱。
- 更新为 declined，记录审计。

### 8.3 邮件令牌 API

#### `POST /api/workspace-invites/resolve`

请求：

```json
{ "token": "raw-token" }
```

返回最小摘要：工作区名称、邀请人显示名称、角色、掩码邮箱、状态和过期时间。无效令牌统一返回 404，不区分不存在、已轮换或格式错误。

验证成功后，服务端把邀请 ID、当前 token hash 摘要和最晚有效时间写入带 HMAC 签名的短期 HttpOnly Cookie：

- Cookie 名称：`nexus_workspace_invite_context`。
- `Secure` 遵循现有认证 Cookie 配置。
- `SameSite=Lax`。
- Path 为 `/api/workspace-invites`。
- 最长 30 分钟，且不能超过邀请自身过期时间。
- Cookie 不包含原始令牌。

#### `POST /api/workspace-invites/accept`

读取 `nexus_workspace_invite_context` Cookie。必须登录，并重新验证邀请状态、token hash 摘要和登录邮箱后执行接受事务。成功或终态失败后清除上下文 Cookie。

#### `POST /api/workspace-invites/decline`

读取 `nexus_workspace_invite_context` Cookie。必须登录，并重新验证邀请状态、token hash 摘要和登录邮箱后执行拒绝事务。成功或终态失败后清除上下文 Cookie。

### 8.4 稳定错误码

- `already_member`
- `invite_pending`
- `invite_expired`
- `invite_revoked`
- `invite_declined`
- `invite_already_accepted`
- `invite_email_mismatch`
- `invite_role_required`
- `invite_role_invalid`
- `invite_rate_limited`
- `invite_delivery_failed`
- `invite_context_missing`
- `workspace_forbidden`
- `invite_not_found`

前端按 `code` 决定状态，直接显示服务端 `error`，不猜测备用字段。

## 9. 邮件和令牌

### 9.1 邮件链接

邮件链接格式：

```text
${APP_URL}/invitations/accept#token=<raw-token>
```

令牌放在 URL fragment 中，不进入服务器访问日志。接受页读取 fragment 后立即调用 `resolve`，用原始令牌交换短期 HttpOnly 邀请上下文 Cookie，然后从地址栏和内存中清除原始令牌。登录、注册、邮箱验证、GitHub OAuth 跳转和页面刷新都依赖该 Cookie 恢复确认上下文，不把原始令牌写入 localStorage、sessionStorage、IndexedDB 或日志。

### 9.2 邮件内容

邮件沿用现有灰白简约 HTML 和纯文本双版本，包含：

- Nexus 品牌。
- 工作区名称。
- 邀请人显示名称。
- editor/viewer 角色。
- 24 小时有效期。
- 接受链接。

邮件主题、日志和审计不包含原始令牌。

### 9.3 邮件失败

邀请事务先提交，再调用 Mailer：

- 成功：`delivery_status = sent`，写 `last_sent_at` 和 sent 审计。
- 失败：`delivery_status = failed`，写失败审计和稳定失败码。
- 不回滚邀请记录。
- 已注册收件人即使邮件失败，仍可从站内邀请中心接受。
- 未注册收件人需要 owner 重发成功后才能获得链接。

## 10. 限流

Redis 使用独立 action key：

- `workspace-invite:workspace`：同一工作区每小时最多 20 次发送尝试。
- `workspace-invite:email`：同一收件邮箱每小时最多 5 次发送尝试。
- 单邀请 60 秒重发冷却由数据库 `last_delivery_attempt_at` 强制执行。

限流计入初次发送和重发，也计入邮件失败。Redis 不可用时沿用现有生产环境 fail-closed 策略，返回 503。

## 11. 前端体验

### 11.1 全局邀请中心

- 桌面端在顶部工具栏显示邀请图标和 pending 数量徽标。
- 点击后打开约 420px 的右侧抽屉。
- 移动端使用全屏 Sheet，不出现横向滚动。
- 每项展示工作区、邀请人、角色和剩余时间。
- 操作是“接受并进入”和“拒绝”。
- 拒绝需要二次确认。
- 接受或拒绝 loading 时禁用同一项的所有操作。

### 11.2 Owner 邀请管理

现有工作区管理 Dialog 增加“成员 / 邀请”页签：

- 输入邮箱。
- 角色下拉框初始为空。
- 未选择角色时禁止发送。
- pending 行提供重发和撤销。
- failed 行显示明确失败状态和重试。
- declined、expired、revoked 和 accepted 行显示终态；declined 可重新创建邀请。
- pending 始终显示，终态只显示最近 30 天。

### 11.3 邮件接受页

新增 `/invitations/accept` 页面：

- 显示 Nexus、工作区、邀请人、角色、掩码邮箱和剩余时间。
- 未登录时先完成现有登录或注册流程，再回到同一确认上下文。
- 登录邮箱不一致时显示明确错误，不允许切换目标邮箱绕过验证。
- 接受成功后主动选择并加载目标工作区。
- 过期、撤销、已接受和已拒绝使用独立终态页面。

## 12. 并发与一致性

- 创建邀请依赖数据库部分唯一索引处理多实例并发。
- 接受、拒绝、撤销和重发都使用行锁与条件更新。
- 并发接受只能有一个请求成功创建成员。
- 重发事务提交后旧令牌立即失效，即使随后邮件发送失败也不恢复旧令牌。
- 接受事务不修改其他工作区内容，也不影响用户在其他工作区的文档偏好。
- 接受成功后的工作区选择是显式用户行为，允许更新 `selected_workspace_id`。

## 13. 测试策略

### 13.1 数据库和 Store

- 迁移幂等、字段约束和索引存在。
- 同一工作区和邮箱只能有一个 pending 邀请。
- 已有成员不能邀请。
- 角色必选且只能为 editor/viewer。
- 重发轮换令牌并重置 24 小时。
- 旧令牌在重发后失效。
- 接受、拒绝、撤销和过期状态不可重复转换。
- 并发接受只成功一次。
- 接受事务同时创建成员和审计。
- 接受前没有 REST、文件或 WebSocket 权限。

### 13.2 API 和安全

- owner/editor/viewer 权限边界。
- 登录邮箱不一致时拒绝。
- 无效令牌统一响应，不泄露邀请存在性。
- 数据库、API、日志和审计不包含原始令牌。
- 60 秒、工作区小时和邮箱小时限流。
- 邮件失败保留邀请并允许重试。
- 稳定错误码和中文信息一一对应。

### 13.3 前端

- 顶部徽标、抽屉、空状态和移动端 Sheet。
- 接受、拒绝、过期、撤销、已接受和邮件失败状态。
- 工作区管理邀请页签和 30 天历史。
- 未选择角色时禁止发送。
- loading 防止重复提交。
- 最长邮箱和工作区名称不溢出容器。

### 13.4 E2E

- 邀请未注册邮箱，完成注册后接受并进入目标工作区。
- 已注册用户从站内邀请中心接受。
- 收件人拒绝后 owner 看到 declined。
- 重发后旧邮件链接失效，新链接可接受。
- 撤销和过期邀请无法接受。
- 接受前 REST、文件和 WebSocket 被拒绝，接受后立即生效。

## 14. 交付顺序

1. 数据库迁移、邀请 Store、审计 Store和状态机测试。
2. Owner 创建、列表、重发和撤销 API。
3. 收件人列表、令牌解析、接受和拒绝 API。
4. Mailer、24 小时链接、发送状态和限流。
5. 全局邀请中心、工作区邀请页签和接受页。
6. 完整单元、组件、真实 PostgreSQL、Compose 和 Playwright 验收。
7. 更新 README 和 PRD，只把 M6.2A 标记为完成。

M6.2A 完成后再单独设计 M6.2B，不在本计划中提前实现成员移除、退出或所有权转让。
