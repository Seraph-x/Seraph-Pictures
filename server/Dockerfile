# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server/ ./
COPY shared/ /shared/

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "index.js"]
