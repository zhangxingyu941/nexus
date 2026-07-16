# M6.2 Workspace Team Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M6.2A 邀请闭环、M6.2B 成员生命周期和 M6.2C 工作区删除恢复，并让 REST、文件和实时协作权限在角色或生命周期变化后立即一致。

**Architecture:** 保留现有 `PostgresWorkspaceStore` 负责目录与内容，把新增职责拆为 `PostgresWorkspaceInviteStore`、`PostgresWorkspaceMemberStore` 和 `PostgresWorkspaceLifecycleStore`。共享审计、领域错误、PostgreSQL 权限失效通知和客户端精确 API 类型；按 A、B、C 顺序完成，每一阶段都可独立测试。

**Tech Stack:** Next.js 15、React 18、TypeScript、PostgreSQL 16、Redis 7、Nodemailer、S3 兼容对象存储、Yjs/y-websocket、Vitest、Testing Library、Playwright、Docker Compose。

**Execution constraint:** 直接在当前正常工作区和当前分支执行，不创建 Git worktree；保留现有 stash，不应用或删除。

---

## 文件结构

### 新建共享与客户端模块

- `src/shared/workspaceApi.ts`：统一 API 错误和工作区切换响应。
- `src/shared/workspaceInvites.ts`：邀请精确字段与状态类型。
- `src/shared/workspaceMembers.ts`：成员摘要和角色请求。
- `src/shared/workspaceLifecycle.ts`：删除摘要与回收站类型。
- `src/features/editor/persistence/apiClient.ts`：精确 JSON 请求和 `ApiRequestError`。
- `src/features/editor/persistence/workspaceInviteRepository.ts`：邀请客户端。
- `src/features/editor/persistence/workspaceLifecycleRepository.ts`：删除、回收站和恢复客户端。

### 新建服务端模块

- `src/server/workspaceErrors.ts`：领域错误码与消息。
- `src/server/workspaceAuditStore.ts`：独立审计写入。
- `src/server/workspaceInviteTokens.ts`：原始令牌 HMAC 与上下文 JWT。
- `src/server/workspaceInviteRateLimiter.ts`：工作区和邮箱 Redis 限流。
- `src/server/workspaceInviteMailer.ts`：邀请邮件和测试邮件捕获。
- `src/server/postgresWorkspaceInviteStore.ts`：邀请状态机与接受事务。
- `src/server/postgresWorkspaceMemberStore.ts`：角色、移除、退出和转让事务。
- `src/server/workspaceAccessNotifications.ts`：事务内 `pg_notify` 与协作监听。
- `src/server/postgresWorkspaceLifecycleStore.ts`：删除摘要、软删除和恢复。
- `src/server/workspacePurgeService.ts`：对象优先的有界永久清理。
- `src/app/api/workspaceErrorResponse.ts`：领域错误到 HTTP 的统一映射。

### 新建路由与界面

- `src/app/api/workspaces/[workspaceId]/invites` 及子路由：owner 邀请 API。
- `src/app/api/workspace-invites` 及子路由：收件人、令牌解析、接受和拒绝 API。
- `src/app/invitations/accept/page.tsx`：邮件邀请入口。
- `src/features/editor/components/invitations/InvitationAcceptScreen.tsx`：邀请确认状态机。
- `src/features/editor/components/invitations/WorkspaceInvitationCenter.tsx`：全局邀请抽屉。
- `src/features/editor/components/sidebar/workspace-manager`：成员、邀请、危险区域和回收站子视图。
- `src/app/api/workspaces/[workspaceId]/members/[memberId]/route.ts`：角色修改和移除。
- `src/app/api/workspaces/[workspaceId]/leave/route.ts`：退出。
- `src/app/api/workspaces/[workspaceId]/ownership-transfer/route.ts`：所有权转让。
- `src/app/api/workspaces/[workspaceId]/deletion-summary/route.ts`：删除统计。
- `src/app/api/workspaces/[workspaceId]/restore/route.ts`：恢复。
- `src/app/api/workspaces/trash/route.ts`：回收站。

### 重点修改

- `src/server/database/migrations.ts`、`migrations.test.ts`：邀请、审计和 tombstone 迁移。
- `src/server/applicationServices.ts`：组装三个新 Store、Mailer、Limiter 和 PurgeService。
- `src/server/postgresWorkspaceStore.ts`、`postgresWorkspaceStore.test.ts`：活动工作区过滤和默认空间回退。
- `src/server/objectStorage.ts`、`objectStorage.test.ts`：`deletePrefix`。
- `src/server/collaborationServer.ts`、`collaborationServer.test.ts`：连接注册和权限失效。
- `scripts/collaboration-server.ts`：启动 PostgreSQL 权限监听。
- `src/app/api/workspaces/handlers.ts`、`route.ts`：统一错误、DELETE 和 `after` 清理调度。
- `src/app/api/workspaces/[workspaceId]/members/handlers.ts`：移除直接 POST，仅保留列表。
- `src/features/editor/persistence/workspaceMemberRepository.ts`：PATCH、DELETE、leave 和 transfer。
- `src/features/editor/session/useWorkspaceSession.ts`：接受、退出、删除和恢复的服务端切换结果。
- `src/features/editor/components/WorkspaceShell.tsx`：邀请中心和管理操作编排。
- `src/features/editor/components/document/DocumentTopbar.tsx`：邀请图标与数量徽标。
- `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`：列表、详情和回收站导航。
- `src/app/AuthScreen.tsx`、GitHub OAuth handlers：邀请页登录后返回。
- `e2e/support.ts` 和新增生命周期 E2E：完整 Compose 验收。
- `README.md`：M6.2 能力、配置、接口和下一批范围。

## Phase A：M6.2A 邀请闭环

### Task 1：共享 API 契约与客户端请求器

**Files:**
- Create: `src/shared/workspaceApi.ts`
- Create: `src/shared/workspaceInvites.ts`
- Create: `src/shared/workspaceMembers.ts`
- Create: `src/shared/workspaceLifecycle.ts`
- Create: `src/features/editor/persistence/apiClient.ts`
- Create: `src/features/editor/persistence/apiClient.test.ts`
- Modify: `src/features/editor/persistence/remoteWorkspaceRepository.ts`
- Modify: `src/features/editor/persistence/remoteWorkspaceRepository.test.ts`

- [ ] **Step 1: 写失败的 API 请求器测试**

~~~ts
import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./apiClient";

describe("apiClient", () => {
  it("preserves stable error fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "invite_rate_limited",
      error: "邀请发送过于频繁",
      retryAfterSeconds: 60,
    }), { status: 429 })));

    await expect(requestJson("/api/test", { method: "POST" })).rejects.toMatchObject({
      code: "invite_rate_limited",
      message: "邀请发送过于频繁",
      retryAfterSeconds: 60,
    });
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/persistence/apiClient.test.ts`

Expected: FAIL，`apiClient` 模块不存在。

- [ ] **Step 3: 定义精确共享类型**

~~~ts
// src/shared/workspaceApi.ts
import type { WorkspaceCatalog, WorkspaceSnapshot } from "./workspace";

export interface ApiErrorPayload {
  code: string;
  error: string;
  retryAfterSeconds?: number;
}

export interface WorkspaceTransitionResponse {
  catalog: WorkspaceCatalog;
  workspace: WorkspaceSnapshot;
}
~~~

~~~ts
// src/shared/workspaceInvites.ts
export type WorkspaceInviteRole = "editor" | "viewer";
export type WorkspaceInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

export interface WorkspaceInviteSummary {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceInviteRole;
  status: WorkspaceInviteStatus;
  deliveryStatus: "pending" | "sent" | "failed";
  invitedBy: { id: string; displayName: string };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastSentAt: number | null;
}

export interface ReceivedWorkspaceInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedBy: { id: string; displayName: string };
  role: WorkspaceInviteRole;
  maskedEmail: string;
  expiresAt: number;
}

export interface WorkspaceInviteMutationResponse {
  invite: WorkspaceInviteSummary;
  deliveryWarning: null | {
    code: "invite_delivery_failed";
    error: string;
  };
}
~~~

~~~ts
// src/shared/workspaceMembers.ts
import type { WorkspaceRole } from "./workspace";

export interface WorkspaceMemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  joinedAt: number;
}
~~~

~~~ts
// src/shared/workspaceLifecycle.ts
export interface WorkspaceDeletionSummary {
  id: string;
  name: string;
  documentCount: number;
  memberCount: number;
  fileCount: number;
}

export interface DeletedWorkspaceSummary {
  id: string;
  name: string;
  deletedAt: number;
  deletedBy: { id: string; displayName: string } | null;
  purgeAfter: number;
}
~~~

- [ ] **Step 4: 实现请求器并迁移远程工作区仓储**

~~~ts
// src/features/editor/persistence/apiClient.ts
import type { ApiErrorPayload } from "../../../shared/workspaceApi";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = isApiError(payload)
      ? payload
      : { code: "service_unavailable", error: "工作区服务请求失败" };
    throw new ApiRequestError(error.error, error.code, error.retryAfterSeconds);
  }
  return payload as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  };
}

function isApiError(value: unknown): value is ApiErrorPayload {
  return typeof value === "object"
    && value !== null
    && typeof (value as ApiErrorPayload).code === "string"
    && typeof (value as ApiErrorPayload).error === "string";
}
~~~

- [ ] **Step 5: 运行请求器和远程仓储测试**

Run: `pnpm test --run src/features/editor/persistence/apiClient.test.ts src/features/editor/persistence/remoteWorkspaceRepository.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

~~~bash
git add src/shared src/features/editor/persistence/apiClient.ts src/features/editor/persistence/apiClient.test.ts src/features/editor/persistence/remoteWorkspaceRepository.ts src/features/editor/persistence/remoteWorkspaceRepository.test.ts
git commit -m "refactor: add workspace api contracts"
~~~

### Task 2：领域错误、审计与邀请数据库迁移

**Files:**
- Create: `src/server/workspaceErrors.ts`
- Create: `src/server/workspaceAuditStore.ts`
- Create: `src/server/workspaceAuditStore.test.ts`
- Create: `src/app/api/workspaceErrorResponse.ts`
- Create: `src/app/api/workspaceErrorResponse.test.ts`
- Modify: `src/server/database/migrations.ts`
- Modify: `src/server/database/migrations.test.ts`

- [ ] **Step 1: 写失败的迁移和错误映射测试**

~~~ts
it("creates workspace invites and independent audit tables idempotently", async () => {
  await migrateDatabase(pool);
  await migrateDatabase(pool);
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables "
      + "WHERE table_name IN ('workspace_invites', 'workspace_audit_events') "
      + "ORDER BY table_name",
  );
  expect(tables.rows.map((row) => row.table_name)).toEqual([
    "workspace_audit_events",
    "workspace_invites",
  ]);
});
~~~

~~~ts
it("maps domain errors to code and status", async () => {
  const response = workspaceErrorResponse(
    new WorkspaceDomainError("invite_expired", "邀请已过期"),
  );
  expect(response?.status).toBe(410);
  await expect(response?.json()).resolves.toEqual({
    code: "invite_expired",
    error: "邀请已过期",
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/database/migrations.test.ts src/app/api/workspaceErrorResponse.test.ts`

Expected: FAIL，表和错误模块不存在。

- [ ] **Step 3: 增加迁移**

在 `migrations.ts` 增加迁移 ID `2026-07-16-workspace-invitations-audit`，执行设计规格中的 `workspace_invites`、`workspace_audit_events`、部分唯一索引和查询索引。迁移在同一 migration lock 事务内记录 `schema_migrations`。

~~~ts
const WORKSPACE_INVITATIONS_AUDIT_MIGRATION_ID =
  "2026-07-16-workspace-invitations-audit";

const WORKSPACE_INVITATIONS_AUDIT_SCHEMA = [
  "CREATE TABLE workspace_audit_events ("
    + "id TEXT PRIMARY KEY,"
    + "workspace_id TEXT NOT NULL,"
    + "workspace_name TEXT NOT NULL,"
    + "actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "event_type TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,"
    + "metadata JSONB NOT NULL,created_at BIGINT NOT NULL)",
  "CREATE TABLE workspace_invites ("
    + "id TEXT PRIMARY KEY,"
    + "workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,"
    + "email TEXT NOT NULL,"
    + "role TEXT NOT NULL CHECK (role IN ('editor','viewer')),"
    + "token_hash TEXT NOT NULL UNIQUE,"
    + "status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked','expired')),"
    + "delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending','sent','failed')),"
    + "invited_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,"
    + "accepted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "declined_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,"
    + "last_delivery_attempt_at BIGINT,last_sent_at BIGINT,accepted_at BIGINT,"
    + "declined_at BIGINT,revoked_at BIGINT)",
  "CREATE UNIQUE INDEX workspace_invites_pending_email_idx "
    + "ON workspace_invites(workspace_id,email) WHERE status='pending'",
  "CREATE INDEX workspace_invites_recipient_idx "
    + "ON workspace_invites(email,status,expires_at)",
  "CREATE INDEX workspace_invites_workspace_history_idx "
    + "ON workspace_invites(workspace_id,created_at DESC)",
  "CREATE INDEX workspace_audit_events_workspace_idx "
    + "ON workspace_audit_events(workspace_id,created_at DESC)",
];
~~~

- [ ] **Step 4: 实现领域错误与审计写入**

~~~ts
export type WorkspaceErrorCode =
  | "malformed_json"
  | "authentication_required"
  | "workspace_forbidden"
  | "workspace_not_found"
  | "service_unavailable"
  | "invite_role_required"
  | "invite_role_invalid"
  | "invite_email_mismatch"
  | "invite_not_found"
  | "already_member"
  | "invite_pending"
  | "invite_declined"
  | "invite_already_accepted"
  | "invite_expired"
  | "invite_revoked"
  | "invite_rate_limited"
  | "invite_context_missing"
  | "member_role_invalid"
  | "member_not_found"
  | "last_owner_protected"
  | "member_self_remove_forbidden"
  | "ownership_target_invalid"
  | "membership_conflict"
  | "workspace_name_confirmation_mismatch"
  | "workspace_deleted"
  | "workspace_purge_expired";

export class WorkspaceDomainError extends Error {
  constructor(readonly code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceDomainError";
  }
}
~~~

~~~ts
export class WorkspaceAuditStore {
  constructor(
    private readonly idFactory: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  write(client: Pick<PoolClient, "query">, input: {
    actorUserId: string | null;
    eventType: string;
    metadata: Record<string, unknown>;
    targetId: string;
    targetType: string;
    workspaceId: string;
    workspaceName: string;
  }) {
    return client.query(
      "INSERT INTO workspace_audit_events "
        + "(id,workspace_id,workspace_name,actor_user_id,event_type,target_type,target_id,metadata,created_at) "
        + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        this.idFactory(), input.workspaceId, input.workspaceName,
        input.actorUserId, input.eventType, input.targetType,
        input.targetId, input.metadata, this.now(),
      ],
    );
  }
}
~~~

- [ ] **Step 5: 实现 HTTP 映射**

`workspaceErrorResponse.ts` 使用固定 `Record` 映射状态，非 `WorkspaceDomainError` 返回 `null`：

~~~ts
const STATUS_BY_CODE: Record<WorkspaceErrorCode, number> = {
  malformed_json: 400,
  authentication_required: 401,
  workspace_forbidden: 403,
  workspace_not_found: 404,
  service_unavailable: 503,
  invite_role_required: 400,
  invite_role_invalid: 400,
  invite_email_mismatch: 403,
  invite_not_found: 404,
  already_member: 409,
  invite_pending: 409,
  invite_declined: 409,
  invite_already_accepted: 409,
  invite_expired: 410,
  invite_revoked: 410,
  invite_rate_limited: 429,
  invite_context_missing: 401,
  member_role_invalid: 400,
  member_not_found: 404,
  last_owner_protected: 409,
  member_self_remove_forbidden: 409,
  ownership_target_invalid: 409,
  membership_conflict: 409,
  workspace_name_confirmation_mismatch: 400,
  workspace_deleted: 410,
  workspace_purge_expired: 410,
};

export function workspaceErrorResponse(error: unknown, retryAfterSeconds?: number) {
  if (!(error instanceof WorkspaceDomainError)) return null;
  return NextResponse.json({
    code: error.code,
    error: error.message,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  }, { status: STATUS_BY_CODE[error.code] });
}
~~~

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm test --run src/server/database/migrations.test.ts src/server/workspaceAuditStore.test.ts src/app/api/workspaceErrorResponse.test.ts`

Expected: PASS。

~~~bash
git add src/server/database src/server/workspaceErrors.ts src/server/workspaceAuditStore.ts src/server/workspaceAuditStore.test.ts src/app/api/workspaceErrorResponse.ts src/app/api/workspaceErrorResponse.test.ts
git commit -m "feat: add workspace invitation schema and audit"
~~~

### Task 3：邀请令牌与短期上下文 Cookie

**Files:**
- Create: `src/server/workspaceInviteTokens.ts`
- Create: `src/server/workspaceInviteTokens.test.ts`
- Create: `src/app/api/workspace-invites/inviteContextCookie.ts`
- Create: `src/app/api/workspace-invites/inviteContextCookie.test.ts`

- [ ] **Step 1: 写失败的令牌测试**

~~~ts
it("hashes raw tokens and verifies a short invite context", async () => {
  const service = new WorkspaceInviteTokenService("test-secret", () => 1_000);
  const token = service.createRawToken();
  const hash = service.hashRawToken(token);
  expect(hash).toHaveLength(64);
  const context = await service.signContext({
    expiresAt: 2_000,
    inviteId: "invite-1",
    tokenHash: hash,
  });
  await expect(service.verifyContext(context)).resolves.toMatchObject({
    inviteId: "invite-1",
    tokenHash: hash,
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/workspaceInviteTokens.test.ts src/app/api/workspace-invites/inviteContextCookie.test.ts`

Expected: FAIL，令牌和 Cookie 模块不存在。

- [ ] **Step 3: 实现 HMAC 和 JWT**

~~~ts
export class WorkspaceInviteTokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  createRawToken() {
    return randomBytes(32).toString("base64url");
  }

  hashRawToken(token: string) {
    return createHmac("sha256", this.secret)
      .update("workspace-invite\0")
      .update(token)
      .digest("hex");
  }

  async signContext(input: {
    inviteId: string;
    tokenHash: string;
    expiresAt: number;
  }) {
    const expiresAt = Math.min(input.expiresAt, this.now() + 30 * 60_000);
    return new SignJWT({
      inviteId: input.inviteId,
      tokenHash: input.tokenHash,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience("nexus-workspace-invite")
      .setIssuer("nexus")
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.key);
  }
}
~~~

- [ ] **Step 4: 实现 Cookie 工具**

Cookie 名固定为 `nexus_workspace_invite_context`，Path 固定 `/api/workspace-invites`，SameSite=Lax，HttpOnly，Secure 复用 `AUTH_COOKIE_SECURE`。`set` 和 `clear` 都由该模块提供。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/server/workspaceInviteTokens.test.ts src/app/api/workspace-invites/inviteContextCookie.test.ts`

Expected: PASS。

~~~bash
git add src/server/workspaceInviteTokens.ts src/server/workspaceInviteTokens.test.ts src/app/api/workspace-invites
git commit -m "feat: add secure workspace invite tokens"
~~~

### Task 4：邀请创建、列表和惰性过期

**Files:**
- Create: `src/server/postgresWorkspaceInviteStore.ts`
- Create: `src/server/postgresWorkspaceInviteStore.test.ts`
- Modify: `src/server/applicationServices.ts`

- [ ] **Step 1: 写失败的 Store 测试**

~~~ts
it("creates one pending invite and expires it on the next read", async () => {
  const created = await store.createInvite({
    actorUserId: "owner-1",
    email: " MEMBER@example.com ",
    role: "editor",
    workspaceId: "workspace-1",
  });
  expect(created.invite.email).toBe("member@example.com");
  await expect(store.createInvite({
    actorUserId: "owner-1",
    email: "member@example.com",
    role: "viewer",
    workspaceId: "workspace-1",
  })).rejects.toMatchObject({ code: "invite_pending" });
  now = created.invite.expiresAt;
  expect((await store.listOwnerInvites("owner-1", "workspace-1"))[0].status)
    .toBe("expired");
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts`

Expected: FAIL，Store 不存在。

- [ ] **Step 3: 实现公开方法**

~~~ts
createInvite(input: {
  actorUserId: string;
  workspaceId: string;
  email: string;
  role: WorkspaceInviteRole;
}): Promise<{ invite: WorkspaceInviteSummary; rawToken: string }>;

listOwnerInvites(
  actorUserId: string,
  workspaceId: string,
): Promise<WorkspaceInviteSummary[]>;

listReceivedInvites(
  userId: string,
  email: string,
): Promise<ReceivedWorkspaceInvite[]>;
~~~

创建事务锁定活动工作区并验证 owner，规范化邮箱，拒绝已有成员和重复 pending。在所有相关操作前条件更新过期邀请并只写一次 expired 审计。owner 列表返回全部 pending 和最近 30 天终态。

- [ ] **Step 4: 组装服务并运行测试**

`applicationServices.ts` 返回 `workspaceInviteStore`。Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts src/server/postgresWorkspaceStore.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

~~~bash
git add src/server/postgresWorkspaceInviteStore.ts src/server/postgresWorkspaceInviteStore.test.ts src/server/applicationServices.ts
git commit -m "feat: create and list workspace invites"
~~~

### Task 5：邀请重发、撤销和终态

**Files:**
- Modify: `src/server/postgresWorkspaceInviteStore.ts`
- Modify: `src/server/postgresWorkspaceInviteStore.test.ts`

- [ ] **Step 1: 写失败的状态转换测试**

~~~ts
it("rotates the token on resend and rejects terminal transitions", async () => {
  const created = await createPendingInvite();
  now += 61_000;
  const resent = await store.resendInvite("owner-1", "workspace-1", created.invite.id);
  expect(resent.rawToken).not.toBe(created.rawToken);
  await expect(store.resolveRawToken(created.rawToken)).rejects.toMatchObject({
    code: "invite_not_found",
  });
  await store.revokeInvite("owner-1", "workspace-1", created.invite.id);
  await expect(
    store.resendInvite("owner-1", "workspace-1", created.invite.id),
  ).rejects.toMatchObject({ code: "invite_revoked" });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts`

Expected: FAIL，重发和撤销方法不存在。

- [ ] **Step 3: 实现行锁状态转换**

公开 `resendInvite`、`revokeInvite`、`resolveRawToken`、`markDeliveryResult`。每个状态改变使用 `SELECT FOR UPDATE`；重发检查 60 秒冷却，轮换 `token_hash` 并重置 24 小时；终态返回精确错误码。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceInviteStore.ts src/server/postgresWorkspaceInviteStore.test.ts
git commit -m "feat: resend and revoke workspace invites"
~~~

### Task 6：邀请接受、拒绝和真实 PostgreSQL 并发

**Files:**
- Modify: `src/server/postgresWorkspaceInviteStore.ts`
- Modify: `src/server/postgresWorkspaceInviteStore.test.ts`
- Create: `src/server/postgresWorkspaceInviteStore.postgres.test.ts`
- Create: `src/test/postgresIntegration.ts`
- Create: `vitest.postgres.config.ts`
- Modify: `package.json`

- [ ] **Step 1: 写失败的接受测试**

~~~ts
it("accepts once and creates the membership in the same transaction", async () => {
  const invite = await createPendingInvite();
  const result = await store.acceptInvite({
    inviteId: invite.invite.id,
    tokenHash: null,
    userEmail: "member@example.com",
    userId: "member-1",
  });
  expect(result.workspaceId).toBe("workspace-1");
  const membership = await pool.query(
    "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    ["workspace-1", "member-1"],
  );
  expect(membership.rows[0].role).toBe("editor");
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts`

Expected: FAIL，`acceptInvite` 和 `declineInvite` 不存在。

- [ ] **Step 3: 实现事务**

~~~ts
acceptInvite(input: {
  inviteId: string;
  tokenHash: string | null;
  userEmail: string;
  userId: string;
}): Promise<{ workspaceId: string }>;

declineInvite(input: {
  inviteId: string;
  tokenHash: string | null;
  userEmail: string;
  userId: string;
}): Promise<void>;
~~~

接受事务锁邀请、处理过期、验证邮箱和当前 token hash、验证活动工作区和非成员、插入 membership、更新 accepted、写审计。拒绝使用同样的身份和状态校验。

- [ ] **Step 4: 增加真实 PostgreSQL 测试工具**

~~~ts
export async function createPostgresIntegrationContext() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const pool = new Pool({
    connectionString,
    options: "-c search_path=" + schema,
  });
  await migrateDatabase(pool);
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
      await admin.end();
    },
  };
}
~~~

`vitest.postgres.config.ts` 只包含真实数据库测试，`package.json` 增加 `test:postgres`：

~~~ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/" + "**" + "/*.postgres.test.ts"],
    testTimeout: 30_000,
  },
});
~~~

~~~json
{
  "scripts": {
    "test:postgres": "vitest run --config vitest.postgres.config.ts"
  }
}
~~~

- [ ] **Step 5: 运行测试**

Run: `pnpm test --run src/server/postgresWorkspaceInviteStore.test.ts`

Run in Compose: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Expected: PASS；并发接受一个成功、一个稳定冲突，成员行只有一条。

- [ ] **Step 6: 提交**

~~~bash
git add src/server/postgresWorkspaceInviteStore.ts src/server/postgresWorkspaceInviteStore.test.ts src/server/postgresWorkspaceInviteStore.postgres.test.ts src/test/postgresIntegration.ts vitest.postgres.config.ts package.json pnpm-lock.yaml
git commit -m "feat: accept and decline workspace invites"
~~~

### Task 7：邀请限流与邮件发送

**Files:**
- Create: `src/server/workspaceInviteRateLimiter.ts`
- Create: `src/server/workspaceInviteRateLimiter.test.ts`
- Create: `src/server/workspaceInviteMailer.ts`
- Create: `src/server/workspaceInviteMailer.test.ts`
- Modify: `src/server/applicationServices.ts`

- [ ] **Step 1: 写失败的限流和邮件测试**

~~~ts
it("limits workspace and recipient attempts independently", async () => {
  const limiter = new InMemoryWorkspaceInviteRateLimiter(() => 1_000);
  for (let index = 0; index < 5; index += 1) {
    await expect(limiter.consume("workspace-1", "member@example.com"))
      .resolves.toMatchObject({ allowed: true });
  }
  await expect(limiter.consume("workspace-1", "member@example.com"))
    .resolves.toMatchObject({ allowed: false, scope: "email" });
});
~~~

~~~ts
it("sends a 24 hour invitation without logging the raw token", async () => {
  await mailer.send({
    email: "member@example.com",
    inviterDisplayName: "林夏",
    role: "editor",
    url: "https://nexus.example/invitations/accept#token=raw",
    workspaceName: "产品研发中心",
  });
  expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
    subject: "林夏邀请你加入产品研发中心",
    to: "member@example.com",
  }));
  expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("raw"));
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/workspaceInviteRateLimiter.test.ts src/server/workspaceInviteMailer.test.ts`

Expected: FAIL，Limiter 和 Mailer 不存在。

- [ ] **Step 3: 实现限流与 Mailer**

Redis Lua 固定窗口：工作区 20/hour，邮箱 5/hour；失败尝试同样计数。生产 Redis 不可用返回 `service_unavailable`，开发允许内存实现。Mailer 复用 `SMTP_*` 和 Nexus 邮件风格；显式 `AUTH_MAIL_CAPTURE_FILE` 时写 `{ purpose:"workspace-invite", subject, to, url, createdAt }`，不把 URL 写入日志。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/workspaceInviteRateLimiter.test.ts src/server/workspaceInviteMailer.test.ts`

Expected: PASS。

~~~bash
git add src/server/workspaceInviteRateLimiter.ts src/server/workspaceInviteRateLimiter.test.ts src/server/workspaceInviteMailer.ts src/server/workspaceInviteMailer.test.ts src/server/applicationServices.ts
git commit -m "feat: deliver rate limited workspace invites"
~~~

### Task 8：Owner 邀请 API

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/invites/handlers.ts`
- Create: `src/app/api/workspaces/[workspaceId]/invites/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/invites/route.test.ts`
- Create: `src/app/api/workspaces/[workspaceId]/invites/[inviteId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/invites/[inviteId]/resend/route.ts`

- [ ] **Step 1: 写失败的 handler 测试**

~~~ts
it("returns a delivery warning when mail fails after creation", async () => {
  inviteStore.createInvite.mockResolvedValue({ invite, rawToken: "raw-token" });
  mailer.send.mockRejectedValue(new Error("SMTP unavailable"));
  const response = await handlers.create(
    jsonRequest({ email: "member@example.com", role: "editor" }),
    "workspace-1",
  );
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    invite: { id: "invite-1", deliveryStatus: "failed" },
    deliveryWarning: { code: "invite_delivery_failed" },
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/app/api/workspaces/[workspaceId]/invites/route.test.ts`

Expected: FAIL，路由不存在。

- [ ] **Step 3: 实现 handler 和薄 route**

handler 注入 `authStore`、`inviteStore`、`limiter`、`mailer`、`appUrl`，公开 list/create/resend/revoke。顺序为认证、精确输入、限流、Store 事务、Mailer、delivery 状态、响应。Mailer 失败返回成功状态与 warning。route 只解析 params 和组装依赖。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/app/api/workspaces/[workspaceId]/invites/route.test.ts`

Expected: PASS，覆盖 owner/editor/viewer、角色必选、限流、冷却、撤销和终态。

~~~bash
git add src/app/api/workspaces/[workspaceId]/invites
git commit -m "feat: add owner workspace invite api"
~~~

### Task 9：收件人和邮件令牌 API

**Files:**
- Create: `src/app/api/workspace-invites/handlers.ts`
- Create: `src/app/api/workspace-invites/route.ts`
- Create: `src/app/api/workspace-invites/route.test.ts`
- Create: `src/app/api/workspace-invites/[inviteId]/accept/route.ts`
- Create: `src/app/api/workspace-invites/[inviteId]/decline/route.ts`
- Create: `src/app/api/workspace-invites/resolve/route.ts`
- Create: `src/app/api/workspace-invites/accept/route.ts`
- Create: `src/app/api/workspace-invites/decline/route.ts`

- [ ] **Step 1: 写失败的 resolve 与接受测试**

~~~ts
it("resolves a raw token without returning it", async () => {
  const response = await handlers.resolve(jsonRequest({ token: "raw-token" }));
  expect(response.headers.get("set-cookie")).toContain(
    "nexus_workspace_invite_context=",
  );
  expect(JSON.stringify(await response.json())).not.toContain("raw-token");
});

it("accepts an in-app invite and returns catalog plus workspace", async () => {
  const response = await handlers.acceptById(authenticatedRequest, "invite-1");
  await expect(response.json()).resolves.toMatchObject({
    catalog: { currentWorkspaceId: "workspace-1" },
    workspace: { summary: { id: "workspace-1" } },
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/app/api/workspace-invites/route.test.ts`

Expected: FAIL，handler 不存在。

- [ ] **Step 3: 实现 handler 与路由**

公开 list、resolve、acceptById、declineById、acceptByContext、declineByContext。接受成功后选择目标工作区并返回 `{ catalog, workspace }`。context 成功或终态失败清除 Cookie；无效原始令牌统一 404。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/app/api/workspace-invites/route.test.ts src/server/workspaceInviteTokens.test.ts`

Expected: PASS，覆盖未登录、邮箱不一致、过期、撤销和 Cookie 清理。

~~~bash
git add src/app/api/workspace-invites
git commit -m "feat: add recipient workspace invite api"
~~~

### Task 10：邀请接受页与认证返回

**Files:**
- Create: `src/app/invitations/accept/page.tsx`
- Create: `src/features/editor/components/invitations/InvitationAcceptScreen.tsx`
- Create: `src/features/editor/components/invitations/InvitationAcceptScreen.test.tsx`
- Modify: `src/app/AuthScreen.tsx`
- Modify: `src/app/api/auth/oauth/github/oauthCookies.ts`
- Modify: `src/app/api/auth/oauth/github/handlers.ts`
- Modify: `src/app/api/auth/oauth/github/route.test.ts`
- Modify: `src/app/api/auth/oauth/github/callback/handlers.ts`
- Modify: `src/app/api/auth/oauth/github/callback/route.test.ts`

- [ ] **Step 1: 写失败的 fragment 和 OAuth 返回测试**

~~~ts
it("exchanges the fragment once and removes it from the address bar", async () => {
  window.history.replaceState(null, "", "/invitations/accept#token=raw-token");
  render(<InvitationAcceptScreen />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(
    "/api/workspace-invites/resolve",
    expect.objectContaining({ body: JSON.stringify({ token: "raw-token" }) }),
  ));
  expect(window.location.hash).toBe("");
});
~~~

~~~ts
it("redirects GitHub callback to a validated invitation path", async () => {
  const response = await handler(requestWithReturnCookie);
  expect(response.headers.get("location"))
    .toBe("http://localhost/invitations/accept");
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/components/invitations/InvitationAcceptScreen.test.tsx src/app/api/auth/oauth/github/route.test.ts src/app/api/auth/oauth/github/callback/route.test.ts`

Expected: FAIL，页面和 return cookie 不存在。

- [ ] **Step 3: 实现页面状态机**

状态固定为 resolving、anonymous、ready、submitting、terminal、error。首次 effect 读取 fragment，立即 `replaceState` 清除，再 resolve。anonymous 状态复用 `AuthScreen` 并传 `oauthReturnTo="/invitations/accept"`；认证成功后重新加载上下文。接受导航 `/`，拒绝显示终态。

- [ ] **Step 4: 实现安全 OAuth returnTo**

新增 HttpOnly Cookie `notion_editor_oauth_return_to`。start 只接受单个 `/` 开头且不含协议/主机的路径；callback 读取并清除，默认 `/`。`AuthScreen` 的 GitHub 按钮编码该路径。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/features/editor/components/invitations/InvitationAcceptScreen.test.tsx src/app/api/auth/oauth/github/route.test.ts src/app/api/auth/oauth/github/callback/route.test.ts`

Expected: PASS。

~~~bash
git add src/app/invitations src/features/editor/components/invitations/InvitationAcceptScreen.tsx src/features/editor/components/invitations/InvitationAcceptScreen.test.tsx src/app/AuthScreen.tsx src/app/api/auth/oauth/github
git commit -m "feat: add workspace invitation acceptance page"
~~~

### Task 11：邀请客户端仓储与工作区切换桥

**Files:**
- Create: `src/features/editor/persistence/workspaceInviteRepository.ts`
- Create: `src/features/editor/persistence/workspaceInviteRepository.test.ts`
- Modify: `src/features/editor/session/useWorkspaceSession.ts`
- Modify: `src/features/editor/session/useWorkspaceSession.test.tsx`

- [ ] **Step 1: 写失败的仓储路径和切换测试**

~~~ts
it("accepts a received invitation through the exact endpoint", async () => {
  await repository.acceptReceived("invite/a");
  expect(fetch).toHaveBeenCalledWith(
    "/api/workspace-invites/invite%2Fa/accept",
    expect.objectContaining({ method: "POST" }),
  );
});

it("flushes the current save before installing a server transition", async () => {
  await act(() => result.current.runServerTransition(() => Promise.resolve({
    catalog: nextCatalog,
    workspace: nextSnapshot,
  })));
  expect(result.current.snapshot).toEqual(nextSnapshot);
  expect(result.current.catalog).toEqual(nextCatalog);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/persistence/workspaceInviteRepository.test.ts src/features/editor/session/useWorkspaceSession.test.tsx`

Expected: FAIL，仓储和 `runServerTransition` 不存在。

- [ ] **Step 3: 实现邀请仓储**

公开 `listReceived`、`listSent`、`create`、`resend`、`revoke`、`acceptReceived`、`declineReceived`。路径参数全部 `encodeURIComponent`，响应使用 Task 1 的共享类型。

- [ ] **Step 4: 实现切换桥**

~~~ts
runServerTransition(
  operation: () => Promise<WorkspaceTransitionResponse>,
): Promise<void>;
~~~

方法复用 `transitionRef` 和 `isTransitioning`，先 `flushSave`，再执行 operation，最后用返回的 catalog 和 workspace 调用 `installSnapshot`。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/features/editor/persistence/workspaceInviteRepository.test.ts src/features/editor/session/useWorkspaceSession.test.tsx`

Expected: PASS。

~~~bash
git add src/features/editor/persistence/workspaceInviteRepository.ts src/features/editor/persistence/workspaceInviteRepository.test.ts src/features/editor/session/useWorkspaceSession.ts src/features/editor/session/useWorkspaceSession.test.tsx
git commit -m "feat: bridge invitation acceptance into workspace session"
~~~

### Task 12：全局邀请中心

**Files:**
- Create: `src/features/editor/components/invitations/WorkspaceInvitationCenter.tsx`
- Create: `src/features/editor/components/invitations/WorkspaceInvitationCenter.test.tsx`
- Modify: `src/features/editor/components/WorkspaceShell.tsx`
- Modify: `src/features/editor/components/WorkspaceShell.test.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/features/editor/components/document/DocumentTopbar.tsx`

- [ ] **Step 1: 写失败的邀请中心测试**

~~~ts
it("shows the pending count and locks only the selected item", async () => {
  render(<WorkspaceInvitationCenter
    invites={invites}
    onAccept={onAccept}
    onDecline={onDecline}
    open
    onOpenChange={vi.fn()}
  />);
  expect(screen.getByText("2 个待处理")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "接受并进入" })[0]);
  expect(onAccept).toHaveBeenCalledWith("invite-1");
  expect(screen.getAllByRole("button", { name: "接受并进入" })[1]).toBeEnabled();
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/components/invitations/WorkspaceInvitationCenter.test.tsx src/features/editor/components/WorkspaceShell.test.tsx`

Expected: FAIL，组件和 topbar props 不存在。

- [ ] **Step 3: 实现 Sheet 和工具栏入口**

使用现有 `Sheet`、`Button`、`Badge` 和 lucide `Mail` 图标。桌面右侧约 420px，移动端全宽。`DocumentTopbar` 增加 `inviteCount` 和 `onOpenInvites`，按钮固定尺寸，徽标不改变工具栏布局。

- [ ] **Step 4: 在 WorkspaceShell 编排**

数据库模式加载 `listReceived`。接受调用 `session.runServerTransition`；拒绝需要二次确认。成功后重新加载邀请列表，异步时只锁定当前邀请。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/features/editor/components/invitations/WorkspaceInvitationCenter.test.tsx src/features/editor/components/WorkspaceShell.test.tsx src/features/editor/components/EditorPage.test.tsx`

Expected: PASS。

~~~bash
git add src/features/editor/components/invitations/WorkspaceInvitationCenter.tsx src/features/editor/components/invitations/WorkspaceInvitationCenter.test.tsx src/features/editor/components/WorkspaceShell.tsx src/features/editor/components/WorkspaceShell.test.tsx src/features/editor/components/EditorPage.tsx src/features/editor/components/document/DocumentTopbar.tsx
git commit -m "feat: add global workspace invitation center"
~~~

### Task 13：Owner 邀请管理页签

**Files:**
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceInvitesTab.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceInvitesTab.test.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceMembersTab.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`
- Modify: `src/features/editor/components/document/MembersPopover.tsx`
- Modify: `src/features/editor/components/document/MembersPopover.test.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Modify: `src/features/editor/components/EditorPage.test.tsx`

- [ ] **Step 1: 写失败的 owner 邀请 UI 测试**

~~~ts
it("requires an explicit role and exposes resend and revoke", async () => {
  render(<WorkspaceInvitesTab workspaceId="workspace-1" />);
  await user.type(screen.getByLabelText("成员邮箱"), "member@example.com");
  expect(screen.getByRole("button", { name: "发送邀请" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: "邀请角色" }));
  await user.click(screen.getByRole("option", { name: "编辑者" }));
  expect(screen.getByRole("button", { name: "发送邀请" })).toBeEnabled();
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/components/sidebar/workspace-manager/WorkspaceInvitesTab.test.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`

Expected: FAIL，详情视图和页签不存在。

- [ ] **Step 3: 扩展管理器导航**

列表 owner 行增加“管理”按钮。详情 view 保存 workspace 和 tab，顶部返回按钮，下方使用 `Tabs`。M6.2A 先提供只读成员页和完整邀请页；editor/viewer 不显示管理入口。

- [ ] **Step 4: 实现邀请页**

邮箱输入、无默认角色 `Select`、发送按钮、pending/failed/terminal 行、60 秒倒计时、重发、撤销、重新邀请文案和 30 天历史。移动端每行纵向排列。

- [ ] **Step 5: 删除旧的直接添加成员入口**

`MembersPopover` 只显示在线状态和成员列表，删除邮箱表单、`onInviteMember` prop 和“添加已有身份”文案。`EditorPage` 删除 `addWorkspaceMember` import、`handleInviteMember` 和对应 prop；owner 通过工作区管理器邀请。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm test --run src/features/editor/components/sidebar/workspace-manager/WorkspaceInvitesTab.test.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/document/MembersPopover.test.tsx src/features/editor/components/EditorPage.test.tsx`

Expected: PASS。

~~~bash
git add src/features/editor/components/sidebar/workspace-manager src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/document/MembersPopover.tsx src/features/editor/components/document/MembersPopover.test.tsx src/features/editor/components/EditorPage.tsx src/features/editor/components/EditorPage.test.tsx
git commit -m "feat: manage sent workspace invitations"
~~~

### Task 14：M6.2A 阶段验收

**Files:**
- Modify: `e2e/support.ts`
- Create: `e2e/workspace-invitations.spec.ts`

- [ ] **Step 1: 扩展邮件捕获读取**

~~~ts
export async function waitForCapturedInvite(email: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = [...readMailCaptures()].reverse().find((capture) =>
      capture.to === email && capture.purpose === "workspace-invite",
    );
    if (match && typeof match.url === "string") return match.url;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("No captured workspace invitation for " + email);
}
~~~

- [ ] **Step 2: 写邀请 E2E**

覆盖未注册邮箱注册后接受、已注册用户站内接受、拒绝后 owner 看到 declined、重发旧链接失效、撤销和过期不可接受。

- [ ] **Step 3: 运行 A 阶段验证**

Run: `pnpm test --run`

Run: `pnpm build`

Run: `docker compose up -d --build`

Run: `pnpm test:e2e -- e2e/workspace-invitations.spec.ts`

Expected: 单元、构建、健康检查和邀请 E2E 全部 PASS。

- [ ] **Step 4: 提交**

~~~bash
git add e2e/support.ts e2e/workspace-invitations.spec.ts
git commit -m "test: cover workspace invitation lifecycle"
~~~

## Phase B：M6.2B 成员生命周期

### Task 15：成员 Store 拆分与角色修改

**Files:**
- Create: `src/server/postgresWorkspaceMemberStore.ts`
- Create: `src/server/postgresWorkspaceMemberStore.test.ts`
- Modify: `src/server/postgresWorkspaceStore.ts`
- Modify: `src/server/postgresWorkspaceStore.test.ts`
- Modify: `src/server/applicationServices.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/members/handlers.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/members/route.test.ts`

- [ ] **Step 1: 写失败的角色测试**

~~~ts
it("changes a member role and protects the last owner", async () => {
  await expect(memberStore.updateRole({
    actorUserId: "owner-1",
    memberId: "member-1",
    role: "viewer",
    workspaceId: "workspace-1",
  })).resolves.toBeUndefined();
  await expect(memberStore.updateRole({
    actorUserId: "owner-1",
    memberId: "owner-1",
    role: "editor",
    workspaceId: "workspace-1",
  })).rejects.toMatchObject({ code: "last_owner_protected" });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts src/app/api/workspaces/[workspaceId]/members/route.test.ts`

Expected: FAIL，新 Store 不存在。

- [ ] **Step 3: 抽取列表并实现 updateRole**

新 Store 公开 `listMembers` 和 `updateRole`。角色事务先锁活动工作区，再验证 actor owner、目标成员和 owner count，写角色审计。从 `PostgresWorkspaceStore` 删除 `addMember/listMembers`，更新旧测试 fixture，不保留兼容包装。

- [ ] **Step 4: 停用直接 POST**

members 根 route 只保留 GET；新增成员只能由邀请接受事务完成。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts src/server/postgresWorkspaceStore.test.ts src/app/api/workspaces/[workspaceId]/members/route.test.ts`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceMemberStore.ts src/server/postgresWorkspaceMemberStore.test.ts src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts src/server/applicationServices.ts src/app/api/workspaces/[workspaceId]/members
git commit -m "refactor: split workspace member store"
~~~

### Task 16：成员移除、退出和偏好回退

**Files:**
- Modify: `src/server/postgresWorkspaceMemberStore.ts`
- Modify: `src/server/postgresWorkspaceMemberStore.test.ts`

- [ ] **Step 1: 写失败的移除测试**

~~~ts
it("removes membership, document preferences, and selects a fallback", async () => {
  await memberStore.removeMember({
    actorUserId: "owner-1",
    memberId: "member-1",
    workspaceId: "workspace-1",
  });
  expect((await pool.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    ["workspace-1", "member-1"],
  )).rows).toHaveLength(0);
  expect((await pool.query(
    "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id=$1",
    ["member-1"],
  )).rows[0].selected_workspace_id).toBe("workspace-2");
  expect((await pool.query(
    "SELECT 1 FROM auth_sessions WHERE user_id=$1",
    ["member-1"],
  )).rows).toHaveLength(1);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts`

Expected: FAIL，移除和退出方法不存在。

- [ ] **Step 3: 实现事务**

~~~ts
removeMember(input: {
  actorUserId: string;
  memberId: string;
  workspaceId: string;
}): Promise<void>;

leaveWorkspace(input: {
  userId: string;
  userDisplayName: string;
  workspaceId: string;
}): Promise<{ selectedWorkspaceId: string }>;
~~~

事务删除 `workspace_document_preferences` 和 membership。当前选择指向离开空间时选最早其他活动空间；没有时在同一事务复用 `ensurePersonalWorkspace` 创建个人空间。写 removed 或 left 审计，并保护最后 owner。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceMemberStore.ts src/server/postgresWorkspaceMemberStore.test.ts
git commit -m "feat: remove and leave workspace memberships"
~~~

### Task 17：所有权转让与真实并发

**Files:**
- Modify: `src/server/postgresWorkspaceMemberStore.ts`
- Modify: `src/server/postgresWorkspaceMemberStore.test.ts`
- Create: `src/server/postgresWorkspaceMemberStore.postgres.test.ts`

- [ ] **Step 1: 写失败的转让测试**

~~~ts
it("promotes the target and optionally demotes the actor", async () => {
  await memberStore.transferOwnership({
    actorUserId: "owner-1",
    retainOwnerRole: false,
    targetUserId: "editor-1",
    workspaceId: "workspace-1",
  });
  expect((await pool.query(
    "SELECT user_id,role FROM workspace_members WHERE workspace_id=$1 ORDER BY user_id",
    ["workspace-1"],
  )).rows).toEqual([
    { role: "owner", user_id: "editor-1" },
    { role: "editor", user_id: "owner-1" },
  ]);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts`

Expected: FAIL，`transferOwnership` 不存在。

- [ ] **Step 3: 实现转让**

目标必须是当前非 owner 成员。工作区锁内提升目标，再按 `retainOwnerRole` 保留 actor owner 或降为 editor，写转让审计。

- [ ] **Step 4: 增加真实 PostgreSQL 并发测试**

并发执行转让与移除/降级，断言结果始终至少一名 owner，失败方返回稳定冲突。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceMemberStore.test.ts`

Run in Compose: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceMemberStore.ts src/server/postgresWorkspaceMemberStore.test.ts src/server/postgresWorkspaceMemberStore.postgres.test.ts
git commit -m "feat: transfer workspace ownership"
~~~

### Task 18：成员 API 与客户端仓储

**Files:**
- Create: `src/app/api/workspaces/[workspaceId]/members/[memberId]/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/leave/route.ts`
- Create: `src/app/api/workspaces/[workspaceId]/ownership-transfer/route.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/members/handlers.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/members/route.test.ts`
- Modify: `src/features/editor/persistence/workspaceMemberRepository.ts`
- Modify: `src/features/editor/persistence/workspaceMemberRepository.test.ts`

- [ ] **Step 1: 写失败的路径测试**

~~~ts
it("uses PATCH, DELETE, and the dedicated leave route", async () => {
  await updateWorkspaceMemberRole("workspace/a", "user/b", "viewer");
  await removeWorkspaceMember("workspace/a", "user/b");
  await leaveWorkspace("workspace/a");
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "/api/workspaces/workspace%2Fa/members/user%2Fb",
    expect.objectContaining({ method: "PATCH" }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "/api/workspaces/workspace%2Fa/members/user%2Fb",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    3,
    "/api/workspaces/workspace%2Fa/leave",
    expect.objectContaining({ method: "POST" }),
  );
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/app/api/workspaces/[workspaceId]/members/route.test.ts src/features/editor/persistence/workspaceMemberRepository.test.ts`

Expected: FAIL，新方法和路由不存在。

- [ ] **Step 3: 实现 handler、route 和仓储**

handler 公开 list/updateRole/remove/leave/transfer。leave 获取 session user displayName，返回 `{ catalog, workspace }`。客户端仓储返回精确 `{ members }` 或 `WorkspaceTransitionResponse`，删除 `addWorkspaceMember`。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/app/api/workspaces/[workspaceId]/members/route.test.ts src/features/editor/persistence/workspaceMemberRepository.test.ts`

Expected: PASS。

~~~bash
git add src/app/api/workspaces/[workspaceId] src/features/editor/persistence/workspaceMemberRepository.ts src/features/editor/persistence/workspaceMemberRepository.test.ts
git commit -m "feat: add workspace member lifecycle api"
~~~

### Task 19：事务性权限失效与 WebSocket 关闭

**Files:**
- Create: `src/server/workspaceAccessNotifications.ts`
- Create: `src/server/workspaceAccessNotifications.test.ts`
- Modify: `src/server/postgresWorkspaceMemberStore.ts`
- Modify: `src/server/collaborationServer.ts`
- Modify: `src/server/collaborationServer.test.ts`
- Modify: `scripts/collaboration-server.ts`

- [ ] **Step 1: 写失败的连接关闭测试**

~~~ts
it("closes only the invalidated user sockets", async () => {
  const invalidations = createFakeInvalidationSource();
  const server = createCollaborationServer({
    accessInvalidations: invalidations,
    allowedOrigins: ["http://localhost:3000"],
    authStore,
    setupConnection,
    workspaceStore,
  });
  const first = await connectAs("user-1");
  const second = await connectAs("user-2");
  invalidations.emit({ userId: "user-1", workspaceId: "workspace-1" });
  await expect(waitForClose(first)).resolves.toBe(4403);
  expect(second.readyState).toBe(WebSocket.OPEN);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/workspaceAccessNotifications.test.ts src/server/collaborationServer.test.ts`

Expected: FAIL，通知源和连接注册不存在。

- [ ] **Step 3: 实现 pg_notify 和 listener**

~~~ts
export interface WorkspaceAccessInvalidation {
  workspaceId: string;
  userId: string | null;
}

export function notifyWorkspaceAccessInvalidation(
  client: Pick<PoolClient, "query">,
  event: WorkspaceAccessInvalidation,
) {
  return client.query("SELECT pg_notify($1,$2)", [
    "workspace_access_invalidated",
    JSON.stringify(event),
  ]);
}
~~~

实现独占连接的 `PostgresWorkspaceAccessListener`。成员角色、移除、退出、转让和以后删除事务在 COMMIT 前调用 notify；PostgreSQL 在提交后投递，回滚不投递。

- [ ] **Step 4: 实现连接注册**

授权成功后记录 socket 对应 userId/workspaceId/documentId。workspace 级事件关闭全部连接；user 级事件只关闭目标成员，关闭码 4403。socket close 时清理 Map。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/server/workspaceAccessNotifications.test.ts src/server/collaborationServer.test.ts`

Run in Compose: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Expected: PASS，包含提交/回滚通知边界。

~~~bash
git add src/server/workspaceAccessNotifications.ts src/server/workspaceAccessNotifications.test.ts src/server/postgresWorkspaceMemberStore.ts src/server/collaborationServer.ts src/server/collaborationServer.test.ts scripts/collaboration-server.ts
git commit -m "feat: revoke live workspace access transactionally"
~~~

### Task 20：成员管理界面

**Files:**
- Modify: `src/features/editor/components/sidebar/workspace-manager/WorkspaceMembersTab.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceMembersTab.test.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceMemberConfirmations.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`
- Modify: `src/features/editor/components/WorkspaceShell.tsx`

- [ ] **Step 1: 写失败的成员操作测试**

~~~ts
it("protects the final owner and defaults transfer retention on", async () => {
  render(<WorkspaceMembersTab
    currentUserId="owner-1"
    members={[onlyOwner]}
    workspaceId="workspace-1"
  />);
  expect(screen.getByRole("button", { name: "退出工作区" })).toBeDisabled();
  expect(screen.getByText("最后一名所有者必须先转让所有权")).toBeVisible();
  renderTransferDialog();
  expect(screen.getByRole("checkbox", {
    name: "我仍保留所有者角色",
  })).toBeChecked();
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/components/sidebar/workspace-manager/WorkspaceMembersTab.test.tsx`

Expected: FAIL，成员操作不存在。

- [ ] **Step 3: 实现成员行和确认对话框**

owner 看见角色 Select、操作菜单、移除和转让；普通成员只见自己的退出。owner 降级、owner 移除、退出、转让均二次确认。请求期间只禁用当前 memberId。

- [ ] **Step 4: 编排切换并运行测试**

leave 使用 `session.runServerTransition`；其他成员操作刷新 members。当前用户角色改变后 reload 当前目录和快照。

Run: `pnpm test --run src/features/editor/components/sidebar/workspace-manager/WorkspaceMembersTab.test.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/WorkspaceShell.test.tsx`

Expected: PASS，包含移动端纵向布局和长邮箱不溢出。

- [ ] **Step 5: 提交**

~~~bash
git add src/features/editor/components/sidebar/workspace-manager src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/WorkspaceShell.tsx
git commit -m "feat: manage workspace member lifecycle"
~~~

### Task 21：M6.2B 阶段验收

**Files:**
- Create: `e2e/workspace-members.spec.ts`
- Modify: `e2e/support.ts`

- [ ] **Step 1: 写多用户 E2E**

用 `browser.newContext` 创建 owner、editor、viewer 三个会话，覆盖角色调整、转让保留开关、移除、退出、最后 owner 保护和回退工作区。

- [ ] **Step 2: 增加跨服务权限断言**

owner 把在线 editor 降为 viewer 或移除，断言目标 WebSocket 关闭、文件返回 403、REST 被拒绝，其他成员连接保持。

- [ ] **Step 3: 运行验证并提交**

Run: `pnpm test --run`

Run: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Run: `pnpm test:e2e -- e2e/workspace-members.spec.ts`

Expected: 全部 PASS。

~~~bash
git add e2e/workspace-members.spec.ts e2e/support.ts
git commit -m "test: cover workspace member lifecycle"
~~~

## Phase C：M6.2C 删除、回收站与永久清理

### Task 22：软删除迁移与活动工作区过滤

**Files:**
- Modify: `src/server/database/migrations.ts`
- Modify: `src/server/database/migrations.test.ts`
- Modify: `src/server/postgresWorkspaceStore.ts`
- Modify: `src/server/postgresWorkspaceStore.test.ts`
- Modify: `src/app/api/workspaces/handlers.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/route.test.ts`
- Modify: `src/server/collaborationAuthorization.ts`
- Modify: `src/server/collaborationAuthorization.test.ts`
- Modify: `src/app/api/files/handlers.ts`
- Modify: `src/app/api/files/handlers.test.ts`

- [ ] **Step 1: 写失败的 tombstone 测试**

~~~ts
it("adds constrained tombstone fields", async () => {
  await migrateDatabase(pool);
  const columns = await columnNames(pool, "editor_workspaces");
  expect(columns).toEqual(expect.arrayContaining([
    "deleted_at", "deleted_by", "purge_after",
  ]));
  await expect(pool.query(
    "UPDATE editor_workspaces SET deleted_at=$1,purge_after=$2 WHERE id=$3",
    [1_000, 2_000, "workspace-1"],
  )).rejects.toThrow();
});
~~~

- [ ] **Step 2: 写失败的访问过滤测试**

~~~ts
it("excludes deleted workspaces from catalog and access", async () => {
  await markDeleted("workspace-1");
  const catalog = await workspaceStore.listWorkspaces("owner-1");
  expect(catalog.workspaces.map((item) => item.id)).not.toContain("workspace-1");
  await expect(workspaceStore.getWorkspaceAccess("owner-1", "workspace-1"))
    .resolves.toBeNull();
});

it("returns deleted only to a retained member and hides it from strangers", async () => {
  await markDeleted("workspace-1");
  await expect(workspaceStore.loadWorkspace("owner-1", "workspace-1"))
    .rejects.toMatchObject({ code: "workspace_deleted" });
  await expect(workspaceStore.loadWorkspace("stranger-1", "workspace-1"))
    .rejects.toMatchObject({ code: "workspace_not_found" });
});
~~~

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test --run src/server/database/migrations.test.ts src/server/postgresWorkspaceStore.test.ts src/server/collaborationAuthorization.test.ts src/app/api/files/handlers.test.ts`

Expected: FAIL，字段和过滤不存在。

- [ ] **Step 4: 实现迁移和过滤**

迁移 ID `2026-07-16-workspace-soft-deletion`，增加三个字段、七天 CHECK 和 purge 部分索引。所有目录、内容、历史、文件、协作、邀请接受和成员访问查询要求 `deleted_at IS NULL`。新增内部 access-state 查询：保留 membership 且 workspace 已删除时抛 `workspace_deleted`，没有 membership 时抛 `workspace_not_found`。文件和 REST 使用统一错误响应；协作升级对两种情况都拒绝，但不向无关用户泄露名称。目录偏好无效时回退或创建个人空间。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test --run src/server/database/migrations.test.ts src/server/postgresWorkspaceStore.test.ts src/server/collaborationAuthorization.test.ts src/app/api/files/handlers.test.ts`

Expected: PASS。

~~~bash
git add src/server/database src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts src/app/api/workspaces/handlers.ts src/app/api/workspaces/[workspaceId]/route.test.ts src/server/collaborationAuthorization.ts src/server/collaborationAuthorization.test.ts src/app/api/files/handlers.ts src/app/api/files/handlers.test.ts
git commit -m "feat: add workspace soft deletion boundary"
~~~

### Task 23：删除摘要与软删除事务

**Files:**
- Create: `src/server/postgresWorkspaceLifecycleStore.ts`
- Create: `src/server/postgresWorkspaceLifecycleStore.test.ts`
- Modify: `src/server/applicationServices.ts`
- Create: `src/app/api/workspaces/lifecycleHandlers.ts`
- Create: `src/app/api/workspaces/[workspaceId]/deletion-summary/route.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/route.ts`
- Modify: `src/app/api/workspaces/[workspaceId]/route.test.ts`

- [ ] **Step 1: 写失败的摘要和删除测试**

~~~ts
it("returns counts and revokes pending invites on deletion", async () => {
  await expect(lifecycleStore.getDeletionSummary("owner-1", "workspace-1"))
    .resolves.toEqual({
      documentCount: 2,
      fileCount: 3,
      id: "workspace-1",
      memberCount: 4,
      name: "产品研发中心",
    });
  const deleted = await lifecycleStore.deleteWorkspace({
    actorUserId: "owner-1",
    confirmationName: "产品研发中心",
    workspaceId: "workspace-1",
  });
  expect(deleted.purgeAfter - deleted.deletedAt).toBe(604_800_000);
  expect(await pendingInviteCount()).toBe(0);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceLifecycleStore.test.ts src/app/api/workspaces/[workspaceId]/route.test.ts`

Expected: FAIL，Lifecycle Store 和 DELETE 不存在。

- [ ] **Step 3: 实现 Store 与 API**

摘要只允许 owner，文件数统计 image/file 块。删除事务锁工作区、精确比较不 trim 的名称、写 tombstone、撤销 pending 邀请及审计、写 deleted 审计、发送 workspace 级 invalidation。DELETE 返回 `{ catalog, workspace, deletedWorkspace }`。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceLifecycleStore.test.ts src/app/api/workspaces/[workspaceId]/route.test.ts`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceLifecycleStore.ts src/server/postgresWorkspaceLifecycleStore.test.ts src/server/applicationServices.ts src/app/api/workspaces/lifecycleHandlers.ts src/app/api/workspaces/[workspaceId]
git commit -m "feat: soft delete workspaces"
~~~

### Task 24：回收站与恢复事务

**Files:**
- Modify: `src/server/postgresWorkspaceLifecycleStore.ts`
- Modify: `src/server/postgresWorkspaceLifecycleStore.test.ts`
- Create: `src/app/api/workspaces/trash/route.ts`
- Create: `src/app/api/workspaces/trash/route.test.ts`
- Create: `src/app/api/workspaces/[workspaceId]/restore/route.ts`

- [ ] **Step 1: 写失败的恢复测试**

~~~ts
it("lists only owner tombstones and restores into selection", async () => {
  expect((await lifecycleStore.listTrash("owner-1")).map((item) => item.id))
    .toEqual(["workspace-1"]);
  await lifecycleStore.restoreWorkspace("owner-1", "workspace-1");
  expect(await selectedWorkspace("owner-1")).toBe("workspace-1");
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/postgresWorkspaceLifecycleStore.test.ts src/app/api/workspaces/trash/route.test.ts`

Expected: FAIL，回收站和恢复方法不存在。

- [ ] **Step 3: 实现 Store 与 API**

回收站只列 role owner 且 `purge_after > now`。恢复锁行，要求 `now < purge_after` 和保留 owner membership，清空 tombstone、写审计、选择目标。trash 返回 `{ workspaces }`，restore 返回 `{ catalog, workspace }`。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/postgresWorkspaceLifecycleStore.test.ts src/app/api/workspaces/trash/route.test.ts`

Expected: PASS。

~~~bash
git add src/server/postgresWorkspaceLifecycleStore.ts src/server/postgresWorkspaceLifecycleStore.test.ts src/app/api/workspaces/trash src/app/api/workspaces/[workspaceId]/restore
git commit -m "feat: restore workspaces from trash"
~~~

### Task 25：对象存储前缀删除

**Files:**
- Modify: `src/server/objectStorage.ts`
- Modify: `src/server/objectStorage.test.ts`

- [ ] **Step 1: 写失败的 deletePrefix 测试**

~~~ts
it("deletes one workspace prefix without touching another", async () => {
  await storage.putObject("workspace-1/a.png", bytes, "image/png");
  await storage.putObject("workspace-2/b.png", bytes, "image/png");
  await storage.deletePrefix("workspace-1/");
  await expect(storage.getObject("workspace-1/a.png")).rejects.toThrow();
  await expect(storage.getObject("workspace-2/b.png")).resolves.toMatchObject({
    size: bytes.length,
  });
  await expect(storage.deletePrefix("workspace-1/")).resolves.toBeUndefined();
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/objectStorage.test.ts`

Expected: FAIL，`deletePrefix` 不存在。

- [ ] **Step 3: 实现本地和 S3 删除**

接口增加 `deletePrefix(prefix)`。本地验证安全 workspace 目录后递归删除。S3 用 `ListObjectsV2Command` 分页和每批不超过 1000 个 `DeleteObjectsCommand`；空前缀成功，任何部分 Errors 抛出。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm test --run src/server/objectStorage.test.ts`

Expected: PASS，包含两页列表、批量删除和部分失败 fake 测试。

~~~bash
git add src/server/objectStorage.ts src/server/objectStorage.test.ts
git commit -m "feat: delete workspace object prefixes"
~~~

### Task 26：请求触发的永久清理

**Files:**
- Create: `src/server/workspacePurgeService.ts`
- Create: `src/server/workspacePurgeService.test.ts`
- Create: `src/server/workspacePurgeService.postgres.test.ts`
- Create: `src/app/api/workspaces/purgeScheduler.ts`
- Create: `src/app/api/workspaces/purgeScheduler.test.ts`
- Modify: `src/server/applicationServices.ts`
- Modify: `src/app/api/workspaces/route.ts`
- Modify: `src/app/api/workspaces/trash/route.ts`

- [ ] **Step 1: 写失败的顺序和失败保留测试**

~~~ts
it("deletes objects before the database row", async () => {
  const calls: string[] = [];
  objectStorage.deletePrefix.mockImplementation(async () => {
    calls.push("objects");
  });
  lifecycleStore.purgeDatabaseRow.mockImplementation(async () => {
    calls.push("database");
  });
  await service.purgeExpired(3);
  expect(calls).toEqual(["objects", "database"]);
});

it("retains the tombstone when object deletion fails", async () => {
  objectStorage.deletePrefix.mockRejectedValue(new Error("storage down"));
  await service.purgeExpired(3);
  expect(lifecycleStore.purgeDatabaseRow).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/server/workspacePurgeService.test.ts src/app/api/workspaces/purgeScheduler.test.ts`

Expected: FAIL，Service 和 scheduler 不存在。

- [ ] **Step 3: 实现 PurgeService**

Lifecycle Store 增加候选查询、session advisory lock、到期重查、数据库删除和 unlock。Service 每次最多 3 个候选，先 `deletePrefix`，再事务写 `workspace_purged` 审计并 DELETE workspace；失败记录结构化日志并保留 tombstone。

- [ ] **Step 4: 实现 after 调度**

~~~ts
export function scheduleWorkspacePurge(
  purge: () => Promise<void>,
  schedule: (work: () => Promise<void>) => void = after,
) {
  schedule(async () => {
    await purge().catch(() => undefined);
  });
}
~~~

workspaces GET 和 trash GET 在正常响应后调度 `purgeExpired(3)`。

- [ ] **Step 5: 运行单元和真实 PostgreSQL 测试**

Run: `pnpm test --run src/server/workspacePurgeService.test.ts src/app/api/workspaces/purgeScheduler.test.ts`

Run in Compose: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Expected: PASS；并发清理同一 tombstone 只执行一次，失败后重试成功。

- [ ] **Step 6: 提交**

~~~bash
git add src/server/workspacePurgeService.ts src/server/workspacePurgeService.test.ts src/server/workspacePurgeService.postgres.test.ts src/server/applicationServices.ts src/app/api/workspaces/purgeScheduler.ts src/app/api/workspaces/purgeScheduler.test.ts src/app/api/workspaces/route.ts src/app/api/workspaces/trash/route.ts
git commit -m "feat: purge expired workspaces on requests"
~~~

### Task 27：删除、回收站和恢复界面

**Files:**
- Create: `src/features/editor/persistence/workspaceLifecycleRepository.ts`
- Create: `src/features/editor/persistence/workspaceLifecycleRepository.test.ts`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceDangerZone.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceDangerZone.test.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceTrashView.tsx`
- Create: `src/features/editor/components/sidebar/workspace-manager/WorkspaceTrashView.test.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`
- Modify: `src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`
- Modify: `src/features/editor/components/WorkspaceShell.tsx`

- [ ] **Step 1: 写失败的界面测试**

~~~ts
it("enables deletion only for an exact workspace name", async () => {
  render(<WorkspaceDangerZone summary={summary} onDelete={onDelete} />);
  const button = screen.getByRole("button", { name: "移至回收站" });
  expect(button).toBeDisabled();
  await user.type(
    screen.getByLabelText("输入完整工作区名称以确认"),
    summary.name,
  );
  expect(button).toBeEnabled();
});

it("restores and enters the selected trash item", async () => {
  render(<WorkspaceTrashView workspaces={[deleted]} onRestore={onRestore} />);
  await user.click(screen.getByRole("button", { name: "恢复并进入" }));
  expect(onRestore).toHaveBeenCalledWith(deleted.id);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test --run src/features/editor/components/sidebar/workspace-manager/WorkspaceDangerZone.test.tsx src/features/editor/components/sidebar/workspace-manager/WorkspaceTrashView.test.tsx`

Expected: FAIL，组件和仓储不存在。

- [ ] **Step 3: 实现仓储和界面**

仓储公开 summary/delete/listTrash/restore。危险区域展示文档、成员、文件计数和精确名称输入。管理器列表头增加回收站图标。回收站显示删除时间、删除者、剩余时间和移动端全宽恢复按钮。

- [ ] **Step 4: 编排切换并运行测试**

delete 和 restore 都通过 `session.runServerTransition`，成功后进入返回的工作区。

Run: `pnpm test --run src/features/editor/persistence/workspaceLifecycleRepository.test.ts src/features/editor/components/sidebar/workspace-manager/WorkspaceDangerZone.test.tsx src/features/editor/components/sidebar/workspace-manager/WorkspaceTrashView.test.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/WorkspaceShell.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

~~~bash
git add src/features/editor/persistence/workspaceLifecycleRepository.ts src/features/editor/persistence/workspaceLifecycleRepository.test.ts src/features/editor/components/sidebar/workspace-manager src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/WorkspaceShell.tsx
git commit -m "feat: add workspace trash interface"
~~~

### Task 28：M6.2C 和完整端到端验收

**Files:**
- Create: `e2e/workspace-deletion.spec.ts`
- Modify: `e2e/support.ts`

- [ ] **Step 1: 增加 SQL 和对象目录帮助器**

`e2e/support.ts` 增加 `runSql`、`queryScalar`、`setWorkspacePurgeAfter`、`setUploadsDirectoryMode`。Docker 调用继续使用 `execFileSync` 参数数组，用户数据不拼入 shell。

- [ ] **Step 2: 写删除恢复 E2E**

覆盖精确名称删除、所有成员目录回退、REST/文件/WS 失效、owner 回收站、恢复并进入、内容与文件保留、邀请保持 revoked。

- [ ] **Step 3: 写过期和失败重试 E2E**

测试 SQL 把 `purge_after` 调到过去。先让对象目录不可删除，触发目录请求并确认 tombstone 保留；恢复权限后再次触发，确认 workspace 行删除且审计仍存在。过期恢复返回 `workspace_purge_expired`。

- [ ] **Step 4: 运行完整 E2E 并提交**

Run: `docker compose up -d --build`

Run: `pnpm test:e2e -- e2e/workspace-invitations.spec.ts e2e/workspace-members.spec.ts e2e/workspace-deletion.spec.ts`

Expected: PASS。

~~~bash
git add e2e/support.ts e2e/workspace-deletion.spec.ts
git commit -m "test: cover workspace deletion and recovery"
~~~

### Task 29：README、回归和最终提交

**Files:**
- Modify: `README.md`
- Modify: `docs/prd.md` if present
- Modify: `docs/superpowers/plans/2026-07-16-m6-2-workspace-team-lifecycle.md`

- [ ] **Step 1: 更新 README 和项目进度**

记录 A 的邀请与 SMTP/Redis、B 的多 owner 与权限失效、C 的 7 天回收站与对象优先清理、新 API 和验证命令。明确账号设置与 M7 真实分享权限仍在下一批。所有验证通过后才勾选本计划完成项。

- [ ] **Step 2: 运行单元、构建和真实 PostgreSQL**

Run: `pnpm test --run`

Run: `pnpm build`

Run: `docker compose run --rm migrate sh -lc 'TEST_DATABASE_URL="$DATABASE_URL" pnpm test:postgres'`

Expected: 全部 PASS。

- [ ] **Step 3: 运行容器和完整 E2E**

Run: `docker compose config`

Run: `docker compose up -d --build`

Run: `docker compose ps`

Run: `pnpm test:e2e`

Expected: 配置有效，postgres/redis/web/collaboration healthy，migrate exited 0，所有 Playwright PASS。

- [ ] **Step 4: 检查敏感信息和工作区**

Run: `rg -n "raw-token|token_hash|nexus_workspace_invite_context" .next/server src e2e --glob '!*.test.*'`

Expected: 只出现必要符号，不存在原始令牌日志、API 响应或浏览器存储写入。

Run: `git diff --check`

Run: `git status --short`

Expected: 无空白错误，只包含本次 M6.2 与文档变更。

- [ ] **Step 5: 提交文档**

~~~bash
git add README.md docs/prd.md docs/superpowers/plans/2026-07-16-m6-2-workspace-team-lifecycle.md
git commit -m "docs: complete M6.2 workspace lifecycle"
~~~

## 实施检查点

1. Task 14 完成后检查 M6.2A 邀请闭环，再继续成员生命周期。
2. Task 21 完成后检查 M6.2B 并发与权限失效，再继续删除功能。
3. Task 28 完成后检查 M6.2C 恢复和清理失败，再执行全量回归。
4. 任一检查点失败时只修复当前阶段，不跳到下一阶段。

## 完成标准

- 设计规格中的 A/B/C 产品规则都有对应实现和测试。
- 普通单元测试、真实 PostgreSQL 测试、构建、Compose 健康检查和完整 Playwright 全部通过。
- 原始邀请令牌不进入应用持久化、日志、审计、API 响应或浏览器存储。
- 最后一名 owner 保护在真实并发下成立。
- 成员与工作区权限变更使现有 WebSocket 立即关闭。
- 到期工作区对象删除失败时保留 tombstone，重试成功后审计仍存在。
- README 已更新，账号设置和 M7 真实分享权限明确留在下一批。
