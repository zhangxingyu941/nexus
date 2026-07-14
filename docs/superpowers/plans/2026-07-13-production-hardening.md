# 生产加固实施计划

> **致智能体工作者：** 必须使用子技能：superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 交付安全的混合认证、持久的多实例协作、可复现的容器部署和端到端生产验收，同时不丢失现有用户或工作区数据。

**架构：** 扩展现有的 PostgreSQL 支持的用户/会话模型，而非替换它。将认证、工作区权限、协作持久化、Redis 传输和 UI 作为独立的测试单元，通过现有服务边界连接。

**技术栈：** Next.js 15、React 18、PostgreSQL 16、Redis、Yjs、`@node-rs/argon2`、`arctic`、`nodemailer`、Vitest、Testing Library、Playwright、Docker Compose。

---

### 任务 1：认证架构和密码原语

**文件：**
- 修改：`src/server/database/migrations.ts`
- 修改：`src/server/postgresAuthStore.ts`
- 修改：`src/server/postgresAuthStore.test.ts`
- 创建：`src/server/passwordHasher.ts`
- 创建：`src/server/passwordHasher.test.ts`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`

- [x] 添加失败的迁移测试，证明遗留的 `app_users` 行存活并接收可为空的认证列，而 OAuth 账户、一次性令牌和审计事件强制执行唯一和外键约束。
- [x] 运行 `pnpm test --run src/server/postgresAuthStore.test.ts` 并确认新的断言失败，因为架构和 API 尚不存在。
- [x] 添加由 `schema_migrations` 保护的幂等迁移，用于 `password_hash`、`email_verified_at`、`updated_at`、`oauth_accounts`、`auth_tokens` 和 `auth_audit_events`。
- [x] 添加 `@node-rs/argon2`，实现 `PasswordHasher` 接口和具有生产参数的 Argon2id 适配器，然后测试有效、无效和格式错误的哈希。
- [x] 将会话创建重构为私有/共享方法，以便密码和 OAuth 流程可以颁发现有的不透明数据库会话，而无需重复处理令牌。
- [x] 运行聚焦测试和 `pnpm exec tsc --noEmit`。

### 任务 2：注册、登录、验证和重置域

**文件：**
- 修改：`src/server/postgresAuthStore.ts`
- 修改：`src/server/postgresAuthStore.test.ts`
- 创建：`src/server/authTokens.ts`
- 创建：`src/server/authTokens.test.ts`
- 创建：`src/server/authMailer.ts`
- 创建：`src/server/authMailer.test.ts`
- 修改：`src/server/applicationServices.ts`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`

- [x] 编写失败测试，覆盖注册规范化、12 字符密码最小长度、重复邮箱行为、通用登录失败、遗留无密码用户、验证令牌消费、重置过期、一次性使用和重置后所有会话撤销。
- [x] 运行聚焦测试并确认失败由缺少的域方法引起。
- [x] 添加仅存储 SHA-256 哈希并强制执行用途特定过期的令牌哈希和生成工具。
- [x] 添加 `nodemailer` 和邮件适配器，通过配置的 SMTP 发送或通过注入的日志记录器写入开发 URL；生产环境没有 SMTP 时必须失败邮件操作，且不在 HTTP 载荷中泄露令牌。
- [x] 在认证存储中实现 `register`、`loginWithPassword`、`verifyEmail`、`requestPasswordReset` 和 `resetPassword`，在多行变更时使用事务。
- [x] 保留现有 ID 和成员关系；遗留用户只能通过重置或已验证的 OAuth 关联设置密码。
- [x] 运行聚焦测试和 TypeScript。

### 任务 3：认证 API 和会话 Cookie

**文件：**
- 修改：`src/app/api/auth/session/handlers.ts`
- 修改：`src/app/api/auth/session/route.ts`
- 修改：`src/app/api/auth/session/route.test.ts`
- 创建：`src/app/api/auth/register/route.ts`
- 创建：`src/app/api/auth/register/route.test.ts`
- 创建：`src/app/api/auth/verify-email/route.ts`
- 创建：`src/app/api/auth/verify-email/route.test.ts`
- 创建：`src/app/api/auth/password/forgot/route.ts`
- 创建：`src/app/api/auth/password/forgot/route.test.ts`
- 创建：`src/app/api/auth/password/reset/route.ts`
- 创建：`src/app/api/auth/password/reset/route.test.ts`
- 修改：`src/server/sessionCookie.ts`

- [x] 编写失败的路由测试，覆盖验证、不泄露信息的错误、安全 Cookie 属性、通用忘记密码响应、过期/已使用的重置令牌和会话撤销。
- [x] 将会话 `POST` 从开发身份创建更改为邮箱/密码登录，同时在 PostgreSQL 不存在时保留本地模式行为。
- [x] 使用窄依赖接口实现注册、验证、忘记和重置处理程序，以便测试使用 pg-mem 支持的存储而非网络服务。
- [x] 确保每个状态变更路由仅接受 JSON、限制输入长度并返回稳定的 4xx 错误而非原始异常。
- [x] 运行所有认证路由测试和 TypeScript。

### 任务 4：GitHub OAuth 和安全账户关联

**文件：**
- 创建：`src/server/githubOAuth.ts`
- 创建：`src/server/githubOAuth.test.ts`
- 修改：`src/server/postgresAuthStore.ts`
- 修改：`src/server/postgresAuthStore.test.ts`
- 创建：`src/app/api/auth/oauth/config/route.ts`
- 创建：`src/app/api/auth/oauth/config/route.test.ts`
- 创建：`src/app/api/auth/oauth/github/route.ts`
- 创建：`src/app/api/auth/oauth/github/route.test.ts`
- 创建：`src/app/api/auth/oauth/github/callback/route.ts`
- 创建：`src/app/api/auth/oauth/github/callback/route.test.ts`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`

- [x] 添加失败测试，覆盖可选配置、state/PKCE Cookie、回调状态拒绝、已验证邮箱要求、现有提供者登录、已验证邮箱关联和新用户创建。
- [x] 添加 `arctic` 并在接口后面实现 GitHub 适配器，返回提供者 ID、显示名称和已验证的规范化邮箱。
- [x] 将 OAuth 事务状态和验证器存储在短期 HttpOnly SameSite=Lax Cookie 中，并在每次回调结果时清除它们。
- [x] 使用数据库唯一性作为最终的竞态条件防护，实现事务性账户关联。
- [x] 将提供者可用性隐藏在仅返回布尔值、从不返回客户端密钥的公共配置路由后面。
- [x] 运行 OAuth、认证存储和 TypeScript 检查。

### 任务 5：认证 UI

**文件：**
- 修改：`src/app/EditorApp.tsx`
- 修改：`src/app/EditorApp.test.tsx`
- 创建：`src/app/auth/verify/page.tsx`
- 创建：`src/app/auth/reset/page.tsx`
- 修改：`src/styles.css`

- [x] 添加失败的组件测试，覆盖登录/注册选项卡、密码登录载荷、注册确认、忘记密码流程、隐藏/显示的 GitHub 操作、遗留用户引导和重置/验证状态。
- [x] 用紧凑的 shadcn 风格登录和注册视图替换开发名称/邮箱输入表单，同时保留灰色/白色视觉系统和响应式行为。
- [x] 添加密码可见性控制、加载/禁用状态、无障碍标签、通用错误，且不在编辑器界面内放置功能描述文案。
- [x] 实现验证和重置页面，在提交后一次性消费 URL 令牌并从浏览器历史中移除敏感令牌。
- [x] 运行聚焦的 UI 测试和 TypeScript。

### 任务 6：Redis 限流和认证审计

**文件：**
- 创建：`src/server/authRateLimiter.ts`
- 创建：`src/server/authRateLimiter.test.ts`
- 修改：`src/server/redisSessionCache.ts`
- 修改：`src/server/redisSessionCache.test.ts`
- 修改：`src/server/postgresAuthStore.ts`
- 修改：`src/server/postgresAuthStore.test.ts`
- 修改：`src/server/applicationServices.ts`
- 修改：任务 3 和 4 中的认证路由处理程序

- [x] 编写失败测试，覆盖按邮箱和 IP 的时间窗口、哈希键、有界 TTL、成功尝试重置、生产安全失败行为和开发内存回退。
- [x] 用原子递增/过期操作扩展 Redis 边界，并为独立职责保持独立连接。
- [x] 在昂贵的密码或提供者操作之前，向注册、登录、重置和 OAuth 回调添加限流检查。
- [x] 为成功和失败插入脱敏的审计事件，不记录原始 IP、密码、令牌、OAuth 代码或会话值。
- [x] 运行限流、认证、路由、真实 Redis 和 TypeScript 检查。

### 任务 7：PostgreSQL Yjs 持久化

**文件：**
- 修改：`src/server/database/migrations.ts`
- 创建：`src/server/yjsPersistence.ts`
- 创建：`src/server/yjsPersistence.test.ts`
- 修改：`src/server/collaborationServer.ts`
- 修改：`src/server/collaborationServer.test.ts`
- 修改：`scripts/collaboration-server.ts`

- [x] 编写失败的 pg-mem/集成测试，覆盖房间快照加载、有序增量更新、重启重建、房间隔离和达到配置的数量/字节阈值后的压缩。
- [x] 添加工作区范围的 Yjs 快照和更新表，包含房间名称索引和事务性压缩支持。
- [x] 使用 `Y.applyUpdate` 和 `Y.encodeStateAsUpdate` 实现持久化；不解析或重新解释 CRDT 载荷。
- [x] 集成房间生命周期钩子，使房间在接受客户端之前加载、追加本地更新、在后台以序列化写入进行压缩，并在关闭前刷新。
- [x] 保持授权和持久化接口独立，并验证查看器拒绝仍然在房间创建之前发生。
- [x] 运行持久化、协作、TypeScript、迁移和真实 PostgreSQL 恢复检查。

### 任务 8：Redis 多实例协作发布/订阅

**文件：**
- 创建：`src/server/collaborationPubSub.ts`
- 创建：`src/server/collaborationPubSub.test.ts`
- 修改：`src/server/collaborationServer.ts`
- 修改：`src/server/collaborationServer.test.ts`
- 修改：`scripts/collaboration-server.ts`

- [x] 使用两个传输实例编写失败测试，证明更新传播、无自身回显、无重新发布循环、房间/租户隔离、感知传播以及 Redis 断开连接时的降级运行。
- [x] 为每个服务器进程实现一个发布者和一个订阅者连接，使用实例 ID 和房间特定通道。
- [x] 标记远程更新来源，使持久化仅记录每个逻辑更新一次，且发布/订阅消息不会被重新发出。
- [x] 保持感知的临时性并传播断开连接的客户端移除。
- [x] 在待处理的房间写入刷新后的优雅关闭期间关闭发布/订阅连接。
- [x] 运行协作、TypeScript、真实 Redis 传播和服务启动检查。

### 任务 9：Docker Compose 和运维配置

**文件：**
- 创建：`Dockerfile`
- 创建：`.dockerignore`
- 创建：`docker-compose.yml`
- 创建：`docker-compose.override.yml.example`
- 修改：`.env.example`
- 修改：`.gitignore`
- 修改：`README.md`
- 修改：`package.json`
- 创建：`scripts/healthcheck.ts`
- 创建：`scripts/healthcheck.test.ts`

- [x] 编写失败的配置测试，解析 Compose YAML/文本并断言 PostgreSQL、Redis、迁移、Web 和协作服务、健康检查、依赖条件、非 root 应用执行和持久卷。
- [x] 添加多阶段 Node 镜像，使用固定的 pnpm lockfile 安装、构建 Next.js standalone 输出并以非 root 用户运行。
- [x] 为 PostgreSQL、Redis AOF、一次性迁移、Next.js 和协作添加 Compose 服务，包含明确的健康/依赖连线。
- [x] 记录本地开发、生产密钥、GitHub 回调、SMTP、备份/恢复、迁移、启动、关闭和日志命令。
- [x] 确保 `.env` 和生成的密钥被忽略，而 `.env.example` 不包含真实凭据。
- [x] 运行配置测试、`docker compose config`、镜像构建、非 root 检查、持久卷检查和服务健康冒烟测试。

### 任务 10：端到端验收和最终审查

**文件：**
- 创建：`playwright.config.ts`
- 创建：`e2e/auth.spec.ts`
- 创建：`e2e/collaboration.spec.ts`
- 修改：`package.json`
- 修改：`README.md`
- 修改：`docs/prd.md`

- [x] 添加 Playwright 覆盖，覆盖注册、通过开发邮件捕获进行验证、密码登录、重置、GitHub 隐藏状态、编辑器持久化和双上下文协作。
- [x] 运行桌面和移动截图并检查重叠、裁剪、选项卡换行、空白画布/内容和不可访问的控件。
- [x] 运行 `pnpm test --run`、`pnpm exec tsc --noEmit`、`git diff --check` 和最终的 `pnpm build`。
- [x] 运行 `pnpm db:smoke`，重启协作服务，并证明持久化的 Yjs 房间恢复。
- [x] 运行 `docker compose up -d`，验证每个健康检查，然后针对 Compose 堆栈运行 E2E 套件。
- [x] 执行最终的安全/数据审查，重点关注账户枚举、令牌泄露、会话固定、租户隔离、查看器写入、OAuth 关联、Redis 回显循环和破坏性迁移。
- [x] 仅在证据确认每个完成声明后更新 README 和 PRD。
