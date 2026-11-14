# syntax=docker/dockerfile:1.7

# Stage 1: package the canonical Legacy static site,
# the exact same artifact deployed to Cloudflare Pages (frontend/dist). Build
# it on the native runner because the output is architecture-independent; this
# avoids executing npm tooling through QEMU during multi-platform image builds.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
COPY package.json *.html *.css *.js *.ico *.svg *.png ./
COPY scripts/build-static.mjs scripts/build-static.mjs
COPY legacy legacy
COPY assets assets
# The static packager uses Node built-ins and requires no npm install.
RUN npm run build

# Stage 2: serve the built bundle with nginx.
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
