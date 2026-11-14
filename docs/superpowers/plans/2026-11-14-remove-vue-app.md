# Vue App Removal Implementation Plan

**Goal:** Retire the optional Vue 3 UI while preserving the Legacy site and shared APIs.

**Architecture:** Replace Vite packaging with an explicit static asset build at the existing frontend/dist location. Remove SPA routes and let retired URLs return 404.

**Tech Stack:** Node.js, static HTML/CSS/JS, Cloudflare Pages Functions, Docker nginx, Mocha and Playwright.

## Steps

- [x] Add failing static build/retirement tests covering clean outputs, legacy assets, no Vue dependencies and retired routes.
- [x] Implement scripts/build-static.mjs, 404 handling, package scripts and Docker configuration; delete Vue-only source and root app artifacts after backup.
- [x] Remove obsolete Vue-only tests and screenshots; preserve Legacy and backend contracts and add retired-route browser checks.
- [x] Update current README and deployment instructions; preserve historical documents.
- [x] Run build, unit tests, Pages Functions compilation, Legacy desktop/mobile checks and available Docker verification. Review the final diff and independent code review before reporting completion.

Test cleanup and documentation updates can proceed independently of packaging with disjoint file ownership. All implementation is integrated in the current workspace; no historical worktrees are altered.

## Verification results

- `npm run build` and `npm test`: successful, 521 tests passing. A concurrent Docker build caused four 2-second test timeouts; the unchanged suite passed when rerun without the build load.
- Real local Pages and Docker API runtime suite: all 5 tests pass, covering retired route 404s, Legacy pages, multipart, profile filtering/migration, Legacy upload/admin interactions and matching API contracts.
- Pages Functions compile succeeds with `wrangler pages functions build functions`. CI previously passed the static output directory as the Functions source; this command is corrected.
- `GET /upload` has an explicit `upload.html` homepage alias because disabling implicit SPA routing otherwise removes that existing URL. Upload POST handling is unchanged.
- Frontend Docker image builds successfully; nginx configuration validates and 15 actual container routes return the expected 200/404 responses. The temporary container was removed.
- Legacy storage settings browser interactions pass on desktop and mobile. Existing visual baseline comparisons do not all pass; surviving golden screenshots and manifest entries were not changed. Same-browser comparison with HEAD's old packaging reproduces mobile baseline mismatches. The old package omitted the font files referenced by `theme.css`; the new package includes them, removes those font 404s, and consequently changes some text/control dimensions. This is a recorded visual difference, not a claim of pixel-identical output.
- Independent review and `git diff --check` pass after the Functions command correction.

The initial implementation was verified locally. Commit, push and Pages deployment were subsequently authorized by the user, with a pre-push privacy audit. Production domain and resource identifiers are intentionally retained; new commits use the GitHub noreply identity. No data migration is part of this release.

The release authentication check exposed missing font files in the temporary unbound test server. Its asset list now includes `assets`; real coordinator login, credential rotation, logout and outage checks pass without ignoring resource failures.
