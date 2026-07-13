# 验证码重发冷却与邮件样式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持验证码 10 分钟有效的基础上，为同一账号增加服务端 60 秒重发冷却、前端倒计时，并发送灰白简约 HTML 邮件。

**Architecture:** PostgreSQL 继续保存验证码 HMAC，并以 `auth_tokens.created_at` 作为冷却时间源；账号行锁串行化并发重发。API 返回稳定的冷却秒数，前端只负责倒计时反馈。邮件器同时生成纯文本和内联 CSS HTML，不引入模板依赖。

**Tech Stack:** Next.js 15、React 18、PostgreSQL、Nodemailer、Vitest、Testing Library、Tailwind CSS 4。

---

### Task 1：PostgreSQL 验证码冷却

**Files:**
- Modify: `src/server/postgresAuthStore.ts`
- Modify: `src/server/postgresAuthStore.test.ts`

- [x] **Step 1：编写冷却边界失败测试**

把测试时钟改为可变变量，并覆盖发送后第 59 秒拒绝、第 60 秒允许：

```ts
let now: number;

beforeEach(() => {
  now = 1000;
  authStore = new PostgresAuthStore(pool, workspaceStore, {
    now: () => now,
    // 保留现有测试依赖
  });
});

await authStore.register(validRegistration);
now += 59_000;
await expect(authStore.register(validRegistration)).rejects.toMatchObject({
  retryAfterSeconds: 1,
});
now += 1_000;
await expect(authStore.register(validRegistration)).resolves.toMatchObject({ code: "654321" });
```

- [x] **Step 2：运行测试确认按预期失败**

Run: `pnpm test --run src/server/postgresAuthStore.test.ts`

Expected: FAIL，现有实现会在 59 秒时直接生成新验证码。

- [x] **Step 3：实现类型化冷却错误与事务锁**

在认证存储中增加公开常量和错误类型：

```ts
export const AUTH_CODE_COOLDOWN_SECONDS = 60;
const AUTH_CODE_COOLDOWN_MS = AUTH_CODE_COOLDOWN_SECONDS * 1000;

export class AuthCodeCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`请在 ${retryAfterSeconds} 秒后重新发送验证码`);
    this.name = "AuthCodeCooldownError";
  }
}
```

已有账号重发和密码重置验证码创建都必须在事务中先执行账号行锁，再检查最近验证码：

```ts
await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
const latest = await client.query(
  `SELECT created_at FROM auth_tokens
   WHERE user_id = $1 AND purpose = $2
   ORDER BY created_at DESC LIMIT 1`,
  [userId, purpose],
);
const retryAfterMs = Number(latest.rows[0]?.created_at ?? 0) + AUTH_CODE_COOLDOWN_MS - now;
if (retryAfterMs > 0) {
  throw new AuthCodeCooldownError(Math.ceil(retryAfterMs / 1000));
}
```

检查通过后才删除旧验证码并调用现有 `insertAuthCode`。10 分钟 `expires_at` 逻辑保持不变。

- [x] **Step 4：增加密码重置与并发测试**

覆盖两种用途独立计算、冷却时不替换旧码，以及同账号两个并发请求只有一个成功：

```ts
const results = await Promise.allSettled([
  authStore.createPasswordReset(user.email),
  authStore.createPasswordReset(user.email),
]);
expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
```

- [x] **Step 5：运行存储测试和类型检查**

Run: `pnpm test --run src/server/postgresAuthStore.test.ts && pnpm exec tsc --noEmit`

Expected: PASS。

### Task 2：API 冷却响应与防枚举

**Files:**
- Modify: `src/app/api/auth/register/handlers.ts`
- Modify: `src/app/api/auth/register/route.test.ts`
- Modify: `src/app/api/auth/password/forgot/handlers.ts`
- Modify: `src/app/api/auth/password/forgot/route.test.ts`

- [x] **Step 1：编写注册 429 失败测试**

模拟 `AuthCodeCooldownError(37)`，断言状态、头和响应体：

```ts
expect(response.status).toBe(429);
expect(response.headers.get("Retry-After")).toBe("37");
await expect(response.json()).resolves.toEqual({
  error: "请在 37 秒后重新发送验证码",
  retryAfterSeconds: 37,
});
expect(mailer.sendEmailVerificationCode).not.toHaveBeenCalled();
```

- [x] **Step 2：编写找回密码不可枚举失败测试**

让认证存储依次返回验证码、`null`、抛出冷却错误，三次都必须得到相同响应：

```ts
expect(existing.status).toBe(202);
expect(missing.status).toBe(202);
expect(coolingDown.status).toBe(202);
await expect(existing.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
await expect(missing.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
await expect(coolingDown.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
```

- [x] **Step 3：运行路由测试确认失败**

Run: `pnpm test --run src/app/api/auth/register/route.test.ts src/app/api/auth/password/forgot/route.test.ts`

Expected: FAIL，当前注册没有 429 映射，找回密码也未返回冷却秒数。

- [x] **Step 4：实现响应映射**

注册成功返回 `{ registered: true, retryAfterSeconds: AUTH_CODE_COOLDOWN_SECONDS }`。捕获 `AuthCodeCooldownError` 时返回：

```ts
return NextResponse.json(
  { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
  {
    headers: { "Retry-After": String(error.retryAfterSeconds) },
    status: 429,
  },
);
```

找回密码仅吞掉 `AuthCodeCooldownError`，其他异常继续上抛；无论账号不存在或处于冷却期，最终都返回统一 `202` 响应，冷却期间不调用邮件器。

- [x] **Step 5：运行认证路由测试**

Run: `pnpm test --run src/app/api/auth/register/route.test.ts src/app/api/auth/password/forgot/route.test.ts`

Expected: PASS。

### Task 3：灰白简约 HTML 邮件

**Files:**
- Modify: `src/server/authMailer.ts`
- Modify: `src/server/authMailer.test.ts`

- [x] **Step 1：编写 HTML 邮件失败测试**

断言传给 Nodemailer 的内容同时包含 `text` 和 `html`，并验证显示名称转义：

```ts
const unsafeUser = { ...user, displayName: '<script>alert("x")</script>' };
await mailer.sendEmailVerificationCode(unsafeUser, "123456");
const message = transport.sendMail.mock.calls[0][0];
expect(message.text).toContain("123456");
expect(message.html).toContain("123456");
expect(message.html).toContain("&lt;script&gt;");
expect(message.html).not.toContain("<script>");
expect(message.html).toContain("10 分钟内有效");
```

- [x] **Step 2：运行邮件测试确认失败**

Run: `pnpm test --run src/server/authMailer.test.ts`

Expected: FAIL，当前邮件没有 `html` 字段。

- [x] **Step 3：实现无外部资源的邮件模板**

新增 HTML 转义函数和共享模板函数。模板使用 560px 表格、白色正文、`#f4f4f5` 页面背景、`#e4e4e7` 边框和不超过 8px 圆角；验证码使用等宽字体和独立内联元素间距，不使用 CSS `letter-spacing`、渐变、图片或远程字体。

`deliver` 输入增加 `html`，并把两种正文一起传给 Nodemailer：

```ts
await this.options.transport.sendMail({
  from: this.options.from,
  html: input.html,
  subject: input.subject,
  text: input.text,
  to: input.to,
});
```

- [x] **Step 4：运行邮件测试**

Run: `pnpm test --run src/server/authMailer.test.ts`

Expected: PASS，且邮件主题、日志和 API 响应均不出现验证码。

### Task 4：前端 60 秒倒计时

**Files:**
- Modify: `src/app/AuthScreen.tsx`
- Modify: `src/app/EditorApp.test.tsx`

- [ ] **Step 1：编写注册和找回密码倒计时失败测试**

使用 Vitest 可控时钟，注册成功后断言：

```ts
expect(screen.getByRole("button", { name: "重新发送（60s）" })).toBeDisabled();
await vi.advanceTimersByTimeAsync(1_000);
expect(screen.getByRole("button", { name: "重新发送（59s）" })).toBeDisabled();
await vi.advanceTimersByTimeAsync(59_000);
expect(screen.getByRole("button", { name: "重新发送验证码" })).toBeEnabled();
```

再覆盖注册重发返回 `429 { retryAfterSeconds: 37 }` 后按钮显示 `37s`，以及找回密码进入重置模式后同样倒计时。

- [ ] **Step 2：运行 UI 测试确认失败**

Run: `pnpm test --run src/app/EditorApp.test.tsx`

Expected: FAIL，当前重发按钮始终可用且响应类型不读取 `retryAfterSeconds`。

- [ ] **Step 3：实现服务端秒数驱动的截止时间**

扩展认证响应类型，并保留错误中的冷却秒数：

```ts
class AuthRequestError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthRequestError";
  }
}
```

使用 `Date.now() + seconds * 1000` 保存重发截止时间，定时计算向上取整的剩余秒数。注册和找回密码首次成功后启动 60 秒；注册 `429` 时按服务端秒数纠正倒计时。重发按钮使用：

```tsx
<Button disabled={isSubmitting || resendSeconds > 0}>
  {resendSeconds > 0 ? `重新发送（${resendSeconds}s）` : "重新发送验证码"}
</Button>
```

切换离开验证码模式或组件卸载时清理计时器。

- [ ] **Step 4：运行 UI 测试**

Run: `pnpm test --run src/app/EditorApp.test.tsx`

Expected: PASS。

### Task 5：文档与最终验证

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/prd.md`
- Modify: `docs/superpowers/plans/2026-07-13-auth-code-cooldown-email.md`

- [ ] **Step 1：更新说明**

README 和 PRD 明确验证码 10 分钟有效、同账号 60 秒内不可重发、前端有倒计时、QQ SMTP 同时发送纯文本和兼容 HTML。配置示例不增加真实凭据。

- [ ] **Step 2：运行完整验证**

Run:

```bash
pnpm test --run
pnpm exec tsc --noEmit
pnpm db:smoke
git diff HEAD --check
pnpm build
```

Expected: 所有命令退出码为 0。只在源码全部完成后执行一次生产构建。

- [ ] **Step 3：最终安全检查**

确认：

- 原始验证码不进入数据库、API 响应、邮件主题或日志。
- 找回密码的不存在账号与冷却账号响应一致。
- `AUTH_MAIL_CAPTURE_FILE` 仍只用于 E2E。
- SMTP 授权码未进入任何非 `.env` 文件。
- UI 倒计时无法替代或绕过 PostgreSQL 冷却。

- [ ] **Step 4：完成计划状态**

所有验证通过后，把本计划复选框改为 `[x]`，保留用户现有未提交改动，不执行未授权的提交、合并或回滚。
