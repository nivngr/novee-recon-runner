# The REST API. Built in two stages: compile with all tools, then run with production dependencies only.
# Debian, not Alpine: Temporal's native library ships for glibc only (A4).

FROM node:22.23.5-bookworm-slim AS build
WORKDIR /app
# The lockfile needs every workspace's package.json; install covers this app and the build tools.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci --workspace=@novee/api --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @novee/contracts -w @novee/db -w @novee/api

FROM node:22.23.5-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci --omit=dev --workspace=@novee/api --no-audit --no-fund
# Shared packages and this app, compiled.
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/main.js"]
