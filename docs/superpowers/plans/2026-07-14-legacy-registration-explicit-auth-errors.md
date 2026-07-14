# 遗留账号注册与明确认证错误实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复无密码遗留账号注册失败，并让所有认证业务错误向用户说明明确原因和下一步操作。

**Architecture:** 存储层使用带稳定代码的 `AuthDomainError` 表达预期业务失败，API 层统一映射为状态码和中文消息，未知内部错误仍被隔离。遗留账号在事务和行锁内补齐密码及验证码；前端沿用统一提示区，并补充网络和异常响应处理。

**Tech Stack:** Next.js 15、React 18、PostgreSQL、Nodemailer、Vitest、Testing Library、TypeScript

---

### Task 1：认证领域错误与遗留账号升级

**Files:**
- Create: `src/server/authErrors.ts`
- Modify: `src/server/postgresAuthStore.ts`
- Test: `src/server/postgresAuthStore.test.ts`

- [x] **Step 1：编写遗留账号升级和明确错误的失败测试**

覆盖 `createSession()` 产生的无密码遗留账号可注册、用户 ID 和工作区不变，以及以下错误：已注册邮箱、未完成注册密码不一致、邮箱不存在、邮箱未验证、密码错误、验证码未请求、验证码格式错误、验证码错误和验证码过期。

```ts
const legacy = await authStore.createSession({ displayName: "旧账号", email: "legacy@example.com" });
const registration = await authStore.register({
  displayName: "新姓名",
  email: legacy.user.email,
  password: "replacement secure password",
});
expect(registration.user.id).toBe(legacy.user.id);
await expect(authStore.loginWithPassword({
  email: legacy.user.email,
  password: "replacement secure password",
})).rejects.toThrow("邮箱尚未验证，请先输入邮件中的验证码");
```

- [x] **Step 2：运行存储层测试并确认按预期失败**

Run: `pnpm test --run src/server/postgresAuthStore.test.ts`

Expected: FAIL，现有代码返回“无法创建账号”或合并后的认证错误。

- [x] **Step 3：增加领域错误并实现事务升级**

`AuthDomainError` 包含稳定 `code` 和公开 `message`：

```ts
export class AuthDomainError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthDomainError";
  }
}
```

注册现有账号时执行 `SELECT ... FOR UPDATE`，按密码和验证状态分支；无密码未验证账号更新 `display_name`、`password_hash`、`updated_at` 并替换邮箱验证码，不创建新用户或工作区。

- [x] **Step 4：拆分登录和验证码错误**

登录分别抛出邮箱格式错误、邮箱未注册、账号未设置密码、邮箱未验证和密码错误。验证码查询先读取账号和最新未消费令牌，再分别抛出未请求、格式错误、过期和内容错误。

- [x] **Step 5：运行存储层测试确认通过**

Run: `pnpm test --run src/server/postgresAuthStore.test.ts`

Expected: PASS。

### Task 2：API 明确错误契约

**Files:**
- Create: `src/app/api/auth/authErrorResponse.ts`
- Modify: `src/app/api/auth/register/handlers.ts`
- Modify: `src/app/api/auth/session/handlers.ts`
- Modify: `src/app/api/auth/verify-email/handlers.ts`
- Modify: `src/app/api/auth/password/forgot/handlers.ts`
- Modify: `src/app/api/auth/password/forgot/route.ts`
- Modify: `src/app/api/auth/password/reset/handlers.ts`
- Modify: `src/app/api/auth/authSecurity.ts`
- Test: `src/app/api/auth/register/route.test.ts`
- Test: `src/app/api/auth/session/route.test.ts`
- Test: `src/app/api/auth/verify-email/route.test.ts`
- Test: `src/app/api/auth/password/forgot/route.test.ts`
- Test: `src/app/api/auth/password/reset/route.test.ts`

- [x] **Step 1：编写路由状态码和消息失败测试**

断言领域错误映射为明确响应，例如：

```ts
expect(response.status).toBe(409);
await expect(response.json()).resolves.toEqual({
  error: "该邮箱已注册，请直接登录或使用找回密码",
});
```

找回密码覆盖邮箱不存在 `404`、冷却 `429` 和 SMTP 失败 `503`；限流响应体包含 `retryAfterSeconds` 和具体剩余秒数。

- [x] **Step 2：运行认证路由测试确认失败**

Run: `pnpm test --run src/app/api/auth/register/route.test.ts src/app/api/auth/session/route.test.ts src/app/api/auth/verify-email/route.test.ts src/app/api/auth/password/forgot/route.test.ts src/app/api/auth/password/reset/route.test.ts`

Expected: FAIL，现有接口仍返回合并消息或统一成功响应。

- [x] **Step 3：实现统一领域错误响应**

`authErrorResponse` 只接受 `AuthDomainError`，按错误代码返回 `400/401/403/404/409/410`；未知错误不透传 `message`。

- [x] **Step 4：让找回密码等待邮件发送结果**

账号不存在直接返回 `404`；冷却返回 `429` 和秒数；邮件成功后返回 `202`，SMTP 抛错返回明确 `503`。移除 `after()` 调度依赖。

- [x] **Step 5：补充精确限流信息**

限流响应返回：

```ts
{
  error: `请求过于频繁，请在 ${decision.retryAfterSeconds} 秒后重试`,
  retryAfterSeconds: decision.retryAfterSeconds,
}
```

- [x] **Step 6：运行认证路由测试确认通过**

Run: `pnpm test --run src/app/api/auth/register/route.test.ts src/app/api/auth/session/route.test.ts src/app/api/auth/verify-email/route.test.ts src/app/api/auth/password/forgot/route.test.ts src/app/api/auth/password/reset/route.test.ts`

Expected: PASS。

### Task 3：前端错误展示与成功文案

**Files:**
- Modify: `src/app/AuthScreen.tsx`
- Test: `src/app/EditorApp.test.tsx`

- [x] **Step 1：编写前端失败测试**

覆盖 API 明确错误原样展示、`fetch` 网络失败显示“无法连接认证服务，请检查网络后重试”、非 JSON 响应显示“认证服务响应异常，请稍后重试”，以及找回密码成功显示实际邮箱。

- [x] **Step 2：运行 UI 测试确认失败**

Run: `pnpm test --run src/app/EditorApp.test.tsx`

Expected: FAIL，现有网络异常会直接展示底层错误，找回密码仍显示“如果账号存在”。

- [x] **Step 3：实现稳定请求错误和明确成功文案**

`requestAuth` 分别处理网络失败、响应解析失败和 API 业务失败；成功文案改为 `验证码已发送至 ${email.trim().toLowerCase()}`。

- [x] **Step 4：运行 UI 测试确认通过**

Run: `pnpm test --run src/app/EditorApp.test.tsx`

Expected: PASS。

### Task 4：文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/prd.md`
- Modify: `docs/superpowers/plans/2026-07-14-legacy-registration-explicit-auth-errors.md`

- [x] **Step 1：更新认证行为文档**

记录遗留账号迁移、明确错误提示和账号可枚举取舍，不记录任何 SMTP 凭据。

- [x] **Step 2：运行完整验证**

Run:

```bash
pnpm test --run
pnpm exec tsc --noEmit
pnpm db:smoke
git diff HEAD --check
```

Expected: 所有命令退出码为 `0`。遵循用户要求，本轮不重复运行 `pnpm build`。

- [x] **Step 3：完成计划状态**

全部验证通过后勾选计划项。保留当前未提交改动，不执行提交、合并、推送或回滚。

### Task 5：审查修复

- [x] 验证码消费和重发统一先锁用户行、再锁验证码行，避免 PostgreSQL 反向锁序。
- [x] 认证审计改为尽力写入，审计存储故障不覆盖明确业务响应。
- [x] 冷却响应增加 `codeAvailable`，找回密码首次命中冷却时进入验证码页并显示倒计时。
- [x] 注册和找回密码路由捕获 SMTP 配置初始化异常并返回明确 `503`。
- [x] 独立复核未发现剩余 Critical 或 Important 问题。
