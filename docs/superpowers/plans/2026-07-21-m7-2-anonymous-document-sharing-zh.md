# M7.2 匿名文档分享实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文档增加默认 24 小时、可自定义过期、可立即撤销的匿名只读分享，并保证公开附件、审计和页面渲染遵守同一分享生命周期。

**Architecture:** 保留 M7.1 的登录用户授权服务，新增独立的分享令牌服务与 PostgreSQL 分享存储。管理 API 仍要求文档 `manage` 权限；匿名 API 通过 HMAC 查找分享记录，读取后经过字段白名单清洗。附件使用 5 分钟签名代理，并在每次读取时重新验证分享记录，从而实现立即撤销。

**Tech Stack:** Next.js App Router、TypeScript、React 18、PostgreSQL、Vitest、Testing Library、Playwright、Node.js `crypto`、现有对象存储抽象。

---

## 文件结构

新增文件：

- `src/shared/documentShare.ts`：前后端共享的分享状态、响应类型、过期时间验证。
- `src/server/documentShareTokens.ts`：原始令牌 HMAC 和附件签名。
- `src/server/documentShareTokens.test.ts`：令牌与签名单元测试。
- `src/server/sharedDocumentSnapshot.ts`：公开字段白名单与附件 URL 替换纯函数。
- `src/server/sharedDocumentSnapshot.test.ts`：清洗器单元测试。
- `src/server/postgresDocumentShareStore.ts`：管理生命周期、匿名读取、附件授权和审计。
- `src/server/postgresDocumentShareStore.test.ts`：pg-mem 行为测试。
- `src/server/postgresDocumentShareStore.postgres.test.ts`：真实 PostgreSQL 并发与部分唯一索引测试。
- `src/app/api/document-share-links/handlers.ts`：分享管理 HTTP 处理器。
- `src/app/api/document-share-links/handlers.test.ts`：管理 API 单元测试。
- `src/app/api/documents/[documentId]/share-links/route.ts`：管理路由入口。
- `src/app/api/shared-documents/handlers.ts`：匿名文档 HTTP 处理器。
- `src/app/api/shared-documents/handlers.test.ts`：匿名文档 API 单元测试。
- `src/app/api/shared-documents/[token]/route.ts`：匿名文档路由入口。
- `src/app/api/shared-files/handlers.ts`：签名附件代理处理器。
- `src/app/api/shared-files/handlers.test.ts`：附件代理单元测试。
- `src/app/api/shared-files/[shareId]/[keyToken]/route.ts`：签名附件路由入口。
- `src/features/editor/persistence/documentShareRepository.ts`：分享管理前端仓库。
- `src/features/editor/persistence/documentShareRepository.test.ts`：前端仓库请求测试。
- `src/features/editor/components/shared/SharedDocumentClient.tsx`：匿名页面数据状态和只读渲染。
- `src/features/editor/components/shared/SharedDocumentClient.test.tsx`：匿名页面组件测试。
- `src/app/share/[token]/page.tsx`：匿名分享页面入口。
- `e2e/document-sharing.spec.ts`：M7.2 浏览器验收。

修改文件：

- `src/server/database/migrations.ts`、`src/server/database/migrations.test.ts`：分享表迁移。
- `src/server/applicationServices.ts`：组装分享服务、存储和对象存储。
- `src/server/postgresDocumentStore.ts`、`src/server/postgresDocumentStore.test.ts`：允许 `link` 策略并在切离时事务撤销。
- `src/shared/documentAccess.ts`、对应测试：服务端接受 `link` 策略。
- `src/server/postgresAttachmentStore.ts`、对应测试：按分享记录和文档验证附件。
- `src/features/editor/persistence/documentRepository.ts`、对应测试：保持策略接口支持 `link`。
- `src/features/editor/components/document/SharePopover.tsx`、对应测试：链接生命周期 UI。
- `docs/m7-status-zh.md`、`docs/prd.md`、`README.md`：验收后更新进度。

---

### Task 1：共享契约、过期规则与令牌签名

**Files:**
- Create: `src/shared/documentShare.ts`
- Create: `src/server/documentShareTokens.ts`
- Create: `src/server/documentShareTokens.test.ts`

- [ ] **Step 1：写过期规则与令牌失败测试**

创建 `src/server/documentShareTokens.test.ts`，覆盖默认 24 小时、365 天上限、32 字节 Base64URL 令牌、域隔离 HMAC、附件签名篡改和过期：

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_SHARE_TTL_MS,
  resolveDocumentShareExpiresAt,
} from "../shared/documentShare";
import { DocumentShareTokenService } from "./documentShareTokens";

const secret = "test-document-share-secret-at-least-32-bytes";

describe("document share expiration", () => {
  it("defaults to 24 hours and rejects values beyond 365 days", () => {
    expect(resolveDocumentShareExpiresAt(undefined, 1_000))
      .toBe(1_000 + DEFAULT_DOCUMENT_SHARE_TTL_MS);
    expect(() => resolveDocumentShareExpiresAt(1_000, 1_000)).toThrow("分享过期时间必须晚于当前时间");
    expect(() => resolveDocumentShareExpiresAt(1_000 + 366 * 86_400_000, 1_000))
      .toThrow("分享有效期不能超过 365 天");
  });
});

describe("DocumentShareTokenService", () => {
  it("creates a 256-bit token and hashes it in the document-share namespace", () => {
    const service = new DocumentShareTokenService(secret, () => 1_000);
    const token = service.createRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.hashRawToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashRawToken(token)).not.toBe(
      new DocumentShareTokenService(`${secret}x`, () => 1_000).hashRawToken(token),
    );
  });

  it("signs one attachment for five minutes and rejects tampering", () => {
    const service = new DocumentShareTokenService(secret, () => 1_000);
    const signed = service.signAttachment("share-1", "workspace-1/object.pdf", 601_000);
    expect(signed.expiresAt).toBe(301_000);
    expect(service.verifyAttachment({
      ...signed,
      objectKey: "workspace-1/object.pdf",
      shareId: "share-1",
    })).toBe(true);
    expect(service.verifyAttachment({
      ...signed,
      objectKey: "workspace-1/other.pdf",
      shareId: "share-1",
    })).toBe(false);
  });
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run: `pnpm test --run src/server/documentShareTokens.test.ts`

Expected: FAIL，模块 `documentShareTokens` 与 `documentShare` 尚不存在。

- [ ] **Step 3：实现共享类型与时间验证**

`src/shared/documentShare.ts` 导出以下稳定契约：

```ts
import type { BlockData, BlockType, HeadingLevel } from "../features/editor/model/block";

export const DEFAULT_DOCUMENT_SHARE_TTL_MS = 24 * 60 * 60_000;
export const MAX_DOCUMENT_SHARE_TTL_MS = 365 * 24 * 60 * 60_000;
export const DOCUMENT_SHARE_PRESETS = [
  { label: "1 小时", milliseconds: 60 * 60_000 },
  { label: "24 小时", milliseconds: DEFAULT_DOCUMENT_SHARE_TTL_MS },
  { label: "7 天", milliseconds: 7 * 24 * 60 * 60_000 },
  { label: "30 天", milliseconds: 30 * 24 * 60 * 60_000 },
] as const;

export type DocumentShareStatus = "active" | "expired";
export interface DocumentShareSummary {
  expiresAt: number;
  id: string;
  status: DocumentShareStatus;
}
export interface CreatedDocumentShare extends DocumentShareSummary { url: string }
export interface SharedBlock {
  children: string[];
  content: string;
  data: BlockData | null;
  headingLevel: HeadingLevel;
  id: string;
  parentId: string | null;
  type: BlockType;
}
export interface SharedDocumentSnapshot {
  document: { blocks: SharedBlock[]; id: string; title: string };
  expiresAt: number;
}

export function resolveDocumentShareExpiresAt(value: unknown, now = Date.now()) {
  const expiresAt = value === undefined ? now + DEFAULT_DOCUMENT_SHARE_TTL_MS : value;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new TypeError("分享过期时间必须晚于当前时间");
  }
  if (expiresAt > now + MAX_DOCUMENT_SHARE_TTL_MS) {
    throw new TypeError("分享有效期不能超过 365 天");
  }
  return expiresAt;
}
```

- [ ] **Step 4：实现域隔离 HMAC 与附件签名**

`DocumentShareTokenService` 使用 `randomBytes(32)`、`createHmac("sha256")` 和 `timingSafeEqual`。附件签名的规范串固定为 `shareId\0objectKey\0expiresAt`，有效期为 `min(当前时间 + 5 分钟, 分享过期时间)`；构造器拒绝少于 32 UTF-8 字节的密钥。

- [ ] **Step 5：运行 GREEN 并提交**

Run: `pnpm test --run src/server/documentShareTokens.test.ts`

Expected: PASS。

```bash
git add src/shared/documentShare.ts src/server/documentShareTokens.ts src/server/documentShareTokens.test.ts
git commit -m "feat: add document share token primitives"
```

---

### Task 2：分享表迁移与数据库约束

**Files:**
- Modify: `src/server/database/migrations.ts`
- Modify: `src/server/database/migrations.test.ts`

- [ ] **Step 1：写迁移失败测试**

在 `migrations.test.ts` 增加用例，运行迁移两次后断言列、外键和部分唯一索引存在，并验证同一文档不能插入两个 `revoked_at IS NULL` 的链接：

```ts
it("creates idempotent document share link constraints", async () => {
  await migrateDatabase(pool);
  await migrateDatabase(pool);
  expect(await columnNames(pool, "document_share_links")).toEqual([
    "id", "workspace_id", "document_id", "token_hash", "created_by",
    "expires_at", "revoked_at", "created_at", "updated_at",
  ]);
  await seedDocumentShareFixture(pool);
  await pool.query(
    `INSERT INTO document_share_links
      (id,workspace_id,document_id,token_hash,created_by,expires_at,revoked_at,created_at,updated_at)
     VALUES ('share-1','workspace-1','document-1','hash-1','owner-1',2000,NULL,1000,1000)`,
  );
  await expect(pool.query(
    `INSERT INTO document_share_links
      (id,workspace_id,document_id,token_hash,created_by,expires_at,revoked_at,created_at,updated_at)
     VALUES ('share-2','workspace-1','document-1','hash-2','owner-1',2000,NULL,1000,1000)`,
  )).rejects.toThrow();
});
```

- [ ] **Step 2：运行迁移测试并确认 RED**

Run: `pnpm test --run src/server/database/migrations.test.ts`

Expected: FAIL，`document_share_links` 不存在。

- [ ] **Step 3：加入幂等迁移**

在 `migrations.ts` 增加迁移 ID `2026-07-21-document-share-links`，并在附件迁移后执行：

```sql
CREATE TABLE document_share_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (workspace_id, document_id)
    REFERENCES editor_documents(workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX document_share_links_active_document_idx
  ON document_share_links(workspace_id, document_id)
  WHERE revoked_at IS NULL;
CREATE INDEX document_share_links_document_history_idx
  ON document_share_links(workspace_id, document_id, created_at DESC);
```

- [ ] **Step 4：运行 GREEN 并提交**

Run: `pnpm test --run src/server/database/migrations.test.ts`

Expected: PASS。

```bash
git add src/server/database/migrations.ts src/server/database/migrations.test.ts
git commit -m "feat: add document share link schema"
```

---

### Task 3：公开快照字段白名单

**Files:**
- Create: `src/server/sharedDocumentSnapshot.ts`
- Create: `src/server/sharedDocumentSnapshot.test.ts`

- [ ] **Step 1：写清洗失败测试**

构造包含评论、负责人、任务状态、普通链接卡片、合法附件和伪造附件的文档：

```ts
it("keeps public block content and removes private task and attachment fields", () => {
  const result = createSharedDocumentSnapshot(documentFixture(), {
    expiresAt: 100_000,
    signedAttachmentUrls: new Map([
      ["workspace-1/allowed.png", "/api/shared-files/share-1/key?expiresAt=5000&signature=sig"],
    ]),
  });
  expect(result.document.blocks[0]).toEqual({
    children: [], content: "公开正文", data: null, headingLevel: 1,
    id: "paragraph-1", parentId: null, type: "paragraph",
  });
  expect(result.document.blocks[1].data).toMatchObject({
    key: "workspace-1/allowed.png",
    url: expect.stringContaining("/api/shared-files/"),
  });
  expect(result.document.blocks[2].data).toBeNull();
  expect(JSON.stringify(result)).not.toContain("评论正文");
  expect(JSON.stringify(result)).not.toContain("负责人邮箱");
  expect(JSON.stringify(result)).not.toContain("/api/files/");
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run: `pnpm test --run src/server/sharedDocumentSnapshot.test.ts`

Expected: FAIL，清洗模块不存在。

- [ ] **Step 3：实现纯函数清洗器**

`createSharedDocumentSnapshot(document, options)` 只逐项构造 `SharedBlock`，禁止对象展开整个 `Block`。对 `image/file` 仅在 `signedAttachmentUrls` 包含 `data.key` 时复制 `kind/key/mimeType/name/size` 并替换 `url`，否则将 `data` 设为 `null`；其他块数据使用 `structuredClone`，确保响应不引用原始对象。

- [ ] **Step 4：运行 GREEN 并提交**

Run: `pnpm test --run src/server/sharedDocumentSnapshot.test.ts`

Expected: PASS。

```bash
git add src/server/sharedDocumentSnapshot.ts src/server/sharedDocumentSnapshot.test.ts
git commit -m "feat: sanitize anonymously shared documents"
```

---

### Task 4：PostgreSQL 分享生命周期、审计与策略联动

**Files:**
- Create: `src/server/postgresDocumentShareStore.ts`
- Create: `src/server/postgresDocumentShareStore.test.ts`
- Create: `src/server/postgresDocumentShareStore.postgres.test.ts`
- Modify: `src/server/postgresDocumentStore.ts`
- Modify: `src/server/postgresDocumentStore.test.ts`
- Modify: `src/server/postgresAttachmentStore.ts`
- Modify: `src/server/postgresAttachmentStore.test.ts`
- Modify: `src/shared/documentAccess.ts`
- Modify: `src/server/applicationServices.ts`

- [ ] **Step 1：写生命周期失败测试**

`postgresDocumentShareStore.test.ts` 使用 pg-mem 与现有 M7.1 fixture，断言：

```ts
const created = await store.replaceManagedLink("owner-1", "public-document-1", 25 * 60 * 60_000);
expect(created.url).toBe("http://localhost:3000/share/raw-token-1");
await expect(store.getManagedLink("owner-1", "public-document-1"))
  .resolves.toMatchObject({ id: created.id, status: "active" });
await expect(store.getManagedLink("editor-1", "public-document-1"))
  .rejects.toBeInstanceOf(DocumentNotFoundError);

const replacement = await store.replaceManagedLink("owner-1", "public-document-1", 26 * 60 * 60_000);
expect(replacement.id).not.toBe(created.id);
await expect(store.loadSharedDocument("raw-token-1"))
  .rejects.toBeInstanceOf(DocumentShareGoneError);
await expect(store.loadSharedDocument("raw-token-2"))
  .resolves.toMatchObject({ document: { title: "Private document" } });

await store.revokeManagedLink("owner-1", "public-document-1");
await store.revokeManagedLink("owner-1", "public-document-1");
await expect(store.loadSharedDocument("raw-token-2"))
  .rejects.toBeInstanceOf(DocumentShareGoneError);
```

同时断言审计 JSON 不包含 `raw-token`、`/share/` 或正文。

- [ ] **Step 2：写策略联动失败测试**

先创建 `link` 策略与活动链接，再调用：

```ts
await documentStore.replaceDocumentPolicy("owner-1", "public-document-1", {
  accessMode: "private",
  permissions: [],
});
await expect(shareStore.loadSharedDocument("raw-token-1"))
  .rejects.toBeInstanceOf(DocumentShareGoneError);
```

并将 `isDocumentPolicy({ accessMode: "link", permissions: [] })` 的预期改为 `true`。

- [ ] **Step 3：运行测试并确认 RED**

Run: `pnpm test --run src/server/postgresDocumentShareStore.test.ts src/server/postgresDocumentStore.test.ts src/app/api/documents/handlers.test.ts`

Expected: FAIL，分享存储不存在，`link` 策略仍被拒绝。

- [ ] **Step 4：实现分享存储**

`PostgresDocumentShareStore` 固定暴露：

```ts
export class DocumentShareNotFoundError extends Error {}
export class DocumentShareGoneError extends Error {}

export class PostgresDocumentShareStore {
  getManagedLink(userId: string, publicId: string): Promise<DocumentShareSummary | null>;
  replaceManagedLink(userId: string, publicId: string, expiresAt?: number): Promise<CreatedDocumentShare>;
  revokeManagedLink(userId: string, publicId: string): Promise<void>;
  loadSharedDocument(rawToken: string): Promise<SharedDocumentSnapshot>;
  loadSharedAttachment(input: {
    expiresAt: number; keyToken: string; shareId: string; signature: string;
  }): Promise<{ body: Uint8Array; contentType: string; size: number }>;
}
```

管理方法先调用 `DocumentAuthorizationService.requireUserAction(userId, publicId, "manage")`。替换事务执行 `UPDATE ... SET revoked_at = now`、写 `document_share.regenerated` 或 `created` 审计、插入新记录，最后仅用原始令牌拼装一次 URL。关闭使用 `UPDATE ... WHERE revoked_at IS NULL RETURNING id`，无返回时仍成功。

匿名读取按 `token_hash` 联结工作区和文档；未知记录抛 `DocumentShareNotFoundError`，已撤销、已过期或工作区删除抛 `DocumentShareGoneError`。读取块和附件后调用 Task 3 的清洗器。成功读取写 `document_share.accessed`；能匹配分享记录的过期或撤销访问写 `document_share.access_denied` 并记录脱敏原因；完全未知的 token 不写工作区审计。附件成功与已知拒绝分别写 `document_share_attachment.accessed` 和 `document_share_attachment.access_denied`，metadata 只使用分享 ID、文档 ID、结果、原因与时间。

- [ ] **Step 5：扩展附件查询与策略撤销**

为 `PostgresAttachmentStore` 增加 `listDocumentAttachments(workspaceId, documentId)` 与 `findDocumentAttachment(key, workspaceId, documentId)`，SQL 必须同时匹配三个字段。

在 `replaceDocumentPolicy` 的现有事务内，当 `policy.accessMode !== "link"` 时执行：

```sql
UPDATE document_share_links
SET revoked_at = $1, updated_at = $1
WHERE workspace_id = $2 AND document_id = $3 AND revoked_at IS NULL
RETURNING id
```

若返回记录，使用 `WorkspaceAuditStore` 写 `document_share.revoked`，metadata 仅为 `{ reason: "policy-changed", shareId }`。`src/shared/documentAccess.ts` 的 `isDocumentPolicy` 改为调用 `isDocumentAccessMode`，允许 `link`。

- [ ] **Step 6：组装服务并运行 GREEN**

`applicationServices.ts` 使用 `AUTH_HASH_SECRET` 创建 `DocumentShareTokenService`，开发环境保持与邀请服务相同的 32 字节兜底，生产环境缺失时拒绝启动。创建一个 `objectStorage` 实例并注入分享存储及清理服务。

Run: `pnpm test --run src/server/postgresDocumentShareStore.test.ts src/server/postgresDocumentStore.test.ts src/server/postgresAttachmentStore.test.ts src/app/api/documents/handlers.test.ts`

Expected: PASS。

- [ ] **Step 7：增加真实 PostgreSQL 并发约束测试**

`postgresDocumentShareStore.postgres.test.ts` 在独立测试 schema 中并发执行两个 `replaceManagedLink`，断言最终只有一条 `revoked_at IS NULL`；旧 token 返回 gone，新 token 可读。复用现有 `TEST_DATABASE_URL` 与迁移测试模式。

Run: `pnpm test:postgres -- src/server/postgresDocumentShareStore.postgres.test.ts`

Expected: PASS；若命令因当前脚本包含全部 PostgreSQL 测试，则报告全部文件结果。

- [ ] **Step 8：提交**

```bash
git add src/shared/documentAccess.ts src/server/applicationServices.ts src/server/postgresDocumentShareStore.ts src/server/postgresDocumentShareStore.test.ts src/server/postgresDocumentShareStore.postgres.test.ts src/server/postgresDocumentStore.ts src/server/postgresDocumentStore.test.ts src/server/postgresAttachmentStore.ts src/server/postgresAttachmentStore.test.ts src/app/api/documents/handlers.test.ts
git commit -m "feat: persist document share lifecycle"
```

---

### Task 5：管理 API 与前端仓库

**Files:**
- Create: `src/app/api/document-share-links/handlers.ts`
- Create: `src/app/api/document-share-links/handlers.test.ts`
- Create: `src/app/api/documents/[documentId]/share-links/route.ts`
- Create: `src/features/editor/persistence/documentShareRepository.ts`
- Create: `src/features/editor/persistence/documentShareRepository.test.ts`

- [ ] **Step 1：写管理 API 失败测试**

处理器测试覆盖未登录 `401`、非 owner `404`、无效时间 `400`、GET 不返回 URL、POST 返回一次 URL、DELETE 幂等：

```ts
const response = await handlers.POST(
  jsonRequest({ expiresAt: 86_401_000 }),
  "public-document-1",
);
expect(response.status).toBe(201);
await expect(response.json()).resolves.toEqual({
  shareLink: {
    expiresAt: 86_401_000,
    id: "share-1",
    status: "active",
    url: "http://localhost/share/raw-token",
  },
});
expect(store.replaceManagedLink).toHaveBeenCalledWith(
  "owner-1", "public-document-1", 86_401_000,
);
```

- [ ] **Step 2：写前端仓库失败测试**

断言编码文档 ID 和三个方法的 HTTP 语义：

```ts
await repository.load("public/document-1");
await repository.create("public/document-1", 86_401_000);
await repository.revoke("public/document-1");
expect(fetchSpy).toHaveBeenNthCalledWith(
  2,
  "/api/documents/public%2Fdocument-1/share-links",
  expect.objectContaining({
    body: JSON.stringify({ expiresAt: 86_401_000 }),
    method: "POST",
  }),
);
```

- [ ] **Step 3：运行 RED**

Run: `pnpm test --run src/app/api/document-share-links/handlers.test.ts src/features/editor/persistence/documentShareRepository.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4：实现处理器、路由与仓库**

处理器依赖 `authStore` 与 `documentShareStore`，使用现有 `getSessionToken`。POST 只接受对象体及可选 `expiresAt`，时间验证委托存储的共享验证函数。错误映射固定为：未认证 `401`、`DocumentNotFoundError`/`DocumentShareNotFoundError` `404`、`TypeError` `400`。

路由使用 `hasDatabaseConfiguration()` 和 `createPostgresServices()`，导出 `GET/POST/DELETE`。仓库使用 `requestJson` 与 `jsonRequest`，DELETE 接受 `204` 时需要扩展或绕过 `requestJson`，不得对空响应执行 `response.json()`。

- [ ] **Step 5：运行 GREEN 并提交**

Run: `pnpm test --run src/app/api/document-share-links/handlers.test.ts src/features/editor/persistence/documentShareRepository.test.ts`

Expected: PASS。

```bash
git add src/app/api/document-share-links src/app/api/documents/[documentId]/share-links src/features/editor/persistence/documentShareRepository.ts src/features/editor/persistence/documentShareRepository.test.ts
git commit -m "feat: expose document share management api"
```

---

### Task 6：匿名文档 API 与签名附件代理

**Files:**
- Create: `src/app/api/shared-documents/handlers.ts`
- Create: `src/app/api/shared-documents/handlers.test.ts`
- Create: `src/app/api/shared-documents/[token]/route.ts`
- Create: `src/app/api/shared-files/handlers.ts`
- Create: `src/app/api/shared-files/handlers.test.ts`
- Create: `src/app/api/shared-files/[shareId]/[keyToken]/route.ts`

- [ ] **Step 1：写匿名文档 API 失败测试**

```ts
it.each([
  [new DocumentShareNotFoundError(), 404],
  [new DocumentShareGoneError(), 410],
])("maps anonymous share failures without leaking document data", async (error, status) => {
  store.loadSharedDocument.mockRejectedValue(error);
  const response = await handlers.GET("raw-token");
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});
```

成功响应只断言 `SharedDocumentSnapshot` 白名单字段。

- [ ] **Step 2：写附件代理失败测试**

使用内存对象结果，覆盖成功 MIME/长度、签名篡改 `404`、已撤销/过期 `410`、对象不存在 `404`。所有响应包含 `Cache-Control: no-store`。

- [ ] **Step 3：运行 RED**

Run: `pnpm test --run src/app/api/shared-documents/handlers.test.ts src/app/api/shared-files/handlers.test.ts`

Expected: FAIL，匿名处理器尚不存在。

- [ ] **Step 4：实现公开处理器与路由**

`shared-documents` 处理器不读取 Cookie，直接调用 `loadSharedDocument(token)`。成功、`404`、`410`、`503` 都设置 `no-store` 与 `no-referrer`。

附件路由接收 `shareId`、Base64URL 编码的 `keyToken`、`expiresAt` 和 `signature`；先做字符串与安全整数校验，再调用 `loadSharedAttachment`。禁止把解码后的 object key、token 或签名写入错误正文。

- [ ] **Step 5：运行 GREEN 并提交**

Run: `pnpm test --run src/app/api/shared-documents/handlers.test.ts src/app/api/shared-files/handlers.test.ts src/server/postgresDocumentShareStore.test.ts`

Expected: PASS。

```bash
git add src/app/api/shared-documents src/app/api/shared-files
git commit -m "feat: serve anonymous documents and attachments"
```

---

### Task 7：匿名只读页面

**Files:**
- Create: `src/features/editor/components/shared/SharedDocumentClient.tsx`
- Create: `src/features/editor/components/shared/SharedDocumentClient.test.tsx`
- Create: `src/app/share/[token]/page.tsx`

- [ ] **Step 1：写组件失败测试**

测试 mock `fetch`，验证加载、成功、`404`、`410` 和失败重试。成功页面必须有文档标题和块正文，但没有以下入口：

```ts
expect(screen.getByRole("heading", { name: "公开方案" })).toBeInTheDocument();
expect(screen.getByText("公开正文")).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "分享" })).not.toBeInTheDocument();
expect(screen.queryByText("协同已连接")).not.toBeInTheDocument();
expect(screen.queryByText("插入标题、待办、引用或协作评论")).not.toBeInTheDocument();
```

- [ ] **Step 2：运行 RED**

Run: `pnpm test --run src/features/editor/components/shared/SharedDocumentClient.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3：实现只读页面**

`page.tsx` 只解析 `token` 并渲染 `<SharedDocumentClient token={token} />`。客户端请求 `/api/shared-documents/${encodeURIComponent(token)}`，把 `SharedBlock` 映射为只读 `Block` 时补充安全默认值：`comments: []`、`assignee: ""`、`checked: false`、`dueDate: ""`、`status: "unset"`、时间戳 `0`。

布局使用现有 `.document` 和 `BlockList`，但不渲染 `DocumentTopbar`、侧栏、Slash 提示或协作 hooks。传入 `isReadOnly={true}`、`collaborationDocument={null}`、`sessionUser={null}`，所有变更回调为模块级 no-op 函数，避免每次渲染创建新引用。

`404` 显示“分享链接不存在”，`410` 显示“分享链接已失效”，均不显示文档标题。

- [ ] **Step 4：运行 GREEN、构建并提交**

Run: `pnpm test --run src/features/editor/components/shared/SharedDocumentClient.test.tsx`

Expected: PASS。

Run: `pnpm build`

Expected: PASS，并列出 `/share/[token]`、匿名文档和附件动态路由。

```bash
git add src/features/editor/components/shared src/app/share
git commit -m "feat: add anonymous read-only document page"
```

---

### Task 8：分享面板链接生命周期 UI

**Files:**
- Modify: `src/features/editor/components/document/SharePopover.tsx`
- Modify: `src/features/editor/components/document/SharePopover.test.tsx`

- [ ] **Step 1：写 UI 失败测试**

扩展 mock，覆盖：

```ts
expect(await screen.findByRole("radio", { name: "拥有链接的人可查看" })).toBeInTheDocument();
await user.click(screen.getByRole("radio", { name: "拥有链接的人可查看" }));
await user.selectOptions(screen.getByRole("combobox", { name: "链接有效期" }), "86400000");
await user.click(screen.getByRole("button", { name: "创建分享链接" }));
expect(shareRepository.create).toHaveBeenCalledWith(
  "public-document-1",
  expect.any(Number),
);
expect(await screen.findByRole("textbox", { name: "分享链接" }))
  .toHaveValue("http://localhost/share/raw-token");
```

再覆盖刷新后 GET 只有状态时复制按钮不可用、重新生成返回新 URL、关闭后状态清空、自定义时间晚于当前且不超过 365 天、切换到 private 时调用策略更新并使链接区域关闭。

- [ ] **Step 2：运行 RED**

Run: `pnpm test --run src/features/editor/components/document/SharePopover.test.tsx`

Expected: FAIL，界面没有 `link` 模式与生命周期控件。

- [ ] **Step 3：实现面板**

`ACCESS_MODE_OPTIONS` 增加 `Link2` 图标和 `link` 选项。owner 加载策略后并行加载分享摘要；仅 `link` 模式显示有效期区域。

有效期使用带标签的 `<select>` 提供 1 小时、24 小时、7 天、30 天、自定义；默认 24 小时。自定义使用 `input type="datetime-local"`。创建、复制、重新生成、关闭按钮分别使用 `Link2`、`Copy`、`RefreshCw`、`Unlink` 图标并提供明确 `aria-label`。

完整 URL 只存组件 `createdUrl` state；摘要 GET 不包含 URL时复制按钮 disabled。所有网络操作共享一个 `isSaving` 锁和面板内错误状态，成功后刷新摘要。

- [ ] **Step 4：运行 GREEN、相关回归并提交**

Run: `pnpm test --run src/features/editor/components/document/SharePopover.test.tsx src/features/editor/persistence/documentShareRepository.test.ts src/app/api/documents/handlers.test.ts`

Expected: PASS。

```bash
git add src/features/editor/components/document/SharePopover.tsx src/features/editor/components/document/SharePopover.test.tsx
git commit -m "feat: manage anonymous links from share dialog"
```

---

### Task 9：M7.2 E2E、文档与完整验证

**Files:**
- Create: `e2e/document-sharing.spec.ts`
- Modify: `docs/m7-status-zh.md`
- Modify: `docs/prd.md`
- Modify: `README.md`

- [ ] **Step 1：写 Playwright 失败验收**

用 owner 注册并进入文档，通过分享面板创建默认 24 小时链接。新匿名 context 打开链接并断言标题、正文、只读状态和无管理入口。通过 API 上传一个小文件、保存附件块，再断言匿名附件可读。

测试继续执行：重新生成后旧页面/API/附件 URL 返回 `410`，新链接可读；关闭后新链接与新附件 URL 返回 `410`。另一个用例选择自定义时间并断言面板显示准确时间。

- [ ] **Step 2：运行 E2E 并确认 RED**

Run: `pnpm exec playwright test e2e/document-sharing.spec.ts`

Expected: 在当前生产服务未重建时 FAIL；若使用开发服务，则在实现缺口处 FAIL。记录第一条真实失败，不用增加任意等待。

- [ ] **Step 3：修正只由 E2E 暴露的集成缺口**

只修改对应 M7.2 模块；等待网络操作使用 `waitForResponse` 或可见状态，不使用固定 `waitForTimeout`。每个产品代码修复前先把失败缩小为单元或处理器回归测试，再实施最小修复。

- [ ] **Step 4：运行 M7.2 定向验证**

Run:

```bash
pnpm test --run \
  src/server/documentShareTokens.test.ts \
  src/server/sharedDocumentSnapshot.test.ts \
  src/server/postgresDocumentShareStore.test.ts \
  src/app/api/document-share-links/handlers.test.ts \
  src/app/api/shared-documents/handlers.test.ts \
  src/app/api/shared-files/handlers.test.ts \
  src/features/editor/persistence/documentShareRepository.test.ts \
  src/features/editor/components/document/SharePopover.test.tsx \
  src/features/editor/components/shared/SharedDocumentClient.test.tsx
pnpm exec playwright test e2e/document-sharing.spec.ts e2e/document-permissions.spec.ts
```

Expected: 全部 PASS。

- [ ] **Step 5：运行完整验证**

Run:

```bash
pnpm test --run
pnpm test:postgres
pnpm build
pnpm test:e2e
```

Expected: 单元、PostgreSQL、构建和 M7.2/M7.1 E2E PASS。完整 E2E 若仍存在用户已暂停的 M6 基线失败，逐项记录实际数量和名称，不把它们误报为 M7.2 回归，也不声明完整发布验收通过。

- [ ] **Step 6：更新中文状态文档**

只有上述定向验证通过后，更新 `docs/m7-status-zh.md`、`docs/prd.md` 和 `README.md`：列出默认 24 小时、自定义上限 365 天、撤销/重新生成、匿名只读、附件签名代理、审计及实际测试结果。完整 E2E 未通过时保留明确阻塞说明。

- [ ] **Step 7：提交与工作区检查**

```bash
git add e2e/document-sharing.spec.ts docs/m7-status-zh.md docs/prd.md README.md
git commit -m "test: verify M7.2 anonymous sharing"
git status --short --branch
git log -10 --oneline
```

Expected: 工作区干净，M7.2 提交按任务分离，未夹带暂停的 M6 E2E 修复。
