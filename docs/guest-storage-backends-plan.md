# 访客可用存储后端 管理功能 计划(Guest Storage Backends)

> 状态:**未实施 / 设计待执行**。动工时照此开分支、小步提交、按"验证"自测。
> 最后更新:2026-06-14

## 1. 目标
后台「访客上传设置」面板里,让管理员**勾选访客可以上传到哪些存储后端**(Telegram / R2 / S3 / Discord / HuggingFace / WebDAV / GitHub)。访客在前端只能从"被允许且已配置"的后端里选;改后即时生效。

## 2. 现状(重要:当前是刻意"强制隔离")
- 当前访客上传**被硬编码强制** `storageMode = "telegram"`(`functions/upload.js` 与 `functions/api/upload-from-url.js` 的访客分支),且专门走**独立访客频道**(`TG_GUEST_BOT_TOKEN`/`TG_GUEST_CHAT_ID`)。
- 这是当初的设计动机:**成本与防滥用隔离**——访客内容进免费的、带原生大小限制的独立 Telegram 频道/机器人,避免占用 R2 免费额度、避免主 bot 被封。
- `index.html` 已有存储后端按钮(telegram/r2/s3/discord/huggingface/github;webdav 在 `webdav.html`),但对访客这些选择**被忽略**。
- `guest_config` 现有:`enabled / retentionDays / dailyLimit / maxFileSize`。
- `/api/status` 暴露各后端 `configured/connected`(capabilities),前端据此判断哪些可用。

⚠️ **本功能会部分撤销上面的隔离**——把访客放到 R2/S3 等 = 访客内容进入和管理员**同一存储**。计划默认仍以 Telegram 为主,其余后端需管理员**主动开启**,并配合下面的护栏。

## 3. 数据模型(扩展 guest_config)
`functions/utils/guest.js` 的 `DEFAULT_GUEST_CONFIG` + `normalizeGuestConfig` 增:
```
allowedBackends: string[]   // 允许访客使用的后端,默认 ['telegram']
defaultBackend:  string     // 访客未选时的默认,默认 'telegram'
guestFolderPrefix: string   // 非 telegram 后端时把访客文件归入的前缀,默认 'guest'(便于隔离/清理)
```
归一化:`allowedBackends` 过滤为合法后端枚举的子集;空则回退 `['telegram']`;`defaultBackend` 必须 ∈ `allowedBackends`,否则取第一个。

## 4. 实施步骤

### Step 1 — 配置 schema
- `guest.js` 加上述字段 + 归一化(枚举校验、空回退)。`guest-config.js` 复用 normalize,无需改。
- 验证:POST 各种组合(含非法后端名/空数组)→ GET 回读被正确过滤、`defaultBackend` 始终合法。

### Step 2 — 后端强制(权威闸门)
- `functions/upload.js` 与 `upload-from-url.js` 访客分支:**去掉"强制 telegram"**,改为:
  1. 取访客请求的 `storageMode`;
  2. 若 ∈ `allowedBackends` **且**该后端已配置 → 用之;否则回退 `defaultBackend`;若默认也不可用 → 403。
  3. **telegram** 仍走访客频道 + 访客凭据(隔离不变)。
  4. **非 telegram**:把 `folderPath` 强制加上 `guestFolderPrefix`(如 `guest/...`),便于区分/清理;仍打访客标记、计数、写 KV 记录 + `retentionDays` TTL、套 `maxFileSize` 上限。
- 验证:访客选未授权后端 → 回退或 403;选授权后端 → 落到对应存储且在 `guest/` 前缀下;管理员不受影响;`upload-from-url` 的 SSRF 测试集仍过。

### Step 3 — 前端(index.html)
- 访客模式下,存储后端按钮只显示 `allowedBackends ∩ 已配置`;默认选中 `defaultBackend`;允许访客在其中切换(目前对访客是忽略的,改为生效)。
- 仅一个允许后端时,隐藏选择、固定该后端。
- 验证:登出态按不同 `allowedBackends` 组合,按钮显隐/可选正确;实际上传落到所选后端。

### Step 4 — 后台面板(admin.html `showGuestSettingsPanel`)
- 加"访客可用存储后端"区块:对**每个已配置后端**(读 `/api/status` capabilities)给一个复选框 + 一个"默认后端"单选;非配置后端置灰提示"未配置"。
- `readValues()`/`applyValuesToForm()` 加 `allowedBackends`/`defaultBackend`;新增 i18n(zh/en,`admin.guest*`)。保存复用 guest-config POST + 回读校验。
- 验证:中英文案正确;改动→保存→GET 持久化;前端实测随之变化。

## 5. 代码落点速查
| 改动 | 文件 |
|---|---|
| 配置字段 + 归一化(枚举/默认/前缀) | `functions/utils/guest.js` |
| 去强制 telegram + 校验/回退/前缀 | `functions/upload.js`、`functions/api/upload-from-url.js` |
| 访客后端按钮显隐与默认 | `index.html` |
| 后台勾选 UI + i18n | `admin.html`(`showGuestSettingsPanel` + 字典) |

## 6. 关键权衡与风险(务必读)
- **隔离/成本回退**:允许访客用 R2/S3/GitHub 等 = 访客内容进管理员同一存储,重新引入"占额度/被滥用"风险。建议:默认仍 telegram;其余后端**默认关**,开启时务必配合 `guestFolderPrefix` + 现有 `dailyLimit`/`maxFileSize` 护栏。
- **"访客命名空间"只有 telegram 天然具备**(独立频道);其它后端靠 `guest/` 前缀软隔离,清理需手动或加生命周期规则。
- **保留天数(TTL)语义按后端不同**:KV 记录的 `expirationTtl` 到期只让**链接失效**;telegram 字节仍在访客频道(清理=清频道),R2/S3 等**对象本体不会自动删**,需另加生命周期/清理任务(否则"保留 N 天"对非 telegram 只对链接生效)。
- **大小上限**:访客 `maxFileSize`(≤20MB)仍生效;即便 R2/S3 支持 100MB,访客仍受访客上限约束(需确认 `validateDirectUpload` 与访客上限的先后)。
- **内容审查**:访客内容若进 R2 等,审查诉求不变(见 `docs/content-moderation-plan.md`)。

## 7. 执行前需用户拍板的开放项
- 各后端对访客**默认开/关**(建议仅 telegram 默认开)。
- 非 telegram 后端是否强制 `guest/` 前缀(建议是)。
- 非 telegram 的"保留天数"是否要做**真实字节清理**(R2 生命周期 / 定时任务),还是只失效链接。
- 访客能否**自由切换**多个后端,还是管理员只指定**单一**后端(本计划默认支持多选+访客切换)。

## 8. 执行约定(沿用本项目惯例)
- 单独开分支(如 `feat/guest-storage-backends`),小步提交。
- 每步按"验证"自测;`npx mocha` 失败集不超过当时基线;前端用本地 `npm start` + 浏览器实测(登出态各组合)。
- 通过后:合并 `main` → `npm run pages:deploy` → 推 `origin/main`(逐项经用户确认)。

## 9. 前置依赖:内容审查(`docs/content-moderation-plan.md`)
访客被关在一次性的隔离 Telegram 频道时风险可控;一旦放行到 R2/S3 等**持久存储**,违规/非法内容会进入与管理员同一份存储,风险显著上升。因此:
- **先决条件**:对访客开放 Telegram 以外的后端**之前**,应先具备基本审查能力(内容审查计划 **Phase 0/1 + CSAM 基线**);否则非 TG 后端保持默认关。
- **联动改动**:开放后,审查的扫描钩子需"后端无关"(分发前对字节执行),CSAM/违规移除需"按后端删除"(复用 `functions/api/manage/delete`)。详见内容审查计划**第 10 节**。
