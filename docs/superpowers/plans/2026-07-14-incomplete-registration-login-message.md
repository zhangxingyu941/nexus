# 未完成注册登录消息实施计划

> **致自动化代理：** 必需子技能：请使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将未验证账号的不可操作密码登录消息替换为"该邮箱尚未完成注册，请先完成注册再登录"，同时保留现有的错误码、HTTP 状态和认证流程。

**架构：** 保留 `email_not_verified` 作为存储层领域状态，并保留其现有的 HTTP `403` API 映射。仅更改集中化的用户可见消息，并通过存储集成测试证明新注册和遗留账号升级路径均返回新文案。

**技术栈：** TypeScript、Vitest、pg-mem、Next.js 认证路由

---

### 任务 1：更新未完成注册登录消息

**文件：**
- 修改：`src/server/postgresAuthStore.test.ts:204`
- 修改：`src/server/postgresAuthStore.test.ts:413`
- 修改：`src/server/authErrors.ts:30`

- [ ] **步骤 1：将两个集成测试期望更改为已批准的消息**

在 `src/server/postgresAuthStore.test.ts` 中，将现有的两个未验证登录断言替换为：

```ts
await expect(authStore.loginWithPassword({
  email: legacySession.user.email,
  password: "replacement secure password",
})).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");
```

以及：

```ts
await expect(authStore.loginWithPassword({
  email: "linxia@example.com",
  password: "correct horse battery staple",
})).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");
```

- [ ] **步骤 2：运行聚焦测试并验证新期望失败**

运行：

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts -t "upgrades a credentialless legacy account|verifies email once"
```

预期结果：两个选定测试均 FAIL，因为实现仍然返回 `邮箱尚未验证，请先输入邮件中的验证码`。

- [ ] **步骤 3：进行最小化的集中消息更改**

在 `src/server/authErrors.ts` 中，仅更改 `email_not_verified` 的值：

```ts
email_not_verified: "该邮箱尚未完成注册，请先完成注册再登录",
```

不要更改 `AuthErrorCode`、`AUTH_ERROR_STATUS`、`loginWithPassword` 或前端请求处理。

- [ ] **步骤 4：运行聚焦测试并验证通过**

运行：

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts -t "upgrades a credentialless legacy account|verifies email once"
```

预期结果：两个选定测试均 PASS。

- [ ] **步骤 5：运行认证回归测试**

运行：

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts src/app/api/auth/session/route.test.ts src/app/EditorApp.test.tsx
```

预期结果：所有测试 PASS。这确认了缺失邮箱仍然使用 `email_not_registered`，现有会话路由行为保持不变，且前端仍然渲染服务器业务错误。未更改的 `src/app/api/auth/authErrorResponse.ts` 映射继续为 `email_not_verified` 返回 HTTP `403`。

- [ ] **步骤 6：运行 TypeScript 检查**

运行：

```powershell
pnpm exec tsc --noEmit
```

预期结果：退出码为 `0`，无 TypeScript 错误。

- [ ] **步骤 7：检查并仅提交实现文件**

运行：

```powershell
git diff --check
git add src/server/authErrors.ts src/server/postgresAuthStore.test.ts
git commit -m "fix: clarify incomplete registration login message"
```

预期结果：`git diff --check` 不产生输出，且提交仅包含集中消息及其两个测试期望。不触碰现有的 `docs/prd.md` 工作树更改。
