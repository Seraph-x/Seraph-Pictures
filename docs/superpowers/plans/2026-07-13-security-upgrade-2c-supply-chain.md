# Security upgrade 2C supply chain implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 清除当前高危依赖，建立 lint/规模/审计/测试/构建/协调 Worker/Pages 的强制部署门禁。

**Architecture:** 三个 lockfile 独立审计；依赖逐个升级并验证，不运行 force 修复。CI 汇总 required checks，生产部署严格依赖汇总结果。

**Tech Stack:** npm 11、ESLint、Mocha、GitHub Actions、Wrangler。

---

## File map

- Modify: root/server/frontend package.json and lockfiles。
- Create: eslint.config.js, scripts/check-code-metrics.mjs, scripts/check-module-boundaries.mjs。
- Create: functions/package.json with type=module boundary。
- Modify: .github/workflows/ci-test.yml, pages-deploy.yml, docker-smoke.yml, docker-image.yml。
- Create: .github/dependabot.yml and security audit tests。
- Modify: README deployment/security gate documentation。

### Task 1: Capture and assert the vulnerable baseline

- [ ] **Step 1: Add a failing audit contract test**

Create test/supply-chain-contract.test.js that reads package manifests/workflows and requires:

- direct Hono version at or above the advisory fix;
- Wrangler resolved outside the vulnerable range;
- no vulnerable form-data resolution;
- audit scripts for root/server/frontend;
- no force audit command.

- [ ] **Step 2: Run RED**

Run: npx mocha test/supply-chain-contract.test.js

Expected: current manifests resolve known vulnerable versions.

- [ ] **Step 3: Save sanitized current audit evidence**

Run all three package-lock-only JSON audits and record only package, severity, advisory ID, vulnerable range, and dependency path in the security report.

- [ ] **Step 4: Commit the RED test**

Commit only the test/report baseline as “test: capture dependency security baseline”.

### Task 2: Upgrade Hono in root and Docker

- [ ] **Step 1: Update only Hono and regenerate relevant lockfiles**

Select the smallest compatible non-vulnerable release at implementation time from official npm/advisory data. Do not mix Wrangler changes.

- [ ] **Step 2: Run focused GREEN verification**

Run server route tests, CORS/security regressions, full test suite under 60 seconds, and server audit.

- [ ] **Step 3: Verify no behavioral drift**

Compare API contract fixtures before/after; Hono upgrade may not change cookie, CORS, header, body-limit, or route semantics.

- [ ] **Step 4: Commit**

Commit manifests/lockfiles as “build: upgrade Hono security fixes”.

### Task 3: Upgrade Wrangler and transitives

- [ ] **Step 1: Update Wrangler without force**

Choose a version beyond all current advisory ranges. Prefer parent upgrade; add a narrow override only if the parent cannot resolve a fixed transitive.

- [ ] **Step 2: Approve required install scripts explicitly**

Review esbuild/workerd/sharp/fsevents lifecycle scripts and record only the packages actually required by the build. Configure npm allow-scripts explicitly; do not use dangerously-allow-all-scripts.

- [ ] **Step 3: Run build/runtime verification**

Run coordinator dry-run, Pages Functions build, frontend production build, all tests, and root audit.

- [ ] **Step 4: Commit**

Commit as “build: upgrade Cloudflare toolchain securely”.

### Task 4: Resolve form-data and remove obsolete telemetry dependency

- [ ] **Step 1: Trace dependency paths**

Run npm explain form-data and npm explain @cloudflare/pages-plugin-sentry. Confirm whether each is runtime-reachable.

- [ ] **Step 2: Write/extend tests before removal or override**

Keep the existing security regression asserting telemetry stays disabled without SENTRY_DSN. Add a build test for the replacement official Sentry path if telemetry remains.

- [ ] **Step 3: Implement the narrow fix**

Upgrade the parent or apply the existing minimum safe form-data override. Remove deprecated Pages Sentry plugin only after confirming no import remains.

- [ ] **Step 4: Run GREEN and commit**

Run security regression, build, tests, and audit. Commit as “build: remove vulnerable legacy dependencies”.

### Task 5: Add lint and hard code metrics

- [ ] **Step 1: Write failing governance tests**

Require package scripts named lint, check:metrics, check:boundaries, audit:all, and verify. The metrics script must report file/function/nesting/parameter/complexity violations with paths and line numbers.

- [ ] **Step 2: Run RED**

Run: npx mocha test/code-governance.test.js

- [ ] **Step 3: Implement ESLint and deterministic checks**

Use separate ESM/CommonJS overrides. Exclude generated dist and vendored minified assets. Do not exclude authored Legacy modules or security workers.

- [ ] **Step 4: Fix surfaced violations only in changed scope**

Split files by responsibility; do not suppress warnings globally. Existing untouched debt may be baselined in a checked-in explicit list, but every changed file must pass current limits.

- [ ] **Step 5: Run GREEN and commit**

Run npm run lint, check:metrics, check:boundaries, and unit tests; commit as “build: enforce code quality gates”.

### Task 6: Remove Node module-type and install warnings

- [ ] **Step 1: Add failing clean-log tests**

Spawn the focused API test and dependency install in a controlled fixture; assert no MODULE_TYPELESS warning and no pending unapproved install scripts.

- [ ] **Step 2: Run RED**

Expected: current tests and installs emit both warning classes.

- [ ] **Step 3: Add scoped module boundary and script approvals**

Use functions/package.json with type=module rather than changing the root CommonJS interpretation. Approve only reviewed lifecycle packages.

- [ ] **Step 4: Run GREEN and commit**

Run clean install, focused tests, full tests, and build. Commit as “build: make module and install policy explicit”.

### Task 7: Pin GitHub Actions

- [ ] **Step 1: Add a failing workflow test**

Reject uses entries ending in mutable tags such as @v4. Allow only full 40-character reviewed SHAs with an adjacent version comment.

- [ ] **Step 2: Run RED**

Run: npx mocha test/ci-workflow.test.js

- [ ] **Step 3: Resolve official action SHAs**

Use GitHub official repositories/releases, record source URLs and release versions, then replace checkout/setup-node/upload actions consistently.

- [ ] **Step 4: Run GREEN and commit**

Validate YAML and workflow contract; commit as “ci: pin GitHub Actions by commit”.

### Task 8: Build the mandatory CI/deploy DAG

- [ ] **Step 1: Extend failing workflow contract**

Require jobs for audit, lint/metrics, unit/contract, coordinator integration, E2E/visual, build, coordinator deploy/migrate, binding probe, and Pages deploy. Pages must need every prior production gate. The E2E/visual job must execute the suites progressively created in 2A0, 2A1, and 2B; fail when a suite or immutable baseline is absent, and forbid skip/continue-on-error behavior.

- [ ] **Step 2: Run RED**

Expected: current pages-deploy builds and deploys without test/audit dependencies.

- [ ] **Step 3: Implement reusable scripts and ordered jobs**

Use npm ci in all package roots. Keep deployment credentials scoped only to deployment jobs. Upload no secret-containing artifacts. This phase promotes existing E2E/visual suites to mandatory deployment dependencies; it does not defer their creation to 2D.

- [ ] **Step 4: Verify locally and with a non-production workflow dispatch**

Validate workflow syntax, run npm run verify, deploy a preview coordinator/Pages pair, and prove a deliberately failing test prevents deployment.

- [ ] **Step 5: Commit**

Commit as “ci: block production deploy on security verification”.

### Task 9: Add continuous dependency monitoring

- [ ] **Step 1: Add failing configuration test**

Require weekly npm updates grouped separately for root, server, and frontend, with production/security updates not mixed with unrelated majors.

- [ ] **Step 2: Add Dependabot and documentation**

Set least-privilege permissions, reasonable PR limits, and no auto-merge.

- [ ] **Step 3: Run GREEN and commit**

Commit as “ci: monitor dependency security updates”.
