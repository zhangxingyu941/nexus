# Incomplete Registration Login Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unactionable password-login message for an unverified account with “该邮箱尚未完成注册，请先完成注册再登录” while preserving the existing error code, HTTP status, and authentication flow.

**Architecture:** Keep `email_not_verified` as the storage-layer domain state and retain its existing API mapping to HTTP `403`. Change only the centralized user-visible message, with storage integration tests proving both new-registration and upgraded-legacy-account paths return the new copy.

**Tech Stack:** TypeScript, Vitest, pg-mem, Next.js authentication routes

---

### Task 1: Update the incomplete-registration login message

**Files:**
- Modify: `src/server/postgresAuthStore.test.ts:204`
- Modify: `src/server/postgresAuthStore.test.ts:413`
- Modify: `src/server/authErrors.ts:30`

- [ ] **Step 1: Change the two integration-test expectations to the approved message**

In `src/server/postgresAuthStore.test.ts`, replace both existing unverified-login assertions with:

```ts
await expect(authStore.loginWithPassword({
  email: legacySession.user.email,
  password: "replacement secure password",
})).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");
```

and:

```ts
await expect(authStore.loginWithPassword({
  email: "linxia@example.com",
  password: "correct horse battery staple",
})).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");
```

- [ ] **Step 2: Run the focused tests and verify the new expectations fail**

Run:

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts -t "upgrades a credentialless legacy account|verifies email once"
```

Expected: FAIL in both selected tests because the implementation still returns `邮箱尚未验证，请先输入邮件中的验证码`.

- [ ] **Step 3: Make the minimal centralized message change**

In `src/server/authErrors.ts`, change only the `email_not_verified` value:

```ts
email_not_verified: "该邮箱尚未完成注册，请先完成注册再登录",
```

Do not change `AuthErrorCode`, `AUTH_ERROR_STATUS`, `loginWithPassword`, or the frontend request handling.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts -t "upgrades a credentialless legacy account|verifies email once"
```

Expected: PASS for both selected tests.

- [ ] **Step 5: Run authentication regression tests**

Run:

```powershell
pnpm exec vitest run src/server/postgresAuthStore.test.ts src/app/api/auth/session/route.test.ts src/app/EditorApp.test.tsx
```

Expected: all tests PASS. This confirms missing emails still use `email_not_registered`, existing session-route behavior remains intact, and the frontend still renders server business errors. The unchanged `src/app/api/auth/authErrorResponse.ts` mapping continues to return HTTP `403` for `email_not_verified`.

- [ ] **Step 6: Run the TypeScript check**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: exit code `0` with no TypeScript errors.

- [ ] **Step 7: Check and commit only the implementation files**

Run:

```powershell
git diff --check
git add src/server/authErrors.ts src/server/postgresAuthStore.test.ts
git commit -m "fix: clarify incomplete registration login message"
```

Expected: `git diff --check` produces no output, and the commit contains only the centralized message and its two test expectations. Leave the existing `docs/prd.md` worktree change untouched.
