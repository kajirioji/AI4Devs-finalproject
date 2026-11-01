# Spec Delta

## ADDED Requirements

### Requirement: Deshacer invalida la corrida del import
Deshacer un intento SHALL superar, en su misma transacción, la corrida vigente del import sin crear otra, y SHALL registrar la invalidación de su revisión con el motivo `settlement_undone`. Para procesar de nuevo SHALL hacer falta otra corrida y otra revisión. Las corridas de otros imports SHALL NOT cambiar, salvo por la reapertura de sus faltantes.

#### Scenario: Validar de nuevo tras deshacer
- **GIVEN** un import cuyo intento se acaba de deshacer
- **WHEN** `analyst` pide `GET /imports/{id}/validations`
- **THEN** recibe `run = null` y `lastInvalidatedReview` con `reason = "settlement_undone"`
- **AND** `POST review` responde `409 validation_run_required` hasta que una corrida nueva exista

#### Scenario: La corrida superada se conserva
- **GIVEN** el mismo import
- **WHEN** se leen los hallazgos de la corrida del intento deshecho a través de su `validationSummary`
- **THEN** la corrida sigue existiendo con `isSuperseded = 1`, y el `validationSummary` del intento `undone` da las mismas cifras que antes de deshacer

#### Scenario: La corrida nueva vuelve a sacar los faltantes
- **GIVEN** un import cuyo único batch está `undone` y que había registrado un faltante
- **WHEN** se ejecutan de nuevo las validaciones
- **THEN** el faltante vuelve a salir en la corrida nueva, porque el intento deshecho no cuenta como registrado ni como anterior

### Requirement: Reapertura de faltantes con evidencia
Los faltantes `resolved` por el intento deshecho SHALL volver a `persistent` conservando transacción, ciclo, fecha relevante, detalle y apariciones. La auditoría `settlement.undo` SHALL guardar sus identificadores, porque `resolvedInBatchId` y `resolvedAt` se vacían. Un hallazgo de una corrida superada, o resuelto a mano, SHALL NOT cambiar.

#### Scenario: Faltante de otro import reabierto
- **GIVEN** un faltante en la corrida vigente del import A, resuelto por el batch B de otro import
- **WHEN** se deshace B
- **THEN** el hallazgo vuelve a `persistent`, con `resolvedInBatchId` y `resolvedAt` vacíos y con su detalle y sus apariciones intactos
- **AND** el detalle de `settlement.undo` lleva su `issueId` en `reopenedMissingIssueIds`

#### Scenario: Hallazgo de una corrida superada
- **GIVEN** un faltante resuelto por B en una corrida del import A que después se superó
- **WHEN** se deshace B
- **THEN** ese hallazgo sigue `resolved` con `resolvedInBatchId = B`, como evidencia de aquella corrida

#### Scenario: Resuelto a mano
- **GIVEN** un hallazgo con `resolvedByUserId` no nulo
- **WHEN** se deshace cualquier batch
- **THEN** el hallazgo no cambia

#### Scenario: Retirar el pago no reabre
- **GIVEN** un faltante resuelto por un batch `paid`
- **WHEN** se retira el pago
- **THEN** el hallazgo sigue `resolved` con ese batch
