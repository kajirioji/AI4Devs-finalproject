# Tasks — settlement-lifecycle

Issues #78 y #79; parte `settlement` de #21. Rama: `feat/settlement-lifecycle`. Sin migraciones: si algún grupo parece necesitar una, parar y preguntar. Referencias: `design.md` (D1–D11) y los delta specs.

Orden: dominio → contrato → `pay`/`unpay` → `undo` → colección → frontend → documentación. `undo` va después de `pay` porque rechaza un `paid`; el frontend, después del contrato generado.

## 1. Dominio: transiciones (TDD)

- [x] 1.1 Escribir `domain/batch-lifecycle.test.ts` con las nueve combinaciones de acción y estado (spec "Tabla de transiciones") y comprobar que falla por no existir el módulo
- [x] 1.2 Commit: test(settlement): tabla de transiciones del intento
- [ ] 1.3 Implementar `transitionOf` (D2) y dejar el test en verde; rotura deliberada: permitir `undo` desde `paid` hace fallar su fila, y se revierte
- [ ] 1.4 Quitar la copia de `settledStatusOf` de `prisma-settlement-reader.ts` e importar la de `domain/settled.ts`; verificar con `pnpm --filter @recon/backend test`
- [ ] 1.5 Commit: feat(settlement): transiciones del intento como función pura

## 2. Contrato compartido y errores

- [ ] 2.1 En `packages/shared/src/settlement.ts`, añadir `ReasonRequest` y los campos de pago y de deshacer de `SettlementView`, con tests de forma (motivo vacío, de solo espacios y de 501 caracteres rechazados)
- [ ] 2.2 Añadir a `application/errors.ts` los cuatro `409` de D7; el lector rellena los campos nuevos, y los tests "Batch del seed" (con `paidBy`) e "Intento deshecho" pasan
- [ ] 2.3 Extraer `isDeadlockVictim` y el reintento a `infrastructure/deadlock-retry.ts`, sin cambio de comportamiento; verificar con los tests existentes de `settlement_busy`
- [ ] 2.4 Commit: feat(settlement): contrato y errores del ciclo de vida del intento

## 3. Pagar y retirar el pago

- [ ] 3.1 Escribir los tests de servicio y de integración de `pay` y `unpay` (HU3 CA7, sin motivo, seed, pagar de nuevo, cifras intactas, `settled` en `GET transactions`, filtro `status=paid`) y comprobar que fallan
- [ ] 3.2 Commit: test(settlement): marcar como pagado y retirar el pago
- [ ] 3.3 Implementar el servicio, el repositorio con guarda y auditoría (D3) y las rutas con su permiso; verificar con los tests de 3.1 y los de alcance y permiso (`401`, `403` antes del alcance, `404` idéntico, `400`)
- [ ] 3.4 Escribir los tests de concurrencia con compuertas: dos `pay`, dos `unpay`; quitar la guarda `status = @from` los hace fallar, y se revierte
- [ ] 3.5 Commit: feat(settlement): marcar como pagado y retirar el pago

## 4. Deshacer y reprocesar

- [ ] 4.1 Escribir los tests de `reopenForBatch` filtrado por corrida vigente y devolviendo ids (D5) y comprobar que fallan; ajustar `settlement-missing.int.test.ts`
- [ ] 4.2 Escribir los tests de integración de `undo`: datos conservados, import, faltantes, `RAM-07`, auditoría, corrida superada, `lastInvalidatedReview`, `run = null`, `validation_run_required`, `settlement_not_current`, fallo a mitad y undo de un batch del seed; comprobar que fallan
- [ ] 4.3 Escribir los tests de reproceso: `next` con `reprocess`, número tomado por otro import, intento 2 de punta a punta contra `expected.json`, intento 3 y `undone` que no cuenta en `previousE`
- [ ] 4.4 Commit: test(settlement): deshacer un intento y reprocesar
- [ ] 4.5 Implementar `undo` (D4, D6) y la reapertura (D5), añadir `settlement_undone` a la invalidación y a su esquema, y añadir `processed → analyzed` y su guarda a `import-state.ts`; verificar con los tests de 4.1–4.3
- [ ] 4.6 Fijar con un test el riesgo aceptado: faltante cubierto también por otro batch vigente vuelve a `persistent` (design, Risks)
- [ ] 4.7 Escribir los tests de concurrencia con compuertas: `pay` y `undo` en los dos órdenes, dos `undo`, `undo` y `unpay`, `undo` y `process` del mismo número; y `settlement_busy` tras tres 1205, sin dejar nada
- [ ] 4.8 Commit: feat(settlement): deshacer un intento y reprocesar con el mismo número

## 5. OpenAPI, cliente y colección Bruno

- [ ] 5.1 Ejecutar `pnpm openapi:export` y `pnpm --filter @recon/frontend api:generate`; ampliar `app.test.ts` con las tres rutas; verificar `openapi:check`
- [ ] 5.2 Añadir `00-auth/Login as payments`, `as: payments` en `collection.bru` y `SEED_PAYMENTS_USER` en `.env.example`; la persona copia la variable a su `api-collection/.env`, que no se lee ni se versiona
- [ ] 5.3 Añadir a `10-smoke` los negativos `403` (`viewer`, `analyst` en `pay`/`unpay`, `payments` en `undo`), `404` y `400`, y verificar con `pnpm test:api:smoke`
- [ ] 5.4 Ampliar `20-flows/settlements/batch-clean` con el recorrido del escenario "Flujo de punta a punta"; a mano, sin reimportar. Lo ejecuta la persona con `! pnpm db:seed` y `! pnpm test:api`, con `pnpm dev` levantado
- [ ] 5.5 Commit: feat(api): pagar, retirar el pago y deshacer en OpenAPI y en la colección

## 6. Frontend: acciones y diálogo

- [ ] 6.1 Ampliar los fixtures y los handlers MSW (`test/msw/settlements.ts`) con `pay`, `unpay` y `undo`, y `contract.ts` con las llamadas, las fechas de auditoría y los `details`; verificar con `settlements.test.ts`
- [ ] 6.2 Escribir los tests de visibilidad por usuario y estado, de **Mark as paid** y del diálogo (sin motivo, 500 caracteres, cancelar, teclado, doble clic) y comprobar que fallan
- [ ] 6.3 Commit: test(web): acciones del intento según permiso y estado
- [ ] 6.4 Implementar `SettlementActions`, `ReasonDialog`, `useCanPay` y `useSettlementAction` (D9, D10), con los textos en `strings.ts`; verificar con los tests de 6.2 y `read-only.test.tsx`
- [ ] 6.5 Cubrir los errores de la spec (`409` de estado, `settlement_busy`, red) y el estado sin recargar (lista, movimientos, sin optimismo), con tests; actualizar el comentario de `settlementQuery`
- [ ] 6.6 Commit: feat(web): marcar como pagado, retirar el pago y deshacer desde el intento

## 7. Frontend: tras deshacer e intentos del import

- [ ] 7.1 Mostrar en `SummaryHeader` quién pagó o deshizo, cuándo y el motivo, y **Go to Analysis & Validations**; verificar con tests de los escenarios "Deshacer" y "Volver a Analysis", incluido el aviso `settlement_undone` en `InvalidatedReviewNotice`
- [ ] 7.2 Implementar `SummaryAttempts` sobre `GET /imports/{id}/settlements`, con su query invalidada tras cada acción; verificar con "Intentos tras reprocesar" y "Un solo intento"
- [ ] 7.3 Verificar con un test el escenario "Reprocesar con el mismo número" de Settlement Review
- [ ] 7.4 Crear `e2e/screenshots/settlement-lifecycle.ts` y el script `screenshots:settlement-lifecycle` (en `e2e/package.json` y en la raíz), siguiendo a `settlements-browse.ts`; verificar con `pnpm typecheck` (se ejecuta en 9.3)
- [ ] 7.5 Commit: feat(web): intento deshecho, vuelta a Analysis e historial de intentos

## 8. Documentación

- [ ] 8.1 README: §1.5 (quitar #78 y #79 de los recortes), §3.2 (`AuditLog` y detalle de las tres acciones), §4.4 (filas de pay, unpay y undo con cuerpo, respuesta y códigos) y §3.2 de reglas de intentos si cambia su redacción
- [ ] 8.2 `docs/adr/006-batches-como-intentos.md`: quitar la nota de "queda para la Entrega 3"; `CLAUDE.md`: usuario `payments` en "Colección de la API"; `docs/wireframes/README.md`: desvíos del prototipo (la acción de pago va en la cabecera del intento, sin pantalla Payments)
- [ ] 8.3 Marcar `settlement` en #21 tras comprobar `openspec validate settlement --type spec` con los deltas aplicados
- [ ] 8.4 Commit: docs(readme): ciclo de vida del intento y cierre de los recortes de pago y undo

## 9. Verificación integrada

- [ ] 9.1 `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde, anotando los conteos en este archivo
- [ ] 9.2 **Con turno de base de la persona**: `! pnpm db:seed` y `! pnpm --filter @recon/backend test:integration`, con `batch-clean` contra `expected.json`
- [ ] 9.3 **Con turno de base de la persona**: `! pnpm test:api` y `! pnpm screenshots:settlement-lifecycle`; recorrido a mano como `payments` y `analyst`: pagar, retirar, deshacer y reprocesar
- [ ] 9.4 Commit: test(settlement): verificación del ciclo de vida del intento

## Workflow follow-up

- `/opsx:verify` para contrastar implementación y artifacts.
- PR desde `feat/settlement-lifecycle` hacia `feature/entrega-3-MVP` (la base de la Entrega 3), con CI verde y `Closes #78`, `Closes #79`.
- `/opsx:archive` tras el merge.
