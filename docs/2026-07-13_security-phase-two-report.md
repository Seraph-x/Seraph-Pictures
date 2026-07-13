# Security phase two storage and upload report

## Outcome

Phase 2B replaced Cloudflare's temporary whole-file chunk assembly with an R2 multipart coordinator, added explicit upload capability limits, and aligned Cloudflare Pages and Docker Storage/Drive contracts. Existing frontend markup, copy, routes, and styling were not changed.

Administrator uploads default to private Drive metadata. Public image-host uploads remain explicit, and guest uploads remain isolated from administrator storage credentials and quota state.

## Production evidence

| Evidence | Verified value |
|---|---|
| R2 bucket | `k-vault-files` |
| Existing lifecycle rule | All prefixes; abort incomplete multipart after 7 days |
| Added lifecycle rule | `multipart/`; abort incomplete multipart after 1 day |
| Coordinator Worker | `k-vault-coordinator` |
| Coordinator version | `2d4a3816-869a-4242-bd27-399d1ec92003` |
| Pages deployment | `https://0bdaaa2a.k-vault-2lv.pages.dev` |
| Production domain | `https://pictures.seraphzero.com` |
| Binding probe | `{"binding":"ok"}` on the deployment URL and production domain |

The lifecycle rule was added with Wrangler's `lifecycle add` operation. The pre-existing seven-day default rule remained enabled; no lifecycle configuration was replaced.

## Storage behavior

- Multipart object keys use the deterministic `multipart/<uploadId>` prefix.
- A part retry with identical bytes and digest is idempotent; reusing a part number with different bytes returns a conflict.
- R2 completion precedes KV publication and quota consumption. A public file response is not returned until both later operations commit.
- Publish and quota failures remain in explicit recoverable states and reuse their persisted operation identifiers.
- Known expired uploads are reconciled by Durable Object alarms. Unknown multipart create orphans are removed by the one-day R2 lifecycle rule.
- The multipart path does not create legacy per-chunk KV keys or assemble a whole object in Pages memory.
- Storage secrets remain encrypted at rest. Empty or masked secret fields preserve the current secret during updates.
- Unknown storage types fail with `STORAGE_BACKEND_UNSUPPORTED`; they no longer silently become Telegram.
- Drive paths reject traversal, Drive lists use bounded cursors, and visibility filtering occurs in the storage query rather than after pagination.

## Runtime parity

Cloudflare and Docker now share Storage/Drive operation descriptors, serializers, secret-field policy, path normalization, visibility values, cursor semantics, and stable error codes. Docker's oversized Storage and Manage route files were split into focused registration modules; Drive queries use SQL filtering and pagination.

The real-runtime browser gate launches local Pages, the coordinator Durable Objects, local KV/R2 persistence, and the Docker API. It verifies:

- multipart initialization, exact part forwarding, identical retry, conflicting retry, completion retry, and cancellation;
- Storage creation and blank-secret preservation on both runtimes;
- Drive folder creation, move, and deletion on both runtimes.

Failure recovery for ambiguous R2 completion, metadata publish retry, quota commit retry, and alarm cleanup is covered by the coordinator integration suite with injected failing dependencies. These failures remain visible; no mock success or silent fallback is used.

## Supply-chain result

The deployment review exposed newly published advisories after the initial build. The direct and transitive fixes are locked as follows:

| Component | Verified version |
|---|---|
| Wrangler | `4.110.0` |
| Hono | `4.12.30` |
| form-data | `4.0.6` |

Both the root project and `server/` report zero npm audit vulnerabilities after installation from their lock files. The Hono upgrade removes the credentialed-CORS advisory affecting versions before `4.12.25`; the Wrangler upgrade carries fixed Undici, ws, Miniflare, and esbuild versions.

## Verification evidence

- 317 Mocha tests passed under the required 60-second backend timeout.
- Two real Pages/Coordinator/Docker Playwright tests passed.
- Twenty immutable visual checks passed: ten routes each at desktop and mobile dimensions.
- Frontend production build passed with the same generated application bundle name.
- Coordinator Wrangler `4.110.0` dry-run compiled with AuthCoordinator, UploadCoordinator, KV, and R2 bindings.
- Root and server npm audits both returned zero vulnerabilities.
- `git diff --check` passed.

Expected error logs in the unit run come from explicit outage and fail-closed test cases; those cases passed their assertions.

## Cost profile

No paid third-party service was introduced. The implementation uses the existing Cloudflare Pages, Workers/Durable Objects, KV, and R2 resources, plus free local/CI test tooling. R2 multipart cleanup reduces abandoned-upload storage duration from the platform's default seven days to one day for the coordinator prefix.
