# Proposal — settlement-lifecycle

Issues: #78 (marcar como pagado y retirar el pago) y #79 (deshacer un intento y reprocesar), juntos porque operan sobre el mismo recurso y sus reglas se cruzan. Completa además la parte de `settlement` de #21. Se apoya en `settlement-process` (guardas de concurrencia D7, reintento ante 1205, `409 settlement_busy`, `MissingResolution`), `summary-exports` (lector del intento), `web-settlement` y `settlements-browse` (pantallas).

## Why

Un intento procesado se queda para siempre en `processed`: nada de lo procesado en la aplicación llega a Settled, y un batch mal procesado no se puede corregir. Son los dos recortes de la Entrega 2 (README §1.5) que cierran HU3 (criterios 7 y 8) y HU2 (criterio 9).

## What Changes

**Backend**

- `POST /settlements/{id}/pay` (`payment.process`, sin cuerpo): `processed → paid`. Los movimientos E/I/R quedan Settled por derivación, sin escribir en ellos; las lecturas actuales (`settled`, `settledStatus`, filtro `status=paid`) ya los devuelven.
- `POST /settlements/{id}/unpay` (`payment.process`, `reason` obligatorio): `paid → processed`, sin revertir nada del Back-Office.
- `POST /settlements/{id}/undo` (`settlement.process`, `reason` obligatorio): `processed → undone` conservando todo. En la misma transacción: el import vuelve a `analyzed` sin `currentBatchId`, su corrida vigente queda superada sin sustituta, los faltantes `resolved` por este intento vuelven a `persistent` y la cuenta principal del canal no se toca.
- Códigos `409` nuevos: `settlement_not_processed`, `settlement_not_paid`, `settlement_payment_not_removed` (un `paid` no se deshace sin retirar antes el pago) y `settlement_not_current` (defensivo). Se reutiliza `settlement_busy`.
- Las tres acciones responden `200` con `SettlementView`, que gana `paidAt`, `paidBy`, `undoneAt`, `undoneBy` y `undoReason`. El cambio es aditivo.
- Auditoría `settlement.pay`, `settlement.unpay` y `settlement.undo`, dentro de la transacción. El motivo de `unpay` vive solo en `AuditLog`.
- Transiciones en el dominio como función pura, con tests. Guardas, orden de bloqueos y reintento ante 1205 compartidos con procesar.
- Reprocesar no requiere código nuevo: `batch-number/next` y `attemptNo + 1` ya funcionan, y este change lo cubre de punta a punta.
- OpenAPI, cliente generado y colección Bruno, con un usuario `payments` nuevo en la colección.
- **Sin migraciones.** Las columnas, los índices filtrados y las `CHECK` ya existen.

**Frontend**

- Acciones en la cabecera de la pantalla del intento (Settlement Summary y sus pestañas): **Mark as paid**, **Unpay…** y **Undo batch…**, según permiso y estado. Unpay y Undo piden motivo con confirmación.
- Tras Undo, la pantalla muestra el intento `undone` con su motivo y un enlace a Analysis & Validations del import.
- El estado nuevo se ve sin recargar en el intento, en sus movimientos y en la lista de la cuenta.
- Historial de intentos del import en el Settlement Summary (alcance de #79, con `GET /imports/{id}/settlements`, que ya existe).

**Documentación**

- README: §1.5 (quitar los dos recortes), §3.2 (`AuditLog`), §4.4 (filas de pay, unpay y undo con sus códigos), ADR-006 y `CLAUDE.md` (usuario `payments` de la colección).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `settlement`: nuevos requisitos de pagar, retirar el pago y deshacer, y sus pantallas; `MODIFIED` de "Intentos de batch", "Deshacer un intento", "Settled solo al pagar", "Lectura del intento" y los dos de solo lectura.
- `import`: la máquina de estados gana `processed → analyzed` al deshacer.
- `validation`: deshacer supera la corrida vigente del import sin sustituta y reabre solo faltantes de corridas vigentes.
- `api-collection`: tercer usuario, `payments`, para los casos felices de pago.

## Fuera de alcance

Pagos parciales y un pago aplicado a varios batches (README HU3); #62 (reserva ante chargeback); #65; la pantalla **Payments** y `GET /providers/{id}/pending-payments` (el pago se registra desde el intento, y `payments` llega por Settlement List filtrando `processed`); revertir nada del Back-Office.

## Impact

- `backend/src/modules/settlement/` (dominio, servicio, repositorio, rutas, lector), `validation/infrastructure/prisma-missing-resolution.ts`, `imports/domain/import-state.ts`.
- `packages/shared/src/settlement.ts`, `docs/openapi.yaml`, `frontend/src/lib/api/schema.gen.ts`.
- `frontend/src/features/settlements/` y el aviso de revisión invalidada de `validations/`.
- `api-collection/`, `README.md`, `CLAUDE.md`, `docs/adr/006-batches-como-intentos.md`.
- Dependencia de orden: el grupo de `undo` exige `pay`, porque una regla de `undo` es el rechazo de un `paid`.
