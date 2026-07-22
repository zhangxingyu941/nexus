# Nexus 生产部署

Nexus 使用 Docker Compose 运行 PostgreSQL、Redis、数据库迁移、Next.js Web 和协同 WebSocket 服务。当前部署方式适合单台 Linux 服务器；建议至少 2 核 4 GB 内存。2 核 2 GB 可以低负载运行，但不适合在服务器上频繁构建镜像。

## 1. 准备服务器

安装 Docker Engine、Docker Compose 插件和 Git。服务器需要能够拉取 Node、PostgreSQL 和 Redis 镜像，或在 `.env` 中配置可访问的镜像源。

克隆代码后，不要把 `.env` 或 `.secrets/` 提交到仓库：

```bash
git clone https://gitee.com/lz996/nexus.git
cd nexus
cp .env.example .env
```

## 2. 配置生产环境

在 `.env` 中至少设置下列变量：

```dotenv
POSTGRES_PASSWORD=<long-random-password>
AUTH_HASH_SECRET=<at-least-32-random-bytes>
AUTH_COOKIE_SECURE=true
AUTH_CREDENTIAL_KEY_ID=<generated-key-id>
AUTH_CREDENTIAL_PRIVATE_KEY_HOST_FILE=.secrets/auth-credential-private.pem

APP_URL=https://nexus.example.com
NEXT_PUBLIC_COLLABORATION_URL=wss://nexus.example.com/collaboration
COLLAB_ALLOWED_ORIGINS=https://nexus.example.com

SMTP_HOST=<smtp-host>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-authorization-code>
SMTP_FROM=Nexus <noreply@example.com>
```

生成 JWE 私钥：

```bash
pnpm auth:keygen
```

该命令会生成 `.secrets/auth-credential-private.pem` 并输出 `AUTH_CREDENTIAL_KEY_ID`。私钥必须保留在服务器并定期备份；不要提交或通过普通聊天、日志发送。

生产注册、密码重置和工作区邀请依赖 SMTP。若未配置 SMTP，应用可以启动，但相关邮件流程无法使用。

## 3. 启动与验证

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f web collaboration
```

`migrate` 服务会在 Web 与协同服务启动前执行幂等迁移。部署完成后访问：

```bash
curl --fail http://127.0.0.1:3000/api/health
```

## 4. HTTPS 与 WebSocket 反向代理

生产环境必须在 HTTPS/WSS 后运行，避免直接对公网暴露密码认证或明文 WebSocket。下面是单域名的 Caddy 示例：

```caddyfile
nexus.example.com {
  handle_path /collaboration/* {
    reverse_proxy 127.0.0.1:1234
  }

  handle {
    reverse_proxy 127.0.0.1:3000
  }
}
```

`handle_path` 会剥离 `/collaboration` 前缀，使协同服务收到的路径仍是 `workspace:{workspaceId}:document:{documentId}`。Caddy 会自动处理 WebSocket 升级与证书。

若使用 Nginx，需将 `/collaboration/` 代理至 `127.0.0.1:1234`、保留 WebSocket 升级头并移除该路径前缀。无论使用哪种代理，都应让 `APP_URL`、`NEXT_PUBLIC_COLLABORATION_URL` 和 `COLLAB_ALLOWED_ORIGINS` 与公开域名一致。

## 5. 更新

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Dockerfile 在镜像内部按 `pnpm-lock.yaml` 安装依赖，服务器宿主机不需要安装项目的 `node_modules`。如果服务器内存较小，建议由 CI 或另一台机器构建镜像后推送到镜像仓库，服务器只拉取成品镜像。

## 6. 备份与恢复

备份 PostgreSQL：

```bash
docker compose exec -T postgres pg_dump -U postgres -d nexus > nexus.sql
```

恢复 PostgreSQL：

```bash
cat nexus.sql | docker compose exec -T postgres psql -U postgres -d nexus
```

还需要备份：

- `uploads_data` Docker 卷或配置的 S3 bucket。
- `.env` 和 `.secrets/auth-credential-private.pem`。
- 生产数据库恢复演练记录。

不要执行 `docker compose down -v`，除非已验证备份且确认需要删除 PostgreSQL、Redis 和上传文件数据卷。

## 7. 运行维护

```bash
docker compose ps
docker stats
docker system df
df -h
free -h
```

40 GB 系统盘在低负载早期通常足够，但 Docker 构建缓存、数据库与上传文件会持续增长。定期清理无用构建缓存，并监控磁盘使用率；上传量增加后建议迁移到 S3 兼容对象存储。
