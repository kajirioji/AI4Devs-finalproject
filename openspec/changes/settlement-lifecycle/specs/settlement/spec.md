# Spec Delta

## ADDED Requirements

### Requirement: Transiciones del intento
Solo SHALL admitirse `pay`: `processed → paid`; `unpay`: `paid → processed`; `undo`: `processed → undone`. `undone` SHALL ser final. Cualquier otra combinación SHALL responder `409` sin escribir nada ni auditar.

#### Scenario: Tabla de transiciones
- **WHEN** se aplica cada acción a cada estado
- **THEN** `pay`: `processed` → `200 paid`, `paid` y `undone` → `409 settlement_not_processed`; `unpay`: `paid` → `200 processed`, `processed` y `undone` → `409 settlement_not_paid`; `undo`: `processed` → `200 undone`, `paid` → `409 settlement_payment_not_removed`, `undone` → `409 settlement_not_processed`
- **AND** cada `409` lleva `details.status` con el estado actual y un mensaje en inglés

### Requirement: Marcar como pagado
`POST /api/v1/settlements/{id}/pay` SHALL exigir `payment.process`, no llevar cuerpo, pasar el intento a `paid` con `paidAt` y `paidByUserId`, y auditar `settlement.pay` con el usuario, la fecha y `reason = null`, en una sola transacción. Responde `200` con la vista del intento.

#### Scenario: Pagar un intento procesado (HU3 CA7)
- **GIVEN** `batch-clean` procesado y un usuario `payments`
- **WHEN** lo marca como pagado
- **THEN** recibe `200` con `status = paid`, `settledStatus = settled`, `paidBy` y `paidAt`, y hay una fila `settlement.pay` en `AuditLog` con su usuario y con `batchNo` y `attemptNo` en el detalle
- **AND** sus movimientos E, I y R se leen con `settled = true` y el intento sale en `GET /accounts/{id}/settlements?status=paid`

#### Scenario: Pagar no cambia cifras ni movimientos
- **GIVEN** la vista y los movimientos de un intento `processed`
- **WHEN** se paga
- **THEN** totales, `amountPayable`, fees, movimientos, `settlementStatusId` y exports son los mismos, y solo cambian el estado y los campos de pago

### Requirement: Retirar la marca de pago
`POST /api/v1/settlements/{id}/unpay` SHALL exigir `payment.process` y `reason` (1–500 caracteres tras quitar espacios), devolver el intento a `processed` con `paidAt` y `paidByUserId` vacíos, y auditar `settlement.unpay` con el usuario, la fecha, el motivo y quién y cuándo había pagado. SHALL NOT revertir nada del Back-Office.

#### Scenario: Retirar el pago (HU3 CA7)
- **GIVEN** un intento `paid` por `payments` y un usuario con `payment.process`
- **WHEN** retira la marca con `reason = "Payment was rejected by the bank"`
- **THEN** recibe `200` con `status = processed`, `settledStatus = pending_payment` y `paidAt = null`, sus movimientos se leen con `settled = false`, y el detalle de `settlement.unpay` guarda el motivo, `previousPaidAt` y `previousPaidByUserId`

#### Scenario: Sin motivo
- **WHEN** se llama sin `reason`, con `reason` vacío o de solo espacios, o con más de 500 caracteres
- **THEN** responde `400 validation_error`, el intento sigue `paid` y no hay auditoría

#### Scenario: Pagar de nuevo tras retirar
- **GIVEN** un intento al que se le retiró el pago
- **WHEN** se marca otra vez como pagado
- **THEN** responde `200` con el usuario y la fecha nuevos, y `AuditLog` conserva las tres filas en orden

#### Scenario: Batch del seed
- **GIVEN** un batch sembrado `paid`, sin auditoría `settlement.process`
- **WHEN** `payments` retira su marca
- **THEN** responde `200`, `status = processed`, y su `validationSummary` sigue siendo `null`

### Requirement: Deshacer con motivo y conservación de datos
`POST /api/v1/settlements/{id}/undo` SHALL exigir `settlement.process` y `reason` (1–500 caracteres tras quitar espacios), y SHALL marcar el intento `undone` con `undoneAt`, `undoneByUserId` y `undoReason`, sin borrar ni cambiar movimientos, fees, totales ni exports. Responde `200` con la vista del intento.

#### Scenario: Deshacer un intento procesado (HU3 CA8)
- **GIVEN** `batch-clean` procesado como batch 123, intento 1
- **WHEN** `analyst` lo deshace con `reason = "Wrong settlement date"`
- **THEN** recibe `200` con `status = undone`, `settledStatus = undone`, `undoneBy`, `undoneAt` y `undoReason`
- **AND** los 450 movimientos E, 10 I y 320 R, los totales y el `amountPayable` siguen igual, y los tres exports responden `200` identificados por su intento

#### Scenario: Sin motivo
- **WHEN** se llama sin `reason`, con `reason` de solo espacios o con más de 500 caracteres
- **THEN** responde `400 validation_error` y nada cambia

#### Scenario: Un intento pagado no se deshace
- **GIVEN** un intento `paid`
- **WHEN** `analyst` lo deshace con un motivo
- **THEN** responde `409 settlement_payment_not_removed` con `details.status = "paid"` y un mensaje que dice que antes hay que retirar el pago; el intento sigue `paid` y el import `processed`

### Requirement: Efectos de deshacer
Deshacer SHALL, en una sola transacción con el cambio de estado: devolver el import a `analyzed` con `currentBatchId = null`; reabrir los faltantes que el intento resolvió; y auditar `settlement.undo` con el usuario, la fecha, el motivo, el import, el número, el intento, los faltantes reabiertos y la corrida superada. La cuenta principal de los canales SHALL NOT revertirse.

#### Scenario: Import, faltantes y auditoría
- **GIVEN** un intento `processed` que resolvió un faltante de otro import del proveedor
- **WHEN** se deshace
- **THEN** el import queda `analyzed` con `currentBatchId = null`, el faltante vuelve a `persistent` y hay una fila `settlement.undo` con el motivo, `importId`, `batchNo`, `attemptNo`, `reopenedMissingIssueIds` y `supersededRunId`

#### Scenario: La cuenta principal no se revierte
- **GIVEN** `batch-clean` procesado con `RAM-07` asignado a ProviderA-USD como principal
- **WHEN** se deshace
- **THEN** `RAM-07` sigue en ProviderA-USD como principal, con su `assignedInBatchId`, y no se escribe `account_channel.assign`

#### Scenario: Fallo a mitad
- **GIVEN** un undo que falla al reabrir los faltantes
- **WHEN** termina
- **THEN** el intento sigue `processed`, el import `processed` con su `currentBatchId`, la corrida vigente y sin auditoría `settlement.undo`

#### Scenario: Un intento deshecho no cuenta como anterior
- **GIVEN** un intento `undone`
- **WHEN** otro import del proveedor se valida con las mismas transacciones
- **THEN** no hay `duplicate_across_batches` ni `status_collision_across_batches` contra ese intento

#### Scenario: Intento procesado que no es el vigente
- **GIVEN** datos inconsistentes: un intento `processed` que no es el `currentBatchId` de su import
- **WHEN** se deshace
- **THEN** responde `409 settlement_not_current` y no escribe nada

### Requirement: Alcance y permisos de las acciones del intento
`pay`, `unpay` y `undo` SHALL responder `401 unauthorized` sin token, `403 forbidden` sin su permiso (antes de mirar el alcance), `400 validation_error` con un id que no es UUID, y el mismo `404 not_found` (`"Settlement not found"`) para un intento inexistente o de un merchant fuera del alcance.

#### Scenario: Sin permiso
- **WHEN** `viewer` llama a cualquiera de las tres, `analyst` a `pay` o `unpay`, o `payments` a `undo`
- **THEN** recibe `403` con `code = "forbidden"`, aunque el intento no exista

#### Scenario: Fuera del alcance
- **GIVEN** un usuario con el permiso y solo el merchant 1
- **WHEN** actúa sobre un batch de ProviderC-Alt (merchant 2)
- **THEN** recibe el mismo `404` que para un `batchId` inexistente

### Requirement: Concurrencia de las acciones del intento
Cada acción SHALL decidir su transición con una guarda dentro de su transacción, de modo que dos acciones solapadas sobre un intento dejen una sola transición y una sola auditoría. Un interbloqueo SHALL reintentarse como al procesar y, agotado, responder `409 settlement_busy` sin dejar nada.

#### Scenario: Dos pagos a la vez
- **GIVEN** dos `pay` del mismo intento, uno esperando dentro de su transacción mientras el otro confirma
- **WHEN** el primero continúa
- **THEN** responde `409 settlement_not_processed` con `details.status = "paid"` y hay una sola fila `settlement.pay`

#### Scenario: Pagar y deshacer a la vez
- **GIVEN** un `undo` esperando dentro de su transacción mientras un `pay` confirma
- **WHEN** el `undo` continúa
- **THEN** responde `409 settlement_payment_not_removed`, y el import sigue `processed`
- **AND** en el orden inverso, el `pay` responde `409 settlement_not_processed` con `details.status = "undone"`

#### Scenario: Deshacer mientras otro import toma el número
- **GIVEN** un `undo` del batch 118 sin confirmar y un proceso de otro import de la cuenta con `batchNo = 118` esperando el bloqueo del número
- **WHEN** el `undo` confirma
- **THEN** el proceso crea el intento 2 del batch 118, y el `undo` no ha dejado rastro en él

#### Scenario: Víctima de un interbloqueo
- **GIVEN** un `undo` que SQL Server elige como víctima tres veces seguidas
- **WHEN** termina
- **THEN** responde `409 settlement_busy` y el intento, el import, la corrida y los faltantes no han cambiado

### Requirement: Pantalla Settlement Summary: acciones según permiso y estado
La cabecera del intento, común a las pestañas **Summary** y **Movements**, SHALL ofrecer **Mark as paid** a quien tiene `payment.process` en un intento `processed`, **Unpay…** a quien tiene `payment.process` en uno `paid`, y **Undo batch…** a quien tiene `settlement.process` en uno `processed`. Quien no tiene el permiso de una acción SHALL NOT verla. Un intento `undone` SHALL NOT ofrecer ninguna.

#### Scenario: Por usuario
- **GIVEN** un intento `processed`
- **THEN** `payments` ve **Mark as paid** y no ve **Undo batch…**; `analyst` ve **Undo batch…** y no ve **Mark as paid**; `viewer` no ve ninguna; y `admin` ve las dos

#### Scenario: Intento pagado
- **GIVEN** un intento `paid`
- **THEN** `payments` ve **Unpay…**; `analyst` ve **Undo batch…** deshabilitado con `Remove the payment first.` asociado con `aria-describedby`, y no ve **Unpay…**; `viewer` no ve ninguna

#### Scenario: Intento deshecho
- **GIVEN** un intento `undone`
- **THEN** ningún usuario ve acciones, y las descargas siguen disponibles para quien tiene `reports.view`

### Requirement: Pantalla Settlement Summary: pagar
**Mark as paid** SHALL enviar un solo `POST pay` aunque se pulse dos veces, sin motivo ni diálogo, y SHALL pintar la respuesta sin otra lectura del intento. La cabecera SHALL mostrar quién pagó y cuándo, en hora de Nueva York.

#### Scenario: Marcar como pagado
- **GIVEN** `payments` en un intento `processed`
- **WHEN** pulsa **Mark as paid** dos veces seguidas
- **THEN** el API recibe un solo `POST pay`, ve `Paid` y `Paid by` `payments · <fecha y hora> ET`, desaparece `Movements are not Settled yet…` y aparece **Unpay…**

#### Scenario: Movimientos al día
- **GIVEN** la pestaña **Movements** ya visitada con `Pending payment`
- **WHEN** paga el intento y vuelve a **Movements**
- **THEN** se piden de nuevo y dicen `Settled`, sin recargar

### Requirement: Pantalla Settlement Summary: motivo y confirmación
**Unpay…** y **Undo batch…** SHALL abrir un diálogo con las consecuencias de la acción y un motivo obligatorio. Confirmar SHALL estar deshabilitado con su motivo hasta que haya texto, SHALL enviarse una sola vez y cancelar SHALL NOT llamar al API. El motivo SHALL enviarse sin espacios de los extremos.

#### Scenario: Retirar el pago
- **GIVEN** `payments` en un intento `paid`
- **WHEN** pulsa **Unpay…**, escribe un motivo y confirma
- **THEN** el API recibe `POST unpay` con ese `reason`, el diálogo se cierra, ve `Processed · pending payment` y **Mark as paid**
- **AND** el diálogo dice que la acción no revierte lo ejecutado en el Back-Office

#### Scenario: Sin motivo
- **WHEN** abre **Undo batch…** y deja el motivo vacío o con espacios
- **THEN** **Confirm** está deshabilitado con `Write a reason.` y no sale ninguna petición

#### Scenario: Motivo demasiado largo
- **WHEN** escribe más de 500 caracteres
- **THEN** ve `Use at most 500 characters.` y **Confirm** sigue deshabilitado

#### Scenario: Cancelar
- **WHEN** abre el diálogo, escribe un motivo y pulsa **Cancel**
- **THEN** no sale ninguna petición, el intento no cambia y al abrirlo de nuevo el motivo está vacío

#### Scenario: Con teclado
- **WHEN** recorre la acción con Tab, Enter y Espacio
- **THEN** abre el diálogo, escribe, confirma o cancela, y el foco vuelve a la cabecera al cerrarse

### Requirement: Pantalla Settlement Summary: tras deshacer
Con un intento `undone`, la pantalla SHALL mostrar quién lo deshizo, cuándo y por qué, y un enlace **Go to Analysis & Validations** al import. SHALL permanecer en el intento, sin redirigir. El aviso de revisión invalidada de Analysis SHALL explicar que el intento se deshizo.

#### Scenario: Deshacer (HU3 CA8)
- **GIVEN** `analyst` en un intento `processed`
- **WHEN** lo deshace con `reason = "Wrong settlement date"`
- **THEN** sigue en `/settlements/<batchId>`, ve `Undone`, `Undone by` `analyst · <fecha y hora> ET`, `Reason` `Wrong settlement date` y **Go to Analysis & Validations**

#### Scenario: Volver a Analysis
- **WHEN** pulsa **Go to Analysis & Validations**
- **THEN** llega al paso Analysis del import, con el import en `analyzed`, sin corrida vigente, con **Run validations** disponible y con un aviso de que la revisión se invalidó porque `the settlement attempt was undone`

#### Scenario: Reprocesar con el mismo número
- **GIVEN** el import de un intento 1 del batch 118 deshecho, validado y revisado de nuevo
- **WHEN** `analyst` abre Settlement Review
- **THEN** ve `Proposed: 118 · attempt 2 (the previous attempt of this import was undone)` y al procesar llega al Settlement Summary del intento 2

### Requirement: Pantalla Settlement Summary: errores de las acciones
Un `409` de estado SHALL mostrar su texto, cerrar el diálogo, releer el intento y dejar la pantalla en el estado real. `settlement_busy` y un fallo de red SHALL mantener el diálogo con el motivo escrito y permitir reintentar.

#### Scenario: Otro usuario ya pagó
- **WHEN** `analyst` confirma **Undo batch…** y el API responde `409 settlement_payment_not_removed`
- **THEN** ve `This batch was marked as paid. Remove the payment first.`, se relee el intento y **Undo batch…** queda deshabilitado

#### Scenario: Intento que cambió de estado
- **WHEN** una acción responde `409 settlement_not_processed` o `409 settlement_not_paid`
- **THEN** ve `This batch changed in the meantime (status: <status>).` y la pantalla muestra el estado releído

#### Scenario: Ocupado
- **WHEN** una acción con diálogo responde `409 settlement_busy`
- **THEN** ve `Another settlement is being processed for this provider. Try again.`, sigue en el diálogo con su motivo, y **Confirm** envía otra vez el mismo cuerpo

#### Scenario: Fallo de red
- **WHEN** una acción falla sin respuesta del API
- **THEN** ve `The action could not be completed. Try again.` y el intento no cambia en pantalla

### Requirement: Estado sin recargar
Tras cada acción, el intento SHALL pintarse con la respuesta del API, y SHALL marcarse como desactualizados la lista de la cuenta, los movimientos del intento, los intentos del import y, tras deshacer, el import, su corrida y el número propuesto. No SHALL haber actualización optimista.

#### Scenario: Lista de la cuenta
- **GIVEN** la lista de ProviderA-USD visitada, con el intento en `Processed · pending payment`
- **WHEN** `payments` lo paga desde su Settlement Summary y vuelve con **Settlements of ProviderA-USD**
- **THEN** la fila dice `Paid` sin recargar la página

#### Scenario: Sin adelantarse a la respuesta
- **GIVEN** un `POST undo` retenido
- **THEN** la cabecera sigue diciendo `Processed · pending payment` y la acción está deshabilitada con `Working…`

### Requirement: Pantalla Settlement Summary: intentos del import
La pantalla SHALL listar los intentos de su import con `GET /imports/{id}/settlements`, en el orden del API, cada uno con número, intento, estado, quién y cuándo lo procesó, `amountPayable` y un enlace, marcando el que se está viendo. Con un único intento SHALL NOT mostrarse la lista.

#### Scenario: Intentos tras reprocesar
- **GIVEN** un import con el intento 2 `processed` y el intento 1 `undone` del batch 118
- **WHEN** `analyst` abre cualquiera de los dos
- **THEN** ve `Attempts of this import` con los dos, el 2 primero, el `undone` atenuado y un enlace al otro

#### Scenario: Un solo intento
- **GIVEN** un import con un único intento
- **THEN** no ve `Attempts of this import`

## MODIFIED Requirements

### Requirement: Intentos de batch
Procesar SHALL crear un `SettlementBatch` con `batchNo` propuesto (último + 1, editable) y `attemptNo`; solo un intento vigente por (cuenta, batchNo) y por import. El `attemptNo` de un número SHALL ser el mayor intento de ese (cuenta, batchNo) en cualquier estado + 1, o 1 si no hay ninguno.

#### Scenario: Número de batch propuesto y editable
- GIVEN un import en `validated` de una cuenta cuyo último batch es el 117
- WHEN el analista abre Settlement Review
- THEN ve propuesto el batch 118 y puede cambiarlo antes de confirmar

#### Scenario: Número con intento vigente rechazado
- GIVEN la cuenta ya tiene un intento vigente del batch 118
- WHEN se procesa otro import con `batchNo = 118`
- THEN la API responde 409 con `code = "batch_no_taken"` y no se crea ningún intento

#### Scenario: Intento siguiente a uno deshecho
- GIVEN la cuenta tiene el batch 118 con un intento 1 `undone` y ningún intento vigente con ese número
- WHEN se procesa un import validado con `batchNo = 118`
- THEN se crea el intento 2 del batch 118 en `processed`

#### Scenario: El mismo número en dos imports de la cuenta a la vez
- GIVEN dos imports `validated` de la misma cuenta
- WHEN los dos se procesan con `batchNo = 118` y uno confirma mientras el otro espera dentro de su transacción
- THEN el que confirma crea el intento 1 del batch 118 y el otro responde `409 batch_no_taken`, sin dejar ningún dato suyo ni cambiar su import, que sigue `validated`

#### Scenario: Reprocesar propone el mismo número
- GIVEN un import cuyo intento 1 del batch 123 se acaba de deshacer
- WHEN se pide `GET /accounts/{id}/batch-number/next?importId=<ese import>`
- THEN recibe `{ batchNo: 123, attemptNo: 2, reason: "reprocess" }`, y sin `importId`, el siguiente número libre de la cuenta con `reason = "next"`

#### Scenario: El número deshecho lo tomó otro import
- GIVEN un import con el intento 1 del batch 123 `undone` y otro import de la cuenta con un intento vigente del 123
- WHEN se pide el número con el `importId` del primero
- THEN no se propone el 123: recibe el siguiente número libre con `reason = "next"`

#### Scenario: Dos intentos deshechos
- GIVEN un batch 123 con los intentos 1 y 2 `undone` del mismo import
- WHEN se procesa de nuevo
- THEN se crea el intento 3, y los tres se conservan

### Requirement: Deshacer un intento
Deshacer SHALL marcar el intento `undone`, devolver el import a `analyzed` y conservar todo; el siguiente intento incrementa `attemptNo`.

#### Scenario: Deshacer y reprocesar con el mismo número
- GIVEN el intento 1 del batch 118 en `processed`
- WHEN el analista lo deshace indicando el motivo
- THEN el intento pasa a `undone` conservando sus datos, autor y motivo, y el import vuelve a `analyzed`
- AND al validarlo y procesarlo de nuevo con `batchNo = 118` se acepta como intento 2

#### Scenario: Un batch pagado no se deshace
- GIVEN un batch en `paid`
- WHEN el analista intenta deshacerlo sin retirar antes la marca de pago
- THEN se rechaza con `409 settlement_payment_not_removed` y el batch sigue `paid`

#### Scenario: Pagado, retirado y deshecho
- GIVEN un batch `paid`
- WHEN `payments` retira la marca y después `analyst` lo deshace
- THEN las dos acciones responden `200` y el batch queda `undone`, con `paidAt` vacío y las auditorías `settlement.unpay` y `settlement.undo`

### Requirement: Settled solo al pagar
Un movimiento SHALL considerarse Settled únicamente cuando su batch está `paid`; marcar pagado y retirar la marca SHALL auditarse con usuario y fecha.

#### Scenario: Procesado no es Settled
- **WHEN** se procesa un batch
- **THEN** su estado es `processed` y ninguno de sus movimientos está Settled

#### Scenario: Marcar pagado
- **GIVEN** un batch `processed` y un usuario con `payment.process`
- **WHEN** marca el batch como pagado
- **THEN** el batch pasa a `paid`, sus movimientos E, I y R quedan Settled y la acción queda auditada con usuario y fecha

#### Scenario: Retirar la marca de pago
- **GIVEN** un batch `paid`
- **WHEN** un usuario con `payment.process` retira la marca
- **THEN** el batch vuelve a `processed`, sus movimientos dejan de estar Settled y la acción queda auditada con usuario y fecha

#### Scenario: Deshecho no es Settled
- **GIVEN** un batch `undone`
- **WHEN** se leen sus movimientos y su vista
- **THEN** los movimientos traen `settled = false` y la vista `settledStatus = undone`, aunque el batch hubiera estado `paid` antes

#### Scenario: Llegar a la fecha de la reserva no es Settled
- **GIVEN** un movimiento R de un batch `processed` cuyo `expectedReserveReleaseAt` ya pasó
- **WHEN** se leen sus movimientos
- **THEN** trae `settled = false`

#### Scenario: Descargar no es pagar
- **GIVEN** un batch `processed`
- **WHEN** se descargan sus tres exports
- **THEN** sigue `processed` y `settled = false` en todos sus movimientos

### Requirement: Lectura del intento
`GET /api/v1/settlements/{id}` SHALL responder `200` con la vista del intento, la misma forma que la respuesta `201` de procesar y que la `200` de `pay`, `unpay` y `undo`, construida a partir de lo escrito. También SHALL servir los intentos sin auditoría `settlement.process` (los del seed), con `validationSummary = null`, `skipped` en 0 y sin advertencias ni canales asociados. `settledStatus` SHALL derivarse del estado del intento: `processed` → `pending_payment`, `paid` → `settled`, `undone` → `undone`. La vista SHALL traer `paidAt`, `paidBy`, `undoneAt`, `undoneBy` y `undoReason`, `null` cuando no aplican.

#### Scenario: Recargar el intento recién procesado
- GIVEN `batch-clean` procesado, con la respuesta `201` guardada
- WHEN `analyst` pide `GET /settlements/{batchId}`
- THEN recibe `200` con un cuerpo igual a la respuesta `201`, salvo el orden de las claves

#### Scenario: Batch del seed
- GIVEN un batch sembrado `paid` de ProviderA-USD
- WHEN `analyst` lo pide
- THEN recibe `200` con `status = paid`, `settledStatus = settled`, `paidBy.userName = payments` y `validationSummary = null`, y el desglose del payable suma su `amountPayable`

#### Scenario: Cuenta anterior de otro merchant
- GIVEN `batch-clean` procesado (merchant 1) con un canal cuya cuenta primaria anterior era de un merchant 2
- WHEN `analyst` (merchants 1 y 2) y `viewer` (solo merchant 1) piden `GET /settlements/{batchId}`
- THEN `analyst` ve esa cuenta en `channelsAssigned[].previousAccount` y `viewer` recibe `{ accountId: null, name: null, outOfScope: true }`, como en la respuesta de procesar

#### Scenario: Intento deshecho
- GIVEN un intento deshecho por `analyst` con un motivo
- WHEN `viewer` lo pide dentro de su alcance
- THEN recibe `200` con `status = undone`, `undoneBy.userName = analyst`, `undoneAt`, `undoReason` y el `validationSummary` de su corrida superada

### Requirement: Pantalla Settlement Summary: solo lectura
`viewer` SHALL poder abrir Settlement Summary de un intento de su alcance y verlo entero, sin acciones que escriban.

#### Scenario: viewer
- **WHEN** `viewer` abre el Settlement Summary del intento de `batch-clean`
- **THEN** ve el intento, los totales, el desglose, los fees y las descargas que su permiso admite, y ningún botón de pagar, retirar el pago ni deshacer

### Requirement: Pantalla Settlement List: solo lectura
`viewer` SHALL poder usar la lista y las dos pestañas del Settlement Summary de las cuentas de su alcance. La lista SHALL NOT ofrecer pagar, retirar el pago, deshacer ni exportar para ningún usuario, y `viewer` SHALL NOT hacer peticiones de escritura desde estas pantallas.

#### Scenario: viewer recorre la lista y los movimientos
- **WHEN** `viewer` abre la lista de ProviderA-USD, abre el batch 122 y su pestaña **Movements**
- **THEN** ve lo mismo que `analyst` salvo las acciones del intento, sin botones de pagar, retirar el pago, deshacer ni exportar la lista, y no sale ninguna petición que no sea `GET`

#### Scenario: Las acciones no están en la lista
- **WHEN** `payments` o `analyst` abren la lista de ProviderA-USD
- **THEN** ninguna fila ofrece pagar, retirar el pago ni deshacer: se hace desde el intento
