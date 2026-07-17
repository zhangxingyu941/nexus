# 认证敏感凭据 JWE 双层加密实施计划

> **致智能体工作者：** 必须使用子技能：superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将登录密码、注册密码、重置密码和邮箱验证码改为浏览器 JWE 加密、服务端解密，并通过 60 秒一次性 challenge 阻止密文重放。

**架构：** 浏览器先从 challenge API 获取服务端签名 challenge 和 RSA 公钥 JWK，再使用 `RSA-OAEP-256 + A256GCM` 生成 Compact JWE。服务端在现有限流之后统一解密、校验用途与邮箱、原子消费 challenge，再把临时明文交给现有 Argon2id 认证存储层；生产使用 Redis，开发无 Redis 时使用内存消费记录。

**技术栈：** Next.js 15、React 18、TypeScript、jose 5.10、Node Crypto、Redis 7、Vitest、Testing Library、Playwright。

---

## 文件结构

- `src/shared/authCredential.ts`：浏览器与服务端共享 purpose、challenge 响应和错误代码类型。
- `src/server/authCredentialKey.ts`：读取 PKCS#8 私钥文件、派生公开 JWK、缓存当前 `kid`。
- `src/server/authCredentialReplayStore.ts`：Redis/内存一次性 `jti` 原子消费。
- `src/server/authCredentialService.ts`：签发 challenge、解密 JWE、严格校验载荷和产生稳定错误。
- `src/app/api/auth/credential-challenge/*`：公开 challenge API。
- `src/app/api/auth/authCredentialResponse.ts`：把凭据错误映射为稳定 JSON 状态码。
- `src/app/authClient.ts`：普通认证请求、challenge 获取、浏览器 JWE 加密和单次自动重试。
- `scripts/generate-auth-credential-key.ts`：生成本地 RSA 私钥文件，不输出私钥内容。

## 任务 1：依赖、共享契约与密钥配置

**文件：**
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`.gitignore`
- 创建：`src/shared/authCredential.ts`
- 创建：`src/server/authCredentialKey.ts`
- 创建：`src/server/authCredentialKey.test.ts`
- 创建：`scripts/generate-auth-credential-key.ts`

- [x] **步骤 1：添加 jose 5.10 和密钥生成脚本入口**

运行：`pnpm add jose@5.10.0`

在 `package.json` 增加：

```json
"auth:keygen": "tsx scripts/generate-auth-credential-key.ts"
```

预期结果：`package.json` 与 `pnpm-lock.yaml` 只新增 `jose@5.10.0` 相关依赖。

- [x] **步骤 2：先写密钥加载失败测试**

覆盖缺少 `AUTH_CREDENTIAL_KEY_ID`、缺少文件路径、文件不存在、不是 PKCS#8 RSA 私钥，以及成功派生不含私钥参数 `d` 的公开 JWK。

运行：`pnpm test --run src/server/authCredentialKey.test.ts`

预期结果：FAIL，因为 `loadAuthCredentialKey` 尚不存在。

- [x] **步骤 3：定义共享协议**

```ts
export const AUTH_CREDENTIAL_PURPOSES = ["login", "register", "verify-email", "reset-password"] as const;
export type AuthCredentialPurpose = typeof AUTH_CREDENTIAL_PURPOSES[number];

export interface AuthCredentialChallengeResponse {
  algorithm: "RSA-OAEP-256";
  challenge: string;
  expiresAt: number;
  key: JsonWebKey & { kid: string };
}

export type AuthCredentialErrorCode =
  | "credential_required"
  | "plaintext_credential_forbidden"
  | "credential_invalid"
  | "credential_key_unknown"
  | "credential_challenge_expired"
  | "credential_challenge_reused"
  | "credential_service_unavailable";
```

- [x] **步骤 4：实现显式密钥文件加载**

`loadAuthCredentialKey` 必须读取 `AUTH_CREDENTIAL_KEY_ID` 与 `AUTH_CREDENTIAL_PRIVATE_KEY_FILE`，使用 Node `createPrivateKey`/`createPublicKey` 校验 RSA PKCS#8 PEM，并通过 jose 导入解密私钥、导出公开 JWK。缓存键包含 `kid + 绝对路径`，不得自动生成生产或开发密钥。

- [x] **步骤 5：实现本地密钥生成命令与 Git 忽略**

脚本使用 RSA 3072 位、PKCS#8 PEM，在默认 `.secrets/auth-credential-private.pem` 创建文件；文件已存在时拒绝覆盖。终端只输出 `AUTH_CREDENTIAL_KEY_ID` 和 `AUTH_CREDENTIAL_PRIVATE_KEY_FILE` 示例，不输出 PEM。`.gitignore` 增加 `.secrets/`。

- [x] **步骤 6：运行密钥模块测试**

运行：`pnpm test --run src/server/authCredentialKey.test.ts`

预期结果：PASS。

## 任务 2：Challenge 签名与防重放存储

**文件：**
- 创建：`src/server/authCredentialReplayStore.ts`
- 创建：`src/server/authCredentialReplayStore.test.ts`
- 创建：`src/server/authCredentialService.ts`
- 创建：`src/server/authCredentialService.test.ts`

- [x] **步骤 1：先写内存和 Redis 原子消费测试**

测试同一 `jti` 首次 `consume` 返回 `true`、第二次返回 `false`、过期项可清理；Redis 实现必须调用：

```ts
client.set(key, "1", { NX: true, PX: ttlMs })
```

生产无 Redis 返回稳定不可用错误，开发无 Redis 使用内存实现。

运行：`pnpm test --run src/server/authCredentialReplayStore.test.ts`

预期结果：FAIL，因为 replay store 尚不存在。

- [x] **步骤 2：实现 replay store**

定义：

```ts
export interface AuthCredentialReplayStore {
  consume(jti: string, expiresAt: number): Promise<boolean>;
}
```

Redis key 使用 `AUTH_HASH_SECRET` HMAC 后的 `notion-editor:auth-credential:<hash>`，TTL 最少 1 毫秒。生产 Redis 连接失败必须抛出 `AuthCredentialServiceUnavailableError`；开发可回退到内存。

- [x] **步骤 3：先写 challenge 与 JWE 服务测试**

测试签发结果含 60 秒有效期、HS256 challenge 含 `jti/purpose/iat/exp`；覆盖正确 JWE、篡改密文、未知 `kid`、错误 `alg/enc/typ`、用途不匹配、内外邮箱不匹配、字段缺失、多余敏感字段、challenge 过期与重复消费。

运行：`pnpm test --run src/server/authCredentialService.test.ts`

预期结果：FAIL，因为服务尚未实现。

- [x] **步骤 4：实现 challenge 和解密服务**

服务接口：

```ts
interface AuthCredentialService {
  issueChallenge(purpose: AuthCredentialPurpose): Promise<AuthCredentialChallengeResponse>;
  decrypt(input: {
    credential: unknown;
    email: string;
    payload: Record<string, unknown>;
    purpose: AuthCredentialPurpose;
  }): Promise<{ code?: string; password?: string }>;
}
```

challenge 使用 `SignJWT` 与 `AUTH_HASH_SECRET` 的 HS256 签名。解密使用 `compactDecrypt`，先检查 protected header，再严格解析 JSON；邮箱统一 `trim().toLowerCase()` 后比较。验证成功后原子消费 challenge，再返回当前用途允许的敏感字段。

- [x] **步骤 5：运行服务端密码学测试**

运行：`pnpm test --run src/server/authCredentialReplayStore.test.ts src/server/authCredentialService.test.ts`

预期结果：PASS，测试输出和异常不包含测试密码或验证码。

## 任务 3：Challenge API 与错误契约

**文件：**
- 创建：`src/app/api/auth/credential-challenge/handlers.ts`
- 创建：`src/app/api/auth/credential-challenge/route.ts`
- 创建：`src/app/api/auth/credential-challenge/route.test.ts`
- 创建：`src/app/api/auth/authCredentialResponse.ts`
- 创建：`src/app/api/auth/authCredentialResponse.test.ts`
- 修改：`src/server/authRequestSecurity.ts`

- [x] **步骤 1：写失败的 challenge 路由与错误映射测试**

覆盖合法 purpose 返回 `{ algorithm, challenge, expiresAt, key }` 与 `Cache-Control: no-store`；非法 purpose 返回 `400`；限流返回 `429`；密钥/Redis 配置错误返回不泄漏内部异常的 `503`。

运行：`pnpm test --run src/app/api/auth/credential-challenge/route.test.ts src/app/api/auth/authCredentialResponse.test.ts`

预期结果：FAIL。

- [x] **步骤 2：增加按 IP 的 challenge 限流规则**

`AuthRateLimitAction` 增加 `credential-challenge`，规则为每 IP 每分钟 30 次。`AuthRequestSecurity.check` 在 identifier 为空时只消费 IP 规则，避免所有用户共享 `unknown` 身份限额。

- [x] **步骤 3：实现 challenge 路由**

路由只接受 JSON `{ purpose }`，通过现有 `parseAuthJson` 与 `enforceAuthRateLimit`，调用 `issueChallenge` 后返回 no-store JSON。配置异常统一转换为：

```json
{ "code": "credential_service_unavailable", "error": "安全凭据服务未正确配置，请联系管理员" }
```

- [x] **步骤 4：运行 challenge API 测试**

运行：`pnpm test --run src/app/api/auth/credential-challenge/route.test.ts src/app/api/auth/authCredentialResponse.test.ts src/server/authRequestSecurity.test.ts`

预期结果：PASS。

## 任务 4：四个认证接口严格切换到密文

**文件：**
- 修改：`src/app/api/auth/session/handlers.ts`
- 修改：`src/app/api/auth/register/handlers.ts`
- 修改：`src/app/api/auth/verify-email/handlers.ts`
- 修改：`src/app/api/auth/password/reset/handlers.ts`
- 修改：对应四个 `route.ts`
- 修改：对应四个 `route.test.ts`

- [x] **步骤 1：把路由测试改为注入 credential service**

测试 fake 返回对应临时明文：

```ts
const credentials = {
  decrypt: vi.fn().mockResolvedValue({ password: "correct horse battery staple" }),
};
```

请求体只使用 `{ email, credential: "test-jwe" }`。额外测试旧 `{ password }`/`{ code }` 被 credential service 拒绝并返回 `400 plaintext_credential_forbidden`。

- [x] **步骤 2：运行四个路由测试确认失败**

运行：`pnpm test --run src/app/api/auth/session/route.test.ts src/app/api/auth/register/route.test.ts src/app/api/auth/verify-email/route.test.ts src/app/api/auth/password/reset/route.test.ts`

预期结果：FAIL，因为 handler 仍读取明文字段。

- [x] **步骤 3：接入统一解密器**

每个 handler 保持"解析 JSON → 外层邮箱/IP 限流 → 解密 → 现有 authStore"的顺序。只把解密结果传给现有方法：

```ts
const { password } = await credentials.decrypt({ payload, email, purpose: "login", credential: payload.credential });
await authStore.loginWithPassword({ email, password: password ?? "" });
```

所有 credential 错误先走 `authCredentialErrorResponse`，业务错误继续走 `authErrorResponse`。审计事件不得包含 credential、密码或验证码。

- [x] **步骤 4：路由模块加载共享服务**

四个 `route.ts` 从服务端单例工厂取得同一个 key provider、challenge signer 和 replay store；GET/DELETE session 不初始化 JWE 服务。

- [x] **步骤 5：运行四个路由测试**

运行：`pnpm test --run src/app/api/auth/session/route.test.ts src/app/api/auth/register/route.test.ts src/app/api/auth/verify-email/route.test.ts src/app/api/auth/password/reset/route.test.ts`

预期结果：PASS。

## 任务 5：浏览器认证客户端

**文件：**
- 创建：`src/app/authClient.ts`
- 创建：`src/app/authClient.test.ts`
- 修改：`src/app/AuthScreen.tsx`

- [x] **步骤 1：写失败的浏览器 JWE 测试**

使用测试 RSA 公钥响应 challenge，提交登录、注册、验证邮箱和重置密码。断言最终请求 JSON：

```ts
expect(body).not.toHaveProperty("password");
expect(body).not.toHaveProperty("code");
expect(body.credential).toMatch(/^[^.]+\.[^.]*\.[^.]+\.[^.]+\.[^.]+$/);
expect(JSON.stringify(body)).not.toContain(secret);
```

再用测试私钥解密，确认 JWE 内部包含正确 purpose、邮箱和敏感字段。覆盖未知 `kid`/过期时只重试一次、网络失败、非法 JSON、Web Crypto/JWE 加密失败且不回退明文。

运行：`pnpm test --run src/app/authClient.test.ts`

预期结果：FAIL。

- [x] **步骤 2：实现 authClient**

公开两个函数：

```ts
requestAuth(endpoint, body)
requestEncryptedAuth({ endpoint, email, payload, purpose, secrets })
```

`requestEncryptedAuth` 先 POST challenge，再用 `importJWK` 和 `CompactEncrypt` 生成 JWE，最后调用普通请求。只有 `credential_key_unknown` 和 `credential_challenge_expired` 可重新签发并重试一次。

- [x] **步骤 3：AuthScreen 使用加密客户端**

- 登录：`secrets: { password }`。
- 注册和重发：`secrets: { password }`。
- 验证邮箱：`secrets: { code }`。
- 重置密码：`secrets: { code, password }`。
- 发送找回验证码：继续普通 `requestAuth`。

移除组件内部重复的 request/error 类实现，界面文案和倒计时行为保持不变。

- [x] **步骤 4：运行浏览器客户端测试**

运行：`pnpm test --run src/app/authClient.test.ts`

预期结果：PASS。

## 任务 6：UI 流程与端到端断言

**文件：**
- 修改：`src/app/EditorApp.test.tsx`
- 修改：`e2e/editor.spec.ts` 或现有认证 E2E 文件

- [ ] **步骤 1：更新 UI fetch 测试序列**

每次敏感提交增加 challenge 响应。不要断言密文固定值；解析最终请求体并断言只有 `credential`，且序列化请求不含测试密码或验证码。现有成功、冷却、网络错误和异常 JSON 文案继续覆盖。

- [ ] **步骤 2：运行 UI 测试**

运行：`pnpm test --run src/app/EditorApp.test.tsx`

预期结果：PASS。

- [ ] **步骤 3：更新 E2E 请求体检查**

监听四个敏感 API 的 `request.postDataJSON()`，断言没有顶层 `password/code`，存在字符串 `credential`。继续完成真实注册、验证、登录与重置流程，证明后端解密和 Argon2id 链路未回归。

## 任务 7：开发与生产密钥配置

**文件：**
- 修改：`.env.example`
- 修改：`docker-compose.yml`
- 修改：`README.md`
- 修改：`docs/prd.md`（只在现有认证描述中追加 JWE，不改动用户已有路线图内容）
- 生成，已忽略：`.secrets/auth-credential-private.pem`
- 修改，已忽略：`.env`

- [ ] **步骤 1：更新配置示例和 Compose**

`.env.example` 增加：

```dotenv
AUTH_CREDENTIAL_KEY_ID=auth-local-2026-07
AUTH_CREDENTIAL_PRIVATE_KEY_FILE=.secrets/auth-credential-private.pem
```

Compose 的 Web 容器把宿主文件只读挂载到 `/run/secrets/auth-credential-private.pem`，容器内环境变量指向该路径。迁移和协作服务不挂载私钥。

- [ ] **步骤 2：生成并配置本地私钥**

运行：`pnpm auth:keygen`

预期结果：创建已忽略的 PKCS#8 PEM 文件，终端不显示私钥。使用 `apply_patch` 只向本地 `.env` 增加 `kid` 和路径，不改动或输出现有数据库、SMTP 等 Secret。

- [ ] **步骤 3：更新中文文档**

README 说明 Secret、密钥生成、权限、轮换、HTTPS 仍为必需条件，以及五个认证 API 的新请求格式。PRD 已实现认证条目追加"JWE 双层加密和 60 秒防重放"，保留当前未提交路线图。

## 任务 8：最终验证

**文件：**
- 审查：所有变更文件

- [ ] **步骤 1：运行聚焦认证测试**

运行：`pnpm test --run src/server/authCredentialKey.test.ts src/server/authCredentialReplayStore.test.ts src/server/authCredentialService.test.ts src/app/api/auth/credential-challenge/route.test.ts src/app/api/auth/session/route.test.ts src/app/api/auth/register/route.test.ts src/app/api/auth/verify-email/route.test.ts src/app/api/auth/password/reset/route.test.ts src/app/authClient.test.ts src/app/EditorApp.test.tsx`

预期结果：PASS。

- [ ] **步骤 2：运行完整测试与类型检查**

运行：`pnpm test --run`

运行：`pnpm exec tsc --noEmit`

预期结果：全部 PASS，无类型错误。

- [ ] **步骤 3：只在最终阶段构建一次**

运行：`pnpm build`

预期结果：Next.js 生产构建成功。不会在每次任务后重复构建。

- [ ] **步骤 4：数据库模式冒烟与浏览器验收**

运行：`pnpm db:smoke`

启动开发服务后，在浏览器完成登录/注册/验证/重置，检查 Network 中密码和验证码只存在于 JWE 密文，不存在顶层明文字段。

- [ ] **步骤 5：差异与敏感信息检查**

运行：`git diff --check`

运行：`git status --short`

确认 `.secrets/`、`.env`、私钥 PEM、SMTP 授权码、真实密码和验证码均未进入 Git 差异。本轮不创建提交，除非用户明确要求。