# The deploy gate, in a container: what `task check` runs (Prisma client, typecheck, lint, unit + workflow tests),
# so `task up` needs no Node on the host. Built and thrown away by `task gate`; a failing step fails `task up`.
# Same base as the app images (Debian: Temporal's test server needs glibc, A2).

FROM node:22.23.5-bookworm-slim
WORKDIR /app
# CA certificates: the workflow tests download Temporal's test server over HTTPS (the slim image has none).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run generate && npm run typecheck && npm run lint && npm run test
