# 内容审查实施计划(Content Moderation Plan)

> 状态:**未实施 / 设计待执行**。本文件是未来动工时的蓝图,可直接照此开分支、小步提交、按"验证"自测。
> 最后更新:2026-06-14

## 1. 背景与动机
K-Vault(Seraph's Pictures)已上线**访客匿名上传**(未登录用户可上传文件,经访客 Telegram 通道存储,受 `guest_config` 限额约束)。匿名 UGC 是违规内容(尤其 NSFW 与**违法的 CSAM**)风险最高的入口。本计划在不破坏现有体验的前提下,分层加入内容审查。

- 普通 NSFW = **站点策略**问题:删除/隐藏/打标即可。
- **CSAM = 法律合规**问题:不能只删,需保存证据并向 **NCMEC/当地机构上报**;主动删而不报本身可能违法。二者流程必须分开。

## 2. 现状(可复用资产)
- KV 元数据已有 `ListType`(None/Block/White)+ `Label`(adult)。
- `functions/file/[id].js` 的 `shouldBlock()`(ListType=Block 或 Label=adult → 重定向 `block-img.html`)与 `shouldWhitelistDeny()`(白名单模式)。
- 管理端已有手动审核动作:`functions/api/manage/block`、`white`、`delete`、`toggleLike`。
- 访客策略集中在 `functions/utils/guest.js`(`readGuestConfig`/`normalizeGuestConfig`)+ `functions/api/guest-config.js`,后台面板 `admin.html` 的 `showGuestSettingsPanel`。
- **尚未有**:自动检测、审核队列、举报入口、Workers AI 绑定、CSAM 管线。
- ⚠️ **关键架构约束**:`/file/[id].js` 对所有文件响应设 `Cache-Control: no-store` + `CDN-Cache-Control: no-store`(文件在 Telegram,Worker 现取现传)。→ 文件**永不进 Cloudflare 缓存**。

## 3. 已定方向(上轮决策)
- 策略 = **混合式**:CSAM/黑名单同步硬拦;NSFW 异步打标;默认放行 + 举报兜底;高风险可切 pre-moderation。
- 自动检测 = **Cloudflare Workers AI**(因无专用 NSFW 模型,改用 **LLaVA** 多模态做图像 VQA 判定、**Llama Guard 3** 做文本审核);需要更高精度再叠第三方 API。
- CSAM:
  - **现已采用基线** = Cloudflare 控制台 CSAM Scanning Tool(免费开关)。
  - ⚠️ 因 no-store,控制台工具**扫不到访客文件**;真正防护需"代码管线 + 专业服务凭据"。
  - 专业服务候选(均免费但需审核接入):**IWF Image Intercept**(小平台首选,100 万次/月)> **Project Arachnid Shield**(全球、对 host 友好、REST)> **Microsoft PhotoDNA Cloud**(审核最严)。哈希比对只挡**已知**库,不挡新/AI 生成内容。

## 4. 数据模型(KV metadata 扩展)
在上传写入的 metadata 上新增(复用现有 ListType/Label 做拦截):
```
moderation: {
  status: 'ok' | 'pending' | 'flagged' | 'blocked' | 'csam',
  score: number,            // 自动检测置信度
  categories: string[],     // adult / violence / ...
  by: 'auto' | 'report' | 'admin' | 'csam-provider',
  at: number,               // 时间戳
  reason: string
}
```
映射:高分→`ListType=Block`(复用 /file 拦截);中分→`Label=adult`(safeMode 隐藏);`csam`→独立隔离流程(永不再服务 + 走上报)。

## 5. 分阶段计划

### Phase 0 — 边界加固(最快、不依赖 AI)
- 访客上传加 **MIME/扩展名白名单**(`functions/upload.js` + `upload-from-url.js` 的 guest 分支)。
- 文件详情/预览页加 **"举报"入口** → 新增 `functions/api/report.js`(写 `moderation.status='flagged'`,限流)。
- (可选)访客上传加 **Turnstile** 人机校验防批量滥用。
- 验证:非白名单类型被拒;举报后该文件在管理端可见为 flagged。

### Phase 1 — 人工管控(立即可治理)
- 新增**管理员审核队列**:`admin.html` 加面板列出 `pending|flagged`,动作 approve / reject(=block)/ delete;后端复用 `manage/block` + 新增 `manage/approve`,列表用 `manage/list` 加过滤参数。
- `guest_config` 加 `moderationMode: 'post' | 'pre'`(默认 post)。`pre` 时:guest 上传默认 `moderation.status='pending'`,`/file/[id].js` 的 `shouldBlock` 扩展为"pending 且非上传者 → 拦截"。
- 验证:pre 模式下访客新上传默认不可公开访问,管理员 approve 后可访问。

### Phase 2 — 自动检测(Workers AI 异步减负)
- `wrangler.jsonc` 加 `"ai": { "binding": "AI" }`。
- 新增 `functions/utils/moderation.js`:`scanImage(bytes)` 用 LLaVA VQA;`scanText(str)` 用 Llama Guard 3。
- 在 guest 上传成功后用 `context.waitUntil(...)` **异步**调用 → 写 `moderation` + 必要时置 `ListType=Block`/`Label=adult`。**不阻塞上传**。
- 阈值与映射可在 `guest_config` 配置。
- 验证:上传明显违规测试图后,数秒内 metadata 被打标/置 Block;正常图不受影响;上传延迟无明显增加。

### Phase 3 — CSAM 合规层(法律强制,单独流程)
- **同步硬拦**:guest 上传时先算 `SHA-256`,查 KV 黑名单 `blocklist:hash:<sha256>` → 命中即 `451` 拒收、**不落库**。
- 接入专业服务(取得凭据后):凭据放 **Cloudflare Secret**(`wrangler pages secret put`),在 `moderation.js` 增 `scanCsam(bytes)`;命中 → 隔离(`status='csam'`,永不服务)+ 告警 + 走**上报流程**(可参考 Cloudflare Workflows 简化 NCMEC 上报)。
- 控制台 CSAM Scanning Tool 保持开启作基线。
- ⚠️ 命中处置不得与普通 NSFW 混用;保留证据;按当地义务上报。

## 6. 代码落点速查
| 改动 | 文件 |
|---|---|
| guest 上传打标/硬拦/计数 | `functions/upload.js`、`functions/api/upload-from-url.js`(guest 分支) |
| 拦截逻辑扩展(pending/csam) | `functions/file/[id].js`(`shouldBlock`) |
| 审查工具 | 新增 `functions/utils/moderation.js` |
| 举报端点 | 新增 `functions/api/report.js` |
| 审核 approve | 新增 `functions/api/manage/approve/` |
| 审核队列 UI + moderationMode | `admin.html`、`functions/utils/guest.js`、`functions/api/guest-config.js` |
| AI/密钥绑定 | `wrangler.jsonc`、Cloudflare Secrets |

## 7. 风险与注意
- **no-store** ⇒ Cloudflare 控制台 CSAM 工具对访客文件无效,真正防护必须在 Worker 上传时做。
- **哈希比对只挡已知**,新/AI 生成 CSAM 需 AI 分类器(商业服务)。
- **服务审核门槛**:个人运营 + 匿名上传站,申请专业 CSAM 服务时会被重点盘问治理流程;申请前先把 Phase 0/1 做好更易过审。
- **成本/延迟**:Workers AI 有免费额度;同步硬拦只对 hash(快),AI 走异步不阻塞。
- **隐私**:对访客文件做审查,需在条款/说明中告知。
- **法律**:CSAM 处置是硬性合规,执行 Phase 3 前应确认运营主体所在地义务。

## 8. 执行约定(沿用本项目惯例)
- 每个 Phase **单独开分支**(如 `feat/moderation-phase0`),**小步提交**。
- 每步按各自"验证"自测;跑 `npx mocha`,失败集不得超过当时基线;UI 改动用本地 `npm start` + 浏览器实测。
- 通过后:合并 `main` → `npm run pages:deploy` → 推 `origin/main`(逐项经用户确认)。
- 密钥一律走 Cloudflare Secret / `.dev.vars`(已 gitignore),绝不进代码或有公开 GET 的配置。

## 9. 执行前需用户拍板的开放项
- pre vs post moderation 默认值。
- 自动检测是否启用 / 阈值 / 是否叠加第三方。
- CSAM 专业服务选哪家(决定凭据与接线方式)。
- 运营主体的法律上报义务归属。

## 10. 与「访客存储后端计划」(`docs/guest-storage-backends-plan.md`)的相互依赖
若**先**实施存储后端计划(访客可上传到 Telegram 以外的后端),本计划需相应调整:
- **扫描钩子改为后端无关**:审查必须在"读到字节之后、`uploadToR2/S3/...` 分发之前"的公共位置执行,而非只在 telegram 分支(Phase 2/3 的落点要前移到分发前)。
- **下架/移除改为按后端**:CSAM/违规命中需真正删字节时,复用 `functions/api/manage/delete`(已按后端删 R2 对象 / S3 / Discord 消息等);Telegram 仍是"清频道"。元数据级拦截(`ListType=Block` + `/file` 的 `shouldBlock`)各后端通用、不变。
- **顺序前置(重要)**:放开非 Telegram 后端 = 访客内容进入持久的管理员存储,风险升级。**在审查能力(至少 Phase 0/1 + CSAM 基线)就位前,不应对访客开放 Telegram 以外的后端。**
