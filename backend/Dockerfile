# Recon Tool API. Build context: the repository root.
#   docker build -f backend/Dockerfile --target runtime .   the service (default target)
#   docker build -f backend/Dockerfile --target ops .       one-shot migrate and seed commands

# OpenSSL lets Prisma pick the right schema engine when dependencies are installed.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM base AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@recon/backend..."
RUN pnpm --filter @recon/backend db:generate
RUN pnpm --filter @recon/shared build
RUN pnpm --filter @recon/backend build

FROM build AS deploy
RUN pnpm --filter @recon/backend deploy --prod --legacy /out

# Keeps the Prisma CLI and tsx out of the image that serves traffic.
FROM build AS ops
WORKDIR /repo/backend
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deploy /out/package.json ./package.json
COPY --from=deploy /out/node_modules ./node_modules
COPY --from=build /repo/backend/dist ./dist
# Created here so that a named volume mounted on it inherits the owner.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--conditions=recon-dist", "dist/src/server.js"]
