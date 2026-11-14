# Remove the optional Vue 3 application

The user approved removing the optional `/app/*` UI after backing up the current version on GitHub main (`02f9747`). Legacy remains the sole supported interface. Its Vue 2 and Element UI runtime dependencies remain necessary.

## Boundaries

- Remove `frontend/src`, its Vite entry/configuration/package files, obsolete landing pages, and root `app` output.
- Keep `frontend/Dockerfile`, `frontend/nginx.conf`, and the existing `frontend/dist` deployment location. Replace Vite with a dependency-free Node static packager in `scripts/build-static.mjs`.
- Package the existing root pages, styles, images, fonts and `legacy` modules, including existing `/legacy/*.html` aliases. Copy only declared public assets; never publish source code, tests, credentials, or workspace files.
- Remove SPA rewrites. Unknown paths, including retired `/app` paths, return HTTP 404 in Cloudflare and Docker. A top-level static `404.html` prevents Cloudflare's implicit SPA fallback. No automatic redirect to a different interface.
- Keep authentication, uploads, storage profiles, Drive and Share API contracts unchanged: Legacy and external clients consume them too.
- Remove only tests and screenshot entries specific to the deleted UI; retain mixed-file Legacy and API coverage and all surviving screenshots unchanged.
- Preserve historical migration branches and design scratch files. Back up the pre-existing uncommitted root `app` artifacts before removing that explicitly retired directory.

## Acceptance

`npm run build` succeeds without a frontend install or Vite, cleans stale SPA output, and produces all Legacy assets. API/function compilation succeeds. Unit tests and Legacy browser checks pass. `/app`, its deep links, and retired JS assets return 404. Docker nginx keeps API proxying and clean Legacy URLs. Documentation reflects the supported interface and commands.

No production deployment or migration is part of this task.
