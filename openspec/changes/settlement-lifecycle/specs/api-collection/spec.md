# Spec Delta

## ADDED Requirements

### Requirement: Usuario de pagos
La colección SHALL obtener un token `paymentsToken` con login como `SEED_PAYMENTS_USER` (`payments`) solo cuando una petición declare `as: payments`, y SHALL usarlo en los casos felices de `pay` y `unpay` y en el negativo `403` de `undo`, porque `analyst` no tiene `payment.process` y `payments` no tiene `settlement.process`.

#### Scenario: Token de payments bajo demanda
- **GIVEN** una ejecución que no ha usado `paymentsToken`
- **WHEN** corre una petición con `as: payments`
- **THEN** la colección hace login como `payments`, la petición sale con `Bearer {{paymentsToken}}` y las peticiones siguientes con la auth heredada siguen saliendo como `analyst`

#### Scenario: Credenciales de ejemplo
- **WHEN** se lee `api-collection/.env.example`
- **THEN** declara `SEED_PAYMENTS_USER=payments` y ningún secreto real

### Requirement: Ciclo de vida del intento en la colección
`pay`, `unpay` y `undo` SHALL tener un caso feliz y negativos `403`, `404`, `400` (motivo, donde aplica) y `409` por estado incorrecto, y el flujo `batch-clean` SHALL recorrer pagar, retirar el pago, deshacer y reprocesar con el mismo número.

#### Scenario: Flujo de punta a punta
- **GIVEN** el flujo `batch-clean` con su intento 1 del batch 123 `processed`
- **WHEN** corre hasta el final
- **THEN** `pay` da `200 paid`; `undo` da `409 settlement_payment_not_removed`; `unpay` sin motivo da `400 validation_error` y con motivo `200 processed`; `undo` da `200 undone`; repetirlo da `409 settlement_not_processed`; `batch-number/next` da `{ batchNo: 123, attemptNo: 2, reason: "reprocess" }`; y validar, revisar y procesar crean el intento 2

#### Scenario: Negativos de permiso
- **WHEN** `viewer` llama a `pay`, `unpay` o `undo`, `analyst` a `pay` o `unpay`, o `payments` a `undo`
- **THEN** cada una responde `403` con `code = "forbidden"`, antes de mirar el alcance
