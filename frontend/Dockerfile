# syntax=docker/dockerfile:1.7

# Stage 1: build the canonical frontend bundle (legacy root pages + Vue /app/),
# the exact same artifact deployed to Cloudflare Pages (frontend/dist). Build
# it on the native runner because the output is architecture-independent; this
# avoids executing npm tooling through QEMU during multi-platform image builds.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
COPY . .
# `npm run build` installs frontend deps (prefrontend:build hook), runs vite,
# then copy-legacy.mjs which lays out dist/ with legacy pages at the root and
# the Vue app under dist/app/.
RUN npm run build

# Stage 2: serve the built bundle with nginx.
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
