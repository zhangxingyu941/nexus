# Nexus

> Notion 风格的协同块编辑器 — 基于 Next.js 15、Yjs、PostgreSQL 和 Redis 构建。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-compose-ready-blue.svg)](docker-compose.yml)

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 15、React 18、Tailwind CSS 4、shadcn/ui |
| 富文本 | TipTap（段落/标题/待办/引用/代码/图片/文件/表格/看板） |
| 实时协同 | Yjs CRDT + WebSocket Awareness |
| 数据库 | PostgreSQL 16（用户、权限、文档、协作持久化） |
| 缓存 | Redis 7（会话缓存、认证限流、多实例 Pub/Sub） |
| 认证 | Argon2id 密码哈希、GitHub OAuth（arctic）、Nodemailer |
| 部署 | Docker Compose、多阶段构建、非 root 运行 |
| 测试 | Vitest、Testing Library、Playwright |

## 功能一览

### 认证与安全
- 邮箱密码注册 / 登录，6 位邮箱验证码，密码重置
- GitHub OAuth（可选，未配置时自动隐藏入口）
- 遗留无密码用户原地升级（保留用户 ID、工作区和文档）
- Redis 限流（注册/登录/重置/OAuth），脱敏审计日志
- HttpOnly SameSite 会话 Cookie，30 天有效期
- 浏览器端 JWE（RSA-OAEP-256 + A256GCM）加密敏感凭据，密码和验证码永远不以明文传输
- 60 秒一次性 Challenge 防重放，Redis/内存原子消费

### 编辑器
- 9 种区块类型：段落、标题、待办、引用、代码、图片、文件、表格、看板
- Markdown 快捷键（`- ` → 无序列表，`# ` → 标题，`[] ` → 待办）
- Slash 菜单（`/` 唤起），区块拖拽、评论、协作头像
- 大文档虚拟列表，IndexedDB 离线兜底

### 协作与持久化
- Yjs 文本同步 + 结构同步 + Awareness（光标/在线状态）
- PostgreSQL CRDT 持久化（快照 + 增量更新，后台自动压缩）
- Redis 多实例 Pub/Sub，实例间实时同步，无回环
- 优雅关闭：刷新写入 → 断开 Redis → 关闭房间 → 关闭数据库

### 工作区
- 多工作区目录，支持创建、搜索、主动切换和 owner 重命名
- 每个工作区保存独立内容，并按用户记忆上次打开的文档
- 多文档管理、模板库、快速搜索、任务中心
- owner / editor / viewer 三级权限
- owner 可通过邮件邀请 editor 或 viewer；邀请在 24 小时后过期，可重发、撤销和从邀请中心接受或拒绝
- 邀请令牌只保存 HMAC，浏览器只使用 30 分钟、HttpOnly 的邀请上下文 Cookie；SMTP 发送失败会保留邀请并返回投递警告
- 支持多个 owner、角色调整、成员移除、主动退出和所有权转让；最后一名 owner 不能降级、移除或退出
- 成员角色或工作区访问被收回时，REST、文件和现有协作 WebSocket 连接都会失效
- owner 可按工作区名称确认软删除；删除后进入仅 owner 可见的 7 天回收站，可恢复，并会撤销待处理邀请
- 到期清理由请求触发：先删除该工作区对象存储前缀，再删除数据库记录；对象删除失败时保留 tombstone 以便下次重试
- 文档历史版本（完整快照 + 内容哈希去重）
- 本地文件存储 / S3 对象存储
- 成员、历史、文件对象和 Yjs 房间全部显式绑定 `workspaceId`

### 本地数据迁移
- 浏览器本地模式使用 IndexedDB v2 的工作区目录、内容和偏好对象仓库
- 首次打开时自动把 v1 `documents/workspace` 或单文档数据迁移为 `Nexus 工作区`
- 迁移完成后可创建第二个本地工作区；切换和刷新不会混用内容
- PostgreSQL 升级会回填旧工作区 owner 成员关系，并为没有任何成员关系的历史用户创建个人工作区

### 后续批次
- 账号设置：显示名称和密码变更、会话查看与撤销，以及经过独立验证的主邮箱变更
- M7：真实分享权限与页面权限；当前分享弹层仅保留界面交互，不代表服务端授权已生效

### 部署
- Docker Compose 一键启动（PostgreSQL + Redis + 迁移 + Web + 协作）
- 健康检查 + 依赖拓扑，服务按序启动
- 幂等数据库迁移，支持独立执行和历史用户工作区修复

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 10.12.1+
- PostgreSQL 16+（或使用 Docker）
- Redis 7+（或使用 Docker）

### 本地开发

```bash
# 安装依赖
cp .env.example .env          # 按需修改
pnpm install
pnpm auth:keygen              # 生成 JWE 认证密钥（首次）
pnpm db:migrate               # 初始化数据库

# 启动完整服务（Web + 协作）
pnpm dev:fullstack
```

| 服务 | 地址 |
|------|------|
| Web | http://localhost:3000 |
| 协作服务 | ws://localhost:1234 |

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 仅启动 Web |
| `pnpm dev:collab` | 仅启动协作服务 |
| `pnpm dev:fullstack` | Web + 协作一起启动 |
| `pnpm auth:keygen` | 生成 JWE 认证加密密钥（首次运行） |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:smoke` | 数据库连接冒烟测试 |
| `pnpm test --run` | 运行全部单元测试 |
| `pnpm test:postgres` | 运行需要真实 PostgreSQL 的并发与事务测试 |
| `pnpm test:e2e` | 运行 Playwright 端到端测试（需要完整服务） |
| `pnpm exec tsc --noEmit` | TypeScript 类型检查 |
| `pnpm build` | 生产构建 |
| `pnpm healthcheck <url>` | 健康检查 |

## Docker Compose

```bash
# 1. 配置环境变量（至少修改 POSTGRES_PASSWORD 和 AUTH_HASH_SECRET）
cp .env.example .env
pnpm auth:keygen              # 生成 JWE 认证密钥

# 2. 启动
docker compose up -d

# 3. 验证
docker compose ps
docker compose logs -f web collaboration

# 4. 停止
docker compose down         # 保留数据
docker compose down -v      # 删除所有数据卷
```

受限网络可参考 `docker-compose.override.yml.example` 配置镜像源。迁移可单独执行：

```bash
docker compose run --rm migrate
```

## 环境变量

### 必需

| 变量 | 说明 |
|------|------|
| `POSTGRES_PASSWORD` | PostgreSQL 密码 |
| `AUTH_HASH_SECRET` | HMAC 密钥（≥32 字节），用于验证码哈希和限流标识 |

### 认证

| 变量 | 说明 |
|------|------|
| `AUTH_COOKIE_SECURE` | `true`（HTTPS）/ `false`（本地 HTTP） |
| `REDIS_URL` | Redis 连接地址，生产限流必需 |
| `AUTH_CREDENTIAL_KEY_ID` | JWE 密钥标识（`pnpm auth:keygen` 自动生成） |
| `AUTH_CREDENTIAL_PRIVATE_KEY_FILE` | RSA 私钥文件路径（PEM，PKCS#8） |
| `AUTH_CREDENTIAL_PRIVATE_KEY_HOST_FILE` | Docker Compose 挂载的宿主机私钥路径 |
| `GITHUB_CLIENT_ID` | GitHub OAuth Client ID（可选） |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret（可选） |
| `APP_URL` | 对外可访问的 Web 地址；用于生成工作区邀请链接，未设置时为 `http://localhost:3000` |

### 邮件

| 变量 | 说明 |
|------|------|
| `SMTP_HOST` | SMTP 服务器（如 `smtp.qq.com`）；生产中的注册、重置和工作区邀请都需要配置 |
| `SMTP_PORT` | 端口（QQ 邮箱用 `465`） |
| `SMTP_SECURE` | 是否 SSL（`true`） |
| `SMTP_USER` | 发件邮箱 |
| `SMTP_PASSWORD` | 授权码（非登录密码） |
| `SMTP_FROM` | 发件人显示名，如 `Nexus <you@qq.com>` |

### 协作与存储

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_COLLABORATION_URL` | WebSocket 地址（公网用 `wss://`） |
| `COLLAB_ALLOWED_ORIGINS` | 允许的 Web Origin（逗号分隔） |
| `OBJECT_STORAGE_DRIVER` | `local`（默认）或 `s3` |

### 调试（仅开发/E2E）

| 变量 | 说明 |
|------|------|
| `AUTH_MAIL_CAPTURE_FILE` | 捕获验证码到文件，优先于 SMTP |
| `AUTH_MAIL_CAPTURE_ALLOW_PRODUCTION` | E2E 容器中临时启用捕获 |

## 数据库

### 表结构（19 张）

**认证**

| 表 | 说明 |
|---|---|
| `app_users` | 用户账号 |
| `auth_sessions` | 登录会话（token 哈希） |
| `auth_tokens` | 邮箱验证码 / 密码重置码 |
| `oauth_accounts` | GitHub OAuth 关联 |
| `auth_audit_events` | 认证审计日志 |

**工作区**

| 表 | 说明 |
|---|---|
| `editor_workspaces` | 工作区名称和时间戳 |
| `workspace_members` | 成员角色（owner / editor / viewer） |
| `workspace_preferences` | 用户当前工作区偏好 |
| `workspace_document_preferences` | 用户在每个工作区内的活动文档偏好 |
| `workspace_invites` | 邀请邮箱、角色、令牌 HMAC、状态、过期时间和投递状态 |
| `workspace_audit_events` | 邀请、成员和工作区生命周期的脱敏审计事件 |

`editor_workspaces` 还包含删除 tombstone：`deleted_at` 与固定为删除后 7 天的 `purge_after`。到期清理成功前不会删除该记录。

**内容**

| 表 | 说明 |
|---|---|
| `editor_documents` | 文档（标题、排序、置顶） |
| `editor_blocks` | 区块（9 种类型 + JSONB 扩展数据） |
| `block_relationships` | 区块父子嵌套关系 |
| `block_comments` | 区块评论（支持已解决状态） |

**协作与版本**

| 表 | 说明 |
|---|---|
| `yjs_room_snapshots` | Yjs 压缩快照（重启恢复） |
| `yjs_room_updates` | Yjs 增量更新日志 |
| `document_versions` | 文档历史版本快照 |

**系统**

| 表 | 说明 |
|---|---|
| `schema_migrations` | 幂等迁移记录 |

### 备份恢复

```bash
# 备份
docker compose exec -T postgres pg_dump -U postgres -d nexus > nexus.sql

# 恢复（Bash）
cat nexus.sql | docker compose exec -T postgres psql -U postgres -d nexus

# 恢复（PowerShell）
Get-Content -Raw .\nexus.sql | docker compose exec -T postgres psql -U postgres -d nexus
```

> 本地文件存储（`uploads_data` 卷）和 Redis AOF（`redis_data` 卷）也需同步备份。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth/session` | 获取当前会话 |
| `POST` | `/api/auth/session` | 密码登录 |
| `DELETE` | `/api/auth/session` | 登出 |
| `POST` | `/api/auth/register` | 注册 `{ displayName, email, password }` |
| `POST` | `/api/auth/verify-email` | 验证邮箱 `{ email, code }` |
| `POST` | `/api/auth/password/forgot` | 发送重置码 `{ email }` |
| `POST` | `/api/auth/password/reset` | 重置密码 `{ email, code, password }` |
| `GET` | `/api/auth/oauth/config` | OAuth 可用性 |
| `GET` | `/api/auth/oauth/github` | 发起 GitHub 登录 |
| `GET` | `/api/auth/oauth/github/callback` | GitHub 回调 |
| `GET` | `/api/workspaces` | 工作区目录和当前选择 |
| `POST` | `/api/workspaces` | 创建并选择工作区 |
| `GET` | `/api/workspaces/:workspaceId` | 获取指定工作区快照 |
| `PUT` | `/api/workspaces/:workspaceId` | 保存指定工作区内容 |
| `PATCH` | `/api/workspaces/:workspaceId` | owner 重命名指定工作区 |
| `POST` | `/api/workspaces/:workspaceId/select` | 主动选择指定工作区 |
| `GET` | `/api/workspaces/:workspaceId/members` | 获取指定工作区成员 |
| `PATCH` | `/api/workspaces/:workspaceId/members/:memberId` | owner 修改成员角色 |
| `DELETE` | `/api/workspaces/:workspaceId/members/:memberId` | owner 移除成员 |
| `POST` | `/api/workspaces/:workspaceId/leave` | 当前成员退出工作区 |
| `POST` | `/api/workspaces/:workspaceId/ownership-transfer` | owner 转让所有权，可保留自身 owner 角色 |
| `GET` / `POST` | `/api/workspaces/:workspaceId/invites` | owner 查看或创建邀请 |
| `POST` | `/api/workspaces/:workspaceId/invites/:inviteId/resend` | 重发邀请并轮换令牌 |
| `DELETE` | `/api/workspaces/:workspaceId/invites/:inviteId` | 撤销邀请 |
| `GET` | `/api/workspace-invites` | 当前用户的待处理邀请 |
| `POST` | `/api/workspace-invites/resolve` | 用一次性令牌建立短期邀请上下文 |
| `POST` | `/api/workspace-invites/:inviteId/accept` / `decline` | 接受或拒绝站内邀请 |
| `POST` | `/api/workspace-invites/accept` / `decline` | 接受或拒绝邮件邀请上下文 |
| `GET` | `/api/workspaces/:workspaceId/deletion-summary` | owner 获取删除前的成员、文档和文件统计 |
| `DELETE` | `/api/workspaces/:workspaceId` | owner 按工作区名称确认软删除 |
| `GET` | `/api/workspaces/trash` | 当前用户可恢复的 owner 工作区 |
| `POST` | `/api/workspaces/:workspaceId/restore` | 恢复 7 天保留期内的工作区 |
| `GET` | `/api/workspaces/:workspaceId/history/:documentId` | 获取指定文档历史 |
| `POST` | `/api/workspaces/:workspaceId/history/:documentId` | 恢复指定文档版本 |
| `POST` | `/api/files` | 上传文件，表单必须包含 `workspaceId` |
| `GET` | `/api/files/:workspaceId/:objectKey` | 获取工作区作用域文件 |

协作房间统一使用 `workspace:{workspaceId}:document:{documentId}`。服务端同时验证工作区成员关系和文档归属；文件对象 key 的第一段同样是提交并授权后的工作区 ID。

## 项目结构

```text
scripts/                       开发脚本、健康检查、协作服务、数据库工具
src/app/                       Next.js 页面与 API routes
src/app/api/auth/              认证 API（注册/登录/验证/重置/OAuth）
src/components/ui/             shadcn/ui 基础组件
src/features/editor/           编辑器核心
  collaboration/                 Yjs 协同与工作区映射
  components/                    区块编辑器、文档组件、侧边栏
  model/                         工作区与文档数据模型
  persistence/                   IndexedDB 与文档历史持久化
  session/                       会话类型定义
src/server/                    服务端
  database/                      连接池与迁移
  authTokens.ts                  验证码生成与 HMAC 哈希
  authMailer.ts                  邮件发送（QQ SMTP 兼容）
  authRateLimiter.ts             Redis 限流
  postgresAuthStore.ts           认证数据访问
  postgresWorkspaceStore.ts      工作区数据访问
  postgresWorkspaceInviteStore.ts 工作区邀请数据访问
  postgresWorkspaceMemberStore.ts 成员与所有权生命周期
  postgresWorkspaceLifecycleStore.ts 删除、回收站与恢复
  workspacePurgeService.ts       对象优先的到期永久清理
  collaborationServer.ts         WebSocket 协作服务
  collaborationPubSub.ts         Redis 多实例发布订阅
  yjsPersistence.ts              Yjs CRDT PostgreSQL 持久化
  passwordHasher.ts              Argon2id 密码哈希
  githubOAuth.ts                 GitHub OAuth 适配器
  objectStorage.ts               文件存储（local / S3）
src/test/                      测试初始化与夹具
e2e/                           Playwright 端到端测试
```

## License

MIT
