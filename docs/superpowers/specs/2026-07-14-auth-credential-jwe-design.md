# 认证敏感凭据 JWE 双层加密设计

## 背景

当前登录、注册和重置密码接口通过 JSON 直接提交密码，邮箱验证接口直接提交验证码。HTTPS 上线后会保护完整请求链路，但浏览器 Network 面板仍会显示请求 JSON 中的明文字段，部分反向代理或错误日志配置也可能误采集请求体。

本设计在 HTTPS 之外增加应用层 JWE：浏览器先用服务端公钥加密密码和邮箱验证码，服务端解密后沿用现有 Argon2id 验证或哈希存储。应用层加密不替代 HTTPS；非本机 HTTP 环境仍不视为安全部署。

## 目标

- 登录密码、注册密码、新密码和 6 位邮箱验证码不再以明文字段出现在认证请求体中。
- 服务端严格拒绝旧的明文 `password` 和 `code` 参数，不提供降级兼容。
- 每份加密凭据只能使用一次，并且必须在签发后 60 秒内提交。
- 保留现有邮箱/IP 限流、明确中文错误、验证码冷却、认证审计和 Argon2id 密码存储。
- 开发和生产环境统一显式配置私钥文件和 `kid` 标识；密钥轮换后客户端可重新获取密钥并重试一次。

## 非目标和安全边界

- 不加密邮箱和姓名；它们继续作为普通业务字段参与格式校验、账号限流和界面提示。
- “发送找回密码验证码”只包含邮箱，不使用 JWE。
- 不修改 GitHub OAuth 流程。
- 不尝试阻止浏览器内的 XSS、恶意扩展或被篡改的前端脚本读取用户正在输入的密码；这些风险需要 HTTPS、CSP、依赖治理和终端安全共同处理。
- 不把密码可逆加密后存入数据库。数据库继续只保存带随机盐的 Argon2id 哈希。

## 协议选择

使用标准 Compact JWE：

- 密钥管理算法：`RSA-OAEP-256`。
- 内容加密算法：`A256GCM`。
- JWE protected header：`alg`、`enc`、`kid`、`typ: nexus-auth+jwe`。
- 浏览器与服务端统一使用成熟的 `jose` 实现，不自行拼接密码学数据结构。

JWE 明文载荷版本为 `1`，结构如下：

```json
{
  "version": 1,
  "purpose": "login",
  "email": "user@example.com",
  "password": "用户输入的密码",
  "challenge": "服务端签名的一次性令牌"
}
```

`purpose` 只允许：

- `login`：包含 `password`。
- `register`：包含 `password`。
- `verify-email`：包含 `code`。
- `reset-password`：同时包含 `code` 和 `password`。

每个用途只接受对应字段，出现多余敏感字段、字段缺失或用途不匹配时拒绝请求。服务端还会规范化并比较载荷内外的邮箱，防止密文被移到其他账号请求中使用。

## 一次性 Challenge

新增 `POST /api/auth/credential-challenge`，请求体为 `{ purpose }`，响应为：

```json
{
  "algorithm": "RSA-OAEP-256",
  "challenge": "签名令牌",
  "expiresAt": 1784016000000,
  "key": { "kty": "RSA", "kid": "auth-2026-07", "n": "...", "e": "AQAB" }
}
```

响应设置 `Cache-Control: no-store`。challenge 由 `AUTH_HASH_SECRET` 使用 HMAC-SHA-256 签名，内部包含随机 256 位 `jti`、`purpose`、签发时间和 60 秒过期时间。服务端解密 JWE 后验证签名、用途和有效期，再原子消费 `jti`：

- 生产环境通过 Redis `SET key value NX PX ttl` 标记已使用；Redis 不可用时返回 `503`，不继续认证。
- 本地开发没有 Redis 时使用带过期清理的进程内存储。该差异只涉及 challenge 消费记录，不涉及 JWE 密钥；JWE 密钥在两种环境中都必须显式配置。
- 同一 `jti` 第二次提交返回“加密凭据已使用，请重新提交”。

challenge 接口按 IP 限流，避免无限签发。签发本身无账号状态信息，不产生账号枚举结果。

## 前端数据流

认证表单提交时：

1. 保留用户当前输入的密码或验证码，仅在浏览器内存中使用。
2. 请求对应 `purpose` 的 challenge 和公钥 JWK。
3. 导入公钥，生成 Compact JWE。
4. 提交普通字段和单个 `credential` 字段；请求体中不得包含 `password` 或 `code`。
5. 收到未知 `kid` 或 challenge 过期错误时，重新获取 challenge 并加密重试一次；其他错误直接展示。
6. 请求结束后释放本次 JWE 中间数据，不写入本地存储、IndexedDB、URL、控制台或遥测。

各接口请求体调整为：

- `POST /api/auth/session`：`{ email, credential }`。
- `POST /api/auth/register`：`{ displayName, email, credential }`。
- `POST /api/auth/verify-email`：`{ email, credential }`。
- `POST /api/auth/password/reset`：`{ email, credential }`。
- `POST /api/auth/password/forgot`：保持 `{ email }`。

浏览器缺少 Web Crypto 能力、challenge 获取失败、公钥无法导入或本地加密失败时，界面给出明确中文提示，绝不回退明文提交。GitHub OAuth 在已配置时仍可独立使用。

## 服务端数据流

四个敏感认证接口统一使用凭据解密器：

1. 解析 JSON 并拒绝明文 `password`、`code` 字段。
2. 使用请求体外层邮箱和 IP 执行现有限流，避免通过大量 JWE 解密消耗 CPU。
3. 根据 protected header 的 `kid` 选择私钥，校验允许的 `alg`、`enc` 和 `typ`。
4. 解密并严格校验载荷版本、用途、字段集合、邮箱和 challenge。
5. 原子消费 challenge 后，将解密得到的密码或验证码传给现有认证存储层。
6. 登录继续使用 Argon2id 验证；注册和重置继续使用 Argon2id 哈希后写入数据库。

解密后的敏感值只存在于当前请求作用域，不进入异常文本、审计事件、请求日志或数据库明文字段。现有 8 KiB 认证请求上限足以容纳 Compact JWE，保持不变。

## 密钥配置与轮换

开发和生产环境都必须配置：

- `AUTH_CREDENTIAL_KEY_ID`：当前密钥稳定标识。
- `AUTH_CREDENTIAL_PRIVATE_KEY_FILE`：PKCS#8 PEM 私钥文件路径。

服务端从私钥派生公开 JWK，只向浏览器返回公钥参数。缺少配置、文件不可读、权限不正确或密钥无法解析时，challenge 接口和敏感认证接口返回明确 `503`，不自动生成密钥，也不回退明文认证。

新增本地密钥生成命令，在 `.secrets/auth-credential-private.pem` 创建 RSA 私钥并输出需要写入本地环境配置的 `kid` 和文件路径。`.secrets/` 必须加入 Git 忽略，命令不得把私钥内容打印到终端。生产环境通过容器 Secret、只读卷或同等密钥管理设施挂载私钥文件。私钥文件仅允许应用运行账号读取，不提交仓库、不写日志。

所有 Web 实例必须使用相同的当前私钥和 `kid`。开发环境也使用相同加载和解析代码，避免仅在部署时才发现密钥格式或权限问题。

轮换时先让所有实例使用新密钥和新 `kid`。旧页面提交旧 `kid` 时会收到可重试错误，前端自动获取新公钥并重新加密一次。由于 challenge 有效期只有 60 秒，本阶段不维护长期历史私钥环。

## 错误契约

新增稳定的凭据错误响应，不返回底层密码学异常：

- `400`：缺少加密凭据、发现明文敏感字段、JWE 格式或载荷字段无效、用途/邮箱不匹配、challenge 签名无效。
- `409`：密钥已轮换或 challenge 已使用；前端仅对密钥轮换自动重试一次。
- `410`：challenge 已过期，前端自动重新加密提交一次。
- `429`：challenge 签发或原认证接口触发限流，返回 `retryAfterSeconds`。
- `503`：密钥未配置、私钥文件不可读、Redis 或凭据服务不可用。

自动重试最多一次，避免配置错误或攻击流量形成循环。解密成功后的邮箱、密码、验证码业务错误继续使用现有明确状态码和中文提示。

## 测试与验收

- 加密模块覆盖 JWE 往返、错误密钥、篡改密文、错误算法、错误用途、邮箱不匹配和字段集合校验。
- challenge 模块覆盖签名、60 秒过期、Redis/内存原子消费、重复消费和生产故障关闭。
- 四个路由覆盖成功解密、严格拒绝明文、缺少密文、过期、重放和服务不可用。
- 存储层测试继续证明密码只以 Argon2id 哈希写入数据库。
- 前端测试证明请求 JSON 不出现 `password` 或 `code`，密钥轮换/过期只重试一次，浏览器加密失败不降级。
- E2E 覆盖注册、邮箱确认、登录和重置密码完整流程，并检查浏览器发出的敏感认证请求体只包含 `credential` 密文。
- 最终运行聚焦测试、完整测试和 TypeScript 检查；遵循项目约定，不在每次编辑后执行生产构建。

## HTTPS 要求

JWE 是 HTTPS 之上的第二层保护，不构成 HTTP 公网部署许可。生产环境必须继续使用 HTTPS、`Secure`/`HttpOnly`/`SameSite` 会话 Cookie、可信反向代理配置和 HSTS。HTTP 只允许本机开发；局域网或公网环境没有 HTTPS 时不得开放密码认证。
