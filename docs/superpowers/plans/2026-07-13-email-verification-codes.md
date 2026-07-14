# 邮件验证码实现计划

> **致智能体工作者：** 必须使用子技能：superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 用通过 QQ SMTP 发送的安全六位数字验证码取代邮件链接注册和密码重置。

**架构：** 保留现有的 `auth_tokens` 表和用途值，但存储 `userId + purpose + code` 的 HMAC，这样低熵码无法从数据库转储中恢复。将注册、验证、重置、邮件发送和 UI 作为独立的测试边界；验证和重置返回现有的不透明会话 Cookie。

**技术栈：** Next.js 15、React 18、PostgreSQL、Redis、Nodemailer、Vitest、Testing Library、Playwright、QQ SMTP。

---

### 任务 1：验证码原语和认证存储

**文件：**
- 修改：`src/server/authTokens.ts`
- 修改：`src/server/authTokens.test.ts`
- 修改：`src/server/postgresAuthStore.ts`
- 修改：`src/server/postgresAuthStore.test.ts`
- 修改：`src/server/applicationServices.ts`

- [x] 添加失败测试，证明验证码恰好为六位数字、哈希需要 `AUTH_HASH_SECRET`、相同验证码对不同用户/用途产生不同哈希，以及原始验证码绝不会进入 `auth_tokens`。
- [x] 添加失败的存储测试，覆盖 10 分钟过期、一次性使用、仅最新验证码行为、未验证注册使用相同密码重发、邮件验证后直接颁发会话，以及使用 `{ email, code, password }` 进行重置。
- [x] 用 `createAuthCode` 和基于 `userId:purpose:code` 的 HMAC 哈希替换原始 SHA-256 链接令牌。
- [x] 将令牌相关存储字段重命名为 `code`，在验证/重置期间要求规范化的邮箱，并保持所有变更的事务性。
- [x] 从 `createPostgresServices` 传递 `AUTH_HASH_SECRET`；生产环境没有该密钥时必须安全失败。
- [x] 运行 `pnpm test --run src/server/authTokens.test.ts src/server/postgresAuthStore.test.ts` 和 `pnpm exec tsc --noEmit`。

### 任务 2：QQ 兼容邮件和 API 契约

**文件：**
- 修改：`src/server/authMailer.ts`
- 修改：`src/server/authMailer.test.ts`
- 修改：`src/app/api/auth/register/handlers.ts`
- 修改：`src/app/api/auth/register/route.test.ts`
- 修改：`src/app/api/auth/verify-email/handlers.ts`
- 修改：`src/app/api/auth/verify-email/route.test.ts`
- 修改：`src/app/api/auth/password/forgot/handlers.ts`
- 修改：`src/app/api/auth/password/forgot/route.test.ts`
- 修改：`src/app/api/auth/password/reset/handlers.ts`
- 修改：`src/app/api/auth/password/reset/route.test.ts`
- 修改：`src/server/authRequestSecurity.ts`
- 修改：`src/server/authRequestSecurity.test.ts`

- [x] 添加失败的邮件测试，断言注册和重置消息包含六位验证码、用途、过期时间、收件人，且不包含重置/验证 URL。
- [x] 将验收捕获记录从 `url` 改为 `code`；当同时配置了显式捕获和 SMTP 时，显式捕获必须覆盖 SMTP。
- [x] 将验证改为 `{ email, code }`，重置改为 `{ email, code, password }`；返回已验证/重置的用户并设置现有的会话 Cookie。
- [x] 添加 `verify-email` Redis 限制，并使用邮箱（而非验证码）作为验证码尝试的限流标识。
- [x] 保留不泄露信息的忘记密码响应和通用的验证码无效/过期错误。
- [x] 运行所有认证邮件、路由、限流和 TypeScript 检查。

### 任务 3：内联注册和重置 UI

**文件：**
- 修改：`src/app/AuthScreen.tsx`
- 修改：`src/app/EditorApp.test.tsx`
- 删除：`src/app/auth/verify/page.tsx`
- 删除：`src/app/auth/verify/page.test.tsx`
- 删除：`src/app/auth/reset/page.tsx`
- 删除：`src/app/auth/reset/page.test.tsx`

- [x] 添加失败的组件测试，覆盖注册验证码输入、验证载荷、重发状态、重置验证码/新密码输入、直接认证跳转、加载状态和验证码无效错误。
- [x] 实现显式的 `register-code` 和 `reset-code` 模式，包含一一对应的 `email`、`code` 和 `password` 字段。
- [x] 使用 `inputMode="numeric"`、`autoComplete="one-time-code"`、六字符限制和验证码输入的无障碍标签。
- [x] 在内联流程通过后删除仅限链接的页面和引用。
- [x] 运行聚焦的 UI 测试和 TypeScript。

### 任务 4：QQ SMTP 配置和验收

**文件：**
- 修改：`.env.example`
- 修改：`docker-compose.yml`
- 修改：`README.md`
- 修改：`e2e/auth.spec.ts`
- 修改：`e2e/support.ts`
- 修改：`docs/prd.md`

- [x] 在被忽略的本地 `.env` 中配置 `smtp.qq.com`、端口 `465`、启用 SSL、QQ 账号、发件人和授权码；永远不要将授权码放在受版本控制的文件中。
- [x] 更新 E2E 邮件捕获辅助工具以读取验证码，并通过内联表单覆盖注册验证和密码重置。
- [x] 运行 `pnpm test --run`、`pnpm exec tsc --noEmit`、`git diff --check` 和最终的生产构建。
- [x] 重新构建 Web 镜像一次，使用验收捕获和本地不安全 Cookie 覆盖重新创建它，然后运行 `pnpm test:e2e`。
- [x] 使用 QQ SMTP 重新创建 Web，向配置的 QQ 邮箱发送真实的验证码，并确认 SMTP 传输接受该消息且不记录授权码。
- [x] 仅在所有证据为绿色后更新 README 和 PRD。
