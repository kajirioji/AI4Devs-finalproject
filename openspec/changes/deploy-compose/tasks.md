# Tasks — deploy-compose

Orden: primero las imágenes, que se prueban en local con Docker Desktop. Lo que el hook impide al agente (migrar, sembrar) lo ejecuta la persona con `! ...` dentro de la sesión.

## 1. Paquete compartido e imagen de la API

- [x] 1.1 En `packages/shared`: script `build`, `tsconfig.build.json` (sin tests), `files` y `exports` con la condición `recon-dist` (design D1). Verificar: `pnpm typecheck` y `pnpm test` en verde sin carpetas `dist`
- [x] 1.2 Cambiar `start` en `backend/package.json` a `node --conditions=recon-dist dist/src/server.js`. Verificar: tras compilar shared y backend, `pnpm --filter @recon/backend start` escucha sin `ERR_MODULE_NOT_FOUND`
- [x] 1.3 Crear `.dockerignore` en la raíz (`**/node_modules`, `**/dist`, `**/.env*`, `.git`, `data/uploads`, `e2e/test-results`…). Verificar: ningún `.env` dentro de la imagen construida
- [x] 1.4 Crear `backend/Dockerfile` con las etapas y los destinos `runtime` y `ops` (design D2). Verificar: `docker build -f backend/Dockerfile --target runtime .` y `--target ops` terminan bien
- [x] 1.5 Verificar la imagen `runtime`: `id` no es root; no contiene `tsx` ni el CLI de Prisma; arranca y responde `503` en `/api/v1/health` sin base; el estado de Docker pasa a `unhealthy`
- [x] 1.6 Commit: `fix(shared): compilar el paquete para ejecutar el backend construido` (propio y antes del resto, tras comprobar que `pnpm test`, `pnpm typecheck`, `pnpm lint` y `pnpm dev` se comportan igual) y `feat(infra): imagen Docker de la API`

## 2. Imagen web

- [x] 2.1 Crear `frontend/nginx/default.conf` y el fragmento de cabeceras `frontend/nginx/security-headers.conf` (design D3). Verificar con `nginx -t` dentro de la imagen
- [x] 2.2 Crear `frontend/Dockerfile` multi-stage, sin `VITE_API_URL`. Verificar: `docker build -f frontend/Dockerfile .` termina bien y el proceso no es root
- [x] 2.3 Verificar: una ruta profunda de la SPA da `200` con `index.html`; `assets/` lleva caché inmutable; las cuatro cabeceras aparecen en `index.html`, en `assets/` y en `/api/`
- [x] 2.4 Commit: `feat(infra): imagen Docker de la web con Nginx`

## 3. Compose de despliegue y base de datos

- [x] 3.1 Crear `infra/.env.deploy.example` con todas las variables, sin secretos y con `TUNNEL_TOKEN` vacío, y contrastarla con `.env.example` (design, Open Questions). Añadir `!.env.deploy.example` a `.gitignore`. Verificar: `git check-ignore` no ignora la plantilla y sí `infra/.env.deploy`
- [x] 3.2 Crear `infra/mssql/init.deploy.sql` (idempotente) y hacer que `entrypoint.sh` lo ejecute si está montado (design D7). Verificar: `pnpm db:up` en local sigue dejando a `recon_app` con `db_ddladmin`
- [x] 3.3 Crear `infra/docker-compose.deploy.yml`: `web`, `api`, `mssql`, `cloudflared`, `migrate`, `seed`, redes, volúmenes de base y de subidas, `environment` por servicio y healthchecks, incluido el de `cloudflared` con `tunnel ready` (design D4, D7, D8). Verificar: `docker compose config` sin puertos publicados y sin la contraseña de `sa` ni el token en `api`
- [x] 3.4 Crear los overrides `docker-compose.deploy.debug.yml` y `docker-compose.deploy.external-db.yml` (design D6). Verificar: `docker compose config` de cada combinación muestra lo esperado, y en el modo externo `mssql` no se arranca
- [x] 3.5 Levantar en modo de depuración con Docker Desktop. La persona ejecuta `! docker compose --env-file infra/.env.deploy -f infra/docker-compose.deploy.yml -f infra/docker-compose.deploy.debug.yml run --rm migrate`. Verificar: la migración termina con `recon_migrator`, `recon_app` no puede hacer `CREATE TABLE`, y `web` y `api` quedan `healthy`
- [x] 3.6 Verificar el aislamiento sin el override de depuración (con él, `web` tiene salida para publicar su puerto): desde `api`, `web` y `mssql` una conexión a internet falla. Con el override, `127.0.0.1:8080` responde en el host
- [x] 3.7 Verificar el modo externo usando un segundo contenedor SQL Server como "externo": la API responde `200` en el health sin el servicio `mssql` del compose
- [x] 3.8 Ejecutar gitleaks sobre el repositorio con la plantilla incluida. Verificar: cero hallazgos
- [x] 3.9 Verificar el reinicio sobre un volumen con datos: `down` y `up` arrancan a la primera aunque SQL Server tarde en abrir las bases (`Msg 904`), se conservan los datos y `recon_app` no recupera `db_ddladmin`. Un fallo real de inicialización termina el contenedor con error
- [x] 3.10 Commit: `feat(infra): compose de despliegue con túnel, red interna e identidad de migración`

## 4. Operación con `scripts/deploy.sh`

- [ ] 4.1 Crear `scripts/deploy.sh` (design D9), con fin de línea LF y permiso de ejecución. Verificar: sin `infra/.env.deploy` termina con un mensaje claro; `up` con `TUNNEL_TOKEN` vacío se niega salvo con `DEPLOY_DEBUG=1`; una orden desconocida muestra la ayuda
- [ ] 4.2 Verificar que `seed` sin escribir la confirmación no hace nada. La persona ejecuta `! DEPLOY_DEBUG=1 scripts/deploy.sh seed`, confirma y comprueba que termina bien y que el login con `analyst` funciona en `127.0.0.1:8080`
- [ ] 4.3 Verificar `up` con una migración pendiente simulada contra una base vacía: `up` no la aplica; la persona ejecuta `! DEPLOY_DEBUG=1 scripts/deploy.sh migrate` y una segunda ejecución no cambia nada
- [ ] 4.4 Commit: `feat(infra): script de operación del despliegue`

## 5. CI

- [ ] 5.1 Añadir el job `images` a `.github/workflows/ci.yml` (design D10), sin publicar, y `feature/entrega-3-MVP` a `on.push.branches`. Verificar en el PR: check en verde y ninguna imagen subida
- [ ] 5.2 Verificar el job rompiendo un Dockerfile a propósito en un commit temporal: el check falla. Revertir ese commit
- [ ] 5.3 Commit: `ci: construir las imágenes de despliegue en los pull requests`

## 6. Documentación

- [ ] 6.1 Escribir `docs/deploy.md` en lenguaje llano: qué es cada pieza (contenedor, compose, túnel, volumen, migración), instalar Docker, clonar, crear `.env.deploy`, crear el túnel en Cloudflare Zero Trust y copiar el token, `up`, migrar, sembrar, comprobar, actualizar, y qué hacer si algo falla. Verificar: cada orden se ha ejecutado tal como está escrita en la prueba local, salvo las del panel de Cloudflare, marcadas como pendientes de contrastar en el servidor
- [ ] 6.2 Incluir en `docs/deploy.md`: SQL Server externo, puertos de depuración, límites de Cloudflare, aviso de qué órdenes borran datos y, como **paso obligatorio del procedimiento y con sus clics**, la regla de rate limiting en Cloudflare sobre `/api/v1/auth/login`. Verificar por lectura contra los escenarios de la spec
- [ ] 6.3 Actualizar README: §1.4 enlaza la guía; §2.4 describe el estado real (SQL Server en el compose por defecto, identidad de migración, sin el identificador `D01`); §0.4 indica que la URL se añadirá cuando exista. Verificar con una búsqueda: sin nombre ni ubicación del servidor
- [ ] 6.4 En `CLAUDE.md`: añadir la línea de `scripts/deploy.sh` a Comandos y cambiar la regla 3 de "Cómo trabajamos" a `feature/entrega-3-MVP`. Registrar el change en `prompts.md`. Verificar por lectura
- [ ] 6.5 Commit: `docs(deploy): guía de despliegue y estado real en el README`

## 7. Comprobación integrada en local

- [ ] 7.1 Desde cero (volúmenes nuevos), seguir `docs/deploy.md` en modo de depuración. Verificar: todos los servicios `healthy` y el README sin pasos que falten
- [ ] 7.2 Hacer en el navegador, en `127.0.0.1:8080`, el recorrido import → validaciones → settlement → descargas con `data/samples/batch-clean`, con la API como `recon_app` sin DDL. Verificar: el recorrido termina y la consola no muestra violaciones de CSP
- [ ] 7.3 Con ese import creado, ejecutar la actualización (`build`, `migrate`, `up`). Verificar: el import y sus archivos siguen disponibles
- [ ] 7.4 Verificar en verde `pnpm lint`, `pnpm typecheck`, `pnpm test` y `git status` sin `.env.deploy`
- [ ] 7.5 Commit: `chore(infra): ajustes de la prueba integrada del despliegue` (solo si la prueba deja cambios)

## Workflow follow-up

Pasos manuales, fuera de este change, que completan la definición de hecho del issue #97:

- En el servidor, la persona sigue `docs/deploy.md`, crea el túnel y la regla de rate limiting, y comprueba los criterios 1 a 4 del issue por la URL pública, también desde un dispositivo fuera de la red local.
- Añadir la URL pública a README §0.4 y corregir en `docs/deploy.md` lo que el panel de Cloudflare muestre de otra forma.
- `/opsx:verify`, PR hacia `feature/entrega-3-MVP` con la plantilla, CI en verde y `/opsx:archive`.
