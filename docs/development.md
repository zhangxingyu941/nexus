# Nexus 本地开发

## 前置条件

- Node.js 20+
- pnpm 10.12+
- PostgreSQL 16+
- Redis 7+

PostgreSQL 和 Redis 可以是本机服务，也可以由其他 Docker 容器提供；本地开发服务会按 `.env` 中的 `DATABASE_URL` 和 `REDIS_URL` 连接它们。

## 初始化

```bash
cp .env.example .env
pnpm install
pnpm auth:keygen
pnpm db:migrate
pnpm db:smoke
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
pnpm install
pnpm auth:keygen
pnpm db:migrate
pnpm db:smoke
```

`.env` 仅用于本机，私钥位于 `.secrets/`；二者均不应提交。至少设置可用的 `DATABASE_URL`、`REDIS_URL` 和长度不少于 32 字节的 `AUTH_HASH_SECRET`。

## 选择一种运行方式

不要同时运行本地 Web/协同服务和 Docker Compose 的 Web/协同服务，否则会产生 3000、3001、1234 或 1235 端口冲突。

### 本地应用开发

当 PostgreSQL 和 Redis 已按 `.env` 启动后，运行：

```bash
pnpm dev:fullstack
```

Web 默认监听 `http://localhost:3000`，协同服务默认监听 `ws://localhost:1234`。也可以分别运行 `pnpm dev` 与 `pnpm dev:collab`。

启动前运行 `pnpm db:smoke`。若出现 `ECONNREFUSED 127.0.0.1:5432`，先启动 PostgreSQL；若出现 `database "nexus" does not exist`，先运行 `pnpm db:migrate`。

### 完整 Docker Compose

完整 Compose 同时运行 PostgreSQL、Redis、迁移、Web 和协同服务，适合验收或接近生产的本地测试：

```bash
pnpm auth:keygen
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

查看日志：

```bash
docker compose logs -f web collaboration
```

停止服务但保留数据卷：

```bash
docker compose down
```

`docker compose down -v` 会删除 PostgreSQL、Redis 和上传文件卷，只应在确认不需要本地数据时使用。

## 常用检查

| 命令 | 目的 |
|---|---|
| `pnpm db:smoke` | 验证 `.env` 指向的 PostgreSQL 是否可用 |
| `pnpm test --run` | 运行单元与组件测试 |
| `pnpm test:postgres` | 运行真实 PostgreSQL 测试，需要 `TEST_DATABASE_URL` |
| `pnpm test:e2e` | 运行完整服务上的浏览器测试 |
| `pnpm exec tsc --noEmit` | 执行 TypeScript 类型检查 |
| `pnpm build` | 验证生产构建 |
| `docker compose config --quiet` | 验证 Compose 和环境变量插值 |

## 环境变量要点

| 变量 | 本地开发用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接，例如 `postgresql://postgres:password@127.0.0.1:5432/nexus` |
| `REDIS_URL` | Redis 连接，例如 `redis://127.0.0.1:6379` |
| `AUTH_HASH_SECRET` | 验证码、限流与邀请令牌 HMAC 密钥 |
| `AUTH_COOKIE_SECURE` | 本地 HTTP 通常设为 `false`；HTTPS 环境必须为 `true` |
| `NEXT_PUBLIC_COLLABORATION_URL` | 浏览器连接协同服务的 WebSocket 地址 |
| `SMTP_*` | 本地可使用真实 SMTP；E2E 可使用 `AUTH_MAIL_CAPTURE_FILE` 捕获邮件 |

完整变量说明与生产约束请查看[生产部署](deployment.md)。
