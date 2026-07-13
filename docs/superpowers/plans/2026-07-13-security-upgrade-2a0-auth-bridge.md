# Security upgrade 2A0 auth bridge implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部署免费层 Coordinator Worker，并把 Cloudflare 管理员认证迁移到强一致、fail-closed 的 Durable Object，建立永久安全回滚下限。

**Architecture:** 单例 `AuthCoordinator` 在 SQLite-backed Durable Object 中保存初始化状态、PBKDF2 凭据、凭据版本和会话。Pages Functions 通过私有 DO binding 调用窄接口；绑定失败或状态损坏统一返回 503。

**Tech Stack:** Cloudflare Workers、Durable Objects SQLite、Pages Functions、WebCrypto、Mocha、Wrangler。

---

## File map

- Create: `workers/coordinator/wrangler.jsonc` — 私有 Worker、DO migration、R2/KV bindings。
- Create: `workers/coordinator/src/index.js` — 导出 DO class，并提供 Wrangler 要求的空 module default；不注册公开 fetch handler。
- Create: `workers/coordinator/src/auth/auth-coordinator.js` — DO request adapter。
- Create: `workers/coordinator/src/auth/auth-service.js` — 小于 300 行的认证状态机。
- Create: `workers/coordinator/src/auth/auth-repository.js` — SQLite statements/transactions。
- Create: `workers/coordinator/src/auth/password.js` — PBKDF2 与恒时比较。
- Create: `functions/utils/auth/coordinator-client.js` — Pages 私有 binding client。
- Create: `functions/utils/auth/password.js`, `session.js`, `cookies.js` — 从 329 行旧文件拆分。
- Modify: `functions/utils/auth.js` — 保留小型兼容 façade。
- Modify: `functions/api/auth/login.js`, `check.js`, `credentials.js`, `logout.js`。
- Modify: `wrangler.jsonc` — `AUTH_COORDINATOR` binding with `script_name`。
- Create: `test/coordinator-auth-state.test.js`, `test/cloudflare-auth-bridge.test.js`。
- Create: `scripts/probe-coordinator-binding.mjs`。
- Create: `playwright.config.js`, `e2e/baseline.spec.js`, `e2e/auth-coordinator.spec.js`, `e2e/visual-baselines/`。
- Create: `scripts/security/backup-kv-state.mjs`, `test/backup-kv-state.test.js`。

### Task 0: Capture immutable UI and recovery baselines

- [ ] **Step 1: Read and use the Playwright skill**

Create a deterministic local fixture with fixed locale, timezone, viewports, animations, background, and storage data. Do not change production markup before capture.

- [ ] **Step 2: Write the failing baseline-manifest test**

Require screenshots, visible-text hashes, key control rectangles, routes, and viewports for root, login, admin, gallery, preview, WebDAV, storage settings, Vue Drive, Vue Storage, and Vue Status.

- [ ] **Step 3: Capture and verify the real baseline**

Run `npm run build`, launch the local Pages-compatible server, then run `npx playwright test e2e/baseline.spec.js --update-snapshots`. Immediately rerun without update and require zero diff.

- [ ] **Step 4: Write RED backup tests**

`test/backup-kv-state.test.js` must require credential, storage config, guest config, schema/version, session index, and file metadata prefixes; encrypted output, a SHA-256 manifest, pagination, and no secret values in stdout.

- [ ] **Step 5: Implement and dry-run backup**

`node scripts/security/backup-kv-state.mjs --dry-run` lists counts only. Production backup requires `BACKUP_ENCRYPTION_KEY`, writes outside the repository, verifies decrypt/read-back, and prints only path plus checksum.

- [ ] **Step 6: Commit baseline tooling and artifacts**

```bash
git add playwright.config.js e2e scripts/security/backup-kv-state.mjs test/backup-kv-state.test.js package.json package-lock.json
git commit -m "test: capture pre-phase-two recovery baseline"
```

### Task 1: Define the auth coordinator contract

- [ ] **Step 1: Write the failing contract test**

Add cases in `test/coordinator-auth-state.test.js` for `bootstrapLogin`, `verifySession`, `changeCredentials`, `logout`, and `status`. The concurrent case must assert exactly one initialization:

```js
const results = await Promise.all([
  service.bootstrapLogin({ username: 'admin', password: 'first' }),
  service.bootstrapLogin({ username: 'admin', password: 'second' }),
]);
assert.strictEqual(results.filter((item) => item.ok).length, 1);
assert.strictEqual(repository.readState().initialized, true);
```

- [ ] **Step 2: Run RED**

Run: `npx mocha test/coordinator-auth-state.test.js`

Expected: FAIL because coordinator service/repository modules do not exist.

- [ ] **Step 3: Implement the minimal repository and service**

Use one transaction for bootstrap:

```js
async bootstrapLogin(input) {
  return this.repository.transaction(async () => {
    const state = this.repository.readAuthState();
    if (state) return this.verifyInitialized(input, state);
    this.verifyBootstrapInput(input);
    const credentials = await this.passwords.createRecord(input);
    this.repository.initialize(credentials);
    return this.issueSession(credentials.username, credentials.credVersion);
  });
}
```

Inject `repository`, `passwords`, `tokens`, and `clock`; do not import concrete storage in `auth-service.js`.

- [ ] **Step 4: Run GREEN**

Run: `npx mocha test/coordinator-auth-state.test.js`

Expected: all auth-state cases pass.

- [ ] **Step 5: Commit**

```bash
git add workers/coordinator/src/auth test/coordinator-auth-state.test.js
git commit -m "feat: add durable auth state service"
```

### Task 2: Add the private Durable Object runtime

- [ ] **Step 1: Write a failing runtime-structure test**

Create `test/coordinator-runtime-contract.test.js` asserting:

- `workers_dev` is `false`;
- no routes are configured;
- `AuthCoordinator` has a SQLite migration;
- unknown operations return `404 COORDINATOR_OPERATION_UNKNOWN`;
- malformed internal payloads return 400, never success.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/coordinator-runtime-contract.test.js`

Expected: FAIL because coordinator configuration and adapter are missing.

- [ ] **Step 3: Implement the runtime adapter**

`workers/coordinator/src/index.js` exports the class plus Wrangler's empty module marker:

```js
export { AuthCoordinator } from './auth/auth-coordinator.js';
export default {};
```

Route internal operations by an explicit allowlist. Keep handler functions under 50 lines and never register a default public `fetch` handler; `workers_dev=false` and no routes remain mandatory.

- [ ] **Step 4: Run GREEN and local Wrangler validation**

Run:

```bash
npx mocha test/coordinator-runtime-contract.test.js
npx wrangler deploy --dry-run --config workers/coordinator/wrangler.jsonc
```

Expected: tests pass; Wrangler compiles the DO Worker without a public route.

- [ ] **Step 5: Commit**

```bash
git add workers/coordinator test/coordinator-runtime-contract.test.js
git commit -m "feat: add private auth coordinator worker"
```

### Task 3: Replace Pages KV authentication with the bridge

- [ ] **Step 1: Write failing Pages bridge tests**

In `test/cloudflare-auth-bridge.test.js`, inject a coordinator stub and assert:

- absent binding returns `AUTH_STATE_UNAVAILABLE`/503;
- initialized coordinator never reads `BASIC_PASS`;
- bootstrap login returns a session only after coordinator success;
- changed `credVersion` rejects an old cookie immediately;
- Basic Auth uses coordinator verification;
- production rejects `AUTH_DISABLED=true` with `INSECURE_PRODUCTION_CONFIG`; only the explicit local `npm start` environment may bypass coordinator auth.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/cloudflare-auth-bridge.test.js`

Expected: FAIL because current `functions/utils/auth.js` reads KV/env directly.

- [ ] **Step 3: Split the oversized auth module**

Keep `functions/utils/auth.js` as exports only. `coordinator-client.js` gets the singleton ID with `idFromName('admin-auth')`, forwards only known operations, validates response envelopes, and throws typed errors on binding/network/schema failure.

- [ ] **Step 4: Migrate auth routes**

Update login/check/credentials/logout and all auth middleware consumers. Error mapping must preserve current visible messages where possible while returning stable machine codes and 503 on coordinator failure.

- [ ] **Step 5: Run GREEN and regression tests**

Run:

```bash
npx mocha test/cloudflare-auth-bridge.test.js test/auth-disabled.test.js test/api-v1.test.js
perl -e 'alarm 60; exec @ARGV' npm test
```

Expected: bridge tests and all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add functions/utils/auth functions/utils/auth.js functions/api/auth test
git commit -m "fix: make Cloudflare authentication fail closed"
```

### Task 4: Bind and probe the coordinator

- [ ] **Step 1: Write a failing configuration test**

Extend `test/ci-workflow.test.js` to require `AUTH_COORDINATOR`, `script_name = "k-vault-coordinator"`, coordinator-before-Pages order, and a binding probe.

- [ ] **Step 2: Run RED**

Run: `npx mocha test/ci-workflow.test.js`

Expected: FAIL because binding/deployment steps are absent.

- [ ] **Step 3: Add binding and probe script**

The probe calls an authenticated internal status operation through Pages and requires `{ initialized: boolean, schemaVersion: 1 }`. Configure the same coordinator binding for preview and production Pages environments. It prints no credentials or state values.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npx mocha test/ci-workflow.test.js
node scripts/probe-coordinator-binding.mjs --help
npx wrangler pages functions build frontend/dist
```

Expected: configuration tests pass and Pages Functions compile with the binding.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc scripts/probe-coordinator-binding.mjs test/ci-workflow.test.js
git commit -m "build: bind Pages to auth coordinator"
```

### Task 5: Add real auth bridge E2E

- [ ] **Step 1: Write failing browser scenarios**

Use the real local Pages/coordinator runtime to cover bootstrap administrator login, ordinary login, credential change, immediate old-session rejection, logout, missing coordinator binding, and coordinator exception. The last two cases must show the existing visible error surface and return 503 without env fallback.

- [ ] **Step 2: Run RED then GREEN**

Run `npx playwright test e2e/auth-coordinator.spec.js`. Confirm initial failures are missing bridge behavior, then require all scenarios, zero unexpected console/network errors, and zero visual diff against Task 0.

- [ ] **Step 3: Commit**

Commit the test and real-runtime fixtures as `test: cover coordinator authentication bridge`.

### Task 6: Establish the rollback floor

- [ ] **Step 1: Run full pre-deploy verification**

Run build, full tests, `git diff --check`, and coordinator/Pages dry-runs.

- [ ] **Step 2: Produce and verify the production backup**

Run `node scripts/security/backup-kv-state.mjs --environment production --output "$SECURITY_BACKUP_OUTPUT"`. Abort unless the absolute output path is outside the repository and read-back/manifest verification succeed.

- [ ] **Step 3: Deploy coordinator before Pages**

Run `npx wrangler deploy --config workers/coordinator/wrangler.jsonc --env production`. Record the version ID. On failure, stop before Pages deployment.

- [ ] **Step 4: Deploy and probe a preview candidate**

Deploy the exact built artifact with `npx wrangler pages deploy frontend/dist --project-name k-vault --branch security-2a0-candidate`, capture the preview URL, then run `node scripts/probe-coordinator-binding.mjs --base-url "$PAGES_PREVIEW_URL"`. Require coordinator schema version 1 and `initialized=false`. If deployment or the runtime binding probe fails, stop; do not change the production branch.

- [ ] **Step 5: Promote the verified artifact and initialize once**

Without rebuilding, verify the artifact manifest still matches the preview digest, run `npx wrangler pages deploy frontend/dist --project-name k-vault --branch main`, capture its URL in `PAGES_DEPLOYMENT_URL`, then repeat `node scripts/probe-coordinator-binding.mjs --base-url "$PAGES_DEPLOYMENT_URL"` before initialization.

Perform one real administrator login, then require `initialized=true`. Confirm the old session/version fails after one credential change test using non-production temporary credentials, then restore the intended credential through the coordinator path.

- [ ] **Step 6: Record rollback floor**

Write the 2A0 commit and deployment ID into the security report. State explicitly that older Pages deployments are forbidden after initialization.

- [ ] **Step 7: Commit evidence**

```bash
git add docs/2026-07-13_security-phase-two-report.md
git commit -m "docs: record 2A0 auth bridge evidence"
```
