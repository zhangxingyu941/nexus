# M7.1 文档权限实施计划

> **面向代理执行者：** 必须使用子技能：以逐任务方式实施本计划时，使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。所有步骤均以复选框（`- [ ]`）跟踪。

**目标：** 增加直接文档路由和服务端强制执行的私有/团队文档权限，阻断通过工作区、文件、历史或协作通道读取或写入私有内容的路径。

**架构：** 使用唯一的 `DocumentAuthorizationService`，按文档策略、作者、工作区成员关系和显式授权为所有受保护资源解析权限。数据库模式下，内容读取和保存从工作区全量快照迁移为文档级 API；工作区 API 只保留目录、成员和生命周期职责。

**技术栈：** Next.js 15 Route Handlers、React 18、TypeScript、PostgreSQL（`pg`）、Vitest、Playwright、Yjs。

---

## 范围与文件

- 新建 `src/shared/documentAccess.ts`：文档模式、显式角色、解析后权限的共享类型。
- 新建 `src/server/documentAuthorization.ts`：唯一授权解析器及其单元测试。
- 新建 `src/server/postgresDocumentStore.ts`：文档目录、文档快照和权限策略的 PostgreSQL 存储及测试。
- 新建 `src/app/api/documents/**`：文档读取/保存和策略读取/更新 API 与测试。
- 新建 `src/features/editor/persistence/documentRepository.ts`：浏览器端文档 API 客户端与测试。
- 新建 `src/app/documents/[documentId]/**`：直接文档路由、加载和无权状态。
- 修改 `migrations.ts`、`applicationServices.ts`、`postgresWorkspaceStore.ts`：策略迁移、服务图和旧工作区快照保护。
- 修改 `useWorkspaceSession.ts`、`WorkspaceShell.tsx`、`EditorPage.tsx`、`SharePopover.tsx`：仅保存活动文档，并显示服务端策略。
- 修改文件、历史和协作授权入口：统一调用文档授权服务。
- 新建 `e2e/document-permissions.spec.ts`：浏览器验收覆盖。

### 任务 1：定义共享类型并加入策略迁移

**文件：**
- 新建：`src/shared/documentAccess.ts`
- 新建：`src/shared/documentAccess.test.ts`
- 修改：`src/server/database/migrations.ts`
- 修改：`src/server/database/migrations.test.ts`

- [ ] **步骤 1：写失败的类型测试**

```ts
import { describe, expect, it } from "vitest";
import { isDocumentAccessMode, isDocumentPermissionRole } from "./documentAccess";

describe("document access contracts", () => {
  it("accepts only persisted policy values", () => {
    expect(isDocumentAccessMode("workspace")).toBe(true);
    expect(isDocumentAccessMode("private")).toBe(true);
    expect(isDocumentAccessMode("link")).toBe(true);
    expect(isDocumentAccessMode("public")).toBe(false);
    expect(isDocumentPermissionRole("editor")).toBe(true);
    expect(isDocumentPermissionRole("owner")).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/shared/documentAccess.test.ts`

预期：因模块不存在而失败。

- [ ] **步骤 3：实现共享契约**

```ts
export const DOCUMENT_ACCESS_MODES = ["workspace", "private", "link"] as const;
export const DOCUMENT_PERMISSION_ROLES = ["editor", "viewer"] as const;
export type DocumentAccessMode = (typeof DOCUMENT_ACCESS_MODES)[number];
export type DocumentPermissionRole = (typeof DOCUMENT_PERMISSION_ROLES)[number];
export type DocumentAction = "read" | "write" | "manage";

export interface DocumentAccess {
  accessMode: DocumentAccessMode;
  canManage: boolean;
  canRead: boolean;
  canWrite: boolean;
  documentId: string;
  role: "owner" | "editor" | "viewer" | "none";
  source: "workspace-owner" | "author" | "explicit" | "workspace";
  workspaceId: string;
}
```

- [ ] **步骤 4：写失败的迁移测试**

```ts
it("adds document ownership and permissions idempotently", async () => {
  await migrateDatabase(pool);
  await migrateDatabase(pool);
  const columns = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'editor_documents'",
  );
  expect(columns.rows.map((row) => row.column_name)).toEqual(
    expect.arrayContaining(["access_mode", "created_by"]),
  );
});
```

- [ ] **步骤 5：实现 M7.1 迁移**

在 `WORKSPACE_SOFT_DELETION_MIGRATION_ID` 后加入 `2026-07-20-document-permissions`。迁移必须：

1. 给 `editor_documents` 增加 `created_by` 和 `access_mode`，默认模式为 `workspace`。
2. 通过 `workspace_members` 中按 `created_at, user_id` 排序的最早 owner 回填历史文档作者，再将 `created_by` 设为非空外键；不恢复单一 `owner_id`。
3. 创建 `document_permissions`，主键为 `(workspace_id, document_id, user_id)`，角色仅允许 `editor` 和 `viewer`。
4. 使用现有迁移锁、事务和 `schema_migrations` 记录模式，重复运行不得失败。

- [ ] **步骤 6：验证 GREEN 并提交**

运行：`pnpm test --run src/shared/documentAccess.test.ts src/server/database/migrations.test.ts`

预期：所有测试通过，且重复迁移通过。

运行：`git add src/shared/documentAccess.ts src/shared/documentAccess.test.ts src/server/database/migrations.ts src/server/database/migrations.test.ts`，再运行 `git commit -m "feat: add document permission schema"`。

### 任务 2：实现唯一文档授权服务

**文件：**
- 新建：`src/server/documentAuthorization.ts`
- 新建：`src/server/documentAuthorization.test.ts`
- 修改：`src/server/applicationServices.ts`
- 修改：`src/server/applicationServices.test.ts`

- [ ] **步骤 1：写失败的权限优先级矩阵**

```ts
it.each([
  ["owner", "private", "owner", true, true, true],
  ["author", "private", "editor", true, true, false],
  ["explicit viewer", "private", "viewer", true, false, false],
  ["workspace editor", "workspace", "editor", true, true, false],
  ["workspace editor", "private", "none", false, false, false],
])("resolves %s access", async (_label, accessMode, role, canRead, canWrite, canManage) => {
  const service = new DocumentAuthorizationService({
    findRecord: vi.fn().mockResolvedValue({ accessMode, role }),
  });
  await expect(service.resolveUserAccess("user-1", "document-1")).resolves.toMatchObject({
    canManage, canRead, canWrite, documentId: "document-1",
  });
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/server/documentAuthorization.test.ts`

预期：因 `DocumentAuthorizationService` 不存在而失败。

- [ ] **步骤 3：实现解析和动作授权**

```ts
export class DocumentNotFoundError extends Error {}

export class DocumentAuthorizationService {
  constructor(private readonly records: DocumentAuthorizationRecords) {}

  async requireUserAction(userId: string, documentId: string, action: DocumentAction) {
    const access = await this.resolveUserAccess(userId, documentId);
    if (!access.canRead || (action === "write" && !access.canWrite) || (action === "manage" && !access.canManage)) {
      throw new DocumentNotFoundError();
    }
    return access;
  }
}
```

实现一条记录查询，关联文档、未删除工作区、成员关系及可选显式权限。在 TypeScript 中按 owner、作者、显式授权、工作区继承的顺序解析，而不是在各 API 中复制 SQL。`createPostgresServices` 暴露同一服务实例给文档、文件、历史和协作调用方。

- [ ] **步骤 4：验证 GREEN 并提交**

运行：`pnpm test --run src/server/documentAuthorization.test.ts src/server/applicationServices.test.ts`

预期：所有优先级分支通过。

运行：`git add src/server/documentAuthorization.ts src/server/documentAuthorization.test.ts src/server/applicationServices.ts src/server/applicationServices.test.ts`，再运行 `git commit -m "feat: add document authorization service"`。

### 任务 3：实现文档级 PostgreSQL 存储

**文件：**
- 新建：`src/server/postgresDocumentStore.ts`
- 新建：`src/server/postgresDocumentStore.test.ts`
- 修改：`src/server/postgresWorkspaceStore.ts`
- 修改：`src/server/postgresWorkspaceStore.test.ts`

- [ ] **步骤 1：写失败的数据边界测试**

```ts
it("omits a private document from an ungranted workspace member catalog", async () => {
  await seedDocument(pool, {
    accessMode: "private",
    createdBy: "author-1",
    documentId: "private-1",
    workspaceId: "workspace-1",
  });
  await seedMembership(pool, "workspace-1", "editor-1", "editor");
  await expect(store.listAccessibleDocuments("editor-1", "workspace-1")).resolves.toEqual([]);
});

it("rejects a viewer snapshot write without revealing its title", async () => {
  await expect(store.saveDocument("viewer-1", "private-1", snapshot))
    .rejects.toBeInstanceOf(DocumentNotFoundError);
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/server/postgresDocumentStore.test.ts`

预期：因 `PostgresDocumentStore` 不存在而失败。

- [ ] **步骤 3：实现文档读取、保存和策略替换**

```ts
async loadDocument(userId: string, documentId: string) {
  const access = await this.authorization.requireUserAction(userId, documentId, "read");
  return { access, document: await this.readDocumentSnapshot(access.workspaceId, documentId) };
}

async saveDocument(userId: string, documentId: string, document: EditorDocument) {
  const access = await this.authorization.requireUserAction(userId, documentId, "write");
  if (document.id !== documentId) throw new DocumentValidationError("文档标识不正确");
  await this.replaceDocumentSnapshot(access.workspaceId, document, userId);
  return this.loadDocument(userId, documentId);
}
```

策略替换在 owner 的 `manage` 权限校验后放入单个事务。工作区目录只返回用户可访问的文档元数据；数据库模式的旧全量工作区保存拒绝包含不可访问文档的负载。本地 IndexedDB 行为不变。

- [ ] **步骤 4：验证 GREEN 并提交**

运行：`pnpm test --run src/server/postgresDocumentStore.test.ts src/server/postgresWorkspaceStore.test.ts`

预期：未获授权成员的目录没有私有文档标题或块内容。

运行：`git add src/server/postgresDocumentStore.ts src/server/postgresDocumentStore.test.ts src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts`，再运行 `git commit -m "feat: add authorized document persistence"`。

### 任务 4：新增文档和权限策略 API

**文件：**
- 新建：`src/app/api/documents/handlers.ts`、对应测试
- 新建：`src/app/api/documents/[documentId]/route.ts`
- 新建：`src/app/api/documents/[documentId]/permissions/route.ts`

- [ ] **步骤 1：写失败的 HTTP 测试**

```ts
it("returns a generic 404 for an ungranted private document", async () => {
  const response = await handlers.GET(requestWithSession("editor-1"), "private-1");
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "文档不存在或无权访问" });
});

it("allows only an owner to replace a document policy", async () => {
  const response = await handlers.PATCHPermissions(
    requestWithSession("editor-1", { accessMode: "private", permissions: [] }),
    "document-1",
  );
  expect(response.status).toBe(404);
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/app/api/documents/handlers.test.ts`

预期：处理器模块不存在而失败。

- [ ] **步骤 3：实现路由和输入验证**

```ts
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { documentId } = await params;
  return createDocumentRouteHandlers(createPostgresServices()).GET(request, documentId);
}
```

`PUT` 只接收 `{ document }`；策略 PATCH 只接收 `{ accessMode, permissions }`；角色必须用 `isDocumentPermissionRole` 验证；禁止客户端提交 `workspaceId`。`DocumentNotFoundError` 统一返回不泄露资源存在性的 404。

- [ ] **步骤 4：验证 GREEN 并提交**

运行：`pnpm test --run src/app/api/documents/handlers.test.ts`

预期：未认证 401、无权 404、editor 保存、viewer 拒绝写入、owner 策略替换均通过。

运行：`git add src/app/api/documents`，再运行 `git commit -m "feat: add document permission APIs"`。

### 任务 5：迁移数据库模式会话和直接文档路由

**文件：**
- 新建：`src/features/editor/persistence/documentRepository.ts`、对应测试
- 修改：`workspaceRepository.ts`、`remoteWorkspaceRepository.ts`
- 修改：`useWorkspaceSession.ts`、`WorkspaceShell.tsx` 及测试
- 新建：`src/app/documents/[documentId]/page.tsx`、`DocumentRouteClient.tsx` 及测试

- [ ] **步骤 1：写失败的文档请求测试**

```ts
it("loads and saves one document without calling a workspace snapshot endpoint", async () => {
  await repository.load("document/a");
  await repository.save("document/a", document);
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "/api/documents/document%2Fa",
    expect.objectContaining({ method: "GET" }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "/api/documents/document%2Fa",
    expect.objectContaining({ method: "PUT" }),
  );
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/features/editor/persistence/documentRepository.test.ts src/features/editor/session/useWorkspaceSession.test.tsx`

预期：远端会话仍使用工作区全量保存而失败。

- [ ] **步骤 3：实现文档仓库和活动文档保存边界**

```ts
export function createDocumentRepository(): DocumentRepository {
  return {
    load: (documentId) => requestJson(documentUrl(documentId), jsonRequest("GET")),
    save: (documentId, document) => requestJson(documentUrl(documentId), jsonRequest("PUT", { document })),
    updatePolicy: (documentId, policy) => requestJson(permissionUrl(documentId), jsonRequest("PATCH", policy)),
  };
}
```

数据库模式的 `useWorkspaceSession` 必须维护 `activeDocumentId`、`activeDocument` 和 `DocumentAccess`。防抖保存只发活动文档；收到 404 后丢弃该文档并刷新可访问目录。直接路由对 401 显示现有认证流，对 404 只显示 `文档不可用`。

- [ ] **步骤 4：验证 GREEN 并提交**

运行：`pnpm test --run src/features/editor/persistence/documentRepository.test.ts src/features/editor/session/useWorkspaceSession.test.tsx src/features/editor/components/WorkspaceShell.test.tsx src/app/documents/[documentId]/DocumentRouteClient.test.tsx`

预期：远端输入不再发送 `PUT /api/workspaces/:workspaceId`。

运行：`git add src/features/editor/persistence src/features/editor/session src/features/editor/components/WorkspaceShell.tsx src/app/documents`，再运行 `git commit -m "feat: load remote documents by permission"`。

### 任务 6：收敛文件、历史、协作和 UI 授权

**文件：**
- 修改：`src/app/api/files/handlers.ts`、对应测试
- 修改：`src/app/api/workspaces/[workspaceId]/history/[documentId]/handlers.ts`、对应测试
- 修改：`src/server/collaborationAuthorization.ts`、对应测试
- 修改：`src/features/editor/components/EditorPage.tsx`
- 修改：`src/features/editor/components/document/SharePopover.tsx`、新增测试

- [ ] **步骤 1：写失败的跨资源授权测试**

```ts
it("does not serve an attachment for a private document to an ungranted editor", async () => {
  const response = await fileHandlers.GET(
    requestWithSession("editor-1"),
    "workspace-1/private-document/file.png",
  );
  expect(response.status).toBe(404);
});

it("rejects an explicit document viewer before preparing a Yjs room", async () => {
  await expect(authorizeCollaborationRequest(viewerRequest, dependencies))
    .resolves.toMatchObject({ ok: false, status: 403 });
});
```

- [ ] **步骤 2：运行测试，确认 RED**

运行：`pnpm test --run src/app/api/files/handlers.test.ts src/server/collaborationAuthorization.test.ts src/server/collaborationServer.test.ts`

预期：当前工作区成员关系会错误放行，测试失败。

- [ ] **步骤 3：按文档和动作统一授权**

上传时保存附件到文档映射；下载根据附件映射调用 `requireUserAction(userId, documentId, "read")`。历史读取要求 `read`，恢复要求 `write`。协作房间验证后要求 `write`，并校验 room 的工作区等于解析权限中的工作区。显式 viewer 与工作区 viewer 均不能加入可写 Yjs 房间。

```ts
const access = await documentAuthorization.requireUserAction(
  user.id,
  attachment.documentId,
  requireWrite ? "write" : "read",
);
if (access.workspaceId !== attachment.workspaceId) throw new DocumentNotFoundError();
```

`SharePopover` 改为读取服务端策略：仅 owner 看见并可修改私有/团队模式和显式成员；PATCH 成功后才更新 UI 状态。

- [ ] **步骤 4：验证 GREEN 并提交**

运行：`pnpm test --run src/app/api/files/handlers.test.ts src/app/api/workspaces/[workspaceId]/history/[documentId]/handlers.test.ts src/server/collaborationAuthorization.test.ts src/server/collaborationServer.test.ts src/features/editor/components/document/SharePopover.test.tsx`

预期：同一私有文档在文件、历史、WebSocket 和 UI 上得到一致判定。

运行：`git add src/app/api/files src/app/api/workspaces/[workspaceId]/history src/server/collaborationAuthorization.ts src/server/collaborationServer.test.ts src/features/editor/components/EditorPage.tsx src/features/editor/components/document/SharePopover.tsx`，再运行 `git commit -m "feat: enforce document access across resources"`。

### 任务 7：浏览器验收与发布验证

**文件：**
- 新建：`e2e/document-permissions.spec.ts`
- 修改：`e2e/workspaces.spec.ts`、`e2e/collaboration.spec.ts`
- 修改：`README.md`、`docs/prd.md`

- [ ] **步骤 1：写失败的私有文档 E2E 场景**

```ts
test("an ungranted editor cannot discover or write a private document", async ({ browser }) => {
  const owner = await signIn(browser, "owner@example.com");
  const editor = await signIn(browser, "editor@example.com");
  const privateDocument = await createPrivateDocument(owner, "预算草案");

  await editor.goto(documentPath(privateDocument.id));

  await expect(editor.getByRole("alert")).toHaveText("文档不可用");
  await expect(editor.getByText("预算草案")).toHaveCount(0);
});
```

- [ ] **步骤 2：运行 E2E，确认 RED**

运行：`pnpm test:e2e -- e2e/document-permissions.spec.ts`

预期：M7.1 路由、策略和资源保护尚未完整实现，测试失败。

- [ ] **步骤 3：补齐验收场景**

新增显式 editor 授权、显式 viewer 写入被拒、直接路由刷新、附件/历史隔离、撤销授权后协作会话关闭等场景。E2E 只能通过现有 `e2e/support.ts` 登录和 UI/API 流程建立状态，不能借助未公开的 localStorage。

- [ ] **步骤 4：运行完整验证**

```bash
pnpm test --run
pnpm test:postgres
pnpm test:e2e
pnpm build
```

预期：单元测试通过；配置 `TEST_DATABASE_URL` 后 PostgreSQL 测试实际运行而非跳过；Docker 服务栈上的浏览器用例通过；停止开发服务后生产构建退出码为 0。

- [ ] **步骤 5：更新状态文档并提交**

仅在完整验证全部通过后，将 M7.1 标记为已交付。M7.2 的令牌化匿名分享、过期时间和签名附件 URL 必须保持明确未完成。

运行：`git add e2e README.md docs/prd.md`，再运行 `git commit -m "test: verify document permission boundaries"`。

## 计划自检

- 覆盖性：任务 1-4 实现策略结构、统一授权、文档 API 和目录过滤；任务 5-6 移除数据库模式的工作区全量绕过，并收敛 UI、文件、历史和 Yjs 授权；任务 7 覆盖浏览器和真实环境验收。
- 范围边界：分享令牌、匿名 `/share/:token`、过期时间和签名附件 URL 不在本计划内，将在 M7.1 完成后以独立 M7.2 计划实施。
- 类型一致性：计划统一使用 `DocumentAccess`、`DocumentAccessMode`、`DocumentPermissionRole`、`DocumentAuthorizationService`、`PostgresDocumentStore` 和 `DocumentRepository`。
