## Why

La colección Bruno (`pnpm test:api`) y el E2E de Playwright (`pnpm test:e2e`) solo se ejecutan en local, con la base, el seed y `pnpm dev` levantados a mano. Un pull request puede romper un flujo del API o de la pantalla sin que la CI lo vea. El README deja ese job para la Entrega 3 y #40 tiene abierta su casilla. La suite de las tres historias que escribe B, en otro change, también necesita un sitio donde correr en cada pull request.

## What Changes

- **Job nuevo `e2e` en `.github/workflows/ci.yml`.** Es un solo job, con SQL Server 2022 como service, igual que `integration`, y con `needs: check`. Sus pasos:
  1. Crea la base y el usuario `recon_app` con `infra/mssql/init.sql`.
  2. Migra y siembra.
  3. Compila y levanta el API (`start` del backend) y la web (`vite preview` en el puerto 5173, con el proxy de `/api`).
  4. Instala el Chromium de Playwright, con caché por versión.
  5. Ejecuta `pnpm test:api`.
  6. Vuelve a sembrar con `pnpm db:seed`.
  7. Ejecuta `pnpm test:e2e`.

  El E2E y la nueva siembra se ejecutan también si Bruno falla, para que una suite no tape a la otra. La nueva siembra hace que ninguna de las dos dependa de lo que deja la otra (#111).
- **Informe de Playwright como artifact solo cuando el E2E falla.** Lleva el informe HTML y las capturas del fallo, sin traza ni vídeo (ya están apagados en la configuración) y con retención corta. Los secretos del job son de usar y tirar, escritos en el workflow como los de `integration`; ninguno llega al informe.
- **`e2e/playwright.config.ts`:** en la CI, `forbidOnly` y el reporter `github` además de `list` y `html`. La ejecución en local no cambia: sin `webServer`, contra lo que levanta la persona.
- **`e2e/global-setup.ts`:** si la aplicación no responde, el mensaje distingue la CI (el workflow no la levantó) de la ejecución en local (los comandos de siempre).
- **El job arranca con el smoke actual** (`e2e/features/import-smoke.feature`). La suite de B entra sola cuando se fusione, porque el job ejecuta todo `e2e/features`. Este change no toca `e2e/features` ni `e2e/steps`.
- **README:**
  - la tabla de pruebas y el párrafo de la CI de §1.4 (paso 6);
  - en la estrategia de testing, la línea "En pipeline".
  - Los párrafos "End-to-end (Playwright)" y del smoke de la estrategia de testing los actualiza B con su suite, para no editar los mismos párrafos (decisión del gate).
- **#40:** este change cierra la casilla "Job e2e en CI (Playwright) reutilizando el SQL Server del job de integración (Entrega 3)". La colección Bruno no tiene casilla propia en #40; entra en la misma línea del README.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `import`: requisito nuevo "Suite E2E en la CI", junto al del smoke E2E que ya vive en esta capability.
- `api-collection`: requisito nuevo "Colección en la CI".

## Impact

- **CI:** un job más en cada pull request y en cada push a las ramas de entrega. La duración estimada es de 7 a 9 minutos después de `check`, en paralelo con `integration`, `images` y `gitleaks`. El tiempo total del pull request pasa de unos 10 minutos a unos 11–12 (design D3).
- **Archivos:**
  - `.github/workflows/ci.yml`, `e2e/playwright.config.ts` y `e2e/global-setup.ts`;
  - `readme.md`, en §1.4 y en la línea "En pipeline".
  - En `package.json` no se prevén cambios: los scripts de la raíz (`test:api`, `test:e2e`, `db:*`) y los de cada paquete (`build`, `start`, `preview`) bastan.
- **Sin cambios** en el código de la aplicación, el esquema, las migraciones, `e2e/features`, `e2e/steps` ni la colección.
- **Ejecución en local:** igual que la documenta README §1.4. Los comandos, los prerrequisitos y el mensaje de "aplicación no levantada" no cambian.
- **Base compartida:** el job usa su propio SQL Server efímero y no toca la base local. Las comprobaciones del workflow se hacen en una rama, con la CI.
