# Design

## Context

Motivación y alcance en `proposal.md`; comportamiento en los delta specs. Lo que condiciona el diseño, comprobado en el código:

- **Sin migración.** `SettlementBatch` ya tiene `paidAt`, `paidByUserId`, `undoneAt`, `undoneByUserId` y `undoReason` (`NVARCHAR(500)`). `CK_SettlementBatch_paidFields` solo exige los campos de pago si el estado es `paid`, así que retirar el pago puede vaciarlos. `AuditLog.detailJson` guarda el motivo de `unpay`, que no tiene columna. Los índices filtrados por `status <> 'undone'` ya admiten el intento siguiente.
- **Reprocesar ya funciona.** `proposeBatchNumber` devuelve `reason: "reprocess"` y `attemptFor` calcula `attemptNo + 1`. `previousE`, los faltantes registrados y los duplicados *across* ya excluyen `undone`.
- `reopenForBatch` existe, pero nadie lo llama y **no filtra por corrida vigente**, en contra de la spec `validation` ("afectar solo a hallazgos de corridas vigentes"). Este change lo corrige (D5).
- `settledStatusOf` está duplicado: en `domain/settled.ts` y en `prisma-settlement-reader.ts:21`. `settlementQuery` tiene `staleTime: Infinity` porque "no action changes it yet": hay que tratar la caché (D10).
- `SettlementView` no expone datos de pago ni de deshacer. `lastInvalidatedReview.reason` solo conoce `rerun` e inclusión.
- El seed crea sus batches con import `processed` y `currentBatchId`, sin filas de import. La colección de Bruno solo tiene `analyst` y `viewer`; ninguno tiene `payment.process`.
- `Settlement Detail` del prototipo es hoy una sola pantalla: `/settlements/$batchId`, con pestañas Summary y Movements. Las acciones van en su cabecera común.

## Goals / Non-Goals

**Goals:** una tabla de transiciones pura como única fuente de la regla; cada acción, atómica y con guarda, con el mismo orden de bloqueos que procesar; tests de concurrencia deterministas.

**Non-Goals:** escribir `settlementStatusId` (Settled siempre se deriva); recalcular hallazgos de otros imports (D6); cambiar el formato de los exports. Los exports del intento no dicen si está pagado: lo que contienen se escribió al procesar.

## Decisions

### D1. Estructura

```
packages/shared/src/settlement.ts     ReasonRequest; SettlementView with payment and undo fields
modules/settlement/
  domain/batch-lifecycle.ts           transitionOf(status, action): the table, pure
  domain/settled.ts                   settledStatusOf, now the only copy (the reader imports it)
  application/errors.ts               the four new 409
  application/settlement-lifecycle-service.ts   pay, unpay, undo: permission already checked, scope, repository, view
  infrastructure/prisma-settlement-lifecycle-repository.ts   guarded transactions
  infrastructure/deadlock-retry.ts    isDeadlockVictim and the retry, moved out of the process repository
  http/settlement-lifecycle-routes.ts the three POST
modules/validation/infrastructure/prisma-missing-resolution.ts   reopenForBatch filtered and returning ids
frontend/src/features/settlements/
  SettlementActions.tsx               the buttons by permission and status
  ReasonDialog.tsx                    AlertDialog with a required reason (as CancelImportDialog)
  lifecycle-mutations.ts              useSettlementAction: guard, answer in the cache, invalidation, errors
  SummaryAttempts.tsx                 Attempts of this import
```

*Alternativa descartada*: ampliar `PrismaSettlementRepository` y `SettlementService`. El repositorio de procesar ya pasa de 550 líneas y comparte con estas acciones solo el reintento, que se extrae.

### D2. Transiciones como función pura

```ts
type LifecycleAction = 'pay' | 'unpay' | 'undo'
type Transition = { ok: true; to: BatchStatus } | { ok: false; error: 'not_processed' | 'not_paid' | 'payment_not_removed' }
function transitionOf(status: BatchStatus, action: LifecycleAction): Transition
```

Test de tabla con las nueve combinaciones. Rotura prevista: permitir `undo` desde `paid` hace fallar su fila. El servicio la usa para responder rápido; **la que cuenta es la guarda**: el repositorio arma el `WHERE status = @from` con el origen de esa misma tabla y, con 0 filas, relee el estado y pasa por `transitionOf` para elegir el error.

### D3. `pay` y `unpay`: una guarda sobre `SettlementBatch`

`UPDATE … OUTPUT … WHERE batchId = @id AND status = @from`, y la auditoría en la misma transacción. No tocan `Import`: su estado no cambia. `unpay` lee con `OUTPUT deleted.paidAt, deleted.paidByUserId` lo que va a la auditoría (`previousPaidAt`, `previousPaidByUserId`). `SettlementBatch` no tiene triggers, así que `OUTPUT` sin `INTO` es válido, como en la guarda de `Import`.

- **`pay` sin cuerpo.** El brief pide auditar "usuario, fecha y motivo" en las dos, pero solo `unpay` lo exige, y la convención del prototipo pide motivo en las acciones irreversibles. La auditoría de `pay` lleva `reason: null`, con la misma forma. Es decisión a confirmar en el gate.
- **`unpay` vacía `paidAt` y `paidByUserId`.** El pago anterior queda en la auditoría. *Descartado*: conservarlos, porque un `processed` con fecha de pago haría mentir a cualquier lectura que mire esas columnas.

### D4. `undo`: orden de bloqueos y pasos

Mismo orden que procesar (D7 de `settlement-process`): `Import` → `SettlementBatch` → resto. El `importId` se lee antes de la transacción, tras el alcance: no cambia nunca.

1. `beforeClaim?.('undo')`.
2. Guarda: `UPDATE [Import] SET status = 'analyzed', currentBatchId = NULL … WHERE importId = @i AND status = 'processed' AND currentBatchId = @batchId`.
3. Guarda: `UPDATE [SettlementBatch] SET status = 'undone', undoneAt, undoneByUserId, undoReason … WHERE batchId = @batchId AND status = 'processed'`.
4. Con 0 filas en 2 o 3: se relee el estado del intento y `transitionOf` elige el error. Si el intento sigue `processed` (el paso 2 falló con un intento vigente roto), `409 settlement_not_current`.
5. `reopenForBatch` (D5), **antes** de superar la corrida, para que los hallazgos de la propia corrida cuenten como vigentes.
6. Superar la corrida vigente del import (D6).
7. Auditoría `settlement.undo`.

Un `pay` solapado solo bloquea `SettlementBatch` y no pide nada más, así que no hay ciclo con `undo`. Con `undo` y `process` de otro import, el `lockNumber` del segundo (`UPDLOCK, HOLDLOCK`) espera al commit y entonces ve `undone`: toma el intento siguiente (escenario de la spec).

`reopenForBatch` y `resolveForBatch` tocan `ValidationIssue` de varios imports en órdenes distintos, así que un 1205 es posible (#67). `withDeadlockRetry` envuelve las tres acciones: 3 intentos, pausa de 50–100 ms y `409 settlement_busy`.

*Alternativa descartada*: bloquear primero `SettlementBatch`. Invierte el orden de `process` y crea el interbloqueo que se quiere evitar.

### D5. Reapertura: filtrada y con evidencia

`reopenForBatch` añade `JOIN ValidationResult ⋈ ValidationRun (isSuperseded = 0)`, como `resolveForBatch` y como dice la spec, y devuelve los `issueId` con `OUTPUT inserted.issueId` en lugar de un número (el puerto cambia a `Promise<number[]>`; hoy solo lo usan los tests). Vaciar `resolvedInBatchId` y `resolvedAt` es el contrato vigente de la spec, así que **la evidencia que se conserva** es el hallazgo con su detalle y sus apariciones, más los ids y el `batchId` en la auditoría.

### D6. Undo supera la corrida sin sustituta

README: "el import vuelve a `analyzed`, se valida de nuevo". El caso equivale a resolver una fila ambigua (P7 de `validation-runs`): `UPDATE ValidationRun SET isSuperseded = 1 OUTPUT … WHERE importId = @i AND isSuperseded = 0`. Si la corrida tenía revisión válida, se escribe `import.review.invalidate` con `reason: 'settlement_undone'`, y `InvalidatedReviewNotice` gana ese texto.

- *Descartado*: solo invalidar la revisión y dejar la corrida. Permitiría revisar otra vez una corrida calculada contra un histórico que pudo cambiar, sin volver a validar.
- *Descartado*: crear aquí la corrida nueva. Alarga la transacción y deja al analista sin decidir cuándo.
- La corrida superada sigue siendo la fuente del `validationSummary` del intento `undone`: el lector filtra por `runId`, no por vigencia.
- `ValidationIssue.detectedInBatchId` no se toca: es evidencia del intento.

### D7. Códigos de error

| Código | Cuándo | `details` |
|---|---|---|
| `settlement_not_processed` | `pay` desde `paid` o `undone`; `undo` desde `undone` | `{ status }` |
| `settlement_not_paid` | `unpay` desde `processed` o `undone` | `{ status }` |
| `settlement_payment_not_removed` | `undo` desde `paid` | `{ status: 'paid' }` |
| `settlement_not_current` | `undo` de un `processed` que no es el vigente de su import (defensivo) | `{ importStatus, currentBatchId }` |

### D8. Contrato

`ReasonRequest = { reason: z.string().trim().min(1).max(500) }`. Respuesta: `200 SettlementView`. `SettlementView` gana `paidAt`, `paidBy`, `undoneAt`, `undoneBy` y `undoReason`, todos nullable; `paidAt` y `undoneAt` son instantes de auditoría y entran en `AuditKey` de `contract.ts`.

La respuesta se lee de lo escrito con el `SettlementReader` de siempre, fuera de la transacción, igual que `process`.

*Descartado*: un objeto anidado `payment`/`undo`. Las columnas ya son planas, y el resto de la vista también.

### D9. Permisos en la pantalla

La visibilidad sigue la petición de esta entrega, que es posterior y más concreta que #78: quien no tiene el permiso **no ve** la acción; #78 decía "deshabilitados con el motivo". La excepción es **Undo batch…** en un `paid` para `analyst`: tiene el permiso, le falta un paso, y sale deshabilitado con `Remove the payment first.` Sin eso no sabría por qué desaparece. `useCanPay` va junto a `useCanProcess`.

### D10. Caché y navegación

`useSettlementAction` sigue a `useProcessSettlement`: guarda síncrona contra el doble clic y sin actualización optimista. Con el `200`: `setQueryData(settlementKey)` e invalidación de `accountSettlementsPrefix`, de los movimientos del intento y de los intentos del import; con `undo`, además `importKey`, `validationRunKey` y el número propuesto. Con `409` de estado: invalidar el intento y mostrar el texto. El comentario de `settlementQuery` se actualiza; `staleTime` se queda, porque cada cambio pasa por estas mutaciones o por la relectura tras un `409`.

Tras **Undo** no se navega: el analista ve el resultado y el enlace. *Descartado*: redirigir a Analysis, porque oculta el motivo recién registrado y la petición pide "ofrecer" volver.

### D11. Tests

- **Dominio, TDD**: `batch-lifecycle.test.ts`, con rotura deliberada.
- **Servicio** con dobles: orden permiso → alcance → transición.
- **Integración**, `settlement-lifecycle.int.test.ts`: `batch-clean` real; movimientos y totales iguales antes y después; `settled` en `GET transactions`; `RAM-07` intacto; faltantes (otro import, corrida superada, a mano); fallo a mitad con `beforePhase`; intento 2 de punta a punta; undo sobre un batch del seed.
- **Concurrencia**, `settlement-lifecycle-concurrency.int.test.ts`, con compuertas (`beforeClaim`, nunca `Promise.all` sin compuerta; se abren en un `finally`): dos `pay`; `pay` y `undo` en los dos órdenes; dos `undo`; `undo` y `unpay`; `undo` y `process` del mismo número. Quitar `AND status = @from` de la guarda debe hacer fallar los dos primeros casos. 1205 con el mismo interbloqueo provocado o un error inyectado de la forma observada (D7 de `settlement-process`).
- **Frontend**: Vitest + MSW por usuario y estado; `read-only.test.tsx` y `SettlementSummary.test.tsx` siguen en verde.
- **E2E/UAT**: capturas con `pnpm screenshots:settlement-lifecycle` (patrón de los changes anteriores), en un turno de base de la persona.

## Risks / Trade-offs

- [Un faltante resuelto por A, también presente en un batch vigente B, vuelve a `persistent` al deshacer A, aunque B lo cubra] → Se acepta: HU2 CA9 dice "vuelve a `persistent`", y en la corrida vigente del import A solo se corrige al validar de nuevo. Queda documentado con un test que fija el comportamiento. Si importa, se abre un issue propio.
- [Otro import ya `validated` puede tener apariciones excluidas por un duplicado *across* contra el intento deshecho] → Su revisión no se invalida: el README limita el recálculo a las "incidencias afectadas" sin más detalle, y tocar imports ajenos sorprendería a su analista. Una corrida nueva lo corrige. Mismo riesgo que `validation` acepta con el histórico (D6 de `settlement-process`).
- [Deshacer un batch del seed deja un import `analyzed` sin filas] → Es un dato de demostración; la acción es correcta y se cubre con un test. Validarlo no da nada que procesar.
- [`viewer` no recibe explicación de por qué no hay acciones] → Es lo pedido.
- [`pay` sin confirmación: un clic erróneo deja el intento Settled] → Se revierte con **Unpay…** y queda auditado. Es decisión para el gate.

## Migration Plan

Sin migración ni seed nuevos. Rollback: revertir los commits; los intentos `paid` o `undone` escritos siguen siendo válidos para el esquema y para las lecturas actuales.

## Open Questions

Ninguna bloqueante. Las decisiones a confirmar en el gate van en el resumen del change: `pay` sin motivo (D3), superar la corrida (D6) y la excepción de Undo deshabilitado (D9).
