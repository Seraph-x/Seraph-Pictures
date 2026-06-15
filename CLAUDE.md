# CLAUDE.md — K-Vault 项目约定

> 本文件是 K-Vault 项目的专属约定;全局规则仍以 `~/.claude/CLAUDE.md` 为准,此处仅补充本项目的工作方式。

## 部署仪式(每次上线按此顺序)

1. 从 `main` 切分支实现(`feat/*` 或 `fix/*`)。
2. `npm start` 起本地服务(8080,basic auth `admin:123`,r2 可用)+ Playwright 浏览器实测;UI 改动要截图肉眼核对。
3. 提交到分支(conventional commits:`feat/fix/refactor/docs/style/chore`)。
4. **停下等用户确认**,再继续后续步骤。
5. 合并 `main`:`git merge --no-ff <branch>`。
6. `npm run pages:deploy`。
7. 推送 `main`:`git push origin main`(仅同步 GitHub 仓库,不触发部署;上线只由第 6 步 `npm run pages:deploy` 完成)。
8. curl 核实线上:抓取页面/资源并 `grep` 关键标记,确认改动已生效。
9. 停 dev server。

## 生产前先确认(门控)

- 分支内提交可自由进行,无需逐次确认。
- **合并 `main`、`npm run pages:deploy`、`git push`(尤其 force push)** 等影响生产或共享状态的动作,执行前必须先停下向用户确认。
- 用户的单次授权只对当次有效,不视为长期授权。

## 收尾清理

- 实测过程中生成的截图等临时文件(`*.png` 等)用完即删,不要入库。
- 收尾时关闭 Playwright 浏览器、停止后台 `npm start` dev server。
- 不提交 `.DS_Store`;暂存时按具体文件名 `git add <file>`,不要用 `git add -A` / `git add .`。
