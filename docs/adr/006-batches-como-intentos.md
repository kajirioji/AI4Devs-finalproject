# ADR-006 · Batches como intentos conservados (`attemptNo`)

- **Estado:** Aceptado (propuesto en la Entrega 1; confirmado en la Entrega 2)
- **Decisores:** autor del proyecto

## Contexto

Hoy, reprocesar un batch lo borra y lo recrea: se pierde qué se procesó antes, quién lo hizo y por qué se deshizo.

## Opciones consideradas

1. Borrar y recrear el batch, como el sistema actual.
2. Conservar cada procesamiento como un intento (`SettlementBatch.attemptNo`) con estado `processed` → `paid`, o `undone`.

## Decisión

Opción 2. Deshacer marca el intento `undone`, con autor y motivo, y permite un intento nuevo con el mismo número oficial.

## Consecuencias

- La trazabilidad del reprocesamiento es completa; un intento `undone` no cuenta en totales vigentes ni en Settled.
- Hacen falta índices únicos filtrados para que solo haya un intento vigente por número y cuenta, y por import.

## En la Entrega 2

- En `0002_constraints`:
  - `UNIQUE (accountId, batchNo, attemptNo)`;
  - `CK_SettlementBatch_attemptNo` (> 0);
  - `UX_SettlementBatch_active_accountBatchNo` y `UX_SettlementBatch_active_import` con `WHERE status <> 'undone'`.
- El número del intento siguiente se calcula en `settlement/domain/batch-number.ts`.
- Deshacer (`POST /settlements/{id}/undo`) marca el intento `undone`, devuelve el import a `analyzed` y supera su corrida vigente; procesar de nuevo toma el intento siguiente (change `settlement-lifecycle`, #79).
