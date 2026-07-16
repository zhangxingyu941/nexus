# M6.2 工作区团队生命周期设计

日期：2026-07-16

状态：设计内容已逐节确认，待书面复核和实施计划

## 1. 背景

M6 第一批已经完成多工作区目录、显式 `workspaceId` 作用域、工作区切换、owner 重命名、IndexedDB v2 迁移，以及成员、历史、文件和 Yjs 房间隔离。

当前仍缺少真实团队协作所需的完整生命周期：尚未注册的邮箱不能加入工作区，成员角色不能安全调整，成员不能退出，owner 不能转让所有权，工作区也不能删除和恢复。

M6.2 在一个总体规格和一个顺序实施计划中交付三个模块：

1. M6.2A：工作区邀请闭环。
2. M6.2B：成员角色、移除、退出和所有权转让。
3. M6.2C：工作区删除、7 天回收站、恢复和永久清理。

三个模块按 A、B、C 顺序开发，但共享审计、错误响应、权限失效和测试基础。本阶段直接在正常项目模块中开发，不创建 Git worktree。

## 2. 目标

- owner 可以邀请已注册或尚未注册的邮箱，以 editor 或 viewer 身份加入工作区。
- 收件人可以通过邮件链接或站内邀请中心接受或拒绝邀请。
- 接受邀请前不产生工作区访问权限，接受成功后立即加入并进入目标工作区。
- 多名 owner 权限完全相等，并可在最后一名 owner 保护下调整其他 owner。
- 成员角色修改、移除、退出和所有权转让均有稳定事务、审计和即时权限失效。
- 任一 owner 可以把工作区移入 7 天回收站，删除时立即阻断所有常规访问。
- 删除时的任一 owner 可以在恢复期内恢复工作区，恢复后立即进入。
- 到期工作区由请求触发的有界清理永久删除，对象存储失败时可安全重试。
- 永久删除后仍保留独立工作区审计。
- 完成后更新 README，准确说明 M6.2A、M6.2B 和 M6.2C 的能力、配置与验证方式。

## 3. 非目标

本阶段不实现：

- 账号设置、密码修改、会话管理和账号删除。
- M7 真实文档分享链接、文档级 ACL 和外部访客权限。
- 通用站内通知中心；本阶段只提供工作区邀请入口。
- 定时任务、独立 worker 或 cron 清理器。
- 删除后重新激活旧邀请。
- owner 之外的自定义角色或细粒度权限编辑器。
- 永久删除后的人工恢复或备份恢复界面。

## 4. 总体架构

M6.2 分为六个清晰边界：

1. `PostgresWorkspaceInviteStore` 管理邀请状态、令牌摘要、接受事务和邀请审计。
2. `PostgresWorkspaceMemberStore` 管理成员角色、移除、退出、所有权转让和最后 owner 保护。
3. `PostgresWorkspaceLifecycleStore` 管理删除摘要、软删除、回收站、恢复和永久清理候选项。
4. `WorkspaceInviteMailer` 只负责构造邀请邮件和发送，不拥有邀请状态。
5. `WorkspaceAccessNotifier` 在数据库事务提交时发送 PostgreSQL `NOTIFY` 权限失效事件。
6. `WorkspacePurgeService` 使用对象存储和数据库完成幂等永久清理。

路由层只负责认证、精确输入解析、调用 Store 或 Service，以及把领域错误映射为稳定 API 错误。数据库约束和事务是并发正确性的最终保障，前端禁用按钮不作为权限或一致性保障。

### 4.1 权限来源

- `workspace_members.role` 是 owner、editor、viewer 的唯一权限来源。
- owner 可以管理邀请、成员、角色和工作区生命周期。
- editor 可以读写工作区内容，但不能管理成员和工作区。
- viewer 只能读取允许的内容，不能加入可写 WebSocket 通道。
- 邀请状态不会授予权限，只有接受事务成功写入 `workspace_members` 后权限才生效。
- 软删除工作区不删除成员关系，但所有常规访问查询必须要求 `editor_workspaces.deleted_at IS NULL`。

### 4.2 目录与当前选择

- 正常工作区目录只返回 `deleted_at IS NULL` 的工作区。
- 当前偏好指向不可访问或已删除工作区时，目录加载选择最早创建的可访问工作区。
- 用户没有任何活动工作区时，复用 `ensurePersonalWorkspace` 创建个人工作区并设为当前选择。
- 接受邀请和恢复工作区是显式用户操作，成功后主动把目标工作区设为当前选择。
- 被移除、退出或工作区被删除后，客户端刷新目录并进入回退工作区。

## 5. 共享审计

新增独立审计表：

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

`workspace_id` 刻意不设置外键，使工作区永久删除后审计仍然存在。`workspace_name` 保存事件发生时的名称快照。

审计事件包括：

- `workspace_invite_created`
- `workspace_invite_sent`
- `workspace_invite_delivery_failed`
- `workspace_invite_resent`
- `workspace_invite_revoked`
- `workspace_invite_accepted`
- `workspace_invite_declined`
- `workspace_invite_expired`
- `workspace_member_role_changed`
- `workspace_member_removed`
- `workspace_member_left`
- `workspace_ownership_transferred`
- `workspace_deleted`
- `workspace_restored`
- `workspace_purged`

`metadata` 只保存角色、状态、稳定失败码和必要布尔值。不保存原始邀请令牌、邮件正文、Cookie、密码、会话令牌或邮件供应商完整响应。

## 6. M6.2A 邀请规则

- 邀请使用独立 `workspace_invites` 表，pending 邀请不写入 `workspace_members`。
- 邮件邀请和站内邀请中心同时交付。
- 收到的邀请使用全局入口；owner 发出的邀请在当前工作区管理器中处理。
- 邀请有效期为 24 小时。
- 同一工作区和规范化邮箱只能存在一个有效 pending 邀请。
- 重发生成新令牌、立即废弃旧令牌，并重新计算 24 小时有效期。
- 已经是工作区成员的邮箱不能再次邀请。
- 创建邀请时角色没有默认值，owner 必须明确选择 editor 或 viewer。
- 邀请不能直接授予 owner。
- 接受后加入并切换到目标工作区。
- 收件人可以拒绝邀请；拒绝后状态为 declined，不能重发，只能重新创建邀请。
- owner 始终看到全部 pending 邀请和最近 30 天的终态记录。
- 单邀请重发冷却 60 秒。
- 同一工作区每小时最多 20 次发送尝试。
- 同一收件邮箱每小时最多 5 次发送尝试。

## 7. M6.2A 数据模型

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

- `email` 进入 Store 前统一执行 trim 和 lowercase。
- `token_hash` 使用 `AUTH_HASH_SECRET` 和 `workspace-invite` 域隔离计算 HMAC。
- 原始令牌只在创建或重发调用栈中短暂存在，并只传给 Mailer。
- `last_delivery_attempt_at` 约束成功和失败后的 60 秒重发冷却。
- `last_sent_at` 只在邮件发送成功后更新。
- 接受、拒绝和撤销时间只在对应终态写入。
- 接受和拒绝同时记录对应用户 ID。

## 8. M6.2A 状态机与事务

合法邀请转换：

- `pending -> accepted`
- `pending -> declined`
- `pending -> revoked`
- `pending -> expired`
- `pending -> pending`，仅用于重发，必须轮换令牌并重置过期时间。

终态不能再次转换。重复接受、拒绝、撤销或重发返回对应稳定错误。

### 8.1 过期处理

不引入定时任务。Store 在 owner 列表、创建、重发、撤销、收件人列表、令牌解析、接受和拒绝前，把 `expires_at <= now` 的 pending 邀请条件更新为 expired，并只写一次过期审计。

### 8.2 接受事务

接受必须在一个 PostgreSQL 事务内完成：

1. `SELECT ... FOR UPDATE` 锁定邀请。
2. 处理过期并验证状态仍为 pending。
3. 验证当前登录邮箱与邀请邮箱完全一致。
4. 验证目标工作区仍为活动状态。
5. 再次确认目标用户尚未成为成员。
6. 插入 `workspace_members`，角色来自邀请。
7. 把邀请更新为 accepted，记录 `accepted_by` 和 `accepted_at`。
8. 写入 `workspace_invite_accepted` 审计。
9. 提交事务。
10. 显式选择并加载目标工作区。

成员插入、邀请状态或审计任一步失败都回滚整个事务。

### 8.3 邮件失败

邀请事务先提交，再调用 Mailer：

- 成功时把 `delivery_status` 更新为 sent，写 `last_sent_at` 和发送审计。
- 失败时把 `delivery_status` 更新为 failed，写稳定失败码和失败审计。
- 邮件失败不删除或回滚邀请。
- 已注册收件人即使邮件失败，仍可从站内邀请中心接受。
- 未注册收件人需要 owner 重发成功后才能获得有效链接。

## 9. M6.2A API

### 9.1 Owner API

#### `GET /api/workspaces/:workspaceId/invites`

返回全部 pending 邀请和最近 30 天的 accepted、declined、revoked、expired 记录。

每项精确字段：

```ts
interface WorkspaceInviteSummary {
  id: string;
  workspaceId: string;
  email: string;
  role: "editor" | "viewer";
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  deliveryStatus: "pending" | "sent" | "failed";
  invitedBy: { id: string; displayName: string };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastSentAt: number | null;
}
```

#### `POST /api/workspaces/:workspaceId/invites`

请求：

```json
{ "email": "member@example.com", "role": "editor" }
```

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

#### `POST /api/workspaces/:workspaceId/invites/:inviteId/resend`

- 只允许 pending 邀请。
- 60 秒内返回 429。
- 轮换令牌 HMAC，旧链接立即失效。
- 重置 `expiresAt = now + 24h`。
- 邮件失败时邀请保持 pending 和 failed delivery 状态。
- 返回 `200` 和与创建接口相同结构的 `{ invite, deliveryWarning }`；邮件失败仍是成功的状态变更响应，不返回顶层 5xx。

#### `DELETE /api/workspaces/:workspaceId/invites/:inviteId`

- 只允许 pending 邀请。
- 更新为 revoked，不物理删除。
- 终态邀请不能再次撤销。

### 9.2 收件人站内 API

#### `GET /api/workspace-invites`

- 必须登录。
- 只返回 `email = session.user.email` 的有效 pending 邀请。
- 返回工作区、邀请人、角色、掩码邮箱和过期时间。
- 不返回原始令牌或 token hash。

#### `POST /api/workspace-invites/:inviteId/accept`

- 通过邀请 ID 锁定记录并验证登录邮箱。
- 成功后返回 `{ catalog, workspace }`。

#### `POST /api/workspace-invites/:inviteId/decline`

- 通过邀请 ID 锁定记录并验证登录邮箱。
- 更新为 declined 并记录审计。

### 9.3 邮件令牌 API

#### `POST /api/workspace-invites/resolve`

请求：

```json
{ "token": "raw-token" }
```

无效令牌统一返回 404，不区分不存在、已轮换或格式错误。验证成功后写入短期、签名、HttpOnly 的邀请上下文 Cookie：

- 名称：`nexus_workspace_invite_context`。
- `Secure` 遵循现有认证 Cookie 配置。
- `SameSite=Lax`。
- Path 为 `/api/workspace-invites`。
- 最长 30 分钟，且不能超过邀请自身过期时间。
- Cookie 只包含邀请 ID、当前 token hash 摘要和最晚有效时间，不包含原始令牌。

#### `POST /api/workspace-invites/accept`

读取邀请上下文 Cookie，重新验证邀请状态、token hash 摘要和登录邮箱后执行接受事务。成功或终态失败后清除 Cookie。

#### `POST /api/workspace-invites/decline`

读取邀请上下文 Cookie，重新验证后执行拒绝事务。成功或终态失败后清除 Cookie。

## 10. M6.2A 邮件、令牌与限流

邮件链接格式：

```text
${APP_URL}/invitations/accept#token=<raw-token>
```

页面读取 fragment 后立即调用 `resolve`，用原始令牌交换邀请上下文 Cookie，然后从地址栏和内存清除原始令牌。登录、注册、邮箱验证、GitHub OAuth 跳转和页面刷新依赖 Cookie 恢复上下文。

原始令牌不得写入 localStorage、sessionStorage、IndexedDB、日志、审计或 API 响应。

Redis 限流键：

- `workspace-invite:workspace`：同一工作区每小时最多 20 次发送尝试。
- `workspace-invite:email`：同一收件邮箱每小时最多 5 次发送尝试。
- 单邀请 60 秒冷却由数据库 `last_delivery_attempt_at` 强制执行。

初次发送、重发和发送失败都计入限流。生产环境 Redis 不可用时 fail closed，返回 503。

邮件沿用 Nexus 当前灰白简约 HTML 和纯文本双版本，包含品牌、工作区名称、邀请人、角色、24 小时有效期和接受链接。

## 11. M6.2A 前端体验

### 11.1 全局邀请中心

- 桌面端在顶部工具栏显示邀请图标和 pending 数量徽标。
- 点击后打开约 420px 的右侧抽屉。
- 移动端使用全屏 Sheet，不出现横向滚动。
- 每项展示工作区、邀请人、角色和剩余时间。
- 操作为“接受并进入”和“拒绝”。
- 拒绝需要二次确认。
- 接受或拒绝 loading 时只禁用当前项操作。

### 11.2 Owner 邀请管理

工作区管理详情增加“成员 / 邀请 / 危险区域”页签。邀请页包含邮箱输入、无默认值的角色选择、发送按钮、pending 状态、邮件失败、重发、撤销和最近 30 天终态历史。

### 11.3 邮件接受页

新增 `/invitations/accept` 页面，显示 Nexus、工作区、邀请人、角色、掩码邮箱和剩余时间。未登录时完成现有登录或注册后回到同一上下文。邮箱不一致、过期、撤销、已接受和已拒绝使用独立终态。

## 12. M6.2B 成员规则

- 工作区允许多名 owner。
- 所有 owner 权限完全相等，不存在主 owner 或超级 owner。
- 任一 owner 可以提升、降级或移除另一名 owner，但操作后必须至少保留一名 owner。
- owner 角色变更、owner 移除、退出和所有权转让使用二次确认。
- 普通成员可以主动退出工作区。
- 最后一名 owner 不能退出、被移除或被降级，必须先转让所有权或删除工作区。
- 所有权转让把目标成员提升为 owner。
- “原 owner 保留 owner 角色”默认开启；关闭后原 owner 变为 editor。
- 移除和退出硬删除成员关系及该用户在该工作区的文档偏好。
- 移除或退出不删除账号，也不使账号会话失效。
- 角色变更、移除和退出必须立即影响 REST、文件和 WebSocket 权限。

## 13. M6.2B 数据与 API

M6.2B 不新增成员表。`workspace_members` 是当前关系，`created_at` 作为 `joinedAt`。独立审计保存被删除关系的历史。

### 13.1 成员摘要

```ts
interface WorkspaceMemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "editor" | "viewer";
  joinedAt: number;
}
```

### 13.2 `GET /api/workspaces/:workspaceId/members`

返回：

```ts
{ members: WorkspaceMemberSummary[] }
```

owner、editor 和 viewer 可以读取当前工作区成员列表。成员管理按钮仍只对 owner 显示。

### 13.3 停用直接添加成员

现有 `POST /api/workspaces/:workspaceId/members` 不再直接创建或更新成员。新增成员只能由 M6.2A 邀请接受事务完成，角色修改使用 PATCH。

### 13.4 `PATCH /api/workspaces/:workspaceId/members/:memberId`

请求：

```json
{ "role": "editor" }
```

- 只允许 owner。
- 角色必须是 owner、editor 或 viewer。
- owner 降级必须经过最后 owner 保护。
- 返回更新后的 `{ members }`。

### 13.5 `DELETE /api/workspaces/:workspaceId/members/:memberId`

- 只允许 owner 移除其他成员。
- 当前用户不能通过该接口删除自己，必须使用 leave 接口。
- 移除 owner 必须经过最后 owner 保护。
- 返回更新后的 `{ members }`。

### 13.6 `POST /api/workspaces/:workspaceId/leave`

- 当前成员主动退出。
- 最后一名 owner 返回冲突错误。
- 成功后返回回退后的 `{ catalog, workspace }`。

### 13.7 `POST /api/workspaces/:workspaceId/ownership-transfer`

请求：

```json
{
  "targetUserId": "user-2",
  "retainOwnerRole": true
}
```

- 操作者必须是 owner。
- 目标必须是当前工作区的非 owner 成员。
- 目标在同一事务中提升为 owner。
- `retainOwnerRole=false` 时操作者在同一事务中降为 editor。
- 返回更新后的 `{ members }`。

## 14. M6.2B 事务与并发

所有 owner 敏感操作在事务开始后锁定 `editor_workspaces` 对应记录，再重新读取操作者、目标成员和 owner 数量。这个工作区级串行点保证两个并发请求不能同时删除或降级最后两名 owner。

### 14.1 角色修改事务

1. 锁定工作区。
2. 验证工作区活动、操作者仍是 owner、目标仍是成员。
3. 如果目标当前是 owner 且新角色不是 owner，确认 owner 数量大于 1。
4. 更新角色。
5. 写 `workspace_member_role_changed` 审计。
6. 在同一事务内发送权限失效通知。
7. 提交并返回最新成员列表。

### 14.2 移除与退出事务

1. 锁定工作区。
2. 验证操作者和目标关系。
3. 对 owner 执行最后 owner 保护。
4. 删除目标的 `workspace_document_preferences`。
5. 硬删除目标 `workspace_members`。
6. 如果目标的 `selected_workspace_id` 指向当前工作区，改为最早创建的其他活动工作区。
7. 如果目标没有其他活动工作区，在同一事务内调用个人工作区创建逻辑并设为当前选择。
8. 写移除或退出审计。
9. 在同一事务内发送权限失效通知。
10. 提交；退出接口直接返回已经解析好的 `{ catalog, workspace }`。

### 14.3 所有权转让事务

1. 锁定工作区。
2. 验证操作者仍是 owner，目标仍是非 owner 成员。
3. 把目标提升为 owner。
4. 根据 `retainOwnerRole` 保留操作者 owner 或把操作者降为 editor。
5. 写 `workspace_ownership_transferred` 审计，记录是否保留原角色。
6. 在同一事务内发送双方权限失效通知。
7. 提交并返回最新成员列表。

## 15. 即时权限失效

REST 和文件接口在每个请求中读取数据库成员关系，并要求工作区未删除，因此事务提交后下一次请求立即按新权限处理。

现有 WebSocket 在升级时完成鉴权，必须增加连接注册表和 PostgreSQL 通知监听：

- WebSocket 连接注册 `{ workspaceId, documentId, userId, socket }`。
- 成员角色变更、移除、退出和所有权转让在同一数据库事务中调用 `pg_notify('workspace_access_invalidated', payload)`。
- 工作区删除发送 workspace 级通知，关闭该工作区的全部连接。
- 成员操作发送 workspace 和 user 级通知，关闭该成员在目标工作区的全部连接。
- PostgreSQL `NOTIFY` 只在事务提交后投递，事务回滚不会产生失效事件。
- 被关闭的 editor 或 owner 可以按新角色重新连接；viewer、被移除成员和已删除工作区无法重新进入可写通道。

Redis 继续用于 Yjs 多实例更新传播和邀请限流，但权限失效不依赖非事务性的 Redis publish。

## 16. M6.2B 前端体验

- 工作区列表中的 owner 行显示管理入口。
- 管理详情使用“成员 / 邀请 / 危险区域”页签。
- 成员行展示显示名、邮箱、角色选择和操作菜单。
- 当前用户有清晰“你”标记。
- 普通成员只看到自己的“退出工作区”操作。
- owner 可以修改角色、移除成员和发起所有权转让。
- owner 敏感操作使用二次确认，文案明确说明即时权限影响。
- 所有权转让确认中“我仍保留所有者角色”默认开启。
- 最后一名 owner 的降级、移除和退出入口禁用，并明确说明原因。
- 移动端成员表改为纵向行，角色和操作位于成员信息下方，不横向溢出。
- 异步提交期间只锁定当前操作，不冻结整个管理器。

## 17. M6.2C 删除规则与数据模型

- 任一 owner 可以删除工作区。
- 删除确认要求输入与数据库中完全相等的工作区名称。
- 删除对话框显示文档数、成员数和文件数。
- 删除进入 7 天回收站，不立即物理删除。
- 删除时的任一 owner 都可以在有效期内恢复。
- 恢复后立即选择并进入该工作区。
- 删除时全部 pending 邀请更新为 revoked，恢复后不重新激活。
- 删除后正常目录、REST、文件和 WebSocket 访问立即失效。
- 7 天内保留文档、成员、历史、Yjs 数据和对象文件。
- 永久清理由请求触发，不引入 worker 或 cron。

`editor_workspaces` 新增：

```sql
ALTER TABLE editor_workspaces
  ADD COLUMN deleted_at BIGINT,
  ADD COLUMN deleted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN purge_after BIGINT,
  ADD CONSTRAINT editor_workspaces_deletion_fields_check CHECK (
    (
      deleted_at IS NULL
      AND deleted_by IS NULL
      AND purge_after IS NULL
    )
    OR
    (
      deleted_at IS NOT NULL
      AND purge_after = deleted_at + 604800000
    )
  );

CREATE INDEX editor_workspaces_purge_idx
  ON editor_workspaces(purge_after, id)
  WHERE deleted_at IS NOT NULL;
```

活动工作区的三个字段全部为空。软删除工作区必须具有 `deleted_at` 和精确等于七天后的 `purge_after`；`deleted_by` 初始写入操作者，但允许在对应账号以后删除时由外键置空。

## 18. M6.2C API

### 18.1 `GET /api/workspaces/:workspaceId/deletion-summary`

只允许 owner，返回：

```ts
interface WorkspaceDeletionSummary {
  id: string;
  name: string;
  documentCount: number;
  memberCount: number;
  fileCount: number;
}
```

`fileCount` 统计数据库中 image 和 file 类型的附件块。永久清理仍删除整个 `${workspaceId}/` 对象前缀，包括未被块引用的孤立对象。

### 18.2 `DELETE /api/workspaces/:workspaceId`

请求：

```json
{ "confirmationName": "产品研发中心" }
```

`confirmationName` 不 trim，必须与锁定后重新读取的工作区名称完全相等。

成功返回：

```ts
{
  catalog: WorkspaceCatalog;
  workspace: WorkspaceSnapshot;
  deletedWorkspace: {
    id: string;
    name: string;
    deletedAt: number;
    purgeAfter: number;
  };
}
```

### 18.3 `GET /api/workspaces/trash`

只返回当前用户在保留成员关系中仍为 owner、尚未到达 `purgeAfter` 的软删除工作区。

```ts
interface DeletedWorkspaceSummary {
  id: string;
  name: string;
  deletedAt: number;
  deletedBy: { id: string; displayName: string } | null;
  purgeAfter: number;
}
```

### 18.4 `POST /api/workspaces/:workspaceId/restore`

- 当前用户必须在保留成员关系中仍是 owner。
- 当前时间必须严格早于 `purgeAfter`。
- 成功清除软删除字段并返回 `{ catalog, workspace }`。

## 19. M6.2C 状态与事务

工作区状态：

- `active -> deleted`：owner 完成精确名称确认。
- `deleted -> active`：删除时的 owner 在 `purgeAfter` 前恢复。
- `deleted -> purged`：到期后请求触发永久清理。

`purged` 不可恢复。到达 `purgeAfter` 后即使物理数据尚未清理，也不再允许恢复或出现在回收站列表中。

### 19.1 删除事务

1. 锁定工作区并验证仍为活动状态。
2. 验证操作者仍是 owner。
3. 重新读取工作区名称并精确比较 `confirmationName`。
4. 写入 `deleted_at`、`deleted_by` 和 `purge_after`。
5. 把全部 pending 邀请更新为 revoked，并为每个实际转换写邀请撤销审计。
6. 写 `workspace_deleted` 审计。
7. 在同一事务内发送 workspace 级权限失效通知。
8. 提交事务。
9. 为操作者解析回退目录并返回新的活动工作区。

删除事务不删除成员、文档、历史、Yjs 数据或对象文件。

### 19.2 恢复事务

1. 锁定软删除工作区。
2. 验证当前时间严格早于 `purge_after`。
3. 验证当前用户在保留成员关系中仍是 owner。
4. 清空 `deleted_at`、`deleted_by` 和 `purge_after`。
5. 写 `workspace_restored` 审计。
6. 把恢复者的 `selected_workspace_id` 更新为目标工作区。
7. 提交并加载完整工作区。

恢复保留内容、成员、历史、Yjs 数据和文件，但不会改变已经 revoked 的邀请。

## 20. 永久清理

工作区目录和回收站 GET 请求通过 Next.js `after()` 调度 `WorkspacePurgeService.purgeExpired(3)`。每次最多处理 3 个候选工作区，避免增加前台响应延迟。

清理流程：

1. 查询少量 `deleted_at IS NOT NULL AND purge_after <= now` 的候选 ID。
2. 为每个候选使用 PostgreSQL advisory lock，防止多实例并发清理同一工作区。
3. 获取锁后重新确认 tombstone 仍存在且已到期。
4. 调用对象存储 `deletePrefix(`${workspaceId}/`)`，该操作必须幂等。
5. 对象删除成功后，在数据库事务中写 `workspace_purged` 审计并删除工作区行。
6. 外键级联删除成员、邀请、文档、块、评论、版本、文档偏好和 Yjs 数据。
7. 释放 advisory lock。

`ObjectStorage` 增加 `deletePrefix(prefix)`：

- 本地存储删除工作区目录及元数据文件。
- S3 使用分页 ListObjectsV2 和分批 DeleteObjects。
- 空前缀或已不存在的前缀视为成功。
- 任一对象删除失败时不删除数据库工作区行，保留 tombstone，记录结构化运维日志，后续请求重试。

没有流量时允许物理清理延后，但逻辑恢复期限不会延后。

## 21. M6.2C 前端体验

- 工作区管理详情的“危险区域”提供删除入口。
- 删除确认显示工作区名称、文档数、成员数、文件数和 7 天恢复说明。
- 只有输入完整且完全匹配的名称后， destructive 按钮才可用。
- 删除成功后立即进入回退工作区。
- 工作区管理器提供全局“回收站”视图。
- 回收站只显示当前用户可恢复的工作区、删除时间、删除者和剩余时间。
- 恢复按钮文案为“恢复并进入”。
- 过期条目不显示恢复按钮，也不继续出现在回收站列表。
- 移动端使用纵向列表和全宽恢复按钮，不出现横向滚动。

## 22. 统一错误契约

所有 M6.2 新接口统一返回：

```ts
interface ApiError {
  code: string;
  error: string;
  retryAfterSeconds?: number;
}
```

稳定错误码和 HTTP 状态：

### 22.1 通用

- `400 malformed_json`
- `401 authentication_required`
- `403 workspace_forbidden`
- `404 workspace_not_found`
- `503 service_unavailable`

### 22.2 邀请

- `400 invite_role_required`
- `400 invite_role_invalid`
- `403 invite_email_mismatch`
- `404 invite_not_found`
- `409 already_member`
- `409 invite_pending`
- `409 invite_declined`
- `409 invite_already_accepted`
- `410 invite_expired`
- `410 invite_revoked`
- `429 invite_rate_limited`
- `invite_delivery_failed` 只作为创建或重发成功响应中的 `deliveryWarning.code`，不作为顶层错误响应。
- `401 invite_context_missing`

### 22.3 成员

- `400 member_role_invalid`
- `404 member_not_found`
- `409 last_owner_protected`
- `409 member_self_remove_forbidden`
- `409 ownership_target_invalid`
- `409 membership_conflict`

### 22.4 删除与恢复

- `400 workspace_name_confirmation_mismatch`
- `410 workspace_deleted`
- `410 workspace_purge_expired`

无关用户访问已删除工作区返回 `workspace_not_found`。只有保留成员关系的用户可以收到 `workspace_deleted`，避免泄露工作区存在性。

前端只按 `code` 决定交互状态，直接展示服务端 `error`，不猜测其他字段。

## 23. 一致性与安全边界

- 创建邀请依赖数据库部分唯一索引处理多实例并发。
- 接受、拒绝、撤销和重发使用行锁与条件更新。
- 成员敏感操作使用工作区行锁串行化最后 owner 检查。
- 删除和恢复使用工作区行锁，不能同时成功。
- 超过 `purgeAfter` 的恢复请求始终失败，即使物理清理尚未运行。
- PostgreSQL `NOTIFY` 与权限变更事务一起提交，回滚时不发送。
- REST、文件和 WebSocket 鉴权不信任前端缓存角色。
- 原始邀请令牌不进入持久化、日志、审计或 URL query。
- 工作区删除不删除账号会话。
- 审计表不依赖工作区外键，永久清理不删除审计。

## 24. 测试策略

### 24.1 迁移与 Store

- 迁移幂等、字段约束和索引存在。
- 同一工作区和邮箱只有一个 pending 邀请。
- 已有成员不能邀请，邀请角色必选且只允许 editor/viewer。
- 重发轮换令牌并重置 24 小时，旧令牌失效。
- 接受、拒绝、撤销和过期终态不能重复转换。
- 邀请接受事务同时创建成员和审计。
- 角色修改、移除、退出和转让写入正确审计。
- 移除和退出删除文档偏好，不删除账号或会话。
- 最后一名 owner 不能降级、移除或退出。
- 删除写入完整 tombstone、撤销 pending 邀请并保留内容。
- 恢复清除 tombstone、选择工作区且不恢复邀请。
- 永久清理先删除对象，再删除数据库行。
- 对象删除失败保留 tombstone 并可重试。

### 24.2 真实 PostgreSQL 并发

以下场景使用真实 PostgreSQL，而不只依赖 pg-mem：

- 并发邀请接受只能成功一次。
- 并发降级或移除不能产生零 owner。
- 所有权转让与其他角色修改串行一致。
- 删除与恢复竞争只有合法状态转换成功。
- `pg_notify` 只在事务提交后送达。
- advisory lock 防止重复永久清理。

### 24.3 API 与安全

- owner、editor、viewer 权限边界。
- 精确请求和响应字段。
- 稳定错误码与中文消息一一对应。
- 无效令牌统一响应，不泄露邀请存在性。
- 登录邮箱不一致时拒绝邀请。
- 60 秒、工作区小时和邮箱小时限流。
- 删除名称必须完全匹配。
- 无关用户不能识别已删除工作区。

### 24.4 前端组件

- 全局邀请徽标、抽屉、空状态和移动端 Sheet。
- 工作区成员、邀请和危险区域页签。
- 角色必选、loading、防重复提交和错误反馈。
- owner 敏感操作二次确认。
- 最后一名 owner 禁用状态。
- 所有权转让保留 owner 开关默认开启。
- 删除摘要、精确名称输入和 destructive 状态。
- 回收站倒计时、恢复、空状态和移动端纵向布局。
- 最长邮箱和工作区名称不会挤压或溢出操作区。

### 24.5 跨服务权限

- 接受邀请前 REST、文件和 WebSocket 均被拒绝，接受后立即生效。
- 角色降为 viewer 后现有可写 WebSocket 被关闭，重新连接被拒绝。
- 成员移除或退出后 REST、文件和现有 WebSocket 立即失效。
- 工作区删除后所有工作区 WebSocket 被关闭，文件和 REST 被拒绝。
- 恢复后重新连接和新请求恢复正常权限。

### 24.6 Compose E2E

- 邀请未注册邮箱，注册后接受并进入目标工作区。
- 已注册用户从站内邀请中心接受。
- 收件人拒绝后 owner 看到 declined。
- 重发后旧邮件链接失效，新链接可接受。
- owner 修改角色、移除成员和转让所有权。
- 普通成员退出并进入回退工作区。
- 最后一名 owner 操作被拒绝。
- 删除工作区后所有用户回退，回收站可恢复并进入。
- 过期工作区不可恢复。
- 对象删除失败后数据库 tombstone 保留，恢复对象服务后重试成功。

## 25. 验收命令

实施完成后至少运行：

```text
pnpm test
pnpm build
docker compose config
docker compose up -d
docker compose ps
pnpm test:e2e
```

另外运行真实 PostgreSQL/Redis 集成测试、数据库迁移测试、对象存储本地和 S3 兼容测试，以及协作服务权限失效测试。

## 26. 顺序交付

### 26.1 M6.2A

1. 邀请与审计迁移。
2. 邀请 Store、状态机、令牌和限流测试。
3. Owner 与收件人 API。
4. Mailer 和邮件接受页。
5. 全局邀请中心和邀请管理页签。
6. M6.2A 集成与 E2E 验收。

### 26.2 M6.2B

1. 成员 Store 拆分和现有直接添加接口停用。
2. 角色修改、移除、退出和所有权转让事务。
3. PostgreSQL 权限失效通知和 WebSocket 连接注册表。
4. 成员管理界面和敏感操作确认。
5. M6.2B 并发、跨服务和 E2E 验收。

### 26.3 M6.2C

1. tombstone 迁移和活动工作区过滤。
2. 删除摘要、删除、回收站和恢复 API。
3. 对象存储 `deletePrefix` 和有界永久清理。
4. 危险区域、删除确认和回收站界面。
5. M6.2C 恢复、清理失败和 E2E 验收。

### 26.4 完成文档

全部模块验收通过后更新 README 和项目进度说明，把 M6.2A、M6.2B、M6.2C 标记为完成，并明确账号设置与 M7 真实分享权限仍在后续批次。
