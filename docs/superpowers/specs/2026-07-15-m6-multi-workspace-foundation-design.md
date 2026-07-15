# M6 多工作区基础设计

## 1. 文档状态

- 日期：2026-07-15
- 阶段：M6 第一批
- 状态：设计已确认，等待实施计划
- 目标：在数据库模式和本地模式中交付可创建、查看、切换和重命名的多工作区基础，并让所有内容访问显式绑定 `workspaceId`。

## 2. 背景

当前系统已经有 `editor_workspaces`、`workspace_members` 和 `workspace_preferences`，但应用仍通过 `/api/workspace` 读取一个隐式的“当前工作区”。工作区名称没有进入前端工作区模型，数据库中的 `active_document_id` 被所有成员共享，成员添加还会修改被添加用户的当前工作区。

这种结构在单工作区阶段可用，但进入多工作区后会产生三类问题：

- 延迟保存请求可能在用户切换后写入错误工作区。
- 一名成员切换文档会改变其他成员的“上次打开文档”。
- 文件、历史、成员和协同连接依赖当前偏好，无法独立证明请求的租户边界。

本批先建立可靠的多工作区作用域和切换流程，再在后续批次增加邀请、成员生命周期和真实分享。

## 3. 已确认决策

- 第一批优先实现多工作区基础。
- 创建成功后立即切换到新工作区。
- 只有 `owner` 可以重命名工作区。
- 上次打开的文档按“用户 + 工作区”分别记忆。
- 数据库模式和无数据库本地模式都支持多工作区。
- 旧浏览器本地数据自动迁移，默认工作区命名为“Nexus 工作区”。
- 第一批不提供工作区删除。
- 切换前必须等待当前工作区保存完成；保存失败时禁止切换。
- 左上角保留 Nexus Logo 和品牌，工作区入口位于品牌下方独立一行。
- 点击入口打开“工作区管理”Dialog，在同一界面搜索、切换、新建和重命名。
- 采用显式作用域 API 和前端 Workspace Shell，不使用隐式当前工作区决定写入归属。

## 4. 范围

### 4.1 本批包含

- 工作区目录加载与客户端搜索。
- 创建工作区并自动切换。
- 显式选择和切换工作区。
- owner 重命名任意自己拥有的工作区。
- 每用户、每工作区的活动文档偏好。
- PostgreSQL 多工作区存储与迁移。
- IndexedDB v2 多工作区存储与旧数据迁移。
- 工作区内容、成员、文件、历史和 Yjs 的显式 `workspaceId` 作用域。
- 工作区管理 Dialog、加载状态、空状态和错误恢复。
- 数据库模式、本地模式和关键竞态的自动化测试。
- 完成实现后更新 README 和 PRD 当前状态。

### 4.2 后续批次

M6 第二批处理：

- 删除工作区，包括确认、最后工作区保护和数据恢复策略。
- 邮件邀请、接受、重新发送、撤销和过期。
- 成员角色修改、移除和主动退出。
- 所有权转让和最后一名 owner 保护。
- 账号设置，包括显示名称、密码和其他会话管理。

M7 处理：

- 真实分享链接。
- 私有、团队可查看和链接只读页面权限。
- 文件、历史和 WebSocket 与页面权限统一裁决。

### 4.3 本批不包含

- 工作区删除或归档。
- 邮件邀请和邀请令牌。
- 成员移除、退出、角色调整或所有权转让。
- 账号资料、密码和会话管理。
- 文档分享链接和页面级权限。
- 工作区 URL 路由，例如 `/workspaces/:workspaceId`。

## 5. 架构

### 5.1 组件边界

`EditorApp` 继续负责认证状态，并把明确的运行模式传给 `WorkspaceShell`：

- `database`：使用 REST API 和 PostgreSQL。
- `local`：使用浏览器 IndexedDB，不因 API 错误自动切换模式。

`WorkspaceShell` 和 `useWorkspaceSession` 负责：

- 工作区目录和当前 `workspaceId`。
- 当前工作区摘要、角色和编辑内容。
- 防抖保存、立即冲刷和保存版本。
- 工作区创建、选择、重命名和错误状态。
- 工作区管理 Dialog 的开关和操作状态。

`EditorPage` 改为受控编辑视图：

- 接收 `workspaceId`、`workspace`、`role` 和 `onWorkspaceChange`。
- 不自行选择存储模式，不自行决定当前工作区。
- 使用 `workspaceId` 作为组件 `key`。切换时重挂载，清理旧焦点、弹窗和协同连接。
- 文件、历史、成员和协作调用均使用传入的 `workspaceId`。

### 5.2 客户端仓储契约

数据库和本地实现共享以下行为契约：

```ts
interface WorkspaceSummary {
  id: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  createdAt: number;
  updatedAt: number;
}

interface WorkspaceCatalog {
  currentWorkspaceId: string;
  workspaces: WorkspaceSummary[];
}

interface WorkspaceSnapshot {
  summary: WorkspaceSummary;
  content: EditorWorkspace;
}

interface WorkspaceRepository {
  list(): Promise<WorkspaceCatalog>;
  load(workspaceId: string): Promise<WorkspaceSnapshot>;
  create(name: string): Promise<WorkspaceSnapshot>;
  rename(workspaceId: string, name: string): Promise<WorkspaceSummary>;
  select(workspaceId: string): Promise<WorkspaceSnapshot>;
  save(workspaceId: string, content: EditorWorkspace): Promise<void>;
}
```

目录中的当前工作区排在第一位，其余按 `createdAt`、`id` 升序稳定排列。名称允许重复；界面通过名称、角色和当前标记帮助用户区分。

### 5.3 硬性作用域规则

任何延迟请求必须把创建请求时的 `workspaceId` 捕获在参数中。请求完成时不得读取“此刻选中的工作区”决定写入归属。

过期保存可以正常完成，但只有以下条件同时满足时才能更新当前界面的保存状态：

- 保存请求的 `workspaceId` 等于当前 `workspaceId`。
- 保存请求的 revision 等于该工作区当前已知 revision。

## 6. PostgreSQL 设计

### 6.1 表结构变化

`editor_workspaces` 保留：

- `id`
- `name`
- `created_at`
- `updated_at`

删除以下共享或重复来源：

- `owner_id`：所有权统一以 `workspace_members.role = 'owner'` 为准。
- `active_document_id`：活动文档改为用户偏好。

现有 `workspace_preferences.workspace_id` 重命名为 `selected_workspace_id`，继续表示用户最后选择的工作区。

新增：

```sql
CREATE TABLE workspace_document_preferences (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
  active_document_id TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, workspace_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, active_document_id)
    REFERENCES editor_documents(workspace_id, id)
    ON DELETE SET NULL (active_document_id)
);
```

活动文档允许暂时为 `NULL`。当活动文档被其他编辑者删除时，下一次加载选择排序后的第一个文档并回写偏好。

### 6.2 数据迁移

迁移在现有迁移锁和事务内执行：

1. 创建 `workspace_document_preferences`。
2. 为每条 `workspace_members` 记录回填该工作区原 `active_document_id`。
3. 把 `workspace_preferences.workspace_id` 重命名为 `selected_workspace_id`。
4. 删除 `editor_workspaces.owner_id` 和 `active_document_id`。
5. 创建偏好查询索引。
6. 写入新的 `schema_migrations` 记录。

迁移必须幂等。任何步骤失败时整体回滚，不留下同时读取新旧活动文档字段的中间状态。

### 6.3 工作区创建事务

创建工作区在一个事务中完成：

1. 校验并规范化名称。
2. 插入 `editor_workspaces`。
3. 插入当前用户的 owner 成员记录。
4. 创建默认文档和默认起始块。
5. 插入 `workspace_document_preferences`。
6. 更新 `workspace_preferences.selected_workspace_id`。
7. 提交后返回工作区摘要和内容。

失败时不产生空工作区、孤立成员或被提前修改的当前选择。

### 6.4 授权

- 列表只返回当前用户拥有成员记录的工作区。
- `owner`、`editor`、`viewer` 都可以选择和读取工作区。
- `owner`、`editor` 可以保存内容。
- 只有 `owner` 可以重命名。
- 未授权工作区统一返回 `404`，避免泄露工作区是否存在。
- 已授权但角色不足返回 `403`。
- 添加已有成员时不修改被添加用户的 `selected_workspace_id`。

## 7. IndexedDB v2 设计

### 7.1 Object Store

- `workspaceCatalog`：以 `workspaceId` 为键存储名称和时间戳。
- `workspaceContents`：以 `workspaceId` 为键存储 `EditorWorkspace`。
- `preferences`：保存 `selectedWorkspaceId` 和迁移标记。
- 旧 `documents` Store 只用于迁移读取，迁移完成后不再参与正常读写。

本地身份固定为 `owner`。本地工作区摘要的角色不额外持久化，由仓储返回时补充。

### 7.2 旧数据迁移

首次访问 v2 仓储时，在一个 read-write transaction 中：

1. 检查迁移标记，保证重复打开不会重复导入。
2. 优先读取旧 `workspace` 键；没有时读取旧 `default` 文档并包装成工作区。
3. 规范化旧数据。
4. 创建 `local-default` 目录记录，名称为“Nexus 工作区”。
5. 写入 `workspaceContents[local-default]`。
6. 设置 `selectedWorkspaceId = local-default`。
7. 删除已迁移的旧键并写入完成标记。

如果没有旧数据，则创建同名默认工作区和一个空白文档。任一步骤失败时保留旧键，不声明迁移完成。

### 7.3 本地事务

- 创建工作区必须同时写入目录、内容和当前选择。
- 选择工作区必须先确认目标目录和内容都存在，再更新当前选择。
- 重命名只修改目录记录，不重写大体积文档内容。
- 保存只更新指定 `workspaceId` 的内容和目录 `updatedAt`。
- IndexedDB 配额或事务失败与远端保存失败使用相同的阻断切换行为。

## 8. REST API

### 8.1 工作区目录

`GET /api/workspaces`

返回：

```json
{
  "currentWorkspaceId": "workspace-1",
  "workspaces": []
}
```

`POST /api/workspaces`

请求：

```json
{ "name": "产品团队" }
```

返回 `201` 和 `WorkspaceSnapshot`。名称 `trim()` 后长度必须为 1 到 80 个字符。

### 8.2 指定工作区

- `GET /api/workspaces/:workspaceId`：返回 `WorkspaceSnapshot`。
- `PUT /api/workspaces/:workspaceId`：保存 `{ content }`。
- `PATCH /api/workspaces/:workspaceId`：owner 使用 `{ name }` 重命名。
- `POST /api/workspaces/:workspaceId/select`：验证成员、持久化选择并返回 `WorkspaceSnapshot`。

`select` 返回内容是为了让“选择持久化”和“得到目标快照”成为一个服务端动作。客户端只有在响应成功后才替换当前编辑状态。

### 8.3 相关资源

- `GET|POST /api/workspaces/:workspaceId/members`
- `GET|POST /api/workspaces/:workspaceId/history/:documentId`
- 文件上传在表单中显式提交 `workspaceId`。
- 文件读取从对象键解析 `workspaceId`，再校验当前用户对该精确工作区的访问。
- Yjs 连接显式携带 `workspaceId` 和 `documentId`。服务端同时验证成员关系和文档归属，再生成规范房间名 `workspace:<workspaceId>:document:<documentId>`。

旧 `/api/workspace`、`/api/workspace/members` 和 `/api/history/:documentId` 不保留内部兼容别名。所有调用方和测试在同一批次迁移，避免继续存在隐式作用域入口。

## 9. 前端交互

### 9.1 侧栏

- 左上角固定显示 Nexus BrandMark 和品牌名。
- 品牌下方是一行独立工作区触发器，显示工作区首字、名称、当前角色和展开图标。
- 工作区名称使用单行截断，不改变侧栏宽度。
- 移动端点击触发器时先关闭侧栏 Sheet，再打开管理 Dialog，避免叠层。

### 9.2 工作区管理 Dialog

Dialog 包含：

- 标题“工作区管理”。
- 客户端名称搜索。
- 当前工作区标记。
- 工作区名称和角色。
- 非当前工作区的切换按钮。
- owner 工作区的重命名按钮。
- “新建工作区”主命令。

创建和重命名使用 Dialog 内部的表单视图，不打开嵌套 Dialog。返回列表时保留搜索文本；操作成功后刷新对应目录项。

### 9.3 切换流程

1. 锁定管理操作，防止重复点击。
2. 取消当前 250ms 防抖计时。
3. 如果有未保存 revision，使用旧 `workspaceId` 立即保存最新快照。
4. 保存成功后调用 `select(targetWorkspaceId)`。
5. 响应成功后原子替换当前 ID、摘要、角色和内容。
6. 关闭管理 Dialog。
7. 以新 `workspaceId` 重挂载 `EditorPage`，建立新的 Yjs 连接。

保存失败时停留在原工作区，显示错误和重试操作，不调用目标选择接口。

### 9.4 创建和重命名

创建也属于切换动作，因此必须先冲刷当前保存。创建成功后直接使用服务端或 IndexedDB 返回的新快照，不再进行第二次选择请求。

重命名不触发切换：

- 用户可以重命名任意自己拥有的工作区。
- 请求期间只禁用对应行和提交按钮。
- 成功后更新目录摘要。
- 失败时保留输入并显示原始业务错误，不进行乐观名称替换。

## 10. 错误处理

- 初始目录加载失败：显示全页错误和重试，不渲染空白编辑器。
- 当前快照加载失败：保留目录上下文，提供重新加载。
- 保存失败：状态为失败，阻止切换和创建工作区。
- 目标选择失败：保留原工作区和编辑状态，刷新目录以处理权限变化。
- 创建失败：留在创建表单并保留名称。
- 重命名失败：留在重命名表单并保留名称。
- 目标工作区已失去权限：返回列表并说明访问已失效。
- 数据库模式接口失败：不读取 IndexedDB 作为替代权威数据。
- 本地 IndexedDB 失败：显示本地存储错误，不尝试远端接口。

## 11. 测试策略

### 11.1 数据库与迁移

- 迁移幂等和事务回滚。
- 为每名成员回填活动文档偏好。
- 删除共享活动文档和重复 owner 字段。
- 创建事务同时生成工作区、owner、默认文档和两类偏好。
- 两个工作区使用相同文档或块 ID 时仍保持隔离。
- 两名用户在同一工作区记住不同活动文档。
- 添加已有成员不改变对方当前工作区。

### 11.2 IndexedDB

- v1 workspace 迁移。
- legacy default document 迁移。
- 无旧数据时创建“Nexus 工作区”。
- 重复打开不会重复迁移。
- 创建、选择、重命名、保存和刷新恢复。
- 工作区内容和活动文档互不串联。
- 配额或事务失败阻止切换。

### 11.3 API 与授权

- 未登录、无成员关系、viewer 写入和非 owner 重命名。
- 名称空白、超长和非法 JSON。
- 创建自动选择并返回新快照。
- 选择未授权工作区不修改偏好。
- 成员、历史、文件和协作拒绝跨工作区 ID。
- 旧隐式路由不再被客户端调用。

### 11.4 组件与状态

- Logo 固定，工作区触发器位于品牌下方。
- 管理 Dialog 的搜索、当前标记、角色和空状态。
- owner 显示重命名，editor/viewer 不显示。
- 切换严格等待旧保存。
- 保存失败时不调用选择且不替换内容。
- 旧保存完成后不能更新新工作区的保存状态。
- 创建成功自动切换。
- 移动端先关闭侧栏再打开 Dialog。
- `workspaceId` 变化会清理旧协作连接和临时 UI 状态。

### 11.5 端到端与最终验证

- 数据库模式创建第二工作区，分别编辑内容，往返切换并刷新验证隔离。
- 本地模式迁移旧 IndexedDB，创建第二工作区并刷新验证。
- owner 重命名，非 owner 被服务端拒绝。
- 延迟旧保存不能写入新工作区。
- 文件、历史和双窗口协作使用正确的工作区作用域。
- 运行全量 Vitest、TypeScript、生产构建、数据库冒烟和 Playwright。

## 12. 验收标准

- 旧浏览器本地内容升级后完整出现在“Nexus 工作区”。
- 新建工作区后立即进入独立空白文档。
- 数据库和本地模式均可列出、搜索、创建、切换和重命名工作区。
- 切回工作区时恢复当前用户在该工作区上次打开的文档。
- 刷新后恢复最后选择的工作区。
- owner 可以重命名，editor/viewer 无法通过 UI 或 API 重命名。
- 当前内容未保存时切换会等待；保存失败时保持原工作区。
- 内容、成员、历史、文件和 WebSocket 均不能跨工作区访问。
- 左上角 Nexus Logo 保持不变，管理入口和 Dialog 符合确认的布局。
- 删除、邀请、成员生命周期、账号设置和分享权限明确留在后续批次。
- README 更新多工作区能力、本地迁移、API、运行方式和下一批范围。
- PRD 当前实现状态更新为 M6 第一批已完成、M6 第二批待开发。
