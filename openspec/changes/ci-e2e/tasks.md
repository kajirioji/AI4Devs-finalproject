# Tasks — ci-e2e

Ninguna tarea usa la base local. Lo que necesita SQL Server se comprueba en la CI de la rama `feat/ci-e2e`. Si hiciera falta probar algo en local contra la base, se pide turno antes.

## 1. Configuración de Playwright

- [x] 1.1 `e2e/playwright.config.ts` (D7): `forbidOnly: !!process.env.CI` y, solo en la CI, el reporter `github` además de `list` y `html`; actualizar el comentario de cabecera. Sin `webServer` y sin cambiar `workers`, `retries`, `trace`, `video` ni `screenshot`. Verificar: `pnpm --filter @recon/e2e typecheck` y `pnpm lint` en verde.
- [x] 1.2 `e2e/global-setup.ts` (D7): con `CI` definido, el mensaje remite a los pasos del workflow y a sus logs; sin `CI`, el mensaje de siempre. Verificar, sin base y sin app levantada:
  - `pnpm test:e2e` falla antes del primer paso con el mensaje de `pnpm db:up`, `pnpm db:seed` y `pnpm dev`;
  - con `CI=1 pnpm test:e2e` sale el mensaje de la CI;
  - se rompe a propósito la condición (mensaje de la CI siempre), se ve fallar la primera comprobación y se restaura con `cp` desde el scratchpad.
- [x] 1.3 Commit: chore(e2e): configuración de Playwright para la CI, y `git push`.

## 2. Job `e2e` en la CI

- [x] 2.1 En `.github/workflows/ci.yml`, el job `e2e` (D1, D3, D5): `needs: check`, el mismo service de SQL Server que `integration` y las variables del job con valores de usar y tirar. Pasos:
  - checkout, pnpm, Node con caché e install;
  - `init.sql` con `sqlcmd -v`;
  - `db:generate`, `db:migrate` y `db:seed` como `recon_app`.
- [x] 2.2 Mismo job (D2): build de shared, backend y frontend; `start` del backend y `preview --port 5173 --strictPort` del frontend en segundo plano, con su salida a logs del runner; espera con `curl` a `localhost:3000/api/v1/health` y `localhost:5173/api/v1/health`, con un límite de unos 90 s y `curl --max-time 5`, mostrando las últimas líneas de los logs si falla; un último paso con `if: ${{ failure() || cancelled() }}` muestra las últimas 200 líneas de los dos logs; `timeout-minutes: 20` en el job.
- [x] 2.3 Mismo job (D4): caché de `~/.cache/ms-playwright` con la versión de Playwright en la clave; `playwright install --with-deps chromium` si la caché falla y `playwright install-deps chromium` si acierta.
- [x] 2.4 Mismo job (D1, D6), en este orden:
  1. `pnpm test:api`;
  2. `pnpm db:seed`, con `if: ${{ !cancelled() }}`;
  3. `pnpm test:e2e`, con `if: ${{ !cancelled() }}`;
  4. `actions/upload-artifact` con `if: ${{ !cancelled() && steps.e2e.outcome == 'failure' }}` (así un fallo de Bruno no sube el informe de un E2E en verde), nombre `playwright-report`, `e2e/playwright-report/` y `e2e/test-results/`, `retention-days: 7` e `if-no-files-found: ignore`.
- [x] 2.5 Commit: ci: job e2e con la colección Bruno y Playwright (#40), y `git push`. Verificar en la CI de la rama: el job `e2e` termina en verde, la colección pasa entera, el smoke ve `Rows read 783`, `Matched 780` y `RAM-07 is not assigned yet`, y no hay artifact `playwright-report`. Anotar la duración del job y la de cada suite.

## 3. Roturas deliberadas en la CI

- [x] 3.1 Commit temporal que quita el paso de la siembra entre Bruno y el E2E (D8.1). Verificar en la CI:
  - el smoke falla porque `RAM-07` ya está asignado, y el check falla;
  - existe el artifact `playwright-report`;
  - descargado con `gh run download`, no contiene `trace.zip` ni archivos `.webm`, y una búsqueda del valor de `SEED_PASSWORD` no encuentra nada.
- [x] 3.2 Revertir 3.1 con un commit (`git revert`, nunca `git checkout` sobre trabajo sin commit) y, en el mismo push, un commit temporal que da a Bruno un `SEED_PASSWORD` equivocado solo en su paso (D8.2). Verificar en la CI: la colección falla en `00-auth`, la siembra y el E2E se ejecutan igualmente, el smoke pasa y el check falla.
- [x] 3.3 Revertir 3.2 con un commit. Verificar en la CI: el job vuelve a verde sin artifact.
- [x] 3.4 Commit: los de 3.1–3.3, con los mensajes test(ci): rotura deliberada … y revert: …, y `git push`; quedan en el historial como prueba.
- [x] 3.5 Rotura del paso de logs (review-diff de #147, D8.4), con un commit temporal que repite la contraseña equivocada de Bruno. Verificado en la CI:
  - el job falla y el último paso muestra las últimas 200 líneas de `api.log` y `web.log`, sin contraseñas (run 42358565893);
  - se revierte con `git revert` y el job vuelve a verde con ese paso omitido (run 42359533104).
  - Commits: test(ci): rotura deliberada … y revert: …

## 4. README

- [x] 4.1 §1.4, paso 6:
  - la tabla de pruebas dice que `pnpm test:api` y `pnpm test:e2e` también corren en la CI;
  - el párrafo de la CI describe el job `e2e`: base efímera, colección, nueva siembra y E2E, informe solo al fallar;
  - se quita "su job de CI queda para la Entrega 3".
  - Los prerrequisitos en local no cambian.
- [x] 4.2 Estrategia de testing, solo la línea "En pipeline": la colección y el E2E corren en cada pull request desde la Entrega 3 (#40), y queda como pendiente lo que siga pendiente (cobertura del 80 % y mutation testing). Los párrafos "End-to-end (Playwright)" y del smoke no se tocan: los actualiza B con su suite (decisión del gate). Verificar: ni §1.4 ni "En pipeline" anuncian ya el job como futuro.
- [x] 4.3 Commit: docs(readme): colección Bruno y E2E en la CI (#40), y `git push`.

## 5. Verificación de conjunto y PR

- [x] 5.1 En verde: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `openspec validate ci-e2e --strict` y todos los jobs de la CI de la rama, incluido `e2e`.
- [x] 5.2 Commit (solo si la verificación dejó correcciones): fix(ci): ajustes de la verificación de ci-e2e, y `git push`. No hizo falta: la verificación no dejó correcciones.
- [x] 5.3 Abrir el PR hacia `feature/entrega-3-MVP` con la plantilla, enlazando #40.
  - La descripción dice qué casilla de #40 cierra: "Job e2e en CI (Playwright) reutilizando el SQL Server del job de integración (Entrega 3)".
  - Incluye la duración medida del job y los enlaces a los runs de las roturas deliberadas.
- [ ] 5.4 Marcar esa casilla en #40 con `gh issue edit` cuando el PR esté fusionado, o antes si la persona lo pide.

## Workflow follow-up

- `/opsx:verify ci-e2e` y `/review-diff` en otra sesión, cuando lo pida la persona.
- Cuando se fusione la suite de B: comprobar la duración del job y revisar D1 (umbral de unos 5 minutos de E2E).
- `/opsx:archive ci-e2e` después del merge.
