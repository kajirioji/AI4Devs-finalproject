# Spec Delta

## MODIFIED Requirements

### Requirement: Máquina de estados del import
SHALL admitirse solo estas transiciones: `uploaded → mapped` y `mapped → mapped` (confirmar pareo); `mapped → analyzed` (analizar); `analyzed → validated` (decisión de conjunto, `POST review`); `validated → analyzed` (validar de nuevo o cambiar una inclusión, que invalidan la revisión, P1 y P4); `validated → processed` (procesar el batch, `POST settlements`); `processed → analyzed` (deshacer su intento vigente, `POST settlements/{id}/undo`); `uploaded`, `mapped`, `analyzed` o `validated → cancelled` (cancelar).

#### Scenario: Revisar pasa a validated
- **GIVEN** un import en `analyzed` con una corrida vigente sin bloqueantes
- **WHEN** `analyst` llama a `POST /api/v1/imports/{id}/review` con ese `runId`
- **THEN** el import pasa a `validated` y un segundo `POST review` responde `409 import_not_analyzed` con `details.status = "validated"`

#### Scenario: Volver a analyzed
- **GIVEN** un import `validated`
- **WHEN** `analyst` llama a `POST validations`, o cambia una inclusión con `PATCH conflict-occurrence`
- **THEN** el import vuelve a `analyzed` y su revisión queda invalidada

#### Scenario: Procesar pasa a processed
- **GIVEN** un import `validated` con su revisión vigente
- **WHEN** `analyst` llama a `POST /api/v1/imports/{id}/settlements` con el `runId` revisado
- **THEN** el import pasa a `processed` con `currentBatchId` del intento creado, y mientras siga ahí no admite validar, cambiar inclusiones ni cancelar

#### Scenario: Deshacer devuelve a analyzed
- **GIVEN** un import `processed` cuyo intento vigente está `processed`
- **WHEN** `analyst` lo deshace con un motivo
- **THEN** el import pasa a `analyzed` con `currentBatchId = null`, y vuelve a admitir validar, cambiar inclusiones y cancelar

#### Scenario: Tabla de transiciones
- **WHEN** se aplica cada acción a cada estado
- **THEN** `PUT mapping`: `uploaded`/`mapped` → `200 mapped`, resto `409 import_not_editable`; `POST analyze`: `mapped` → `200 analyzed` (o `422`), resto `409 import_not_mapped`; `POST/DELETE files`: `uploaded`/`mapped` → `200`, resto `409 import_not_editable`; `PATCH row`: `analyzed` → `200`, resto `409 import_not_editable`; `POST validations`: `analyzed` → `201`, `validated` → `201 analyzed`, resto `409 import_not_analyzed`; `POST review`: `analyzed` → `200 validated` (o `409` por la corrida), resto `409 import_not_analyzed`; `PATCH conflict-occurrence`: `analyzed` → `200`, `validated` → `200 analyzed`, resto `409 import_not_editable`; `POST settlements` y `POST settlements/preview`: `validated` → `201 processed` / `200` (o `409` por la corrida, el número o los canales), resto `409 import_not_validated`; `POST cancel`: `uploaded`/`mapped`/`analyzed`/`validated` → `200 cancelled`, `processed`/`cancelled` → `409 import_not_cancellable`; `GET rows` y `GET validations`: siempre `200`
