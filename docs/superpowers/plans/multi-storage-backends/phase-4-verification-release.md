# Phase 4 — Verification, Documentation, and Release

## Task 17: Contract and Runtime Regression Gate

**Files:**
- Modify: `scripts/storage-regression.js`
- Modify: `scripts/docker-ci-smoke.js`
- Create: `test/storage-profile-regression-script.test.js`
- Modify: `.github/workflows/docker-smoke.yml`

- [ ] **Step 1: Write failing script-contract tests** requiring two same-type profiles,
per-type defaults, explicit selected upload, disabled historical read, guest isolation,
and profile-aware status checks.

- [ ] **Step 2: Verify RED** with the new test.

- [ ] **Step 3: Implement real smoke operations** against the running API. Do not add
mock success, swallowed errors, retries without logs, or disabled assertions.

- [ ] **Step 4: Verify GREEN** locally where Docker is available and in GitHub Actions.

- [ ] **Step 5: Commit**

```bash
git add scripts/storage-regression.js scripts/docker-ci-smoke.js test/storage-profile-regression-script.test.js .github/workflows/docker-smoke.yml
git commit -m "test: cover multi-profile storage smoke flows"
```

## Task 18: Visual and Structural Quality Gate

**Files:**
- Modify: `e2e/baseline.spec.js`
- Modify: `e2e/visual-baselines/manifest.json`
- Update only approved screenshots under: `e2e/visual-baselines/`
- Create: `test/code-metrics.test.js`
- Modify: `test/visual-baseline-manifest.test.js`

- [ ] **Step 1: Write failing metrics and visual assertions**

Metrics scan every changed production file for 300-line files and extract JS/Vue
functions for the 50-line review list. Visual assertions identify only the approved
new select/actions/status content.

- [ ] **Step 2: Verify RED** before accepting any new baselines.

- [ ] **Step 3: Refactor violations rather than excluding files**. Do not loosen
snapshot thresholds to hide unrelated layout changes.

- [ ] **Step 4: Render desktop/mobile baselines and inspect every changed image**

Run: `npm run build && npm run test:visual`  
Expected: only Storage Settings, upload, Drive/admin, and status controls differ.

- [ ] **Step 5: Commit**

```bash
git add e2e/visual-baselines e2e/baseline.spec.js test/code-metrics.test.js test/visual-baseline-manifest.test.js
git commit -m "test: lock multi-profile interface baselines"
```

## Task 19: Migration Rehearsal and Recovery Evidence

**Files:**
- Create: `test/fixtures/storage-migration/` fixture set
- Modify: `test/storage-profile-migration.test.js`
- Create: `docs/2026-07-14_multi-storage-migration-rehearsal.md`
- Modify: `README.md`
- Modify: `README-EN.md`
- Modify: `README-DOCKER.md`
- Modify: `README-DOCKER-EN.md`

- [ ] **Step 1: Add failing rehearsal cases** for v1 catalog, existing Docker rows,
legacy config only, disabled-only type, mixed ID/type-only files, active uploads,
activation failure, rollback pointer, and repeated execution.

- [ ] **Step 2: Verify RED**, then fix migration modules rather than fixtures.

- [ ] **Step 3: Run backup + dry-run + apply against disposable persisted state**
and record exact hashes, counts, generation IDs, defaults, references, and rollback.

- [ ] **Step 4: Update bilingual docs** with multi-instance configuration, R2 modes,
Guest Channel boundary, migration commands, rollback, and error meanings.

- [ ] **Step 5: Verify documentation commands and commit**

```bash
git add test/fixtures test/storage-profile-migration.test.js docs README*.md
git commit -m "docs: document multi-profile migration and operation"
```

## Task 20: Final Verification and Pull Request

**Files:** No production changes expected.

- [ ] **Step 1: Rebuild generated artifacts**

Run: `npm run build`; verify `git status` contains only expected generated updates.

- [ ] **Step 2: Run the complete 60-second unit suite**

```bash
perl -e 'alarm 60; exec @ARGV' npm test -- --reporter dot
```

Expected: all tests pass with no new unexpected warnings.

- [ ] **Step 3: Run E2E suites**

```bash
npm run test:auth-e2e
npm run test:storage-e2e
npm run test:visual
```

- [ ] **Step 4: Run static and repository checks**

```bash
git diff --check
git status --short
npm audit --omit=dev
```

Record audit findings as facts; do not silently replace dependencies.

- [ ] **Step 5: Run real Docker checks**

```bash
docker compose up -d --build api web
npm run docker:smoke:ci
docker compose down -v --remove-orphans
```

- [ ] **Step 6: Request independent code review** and fix every Critical/Important
finding with a reproducing test.

- [ ] **Step 7: Push the feature branch and create a PR** against
`Seraph-x/Seraph-Pictures:main`. Wait for CI Test, Docker Smoke, API image, and Web
image to pass; do not merge or deploy in this task without separate approval.

