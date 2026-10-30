# Recon Tool 2.0 — instrucciones para el agente

Aplicación web de reconciliación de settlements de proveedores de pago (reemplaza una
herramienta interna sobre SSRS). Proyecto final del máster AI4Devs. La **fuente de verdad del
producto es `README.md`** (reglas de negocio 1.2, modelo de datos 3, validaciones 3.3, API 4,
historias 5). Si el código y el README discrepan, el README manda y el cambio se discute antes
de programar.

## Stack y estructura

- Monorepo pnpm: `backend/` (Node 22, TypeScript, Fastify 5, Zod 4, Prisma 7 + `@prisma/adapter-mssql`),
  `frontend/` (React 19, Vite, Tailwind, shadcn/ui, TanStack Query/Table, React Hook Form),
  `packages/shared` (tipos y esquemas Zod compartidos), `e2e/` (Playwright + playwright-bdd),
  `data/samples/` (archivos de prueba + `expected.json`), `infra/` (Docker Compose, SQL Server 2022), `openspec/` (specs), `docs/` (ADR, diagramas, OpenAPI).
- Backend hexagonal por módulo: `src/modules/<modulo>/{domain,application,infrastructure,http}`.
  Módulos del MVP: `catalog`, `accounts`, `fees`, `matching`, `imports`, `validation`, `settlement`, `auth`, `audit`.
- Base de datos: SQL Server 2022, usuario `recon_app` (nunca `sa`). Importes `DECIMAL(19,4)`, porcentajes `DECIMAL(9,6)`; **nunca `MONEY`, `FLOAT` ni `number` de JS para dinero**: en la API el dinero viaja como string decimal y en el dominio se usa `Decimal` de Prisma o `decimal.js`.
- Linter y formato: Biome (no Prettier ni ESLint). Commits: Conventional Commits.
- **Idiomas.** Documentación (`README.md`, `prompts.md`, `docs/`, specs de OpenSpec, `CLAUDE.md`, skills, plantilla de PR) y **mensajes de commit en español**. Todo lo que es código o configuración en **inglés**: identificadores, comentarios, docstrings, mensajes que emiten scripts y hooks, comentarios de SQL/YAML/JSON/shell/.env, textos de la interfaz de usuario y datos sembrados. Un comentario en español dentro de un `.ts` es un hallazgo de revisión.
- **Códigos de error.** Los códigos de error de las respuestas del API van en snake_case minúsculas (`validation_error`, `not_found`, `unauthorized`). Los códigos en mayúsculas de los ejemplos del README (`FEE_OVERLAP`, `DUPLICATE_FILE`, `BATCH_NO_TAKEN`…) están desactualizados: se implementan en minúsculas y el ejemplo del README se corrige en el mismo change.

## Vocabulario fijo (úsalo tal cual en código, specs y UI)

- `cycle` ∈ `E` (transacción) · `I` (ajuste) · `R` (reserva). **El ciclo lo fija la hoja o la regla de pareo, no el estado.** R no tiene estado: la rolling reserve es una etapa, no un estado.
- Estados del gateway: `Pending`, `Successful`, `Declined`, `Chargeback`, `Refund`, `RDR`. `CHB 2` es solo un alias legacy de `Chargeback` con `excludeAmount`.
- Jerarquía: Gateway → Merchant → Provider → Channel (solo lectura) y Account (lo único que la app posee). `AccountChannel.isPrimary` = última cuenta que procesó un settlement con ese canal.
- Importación: `Import` → `ImportFile` → `ImportSheet` (`kind` ∈ transactions | batch_fees | ignore) → `ImportRow` (`matchResult` ∈ matched | unmatched | ambiguous | ignored).
- Validaciones (8, en este orden): `provider_mismatch` (la **única bloqueante**), `non_recorded_adjustment`, `duplicate_in_batch`, `status_collision_in_batch`, `duplicate_across_batches`, `status_collision_across_batches`, `missing_previous_to_batch`, `missing_in_range`. Clave de duplicado/colisión: `(transactionId, cycle)`.
- Settlement: `SettlementBatch` (intento; `status` processed → paid; undone), `SettlementTransaction` (un movimiento por ciclo). **Settled solo cuando el batch está `paid`.**
- Fees: `Fee.startDate NULL` = desde siempre, `endDate NULL` = sin fin; no se borran, se cierran. Fees no transaccionales de la hoja `Other Fees` llegan **prellenados** al Settlement Review.
- Plantilla de entrada: hojas `APP/DEC/CHB/REF/RDR/RR` con `ID, Amount, Currency`; solo `ID` es obligatorio; importes siempre positivos; IDs se leen y exportan como texto; uno o varios archivos por batch.

## Cómo trabajamos

1. **Una feature = un change de OpenSpec** (`/opsx:propose` → revisión humana → `/opsx:apply` → `/opsx:verify` → `/opsx:archive`). Sin proposal aprobado no se escribe código de feature.
2. **TDD en el dominio**: validaciones, motor de pareo, cálculo de fees y summary se escriben test-first con Vitest, usando `data/samples/*/expected.json` como oráculo. Rompe el test a propósito una vez para comprobar que falla.
3. **Rama por feature** (`feat/<modulo>-<tema>`), PR hacia `feature/entrega-3-MVP` con la plantilla; CI verde obligatorio.
4. **Sesión nueva por paso** (explorar → planificar → ejecutar). Antes de tocar el esquema o una migración, para y pide confirmación.
5. **Nunca**: datos reales o identificadores reales (todo es sintético), `prisma migrate reset` o `deploy` contra una base que no sea la local, `prisma db push` ni `prisma migrate dev` (el índice único filtrado `UX_ValidationRun_current_import`, los demás índices filtrados y las `CHECK` viven solo en las migraciones escritas a mano: generarlas desde `schema.prisma` los perdería), secretos en el repo, `console.log` en código de producción (usa el logger de Fastify), `any` sin justificación en el PR.

## Comandos

- `pnpm db:up` · `pnpm db:migrate` · `pnpm db:seed` (idempotente; recrea todo el mundo sintético)
- `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test`
- `scripts/deploy.sh build | up | migrate | seed | logs | ps | down`: despliegue con Docker Compose y túnel (`docs/deploy.md`)
- `pnpm samples:plan && python data/samples/build-samples.py` regenera los archivos de muestra
- `pnpm test:api` (colección completa) · `pnpm test:api:smoke` (solo `10-smoke`): colección Bruno contra el backend local

## Colección de la API (Bruno)

- La colección vive en `api-collection/` (`00-auth`, `10-smoke`, `20-flows`). Se importó **una vez** desde `docs/openapi.yaml`; **nunca se reimporta** (pisaría tests y scripts): se mantiene a mano.
- **Todo endpoint nuevo o modificado** añade o actualiza en la colección su petición de caso feliz y al menos una negativa (código de estado y `code` del error), en el mismo PR que el endpoint.
- Usuario principal `analyst` con auth heredada de la colección (el login es automático). Los negativos de alcance (`404`) y de permiso (`403`) usan `viewer`: variable de petición `as: viewer` y `auth: bearer` con `{{viewerToken}}`. Las peticiones que hacen su propio login declaran `selfAuth: true`.
- Credenciales en `api-collection/.env` (ignorado; copiar de `.env.example`); `SEED_PASSWORD` debe coincidir con el del `.env` de la raíz. Nunca se lee ni se versiona.
- Prerrequisitos para ejecutarla: `pnpm db:up`, `pnpm db:seed` y `pnpm dev` levantado.

## Dónde mirar

- Reglas de negocio y decisiones: `README.md` §1.2, §3.3; ADR en `docs/adr/`.
- Contrato de la plantilla: `data/samples/README.md` y README §1.2 "Plantilla estandarizada".
- Parámetros del dataset sintético: `backend/prisma/synthetic.ts` (comentario de cabecera).
- Specs vivas: `openspec/specs/<modulo>/spec.md`.
