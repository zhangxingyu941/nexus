# Notion Block Editor

基于 Next.js 15、TipTap、Yjs、PostgreSQL、Redis、Tailwind CSS 4 和 shadcn 风格组件构建的协同块编辑器。

## 已实现能力

- 邮箱密码注册/登录、6 位邮箱验证码注册与找回密码、HttpOnly 会话和可选 GitHub OAuth。
- Redis 认证限流、脱敏审计、会话缓存和生产环境故障关闭。
- 多文档工作区、模板、搜索、任务、评论、历史版本和 owner/editor/viewer 权限。
- 段落、标题、待办、引用、代码、图片、文件、表格和看板块。
- Yjs 文本/结构同步、Awareness、PostgreSQL CRDT 持久化和 Redis 多实例 Pub/Sub。
- IndexedDB 离线兜底、本地/S3 对象存储和大文档虚拟列表。
- Docker Compose 一键启动 PostgreSQL、Redis、迁移、Web 和协作服务。

## 本地开发

准备 Node.js 20+、pnpm 10.12.1、PostgreSQL 16 和 Redis 7，然后配置 `.env`：

```bash
pnpm install
pnpm db:migrate
pnpm dev:fullstack
```

默认地址：

- Web：`http://localhost:3000`
- 协作服务：`ws://localhost:1234`

常用命令：

```bash
pnpm dev
pnpm dev:collab
pnpm dev:fullstack
pnpm db:migrate
pnpm db:smoke
pnpm test --run
pnpm exec tsc --noEmit
pnpm build
pnpm healthcheck http://127.0.0.1:3000/api/health
```

## Docker Compose

根据 `.env.example` 创建本地 `.env`，至少替换 `POSTGRES_PASSWORD` 和 `AUTH_HASH_SECRET`。受限网络可以参考 `docker-compose.override.yml.example` 配置镜像源。

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

服务健康后访问 `http://localhost:3000`。停止和查看日志：

```bash
docker compose logs -f web collaboration
docker compose down
docker compose down -v  # 同时删除数据库、Redis 和上传卷
```

迁移是幂等的，可单独执行：

```bash
docker compose run --rm migrate
```

## 生产配置

- `AUTH_HASH_SECRET`：至少 32 个随机字节，用于验证码、限流标识和审计 IP 的 HMAC；不要提交到 Git。
- `AUTH_COOKIE_SECURE`：HTTPS/WSS 部署保持 `true`；仅本地 HTTP/WS 开发或验收时设为 `false`。
- `REDIS_URL`：生产认证限流必需；Redis 不可用时认证接口故障关闭，现有本地协作仍可继续。
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`：可选。GitHub OAuth 回调地址为 `https://<host>/api/auth/oauth/github/callback`。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`：生产发送 6 位注册和找回密码验证码必需。验证码 10 分钟有效，仅最新一枚可用。
- `AUTH_MAIL_CAPTURE_FILE`：仅供 E2E 捕获验证码，配置后优先于 SMTP；正式环境不要配置。
- `COLLAB_ALLOWED_ORIGINS`：只填写可信 Web Origin；多项用逗号分隔。
- `NEXT_PUBLIC_COLLABORATION_URL`：构建时注入的浏览器 WebSocket 地址，公网部署应使用 `wss://`。
- `OBJECT_STORAGE_DRIVER`：默认 `local`；生产可改为 `s3` 并配置对应 `S3_*` 变量。

QQ 邮箱 SMTP 使用授权码，不使用 QQ 登录密码：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-account@qq.com
SMTP_PASSWORD=qq-mail-authorization-code
SMTP_FROM=Nexus <your-account@qq.com>
```

## 备份恢复

备份 PostgreSQL：

```bash
docker compose exec -T postgres pg_dump -U postgres -d notion_block_editor > notion-block-editor.sql
```

在 Bash 中恢复：

```bash
cat notion-block-editor.sql | docker compose exec -T postgres psql -U postgres -d notion_block_editor
```

在 PowerShell 中恢复：

```powershell
Get-Content -Raw .\notion-block-editor.sql | docker compose exec -T postgres psql -U postgres -d notion_block_editor
```

本地对象文件位于 `uploads_data` 卷，Redis AOF 位于 `redis_data` 卷；生产备份应同时快照这些卷。

## API

- `GET /api/health`
- `GET|POST|DELETE /api/auth/session`
- `POST /api/auth/register`：`{ displayName, email, password }`
- `POST /api/auth/verify-email`：`{ email, code }`
- `POST /api/auth/password/forgot`：`{ email }`
- `POST /api/auth/password/reset`：`{ email, code, password }`
- `GET /api/auth/oauth/config`
- `GET /api/auth/oauth/github`
- `GET /api/auth/oauth/github/callback`
- `GET|PUT /api/workspace`
- `GET|POST /api/workspace/members`
- `GET|POST /api/history/:documentId`
- `POST /api/files`
- `GET /api/files/:key`

## 项目结构

```text
scripts/                     数据库、健康检查、协作服务和开发脚本
src/app/                     Next.js 页面与 API routes
src/components/ui/           shadcn 风格基础组件
src/features/editor/         编辑器组件、模型、协同和持久化
src/server/                  认证、PostgreSQL、Redis、对象存储和协作服务
src/test/                    测试初始化与测试专用夹具
```
