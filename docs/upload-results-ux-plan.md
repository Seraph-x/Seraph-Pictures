# 批量操作栏单行 + 上传结果(居中 / 视图切换 / 排序)— 实施计划书

> 目的:修复后台「选择后批量操作栏」换行问题;首页 Upload Results 顶部两栏居中、增加 列表/网格 视图切换、增加按上传顺序的 正序/倒序 排序。
> 本文档用于跨会话续作:对话中断后,新会话读此文件即可接着干。

## 状态
- 📋 待实施(计划已确认,尚未写代码)
- 建议分支:`feat/upload-results-ux`(从 `main` 切出)
- 工作目录:`/Users/zhuzhishang/K-Vault`
- 部署流程(用户惯用):分支实现 → 浏览器实测 → 用户确认 → 合并 `main` → `npm run pages:deploy` → 推送 `main`(推送也会触发 Cloudflare Git 集成再部署一次)

## 已确认决定
1. 后台批量栏「可拖拽」行为(`startBatchDrag`)**保留**,只加 nowrap 防换行。
2. 需求3 的「图表展示」= **网格/卡片视图**(与后台 grid/list 一致)。

---

## 需求 1 — 选择后批量操作栏默认单行(Image #4 → Image #5)
**文件**:`admin-imgtc.css`(主要);`admin.html`(批量栏 markup 在 1711–1726,无需大改)。

**根因**:`.batch-toolbar` 默认即「居中单行」(admin-imgtc.css:556 `position:fixed; left:50%; transform:translateX(-50%); display:flex; ...`,无 flex-wrap)。但 `.batch-actions`(el-button-group)的 `display:flex`(admin-imgtc.css:599)被**后加载**的 Element UI `.el-button-group{display:inline-block}`(admin.html:15 在 14 之后)覆盖,组内 el-button 退回浮动布局,**横向空间一紧(窄窗 / 浏览器缩放)浮动按钮就换行** → Image #4 的 3+1。移动端已修(mobile-refactor.css:825 `display:inline-flex !important; flex-wrap:nowrap !important`),桌面端没修。

**改法**(在 admin-imgtc.css 基础规则补充):
```css
.batch-toolbar { flex-wrap: nowrap; }
.batch-toolbar .batch-actions {
  display: inline-flex !important;
  flex-wrap: nowrap !important;
}
```
- 让 4 个操作按钮永远单行(= Image #5)。默认居中本就对,拖拽保留不动。
- 可选:窄到极限时让 `.batch-shortcuts` 先换行/隐藏,而不是挤按钮(非必须)。

**验证点**:把浏览器缩放到 125%–150% 或缩窄窗口,选中多个文件,批量栏的「Copy Links/Move Folder/Delete/Download」始终一行。

---

## 需求 2 — Upload Results 顶部两栏居中对齐(index.html)
**现状**:`.result-actions`(按钮行,index.html:2590)在 `.card-header`(371,`justify-content:space-between`)里靠左;`.link-format-tabs`(格式行,2612 / CSS 1128)靠左。

**改法**(index.html 内联 `<style>`):
```css
.result-section .card-header { flex-direction: column; align-items: center; }
.result-section .result-actions { justify-content: center; }
.link-format-tabs { justify-content: center; }
```
标题、按钮行、格式标签行整体居中。注意只限定在 `.result-section`,别影响左侧 Upload Files 卡片的 header。

---

## 需求 3 — 上传文件 列表/网格 视图切换(index.html)
**改法**:
- data 加 `resultViewMode: 'list'`(默认列表,即现状)。
- 操作行加一个切换按钮(图标 fa-list / fa-th),点了在 `'list'`↔`'grid'` 间切。
- `.result-list` 绑 `:class="{ 'is-grid': resultViewMode === 'grid' }"`。
- CSS:
  ```css
  .result-list.is-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .result-list.is-grid .result-item { flex-direction: column; align-items: stretch; }
  .result-list.is-grid .result-item-preview { width: 100%; height: 140px; }
  .result-list.is-grid .result-item-actions { justify-content: center; }
  ```
  list 模式保持现有 `.result-item` 横向行不变。
- i18n:`home.viewList` / `home.viewGrid`(zh+en)。

---

## 需求 4 — 按上传顺序 正序/倒序(index.html)
**现状**:新文件用 `unshift`(index.html:3703、4470)插到数组头 → `uploadedFiles` 本身是「最新在前」。

**改法**:
- data 加 `uploadSortDesc: true`(默认「最新在前」= 现状)+ 切换按钮(fa-sort-amount-down / -up)。
- computed `displayedFiles()` 返回 `this.uploadSortDesc ? this.uploadedFiles : [...this.uploadedFiles].slice().reverse()`。
- 结果列表 v-for 改成遍历 `displayedFiles`。

**关键坑(务必处理)**:当前 `v-for="(file, index) in uploadedFiles"` 用 `:key="index"`,且 `removeFromResults(index)`(4593 `splice(index,1)`)按数组下标删。改用 `displayedFiles` 后显示下标 ≠ 真实数组下标,会**删错/选错文件**。需:
- 给每个上传项加稳定 `id`(上传时生成,如 `Date.now()+随机` 或用最终链接做 key)。
- `:key` 改用 `file.id`。
- `removeFromResults` 改为按引用删:`this.uploadedFiles.splice(this.uploadedFiles.indexOf(file), 1)`,调用处传 `file` 而非 `index`。
- 复选(`v-model="file.selected"`)本就是按对象引用,OK;复制/全选遍历的是 `uploadedFiles`,顺序无关,OK。

---

## 测试(npm start + Playwright)
- `npm start`(本地 8080,basic auth admin:123;首页无需登录即可上传到 r2:`curl -u admin:123 -F file=@x -F storageMode=r2 /upload`,或直接用页面上传)。
- 需求1:后台选中多个文件,窗口缩放 100/125/150%,批量栏始终单行;拖拽仍可用。
- 需求2:首页上传后,结果区按钮行与格式行居中。
- 需求3:点切换 → 列表/网格来回切,网格为卡片缩略图。
- 需求4:点正序/倒序 → 按上传先后重排;**排序后删除/选中/复制仍命中正确文件**(重点回归)。

## 收尾
分支实现 → 实测通过 → 报告用户确认 → 合并 `main` → `npm run pages:deploy` → 推送 `main`。
