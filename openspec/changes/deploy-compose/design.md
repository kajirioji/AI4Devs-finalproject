# Design — deploy-compose

## Context

Motivación y hallazgos en `proposal.md`; requisitos en `specs/deployment/spec.md`.

Puntos de partida relevantes:

- Monorepo pnpm con `@recon/shared` en TypeScript, consumido en ejecución por el backend.
- `prisma.config.ts` da prioridad a `DATABASE_URL` y, si no existe, compone la conexión con las `DB_*`. La API y el seed solo leen las `DB_*`.
- `infra/mssql/entrypoint.sh` ejecuta `init.sql` en cada arranque (es idempotente). `recon_app` tiene `db_ddladmin` porque en local también migra.
- `.claude/hooks/guard-db.sh` impide al agente migrar y sembrar: esas pruebas las ejecuta la persona.
- La imagen de SQL Server 2022 solo existe para x86-64, así que el servidor debe tener esa arquitectura.

## Goals / Non-Goals

**Goals:** imágenes reproducibles desde el lockfile, secretos por servicio, y una operación diaria de pocas órdenes que no exija Node en el servidor.

**Non-Goals:** orquestación más allá de Compose, alta disponibilidad, registro de imágenes (se construye en el servidor), y cambios en los módulos del backend.

## Decisions

### D1. `@recon/shared` compilado mediante una condición de export

`packages/shared/package.json` gana un script `build` (con `tsconfig.build.json`, a `dist/`), `files: ["dist", "src"]` y:

```json
"exports": { ".": { "recon-dist": "./dist/index.js", "default": "./src/index.ts" } }
```

`start` y el `CMD` usan `node --conditions=recon-dist dist/src/server.js`. Nada más activa esa condición, así que `tsx`, Vite, Vitest y `tsc` siguen en `src/`. Probado en una copia temporal: el backend arranca y responde en el health.

- *Alternativa: empaquetar con esbuild.* Añade una dependencia y una segunda forma de construir el backend, con riesgo en los módulos nativos (`argon2`).
- *Alternativa: reescribir `main` dentro del Dockerfile.* Es invisible para el repositorio y deja `pnpm start` roto.
- *Alternativa: hacer que `main` apunte siempre a `dist`.* Obliga a compilar antes de cualquier test o typecheck.

### D2. Node 22 **slim**, con dos destinos en el Dockerfile

Se elige `node:22-slim` frente a `alpine`. `argon2` usa binarios nativos y el motor de esquema de Prisma necesita OpenSSL: glibc es el camino con menos sorpresas, y el tamaño aquí importa poco. El adaptador `@prisma/adapter-mssql` usa un driver JavaScript. La verificación es una prueba real contra SQL Server (tarea 3.5), no una suposición.

Etapas: `base` (corepack y `pnpm fetch`, para aprovechar la caché) → `build` (`pnpm install --offline --frozen-lockfile --filter @recon/backend...`, `prisma generate`, build de shared y del backend) → `pnpm deploy --prod --legacy` a una carpeta limpia.

- `runtime`: esa carpeta más `dist/`, usuario `node`, `HEALTHCHECK` con `fetch` de Node (la imagen no trae `curl`) sobre `/api/v1/health`. La carpeta `/data/uploads` se crea con dueño `node` en la imagen para que el volumen con nombre herede el permiso.
- `ops`: la etapa `build` con dependencias de desarrollo, OpenSSL y usuario no root. Ejecuta `prisma migrate deploy` y `tsx prisma/seed.ts`. Así el CLI de Prisma y `tsx` no llegan a la imagen que da servicio.

Riesgo conocido: `pnpm deploy` respeta el `.gitignore`, por eso `dist` de shared se declara en `files` y el `dist` del backend se copia aparte. Se comprueba al construir.

### D3. Web sobre `nginx-unprivileged`

No root y escucha en `8080`. `location /api/` usa `resolver 127.0.0.11` con una variable en `proxy_pass`, para que recrear `api` no deje a Nginx con una IP antigua.

- `client_max_body_size 210m` (10 archivos de 20 MiB y margen) y `proxy_request_buffering off`.
- `proxy_read_timeout 300s`.
- `assets/` con caché inmutable e `index.html` sin caché.
- Las cabeceras se definen en un fragmento que se incluye en cada `location`, porque un `add_header` en un bloque anula los heredados.
- La CSP permite `style-src 'unsafe-inline'`, porque los componentes de Radix usan estilos en línea. Se ajusta probando en el navegador.
- HSTS lo gestiona Cloudflare, no Nginx: `docs/deploy.md` lo incluye, junto con Always Use HTTPS, como paso obligatorio.

`/docs` (Swagger) no se reenvía: solo se expone `/api`.

### D4. Redes: una interna sin salida y una de salida

`recon-internal` (`internal: true`) une `web`, `api` y `mssql`. `recon-egress` solo la tiene `cloudflared`, que además está en la interna para llegar a `web:8080`.

Dos consecuencias que recogen los overrides, porque una red `internal` ni sale a internet ni publica puertos:

- Base externa: `api`, `migrate` y `seed` también necesitan `recon-egress`.
- Depuración: `web` necesita `recon-egress` para publicar `127.0.0.1:8080`.

### D5. Conexión por `DB_*`, sin `DATABASE_URL`

Es la desviación explícita respecto al encargo (ver proposal, hallazgo 3). Se usan las mismas variables en los tres consumidores. `migrate` y `seed` reciben `DB_USER=recon_migrator` y `RECON_APP_PASSWORD=${RECON_MIGRATOR_PASSWORD}`, con lo que no hace falta componer una URL ni escapar contraseñas. Un `DATABASE_URL` definido tendría prioridad en Prisma, así que la plantilla no lo incluye.

### D6. SQL Server externo y depuración mediante overrides

El compose base funciona tal cual, con `mssql` incluido, y el archivo de override concentra todo lo específico:

- `docker-compose.deploy.external-db.yml`: asigna a `mssql` un perfil que nunca se activa, usa `depends_on: !reset` en `api`, `migrate` y `seed`, y añade `recon-egress`. Requiere Compose 2.24 o superior, y `docs/deploy.md` lo indica.
- `docker-compose.deploy.debug.yml`: publica `web` en `127.0.0.1:8080` y desactiva `cloudflared` con un perfil.

*Alternativa: perfiles en el compose base.* Exigiría `--profile` o `COMPOSE_PROFILES` en la orden normal, y es más fácil de olvidar.

### D7. Identidad de migración `recon_migrator`

`infra/mssql/init.deploy.sql`, idempotente y montado solo en el compose de despliegue, crea el login con `db_ddladmin`, `db_datareader` y `db_datawriter`, y saca a `recon_app` de `db_ddladmin`. `entrypoint.sh` lo ejecuta si el archivo existe, de modo que local no cambia. Con base externa, ese mismo script se entrega a quien administre el servidor.

`init.sql` solo da `db_ddladmin` a `recon_app` mientras no exista `recon_migrator`, para que un reinicio no le devuelva el permiso. Con datos, SQL Server responde a `SELECT 1` antes de poder abrir las bases (`Msg 904`), así que `entrypoint.sh` reintenta los scripts durante unos dos minutos y, si no terminan, sale con error en lugar de seguir sin inicializar.

El seed usa también esta identidad, por `DBCC CHECKIDENT` (proposal, hallazgo 6). Si `db_ddladmin` no bastara para alguna migración, se detecta en la tarea 3.5 y se amplía allí, documentando el motivo.

El healthcheck de `mssql` en el despliegue comprueba que exista `recon_migrator`, el último objeto creado. Un `SELECT 1` pasaría antes de que terminara `init.sql`, y la API arrancaría sin base ni usuario.

### D8. Secretos por interpolación con `--env-file`

Los servicios declaran sus variables una a una en `environment` (`${VAR:?}` en las obligatorias), no con un `env_file` compartido: cada contenedor ve solo lo suyo. Por eso la orden lleva `--env-file infra/.env.deploy`, y **la orden literal del criterio 1 del issue necesita ese parámetro**. `scripts/deploy.sh` lo añade siempre.

`TUNNEL_TOKEN` usa `${TUNNEL_TOKEN:-}` para no bloquear el modo de depuración, y `deploy.sh up` comprueba que no esté vacío salvo en ese modo. `SEED_PASSWORD` es obligatoria: el seed tiene un valor por defecto público, inaceptable con URL pública.

Las contraseñas no deben llevar `$`, porque Compose lo interpreta. `docs/deploy.md` da una forma de generarlas que lo evita.

### D9. `scripts/deploy.sh`

Es un envoltorio fino de `docker compose`, con las órdenes `build | up | migrate | seed | logs | ps | down`. Selecciona los archivos según `DEPLOY_DB=external` (en `.env.deploy`) y `DEPLOY_DEBUG=1` (en el entorno).

- `migrate` y `seed` usan `run --rm` sobre servicios con perfil `ops`, para que `up` nunca los arranque.
- `seed` exige escribir `seed` para confirmar.
- `down` no acepta `-v`: borrar volúmenes queda fuera del script y se explica aparte en la documentación.

### D10. Versiones fijadas y CI

Las imágenes `cloudflared` y `nginx-unprivileged` se fijan a una versión concreta al implementar. `mssql` usa la misma etiqueta que `infra/docker-compose.yml`.

Job `images` en `ci.yml`: construye `backend` (`runtime` y `ops`) y `frontend` con `docker/build-push-action` (`push: false`, caché de GitHub Actions), y ejecuta `docker compose config` con la plantilla para los tres archivos.

## Risks / Trade-offs

- **Límites de Cloudflare:** el plan gratuito corta las peticiones de más de 100 MB y las respuestas que tardan más de unos 100 s. Una subida del máximo teórico (200 MiB) fallaría aunque Nginx la admita. → Se documenta; los archivos de `data/samples/` quedan muy por debajo. Se comprueba `batch-clean` por la URL pública.
- **El login no tiene límite de intentos** y queda expuesto en una URL pública (no hay `rate-limit` entre las dependencias). → Datos solo sintéticos y `SEED_PASSWORD` obligatoria y fuerte. Además, `docs/deploy.md` incluye como paso obligatorio una regla de rate limiting en Cloudflare sobre `/api/v1/auth/login`. Añadir el límite a la API sería otro change.
- **Sin backups** (fuera de alcance). → El volumen es la única copia: la guía avisa de que `down -v` y `seed` borran datos.
- **Primer arranque sin migrar:** la API queda `healthy` pero el login falla hasta migrar y sembrar, porque el health solo hace `SELECT 1`. → El orden se documenta, y la sección de fallos cubre este síntoma.
- **`recon_app` sin DDL** solo se prueba en este despliegue, porque la integración de la CI usa `sa`. → El recorrido de la tarea 7.2 lo cubre.

## Migration Plan

Es un entorno nuevo, sin migración de datos. Para volver atrás, en el servidor: `git checkout` de la versión anterior, `deploy.sh build` y `deploy.sh up`. Las migraciones no se revierten solas, y una que no sea compatible hacia atrás necesita su propio plan.

## Open Questions

- La lista exacta de variables de `.env.example`: la configuración de permisos de la sesión de propuesta no permite leer ese archivo, así que se ha partido de README §1.4, `env.ts` y la CI. No cambia el enfoque; la tarea 3.1 lo contrasta.
