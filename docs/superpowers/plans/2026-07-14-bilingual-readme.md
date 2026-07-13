# Bilingual README implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated Chinese and English root READMEs with detailed, equivalent phase-two documentation and synchronize contradictory Docker guide facts.

**Architecture:** Treat the latest branch configuration, shared contracts, runtime code, and tests as the source of truth. Build a compact Chinese editorial source, produce a structurally equivalent English document, then apply only phase-two factual corrections to the Docker guides. Validate commands, links, headings, warnings, API sets, secrets, and the 300-line root README limit mechanically.

**Tech Stack:** Markdown, Mermaid, Node.js/npm scripts, Wrangler configuration, Cloudflare Pages/Workers/KV/R2/Durable Objects, Docker Compose.

---

### Task 1: Build the documentation fact inventory

**Files:**
- Read: `package.json`
- Read: `frontend/package.json`
- Read: `server/package.json`
- Read: `functions/package.json`
- Read: `workers/coordinator/package.json`
- Read: `wrangler.jsonc`
- Read: `workers/coordinator/wrangler.jsonc`
- Read: `.env.example`
- Read: `docker-compose.yml`
- Read: `shared/storage/capabilities.cjs`
- Read: `shared/storage/contracts.cjs`
- Read: `shared/storage/r2-lifecycle.cjs`
- Read: `shared/security/guest-policy.cjs`
- Read: `functions/utils/guest.js`
- Read: `functions/services/guest-telegram-storage.js`
- Read: `functions/services/guest-quota.js`
- Read: `server/lib/config/**`
- Read: `frontend/src/router/index.js`
- Read: root `*.html` and `app/*/index.html` public interface files
- Read: `test/cloudflare-auth-failure.test.js`
- Read: `test/guest-upload-handler.test.js`
- Read: `test/guest-quota.test.js`
- Read: `test/runtime-storage-drive-contract.test.js`
- Read: `test/coordinator-multipart-runtime.test.js`
- Read: `test/r2-lifecycle-policy.test.js`
- Read: `docs/2026-07-13_security-phase-two-report.md`
- Read: `README.md`
- Read: `README-EN.md`
- Read: `README-DOCKER.md`
- Read: `README-DOCKER-EN.md`

- [ ] **Step 1: Record runnable commands**

List commands from every relevant manifest. Only manifests that actually define `scripts` contribute runnable commands; do not infer aliases that do not exist.

- [ ] **Step 2: Record Cloudflare replacement points**

Extract every occurrence of Pages/Worker names, KV IDs, R2 bucket names, Durable Object script names, WebAuthn values, and migration audience, including repeated top-level and `env.production` values. Build a placeholder map using `<PAGES_PROJECT>`, `<COORDINATOR_WORKER>`, `<KV_NAMESPACE_ID>`, `<R2_BUCKET>`, `<YOUR_DOMAIN>`, and `<MIGRATION_AUDIENCE>`. Do not copy repository values into README examples.

- [ ] **Step 3: Record current security and guest boundaries**

Confirm fail-closed coordinator authentication, private administrator uploads, dedicated guest Telegram credentials, fixed daily quota 10, retention minimum one day, 20 MiB ceiling, 5 MiB example default, image signature/MIME/extension agreement, and public guest visibility from code and tests. Record that metadata expiry does not prove deletion of Telegram's remote bytes.

Record version provenance separately: package manifests declare ranges, lockfiles identify exact resolutions, and the security report records versions used by a completed verification. Record cost wording as “no new paid third-party dependency in phase two,” never “free forever”; Cloudflare services may charge by usage.

- [ ] **Step 4: Record the authoritative Storage/Drive surface**

Use shared operation descriptors for endpoint names and the capability matrix for runtime/upload-mode claims. Keep Vue UI routes separate from API routes. Record the shipped feature list and screenshot assets needed by evaluators.

### Task 2: Rewrite the Chinese root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the overview and warnings**

Write the project identity, language switch, badges, one-sentence purpose, production safety warnings, shipped features, screenshots, supported interfaces, and runtime choice table.

- [ ] **Step 2: Add architecture and quick start**

Add one Mermaid flowchart showing browser, Pages Functions or Docker API, coordinator, metadata, and storage. Provide short Cloudflare and Docker start paths without repository-specific production values.

- [ ] **Step 3: Add safe Cloudflare deployment**

Document resource creation, the complete placeholder map, replacement of every top-level and production occurrence, secrets, coordinator-before-Pages ordering, and binding probe. Derive lifecycle values from `shared/storage/r2-lifecycle.cjs`; require list → `lifecycle add` for `multipart/` with one-day abort → list, preserve all existing rules, and forbid lifecycle `set` or replacement.

- [ ] **Step 4: Add runtime and security reference**

Document Docker, storage capabilities, encrypted configuration precedence, authentication, Passkey, private sharing, and every guest boundary from Task 1. State the Telegram remote-byte caveat, version provenance rule, usage-based Cloudflare cost caveat, variables/bindings, and the limited no-new-paid-third-party claim.

- [ ] **Step 5: Add API, verification, and operations reference**

Provide runnable examples for auth/status, upload, Storage, Drive, build/test/audit/E2E/visual commands, troubleshooting, repository layout, related documents, contribution, and license.

- [ ] **Step 6: Enforce the line limit**

Run: `wc -l README.md`

Expected: no more than 300 lines.

### Task 3: Write the equivalent English root README

**Files:**
- Modify: `README-EN.md`

- [ ] **Step 1: Mirror the canonical section map**

Use natural English while preserving the Chinese README's top-level section order, warnings, tables, commands, endpoints, and Mermaid topology.

- [ ] **Step 2: Preserve technical equivalence**

Keep every numeric boundary, placeholder, runtime distinction, deployment ordering rule, and error behavior identical to the Chinese source.

- [ ] **Step 3: Enforce the line limit**

Run: `wc -l README-EN.md`

Expected: no more than 300 lines.

### Task 4: Synchronize the Docker guides

**Files:**
- Modify: `README-DOCKER.md`
- Modify: `README-DOCKER-EN.md`

- [ ] **Step 1: Remove obsolete API comparison claims**

State that Storage, Drive, and Share APIs exist on both runtimes while their persistence and adapter implementations differ.

- [ ] **Step 2: Correct guest and authentication behavior**

Remove main-bot fallback, adjustable daily quota, zero-day retention, and any production authentication fallback claim. Require both guides to state fixed quota 10, minimum one-day retention, 20 MiB ceiling, 5 MiB example default, image signature/MIME/extension agreement, default public visibility, and the Telegram remote-byte caveat. Keep both languages equivalent.

- [ ] **Step 3: Check root links against the corrected guides**

Confirm both root READMEs link to the matching-language Docker guide and the linked statements agree.

### Task 5: Validate and commit the documentation

**Files:**
- Verify: `README.md`
- Verify: `README-EN.md`
- Verify: `README-DOCKER.md`
- Verify: `README-DOCKER-EN.md`

- [ ] **Step 0: Record the worktree baseline**

Run: `git status --short`

Expected: record all pre-existing changes verbatim and do not stage or modify them.

- [ ] **Step 1: Validate formatting and links**

Run a read-only `node -e` check over all four README files. Parse Markdown link targets that do not use a URI scheme or `#`, resolve them from the source file directory, and fail if a target is absent. Scan opening fences and fail when the language token is empty.

Expected: zero missing links and zero untyped fences.

- [ ] **Step 2: Validate bilingual parity**

Run a read-only `node -e` parity check with an explicit Chinese-to-English heading map. Assert mapped level-two headings are identical ordered sequences, fenced shell command inventories are exactly equal, and API endpoint, warning topic, and configuration topic sets match. Assert both files contain equivalent boundaries for quota 10, one-day retention, 20 MiB ceiling, 5 MiB default, coordinator-before-Pages ordering, fail-closed behavior, lifecycle read-add-read, and the Telegram remote-byte caveat. Parse both Mermaid blocks and compare normalized node and edge sets.

Expected: equivalent sets in Chinese and English.

- [ ] **Step 3: Search for stale or sensitive content**

Use a read-only Node command to extract current Pages/Worker names, every KV ID, bucket name, `script_name`, RP ID/origin, and migration audience from both Wrangler files. Fail if any extracted repository-specific value appears in the four README files. Separately use `rg` for incomplete Storage/Drive claims, guest fallback, adjustable daily quota, zero-day retention, TODO markers, 32-character hexadecimal IDs, `*.pages.dev` deployment URLs, and repository-specific domains. Allow only the documented angle-bracket placeholders.

Expected: no stale claims, secrets, or repository-specific deployment values in generic instructions.

- [ ] **Step 4: Validate documented commands**

Cross-check every `npm run` command against the applicable package manifest. Execute `npm run frontend:build` and `perl -e 'alarm 60; exec @ARGV' npm test -- --reporter dot`. Verify `test:storage-e2e`, `test:auth-e2e`, and `test:visual` exist without running browser E2E for this documentation-only change. If a Markdown lint binary is already installed, run it with `.markdownlint.json`; do not download a new dependency. Run `npx wrangler pages deploy --help`, `npx wrangler deploy --help`, `npx wrangler r2 bucket lifecycle list --help`, and `npx wrangler r2 bucket lifecycle add --help` only; do not deploy or mutate Cloudflare resources.

Expected: commands exist; build and the timeout-bounded test suite pass; Wrangler help exposes the documented syntax; no external resource changes occur.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check && git status --short`

Compare status with the Step 0 baseline. Expected: no whitespace errors and this task added changes only to the four README files.

- [ ] **Step 6: Commit**

```bash
git add README.md README-EN.md README-DOCKER.md README-DOCKER-EN.md
git diff --cached --name-only
git commit -m "docs: rewrite bilingual project guide"
```

Expected before commit: the cached file list contains exactly those four README paths and no runtime/configuration file.
