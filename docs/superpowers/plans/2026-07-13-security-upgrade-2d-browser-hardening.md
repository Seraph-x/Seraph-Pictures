# Security upgrade 2D browser hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 保持像素与交互不变，将浏览器依赖本地化、启用严格 CSP/安全头，并用 Playwright 与视觉基线阻止回归。

**Architecture:** 锁定 npm 浏览器依赖并由构建脚本复制到 /vendor；Legacy 页面把内联样式/脚本按职责拆成小型本地模块；Pages/Docker 共享生成的安全头策略。

**Tech Stack:** Vue 2/Element UI legacy runtime、Vite Vue 3、Playwright、CSP、ESLint、Mocha。

---

## File map

- Modify root package dependencies/lockfile for pinned Legacy browser packages。
- Create: frontend/scripts/copy-vendor.mjs, generate-security-headers.mjs, verify-browser-assets.mjs。
- Create: legacy/{shared,index,login,admin,gallery,preview,webdav,storage-settings}/ JS/CSS modules。
- Reduce root Legacy HTML files to semantic markup and local asset references under 300 lines where modified。
- Create: frontend/public/_headers source or generated frontend/dist/_headers。
- Add Docker security-header middleware。
- Create: playwright.config.js, e2e/*.spec.js, e2e/fixtures/, e2e/visual-baselines/。
- Add tests for CSP, external resources, vendor output, and visual manifest。

### Task 1: Verify the immutable pre-2A0 visual baseline

- [ ] **Step 1: Use the playwright skill**

Read and follow the available playwright SKILL.md before browser automation.

- [ ] **Step 2: Verify baseline provenance**

Read the manifest committed before 2A0 and verify its commit, fixture digest, route list, viewport, timezone, locale, browser version, and screenshot hashes. Refuse to continue if the baseline was created after any 2A implementation commit or if provenance is incomplete.

- [ ] **Step 3: Reproduce baseline screenshots and DOM manifests**

Build the current phase and run the same deterministic fixtures for root, login, admin, gallery, preview, WebDAV, storage settings, Vue Drive, Vue Storage, and Vue Status. Compare route, viewport, visible text hash, key control rectangles, and screenshot to the immutable pre-2A0 artifacts.

- [ ] **Step 4: Assert the visual gate remains immutable**

The test fails when a required baseline/manifest is absent or differs. It must not auto-update, regenerate, or replace baseline artifacts.

- [ ] **Step 5: Commit**

Commit only verification harness changes as “test: verify immutable frontend baseline”. Do not modify pre-2A0 baseline files.

### Task 2: Pin and copy browser dependencies locally

- [ ] **Step 1: Write failing browser-asset tests**

Require local outputs for Vue 2, Element UI JS/CSS, Font Awesome CSS/fonts, SimpleWebAuthn, PDF.js worker/runtime, NSFW.js, and TensorFlow.js. Reject jsDelivr/unpkg/cdnjs script/style URLs.

- [ ] **Step 2: Run RED**

Run: npx mocha test/browser-assets.test.js

Expected: production HTML references jsDelivr.

- [ ] **Step 3: Add reviewed package versions**

Use maintained compatible patch releases. Run npm audit after each addition. Do not migrate Vue 2 pages to Vue 3 in this phase.

- [ ] **Step 4: Implement copy-vendor.mjs**

Use an immutable manifest mapping package source to exact /vendor destination and expected SHA-256. Delete stale destination files before copying; fail if source/hash is wrong.

- [ ] **Step 5: Replace URLs without markup changes**

Change only script/link src/href values and required PDF worker path.

- [ ] **Step 6: Run GREEN, build, visual compare, and commit**

Require zero visual diff and no browser console errors. Commit as “build: self-host legacy browser dependencies”.

### Task 3: Extract shared inline bootstrap behavior

- [ ] **Step 1: Write failing behavior tests**

Cover theme initialization before paint, locale, safe redirects, password toggle, and existing global functions used by markup.

- [ ] **Step 2: Run RED**

Expected: behavior resides in inline scripts/event attributes.

- [ ] **Step 3: Extract shared modules**

Create focused files under legacy/shared, each under 300 lines and functions under 50. Replace onclick/onload attributes with addEventListener while preserving event order and visible behavior.

- [ ] **Step 4: Run GREEN and visual tests**

Test root/login/block/allow pages in both themes and languages.

- [ ] **Step 5: Commit**

Commit as “refactor: externalize shared legacy bootstrap”.

### Task 4: Split oversized Legacy pages by feature

- [ ] **Step 1: Add per-page failing smoke tests**

For each page, assert visible controls, initial state, API calls, dialogs, and navigation before extraction.

- [ ] **Step 2: Extract one page at a time**

Order: storage-settings, login, WebDAV, gallery, preview, index, admin. For each page:

1. move inline CSS into page CSS modules;
2. move API/state/dialog logic into named JS modules;
3. keep HTML semantic order and classes unchanged;
4. run its smoke and visual tests;
5. commit independently.

- [ ] **Step 3: Enforce metrics**

Every authored changed HTML/JS/CSS file must meet the 300-line limit; every function must meet length/complexity/nesting limits. Minified vendor files are generated artifacts and excluded by exact vendor directory only.

- [ ] **Step 4: Run full visual comparison**

Reject any pixel/control-geometry/text change. Do not “update” baselines to accept accidental drift.

### Task 5: Generate strict CSP and security headers

- [ ] **Step 1: Write failing header tests**

Require:

- default-src self;
- script-src self with only required static hashes;
- no unsafe-eval;
- object-src none;
- base-uri self;
- frame-ancestors none;
- explicit frame-src for Office preview;
- worker-src self/blob only if PDF/TensorFlow requires it;
- X-Content-Type-Options, Referrer-Policy, Permissions-Policy.

- [ ] **Step 2: Run RED**

Run: npx mocha test/security-headers.test.js

Expected: no generated _headers and no Docker equivalent.

- [ ] **Step 3: Implement deterministic header generation**

Compute hashes only for immutable inline blocks that cannot be removed. Fail the build when an inline script/event attribute is not accounted for. Keep individual Pages headers within platform limits; use Functions middleware if CSP exceeds the static header limit.

- [ ] **Step 4: Add Docker middleware from the same policy data**

Serialize equivalent directives; do not duplicate manually maintained policy strings.

- [ ] **Step 5: Run GREEN and commit**

Build, test headers on Pages and Docker, then commit as “fix: enforce browser security headers”.

### Task 6: Add Playwright security E2E

- [ ] **Step 1: Write tests that fail against missing hardened behavior**

Cover login, changed-password old-session rejection, guest public upload, guest quota, public direct link, private anonymous concealment, signed private share, revoked/expired share, admin listing, Storage, Drive, and minimal anonymous status.

- [ ] **Step 2: Run RED**

Run the focused E2E suite against local Pages and Docker runtimes. Confirm failures correspond to unimplemented assertions, not fixture errors.

- [ ] **Step 3: Complete fixtures and runtime launchers**

Use real local KV/R2/DO persistence and SQLite test database. Do not replace coordinator/storage calls with production mock success routes.

- [ ] **Step 4: Run GREEN**

Run desktop Chromium plus the mobile viewport needed for visual invariants. Require zero page errors, CSP violations, failed requests, and unhandled console errors.

- [ ] **Step 5: Commit**

Commit as “test: add end-to-end security coverage”.

### Task 7: Add coverage and frontend governance

- [ ] **Step 1: Add a failing coverage contract**

Require security-critical policy/state modules to meet an explicit branch threshold. Do not set a global threshold that encourages meaningless tests.

- [ ] **Step 2: Instrument authored modules**

Exclude vendor/generated output only. Publish text and machine-readable reports without source maps containing secrets.

- [ ] **Step 3: Add CI gates**

Run E2E, visual, CSP, asset, and coverage checks before production build/deploy approval.

- [ ] **Step 4: Run GREEN and commit**

Commit as “ci: enforce browser and security coverage”.

### Task 8: Production verification

- [ ] **Step 1: Deploy coordinator, probe, then Pages**

Use the phase 2C ordered workflow.

- [ ] **Step 2: Validate CSP and local assets**

Inspect response headers, browser CSP console, network origins, and vendor cache behavior on deployment URL and custom domain.

- [ ] **Step 3: Re-run key E2E against production-safe fixtures**

Do not mutate or delete unrelated user data. Use uniquely prefixed temporary files and clean them through real APIs.

- [ ] **Step 4: Record evidence and commit**

Update the security report with hashes, test counts, deployment URLs/IDs, HTTP status, CSP output, and zero visual diffs. Commit as “docs: complete phase two security evidence”.
