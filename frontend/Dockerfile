# Recon Tool web: the SPA served by Nginx, which also proxies /api. Build context: the repository root.
#   docker build -f frontend/Dockerfile -t recon-web .

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@recon/frontend..."
# VITE_API_URL stays unset: the browser talks to its own origin.
RUN pnpm --filter @recon/frontend build

# Runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine AS runtime
COPY frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=4 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
RUN exit 1
