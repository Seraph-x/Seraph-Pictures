# Multi-Storage Backend Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver same-type multi-instance storage management and exact-instance selection across Cloudflare, Docker, legacy UI, Vue UI, uploads, Drive, status, and migration without changing the established visual design.

**Architecture:** A shared profile policy defines per-type defaults and adapter modes. Cloudflare uses a generation-based encrypted KV catalog plus Coordinator reference leases; Docker uses transactional SQLite repositories. Every administrator write resolves an exact `storageId`, while historical reads retain their original profile association.

**Tech Stack:** Node.js 22, CommonJS/ES modules, Cloudflare Pages Functions, Durable Objects, KV/R2, Hono, SQLite, Vue 3, legacy Vue 2, Mocha, Playwright, Docker Buildx.

---

## Source Specification

- `docs/superpowers/specs/2026-07-14-multi-storage-backends-design.md`

The specification is authoritative. Do not add automatic failover, guest profile
selection, new providers, or paid infrastructure.

## Plan Layout

Execute these files in order:

1. `multi-storage-backends/phase-1-contracts-persistence.md`
2. `multi-storage-backends/phase-2-runtime-references.md`
3. `multi-storage-backends/phase-3-interfaces.md`
4. `multi-storage-backends/phase-4-verification-release.md`

Each task follows RED → GREEN → REFACTOR and ends with a focused commit. Never
combine tasks merely to reduce commit count.

## File Boundaries

### Shared and persistence

- `shared/storage/profile-policy.cjs`: invariants, selection input, R2 mode rules.
- `shared/storage/contracts.cjs`: HTTP envelopes and public masking only.
- `server/lib/repos/storage-config/`: focused SQLite query/mutation/mapping modules.
- `functions/services/storage-profiles/`: focused KV catalog/codec/repository modules.
- `scripts/security/storage-profile-migration/`: pure migration planning and checks.

### Coordinator and runtime

- `workers/coordinator/src/storage-references/`: lease state machine and repository.
- `functions/services/storage-runtime/`: profile resolution, adapters, reference client.
- Existing upload/file routes stay thin and delegate to those services.

### Interfaces

- `frontend/src/components/storage/`: reusable profile picker and settings components.
- `frontend/src/composables/storage/`: profile loading, memory, editor behavior.
- `frontend/src/composables/upload/` and `drive/`: split oversized views by behavior.
- `legacy/storage/`: framework-neutral profile API, selection, and settings modules.
- `legacy/pages/`: extracted legacy page styles/components/controllers.

No production source file may exceed 300 lines; no function may exceed 50 lines.
Split by responsibility before adding behavior to an oversized file.

## Global Behavioral Assertions

- One enabled default per type; default cannot be disabled/deleted.
- Disabled profiles reject writes but retain historical operations.
- First-party writes send both `storageMode` and `storageId`.
- Missing/mismatched/disabled profiles fail explicitly without fallback.
- Guest upload never enumerates or accepts administrator profile IDs.
- File queue entries snapshot the selected profile.
- Cloudflare failures may over-protect references, never under-protect them.
- Existing page geometry and styling remain visually equivalent.

## Baseline and Completion Commands

Run from `/Users/zhuzhishang/Seraph-Pictures/.worktrees/multi-storage-backends`.

```bash
npm run build
perl -e 'alarm 60; exec @ARGV' npm test -- --reporter dot
npm run test:auth-e2e
npm run test:storage-e2e
npm run test:visual
npm run docker:smoke:ci
```

Expected final state: all commands pass, four PR checks pass, migration rehearsal
produces verified backup/count artifacts, and `git diff --check` is clean.

