# Design — ci-e2e

## Context

La motivación está en `proposal.md`. El estado actual que condiciona el diseño es este.

**`.github/workflows/ci.yml` tiene cuatro jobs:**
- `check`: lint, typecheck, pruebas unitarias, hooks, `openapi:check` y el build del frontend.
- `integration`: `needs: check`, con SQL Server 2022 como service. Crea la base con `sa`, migra y siembra con `DATABASE_URL` de `sa` y ejecuta las pruebas de integración.
- `images`.
- `gitleaks`.

En los últimos runs, `check` tarda unos 3 minutos e `integration` de 4 a 6, así que el pull request tarda de 9 a 10 minutos.

**El E2E** (`e2e/`, Playwright 1.64.1 con playwright-bdd 9.2.1) no tiene `webServer`. `global-setup.ts` comprueba antes del primer paso que responden `http://localhost:5173` y `http://localhost:5173/api/v1/health`, y que hay `SEED_PASSWORD`. La configuración ya trae `trace: 'off'`, `video: 'off'` y `screenshot: 'only-on-failure'`. Los pasos escriben la contraseña desde la página y vacían el campo, de modo que no llega ni al título de un paso ni a una captura. Hoy solo existe el smoke `import-smoke.feature`; B escribe en otro change las tres historias, en `e2e/features` y `e2e/steps`.

**La colección Bruno** (`pnpm test:api`, que es `bru run -r --env local`):
- apunta a `http://localhost:3000`;
- lee las credenciales de `process.env` (`SEED_USER`, `SEED_VIEWER_USER`, `SEED_PAYMENTS_USER`, `SEED_ADMIN_USER` y `SEED_PASSWORD`);
- en la CLI 4.2.1, `process.env` es el entorno del proceso más el `api-collection/.env`, si existe (`commands/run.js`), así que en la CI basta con variables del job;
- deja la base sucia: `batch-clean` queda procesado como 123 y `RAM-07` asignado (#111). Por eso el smoke falla si se ejecuta después sin volver a sembrar.

**Arranque:**
- El backend tiene `build` (`tsc`) y `start` (`node --conditions=recon-dist dist/src/server.js`), y el spec de despliegue exige que `start` funcione tras compilar `@recon/shared` y el backend. Lee el `.env` de la raíz si existe; si no, el entorno.
- El frontend tiene `build` y `preview`. Vite aplica a `preview` el mismo `server.proxy` de `/api` que a `dev`.

**Identidad de la base:** en local, `infra/mssql/init.sql` crea la base y `recon_app` (lectura, escritura y DDL, sin `db_owner`), y la aplicación, la migración y el seed usan `recon_app`.

## Goals / Non-Goals

**Goals:**

- La colección y el E2E en cada pull request, sobre una base recién sembrada cada uno, sin que el fallo de uno oculte el del otro.
- Un arranque del API y la web parecido al desplegado y que no dependa del modo desarrollo.
- Un artifact solo cuando falle, sin nada que no deba salir del runner.
- La ejecución en local exactamente como la documenta el README.

**Non-Goals:**

- Escribir escenarios E2E (son de B) o cambiar peticiones de la colección.
- Ejecutar el E2E contra las imágenes de Docker del despliegue (D2, alternativa descartada).
- Paralelizar Playwright o añadir navegadores además de Chromium.
- Cambiar los jobs actuales, salvo lo mínimo para compartir el estilo (mismas acciones y versiones).

## Decisions

### D1. Un solo job `e2e` con las dos suites, no dos jobs

| | Un job (Bruno → seed → E2E) | Dos jobs (`api-collection` y `e2e`) |
|---|---|---|
| Preparación repetida | Una vez: service, `pnpm install`, `init.sql`, migración, seed y build de shared, backend y web (unos 3–4 min) | Dos veces: los mismos 3–4 min en cada job, más minutos de runner |
| Tiempo total | Preparación, más Bruno (unos 75 s en local), seed (unos 30 s) y smoke (unos 60 s) | Preparación y la suite más larga; con el smoke actual se ahorran unos 75 s |
| Aislamiento | Un `pnpm db:seed` entre las dos suites (#111) | Aislamiento total: base propia en cada job |
| Un fallo tapa al otro | No, si la siembra y el E2E llevan `if: ${{ !cancelled() }}` | No |
| Mantenimiento | Un bloque de preparación | Dos bloques iguales que hay que mantener a la par (o un composite action) |

**Decisión: un job.** Con el smoke actual, dos jobs ahorrarían poco más de un minuto a cambio de duplicar la preparación, que es la parte cara. La siembra entre las dos suites ya da el aislamiento que pide #111.

La condición `if: ${{ !cancelled() }}` en la siembra y en el E2E hace que un fallo de Bruno no impida ver el resultado del E2E, y el job falla igualmente.

**Cuándo revisarlo:** si la suite de B lleva el E2E por encima de unos 5 minutos, partir el job en dos pasa a compensar. Con dos jobs, cada uno tendría su base y correrían en paralelo. B estima su suite entre 5 y 8 minutos. Decisión del gate: un solo job por ahora; cuando se fusione la suite de B, se mide y, si hace falta, se parte en un change pequeño, sin tocar los specs.

**Sobre "reutilizar el SQL Server del job de integración" (#40).** Dos jobs no pueden compartir un contenedor. Lo que se reutiliza es el service, con la misma imagen y la misma comprobación de salud. Meter Bruno y el E2E dentro de `integration` tampoco compensa: pondría en serie unos 6 minutos de integración y unos 4 de suites, mezclaría los fallos en un solo check y obligaría a sembrar otra vez igualmente.

### D2. API y web levantados por pasos del workflow, con el build de producción

**Pasos del workflow, no `webServer` de Playwright.** Bruno necesita el API levantado antes de que empiece Playwright, y el `webServer` solo vive mientras corre `playwright test`.

Con `webServer` además habría que elegir:
- arrancar los servidores dos veces;
- o ejecutar Bruno desde el `globalSetup`, mezclando las dos suites.

Y en local, `webServer` arrancaría un segundo `pnpm dev` (o lo reutilizaría con `reuseExistingServer`) y cambiaría el procedimiento que documenta el README. Con pasos del workflow, `playwright.config.ts` se queda sin `webServer` y `global-setup.ts` sigue comprobando que todo responde, igual en local que en la CI.

**El build de producción, no `pnpm dev`.**
- **API:** `pnpm --filter @recon/shared build`, `pnpm --filter @recon/backend build` y `pnpm --filter @recon/backend start`. Es el mismo arranque compilado que exige el spec de despliegue y el que usa la imagen.
- **Web:** `pnpm --filter @recon/frontend build` y `pnpm --filter @recon/frontend preview --port 5173 --strictPort`. El proxy de `/api` es el mismo de `dev`, así que el navegador sigue viendo un solo origen.
- **Por qué no `pnpm dev`:**
  - `vite dev` transforma los módulos en la primera navegación, y eso es la causa típica de un timeout en el primer paso de la CI;
  - `tsx watch` vigila archivos sin necesidad;
  - el build de producción prueba además lo que se despliega (minificado, `import.meta.env` de producción).
- **El coste** es compilar shared, backend y web, unos 60–90 s. `check` ya compila el frontend, pero pasar `dist` entre jobs como artifact ahorraría poco y acoplaría los jobs.

Los dos procesos se lanzan en segundo plano con su salida a `api.log` y `web.log` en el directorio temporal del runner. Un paso espera con un bucle de `curl` (`--max-time 5` en cada intento), con un límite de unos 90 s, a que respondan `http://localhost:3000/api/v1/health` y `http://localhost:5173/api/v1/health`. Si no responden a tiempo, el paso muestra las últimas líneas de los dos logs y falla. Además, un último paso con `if: ${{ failure() || cancelled() }}` muestra las últimas 200 líneas de `api.log` y `web.log` cuando falla cualquier paso del job, también Bruno o el E2E, o cuando el job se cancela (por ejemplo, por `timeout-minutes`). Esos logs quedan en el log del job y nunca se suben como artifact. El job lleva `timeout-minutes: 20`, para que un paso colgado no retenga el runner las 6 horas por defecto.

**Descartado: Docker Compose con las imágenes del despliegue.** Es la prueba más fiel al despliegue, pero:
- obliga a construir las imágenes otra vez (`images` no las publica);
- necesita Nginx, el túnel y la configuración `.env.deploy`;
- alarga el job.

`images` ya comprueba que esas imágenes se construyen y que la configuración es válida.

### D3. `needs: check` y duración

`e2e` declara `needs: check`, como `integration`. Si fallan el lint, el typecheck o las pruebas unitarias, no se gastan minutos levantando la base y el navegador para un pull request que hay que corregir igualmente.

Estimación del job:

| Paso | Duración |
|---|---|
| Arranque del service | En paralelo con el checkout y el install |
| `pnpm install` con caché | Unos 40 s |
| `init.sql`, migración y seed | Unos 60–90 s |
| Builds | Unos 60–90 s |
| Chromium | Con caché, unos 20 s más `install-deps`; sin caché, unos 60–90 s |
| Bruno | Unos 75 s |
| Siembra | Unos 30 s |
| Smoke | Unos 60 s |
| **Total** | **Unos 7–9 min** |

El pull request pasa de unos 10 minutos (`check` más `integration`) a unos 11–12 (`check` más `e2e`).

**Medido en la CI de la rama** (runs 42353552930 y 42356282214): el job tarda entre 5 min 12 s y 5 min 29 s, por debajo de lo estimado.

| Paso | Duración medida |
|---|---|
| Migración y seed | 1 min 44 s |
| Builds | 14 s |
| Chromium sin caché | 24 s; con caché, solo `install-deps` |
| Bruno | 80 s |
| Nueva siembra | 40 s |
| Smoke | 7 s |

El pull request sigue limitado por `integration` (unos 6 min tras `check`), así que este job no lo alarga.

**Descartado: en paralelo con `check`.** Ahorraría unos 3 minutos de reloj, pero gastaría el job entero en los pull requests que no compilan, y dejaría de seguir la regla de `integration`.

### D4. Caché del navegador

Se cachea `~/.cache/ms-playwright` con `actions/cache`. La clave lleva el sistema del runner y la versión instalada de Playwright, que se lee con `pnpm --filter @recon/e2e exec playwright --version`; así cambia solo cuando sube Playwright, no con cualquier cambio del lockfile. Si la versión sale vacía, el paso falla: una clave sin versión serviría la misma caché a cualquier Playwright.

- **Si la caché falla:** `playwright install --with-deps chromium`.
- **Si acierta:** solo `playwright install-deps chromium`, porque las librerías del sistema no se cachean.

### D5. Base y credenciales del job

El service es el mismo que en `integration`: `mcr.microsoft.com/mssql/server:2022-latest`, `MSSQL_PID: Developer` y la misma comprobación de salud.

1. **Base y usuario:** con `sa`, un paso copia `infra/mssql/init.sql` al contenedor y lo ejecuta con `sqlcmd -v DB_NAME=… RECON_APP_PASSWORD=…`. Así crea la base, `recon_app` y `recon_reader` igual que en local.
2. **Migración, seed y API:** usan `recon_app`, con `DB_USER=recon_app` y `RECON_APP_PASSWORD`, sin `DATABASE_URL`. Es la misma identidad que en local, y cumple la regla de no conectar la aplicación como `sa` (CLAUDE.md). `integration` sigue como está.
3. **Variables del job:** escritas en el propio workflow, con valores de usar y tirar, como en `integration`:
   - `MSSQL_SA_PASSWORD`, `RECON_APP_PASSWORD`, `JWT_SECRET` (al menos 32 caracteres) y `SEED_PASSWORD`;
   - los nombres de usuario de la colección: `SEED_USER=analyst`, `SEED_VIEWER_USER=viewer`, `SEED_PAYMENTS_USER=payments` y `SEED_ADMIN_USER=admin`, que son los del seed y los de `api-collection/.env.example` (confirmado en el gate);
   - `SEED_PASSWORD` es un valor propio del workflow, no la contraseña de ejemplo de la plantilla;
   - `CI=true` ya lo pone GitHub.

No se escribe ningún `.env` ni `api-collection/.env`: el backend, el seed y Bruno leen el entorno cuando el archivo no existe (Context).

### D6. Informe solo al fallar

- **Cuándo se sube:** un paso con `if: ${{ !cancelled() && steps.e2e.outcome == 'failure' }}` y `actions/upload-artifact`, con nombre `playwright-report`, sube `e2e/playwright-report/` y `e2e/test-results/` con `retention-days: 7` e `if-no-files-found: ignore`. La condición mira el resultado del paso del E2E, no `failure()`: así un fallo de Bruno no sube el informe de un E2E en verde (run 42355330786).
- **Qué lleva:** la configuración ya excluye la traza y el vídeo. Las capturas del fallo no muestran la contraseña, porque los pasos la escriben desde la página y vacían el campo.
- **Los secretos del job** son literales de usar y tirar: aunque se vieran, no abren nada fuera del runner efímero. Aun así, la verificación del apply (tareas) busca el valor de `SEED_PASSWORD` en el artifact descargado.
- **Lo que no se sube:** los logs del API y la web ni la salida de Bruno, que no escribe informe a archivo; solo quedan en el log del job. Al fallar cualquier paso, el último paso del job muestra las últimas 200 líneas de los dos logs, que es lo que indica el mensaje de `global-setup.ts` en la CI.

### D7. Cambios en `playwright.config.ts` y `global-setup.ts`

- **`playwright.config.ts`:**
  - `forbidOnly: !!process.env.CI`, para que un `.only` olvidado no deje en verde una suite recortada;
  - en la CI, el reporter `github` además de `list` y `html`, para que el fallo salga como anotación en el pull request;
  - el comentario de cabecera deja de decir "no CI job yet".
  - Sin `webServer`, sin `retries` y sin más workers: se mantiene `workers: 1`, porque los escenarios comparten la base.
- **`global-setup.ts`:** con `CI` definido, el mensaje dice que el workflow no levantó la aplicación y remite a los logs del job. En local sigue mostrando los mismos comandos (`pnpm db:up`, `pnpm db:seed` y `pnpm dev`).
- **`e2e/features` y `e2e/steps`** no se tocan.

### D8. Comprobación del workflow

Las comprobaciones se hacen solo en la CI de la rama del change, sin base local.

1. **Rotura deliberada:** un commit temporal quita la siembra entre Bruno y el E2E. El smoke debe fallar porque `RAM-07` ya está asignado. Así se comprueba a la vez que la siembra hace falta, que el check falla y que el artifact se sube. Se descarga el artifact y se comprueba que no contiene `trace.zip` ni `.webm`, ni el valor de `SEED_PASSWORD`. Después se revierte con otro commit.
2. **Bruno falla y el E2E corre igual:** un commit temporal da a Bruno un `SEED_PASSWORD` equivocado, solo en ese paso. La colección debe fallar, y la siembra y el E2E deben ejecutarse igualmente. Se revierte con otro commit.
3. **Run en verde:** con los dos cambios revertidos, el job pasa sin artifact.
4. **Paso de logs (review-diff de #147):** se repite la contraseña equivocada de Bruno en un commit temporal. El job falla, y el último paso muestra las últimas 200 líneas de `api.log` y `web.log`, sin contraseñas (run 42358565893). Se revierte, y el run 42359533104 sale en verde con ese paso omitido. El paso lleva `if: ${{ failure() || cancelled() }}`, para que también imprima cuando el job se corta por `timeout-minutes`.

## Risks / Trade-offs

- **[Más tiempo por pull request, unos 2 minutos]** → Es el coste de ver la colección y el E2E en cada cambio. La caché del navegador y `needs: check` lo acotan.
- **[Inestabilidad del E2E en la CI]** → Build de producción, `workers: 1`, `retries: 0` y timeouts ya ajustados en la configuración. Un fallo intermitente se investiga, no se tapa con reintentos.
- **[La suite de B lo alarga]** → D1 deja escrito el umbral para partir el job.
- **[`init.sql` cambia]** → El job lo ejecuta tal cual. Si un cambio rompe la creación de `recon_app`, falla este job, que es justo lo que se quiere.
- **[La CLI de Bruno deja de leer el entorno en una versión futura]** → Está fijada en 4.2.1. Si cambia, el paso de Bruno falla en `00-auth`, y la solución es escribir `api-collection/.env` en el runner a partir de las variables del job.
- **[`vite preview` no es Nginx]** → Las cabeceras de seguridad y el límite de subida del despliegue no se prueban aquí; ya los cubren el spec de despliegue y `images`. El E2E prueba el comportamiento de la aplicación.

## Migration Plan

1. Se fusiona con el job nuevo. No hay datos ni esquema que migrar.
2. **Rollback:** quitar el job `e2e` de `ci.yml`. Los otros jobs no dependen de él.
3. Con la suite de B fusionada, se revisa la duración del job (D1).
