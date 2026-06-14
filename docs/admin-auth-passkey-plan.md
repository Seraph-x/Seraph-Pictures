# 后台账号管理 + Passkey 登录 计划(Admin Credentials & Passkey)

> 状态:**未实施 / 设计待执行**。动工时照此开分支、小步提交、按"验证"自测。
> 最后更新:2026-06-14

## 1. 目标
1. **后台改账号**:管理员在后台修改**用户名**与**密码**(无需去 Cloudflare 控制台改环境变量)。
2. **Passkey 登录**:支持 WebAuthn 无密码登录(Touch ID / Windows Hello / 手机/安全密钥 / 同步 passkey),**密码作为兜底保留**。

## 2. 现状(grep 确认)
- 账号 = 环境变量 `BASIC_USER` / `BASIC_PASS`(`functions/utils/auth.js` 的 `verifyBasicAuth` 明文 `timingSafeEqual` 比对)。
- `isAuthRequired(env)` = 两者都设。
- 会话 = **KV 服务端**:`createSession()` 写 `session:<token>`(带 `expiresAt`),`verifySession()` 读 KV,cookie `seraph_pictures_session`(+ 旧名)。→ **可逐个/全部删除来强制下线**。
- `checkAuthentication()` = 先 session cookie,再 basic auth。
- 登录端点:`functions/api/auth/login.js`(以及 `functions/api/manage/login.js`,需确认哪个在用/是否重复)。
- 本地 `npm start` 注入 `BASIC_USER=admin / BASIC_PASS=123` 作引导。
- 无任何 webauthn 依赖;根 `package.json` 仅 sentry 等。

关键约束:环境变量**运行时不可由应用修改** → "后台改账号"必须把凭据搬到 **KV**(密码存**哈希**),env 仅作**首次引导默认**(与 `guest_config`/`ui_config` 同模式)。

## 3. 数据模型(KV)
- `admin_credentials`: `{ username, passwordHash, salt, iterations, updatedAt, credVersion }`
  - 密码哈希用 **WebCrypto PBKDF2-SHA256**(Workers 无原生 bcrypt/argon2;迭代 ≥ 100k,每账号随机 salt)。
  - `credVersion`:每次改密码自增,写入新会话;校验会话时比对 → **改密后旧会话自动失效**。
- `webauthn_credentials`: `{ items: [{ id(base64url), publicKey, counter, transports, name, createdAt }] }`
- `webauthn_challenge:<tempId>`: `{ challenge, type, createdAt }`,**KV TTL ~300s**;`tempId` 放一次性短期 cookie。
- 会话沿用现有 `session:<token>`。

## 4. Phase A — 凭据迁到 KV + 后台改账号
**后端**
- `auth.js` 新增 `readAdminCredentials(env)`(KV 优先,缺失回退 env)、`hashPassword()`/`verifyPassword()`(PBKDF2)。
- 改 `verifyBasicAuth` 与登录校验:**先比 KV 凭据(哈希),再回退 env**;用户名也从 KV 取。
- 新端点 `POST /api/auth/credentials`:需**当前有效会话 + 重新验证当前密码** → 写 KV(新用户名/新密码哈希 + `credVersion++`)→ 删除其它会话(或靠 credVersion 失效)。
- 登录加**限流**(防爆破;复用访客那套 KV 计数思路)。
**前端**
- `admin.html` 新增"账号与安全"面板:改用户名 / 改密码(需输入当前密码)。
- `login.html` 不变(仍用户名+密码,只是校验源变成 KV)。
**验证**
- 设了 env 引导时首次可用 env 登录;在后台改账号后,**新凭据生效、env 旧凭据失效**;改密后旧 cookie 立刻失效;错误密码限流;`/api/...` 任何 GET 都不泄露 `passwordHash`。

## 5. Phase B — Passkey(WebAuthn)
**库**:建议 `@simplewebauthn/server`(同构,近版本可在 Workers/Web Crypto 运行)+ `@simplewebauthn/browser`。
⚠️ 需先验证:① 在 Pages Functions(esbuild 打包 node_modules)里能正常打包运行;② 是否需 `compatibility_flags=["nodejs_compat"]`。不行则换库或手写(复杂,不推荐)。
**配置**:`rpID` = 规范域名(如 `pictures.seraphzero.com`)、`rpName`、`origin`。
⚠️ Passkey **绑定 origin/rpID**:在 `pictures.seraphzero.com` 注册的在 `k-vault-2lv.pages.dev` **用不了** → 必须固定一个规范域名。
**端点**(均单管理员)
- 注册(需登录):`POST /api/auth/passkey/register/options` → `navigator.credentials.create` → `POST /api/auth/passkey/register/verify`(存 `webauthn_credentials`)。
- 登录(无需登录):`POST /api/auth/passkey/auth/options`(allowCredentials)→ `navigator.credentials.get` → `POST /api/auth/passkey/auth/verify`(验签 + 校验 `counter` 防重放)→ **成功后签发现有 KV 会话**。
- 管理(需登录):列出 / 重命名 / 删除已注册 passkey。
**前端**
- `login.html`:加"用 Passkey 登录"按钮(`@simplewebauthn/browser` 的 `startAuthentication`)。
- `admin.html`:"账号与安全"面板加"注册 Passkey / 管理已注册"。
**兜底**:**保留密码登录**;若删到没有任何 passkey 也能用密码进(防锁死)。
**验证**
- 登录态注册 passkey → 登出 → 用 passkey 登录成功并拿到会话;`counter` 重放被拒;删光 passkey 后密码仍可登录;换非规范域名时 passkey 不可用(预期)。

## 6. 代码落点速查
| 改动 | 文件 |
|---|---|
| 凭据读取/哈希/校验、KV 优先 | `functions/utils/auth.js` |
| 登录校验改用统一逻辑 | `functions/api/auth/login.js`(确认 `manage/login.js` 是否并存) |
| 改账号端点 | 新增 `functions/api/auth/credentials.js` |
| Passkey 端点 | 新增 `functions/api/auth/passkey/*` |
| 后台"账号与安全"面板 | `admin.html` |
| 登录页 Passkey 按钮 | `login.html` |
| 依赖 + 兼容性 | `package.json`、必要时 `wrangler.jsonc`(`compatibility_flags`) |

## 7. 安全注意
- 密码只存 **PBKDF2 哈希 + 随机 salt**,绝不明文/不经任何 GET 返回。
- 改账号端点必须**重新验证当前密码** + 需有效会话。
- 改密 → **作废旧会话**(credVersion 或清 `session:*`)。
- 登录**限流**;`timingSafeEqual` 比哈希。
- Passkey:固定规范 `rpID`/`origin`;challenge 短 TTL 且一次性;校验 `signCount` 防重放;**始终保留密码兜底防锁死**。
- 本地 dev 的 `admin/123` 仅引导;部署后应立刻在后台改成强密码。

## 8. 执行前需用户拍板的开放项
- 是否**单管理员**(本计划默认是;多用户要重构数据模型)。
- Passkey 是否**保留密码兜底**(强烈建议是)。
- 规范域名定哪个(`pictures.seraphzero.com`?)——决定 `rpID`。
- WebAuthn 库:`@simplewebauthn` vs 其它 vs 手写(建议先验证 SimpleWebAuthn 在 Pages Functions 可用)。
- 改密后是"作废全部会话"还是"仅作废其它会话保留当前"。

## 9. 执行约定(沿用本项目惯例)
- 分阶段单独开分支(`feat/admin-credentials`、`feat/passkey-login`),小步提交。
- 每步按"验证"自测;`npx mocha` 失败集不超过当时基线;本地 `npm start` + 浏览器实测(登录/改密/passkey 注册与登录)。
- 通过后:合并 `main` → `npm run pages:deploy` → 推 `origin/main`(逐项经用户确认)。
- 凭据/密钥走 KV 哈希或 Cloudflare Secret,绝不进代码或公开 GET。
