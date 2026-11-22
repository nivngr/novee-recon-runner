# The migrate Job: applies Prisma migrations once per deploy (D14).
FROM node:22.23.5-bookworm-slim
# Prisma's migration engine needs OpenSSL, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN npm ci --omit=dev --workspace=@novee/db --no-audit --no-fund

COPY packages/db packages/db

USER node
WORKDIR /app/packages/db
CMD ["npx", "prisma", "migrate", "deploy"]
