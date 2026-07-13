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
- Read: `wrangler.jsonc`
- Read: `workers/coordinator/wrangler.jsonc`
- Read: `.env.example`
- Read: `docker-compose.yml`
- Read: `shared/storage/capabilities.cjs`
- Read: `shared/storage/contracts.cjs`
- Read: `frontend/src/router/index.js`
- Read: `docs/2026-07-13_security-phase-two-report.md`
- Read: `README.md`
- Read: `README-EN.md`
- Read: `README-DOCKER.md`
- Read: `README-DOCKER-EN.md`

- [ ] **Step 1: Record runnable commands**

List every documented npm command directly from the three package manifests. Do not infer aliases that do not exist.

- [ ] **Step 2: Record Cloudflare replacement points**

Extract the Pages/Worker names, KV IDs, R2 bucket names, Durable Object script name, WebAuthn values, and migration audience as fields that a fork must replace. Do not copy their repository values into README examples.

- [ ] **Step 3: Record current security and guest boundaries**

Confirm fail-closed coordinator authentication, private administrator uploads, dedicated guest Telegram credentials, fixed daily quota 10, retention minimum one day, 20 MiB ceiling, 5 MiB example default, image signature/MIME/extension agreement, and public guest visibility from code and tests.

- [ ] **Step 4: Record the authoritative Storage/Drive surface**

Use shared operation descriptors for endpoint names and the capability matrix for runtime/upload-mode claims. Keep Vue UI routes separate from API routes.

### Task 2: Rewrite the Chinese root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the overview and warnings**

Write the project identity, language switch, badges, one-sentence purpose, production safety warnings, supported interfaces, and runtime choice table.

- [ ] **Step 2: Add architecture and quick start**

Add one Mermaid flowchart showing browser, Pages Functions or Docker API, coordinator, metadata, and storage. Provide short Cloudflare and Docker start paths without repository-specific production values.

- [ ] **Step 3: Add safe Cloudflare deployment**

Document resource creation, all required Wrangler replacements, secrets, coordinator-before-Pages ordering, binding probe, and the R2 lifecycle list/add/list sequence that preserves existing rules.

- [ ] **Step 4: Add runtime and security reference**

Document Docker, storage capabilities, encrypted configuration precedence, authentication, Passkey, private sharing, guest isolation, variables/bindings, and cost limits.

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

Remove main-bot fallback, adjustable daily quota, zero-day retention, and any production authentication fallback claim. Keep both languages equivalent.

- [ ] **Step 3: Check root links against the corrected guides**

Confirm both root READMEs link to the matching-language Docker guide and the linked statements agree.

### Task 5: Validate and commit the documentation

**Files:**
- Verify: `README.md`
- Verify: `README-EN.md`
- Verify: `README-DOCKER.md`
- Verify: `README-DOCKER-EN.md`

- [ ] **Step 1: Validate formatting and links**

Run a Node script from the shell that checks relative Markdown links exist and every fenced block has a language identifier.

Expected: zero missing links and zero untyped fences.

- [ ] **Step 2: Validate bilingual parity**

Compare the canonical top-level section map, shell-command inventory, warning-topic list, configuration-table topics, and API endpoint set.

Expected: equivalent sets in Chinese and English.

- [ ] **Step 3: Search for stale or sensitive content**

Run targeted `rg` checks for incomplete Storage/Drive claims, guest fallback, adjustable daily quota, zero-day retention, TODO markers, real account/KV IDs, real deployment URLs, and production-only domains.

Expected: no stale claims, secrets, or repository-specific deployment values in generic instructions.

- [ ] **Step 4: Validate documented commands**

Cross-check every `npm run` command against `package.json`, then run `npm run frontend:build` and the documentation-relevant test commands already documented as verified evidence.

Expected: commands exist; build succeeds.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check && git diff -- README.md README-EN.md README-DOCKER.md README-DOCKER-EN.md`

Expected: no whitespace errors and no behavior/source changes.

- [ ] **Step 6: Commit**

```bash
git add README.md README-EN.md README-DOCKER.md README-DOCKER-EN.md
git commit -m "docs: rewrite bilingual project guide"
```
