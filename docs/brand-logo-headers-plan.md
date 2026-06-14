# 各页头部统一品牌图标(可点击回首页)— 实施计划书

> 目的:把 gallery(Image Browser)、admin、preview(File Preview)三页左上角的 Font Awesome 图标换成**品牌 logo**,点击 logo 回首页。
> 本文档用于跨会话续作:新会话读此文件即可接着干。

## 状态
- 待实施(计划已落,尚未改代码)
- 分支:`feat/brand-logo-headers`(已从 `main` 切出)
- 部署流程(用户惯用):分支实现 → 浏览器实测 → 用户确认 → 合并 `main` → `npm run pages:deploy` → 推送 `main`

## 关键发现:已有品牌系统,复用即可(无需写新 JS)
`theme.js` 的 `applyBrand()`(theme.js:976)在每个页面运行,会:
- 把所有 `.brand-name` 文本设为配置的品牌名(或默认 `Seraph's Pictures`);
- 把所有 `.brand-logo, .header-logo` 元素:设置 `src` 为配置的 `brandLogoUrl`(留空则用页面自带 `src`)、`cursor:pointer`、并绑定点击 → `window.location.href = '/'`(用 `data-brand-home` 防重复绑定)。

`index.html` 头部已用此模式(index.html:2270):
```html
<img src="/logo.png" alt="Seraph's Pictures Logo" class="brand-logo" loading="eager"
     onerror="this.onerror=null;this.src='/favicon.ico';" />
```
**结论**:三页只要把图标 `<i>` 换成同样的 `.brand-logo` `<img>`,theme.js 自动完成「换 logo + 点击回首页 + 跟随后台 brandLogoUrl 配置」。无需改 JS。前提:确认三页都加载了 `theme.js`(preview 已加载 preview.html:11;实现时核对 gallery/admin)。

## 资产
- 品牌 logo:`/logo.png`(已存在,133KB);回退 `/favicon.ico`。

---

## 改动 1 — gallery.html(Image Browser)
**markup**(gallery.html:866-868):把 `.header-title` 内的 `<i class="fas fa-images"></i>` 换成 `.brand-logo` `<img>`(同 index 写法)。保留标题文字 `<span>{{ t('gallery.title') }}</span>`。
**CSS**:gallery 现有 `.header-title i`(gallery.html:78)。新增:
```css
.header-title .brand-logo { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; box-shadow: 0 4px 12px rgba(194,100,63,0.2); }
```

## 改动 2 — admin.html(Admin)
**现状**:左上角是橙色圆角方块 `.home-btn`(admin-imgtc.css:530,`@click="goHome"` 已能回首页,goHome→`/` 见 admin.html:3715),内含 `<i class="fas fa-home"></i>`。
**markup**(admin.html:1124):把 `<i class="fas fa-home"></i>` 换成 `.brand-logo` `<img>`。保留 `.home-btn` 的 `@click="goHome"`(点击回首页;theme.js 也会给 img 绑回首页,二者皆导航首页,无害)。
**CSS**(admin-imgtc.css `.home-btn`):去掉橙色渐变底,让 logo 以图标本身呈现:
```css
.home-btn { background: transparent; box-shadow: none; padding: 0; }
.home-btn .brand-logo { width: 36px; height: 36px; border-radius: 10px; object-fit: cover; }
.home-btn:hover { box-shadow: none; }   /* 保留 scale(1.08) 悬停 */
```
(`.home-btn i` 规则可留可删;不再有 `<i>`。)

## 改动 3 — preview.html(File Preview)
**markup**(preview.html:737-739):把 `<i class="fas fa-eye"></i>` 换成 `.brand-logo` `<img>`。保留 `<span>{{ t('preview.title') }}</span>`。
**CSS**(preview 现有 `.header-title i` preview.html:80)。新增:
```css
.header-title .brand-logo { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; }
```
(preview 已有 "Back to Home" 按钮;logo 可点回首页,与其它页一致。)

---

## 测试(npm start + Playwright)
- gallery `/gallery.html`:左上角显示 logo(非 fa-images),点击跳 `/`。
- admin `/admin.html`(basic auth admin:123):左上角显示 logo(非橙方块 home 图标),点击跳 `/`。
- preview `/preview.html`:File Preview 左侧显示 logo(非眼睛),点击跳 `/`。
- 三页 logo 加载失败回退 favicon;肉眼核对截图与主题协调。

## 收尾
分支实现 → 实测通过 → 报告用户确认 → 合并 `main` → `npm run pages:deploy` → 推送 `main` → 核实线上 → 停 dev server。
