# M6 多工作区基础实施计划

> **致智能代理工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**Goal:** 在数据库模式和浏览器本地模式中交付可创建、搜索、切换和 owner 重命名的多工作区基础，并让内容、成员、历史、文件和协同请求显式绑定 `workspaceId`。

**Architecture:** `EditorApp` 只选择运行模式，`WorkspaceShell + useWorkspaceSession` 统一持有目录、当前快照和保存屏障，受控 `EditorPage` 只编辑一个明确 ID 的工作区。数据库模式通过显式作用域 REST API 访问 PostgreSQL；本地模式通过实现同一仓储契约的 IndexedDB v2 访问浏览器数据，二者不在运行时互相回退。

**Tech Stack:** Next.js 15、React 18、TypeScript、PostgreSQL 16、IndexedDB/idb、Yjs/y-websocket、Vitest、Testing Library、Playwright。

---

## 文件结构

### 新建

- `src/shared/workspace.ts`：共享工作区类型、名称校验和目录排序。
- `src/shared/workspace.test.ts`：共享契约单元测试。
- `src/features/editor/persistence/workspaceRepository.ts`：客户端工作区仓储接口和工厂输入类型。
- `src/features/editor/persistence/localWorkspaceRepository.ts`：IndexedDB v2 实现和旧数据迁移。
- `src/features/editor/persistence/localWorkspaceRepository.test.ts`：本地目录、迁移和隔离测试。
- `src/features/editor/persistence/remoteWorkspaceRepository.ts`：显式 REST API 客户端。
- `src/features/editor/persistence/remoteWorkspaceRepository.test.ts`：请求路径、响应和错误测试。
- `src/features/editor/persistence/workspaceMemberRepository.ts`：显式工作区成员 API 客户端。
- `src/features/editor/persistence/workspaceMemberRepository.test.ts`：成员路径和错误测试。
- `src/features/editor/session/useWorkspaceSession.ts`：目录加载、防抖保存、冲刷和切换状态机。
- `src/features/editor/session/useWorkspaceSession.test.tsx`：保存屏障和竞态测试。
- `src/features/editor/components/WorkspaceShell.tsx`：工作区应用壳和错误/加载状态。
- `src/features/editor/components/WorkspaceShell.test.tsx`：模式选择与快照切换测试。
- `src/features/editor/components/sidebar/WorkspaceSwitcher.tsx`：品牌下方的工作区触发器。
- `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`：B 方案管理 Dialog。
- `src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`：搜索、创建、切换和重命名测试。
- `src/app/api/workspaces/handlers.ts`：工作区目录、创建和指定工作区 handler。
- `src/app/api/workspaces/route.ts`：`GET|POST /api/workspaces`。
- `src/app/api/workspaces/route.test.ts`：目录和创建路由测试。
- `src/app/api/workspaces/[workspaceId]/route.ts`：`GET|PUT|PATCH /api/workspaces/:id`。
- `src/app/api/workspaces/[workspaceId]/route.test.ts`：读取、保存和重命名测试。
- `src/app/api/workspaces/[workspaceId]/select/route.ts`：显式选择路由。
- `src/app/api/workspaces/[workspaceId]/select/route.test.ts`：选择原子性测试。
- `src/app/api/workspaces/[workspaceId]/members/route.ts`：显式成员路由。
- `src/app/api/workspaces/[workspaceId]/members/route.test.ts`：成员作用域测试。
- `src/app/api/workspaces/[workspaceId]/members/handlers.ts`：显式成员 handler。
- `src/app/api/workspaces/[workspaceId]/history/[documentId]/route.ts`：显式历史路由。
- `src/app/api/workspaces/[workspaceId]/history/[documentId]/route.test.ts`：历史作用域测试。
- `src/app/api/workspaces/[workspaceId]/history/[documentId]/handlers.ts`：显式历史 handler。
- `src/server/workspacePayload.ts`：保留导入脚本需要的工作区载荷校验。
- `e2e/workspaces.spec.ts`：数据库、本地迁移和双工作区端到端验收。

### 重点修改

- `src/server/database/migrations.ts`、`migrations.test.ts`：M6 schema 和回填。
- `src/server/postgresWorkspaceStore.ts`、`postgresWorkspaceStore.test.ts`：显式目录、内容和权限方法。
- `src/app/EditorApp.tsx`、`EditorApp.test.tsx`：按认证响应选择仓储模式并渲染 Shell。
- `src/features/editor/components/EditorPage.tsx`、`EditorPage.test.tsx`：改为受控编辑器。
- `src/features/editor/components/WorkspaceSidebar.tsx`：品牌和工作区入口布局。
- `src/features/editor/persistence/documentHistoryRepository.ts`：显式工作区历史路径。
- `src/features/editor/persistence/attachmentRepository.ts`：上传提交 `workspaceId`。
- `src/server/collaborationAuthorization.ts`、`collaborationServer.ts`：校验显式工作区房间。
- `src/features/editor/collaboration/useDocumentCollaboration.ts`：构造显式工作区房间。
- `README.md`、`docs/prd.md`：已交付能力、迁移、API 和下一批范围。

### 最终删除

- `src/app/api/workspace/`
- `src/app/api/history/[documentId]/`
- `src/features/editor/persistence/workspaceSyncRepository.ts`
- `src/features/editor/persistence/workspaceSyncRepository.test.ts`
- `src/features/editor/persistence/editorRepository.ts`
- `src/features/editor/persistence/editorRepository.test.ts`
- `src/server/workspaceStore.ts`

## 任务1：共享工作区契约与名称规则

**文件：**
- 创建： `src/shared/workspace.ts`
- 创建： `src/shared/workspace.test.ts`
- 创建： `src/features/editor/persistence/workspaceRepository.ts`
- 修改： `src/features/editor/session/sessionTypes.ts`

- [ ] **步骤1: 写失败的共享契约测试**

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  WorkspaceNameValidationError,
} from "./workspace";

describe("workspace contract", () => {
  it("trims valid names and rejects empty or overlong names", () => {
    expect(normalizeWorkspaceName("  产品团队  ")).toBe("产品团队");
    expect(() => normalizeWorkspaceName("   ")).toThrow(WorkspaceNameValidationError);
    expect(() => normalizeWorkspaceName("x".repeat(81))).toThrow(WorkspaceNameValidationError);
  });

  it("places the selected workspace first and keeps the rest stable", () => {
    const result = sortWorkspaceSummaries([
      { id: "b", name: "B", role: "editor", createdAt: 20, updatedAt: 20 },
      { id: "a", name: "A", role: "owner", createdAt: 10, updatedAt: 10 },
    ], "b");
    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
```

- [ ] **步骤2: 运行测试确认失败**

运行： `pnpm test --run src/shared/workspace.test.ts`

预期： FAIL，模块 `src/shared/workspace.ts` 不存在。

- [ ] **步骤3: 创建共享类型与严格名称校验**

```ts
import type { EditorWorkspace } from "../features/editor/model/block";

export const WORKSPACE_NAME_MAX_LENGTH = 80;
export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceCatalog {
  currentWorkspaceId: string;
  workspaces: WorkspaceSummary[];
}

export interface WorkspaceSnapshot {
  summary: WorkspaceSummary;
  content: EditorWorkspace;
}

export class WorkspaceNameValidationError extends Error {
  constructor() {
    super("工作区名称长度必须为 1-80 个字符");
    this.name = "WorkspaceNameValidationError";
  }
}

export function normalizeWorkspaceName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > WORKSPACE_NAME_MAX_LENGTH) {
    throw new WorkspaceNameValidationError();
  }
  return name;
}

export function sortWorkspaceSummaries(items: WorkspaceSummary[], currentWorkspaceId: string) {
  return [...items].sort((left, right) => {
    if (left.id === currentWorkspaceId) return -1;
    if (right.id === currentWorkspaceId) return 1;
    return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
  });
}
```

在 `workspaceRepository.ts` 定义最终仓储接口：

```ts
import type { EditorWorkspace } from "../model/block";
import type { WorkspaceCatalog, WorkspaceSnapshot, WorkspaceSummary } from "../../../shared/workspace";

export interface WorkspaceRepository {
  readonly target: "local" | "remote";
  list(): Promise<WorkspaceCatalog>;
  load(workspaceId: string): Promise<WorkspaceSnapshot>;
  create(name: string): Promise<WorkspaceSnapshot>;
  rename(workspaceId: string, name: string): Promise<WorkspaceSummary>;
  select(workspaceId: string): Promise<WorkspaceSnapshot>;
  save(workspaceId: string, content: EditorWorkspace): Promise<void>;
}
```

把 `sessionTypes.ts` 中的角色类型改为导入 `WorkspaceRole`，不保留第二份字符串联合类型。

- [ ] **步骤4: 运行测试和类型检查**

运行： `pnpm test --run src/shared/workspace.test.ts && pnpm exec tsc --noEmit`

预期： PASS，无重复角色类型错误。

- [ ] **步骤5: 提交共享契约**

```bash
git add src/shared/workspace.ts src/shared/workspace.test.ts src/features/editor/persistence/workspaceRepository.ts src/features/editor/session/sessionTypes.ts
git commit -m "feat: add multi-workspace contracts"
```

## 任务2：PostgreSQL M6 迁移

**文件：**
- 修改： `src/server/database/migrations.ts`
- 修改： `src/server/database/migrations.test.ts`
- 修改： `src/server/postgresWorkspaceStore.ts`
- 修改： `src/server/postgresWorkspaceStore.test.ts`
- 修改： `src/server/yjsPersistence.test.ts`
- 修改： `src/server/collaborationPubSub.test.ts`

- [ ] **步骤1: 写旧 schema 回填失败测试**

在 `migrations.test.ts` 创建迁移前工作区：两名成员、一个活动文档、当前选择，并把已有迁移 ID 标记为完成。然后调用 `migrateDatabase(pool)` 两次，断言：

```ts
expect(await columnNames(pool, "editor_workspaces")).not.toContain("owner_id");
expect(await columnNames(pool, "editor_workspaces")).not.toContain("active_document_id");
expect(await columnNames(pool, "workspace_preferences")).toContain("selected_workspace_id");

const preferences = await pool.query(
  `SELECT user_id, workspace_id, active_document_id
   FROM workspace_document_preferences
   ORDER BY user_id`,
);
expect(preferences.rows).toEqual([
  { user_id: "user-editor", workspace_id: "workspace-1", active_document_id: "document-1" },
  { user_id: "user-owner", workspace_id: "workspace-1", active_document_id: "document-1" },
]);
```

再删除 `document-1`，断言只清空 `active_document_id`，`workspace_id` 和偏好行仍存在。

- [ ] **步骤2: 运行迁移测试确认失败**

运行： `pnpm test --run src/server/database/migrations.test.ts`

预期： FAIL，`workspace_document_preferences` 不存在，旧列仍存在。

- [ ] **步骤3: 添加单次 M6 迁移**

在 `migrations.ts` 增加 `2026-07-15-multi-workspace-foundation`，严格按以下顺序执行：

```sql
CREATE TABLE workspace_document_preferences (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
  active_document_id TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, workspace_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, active_document_id)
    REFERENCES editor_documents(workspace_id, id)
    ON DELETE SET NULL (active_document_id)
);

INSERT INTO workspace_document_preferences
  (user_id, workspace_id, active_document_id, updated_at)
SELECT members.user_id, members.workspace_id, workspaces.active_document_id, workspaces.updated_at
FROM workspace_members members
INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
ON CONFLICT (user_id, workspace_id) DO NOTHING;

ALTER TABLE workspace_preferences RENAME COLUMN workspace_id TO selected_workspace_id;
ALTER TABLE editor_workspaces DROP COLUMN owner_id;
ALTER TABLE editor_workspaces DROP COLUMN active_document_id;
CREATE INDEX workspace_document_preferences_workspace_idx
  ON workspace_document_preferences(workspace_id, user_id);
```

用现有 migration lock 包裹检查、执行和迁移记录，不修改旧 migration ID。

同一步把现有 store 适配到迁移后的列，保证本提交不会让全量测试处于中断状态：

- `workspace_preferences.workspace_id` 全部改为 `selected_workspace_id`。
- `ensurePersonalWorkspace` 插入 `editor_workspaces(id, name, updated_at, created_at)`，不再写已删除列。
- `ensureDefaultDocument` 通过查询 `editor_documents` 判断是否已有默认文档；创建后 upsert 当前用户的 `workspace_document_preferences`。
- 旧隐式加载暂时从 `workspace_document_preferences` 读取当前用户活动文档。
- 旧隐式保存暂时更新 `workspace_document_preferences.active_document_id`，不更新工作区共享字段。
- `addMember` 删除修改被添加用户 `workspace_preferences` 的语句。
- Yjs/PubSub 测试 fixture 插入工作区时只使用迁移后仍存在的列。

- [ ] **步骤4: 运行迁移测试**

运行： `pnpm test --run src/server/database/migrations.test.ts src/server/postgresWorkspaceStore.test.ts src/server/yjsPersistence.test.ts src/server/collaborationPubSub.test.ts src/server/postgresAuthStore.test.ts`

预期： PASS，重复迁移不报错，偏好回填正确。

- [ ] **步骤5: 运行真实 PostgreSQL schema 冒烟**

运行： `pnpm db:migrate && pnpm db:smoke`

预期： 两条命令退出码为 0；`schema_migrations` 含 M6 ID。

- [ ] **步骤6: 提交迁移**

```bash
git add src/server/database/migrations.ts src/server/database/migrations.test.ts src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts src/server/yjsPersistence.test.ts src/server/collaborationPubSub.test.ts
git commit -m "feat: migrate multi-workspace preferences"
```

## 任务3：PostgreSQL 显式工作区目录与内容访问

**文件：**
- 修改： `src/server/postgresWorkspaceStore.ts`
- 修改： `src/server/postgresWorkspaceStore.test.ts`
- 修改： `src/server/applicationServices.ts`

- [ ] **步骤1: 写目录、创建、选择和角色失败测试**

测试必须覆盖：

```ts
const catalog = await store.listWorkspaces("user-owner");
expect(catalog.currentWorkspaceId).toBe("workspace-a");
expect(catalog.workspaces.map(({ id, role }) => ({ id, role }))).toEqual([
  { id: "workspace-a", role: "owner" },
  { id: "workspace-b", role: "editor" },
]);

const created = await store.createWorkspace("user-owner", "  产品团队  ");
expect(created.summary).toMatchObject({ name: "产品团队", role: "owner" });
expect(created.content.documents).toHaveLength(1);
expect((await store.listWorkspaces("user-owner")).currentWorkspaceId).toBe(created.summary.id);

await expect(store.renameWorkspace("user-editor", "workspace-a", "新名称"))
  .rejects.toThrow("只有工作区所有者可以重命名");
await expect(store.loadWorkspace("user-owner", "workspace-foreign"))
  .rejects.toThrow("工作区不存在");
```

再为同一工作区两名用户保存不同 `activeDocumentId`，断言各自加载自己的活动文档。

- [ ] **步骤2: 运行 store 测试确认失败**

运行： `pnpm test --run src/server/postgresWorkspaceStore.test.ts`

预期： FAIL，目录和显式方法不存在。

- [ ] **步骤3: 实现显式 store API**

增加：

```ts
export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("工作区不存在");
    this.name = "WorkspaceNotFoundError";
  }
}

class PostgresWorkspaceStore {
  listWorkspaces(userId: string): Promise<WorkspaceCatalog>;
  createWorkspace(userId: string, name: string): Promise<WorkspaceSnapshot>;
  loadWorkspace(userId: string, workspaceId: string): Promise<WorkspaceSnapshot>;
  selectWorkspace(userId: string, workspaceId: string): Promise<WorkspaceSnapshot>;
  renameWorkspace(userId: string, workspaceId: string, name: string): Promise<WorkspaceSummary>;
  saveWorkspace(userId: string, workspaceId: string, content: EditorWorkspace): Promise<EditorWorkspace>;
  getWorkspaceAccess(userId: string, workspaceId: string): Promise<WorkspaceAccess | null>;
  getDocumentAccess(userId: string, workspaceId: string, documentId: string): Promise<WorkspaceAccess | null>;
}
```

实现规则：

- 每个精确访问查询同时匹配 `members.user_id` 和 `members.workspace_id`。
- `listWorkspaces` 在所选工作区已失效时选择最早可访问工作区并回写偏好。
- `createWorkspace` 在一个事务内写工作区、owner、默认文档、文档偏好和当前选择。
- `selectWorkspace` 先验证成员，再更新当前选择，随后从同一工作区加载快照。
- `saveWorkspace` 对 viewer 抛 `WorkspacePermissionError`；保存文档内容后 upsert 当前用户的活动文档偏好。
- 加载时活动文档为空或已删除，则选择排序后的第一份文档并回写。
- `addMember` 删除更新被添加用户 `workspace_preferences` 的 SQL。

为保持后续调用方逐步迁移，本任务可临时保留旧签名 overload；Task 10 必须删除 optional/implicit 分支。

- [ ] **步骤4: 运行 store 和成员回归测试**

运行： `pnpm test --run src/server/postgresWorkspaceStore.test.ts src/app/api/workspace/members/route.test.ts`

预期： PASS，新增成员的当前工作区不变化。

- [ ] **步骤5: 运行类型检查**

运行： `pnpm exec tsc --noEmit`

预期： PASS；临时 overload 只用于尚未迁移的旧调用方。

- [ ] **步骤6: 提交 store**

```bash
git add src/server/postgresWorkspaceStore.ts src/server/postgresWorkspaceStore.test.ts src/server/applicationServices.ts
git commit -m "feat: add scoped postgres workspaces"
```

## 任务4：工作区 REST API 与远端仓储

**文件：**
- 创建： `src/app/api/workspaces/handlers.ts`
- 创建： `src/app/api/workspaces/route.ts`
- 创建： `src/app/api/workspaces/route.test.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/route.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/route.test.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/select/route.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/select/route.test.ts`
- 创建： `src/features/editor/persistence/remoteWorkspaceRepository.ts`
- 创建： `src/features/editor/persistence/remoteWorkspaceRepository.test.ts`

- [ ] **步骤1: 写 handler 和客户端失败测试**

路由测试覆盖 `401/400/403/404/201`；远端仓储测试断言精确请求：

```ts
await repository.save("workspace/a", content);
expect(fetchSpy).toHaveBeenCalledWith(
  "/api/workspaces/workspace%2Fa",
  expect.objectContaining({
    body: JSON.stringify({ content }),
    method: "PUT",
  }),
);

await repository.select("workspace-2");
expect(fetchSpy).toHaveBeenCalledWith(
  "/api/workspaces/workspace-2/select",
  expect.objectContaining({ method: "POST" }),
);
```

- [ ] **步骤2: 运行聚焦测试确认失败**

运行： `pnpm test --run src/app/api/workspaces src/features/editor/persistence/remoteWorkspaceRepository.test.ts`

预期： FAIL，新路由和仓储不存在。

- [ ] **步骤3: 实现统一 JSON/error 解析和 REST 仓储**

`remoteWorkspaceRepository.ts` 必须只实现设计契约：

```ts
export function createRemoteWorkspaceRepository(): WorkspaceRepository {
  return {
    target: "remote",
    list: () => requestJson("/api/workspaces", { method: "GET" }),
    load: (id) => requestJson(`/api/workspaces/${encodeURIComponent(id)}`, { method: "GET" }),
    create: (name) => requestJson("/api/workspaces", jsonRequest("POST", { name })),
    rename: (id, name) => requestJson(
      `/api/workspaces/${encodeURIComponent(id)}`,
      jsonRequest("PATCH", { name }),
    ).then((payload) => payload.workspace),
    select: (id) => requestJson(
      `/api/workspaces/${encodeURIComponent(id)}/select`,
      { headers: { Accept: "application/json" }, method: "POST" },
    ),
    save: (id, content) => requestJson(
      `/api/workspaces/${encodeURIComponent(id)}`,
      jsonRequest("PUT", { content }),
    ).then(() => undefined),
  };
}
```

错误响应读取 `{ error }` 并抛出该文案；非法 JSON 使用稳定的“工作区服务返回无效响应”。

- [ ] **步骤4: 实现数据库路由**

`handlers.ts` 注入 `authStore` 和 `workspaceStore`。映射：

```ts
if (error instanceof WorkspaceNameValidationError) return jsonError(error.message, 400);
if (error instanceof WorkspaceNotFoundError) return jsonError(error.message, 404);
if (error instanceof WorkspacePermissionError) return jsonError(error.message, 403);
```

动态路由使用 Next.js 15 的 `params: Promise<{ workspaceId: string }>`；无 PostgreSQL 配置统一返回 `503`，本地客户端不会调用这些路由。

- [ ] **步骤5: 运行路由、仓储和类型测试**

运行： `pnpm test --run src/app/api/workspaces src/features/editor/persistence/remoteWorkspaceRepository.test.ts && pnpm exec tsc --noEmit`

预期： PASS，所有路径包含显式工作区 ID。

- [ ] **步骤6: 提交 REST 层**

```bash
git add src/app/api/workspaces src/features/editor/persistence/remoteWorkspaceRepository.ts src/features/editor/persistence/remoteWorkspaceRepository.test.ts
git commit -m "feat: add workspace REST resources"
```

## 任务5：IndexedDB v2 多工作区仓储

**文件：**
- 创建： `src/features/editor/persistence/localWorkspaceRepository.ts`
- 创建： `src/features/editor/persistence/localWorkspaceRepository.test.ts`
- 读取： `src/features/editor/persistence/editorRepository.ts`

- [ ] **步骤1: 写 v1 迁移和隔离失败测试**

使用 `fake-indexeddb` 先创建版本 1 的 `documents` Store，并分别测试旧 `workspace`、旧 `default` 文档和无旧数据。核心断言：

```ts
const repository = createLocalWorkspaceRepository({ idFactory: () => "local-2", now: () => 2000 });
const catalog = await repository.list();
expect(catalog.currentWorkspaceId).toBe("local-default");
expect(catalog.workspaces[0].name).toBe("Nexus 工作区");
expect((await repository.load("local-default")).content).toEqual(normalizeWorkspace(legacy));

const created = await repository.create("研发中心");
expect((await repository.list()).currentWorkspaceId).toBe(created.summary.id);
await repository.save(created.summary.id, workspaceB);
expect((await repository.load("local-default")).content).toEqual(normalizeWorkspace(legacy));
```

重复创建 repository 后断言只存在一个 `local-default`。

- [ ] **步骤2: 运行本地仓储测试确认失败**

运行： `pnpm test --run src/features/editor/persistence/localWorkspaceRepository.test.ts`

预期： FAIL，本地多工作区仓储不存在。

- [ ] **步骤3: 创建 v2 Store 和幂等迁移**

定义：

```ts
const DATABASE_VERSION = 2;
const LEGACY_STORE = "documents";
const CATALOG_STORE = "workspaceCatalog";
const CONTENT_STORE = "workspaceContents";
const PREFERENCES_STORE = "preferences";
const SELECTED_KEY = "selectedWorkspaceId";
const MIGRATION_KEY = "v2MigrationComplete";
const DEFAULT_WORKSPACE_ID = "local-default";
```

升级回调只创建缺失 Store。首次 `list()` 调用在一个包含四个 Store 的 read-write transaction 中完成读取旧键、规范化、写目录/内容/偏好、删除旧键和写迁移标记。事务失败时不得写完成标记。

- [ ] **步骤4: 实现完整本地仓储契约**

`createLocalWorkspaceRepository` 接受可注入 `idFactory`、`now` 和 `databaseName`。实现规则：

```ts
target: "local"
create(name)  // 同一事务写目录、默认内容和 selected key
rename(id, name) // 只改目录；不存在时报“工作区不存在”
select(id) // 先同时读取目录和内容，再更新 selected key
save(id, content) // 只写指定内容并更新目录 updatedAt
load(id) // 返回 role = owner 的 WorkspaceSnapshot
```

每个写事务必须 `await transaction.done` 后返回。

- [ ] **步骤5: 运行本地仓储与旧仓储回归测试**

运行： `pnpm test --run src/features/editor/persistence/localWorkspaceRepository.test.ts src/features/editor/persistence/editorRepository.test.ts`

预期： PASS；旧仓储仍只作为尚未迁移 UI 的临时回归基线。

- [ ] **步骤6: 提交本地仓储**

```bash
git add src/features/editor/persistence/localWorkspaceRepository.ts src/features/editor/persistence/localWorkspaceRepository.test.ts
git commit -m "feat: add local multi-workspace storage"
```

## 任务6：Workspace Session 保存屏障与竞态控制

**文件：**
- 创建： `src/features/editor/session/useWorkspaceSession.ts`
- 创建： `src/features/editor/session/useWorkspaceSession.test.tsx`

- [ ] **步骤1: 写切换时序失败测试**

使用 deferred Promise 证明：

```ts
act(() => result.current.updateContent((current) => ({ ...current, updatedAt: 2000 })));
const switching = actAsync(() => result.current.switchWorkspace("workspace-b"));

expect(repository.save).toHaveBeenCalledWith("workspace-a", expect.objectContaining({ updatedAt: 2000 }));
expect(repository.select).not.toHaveBeenCalled();

saveDeferred.resolve();
await switching;
expect(repository.select).toHaveBeenCalledWith("workspace-b");
expect(result.current.snapshot?.summary.id).toBe("workspace-b");
```

另测保存拒绝时 `select` 不调用、快照不替换；旧保存延迟完成时不得把新工作区状态改为 `remote/local`。

- [ ] **步骤2: 运行 hook 测试确认失败**

运行： `pnpm test --run src/features/editor/session/useWorkspaceSession.test.tsx`

预期： FAIL，hook 不存在。

- [ ] **步骤3: 实现 session 状态与初始加载**

公开：

```ts
export type WorkspaceSaveStatus = "local" | "remote" | "saving" | "unsaved" | "failed" | "readonly";

interface WorkspaceSessionController {
  catalog: WorkspaceCatalog | null;
  snapshot: WorkspaceSnapshot | null;
  saveStatus: WorkspaceSaveStatus;
  error: string;
  isLoading: boolean;
  isTransitioning: boolean;
  updateContent(updater: (current: EditorWorkspace) => EditorWorkspace): void;
  flushSave(): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<void>;
  createWorkspace(name: string): Promise<void>;
  renameWorkspace(workspaceId: string, name: string): Promise<void>;
  reload(): Promise<void>;
}
```

初始加载调用 `list()` 后 `load(currentWorkspaceId)`。失败保留错误，不创建伪空白工作区。

- [ ] **步骤4: 实现 revision 绑定保存**

使用 refs 保存当前 `{ workspaceId, content, revision, savedRevision }`。`updateContent` 递增 revision 并启动 250ms timer。每次保存捕获不可变参数：

```ts
const request = { workspaceId, content, revision };
await repository.save(request.workspaceId, request.content);
if (currentRef.current.workspaceId === request.workspaceId
    && currentRef.current.revision === request.revision) {
  setSaveStatus(repository.target);
}
```

`flushSave` 清 timer，等待已有 in-flight save；如等待期间又产生 revision，再保存最新快照。

- [ ] **步骤5: 实现切换、创建和重命名**

- `switchWorkspace`：锁定 → `flushSave` → `repository.select` → 原子安装目录/快照。
- `createWorkspace`：锁定 → `flushSave` → `repository.create` → 把新摘要置顶并安装快照。
- `renameWorkspace`：不 flush、不切换；成功后只替换目录和当前摘要名称。
- 任一错误只设置 `error`，切换/创建失败保留旧快照。
- viewer 的 `updateContent` 无写入，`flushSave` 直接完成。

- [ ] **步骤6: 运行 hook 测试和类型检查**

运行： `pnpm test --run src/features/editor/session/useWorkspaceSession.test.tsx && pnpm exec tsc --noEmit`

预期： PASS，无未处理 Promise 警告。

- [ ] **步骤7: 提交 session hook**

```bash
git add src/features/editor/session/useWorkspaceSession.ts src/features/editor/session/useWorkspaceSession.test.tsx
git commit -m "feat: coordinate workspace transitions"
```

## 任务7：Workspace Shell、B 方案管理 Dialog 与受控 EditorPage

**文件：**
- 创建： `src/features/editor/components/WorkspaceShell.tsx`
- 创建： `src/features/editor/components/WorkspaceShell.test.tsx`
- 创建： `src/features/editor/components/sidebar/WorkspaceSwitcher.tsx`
- 创建： `src/features/editor/components/sidebar/WorkspaceManagerDialog.tsx`
- 创建： `src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`
- 修改： `src/app/EditorApp.tsx`
- 修改： `src/app/EditorApp.test.tsx`
- 修改： `src/features/editor/components/EditorPage.tsx`
- 修改： `src/features/editor/components/EditorPage.test.tsx`
- 修改： `src/features/editor/components/EditorPageCollaboration.test.tsx`
- 修改： `src/features/editor/components/WorkspaceSidebar.tsx`
- 修改： `src/features/editor/components/DocumentEditor.tsx`

- [ ] **步骤1: 写管理 Dialog 失败测试**

覆盖：

```ts
expect(screen.getByRole("dialog", { name: "工作区管理" })).toBeInTheDocument();
await user.type(screen.getByRole("searchbox", { name: "搜索工作区" }), "研发");
expect(screen.getByText("研发中心")).toBeInTheDocument();
expect(screen.queryByText("Nexus 工作区")).not.toBeInTheDocument();

expect(within(ownerRow).getByRole("button", { name: "重命名 Nexus 工作区" })).toBeEnabled();
expect(within(editorRow).queryByRole("button", { name: /重命名/ })).toBeNull();
await user.click(within(editorRow).getByRole("button", { name: "切换到研发中心" }));
expect(onSwitch).toHaveBeenCalledWith("workspace-b");
```

创建/重命名必须在同一 Dialog 内切换表单视图，不能渲染第二个 dialog。

- [ ] **步骤2: 运行组件测试确认失败**

运行： `pnpm test --run src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx src/features/editor/components/WorkspaceShell.test.tsx`

预期： FAIL，组件不存在。

- [ ] **步骤3: 实现 WorkspaceSwitcher 和管理 Dialog**

- `WorkspaceSwitcher` 显示首字、截断名称、角色和 ChevronDown，使用完整 aria-label。
- `WorkspaceManagerDialog` 使用现有 `Dialog`、`Input`、`Button` 和 lucide `Search/Plus/Pencil`。
- 列表模式显示当前标记；表单模式显示返回、名称输入和提交。
- `isTransitioning` 时禁用切换和创建；单个重命名请求只禁用对应提交。
- 移动端 Dialog 使用现有响应式宽度，不嵌套卡片。

- [ ] **步骤4: 实现 WorkspaceShell**

```tsx
interface WorkspaceShellProps {
  mode: "database" | "local";
  sessionUser: EditorSessionUser | null;
  onSignOut?: () => void;
}

export function WorkspaceShell({ mode, sessionUser, onSignOut }: WorkspaceShellProps) {
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const repository = useMemo(
    () => mode === "database"
      ? createRemoteWorkspaceRepository()
      : createLocalWorkspaceRepository(),
    [mode],
  );
  const session = useWorkspaceSession(repository);

  if (session.isLoading) {
    return <main aria-label="正在加载工作区" className="grid min-h-dvh place-items-center" role="status">正在加载工作区</main>;
  }
  if (!session.snapshot) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <section className="grid gap-3 text-center">
          <p role="alert">{session.error || "工作区加载失败"}</p>
          <Button onClick={() => void session.reload()} type="button">重新加载</Button>
        </section>
      </main>
    );
  }

  return (
    <>
      <EditorPage
        key={session.snapshot.summary.id}
        workspaceId={session.snapshot.summary.id}
        workspace={session.snapshot.content}
        workspaceSummary={session.snapshot.summary}
        membersEnabled={mode === "database"}
        onManageWorkspaces={() => setIsManagerOpen(true)}
        onSignOut={onSignOut}
        onWorkspaceChange={session.updateContent}
        saveStatus={session.saveStatus}
        sessionUser={sessionUser}
      />
      <WorkspaceManagerDialog
        catalog={session.catalog!}
        error={session.error}
        isTransitioning={session.isTransitioning}
        onClose={() => setIsManagerOpen(false)}
        onCreate={session.createWorkspace}
        onRename={session.renameWorkspace}
        onSwitch={session.switchWorkspace}
        open={isManagerOpen}
      />
    </>
  );
}
```

Shell 持有 Dialog；移动端触发管理时先通知 Sidebar 关闭。

- [ ] **步骤5: 把 EditorPage 改为受控视图**

删除 `loadSyncedWorkspace` 的首次加载 effect 和 `saveSyncedWorkspace` 的防抖 effect。新 props：

```ts
interface EditorPageProps {
  workspaceId: string;
  workspace: EditorWorkspace;
  workspaceSummary: WorkspaceSummary;
  saveStatus: WorkspaceSaveStatus;
  onWorkspaceChange: (updater: (current: EditorWorkspace) => EditorWorkspace) => void;
  onManageWorkspaces: () => void;
  membersEnabled: boolean;
  sessionUser?: EditorSessionUser | null;
  onSignOut?: () => void;
}
```

所有原 `setWorkspace` 调用改为 `onWorkspaceChange`；viewer 仍由角色控制只读。`WorkspaceSidebar` 顶部固定 BrandMark + “Nexus”，下方渲染切换器。

`DocumentEditor` 从 session hook 导入 `WorkspaceSaveStatus`，继续使用既有 `local/remote/saving/unsaved/failed/readonly` 文案，不引入第二套保存状态。

- [ ] **步骤6: 让 EditorApp 显式选择模式**

```tsx
if (session.status === "local") {
  return <WorkspaceShell mode="local" sessionUser={null} />;
}
return (
  <WorkspaceShell
    mode="database"
    sessionUser={session.user}
    onSignOut={handleSignOut}
  />
);
```

数据库 Shell 错误不得渲染本地 repository。

- [ ] **步骤7: 更新现有组件测试**

用受控 wrapper 提供 workspace state；断言编辑回调而不是旧仓储 fetch。`EditorApp.test.tsx` 保留认证流程，但登录成功后的工作区请求改为 `/api/workspaces` 和显式快照请求。

- [ ] **步骤8: 运行 UI 聚焦测试**

运行： `pnpm test --run src/app/EditorApp.test.tsx src/features/editor/components/WorkspaceShell.test.tsx src/features/editor/components/EditorPage.test.tsx src/features/editor/components/EditorPageCollaboration.test.tsx src/features/editor/components/sidebar/WorkspaceManagerDialog.test.tsx`

预期： PASS；无嵌套 dialog、无 act warning。

- [ ] **步骤9: 提交前端 Shell**

```bash
git add src/app/EditorApp.tsx src/app/EditorApp.test.tsx src/features/editor/components src/features/editor/session
git commit -m "feat: add workspace management shell"
```

## 任务8：成员与历史的显式工作区作用域

**文件：**
- 创建： `src/app/api/workspaces/[workspaceId]/members/route.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/members/route.test.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/members/handlers.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/history/[documentId]/route.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/history/[documentId]/route.test.ts`
- 创建： `src/app/api/workspaces/[workspaceId]/history/[documentId]/handlers.ts`
- 创建： `src/features/editor/persistence/workspaceMemberRepository.ts`
- 创建： `src/features/editor/persistence/workspaceMemberRepository.test.ts`
- 修改： `src/features/editor/persistence/documentHistoryRepository.ts`
- 修改： `src/features/editor/persistence/documentHistoryRepository.test.ts`
- 修改： `src/features/editor/components/EditorPage.tsx`
- 修改： `src/features/editor/components/document/HistoryPanel.tsx`
- 修改： `src/features/editor/components/document/HistoryPanel.test.tsx`
- 修改： `src/features/editor/components/document/MembersPopover.test.tsx`

- [ ] **步骤1: 写跨工作区拒绝和客户端路径失败测试**

```ts
await expect(workspaceStore.listMembers("user-a", "workspace-b")).rejects.toThrow("工作区不存在");
await loadDocumentVersions("workspace-a", "document-1");
expect(fetchSpy).toHaveBeenCalledWith(
  "/api/workspaces/workspace-a/history/document-1",
  expect.objectContaining({ method: "GET" }),
);
```

路由测试必须证明：用户对 workspace A 有权限，但把 A 的 documentId 与 workspace B 组合时返回 `404`。

- [ ] **步骤2: 运行聚焦测试确认失败**

运行： `pnpm test --run src/app/api/workspaces src/features/editor/persistence/workspaceMemberRepository.test.ts src/features/editor/persistence/documentHistoryRepository.test.ts`

预期： FAIL，新路由和显式参数不存在。

- [ ] **步骤3: 修改 store 和 handler 签名**

最终签名：

```ts
listMembers(userId: string, workspaceId: string)
addMember(ownerUserId: string, workspaceId: string, email: string, role: AssignableWorkspaceRole)
listDocumentVersions(userId: string, workspaceId: string, documentId: string)
restoreDocumentVersion(userId: string, workspaceId: string, documentId: string, versionId: string)
```

每条 SQL 同时过滤 `workspace_id` 和资源 ID。成员添加只 upsert `workspace_members`，不更新受邀用户的选择偏好。

- [ ] **步骤4: 创建显式动态路由并更新客户端**

`HistoryPanel` 增加 `workspaceId` prop；`loadDocumentVersions` 和 `restoreDocumentVersion` 的第一个参数为 workspace ID。`workspaceMemberRepository.ts` 导出 `loadWorkspaceMembers(workspaceId)` 和 `addWorkspaceMember(workspaceId, email, role)`，只调用 `/api/workspaces/:id/members`。本地模式不提供成员管理回调，避免无数据库 UI 发出成员请求。

- [ ] **步骤5: 运行成员、历史和 UI 测试**

运行： `pnpm test --run src/app/api/workspaces src/features/editor/persistence/documentHistoryRepository.test.ts src/features/editor/components/document/HistoryPanel.test.tsx src/features/editor/components/document/MembersPopover.test.tsx`

预期： PASS，非当前但已授权工作区也能被精确访问。

- [ ] **步骤6: 提交成员与历史作用域**

```bash
git add src/app/api/workspaces src/features/editor
git commit -m "feat: scope members and history by workspace"
```

## 任务9：文件与 Yjs 的显式工作区作用域

**文件：**
- 修改： `src/app/api/files/handlers.ts`
- 修改： `src/app/api/files/handlers.test.ts`
- 修改： `src/features/editor/persistence/attachmentRepository.ts`
- 修改： `src/features/editor/persistence/attachmentRepository.test.ts`
- 修改： `src/features/editor/components/blocks/AttachmentBlockEditor.tsx`
- 修改： `src/features/editor/components/blocks/AttachmentBlockEditor.test.tsx`
- 修改： `src/features/editor/components/BlockRow.tsx`
- 修改： `src/features/editor/components/BlockList.tsx`
- 修改： `src/features/editor/components/DocumentEditor.tsx`
- 修改： `src/features/editor/components/EditorPage.tsx`
- 修改： `src/server/collaborationAuthorization.ts`
- 修改： `src/server/collaborationAuthorization.test.ts`
- 修改： `src/server/collaborationServer.ts`
- 修改： `src/server/collaborationServer.test.ts`
- 修改： `src/features/editor/collaboration/useDocumentCollaboration.ts`
- 修改： `src/features/editor/collaboration/useDocumentCollaboration.test.tsx`

- [ ] **步骤1: 写文件精确作用域失败测试**

上传表单必须含：

```ts
formData.set("workspaceId", "workspace-a");
```

测试用户当前选择 B 但对 A 有 editor 权限时可上传到 `workspace-a/...`；只有 B 权限时对 A 返回 `403`。GET 从 key 第一段解析 A 并检查 A，不读取当前偏好。

- [ ] **步骤2: 写协作房间失败测试**

```ts
const request = new Request("ws://localhost/workspace%3Aworkspace-a%3Adocument%3Adocument-1", {
  headers: { Cookie: "notion_editor_session=token", Origin: "http://localhost:3000" },
});
expect(workspaceStore.getDocumentAccess).toHaveBeenCalledWith(
  "user-1",
  "workspace-a",
  "document-1",
);
```

覆盖 malformed room、workspace/document 不匹配、viewer 和无成员关系。

- [ ] **步骤3: 运行文件和协作测试确认失败**

运行： `pnpm test --run src/app/api/files/handlers.test.ts src/features/editor/persistence/attachmentRepository.test.ts src/server/collaborationAuthorization.test.ts src/server/collaborationServer.test.ts src/features/editor/collaboration/useDocumentCollaboration.test.tsx`

预期： FAIL，调用仍依赖当前工作区或 `document:` 房间。

- [ ] **步骤4: 实现文件作用域**

`uploadAttachment(workspaceId, file, kind)` 把 ID 写入 FormData。数据库 handler 调用：

```ts
const access = await workspaceStore.getWorkspaceAccess(user.id, workspaceId);
```

本地模式只做 ID 语法校验（1-128 个字母、数字、点、下划线或连字符），因为无数据库模式是单用户开发环境。对象 key 始终由提交的 workspace ID 创建。

沿 `EditorPage → DocumentEditor → BlockList → BlockRow → AttachmentBlockEditor` 传递 `workspaceId`，不从全局读取。

- [ ] **步骤5: 实现规范 Yjs 房间**

`useDocumentCollaboration` 增加必需 `workspaceId`：

```ts
const roomName = document
  ? `workspace:${workspaceId}:document:${document.id}`
  : null;
```

服务端严格解析同一格式，调用 `getDocumentAccess(userId, workspaceId, documentId)`；授权结果中的 ID 必须与房间一致。持久化和 Redis Pub/Sub 继续使用规范房间名，无需二次改写。

- [ ] **步骤6: 运行文件、协作和类型测试**

运行： `pnpm test --run src/app/api/files/handlers.test.ts src/features/editor/persistence/attachmentRepository.test.ts src/features/editor/components/blocks/AttachmentBlockEditor.test.tsx src/server/collaborationAuthorization.test.ts src/server/collaborationServer.test.ts src/features/editor/collaboration/useDocumentCollaboration.test.tsx src/server/yjsPersistence.test.ts src/server/collaborationPubSub.test.ts && pnpm exec tsc --noEmit`

预期： PASS，房间名均为 `workspace:{workspaceId}:document:{documentId}`。

- [ ] **步骤7: 提交文件和协同作用域**

```bash
git add src/app/api/files src/features/editor src/server/collaborationAuthorization.ts src/server/collaborationAuthorization.test.ts src/server/collaborationServer.ts src/server/collaborationServer.test.ts
git commit -m "feat: scope files and collaboration by workspace"
```

## 任务10：删除隐式工作区路径和临时兼容代码

**文件：**
- 创建： `src/server/workspacePayload.ts`
- 修改： `src/server/workspaceImport.ts`
- 修改： `src/server/workspaceImport.test.ts`
- 修改： `src/server/postgresWorkspaceStore.ts`
- 删除： `src/server/workspaceStore.ts`
- 删除： `src/app/api/workspace/route.ts`
- 删除： `src/app/api/workspace/route.test.ts`
- 删除： `src/app/api/workspace/handlers.ts`
- 删除： `src/app/api/workspace/members/route.ts`
- 删除： `src/app/api/workspace/members/route.test.ts`
- 删除： `src/app/api/workspace/members/handlers.ts`
- 删除： `src/app/api/history/[documentId]/route.ts`
- 删除： `src/app/api/history/[documentId]/handlers.ts`
- 删除： `src/app/api/history/[documentId]/handlers.test.ts`
- 删除： `src/features/editor/persistence/workspaceSyncRepository.ts`
- 删除： `src/features/editor/persistence/workspaceSyncRepository.test.ts`
- 删除： `src/features/editor/persistence/editorRepository.ts`
- 删除： `src/features/editor/persistence/editorRepository.test.ts`

- [ ] **步骤1: 先添加隐式路径扫描验证**

运行：

```powershell
rg -n -P '/api/workspace(?!s)' src e2e
rg -n -P '(?:"|localhost)/api/history/' src e2e
rg -n 'workspaceSyncRepository|createFileWorkspaceStore' src scripts
```

预期： 当前命令列出旧路由、旧仓储和旧调用方，证明清理尚未完成。

- [ ] **步骤2: 拆出仅供导入使用的载荷校验**

把 `isWorkspacePayload` 及其私有结构校验移动到 `src/server/workspacePayload.ts`，更新 `workspaceImport.ts`。不移动文件读写 Store。

- [ ] **步骤3: 删除旧路由与客户端仓储**

删除文件清单中的旧目录。更新残余测试 import，所有生产调用只能使用新 repository 和 `/api/workspaces/:id/...`。

- [ ] **步骤4: 删除 Postgres 临时 overload**

最终方法全部要求显式 ID：

```ts
loadWorkspace(userId: string, workspaceId: string)
saveWorkspace(userId: string, workspaceId: string, content: EditorWorkspace)
getWorkspaceAccess(userId: string, workspaceId: string)
getDocumentAccess(userId: string, workspaceId: string, documentId: string)
```

删除 optional `workspaceId`、`findSelectedAccess` 公共入口和任何从 `workspace_preferences` 推断写入目标的代码。偏好只用于目录初始选择。

- [ ] **步骤5: 再次运行扫描、测试和类型检查**

运行：

```powershell
rg -n -P '/api/workspace(?!s)' src e2e
if ($LASTEXITCODE -eq 1) { $global:LASTEXITCODE = 0 }
rg -n -P '(?:"|localhost)/api/history/' src e2e
if ($LASTEXITCODE -eq 1) { $global:LASTEXITCODE = 0 }
rg -n 'workspaceSyncRepository|createFileWorkspaceStore' src scripts
if ($LASTEXITCODE -eq 1) { $global:LASTEXITCODE = 0 }
pnpm test --run src/server/workspaceImport.test.ts src/server/postgresWorkspaceStore.test.ts src/app/api/workspaces
pnpm exec tsc --noEmit
```

预期： 三个 `rg` 均无匹配；测试和类型检查 PASS。

- [ ] **步骤6: 提交清理**

```bash
git add -A src/server src/app/api src/features/editor/persistence src/features/editor/components
git commit -m "refactor: remove implicit workspace access"
```

## 任务11：端到端验收、README 和 PRD

**文件：**
- 创建： `e2e/workspaces.spec.ts`
- 修改： `e2e/support.ts`
- 修改： `e2e/auth.spec.ts`
- 修改： `e2e/collaboration.spec.ts`
- 修改： `README.md`
- 修改： `docs/prd.md`

- [ ] **步骤1: 写数据库多工作区 E2E**

测试流程：

```ts
await openWorkspaceManager(page);
await page.getByRole("button", { name: "新建工作区" }).click();
await page.getByLabel("工作区名称").fill("研发中心");
await page.getByRole("button", { name: "创建并切换" }).click();
await expect(page.getByRole("button", { name: /当前工作区 研发中心/ })).toBeVisible();

await editActiveDocument(page, "研发中心独有内容");
await switchWorkspace(page, "Nexus 工作区");
await expect(page.getByText("研发中心独有内容")).toHaveCount(0);
await switchWorkspace(page, "研发中心");
await expect(page.getByText("研发中心独有内容")).toBeVisible();
await page.reload();
await expect(page.getByRole("button", { name: /当前工作区 研发中心/ })).toBeVisible();
```

再覆盖 owner 重命名和当前文档按用户恢复。

- [ ] **步骤2: 写本地迁移 E2E**

在 page 初始化脚本中创建 v1 IndexedDB `documents/workspace`，启动无数据库模式，断言“Nexus 工作区”和旧内容；创建第二工作区、切换、刷新后再次验证隔离。

- [ ] **步骤3: 更新协作和认证 E2E helper**

所有协作断言使用规范房间 `workspace:{workspaceId}:document:{documentId}`。登录/注册后等待 `/api/workspaces`，不等待已删除的 `/api/workspace`。保留 JWE 请求体无明文断言。

- [ ] **步骤4: 运行 Compose E2E**

运行：

```bash
docker compose up -d
pnpm test:e2e
```

预期： 数据库、本地迁移、认证和双窗口协作全部 PASS；失败时保留 trace/screenshot。

- [ ] **步骤5: 更新 README**

README 必须新增或更新：

- 功能一览中的多工作区创建、搜索、切换、owner 重命名和上次文档记忆。
- IndexedDB v2 自动迁移说明，默认名称“Nexus 工作区”。
- 新 `/api/workspaces` 路由表，删除旧隐式路由说明。
- 数据库表中 `workspace_document_preferences`。
- 文件和协作显式工作区作用域。
- M6 第二批：删除、邮件邀请、成员生命周期、所有权转让、账号设置。
- M7：真实分享和页面权限。

- [ ] **步骤6: 更新 PRD**

把当前阶段更新为“M6 第一批多工作区基础已完成，第二批规划”；在当前实现状态中列出本批验收结果，但不把第二批或 M7 标为已实现。

- [ ] **步骤7: 运行文档和差异检查**

运行：

```bash
git diff --check
rg -n "M6 第二批|workspace_document_preferences|/api/workspaces" README.md docs/prd.md
```

预期： 无空白错误；README 和 PRD 都含三类关键信息。

- [ ] **步骤8: 提交 E2E 和文档**

```bash
git add e2e README.md docs/prd.md
git commit -m "docs: document multi-workspace foundation"
```

## 任务12：最终验证与审查

**文件：**
- 审查：计划开始以来的所有变更文件

- [ ] **步骤1: 运行完整单元和组件测试**

运行： `pnpm test --run`

预期： 全部测试文件和测试用例 PASS，0 failures。

- [ ] **步骤2: 运行类型检查和生产构建**

运行：

```bash
pnpm exec tsc --noEmit
pnpm build
```

预期： 两条命令退出码为 0；Next.js 完成全部页面和 API route 构建。

- [ ] **步骤3: 运行数据库和 Compose 冒烟**

运行：

```bash
pnpm db:migrate
pnpm db:smoke
docker compose ps
pnpm healthcheck http://localhost:3000/api/health
```

预期： 迁移幂等、数据库连接成功、Compose 服务 healthy、健康检查返回成功。

- [ ] **步骤4: 运行完整 Playwright**

运行： `pnpm test:e2e`

预期： 认证、多工作区、本地迁移和协作套件全部 PASS。

- [ ] **步骤5: 执行租户和敏感信息审查**

运行：

```powershell
rg -n -P '/api/workspace(?!s)' src e2e README.md
rg -n 'BEGIN (RSA )?PRIVATE KEY|SMTP_PASSWORD=.+|AUTH_HASH_SECRET=.+' . -g '!node_modules/**' -g '!.git/**' -g '!.env' -g '!.secrets/**'
git diff --check
git status --short
```

预期： 无旧隐式路径、无被跟踪的真实 Secret、无空白错误；工作区只包含计划内修改。

- [ ] **步骤6: 对照设计逐条复核**

核对 `docs/superpowers/specs/2026-07-15-m6-multi-workspace-foundation-design.md` 第 12 节每条验收标准。任何未满足条目必须恢复为未完成状态并补测试，不能只更新文档声明。

- [ ] **步骤7: 处理最终验证发现的问题**

如果最终验证发现问题，把负责该文件的 Task 恢复为未完成，按该 Task 的精确测试和 `git add` 清单完成修正及提交，然后从 Task 12 Step 1 重新运行全部验证。如果没有问题，不创建空提交。
