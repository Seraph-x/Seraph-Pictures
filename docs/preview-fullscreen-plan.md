# 预览全屏 / 放大 — 实施计划书

> 目的:文件预览(视频/音频/PDF/Office/图片/文本)默认尺寸更大,并新增"全屏"按钮(真·全屏 API)。
> 本文档用于跨会话续作:即使对话中断,新会话读此文件即可接着干。

## 状态
- ✅ 已完成:实现 + 浏览器实测全部通过(commit `63dbcea`);随后合并 `main`、`npm run pages:deploy` 部署、推送 `main`。
- 分支:`feat/preview-fullscreen`(从 `main` 切出,main 已含预览本地化修复 commit `4a74193`)
- 工作目录:`/Users/zhuzhishang/K-Vault`
- 部署流程(用户惯用):合并 `main` → `npm run pages:deploy` → 推送 `main`(推送也会触发 Cloudflare Git 集成再部署一次)
- 用户要求:在分支完成 + 浏览器实测 → 用户确认无问题后再合并 main。

## 设计决定(已与用户确认)
1. 全屏方式:**真·全屏 API**(`requestFullscreen`,可脱离浏览器工具栏)。
2. 范围:**四个文件全做** — admin.html / gallery.html / index.html(三个弹窗) + preview.html(独立预览页)。

## 方案
**A. 默认放大**:弹窗容器/媒体由 `90vw×75–80vh` 提到约 `92vw×84vh`,`.preview-modal` padding `20px→12px`;preview.html 容器 `70vh→85vh`。
**B. 全屏按钮**:工具栏加 `fa-expand` 按钮 → 对预览根容器调 `requestFullscreen()`(带 `webkit` 兜底),再点/Esc 退出,图标切 `fa-compress`。
- 弹窗(admin/index/gallery):全屏目标 = `.preview-modal` 本身(`ref="previewModal"`),这样工具栏在全屏下仍可见、退出按钮可用。
- preview.html:全屏目标 = 预览容器。
- 音频类型隐藏全屏按钮(`v-if="previewData.type !== 'audio'"`)。
- `:fullscreen` + `:-webkit-full-screen` CSS:容器内 iframe/video 填满、容器放大到约 `100vw×92vh`、背景纯黑。

## 当前现状参考(改前的关键位置)
| 文件 | 容器尺寸 | padding | 工具栏容器 | 模态根标签 |
|---|---|---|---|---|
| admin.html | `.iframe-container`/`.preview-media` 90vw×75vh | `.preview-modal` 20px | `.preview-btns`(复制直链/下载) | `.preview-modal`(已加 `ref="previewModal"`) |
| index.html | 90vw×75vh | 20px | `.preview-btns`(复制/下载) | `.preview-modal` |
| gallery.html | 90vw×80vh | 20px | `.preview-info`(链接+复制) | `.preview-modal` |
| preview.html | `.iframe-preview-container` 100%×70vh | — | 顶部 action 按钮区 | 容器 div |

弹窗结构(三页一致):`.preview-modal` > 关闭按钮 + 预览元素(img/video/audio/`.iframe-container`/`.preview-unsupported`)+ 工具栏。

## 每文件改动清单
### admin.html
- [x] `.preview-modal` 加 `ref="previewModal"`
- [x] 工具栏 `.preview-btns` 加全屏按钮(audio 隐藏),`@click="togglePreviewFullscreen"`,图标/文案随 `isFullscreen` 切换
- [x] `data()` 加 `isFullscreen: false`
- [x] methods 加 `togglePreviewFullscreen()`(对 `$refs.previewModal` 请求/退出全屏,webkit 兜底)、`handleFullscreenChange()`(同步 `isFullscreen`)
- [x] `mounted` 注册 `document.addEventListener('fullscreenchange'/'webkitfullscreenchange', this.handleFullscreenChange)`;`beforeDestroy` 移除
- [x] `closePreview()` 内:若 `document.fullscreenElement` 则先退出全屏
- [x] CSS:padding 20→12;`.iframe-container`/`.preview-media`/img → ~92vw×84vh;新增 `.preview-modal:fullscreen`(+`-webkit-full-screen`)规则把容器放大到 100vw×92vh、背景黑、圆角 0
- [x] i18n:`admin.fullscreen`="全屏"/`admin.exitFullscreen`="退出全屏"(zh+en)

### index.html(结构同 admin,双引号代码风格)
- [x] 同 admin 全套;i18n 用 `home.*`(`home.fullscreen`/`home.exitFullscreen`),与现有 `home.copyDirectLink` 同区

### gallery.html
- [x] 同 admin;全屏按钮放进 `.preview-info`;i18n 用 `gallery.*`
- 注意:gallery 用 `previewImage(img)`,模态根仍是 `.preview-modal`(加 `ref`)

### preview.html(独立页,Vue 2 app)
- [x] `.iframe-preview-container` 加 `ref`;容器 70vh→85vh
- [x] 顶部按钮区(复制链接/下载/返回首页 那一排)加全屏按钮 → 对容器 `requestFullscreen`
- [x] data/methods/监听 同上;`:fullscreen` CSS
- [x] i18n:`preview.fullscreen`/`preview.exitFullscreen`(zh+en,文件内联词典)

## 全屏 API 兼容写法(参考)
```js
togglePreviewFullscreen() {
  const el = this.$refs.previewModal; // preview.html 用容器 ref
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (el) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
},
handleFullscreenChange() {
  this.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
}
```
- iframe 需 `allowfullscreen`(现有 iframe 已带)。

## 测试(npm start + Playwright)
- `npm start`(本地 8080,basic auth admin:123);用 `curl -u admin:123 -F file=@x -F storageMode=r2 /upload` 传 mp4/mp3/pdf/docx。
- 逐页(admin/gallery/index/preview)验证:默认尺寸明显变大;点全屏→`document.fullscreenElement` 非空且容器铺满;再点/Esc→退出、图标复位;Office iframe 全屏正常;audio 不显示全屏按钮。
- Playwright 注意:`requestFullscreen` 需用户手势,`browser_click` 真实点击可触发;`page.evaluate` 直接调可能被拒(打印 result 判断)。
- 视觉微调 vh 数值,避免工具栏被挤出视口。
- Office 真实渲染需线上(localhost 微软抓不到),本地只验证全屏行为。

## 收尾
- 截图/数据确认 → 报告用户 → 用户确认 → 合并 main → `npm run pages:deploy` → 推送 main。
- 本计划书 `docs/preview-fullscreen-plan.md` 默认**不随功能提交**(仅作续作用);合并前问用户是否保留/删除。
