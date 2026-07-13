# Bilingual README design

## Goal

Replace the outdated root documentation with two detailed, equivalent entry points for the deployed phase-two implementation:

- `README.md` for Chinese readers;
- `README-EN.md` for English readers.

Both documents must help a new operator understand the product, choose a runtime, deploy it safely, configure storage, verify the installation, and diagnose common failures without reading source code first.

## Chosen approach

Use two independent files with the same section order, commands, tables, warnings, and factual coverage. Chinese is the editorial source, while English uses natural technical English rather than sentence-by-sentence translation. Each document links to its counterpart at the top.

Docker-specific detail remains in `README-DOCKER.md` and `README-DOCKER-EN.md`. Security evidence and migration history remain in `docs/`; the root READMEs summarize those facts and link to the formal reports instead of duplicating them.

## Audience and reading paths

The documents serve four audiences:

1. Evaluators need the project purpose, screenshots, features, architecture, security posture, and cost profile.
2. Cloudflare operators need prerequisites, resource creation, bindings, secrets, coordinator deployment, Pages deployment, R2 lifecycle configuration, and verification.
3. Docker operators need a short deployment path, production requirements, persistence behavior, and a link to the full Docker guide.
4. Maintainers need the repository map, API surface, test commands, expected failure diagnostics, and contribution rules.

Progressive disclosure is mandatory: critical warnings and the shortest working deployment path appear first; reference tables, architecture, troubleshooting, and maintenance detail follow.

## Shared document structure

Both files use this order:

1. Project identity, language switch, badges, one-sentence description.
2. Security and deployment warnings.
3. What the project provides and which interface routes are available.
4. Architecture overview with one Mermaid flowchart.
5. Quick start decision table for Cloudflare Pages versus Docker.
6. Cloudflare deployment, including KV, R2, Durable Objects, Pages, secrets, lifecycle rule, and verification.
7. Docker deployment and production configuration, linking to the dedicated Docker guide.
8. Storage backend capability matrix and runtime configuration behavior.
9. Authentication, Passkey, private files, sharing, and guest upload isolation.
10. Environment variables and bindings grouped by responsibility.
11. Task-oriented API examples for authentication, upload, Storage, Drive, and health/status boundaries.
12. Test, build, audit, E2E, and visual verification commands.
13. Troubleshooting table with observable errors and root-cause actions.
14. Security, privacy, cost, repository layout, related documents, contribution, and license.

Headings use sentence case and no more than three levels. Every code block declares a language. Internal links are relative. Tables are used when an item has at least three comparable attributes.

## Source-of-truth rules

Documentation facts must be derived from the latest phase-two branch, not from the old README prose. Required sources include:

- `package.json` and runtime-specific package files for commands and versions;
- `wrangler.jsonc` and `workers/coordinator/wrangler.jsonc` for Cloudflare bindings;
- `.env.example`, Docker Compose, and server configuration loaders for Docker variables;
- shared Storage/Drive contracts and capability definitions for supported operations and limits;
- frontend route definitions and legacy HTML files for interface paths;
- tests and the phase-two report for verified security and recovery behavior.

No production account identifier, namespace identifier, bucket identifier, credential, deployment URL, or operator-specific domain is copied into generic setup commands. Examples use explicit placeholders such as `<PROJECT_NAME>` and `<YOUR_DOMAIN>`.

## Accuracy and compatibility

The outdated statement that Cloudflare `/app/storage` and `/app/drive` APIs are incomplete must be removed. The READMEs must describe both APIs as implemented while still distinguishing the stable legacy root UI from the Vue `/app/` interface.

The documentation must not promise that every storage backend has identical upload modes. It must distinguish direct, multipart, chunked, and streaming capabilities by runtime and state that Cloudflare R2 is the multipart backend.

Authentication documentation must describe the Durable Object coordinator and fail-closed behavior. Environment credentials must not be presented as a production fallback after coordinator initialization.

Guest upload documentation must describe separate Telegram credentials, quota isolation, visibility, retention semantics, and the configured size boundary without claiming that remote bytes are automatically deleted when only metadata expires.

## Size and maintenance constraints

Each README must remain at or below 300 lines. Detail is compressed through tables, concise examples, and links to focused documents. The two files must retain matching top-level section order and the same command inventory.

Future changes that alter commands, routes, configuration, or supported storage must update both files in the same commit.

## Validation

Validation consists of:

- checking both files are at most 300 lines;
- comparing their top-level heading sequence;
- checking all relative Markdown links resolve;
- checking every fenced code block has a language identifier;
- verifying documented npm scripts exist in `package.json`;
- searching for stale claims, placeholders marked TODO, secrets, account IDs, and production-only values;
- running Markdown lint when the repository configuration supports it;
- reviewing representative deployment commands against current Wrangler help and package scripts.

The README task changes documentation only. It must not modify frontend markup, runtime behavior, Cloudflare resources, or deployment state.
