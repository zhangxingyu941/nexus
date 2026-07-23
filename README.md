# Nexus

Nexus 是一个面向小型团队的协作文档工作台。它将块编辑、结构化富文本、工作区权限、实时协同和 PostgreSQL 持久化组合在同一个可自托管应用中。

## 核心能力

- 块编辑器：段落、标题、待办、引用、代码、图片、文件、表格和看板。
- 结构化富文本：基于 TipTap/ProseMirror，支持常用行内格式、安全链接、mention 和块内换行。
- 块操作与 Markdown：多块选择、批量编辑和键盘/触摸拖拽；支持安全的 Markdown 与附件 ZIP 导入导出。
- 团队协作：Yjs 实时同步、光标感知、PostgreSQL 持久化与 Redis 多实例同步。
- 工作区：owner、editor、viewer 三级角色；成员邀请、角色调整、所有权转让、回收站与恢复。
- 文档权限：私有、团队、链接只读三种策略，以及可过期、可撤销的匿名分享链接。
- 认证：邮箱密码、验证码、密码重置与可选 GitHub OAuth。

## 架构

| 服务 | 职责 |
|---|---|
| Next.js Web | 页面、API、认证、权限与文件访问 |
| 协同服务 | Yjs WebSocket、Awareness 与房间生命周期 |
| PostgreSQL | 用户、工作区、文档、权限、版本和 Yjs 更新 |
| Redis | 认证限流、会话缓存与多实例协同 Pub/Sub |
| 对象存储 | 本地卷或 S3 兼容存储中的附件 |

## 快速开始

完整 Docker Compose 是体验 Nexus 的最快方式。需要 Docker、Docker Compose，以及用于生成认证密钥的 Node.js 20+ 和 pnpm 10.12+。

```bash
cp .env.example .env
# 编辑 .env，至少设置 POSTGRES_PASSWORD 和 AUTH_HASH_SECRET
pnpm auth:keygen
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

默认 Web 地址为 `http://localhost:3000`，协同服务地址为 `ws://localhost:1234`。

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
pnpm auth:keygen
docker compose up -d --build
```

## 文档

- [功能与使用路径](docs/features.md)：角色、邀请、分享和协作能力。
- [本地开发](docs/development.md)：环境准备、脚本、验证与本地服务选择。
- [生产部署](docs/deployment.md)：环境变量、HTTPS/WSS、Docker Compose、备份和更新。
- [M7 状态](docs/m7-status-zh.md)：文档权限与匿名分享的实现及验证状态。
- [M8 状态](docs/m8-status-zh.md)：结构化富文本、多块操作、Markdown 文档交换与后续编辑体验路线。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 只启动 Next.js Web 开发服务 |
| `pnpm dev:collab` | 只启动本地协同服务 |
| `pnpm dev:fullstack` | 同时启动 Web 和协同服务 |
| `pnpm db:migrate` | 执行 PostgreSQL 迁移 |
| `pnpm db:smoke` | 检查数据库连接与基础查询 |
| `pnpm auth:keygen` | 生成 JWE 私钥与密钥标识 |
| `pnpm test --run` | 运行 Vitest 测试 |
| `pnpm test:postgres` | 运行真实 PostgreSQL 测试 |
| `pnpm test:e2e` | 运行 Playwright 端到端测试 |
| `pnpm build` | 生成 Next.js 生产构建 |

## 开源协议

MIT
