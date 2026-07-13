# Security upgrade phase two implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按安全回滚顺序完成审计剩余 P0/P1/P2 修复，并保证 Legacy/Vue 前端视觉与交互不变。

**Architecture:** 计划拆成 2A0、2A1、2B、2C、2D 五个可独立验证的发布单元。Cloudflare 以私有 Coordinator Worker + Durable Objects 提供强一致认证、配额、分享和 multipart 状态；Docker 用 SQLite 事务实现相同契约。

**Tech Stack:** Cloudflare Pages Functions、Workers、Durable Objects SQLite、KV、R2、Node.js 22、Hono、Mocha、Playwright、ESLint、GitHub Actions。

---

## Authoritative inputs

- Design: `docs/superpowers/specs/2026-07-13-security-upgrade-phase-two-design.md`
- Baseline command: `npm run build && perl -e 'alarm 60; exec @ARGV' npm test`
- Baseline result: `102 passing`
- Current audit: root `6 high + 1 low`, server `1 high`, frontend `0`
- Rollback rule: once coordinator auth state is initialized, never deploy code older than 2A0; after an irreversible phase schema marker commits, advance the floor to that verified phase.

## Plan map

| Order | Plan | Required release outcome |
|---|---|---|
| 1 | `2026-07-13-security-upgrade-2a0-auth-bridge.md` | Capture visual/KV baseline; coordinator and auth bridge become rollback floor |
| 2 | `2026-07-13-security-upgrade-2a1-access-policy.md` | Config, visibility, guest quota, status, and migration boundaries |
| 3 | `2026-07-13-security-upgrade-2b-storage-upload.md` | R2 multipart and Cloudflare Storage/Drive parity |
| 4 | `2026-07-13-security-upgrade-2c-supply-chain.md` | Vulnerabilities cleared and deployment gates enforced |
| 5 | `2026-07-13-security-upgrade-2d-browser-hardening.md` | Local browser assets, CSP, E2E, visual and metrics governance |

## Global execution rules

- [ ] Run each task red-green-refactor; never write production behavior before the named failing test.
- [ ] Keep functions at 50 lines or fewer, files at 300 lines or fewer, nesting at 3 or fewer, and cyclomatic complexity at 10 or fewer.
- [ ] Split any oversized legacy file before behavior changes in that file.
- [ ] Do not modify visible copy, layout, colors, typography, spacing, controls, or navigation.
- [ ] Preserve failures as explicit errors; do not add mock success or silent fallback paths.
- [ ] Use dependency injection for KV, R2, DO, clock, hashing, and storage adapters.
- [ ] Run backend tests with a hard 60-second timeout.
- [ ] Complete and verify one phase before starting the next phase.

## Phase checkpoint protocol

For every phase:

- [ ] Run the phase-specific tests listed in its plan.
- [ ] Run `npm run build`.
- [ ] Run `perl -e 'alarm 60; exec @ARGV' npm test` and require zero failures.
- [ ] Run `git diff --check`.
- [ ] Run `git status --short` and review every changed/generated file.
- [ ] Record the commit and deployment identifiers in `docs/2026-07-13_security-phase-two-report.md`.
- [ ] For deployed phases, verify both the deployment URL and `https://pictures.seraphzero.com`.

## Release gates

### 2A0 gate

- [ ] Deterministic screenshots/DOM manifests exist for every key page before production code changes.
- [ ] Encrypted backups cover credential, storage configuration, guest configuration, and file metadata keys before migration.
- [ ] Coordinator has no public route and `workers_dev = false`.
- [ ] Binding probe passes on the preview candidate before production Pages deployment.
- [ ] Concurrent bootstrap produces exactly one initialized credential state.
- [ ] Credential change invalidates old sessions immediately.
- [ ] A coordinator failure produces HTTP 503 and never uses environment credentials.
- [ ] Production rejects `AUTH_DISABLED=true`; the bypass remains local-development-only.
- [ ] Mark 2A0 commit/deployment as minimum rollback version before initialization.

### 2A1 gate

- [ ] Existing KV metadata backup checksum is recorded outside source control.
- [ ] Existing file records are explicitly migrated to `public`.
- [ ] Missing visibility after migration fails closed.
- [ ] Guest quota reservation is atomic and bounded.
- [ ] Anonymous status performs zero storage probes.
- [ ] Preview and production probes pass before metadata migration; marker commit advances the rollback floor to 2A1.

### 2B gate

- [ ] Multipart part retry, conflicting retry, complete/cancel race, publish retry, and alarm cleanup pass.
- [ ] Ambiguous R2 create/complete uses deterministic-key HEAD reconciliation; unknown multipart uploads expire after one day.
- [ ] R2 completion never constructs the entire object in memory.
- [ ] Non-R2 oversize uploads fail at initialization.
- [ ] Cloudflare and Docker Storage/Drive contract tests match.

### 2C gate

- [ ] Root/server/frontend audits report zero high or critical vulnerabilities.
- [ ] Pages deploy depends on audit, lint, tests, E2E, visual check, build, coordinator deployment, and binding probe.
- [ ] GitHub Actions are pinned to reviewed commit SHAs.

### 2D gate

- [ ] Production output has no unapproved external script or stylesheet.
- [ ] CSP contains no `unsafe-eval` and no broad external script host.
- [ ] Key-page screenshot diffs are zero or explicitly rejected as regressions.
- [ ] Changed production files and functions satisfy repository metrics.

## Final verification

- [ ] Run `npm ci`, `npm --prefix frontend ci`, and `npm --prefix server ci` from clean dependency directories.
- [ ] Run all three audits with `--audit-level=high`.
- [ ] Run lint, metrics, unit, contract, coordinator integration, Playwright, visual, and build checks.
- [ ] Exercise anonymous/public/private/admin/signed access on production.
- [ ] Upload and download one guest R2 object; verify quota and metadata.
- [ ] Cancel one multipart upload; verify coordinator and R2 cleanup.
- [ ] Confirm `/api/status` anonymous body is exactly the minimal schema.
- [ ] Confirm existing pre-migration public URLs still work.
- [ ] Confirm no secrets or raw persistent client IPs appear in logs.
- [ ] Finalize `docs/2026-07-13_security-phase-two-report.md` with commands and evidence.
