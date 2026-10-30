# Proposal — deploy-compose

Issue: #97 · despliegue con URL pública (Entrega 3). Cubre solo lo que vive en el repositorio; el túnel de Cloudflare y la preparación del servidor se hacen a mano siguiendo `docs/deploy.md`, que este change escribe.

## Why

La aplicación solo corre en local (`pnpm dev` y SQL Server en Docker Compose), y la revisión del TA y el vídeo (#96) necesitan una URL pública estable con datos sintéticos. Hoy además no se puede empaquetar: **`pnpm start` no arranca** en un build limpio (ver "Hallazgos"), y la CI nunca lo ha detectado porque no construye ni ejecuta el backend compilado.

## Hallazgos que ajustan el encargo

Comprobados leyendo el código y con un build de prueba en una copia temporal.

1. **El backend compilado no arranca.** `node dist/src/server.js` falla con `ERR_MODULE_NOT_FOUND` en `packages/shared/src/auth.js`: `@recon/shared` se publica como TypeScript sin compilar (`main: src/index.ts`) y el backend lo importa en ejecución. Hace falta un cambio pequeño en `packages/shared/package.json` y en el script `start` del backend. Con el paquete compilado y una condición de export, el backend sí arranca (probado: responde en el health, `503` sin base).
2. **El health está en `GET /api/v1/health`**, no en `/health` (que da `404`). El `HEALTHCHECK` usa la ruta real.
3. **La API no lee `DATABASE_URL`**: se conecta con `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `RECON_APP_PASSWORD` (`backend/src/infrastructure/db.ts`), igual que el seed. Solo `prisma.config.ts` acepta `DATABASE_URL`. Como este change no toca los módulos del backend, **la conexión va por las `DB_*`**: apuntar a un SQL Server externo sigue siendo cuestión de cambiar variables, sin código. Es la desviación principal respecto al encargo; pasar a `DATABASE_URL` sería un change aparte.
4. **Los archivos subidos viven en disco** (`UPLOAD_DIR`). Sin volumen propio se perderían al actualizar, y eso incumpliría el criterio 4 del issue.
5. **`.gitignore` ignora `infra/.env.deploy.example`**: `.env.*` lo atrapa y solo `.env.example` tiene excepción. Hay que añadirla.
6. **El seed necesita algo más que lectura y escritura**: usa `DBCC CHECKIDENT`, que pide `db_ddladmin` o ser propietario. Por eso corre con la identidad de migración y no con `recon_app`.

## What Changes

- `backend/Dockerfile` multi-stage con dos destinos: `runtime` (Node 22 slim, solo `dist/` y dependencias de producción, usuario no root, `HEALTHCHECK`) y `ops` (con el CLI de Prisma, `tsx` y el seed, para las órdenes de un solo uso).
- `frontend/Dockerfile` multi-stage y configuración de Nginx: SPA con fallback a `index.html`, proxy de `/api` a `api`, cabeceras de seguridad.
- `.dockerignore` en la raíz, sin ningún `.env`.
- `packages/shared`: script `build` y condición de export para el JavaScript compilado. El desarrollo (`tsx`, Vite, Vitest, `tsc`) sigue leyendo el TypeScript, y `pnpm start` del backend vuelve a funcionar.
- `infra/docker-compose.deploy.yml`: `web`, `api`, `mssql` y `cloudflared`, con una red interna sin salida y una red de salida solo para `cloudflared`. Ningún puerto publicado. Volúmenes para la base y para los archivos subidos. Servicios `migrate` y `seed` bajo un perfil que `up` no arranca.
- Dos overrides: `docker-compose.deploy.external-db.yml` (SQL Server externo, sin el servicio `mssql`) y `docker-compose.deploy.debug.yml` (prueba local en `127.0.0.1`, sin túnel).
- Identidad de migración `recon_migrator`, como pide el issue y README §2.4. En este despliegue `recon_app` pierde `db_ddladmin`. El entorno local no cambia.
- `infra/.env.deploy.example` versionado y excepción en `.gitignore`.
- `scripts/deploy.sh` con `build`, `up`, `migrate`, `seed`, `logs`, `ps` y `down`. Se elige el script frente a `pnpm deploy:*` para que el servidor no necesite Node ni pnpm; solo Docker y Git. `seed` pide confirmación porque borra los datos.
- CI: job que construye las imágenes sin publicarlas y valida el compose.
- La Entrega 3 se trabaja sobre `feature/entrega-3-MVP`: los PR apuntan ahí, la rama se añade a `on.push.branches` de la CI y la regla 3 de `CLAUDE.md` pasa a nombrarla.
- `docs/deploy.md` para quien no ha hecho esto antes. README §1.4 enlaza a ese documento, y §2.4 y §0.4 pasan a describir el estado real, sin nombre ni ubicación del servidor (hoy el diagrama de §2.4 incluye un identificador de máquina, `D01`, que se elimina).

**Decisión pendiente del issue:** SQL Server va en el mismo compose por defecto, con el override para uno externo. README §2.4 hablaba de "máquina dedicada" y se corrige en este change.

**Fuera de alcance:** despliegue automático desde GitHub Actions, Sentry y Slack (#39), backups programados, y crear el túnel o preparar el servidor (manual, documentado). No se toca el esquema de base de datos ni los módulos del backend.

## Capabilities

### New Capabilities

- `deployment`: empaquetado de la aplicación en imágenes, entorno de despliegue con entrada única por túnel, pasos explícitos de migración y seed, configuración sin secretos en el repositorio y conservación de los datos al actualizar.

### Modified Capabilities

Ninguna: no cambia el comportamiento del API ni de la interfaz.

## Impact

- **Archivos nuevos:** `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `.dockerignore`, `infra/docker-compose.deploy*.yml`, `infra/mssql/init.deploy.sql`, `infra/.env.deploy.example`, `scripts/deploy.sh`, `docs/deploy.md`.
- **Archivos modificados:** `packages/shared/package.json`, `backend/package.json` (`start`), `infra/mssql/entrypoint.sh` (ejecuta `init.deploy.sql` solo si está montado), `.gitignore`, `.github/workflows/ci.yml`, `readme.md`, `CLAUDE.md` (comandos), `prompts.md`.
- **Dependencias nuevas de ejecución:** imágenes `node:22-slim`, `nginxinc/nginx-unprivileged` y `cloudflare/cloudflared`. Ningún paquete npm nuevo.
- **Sin cambios:** API, contrato OpenAPI y colección Bruno.
