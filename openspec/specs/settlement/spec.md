# settlement

## Purpose
Procesar un import validado como intento de batch, calcular movimientos por ciclo, fees, reservas y summary, exportar y registrar el pago. README §3.2 (SettlementBatch, SettlementTransaction, SettlementBatchFee), §4.3, HU3, doc 04 (export Back-Office).

## Requirements

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

### Requirement: Movimientos por ciclo
Cada fila incluida SHALL producir una `SettlementTransaction` con su `cycle`, estado al procesarse, importe USD del gateway, fees aplicados por fecha de evento y, en E, reserva retenida según `appliedReservePct`; en R, reserva liberada referenciando la misma transacción. Un movimiento SHALL corresponder a una fila de origen: único por (`batchId`, `sheetId`, `rowNo`), de modo que dos filas incluidas de la misma transacción y ciclo dan dos movimientos.

#### Scenario: Summary del batch limpio
- WHEN se procesa `data/samples/batch-clean` con todas las filas incluidas
- THEN `qty`, `amounts`, `fees` y `amountPayable` coinciden con `expected.summary`

#### Scenario: Movimientos de batch-clean
- GIVEN `data/samples/batch-clean` validado en ProviderA-USD
- WHEN se procesa con el número propuesto
- THEN el batch tiene 450 movimientos E, 10 I y 320 R (`expected.byCycle`), cada uno con la hoja y la fila de la que salió

#### Scenario: Refund y Chargeback de la misma transacción en un batch
- GIVEN un import cuya transacción aparece en la hoja REF y en la hoja CHB (colisión en I, las dos apariciones incluidas por defecto)
- WHEN se procesa
- THEN el batch tiene dos movimientos I de esa transacción, uno `Refund` y otro `Chargeback`, cada uno con su importe y su fee

#### Scenario: Chargeback y CHB 2 del mismo movimiento
- GIVEN un archivo legacy con un `Chargeback` y un `CHB 2` de la misma transacción
- WHEN se procesa
- THEN hay dos movimientos I `Chargeback`, el segundo con `excludeAmount = true`

#### Scenario: Duplicado incluido a mano
- GIVEN un duplicado E en el batch cuya segunda aparición el analista incluyó a mano
- WHEN se procesa
- THEN el batch tiene dos movimientos E de esa transacción, uno por fila

### Requirement: Fees por batch prellenados
Las filas de `Other Fees` SHALL aparecer en Settlement Review como `SettlementBatchFee` propuestos (`source = file`), con el tipo resuelto por nombre contra `FeeType`; un tipo desconocido SHALL quedar como importe libre con advertencia. El analista puede ajustar, quitar o añadir (`source = manual`).

#### Scenario: Fees de Other Fees prellenados
- GIVEN un import en `validated` cuya hoja `Other Fees` trae `Monthly Fee` por 150.0000 USD
- WHEN el analista abre Settlement Review
- THEN ve un fee por batch propuesto con el tipo `Monthly Fee` resuelto contra el catálogo y el importe del archivo
- AND puede confirmarlo, ajustar su importe o quitarlo antes de procesar

#### Scenario: Tipo desconocido como importe libre
- GIVEN la hoja `Other Fees` trae una fila cuyo tipo no existe en el catálogo
- WHEN el analista abre Settlement Review
- THEN esa fila aparece con una advertencia, como importe libre con su texto

#### Scenario: Fee añadido a mano
- WHEN el analista añade un fee no transaccional preestablecido de la cuenta con importe ajustado, o uno de importe libre con su categoría y descripción
- THEN se refleja en el resumen previo y queda registrado con su usuario

### Requirement: Fee por batch procesado
Cada fee procesado SHALL guardar `feeTypeId` de un tipo no transaccional, el `feeId` del preestablecido de la cuenta o `null`, el importe y quién lo registró; `null` en `feeId` exige un tipo con `allowsFreeAmount` salvo en los de `source = file` cuyo tipo se prellenó de verdad desde `Other Fees` en ese import.

#### Scenario: Prellenados de batch-clean procesados
- GIVEN `batch-clean` validado, con `Wire Fee` 25 y `Settlement Fee` 15 prellenados (`expected.batchFeesPrefilled`) y sin preestablecidos de esos tipos en la cuenta
- WHEN se procesa con esos dos fees, `source = "file"` y `feeId = null`
- THEN el batch guarda dos `SettlementBatchFee` con `source = file`, el usuario que procesó y `otherFeeAmt = 40.0000`

#### Scenario: Preestablecido solo con porcentaje
- GIVEN un fee no transaccional de la cuenta con `percentage` y sin `fixedAmount` (p. ej. `Chargeback over 1%` en ProviderA-USD)
- WHEN el analista lo agrega como fee por batch
- THEN el sistema no calcula su importe: se procesa con el importe que escribe el analista y su `feeId`

#### Scenario: Importe libre sin descripción
- WHEN se procesa o se pide la vista previa con un fee `source = "manual"`, `feeId = null`, un tipo con `allowsFreeAmount` y `description` ausente o vacía tras quitar espacios
- THEN la API responde `400 batch_fee_invalid` con `details = { index, reason: "description_required" }` y no se crea nada

#### Scenario: Orden de los fees por batch
- GIVEN un request con tres fees por batch en un orden dado
- WHEN se pide la vista previa y después se procesa
- THEN las dos respuestas devuelven `batchFees` en el orden del request

#### Scenario: Importe libre en un tipo que no lo admite
- WHEN se procesa con un fee `source = "manual"`, `feeId = null` y un tipo sin `allowsFreeAmount`
- THEN la API responde `400 batch_fee_invalid` con `details = { index, reason: "free_amount_not_allowed" }` y no se crea nada

#### Scenario: Preestablecido de otra cuenta o de otro tipo
- WHEN se procesa con un `feeId` que no es un fee no transaccional de la cuenta del import, o cuyo tipo no es el `feeTypeId` indicado
- THEN la API responde `400 batch_fee_invalid` con `reason` `fee_not_in_account` o `fee_type_mismatch`

#### Scenario: Preestablecido no vigente en la fecha del batch
- GIVEN un preestablecido con vigencia NULL…2026-10-15
- WHEN se procesa con `settlementDate = "2026-10-24"` y ese `feeId`
- THEN la API responde `400 batch_fee_invalid` con `reason = "fee_not_in_force"`

#### Scenario: Tipo transaccional como fee por batch
- WHEN se procesa con un fee por batch cuyo `feeTypeId` es transaccional o no existe
- THEN la API responde `400 batch_fee_invalid` con `reason` `transactional_fee_type` o `unknown_fee_type`

### Requirement: Política de reserva ante chargeback
Con `release_on_chargeback`, un chargeback sobre una transacción con reserva retenida SHALL liberar esa reserva en el mismo batch (`reserveEarlyReleasedAmt`) y dejar de esperarse en R; con `hold_until_term` la reserva sigue su plazo.

#### Scenario: Liberación inmediata
- GIVEN una cuenta con `release_on_chargeback` y una transacción `Successful` liquidada en E con reserva retenida
- WHEN un batch procesa su chargeback
- THEN la reserva se libera en ese batch como `reserveEarlyReleasedAmt`, se conserva la regla aplicada, deja de reportarse como pendiente de liberación y no se espera en R

#### Scenario: Retención hasta el plazo
- GIVEN una cuenta con `hold_until_term` y la misma situación
- WHEN un batch procesa su chargeback
- THEN la reserva sigue retenida hasta cumplir el plazo del canal y `reserveEarlyReleasedAmt` es 0

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

### Requirement: Exports
El intento SHALL exportar (a) el summary para el merchant, (b) el CSV Back-Office de transacciones (TXN) con columnas `ID, Status` y (c) el CSV de reservas (RR) con columnas `ID, Description`. `ID` SHALL ser el identificador de origen de la transacción escrito tal cual, como texto y sin ningún formato para Excel. Descargarlos no SHALL cambiar ningún estado.

#### Scenario: Exports disponibles al procesar, sin efecto en el pago
- GIVEN un batch recién procesado
- WHEN el analista descarga el summary y los dos CSV
- THEN cada export está identificado por su intento y la descarga no cambia el estado del batch ni marca nada como Settled

#### Scenario: IDs como texto
- GIVEN un batch con transacciones de ID numérico de 15 y de 16 dígitos y de ID UUID
- WHEN se exportan los CSV y el summary
- THEN cada ID se escribe con exactamente los caracteres de su identificador de origen, sin notación científica, sin pérdida de dígitos y sin `="…"`, apóstrofo, prefijo ni comillas que RFC 4180 no exija

### Requirement: Contenido del TXN y del RR
El TXN SHALL contener los movimientos E `Successful` (`SUC`) y los I `Chargeback` (`CHB`, también los de `excludeAmount`), `Refund` (`REF`) y `RDR` (`RDR`), sin `Declined`, una fila por par (`ID`, `Status`) distinto. El RR SHALL contener los movimientos R con `Description = "Batch <batchNo>"`, una fila por `ID` distinto.

#### Scenario: TXN de batch-clean
- GIVEN `batch-clean` procesado como batch 123 de ProviderA-USD
- WHEN se descarga `type=transactions`
- THEN el archivo tiene la cabecera `ID,Status` y 350 filas: 340 `SUC`, 2 `CHB`, 6 `REF` y 2 `RDR` (`expected.summary.qty`), y ninguna de las 110 declinadas

#### Scenario: RR de batch-clean
- GIVEN el mismo batch
- WHEN se descarga `type=reserves`
- THEN el archivo tiene la cabecera `ID,Description` y 320 filas (`expected.summary.qty.reservesReleased`), todas con `Description = Batch 123`

#### Scenario: CHB 2 en el TXN
- GIVEN `legacy-provider` procesado, con su fila `CHB 2` (`expected.excludeAmountRows`)
- WHEN se descarga `type=transactions`
- THEN esa transacción sale con `Status = CHB`, y el archivo tiene 61 filas: 60 `SUC` y 1 `CHB`

#### Scenario: Refund y Chargeback de la misma transacción
- GIVEN un intento con dos movimientos I de la misma transacción, uno `Refund` y otro `Chargeback`
- WHEN se descarga el TXN
- THEN la transacción sale en dos filas, una `REF` y otra `CHB`

#### Scenario: Chargeback y CHB 2 de la misma transacción
- GIVEN un intento con un movimiento I `Chargeback` y otro `Chargeback` con `excludeAmount` de la misma transacción
- WHEN se descarga el TXN
- THEN la transacción sale en una sola fila `CHB`

### Requirement: Archivo por intento y auditoría de la descarga
Los archivos SHALL generarse a partir de lo escrito al procesar, en cualquier estado del intento, e identificarse por intento con el nombre `<cuenta>_B<batchNo>_A<attemptNo>_<type>.csv`. Cada descarga SHALL quedar auditada.

#### Scenario: Nombre del archivo por intento
- GIVEN el intento 2 del batch 118 de la cuenta `ProviderA-USD`
- WHEN se descarga `type=reserves`
- THEN la respuesta lleva `Content-Disposition: attachment; filename="ProviderA-USD_B118_A2_reserves.csv"`

#### Scenario: Nombre de cuenta con caracteres fuera de la lista blanca
- GIVEN una cuenta llamada `Provider X / EU` y su intento 1 del batch 5
- WHEN se descarga `type=summary`
- THEN el nombre del archivo es `Provider_X_EU_B5_A1_summary.csv`

#### Scenario: Tres descargas seguidas
- GIVEN un batch `processed`
- WHEN el mismo usuario descarga tres veces el TXN
- THEN el batch sigue `processed`, ningún movimiento cambia y hay tres filas `settlement.export` en `AuditLog` con el usuario, el `batchId`, el tipo y el nombre del archivo

#### Scenario: Export de un intento deshecho
- GIVEN un intento `undone`
- WHEN se descarga cualquiera de los tres exports
- THEN responde `200` con el archivo de ese intento, identificado por su `attemptNo`

### Requirement: Precondición de procesar
`POST /api/v1/imports/{id}/settlements` SHALL exigir `settlement.process`, un import `validated` y en el cuerpo el `runId` revisado. Dentro de su transacción, tras la guarda sobre `Import`, SHALL comprobar que ese `runId` es la corrida vigente, que no está bloqueada y que su revisión sigue válida. Fuera de `validated` responde `409 import_not_validated` con `details.status`.

#### Scenario: Import no validado
- GIVEN un import en `analyzed`
- WHEN `analyst` lo procesa
- THEN recibe `409` con `code = "import_not_validated"`, `details.status = "analyzed"` y mensaje en inglés, y no se crea nada

#### Scenario: Revisión invalidada entre la pantalla y el proceso
- GIVEN un import `validated` cuyo proceso espera dentro de su transacción antes de la guarda
- WHEN mientras tanto otro usuario re-ejecuta las validaciones (el import vuelve a `analyzed`) y confirma
- THEN el proceso responde `409 import_not_validated` con `details.status = "analyzed"` y no escribe nada

#### Scenario: Otra corrida revisada entre medias
- GIVEN un analista que vio la corrida 11 y procesa con `runId = 11`
- WHEN antes de procesar se re-ejecutó y revisó la corrida 12, y el import vuelve a estar `validated`
- THEN responde `409 validation_run_superseded` con `details = { runId: 11, currentRunId: 12 }`

#### Scenario: Corrida bloqueada
- GIVEN un import cuya corrida vigente está bloqueada por `provider_mismatch`
- WHEN se intenta procesar
- THEN responde `409 blocking_validation_issue` sin override (en la práctica el import no llega a `validated`, y la comprobación es defensiva)

### Requirement: Procesamiento atómico y auditado
El procesamiento SHALL ocurrir en una sola transacción: intento, movimientos, fees, totales, asociación de canales, resolución de faltantes, paso del import a `processed` con `currentBatchId` y auditoría. Cualquier error SHALL deshacerlo todo. La auditoría SHALL incluir `settlement.process` con el usuario, la corrida, el número, el intento, los conteos y la nota.

#### Scenario: Procesado correcto
- GIVEN `batch-clean` validado
- WHEN se procesa
- THEN responde `201` con el intento en `processed`, el import queda `processed` con `currentBatchId` igual al `batchId` y hay una fila `settlement.process` en `AuditLog` con el usuario

#### Scenario: Fallo a mitad
- GIVEN un proceso que falla al escribir los totales
- WHEN termina
- THEN no queda ningún `SettlementBatch`, movimiento, fee, asociación ni auditoría suya, y el import sigue `validated`

#### Scenario: Procesar dos veces el mismo import
- GIVEN dos peticiones de procesar el mismo import, una esperando dentro de su transacción mientras la otra confirma
- WHEN la primera continúa
- THEN responde `409 import_not_validated` con `details.status = "processed"` y existe un solo intento

### Requirement: Inclusión de las apariciones al procesar
Una fila asociada SHALL procesarse si ninguna de sus apariciones `current_import` de la corrida vigente tiene `includeInSettlement = false`. Una fila en varios hallazgos se excluye si cualquiera de ellos la excluye. Una fila sin apariciones SHALL procesarse. Así ningún movimiento se cuenta dos veces por defecto.

#### Scenario: Fila excluida en un hallazgo e incluida en otro
- GIVEN una fila incluida como primera aparición de un `duplicate` / `in_batch` y excluida en un `duplicate` / `across_batches`
- WHEN se procesa
- THEN esa fila no produce movimiento

#### Scenario: Inclusión manual respetada
- GIVEN la segunda aparición de un `duplicate` / `in_batch` en E que el analista incluyó a mano y que no figura en ningún otro hallazgo
- WHEN se procesa
- THEN esa fila produce su movimiento

#### Scenario: Colisión con todas incluidas
- GIVEN `batch-issues`, donde `911545593909470` aparece en APP y en DEC con las dos apariciones incluidas por defecto
- WHEN se procesa
- THEN hay dos movimientos E de esa transacción, uno `Successful` y otro `Declined`

### Requirement: Filas que no se procesan
No SHALL producir movimiento ni descartarse en silencio: las filas sin asociar, ambiguas o ignoradas; las E o I con estado no resuelto; las cuyo propio estado es `Pending`; las excluidas por inclusión. Una fila con otro estado cuya transacción está en `Pending` en el gateway SHALL procesarse con el estado de la fila. La vista previa y la respuesta SHALL contar las saltadas en `skipped` por motivo, y la auditoría SHALL guardar esos conteos.

#### Scenario: Estado no resuelto
- GIVEN un import validado con una fila I cuyo estado no se pudo resolver (advertencia `status_unresolved` del análisis)
- WHEN se procesa
- THEN esa fila no produce movimiento y la respuesta trae `skipped.unresolvedStatus = 1`

#### Scenario: Fila con estado Pending
- GIVEN una fila E cuyo estado leído es `Pending` (por columna, vía alias)
- WHEN se procesa
- THEN no produce movimiento y cuenta en `skipped.pending`

#### Scenario: Transacción en Pending en el gateway
- GIVEN una fila APP cuya transacción está en `Pending` en el gateway
- WHEN se procesa
- THEN produce un movimiento E `Successful` con el importe del gateway y no cuenta en `skipped`

#### Scenario: Batch limpio sin filas saltadas
- WHEN se procesa `batch-clean`
- THEN `skipped` vale 0 en todos sus motivos salvo `ignored = 3` (las filas sin ID, `expected.rows.ignoredEmptyId`)

### Requirement: Importe, estado y fecha de cada movimiento
El movimiento E y el I SHALL llevar el estado de su fila y el importe USD de la transacción; un E `Declined` lleva importe 0. El R SHALL llevar el estado vigente de la transacción e importe 0. La fecha del evento SHALL ser la de creación (E); en I, la fecha del proveedor de la fila, o si falta el último cambio de estado cuando coincide con el estado de la fila; en R, el vencimiento de la reserva.

#### Scenario: RDR con importe
- GIVEN una fila RDR de una transacción de 120.0000 USD
- WHEN se procesa
- THEN su movimiento I `RDR` tiene `amount = 120.0000` y resta en el amount payable como un Chargeback o un Refund

#### Scenario: Fecha del proveedor en un ajuste
- GIVEN una fila CHB con la columna de fecha pareada (`txnDate`) a 2026-10-02T00:00:00 y una transacción con `lastStatusChangedAt` 2026-10-03
- WHEN se procesa
- THEN su movimiento I tiene `eventDate` 2026-10-02T00:00:00

#### Scenario: Ajuste sin fecha
- GIVEN una fila CHB sin fecha del proveedor cuya transacción está en el gateway en `Refund` (no coincide con la fila) o no tiene fecha de cambio de estado
- WHEN se procesa
- THEN su movimiento I tiene `eventDate = null` y la respuesta trae la advertencia `undated_adjustment` con esa transacción; no se usa la fecha del batch ni la actual

#### Scenario: Fecha de un movimiento R
- GIVEN una fila RR de una transacción creada el 2026-04-01T10:00:00 en un canal de 180 días
- WHEN se procesa
- THEN su movimiento R tiene `eventDate` 2026-09-28T10:00:00, `reserveDaysUsed = 180` y el estado vigente de la transacción

### Requirement: Reserva retenida y liberada
Un movimiento E `Successful` SHALL retener `appliedReservePct` de la transacción × su importe, a 4 decimales (mitad hacia arriba en el cuarto), con `reserveDaysUsed` y `expectedReserveReleaseAt` del plazo del canal. Un movimiento R SHALL liberar el mismo cálculo sobre su transacción. Llegar a `expectedReserveReleaseAt` no confiere Settled.

#### Scenario: Reservas de batch-clean
- WHEN se procesa `batch-clean`
- THEN la suma de `reserveHeldAmt` de los movimientos E y la de `reserveReleasedAmt` de los R coinciden con `expected.summary.amounts.reserveHeld` y `reserveReleased`

#### Scenario: Reserva con más de 4 decimales
- GIVEN una aprobada de 123.4565 USD con `appliedReservePct = 0.100000`
- WHEN se procesa
- THEN `reserveHeldAmt = 12.3457` (12.34565 redondeado mitad hacia arriba en el cuarto decimal; no 12.35, porque no se redondea a céntimos)

#### Scenario: Declinada sin reserva
- WHEN se procesa una fila DEC
- THEN su movimiento E tiene `reserveHeldAmt = 0` y `expectedReserveReleaseAt = null`

### Requirement: Ronda del movimiento I
Un movimiento I SHALL llevar `roundNo = 1` si el mismo batch tiene un movimiento E de su transacción, `roundNo = 2` si ese E está en un intento vigente anterior de cualquier cuenta del proveedor, y `null` si no hay ninguno. La ronda no cambia el cálculo.

#### Scenario: Ronda 1
- GIVEN un import con la fila APP y la fila CHB de la misma transacción
- WHEN se procesa
- THEN el movimiento I tiene `roundNo = 1`

#### Scenario: Ronda 2
- GIVEN una transacción liquidada en E en un batch `paid` anterior de otra cuenta del proveedor
- WHEN se procesa su chargeback
- THEN el movimiento I tiene `roundNo = 2`

### Requirement: Asociación de canales al procesar
Si los movimientos del batch incluyen canales sin asociar o cuya cuenta principal es otra, procesar SHALL exigir `confirmChannelAssignment: true` (si no, `409 channel_assignment_not_confirmed` con los canales). Al procesar, cada canal del batch SHALL quedar con esta cuenta como principal (`isPrimary`) y la anterior perderla, con auditoría.

#### Scenario: Canal nuevo de batch-clean
- GIVEN `batch-clean`, que trae `RAM-07` sin asociar (`expected.warnings.newChannels`)
- WHEN se procesa con `confirmChannelAssignment: true`
- THEN `RAM-07` queda asociado a ProviderA-USD como principal, con `assignedInBatchId` del batch y el usuario, la respuesta lo lista con `assignment = "new_primary"` y hay una fila `account_channel.assign` en `AuditLog`

#### Scenario: Sin confirmar
- GIVEN el mismo import
- WHEN se procesa sin `confirmChannelAssignment` o con `false`
- THEN responde `409 channel_assignment_not_confirmed` con `details.channels = [{ channelId, name, assignment }]` y no escribe nada

#### Scenario: Principal que se mueve
- GIVEN un canal cuya cuenta principal es ProviderA-EUR
- WHEN un batch de ProviderA-USD con movimientos de ese canal se procesa con la asociación confirmada
- THEN ProviderA-USD pasa a ser la principal, ProviderA-EUR conserva la asociación sin `isPrimary` y la respuesta lo lista con `assignment = "primary_moved_from"` y la cuenta anterior

#### Scenario: Canales ya principales
- GIVEN un import cuyos canales ya tienen esta cuenta como principal
- WHEN se procesa sin `confirmChannelAssignment`
- THEN se procesa y `channelsAssigned` está vacío

### Requirement: Totales del batch y amount payable
El batch SHALL guardar totales por categoría (`deposit`, `declined`, `chargeback`, `refund`, `rdr`: cantidad, importe positivo y fees), por marca de los depósitos, `otherFeeAmt`, reservas retenidas y liberadas, y `amountPayable` = depósitos − chargebacks sin `excludeAmount` − refunds − RDR − fees transaccionales − `otherFeeAmt` − retenida + liberada + liberada por chargeback, todo a 4 decimales.

#### Scenario: CHB 2 en los totales
- GIVEN `data/samples/legacy-provider`, con una fila `CHB 2` (`expected.excludeAmountRows`) y un fee de Chargeback en ProviderC-Alt
- WHEN se procesa
- THEN la categoría `chargeback` tiene `qty = 1`, `amount = 0.0000` y en `feeAmount` el fee de Chargeback del movimiento, como dice `expected.summary`

#### Scenario: Fees por batch en el payable
- GIVEN `batch-clean` validado
- WHEN se procesa con los dos fees prellenados
- THEN `amountPayable` es el de `expected.summary.amountPayable`, que ya resta `otherFeeAmt` (40.0000)
- AND procesado con `batchFees: []`, `amountPayable` es ese importe más 40.0000

#### Scenario: Dinero como texto
- WHEN se lee cualquier respuesta de procesar o de la vista previa
- THEN todo importe es un string decimal con cuatro decimales y todo porcentaje un string con seis, nunca un número JSON

### Requirement: Desglose del amount payable
Toda vista del batch (vista previa, respuesta de procesar y lecturas posteriores) SHALL traer `payableBreakdown`: líneas `{ code, label, sign, amount }` en orden fijo (depósitos, chargebacks, refunds, RDR, fees transaccionales, fees por batch, reserva retenida, reserva liberada, liberación anticipada), calculadas por el servidor, cuya suma con signo SHALL ser exactamente `amountPayable`.

#### Scenario: Suma del desglose
- WHEN se procesa o se pide la vista previa de `batch-clean` con los dos fees prellenados
- THEN `payableBreakdown` tiene nueve líneas en el orden fijo, con `sign` `+` en depósitos, reserva liberada y liberación anticipada, y `-` en las demás
- AND la suma con signo de sus `amount` es igual a `amountPayable`

#### Scenario: Líneas en cero
- GIVEN un batch sin RDR ni liberación anticipada
- WHEN se lee su vista
- THEN las líneas `rdr` y `reserve_early_released` están presentes con `amount = "0.0000"`

### Requirement: Advertencias del procesamiento
La vista previa y la respuesta SHALL traer `warnings` con código y, cuando aplica, transacción, hoja y fila. Entre ellas: `undated_adjustment`, `no_transactional_fees`, `reserve_cap_not_applied` (cuenta con tope de reserva, que no se aplica en el MVP) y `chargeback_reserve_policy_not_applied` (cuenta `release_on_chargeback` mientras la política no esté implementada, #62).

#### Scenario: Cuenta release_on_chargeback
- GIVEN un import validado de ProviderB-Main (`release_on_chargeback`) con un chargeback de una transacción con reserva retenida
- WHEN se procesa
- THEN el movimiento I tiene `reserveEarlyReleasedAmt = 0.0000`, la reserva sigue retenida y la respuesta trae la advertencia `chargeback_reserve_policy_not_applied`

#### Scenario: Cuenta con tope de reserva
- GIVEN ProviderA-EUR, con `rollingReserveCapAmt`
- WHEN se procesa un import suyo
- THEN la reserva se calcula sin tope y la respuesta trae la advertencia `reserve_cap_not_applied`

### Requirement: Vista previa del procesamiento
`POST /api/v1/imports/{id}/settlements/preview` SHALL exigir `settlement.process` y un import `validated`, aceptar el mismo cuerpo que procesar y devolver el número y el intento que se usarían, los totales, los fees, las reservas, el amount payable con su desglose, los canales a asociar, `skipped` y las advertencias, sin escribir nada ni auditar.

#### Scenario: Resumen previo de batch-clean
- GIVEN `batch-clean` validado
- WHEN `analyst` pide la vista previa con los dos fees prellenados
- THEN recibe `200` con `batchNo = 123`, los totales y el `amountPayable` de `expected.summary`, `otherFeeAmt = 40.0000` y `RAM-07` entre los canales a asociar
- AND no existe ningún `SettlementBatch` nuevo ni fila de auditoría

#### Scenario: Número ocupado en la vista previa
- WHEN la vista previa pide un `batchNo` con intento vigente en la cuenta
- THEN responde `200` con `batchNoAvailable = false`, para que el formulario lo avise antes de procesar

### Requirement: Siguiente número de batch
`GET /api/v1/accounts/{id}/batch-number/next` SHALL devolver el mayor `batchNo` de la cuenta en cualquier estado + 1 con `attemptNo = 1`. Con `importId` de un import de la cuenta que tiene un intento `undone` y ningún vigente, SHALL devolver ese mismo número y su siguiente intento (`reason = "reprocess"`). Exige autenticación y alcance.

#### Scenario: Número propuesto de batch-clean
- WHEN `analyst` pide el siguiente número de ProviderA-USD
- THEN recibe `{ batchNo: 123, attemptNo: 1, reason: "next" }` (`expected.proposedBatchNo`)

#### Scenario: Cuenta fuera del alcance
- WHEN `viewer` pide el siguiente número de ProviderC-Alt (merchant 2) o de una cuenta inexistente
- THEN recibe el mismo `404 not_found` en los dos casos

### Requirement: Alcance y permisos del procesamiento
Procesar y la vista previa SHALL responder `403 forbidden` sin `settlement.process` (antes de mirar el alcance) y `404 not_found` idéntico para un import inexistente o de un merchant fuera del alcance.

#### Scenario: Viewer
- WHEN `viewer` procesa o pide la vista previa de cualquier import
- THEN recibe `403` con `code = "forbidden"`

#### Scenario: Import de otro merchant
- GIVEN un usuario con `settlement.process` y solo el merchant 1
- WHEN procesa un import de ProviderC-Alt (merchant 2)
- THEN recibe el mismo `404` que para un import inexistente

### Requirement: Faltantes resueltos al procesar
Procesar SHALL pasar a `resolved`, con el `batchId` y la fecha, los hallazgos `missing` persistentes de corridas vigentes de cualquier import del proveedor cuyo `(transactionId, cycle)` tenga un movimiento en el batch, y devolver cuántos en `validationSummary.resolvedMissing`.

#### Scenario: Faltante de otro import resuelto
- GIVEN un faltante `missing` persistente en ciclo I de la transacción X, en la corrida vigente de un import procesado del proveedor
- WHEN se procesa un batch posterior del proveedor que incluye a X en I
- THEN el hallazgo pasa a `resolved` con `resolvedInBatchId` del batch nuevo y `resolvedAt`, y `validationSummary.resolvedMissing = 1`

#### Scenario: Otro ciclo no resuelve
- GIVEN el mismo faltante en ciclo I
- WHEN el batch incluye a X solo en E
- THEN el hallazgo sigue `persistent`

### Requirement: Formato de los CSV
Los tres exports SHALL ser CSV RFC 4180: separador `,`, fila de cabecera, CRLF, UTF-8 sin BOM, y comillas dobles (con las internas duplicadas) solo en valores con `,`, `"` o salto de línea. Los importes SHALL llevar punto decimal, cuatro decimales, sin separador de miles y `-` si son negativos, sin pasar por coma flotante. La respuesta SHALL llevar `Content-Type: text/csv; charset=utf-8` y `Cache-Control: no-store`.

#### Scenario: Cabeceras HTTP del export
- WHEN se descarga cualquier export
- THEN la respuesta es `200` con `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store` y `Content-Disposition: attachment` con el nombre del archivo

#### Scenario: Bytes del TXN
- GIVEN un intento con un único movimiento E `Successful` de la transacción `911545593909470`
- WHEN se descarga el TXN
- THEN el cuerpo empieza sin BOM por `ID,Status`, las líneas terminan en CRLF y la fila de datos contiene el ID completo y `SUC`

#### Scenario: Descripción con coma en el summary
- GIVEN un fee por batch con descripción `Wire fee, October`
- WHEN se descarga el summary
- THEN esa celda sale entre comillas dobles y el archivo sigue teniendo el mismo número de columnas en ese bloque

### Requirement: Summary del merchant
El export `summary` SHALL tener nueve bloques con cabecera, separados por una línea vacía: intento, totales, marcas, fees por batch, reservas, amount payable (nueve líneas con signo e importe y la fila `Amount payable`), incidencias, filas no procesadas y advertencias. Las cifras SHALL ser las de la vista, sin recalcular. Las fechas de negocio SHALL ir sin convertir y `processedAt` en hora de Nueva York (`ET`). Una advertencia con transacción SHALL llevar su ID de origen.

#### Scenario: Summary de batch-clean
- GIVEN `batch-clean` procesado con los dos fees prellenados
- WHEN se descarga `type=summary`
- THEN los totales por categoría, las reservas, `otherFeeAmt = 40.0000` y `Amount payable = 33771.3600` coinciden con `expected.summary`
- AND el bloque del amount payable tiene las nueve líneas en el orden fijo, y la suma con signo de sus importes es `33771.3600`

#### Scenario: Fechas del summary
- GIVEN un intento procesado el `2026-10-19T15:40:03.120Z` con rango APP máximo `2026-10-07T23:58:40.000Z`
- WHEN se descarga el summary
- THEN el intento muestra `2026-10-19 11:40:03 ET` como fecha de proceso y el rango APP termina en `2026-10-07 23:58:40`, sin convertir

#### Scenario: Intento sin auditoría de procesado
- GIVEN un batch del seed, que no tiene fila `settlement.process`
- WHEN se descarga su summary
- THEN el bloque de incidencias y el de filas no procesadas dicen `Not available` en lugar de ceros, y el resto de bloques sale con las cifras del batch

#### Scenario: Advertencia con el ID de origen
- GIVEN un intento con una advertencia `undated_adjustment` de la transacción interna `40711`, cuyo ID de origen es `911545598812004`
- WHEN se descarga el summary
- THEN el bloque de advertencias (`Code,Transaction ID,Detail`) muestra `911545598812004` y no `40711`

### Requirement: Texto del summary sin fórmulas
En el export `summary`, toda celda de texto (nombre de la cuenta, usuarios, canales, marcas, tipo y descripción de los fees por batch) que empiece por `=`, `+`, `-`, `@`, tabulador o retorno de carro SHALL llevar un apóstrofo delante, para que una hoja de cálculo la muestre y no la ejecute. Las cifras (también los importes negativos), las fechas y los IDs no SHALL cambiar. TXN y RR no llevan texto libre y no cambian.

#### Scenario: Texto que empieza como una fórmula
- GIVEN un fee por batch con descripción `=HYPERLINK("http://example.test","click")` y otro con importe `-25.0000`
- WHEN se descarga el summary
- THEN la descripción sale como `'=HYPERLINK(…)` (con las comillas de RFC 4180) y el importe sale `-25.0000`, sin apóstrofo

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

### Requirement: Movimientos del intento
`GET /api/v1/settlements/{id}/transactions` SHALL exigir `type` ∈ `E` | `I` | `R` y devolver, paginados (`page` desde 1, `pageSize` 1–500, 50 por defecto) y con `total`, los movimientos del ciclo en orden estable. Cada uno SHALL traer transacción, estado, fila de origen, importes, fees con su desglose, fecha del evento (o `null`), reserva y `settled`, y los de la misma transacción y ciclo SHALL salir por separado.

#### Scenario: Ajustes de batch-clean
- GIVEN `batch-clean` procesado
- WHEN se piden sus movimientos `type=I`
- THEN `total = 10` (2 `Chargeback`, 6 `Refund`, 2 `RDR`) y cada movimiento trae su desglose de fees, cuya suma es su `feeAmount`

#### Scenario: Paginación estable
- GIVEN `batch-clean` procesado
- WHEN se piden las páginas 1 a 7 de `type=E` con `pageSize = 70`
- THEN entre todas salen los 450 movimientos E, cada uno una sola vez, y repetir una página devuelve los mismos movimientos en el mismo orden

#### Scenario: Ciclo inválido
- WHEN se pide `type=X`, sin `type` o con `pageSize = 501`
- THEN responde `400 validation_error`

### Requirement: Settled derivado del intento en las lecturas
Toda lectura de un intento y de sus movimientos SHALL derivar Settled del estado del intento (`paid`), nunca de `settlementStatusId`.

#### Scenario: Procesado frente a pagado
- GIVEN un intento `processed` y un batch sembrado `paid`
- WHEN se piden sus movimientos
- THEN los del intento `processed` traen `settled = false` y los del `paid`, `settled = true`

### Requirement: Intentos de un import
`GET /api/v1/imports/{id}/settlements` SHALL responder `200` con los intentos del import (vigente y deshechos), del más reciente al más antiguo por `processedAt`, cada uno con `batchId`, `batchNo`, `attemptNo`, `status`, `settledStatus`, `processedAt`, quién lo aprobó, `amountPayable` e `isCurrent` (es el `currentBatchId` del import). Un import sin intentos SHALL devolver una lista vacía.

#### Scenario: Import procesado
- GIVEN `batch-clean` procesado
- WHEN se piden sus intentos
- THEN hay uno, con `batchNo = 123`, `attemptNo = 1`, `status = processed`, `settledStatus = pending_payment` e `isCurrent = true`

#### Scenario: Import sin procesar
- GIVEN un import `validated`
- WHEN se piden sus intentos
- THEN la lista está vacía

### Requirement: Alcance y permisos de las lecturas y los exports
Las lecturas SHALL exigir autenticación y el export además `reports.view`, comprobado antes que el alcance (`403 forbidden`). Un intento o un import inexistente o de un merchant fuera del alcance del usuario SHALL responder el mismo `404 not_found` (`"Settlement not found"`, `"Import not found"`). Sin token SHALL responder `401 unauthorized`. Los errores SHALL ser JSON (`{ code, message, details? }`) también en la ruta del export.

#### Scenario: Batch de otro merchant
- GIVEN un batch sembrado de ProviderC-Alt (merchant 2)
- WHEN `viewer` (solo merchant 1) pide la vista, los movimientos o un export
- THEN recibe el mismo `404` que para un `batchId` inexistente

#### Scenario: Sin reports.view
- GIVEN un usuario autenticado sin `reports.view`
- WHEN pide un export de un batch de otro merchant o inexistente
- THEN recibe `403` con `code = "forbidden"` antes de mirar el alcance

#### Scenario: Tipo de export inválido
- WHEN se pide `type=pdf` o sin `type`
- THEN responde `400 validation_error` en JSON y no se escribe auditoría

#### Scenario: Sin token
- WHEN se pide cualquiera de las cuatro rutas sin `Authorization`
- THEN responde `401` con `code = "unauthorized"`

### Requirement: Pantalla Settlement Review: acceso y estado del import
Settlement Review SHALL ser una pantalla del import que exige `settlement.process`. Sin el permiso SHALL mostrar `You don't have access to this page` sin llamar a ningún endpoint de la pantalla. Con el permiso, SHALL mostrar el formulario solo si el import está `validated`. En otro estado SHALL decir por qué y SHALL enlazar a donde se puede seguir, sin formulario ni **Process**.

#### Scenario: viewer por enlace directo
- **GIVEN** el import de `batch-clean` `validated`
- **WHEN** `viewer` abre su Settlement Review por la dirección
- **THEN** ve `You don't have access to this page` y no se llama a `batch-number/next`, `fees`, `fee-types` ni `settlements/preview`

#### Scenario: Import analizado
- **GIVEN** el import de `batch-clean` `analyzed`
- **WHEN** `analyst` abre su Settlement Review
- **THEN** ve `This import is not validated. Review its validations before processing.` con un enlace al paso Analysis, sin formulario ni **Process**, y no se llama a `settlements/preview`

#### Scenario: Import ya procesado
- **GIVEN** el import de `batch-clean` `processed` con `currentBatchId`
- **WHEN** `analyst` abre su Settlement Review
- **THEN** ve `This import is already processed.` con **View settlement summary**, que lleva al Settlement Summary de ese intento

### Requirement: Pantalla Settlement Review: número de batch propuesto y editable
Al abrir Settlement Review de un import `validated`, el campo **Batch number** SHALL llegar con el número de `GET /accounts/{accountId}/batch-number/next?importId=` y SHALL poder editarse. Solo SHALL admitir un entero positivo. La pantalla SHALL mostrar el intento que devuelve la vista previa, y SHALL decir cuándo el número propuesto es el de un intento deshecho del mismo import.

#### Scenario: Número propuesto de batch-clean (HU3 CA1)
- **GIVEN** el import de `batch-clean` `validated`
- **WHEN** `analyst` abre su Settlement Review
- **THEN** el campo **Batch number** vale `123`, ve `Proposed: 123 · attempt 1` y puede escribir otro número

#### Scenario: Reproceso tras deshacer
- **GIVEN** `batch-number/next` responde `{ batchNo: 118, attemptNo: 2, reason: "reprocess" }`
- **WHEN** `analyst` abre Settlement Review
- **THEN** el campo vale `118` y ve `Proposed: 118 · attempt 2 (the previous attempt of this import was undone)`

#### Scenario: Número no válido
- **WHEN** `analyst` escribe `0` o `12a` en **Batch number**
- **THEN** ve `Enter a positive whole number.` en el campo y no se pide una vista previa con ese valor

### Requirement: Pantalla Settlement Review: número de batch en uso
Un número con intento vigente en la cuenta SHALL avisarse en el propio campo, tanto si lo dice la vista previa (`batchNoAvailable = false`) como si lo dice el `409 batch_no_taken` al procesar. Mientras el aviso esté a la vista, **Process** SHALL estar deshabilitado con su motivo. Tras el `409` no SHALL haberse creado nada y la pantalla SHALL seguir con lo que el analista escribió.

#### Scenario: Aviso desde la vista previa
- **GIVEN** la vista previa con `batchNo = 117` responde `batchNoAvailable = false`
- **WHEN** `analyst` escribe `117`
- **THEN** ve `Batch 117 already has an active attempt for this account.` en el campo y **Process** está deshabilitado con `Choose a batch number that is not in use.`

#### Scenario: Número tomado al procesar (criterio 1 del issue)
- **GIVEN** la vista previa de `123` decía `batchNoAvailable = true`
- **WHEN** `analyst` pulsa **Process** y el API responde `409 batch_no_taken` con `details.batchNo = 123`
- **THEN** ve `Batch 123 already has an active attempt for this account.` en el campo **Batch number**, sigue en Settlement Review con sus fees y su fecha, y se vuelve a pedir la vista previa

### Requirement: Pantalla Settlement Review: fecha de liquidación
**Settlement date** SHALL ser una fecha de negocio obligatoria (`YYYY-MM-DD`), vacía al abrir hasta que el analista la elige, y enviada tal cual en `settlementDate` (P8 de #11). Sin ella SHALL NOT pedirse la vista previa ni procesarse, y el campo SHALL mostrar su motivo. La fecha SHALL NOT convertirse de zona.

#### Scenario: Al abrir
- **GIVEN** el import de `batch-clean` `validated`
- **WHEN** `analyst` abre su Settlement Review
- **THEN** **Settlement date** está vacía con `Choose the settlement date.`, el resumen previo dice `Choose the settlement date to see the pre-summary.`, **Process** está deshabilitado con `Choose the settlement date.` y no se llama a `settlements/preview`

#### Scenario: Fecha elegida
- **WHEN** `analyst` elige `2026-10-24` en **Settlement date**
- **THEN** se pide la vista previa con `"settlementDate": "2026-10-24"` y el procesamiento envía la misma fecha

#### Scenario: Fecha borrada
- **GIVEN** una vista previa con `2026-10-24`
- **WHEN** `analyst` borra **Settlement date**
- **THEN** ve `Choose the settlement date.` en el campo, el resumen previo queda desactualizado y **Process** se deshabilita con ese motivo

### Requirement: Pantalla Settlement Review: fees prellenados desde Other Fees
Los `batchFees` de `GET /imports/{id}` SHALL aparecer como filas de fees por batch con su tipo, su importe y origen `From file` (`source = file`), y el analista SHALL poder ajustar el importe, cambiar la descripción o quitarlas. Una fila con `feeTypeId = null` SHALL mostrarse marcada hasta que el analista le elija un tipo con `allowsFreeAmount` o la quite. Una fila sin importe SHALL exigir el importe.

#### Scenario: Prellenados de batch-clean
- **GIVEN** el import de `batch-clean` `validated`
- **WHEN** `analyst` abre su Settlement Review y elige **Settlement date**
- **THEN** ve dos filas `From file`: `Wire Fee` con `25.0000` y `Settlement Fee` con `15.0000`
- **AND** la vista previa se pide con esos dos fees, `source = "file"` y `feeId = null`

#### Scenario: Ajustar un prellenado (criterio 2 del issue)
- **WHEN** `analyst` cambia el importe de `Wire Fee` a `30.0000`
- **THEN** la siguiente vista previa envía ese fee con `"amount": "30.0000"` y `source = "file"`, y el resumen previo pinta lo que el API devuelve

#### Scenario: Quitar un prellenado
- **WHEN** `analyst` pulsa **Remove** en `Settlement Fee`
- **THEN** la fila desaparece y la siguiente vista previa envía solo `Wire Fee`

#### Scenario: Tipo desconocido en el archivo
- **GIVEN** `GET /imports/{id}` trae un fee con `feeTypeId = null`, `title = "Bank charge"` y su advertencia
- **WHEN** `analyst` abre Settlement Review
- **THEN** la fila aparece marcada con `Unknown fee type in the file: choose a free-amount type or remove the fee.`, el selector solo ofrece tipos con `allowsFreeAmount`, **Process** está deshabilitado con `Choose a type for the fees of unknown type, or remove them.` y no se pide la vista previa

#### Scenario: Tipo elegido para la fila desconocida
- **WHEN** `analyst` elige `Special Adjustment` para la fila `Bank charge`
- **THEN** la fila deja de estar marcada y la vista previa la envía con ese `feeTypeId`, `feeId = null` y `source = "file"`

#### Scenario: Fila desconocida quitada
- **WHEN** `analyst` pulsa **Remove** en la fila `Bank charge`
- **THEN** la fila desaparece, el motivo de **Process** se va y la vista previa se pide sin ella

### Requirement: Pantalla Settlement Review: añadir un fee preestablecido
**Add preset fee** SHALL ofrecer los fees no transaccionales de la cuenta vigentes en **Settlement date** (`GET /accounts/{id}/fees?transactional=false&asOf=<settlementDate>`), y SHALL estar deshabilitado con su motivo mientras no haya fecha. Con `fixedAmount` el importe SHALL llegar con ese valor y ser editable. Con solo porcentaje SHALL llegar vacío para que lo escriba el analista: la pantalla SHALL NOT calcular ningún importe.

#### Scenario: Sin fecha todavía
- **GIVEN** **Settlement date** vacía
- **THEN** **Add preset fee** está deshabilitado con `Choose the settlement date first.` y no se llama a `GET /accounts/{id}/fees`

#### Scenario: Preestablecidos de la fecha
- **WHEN** `analyst` elige `2026-10-24` en **Settlement date** y abre **Add preset fee**
- **THEN** se llama a `GET /accounts/<ProviderA-USD>/fees?transactional=false&asOf=2026-10-24` y ve sus preestablecidos con su configuración y su vigencia

#### Scenario: Preestablecido con importe fijo (HU3 CA2)
- **GIVEN** una cuenta con el preestablecido `Monthly Fee` de `fixedAmount = 250.0000`
- **WHEN** `analyst` lo añade y cambia el importe a `240.0000`
- **THEN** la fila muestra `Preset` y la vista previa la envía con su `feeId`, `feeTypeId`, `"amount": "240.0000"` y `source = "manual"`

#### Scenario: Preestablecido solo con porcentaje
- **GIVEN** ProviderA-USD con el preestablecido `Chargeback over 1%` con `percentage = 0.010000` y `fixedAmount = null`
- **WHEN** `analyst` lo añade
- **THEN** el importe está vacío con `Percentage-only fee (rate 0.010000): enter the amount.` y no se pide otra vista previa hasta que el analista escriba un importe

### Requirement: Pantalla Settlement Review: añadir un fee de importe libre
**Add free-amount fee** SHALL ofrecer solo los tipos no transaccionales con `allowsFreeAmount` de `GET /fee-types`. La fila SHALL pedir importe y descripción (1–200 caracteres, obligatoria también en el API) y SHALL enviarse con `feeId = null` y `source = "manual"`.

#### Scenario: Ajuste negativo (HU3 CA2)
- **WHEN** `analyst` añade un fee de importe libre `Special Adjustment` con `-42.5000` y la descripción `Duplicate in batch 118`
- **THEN** la vista previa lo envía con `"feeId": null`, `"amount": "-42.5000"`, la descripción y `source = "manual"`

#### Scenario: Tipos ofrecidos
- **WHEN** `analyst` abre **Add free-amount fee**
- **THEN** ve `Special Adjustment` y `Bram Fine` y no ve `Wire Fee` (sin importe libre) ni ningún tipo transaccional

#### Scenario: Sin descripción
- **WHEN** deja vacía la descripción de un fee de importe libre
- **THEN** ve `Write a description for a free-amount fee.` y no se pide otra vista previa hasta que la escriba

### Requirement: Pantalla Settlement Review: importes de los fees
El importe de cada fee SHALL escribirse y enviarse como texto decimal con signo opcional, hasta 4 decimales y distinto de cero. Un importe no válido SHALL marcarse en su fila y, mientras el formulario tenga un campo no válido, SHALL NOT pedirse otra vista previa. El importe SHALL NOT convertirse a número en ningún paso.

#### Scenario: Importe no válido
- **WHEN** `analyst` escribe `12.34567`, `0`, `-0.0000` o `1,5` en un importe
- **THEN** ve `Enter an amount with up to 4 decimals, other than zero.` en esa fila y no se pide una vista previa con ese valor

#### Scenario: Importe con muchos dígitos
- **WHEN** `analyst` escribe `123456789012345.1234`
- **THEN** la vista previa lo envía exactamente como `"123456789012345.1234"`

### Requirement: Pantalla Settlement Review: fee rechazado por el API
Un `400 batch_fee_invalid` de la vista previa o del procesamiento SHALL mostrarse en la fila de `details.index` con el texto de su `reason`, y **Process** SHALL quedar deshabilitado hasta que esa fila cambie o se quite.

#### Scenario: Importe libre no admitido
- **WHEN** la vista previa responde `400 batch_fee_invalid` con `{ index: 1, reason: "free_amount_not_allowed" }`
- **THEN** la segunda fila muestra `This fee type does not accept a free amount.` y **Process** está deshabilitado con `Fix the highlighted fields.`

#### Scenario: Preestablecido fuera de vigencia
- **WHEN** la vista previa responde `400 batch_fee_invalid` con `reason = "fee_not_in_force"` para la fila 0
- **THEN** la primera fila muestra `This preset fee is not in force on the settlement date.`

#### Scenario: Descripción exigida por el API
- **WHEN** la vista previa o el procesamiento responde `400 batch_fee_invalid` con `{ index: 2, reason: "description_required" }`
- **THEN** la descripción de la tercera fila muestra `Write a description for a free-amount fee.`

### Requirement: Pantalla Settlement Review: resumen previo
Tras cada cambio válido del formulario, con debounce, la pantalla SHALL pedir `POST /imports/{id}/settlements/preview` con el `runId` revisado y SHALL pintar los movimientos E/I/R, los totales de las cinco categorías con el rango de fechas de cada una, las nueve líneas de `payableBreakdown` con su signo, `amountPayable`, `skipped` por motivo y las advertencias. Toda cifra y todo rango SHALL salir de la respuesta: la pantalla SHALL NOT calcular ni sumar importes ni fechas.

#### Scenario: Resumen previo de batch-clean
- **GIVEN** el import de `batch-clean` `validated` con sus dos fees prellenados
- **WHEN** `analyst` abre su Settlement Review y elige `2026-10-24` en **Settlement date**
- **THEN** se pide una vista previa con el `runId` de la corrida revisada y ve las cinco categorías, las nueve líneas del desglose en el orden del API con `+` o `−`, `Batch fees` con el `otherFeeAmt` de la respuesta y **Amount payable** con el `amountPayable` de la respuesta, todos con separador de miles y sus cuatro decimales

#### Scenario: Rango de cada categoría
- **GIVEN** la vista previa con `dateRanges` APP, DEC e I
- **THEN** `Totals by type` tiene la columna `Date range` con el mismo formato que en el Settlement Summary

#### Scenario: Resumen previo a 1280 px
- **GIVEN** la vista previa de `batch-clean` a 1280 px
- **THEN** el resumen previo va debajo del formulario, como a 1024 px, y ninguna cifra ni rango de `Totals by type` se recorta ni obliga a desplazar la tabla

#### Scenario: Filas que no se procesan
- **GIVEN** la vista previa con `skipped = { ignored: 3, unmatched: 0, ambiguous: 0, excluded: 2, unresolvedStatus: 0, pending: 0 }`
- **THEN** ve `Not processed: 3 ignored · 2 excluded` y ningún motivo con 0

#### Scenario: Advertencias
- **GIVEN** la vista previa trae `undated_adjustment` de `441706751475644` y `reserve_cap_not_applied`
- **THEN** ve `Adjustment 441706751475644 has no event date: it is processed without one.` y `The reserve cap of the account is not applied yet.`

#### Scenario: Una cifra que no cuadra con la suma
- **GIVEN** una vista previa guionizada cuyo `amountPayable` no es la suma de sus líneas
- **THEN** la pantalla pinta el `amountPayable` de la respuesta tal cual, sin corregirlo

### Requirement: Pantalla Settlement Review: resumen previo al día
Mientras el formulario tenga cambios sin vista previa, o una vista previa esté en curso, el resumen previo SHALL marcarse como desactualizado y **Process** SHALL estar deshabilitado. Cambios seguidos dentro del debounce SHALL producir una sola petición, y la respuesta de una petición superada SHALL NOT pintarse.

#### Scenario: Escritura seguida
- **WHEN** `analyst` escribe `3`, `0` y `.5` seguidos en un importe
- **THEN** se pide una sola vista previa, con `"30.5"`, y mientras tanto ve `Updating the pre-summary…` y **Process** deshabilitado con `Waiting for the pre-summary.`

#### Scenario: Respuesta fuera de orden
- **GIVEN** una vista previa A retenida y una posterior B ya respondida
- **WHEN** A responde
- **THEN** la pantalla sigue pintando B

### Requirement: Pantalla Settlement Review: canales a asociar
Si la vista previa trae `requiresChannelConfirmation = true`, la pantalla SHALL listar `channelsToAssign` (sin cuenta, el nombre de la otra cuenta o, si esa cuenta es de un comercio fuera del alcance, solo que es de otro comercio) y SHALL pedir la casilla **Assign these channels to this account as primary**. Sin marcarla, **Process** SHALL estar deshabilitado con su motivo. Marcada, el cuerpo SHALL llevar `confirmChannelAssignment: true`.

#### Scenario: RAM-07 sin cuenta (HU3 CA5)
- **GIVEN** la vista previa de `batch-clean` con `RAM-07` `unassigned` en `channelsToAssign`
- **THEN** ve `RAM-07 · not assigned yet`, la casilla sin marcar y **Process** deshabilitado con `Confirm the channel assignment.`
- **AND** al marcarla, **Process** se habilita y el procesamiento envía `"confirmChannelAssignment": true`

#### Scenario: Canales cambiados al procesar
- **WHEN** **Process** responde `409 channel_assignment_not_confirmed` con `RAM-03` en `details.channels`
- **THEN** ve `RAM-03` en la lista, la casilla vuelve a estar sin marcar y se pide otra vista previa

#### Scenario: Sin canales que asociar
- **GIVEN** la vista previa con `requiresChannelConfirmation = false`
- **THEN** no hay casilla ni aviso, y el cuerpo no lleva `confirmChannelAssignment`

#### Scenario: Cuenta principal de otro comercio
- **GIVEN** la vista previa con `RAM-08` `assigned_to_other_account` y `otherAccount = { accountId: null, name: null, outOfScope: true }`
- **THEN** ve `RAM-08 · primary account: an account of another merchant`

### Requirement: Pantalla Settlement Review: procesar
**Process batch N** SHALL enviar a `POST /imports/{id}/settlements` exactamente el cuerpo de la vista previa a la vista más la confirmación de canales, una sola vez aunque se pulse dos veces, y SHALL estar deshabilitado con cada motivo visible y asociado al botón. Con `201` SHALL llevar al Settlement Summary del intento devuelto y pintar esa respuesta sin otra petición.

#### Scenario: Procesar batch-clean (HU3 CA6)
- **GIVEN** la vista previa de `batch-clean` al día y la casilla de canales marcada
- **WHEN** `analyst` pulsa **Process batch 123** dos veces seguidas
- **THEN** el API recibe un solo `POST /imports/<importId>/settlements` con `runId`, `batchNo = 123`, los dos fees prellenados y `confirmChannelAssignment = true`, y con el `201` la pantalla pasa al Settlement Summary del `batchId` devuelto sin pedir `GET /settlements/<batchId>`

#### Scenario: Botón deshabilitado mientras procesa
- **WHEN** el `POST` está retenido
- **THEN** **Process** y los campos están deshabilitados y ve `Processing the batch…`

#### Scenario: Import que ya no está validado
- **WHEN** **Process** responde `409 import_not_validated` con `details.status = analyzed`
- **THEN** ve `The import is no longer validated (status: analyzed). Review its validations again.`, se relee el import y la pantalla pasa al estado de import no validado

#### Scenario: Corrida superada
- **WHEN** **Process** o la vista previa responde `409 validation_run_superseded`
- **THEN** ve `A newer validation run exists. Review it before processing.` con un enlace al paso Analysis y **Process** deshabilitado

#### Scenario: Fallo de red
- **WHEN** **Process** falla sin respuesta del API
- **THEN** ve `The batch could not be processed. Try again.`, sigue en Settlement Review con lo escrito y **Process** vuelve a estar disponible

#### Scenario: Procesamiento ocupado
- **WHEN** **Process** responde `409 settlement_busy`
- **THEN** ve `Another settlement is being processed for this provider. Try again.` con **Retry**, sigue en Settlement Review con lo escrito y la vista previa no se vuelve a pedir
- **AND** **Retry** envía otra vez el mismo cuerpo, y con el `201` pasa al Settlement Summary
- **AND** **Retry** se deshabilita con los mismos motivos que **Process** (por ejemplo, la casilla de canales desmarcada), y cambiar un campo quita el aviso

### Requirement: Pantalla Settlement Summary: estado y cabecera del intento
Settlement Summary SHALL mostrar en una rejilla compacta la cuenta, el batch con su intento, el estado (`Processed · pending payment`, `Paid` o `Undone`), quién lo procesó y cuándo, y la fecha de liquidación. Los rangos de fechas del batch SHALL verse en `Totals by type`, no en la cabecera. SHALL decir que un intento `processed` no tiene movimientos Settled.

#### Scenario: Recién procesado (HU3 CA6)
- **GIVEN** la respuesta `201` de procesar `batch-clean`
- **THEN** ve `Settlement Summary · batch 123` y la rejilla con `Account` `ProviderA-USD`, `Batch` `123 · attempt 1`, `Status` `Processed · pending payment`, `Processed by` `analyst · <fecha y hora> ET` y `Settlement date` `2026-10-24`
- **AND** ve `Movements are not Settled yet: that happens when the batch is marked as paid.`

#### Scenario: Sin fecha de liquidación
- **GIVEN** un intento con `settlementDate = null`
- **THEN** la rejilla muestra `Settlement date` `Not set`

#### Scenario: Sin tabla de rangos en la cabecera
- **GIVEN** la vista de `batch-clean` procesado
- **THEN** la cabecera no tiene la tabla `Date ranges of this batch`: los rangos están en la columna `Date range` de `Totals by type`

### Requirement: Pantalla Settlement Summary: totales y amount payable auditable
La pantalla SHALL mostrar los movimientos E/I/R, los totales de las cinco categorías con cantidad, importe, fee y rango de fechas, los totales por marca, `reservesReleasedQty` con el rango R, y las nueve líneas de `payableBreakdown` en el orden del API, con su etiqueta, su signo y su importe, hasta `amountPayable`. Toda cifra y todo rango SHALL salir de la vista del API sin recalcularse.

#### Scenario: Desglose de batch-clean
- **GIVEN** la vista del intento de `batch-clean`
- **THEN** ve las líneas `+ Deposits`, `− Chargebacks`, `− Refunds`, `− RDR`, `− Transaction fees`, `− Batch fees`, `− Reserve held`, `+ Reserve released` y `+ Reserve released on chargeback` con los importes de la respuesta y, debajo, **Amount payable** con su `amountPayable`

#### Scenario: Línea en cero
- **GIVEN** la vista con `reserve_early_released` en `0.0000`
- **THEN** la línea aparece con `0.0000`, no se oculta

#### Scenario: Rango de fechas de cada tipo
- **GIVEN** la vista con `dateRanges.APP` de `2026-09-28T00:04:11.000Z` a `2026-10-07T23:58:40.000Z`
- **WHEN** mira `Totals by type`
- **THEN** tiene las columnas `Type`, `Qty`, `Amount USD`, `Fees USD` y `Date range`
- **AND** `Deposits` muestra `2026-09-28 – 2026-10-07`, solo el día de Nueva York, sin hora ni `ET`; `Declined` el rango DEC; `Chargebacks`, `Refunds` y `RDR` el rango I, repetido en cada fila; y `R · Reserve released` el rango R

#### Scenario: Rango nulo
- **GIVEN** una vista con `dateRanges.R = null`
- **THEN** la fila `R · Reserve released` muestra `—` como rango

#### Scenario: A 1024 px
- **WHEN** mira `Totals by type` a 1024 px
- **THEN** ninguna cifra ni rango se recorta ni obliga a desplazar la tabla, y cada fecha del rango se lee entera en una línea

### Requirement: Pantalla Settlement Summary: fees, reservas, canales e incidencias
La pantalla SHALL mostrar los fees transaccionales (`transactionalFeeAmt`, `mdrAmt` y su tasa), cada fee por batch con su origen y su usuario, las reservas retenida, liberada y liberada por chargeback, los canales asociados en el intento, el resumen de incidencias de la corrida, `skipped` y las advertencias.

#### Scenario: Fee ajustado con mi usuario (criterio 2 del issue)
- **GIVEN** `batch-clean` procesado por `analyst` con `Wire Fee` ajustado a `30.0000`
- **THEN** ve `Wire Fee · From file · 30.0000 · entered by analyst`

#### Scenario: Canal asociado
- **GIVEN** la vista con `RAM-07` en `channelsAssigned` como `new_primary`
- **THEN** ve `RAM-07 · assigned to this account as primary`

#### Scenario: Cuenta anterior de otro comercio
- **GIVEN** la vista con `RAM-03` como `primary_moved_from` y `previousAccount = { accountId: null, name: null, outOfScope: true }`
- **THEN** ve `RAM-03 · primary account moved here from an account of another merchant`

#### Scenario: Intento sin resumen de incidencias
- **GIVEN** la vista con `validationSummary = null` (un intento sin auditoría de `settlement.process`, como el historial sembrado)
- **THEN** ve `The validation summary of this attempt is not available.` y el enlace al paso Analysis, sin contadores

#### Scenario: Incidencias
- **GIVEN** `validationSummary = { persistent: 13, resolved: 2, blocking: 0, resolvedMissing: 4 }`
- **THEN** ve `13 persistent · 2 resolved · 0 blocking · 4 missing resolved by this batch` con un enlace al paso Analysis del import

### Requirement: Pantalla Settlement Summary: recarga por su enlace
Al abrir o recargar `/settlements/<batchId>`, la pantalla SHALL pedir `GET /settlements/{batchId}`. Un `404` SHALL mostrar `Settlement not found` con un enlace a Dashboard.

#### Scenario: Recargar
- **GIVEN** `analyst` en el Settlement Summary del batch recién procesado
- **WHEN** recarga la página
- **THEN** se pide `GET /settlements/<batchId>` y ve el mismo intento

#### Scenario: Intento inexistente o fuera del alcance
- **WHEN** `GET /settlements/<batchId>` responde `404`
- **THEN** ve `Settlement not found` y un enlace a Dashboard

### Requirement: Pantalla Settlement Summary: descargas
La pantalla SHALL ofrecer **Merchant summary**, **Transactions (CSV)** y **Reserves (CSV)** a quien tenga `reports.view`. Mientras las descargas del API no existan, SHALL mostrarlas deshabilitadas con su motivo. Disponibles, cada una SHALL descargar el archivo con el nombre identificado por intento, y descargar SHALL NOT cambiar nada en pantalla. Junto a los CSV del Back-Office SHALL avisar de que no se abren con Excel antes de subirlos.

#### Scenario: Antes de las descargas del API
- **GIVEN** las descargas aún no disponibles
- **THEN** los tres botones están deshabilitados con `Downloads are not available yet.` asociado a cada uno, y no hay enlaces de descarga

#### Scenario: Descargar los tres (criterio 3 del issue)
- **GIVEN** las descargas disponibles y un intento `processed`
- **WHEN** `analyst` pulsa los tres botones
- **THEN** se descargan `ProviderA-USD_B123_A1_summary.csv`, `ProviderA-USD_B123_A1_transactions.csv` y `ProviderA-USD_B123_A1_reserves.csv` y el estado sigue `Processed · pending payment`

#### Scenario: Aviso de Excel en los CSV del Back-Office
- **GIVEN** las descargas disponibles
- **THEN** junto a los botones se lee que los CSV se suben al Back-Office tal como se descargan, sin abrirlos ni guardarlos con Excel, y que para mirarlos se usa Data → From Text/CSV con la columna ID como Text
- **AND** ese aviso describe **Transactions (CSV)** y **Reserves (CSV)**, y no **Merchant summary**

#### Scenario: Sin reports.view
- **GIVEN** un usuario sin `reports.view`
- **THEN** no ve los botones de descarga

### Requirement: Pantalla Settlement Summary: solo lectura
`viewer` SHALL poder abrir Settlement Summary de un intento de su alcance y verlo entero, sin acciones que escriban.

#### Scenario: viewer
- **WHEN** `viewer` abre el Settlement Summary del intento de `batch-clean`
- **THEN** ve el intento, los totales, el desglose, los fees y las descargas que su permiso admite, y ningún botón de pagar, retirar el pago ni deshacer

### Requirement: Pantallas de settlement: fechas en hora de Nueva York
Las fechas de negocio SHALL mostrarse con los dígitos recibidos, sin convertir: las que solo son un día (`settlementDate`, vigencias de los fees, `expectedReserveReleaseAt`) y los rangos de `Totals by type` (`dateRanges`, solo el día) sin sufijo de zona, y las que llevan hora (`eventDate` de los movimientos) con sufijo `ET`. Las de auditoría (`processedAt`, también en Settlement List) SHALL convertirse de UTC a la hora de Nueva York con sufijo `ET`. Ninguna SHALL depender de la zona del navegador.

#### Scenario: Fechas del intento
- **GIVEN** `settlementDate = "2026-10-24"`, `dateRanges.APP.min = "2026-09-28T00:04:11.000Z"` y `processedAt = "2026-10-19T15:40:03.120Z"`, con el navegador en otra zona
- **THEN** ve `2026-10-24`, sin `ET`, el rango de `Deposits` empezando en `2026-09-28`, sin hora ni `ET`, y `2026-10-19 11:40 ET`

#### Scenario: Fechas de la lista y de los movimientos
- **GIVEN** una fila de Settlement List con `settlementDate = "2026-10-24"` y `processedAt = "2026-10-19T15:40:03.120Z"`, y un movimiento con `eventDate = "2026-09-28T00:04:11.000Z"`, con el navegador en otra zona
- **THEN** la fila muestra `2026-10-24`, sin `ET`, y `2026-10-19 11:40 ET`, y el movimiento `2026-09-28 00:04 ET`

#### Scenario: Vigencia de un fee preestablecido
- **GIVEN** un fee preestablecido con `startDate = "2026-01-01"` y sin `endDate`
- **WHEN** `analyst` lo ve al añadirlo en Settlement Review
- **THEN** su vigencia empieza en `2026-01-01`, sin `ET`

### Requirement: Pantallas de settlement: teclado y motivos
Todas las acciones de Settlement Review, Settlement Summary (con sus dos pestañas) y Settlement List SHALL poder hacerse solo con teclado. Todo botón deshabilitado SHALL llevar su motivo en texto visible asociado con `aria-describedby`.

#### Scenario: Procesar con teclado
- **WHEN** `analyst` recorre Settlement Review con Tab, Enter y Espacio
- **THEN** puede editar el número, añadir y quitar fees, marcar la casilla de canales y pulsar **Process**, y cada botón deshabilitado anuncia su motivo

#### Scenario: Summary con teclado
- **GIVEN** las descargas disponibles
- **WHEN** `analyst` recorre el Settlement Summary con Tab
- **THEN** llega a **Merchant summary**, **Transactions (CSV)**, **Reserves (CSV)**, **View the validations** y **Back to Dashboard**

#### Scenario: Lista y movimientos con teclado
- **WHEN** `viewer` recorre Settlement List con Tab, flechas, Enter y Espacio
- **THEN** elige la cuenta, el estado, la fecha que filtra y las fechas, cambia de página, abre un batch, pasa a **Movements**, cambia de ciclo y abre el desglose de un movimiento, y **Previous** / **Next** deshabilitados anuncian su motivo

### Requirement: Settlements de una cuenta
`GET /api/v1/accounts/{id}/settlements` SHALL responder `200` con los intentos de la cuenta en cualquier estado, del más reciente al más antiguo por `processedAt` (luego `batchNo` e intento descendentes), paginados (`page` desde 1, `pageSize` 1–500, 50 por defecto) y con `total`. Cada intento SHALL traer batch, intento, estado, `settledStatus`, `settlementDate`, `processedAt`, quién lo aprobó, `amountPayable` como texto y canales.

#### Scenario: Historia sembrada de ProviderA-USD
- **GIVEN** el seed recién sembrado
- **WHEN** `analyst` pide los settlements de ProviderA-USD sin filtros
- **THEN** recibe `total = 22`, todos con `status = paid` y `settledStatus = settled`, el primero el batch 122 y el último el 101, cada uno con `attemptNo = 1`, `approvedBy.userName = analyst`, su `settlementDate` como `YYYY-MM-DD` y `amountPayable` con cuatro decimales

#### Scenario: Los 68 batches pagados del seed
- **GIVEN** el seed recién sembrado
- **WHEN** `analyst` (merchants 1 y 2) pide con `status=paid` los settlements de las cinco cuentas
- **THEN** la suma de sus `total` es 68

#### Scenario: Intento recién procesado
- **GIVEN** `batch-clean` procesado como batch 123
- **WHEN** se piden los settlements de ProviderA-USD
- **THEN** el primero es el batch 123, intento 1, con `status = processed` y `settledStatus = pending_payment`, y el segundo el 122

#### Scenario: Paginación estable
- **GIVEN** el seed recién sembrado
- **WHEN** se piden las páginas 1, 2 y 3 de ProviderA-USD con `pageSize = 10`
- **THEN** traen 10, 10 y 2 intentos, ninguno repetido, y repetir una página devuelve los mismos en el mismo orden

#### Scenario: Cuenta sin settlements
- **GIVEN** una cuenta del alcance sin intentos
- **WHEN** se piden sus settlements
- **THEN** recibe `200` con `items = []` y `total = 0`

### Requirement: Filtros de los settlements de una cuenta
`status` SHALL filtrar por estado (`processed`, `paid`, `undone`). `from` y `to` SHALL ser días `YYYY-MM-DD` inclusivos sobre la fecha de `dateField`: con `settlementDate` (por defecto), la columna sin convertir, y sin ella el intento queda fuera; con `processedAt`, el día de calendario en Nueva York del instante, con cambio de hora. Un `status` o `dateField` desconocido, una fecha mal formada o `from` posterior a `to` SHALL responder `400 validation_error`.

#### Scenario: Por estado
- **GIVEN** el seed recién sembrado, sin ningún batch procesado
- **WHEN** se piden los settlements de ProviderA-USD con `status=processed`
- **THEN** la lista está vacía, y con `status=paid` trae los 22

#### Scenario: Por fecha de liquidación
- **GIVEN** la `settlementDate` del batch 122 de ProviderA-USD leída de la lista
- **WHEN** se piden con `from` y `to` iguales a esa fecha
- **THEN** la lista trae solo el batch 122

#### Scenario: Rango abierto por un lado
- **GIVEN** la `settlementDate` del batch 112 de ProviderA-USD
- **WHEN** se piden con solo `from` igual a esa fecha
- **THEN** la lista trae los batches 112 a 122 y ninguno anterior

#### Scenario: Por día de procesado en Nueva York
- **GIVEN** un intento procesado en `2026-10-21T03:59:59Z` (23:59:59 del 20 en Nueva York) y otro en `2026-10-21T04:00:00Z` (medianoche del 21)
- **WHEN** se piden con `dateField=processedAt&from=2026-10-20&to=2026-10-20`
- **THEN** la lista trae solo el primero, y con `from=2026-10-21&to=2026-10-21` solo el segundo

#### Scenario: Cambio de hora del 1 de noviembre de 2026
- **GIVEN** un intento procesado en `2026-11-02T04:30:00Z` (23:30 EST del 1 de noviembre) y otro en `2026-11-02T05:00:00Z` (medianoche EST del 2)
- **WHEN** se piden con `dateField=processedAt&from=2026-11-01&to=2026-11-01`
- **THEN** la lista trae solo el primero, y con `from=2026-11-02&to=2026-11-02` solo el segundo

#### Scenario: Filtros inválidos
- **WHEN** se piden con `status=settled`, con `dateField=createdAt`, con `from=24/10/2026`, con `from=2026-02-30` o con `from=2026-10-24&to=2026-10-01`
- **THEN** responde `400` con `code = "validation_error"`

### Requirement: Alcance de los settlements de una cuenta
La lectura SHALL exigir autenticación y ningún permiso propio, de modo que `viewer` la usa. Sin token SHALL responder `401 unauthorized` antes de mirar la cuenta. Una cuenta inexistente o de un merchant fuera del alcance del usuario SHALL responder el mismo `404 not_found` (`"Account not found"`), y un identificador que no es UUID, `400 validation_error`.

#### Scenario: viewer en su alcance
- **WHEN** `viewer` (solo merchant 1) pide los settlements de ProviderA-USD
- **THEN** recibe `200` con los mismos intentos que `analyst`

#### Scenario: Cuenta de otro merchant
- **WHEN** `viewer` pide los settlements de ProviderC-Alt (merchant 2)
- **THEN** recibe el mismo `404` con `code = "not_found"` que para un `accountId` inexistente

#### Scenario: Sin token
- **WHEN** se piden sin `Authorization`
- **THEN** responde `401` con `code = "unauthorized"`

### Requirement: Pantalla Settlement List: llegar a la lista
La entrada **Settlements › Settlement List** del menú SHALL llevar a `/settlements`, donde se elige merchant → proveedor → cuenta, incluidas las cerradas. Un único valor posible SHALL preseleccionarse. La cuenta elegida, los filtros y la página SHALL guardarse en la dirección, de modo que recargar o compartir el enlace muestra lo mismo. Sin cuenta elegida no se SHALL pedir ningún settlement.

#### Scenario: Desde el menú
- **GIVEN** `analyst` en Dashboard
- **WHEN** pulsa **Settlement List**
- **THEN** ve `Settlement List`, las migas `Dashboard › Settlements › Settlement List`, los selectores de merchant, proveedor y cuenta y `Choose an account to see its settlements.`, y no se ha pedido ningún settlement

#### Scenario: Un solo merchant y un solo proveedor
- **GIVEN** un usuario cuyo alcance tiene un merchant y ese merchant un único proveedor
- **WHEN** abre la lista
- **THEN** merchant y proveedor llegan elegidos y la dirección los lleva

#### Scenario: Enlace con la cuenta
- **WHEN** `analyst` abre `/settlements?accountId=<ProviderA-USD>`
- **THEN** ve elegidos Merchant A, Provider A y ProviderA-USD y la lista de sus settlements

#### Scenario: Cuenta fuera del alcance por enlace
- **WHEN** `viewer` abre `/settlements?accountId=<ProviderC-Alt>`
- **THEN** ve que la cuenta no está disponible, sin lista y sin decir si existe

### Requirement: Pantalla Settlement List: columnas
Cada fila SHALL mostrar el batch, el intento, el estado (`Processed · pending payment`, `Paid` o `Undone`), la fecha de liquidación, quién lo procesó y cuándo, el amount payable alineado a la derecha y los canales, tal como llegan del API. Ninguna cifra SHALL calcularse, sumarse ni reformatearse más allá del separador de miles. Un intento `undone` SHALL verse atenuado.

#### Scenario: Batch sembrado
- **GIVEN** la lista de ProviderA-USD del seed
- **THEN** la primera fila muestra `122`, `1`, `Paid`, su fecha de liquidación sin sufijo de zona, `analyst` con el instante de procesado en ET, su `amountPayable` con separador de miles y sus canales

#### Scenario: Sin fecha de liquidación
- **GIVEN** un intento con `settlementDate = null`
- **THEN** su celda dice `Not set`

#### Scenario: Importe sin pasar por number
- **GIVEN** un intento con `amountPayable = "123456789012345.1234"`
- **THEN** se ve `123,456,789,012,345.1234`

### Requirement: Pantalla Settlement List: filtros y paginación
La pantalla SHALL ofrecer el estado (`All statuses` por defecto, `Processed · pending payment`, `Paid`, `Undone`), el desplegable **Date** (`Settlement date` por defecto, `Processed (ET)`) y las fechas **From** y **To**, que se envían tal cual como `YYYY-MM-DD`, y SHALL paginar en el servidor. Cambiar un filtro SHALL volver a la página 1. Con **From** posterior a **To** SHALL avisar en el campo y no pedir la lista.

#### Scenario: Filtrar por estado
- **GIVEN** la lista de ProviderA-USD
- **WHEN** elige `Paid`
- **THEN** se pide con `status=paid&page=1` y la dirección lo lleva

#### Scenario: Filtrar por fechas
- **WHEN** elige **From** `2026-09-01` y **To** `2026-09-30`
- **THEN** se pide con `from=2026-09-01&to=2026-09-30`, sin convertir de zona y sin `dateField`

#### Scenario: Filtrar por día de procesado
- **WHEN** elige **Date** `Processed (ET)` con **From** `2026-10-20`
- **THEN** se pide con `dateField=processedAt&from=2026-10-20&page=1`, sin convertir de zona, y la dirección lo lleva; al recargar, **Date** sigue en `Processed (ET)`

#### Scenario: Rango al revés
- **WHEN** elige **From** `2026-10-24` y **To** `2026-10-01`
- **THEN** ve `The start date must not be after the end date.` en el campo y no se pide la lista

#### Scenario: Dos páginas
- **GIVEN** los 22 batches de ProviderA-USD y 20 por página
- **WHEN** pulsa **Next**
- **THEN** ve `Page 2 of 2 · 22 settlements`, los batches 102 y 101, y **Next** deshabilitado

#### Scenario: Sin resultados
- **GIVEN** filtros que no dejan ningún intento
- **THEN** ve `No settlements match these filters.`

### Requirement: Pantalla Settlement List: abrir el Settlement Summary
El batch de cada fila SHALL ser un enlace a `/settlements/<batchId>`, con nombre accesible `Batch <batchNo> · attempt <attemptNo>`. El Settlement Summary SHALL ofrecer un enlace de vuelta a la lista de su cuenta.

#### Scenario: Abrir un batch sembrado
- **GIVEN** la lista de ProviderA-USD
- **WHEN** `analyst` pulsa `Batch 122 · attempt 1`
- **THEN** ve su Settlement Summary con `Paid` y sin el aviso de no Settled

#### Scenario: Volver a la lista
- **GIVEN** el Settlement Summary de un intento de ProviderA-USD
- **WHEN** pulsa **Settlements of ProviderA-USD**
- **THEN** vuelve a `/settlements` con ProviderA-USD elegida

### Requirement: Pantalla Settlement List: carga y errores
Mientras se pide la lista SHALL verse un estado de carga. Un error SHALL mostrarse con **Retry**, sin vaciar los filtros. Un `404` de la cuenta SHALL mostrarse como cuenta no disponible.

#### Scenario: Error de red
- **WHEN** la lectura de la lista falla
- **THEN** ve `The settlements could not be loaded.` con **Retry**, y los filtros siguen en la dirección

#### Scenario: Cuenta que deja de estar disponible
- **WHEN** la lectura responde `404`
- **THEN** ve que la cuenta no está disponible

### Requirement: Settlement List y Movements: anchos
Las tablas de Settlement List y de Movements SHALL caber a 1280 y a 1024 px sin desplazamiento horizontal ni columnas recortadas. Los textos SHALL poder partirse en líneas; los importes y el ID de transacción nunca SHALL partirse ni recortarse, y las etiquetas de canales solo SHALL partirse tras una coma, sin cambiar ni quitar un carácter.

#### Scenario: Lista a 1024 px
- **GIVEN** el intento recién procesado de ProviderA-USD, con los canales `RAM-01,RAM-02,RAM-07`
- **WHEN** la ventana mide 1024 px
- **THEN** se ven las siete columnas sin desplazarse; el estado, quién y cuándo y los canales pueden ocupar dos líneas, y el amount payable sigue en una línea

#### Scenario: Movimientos a 1024 px
- **GIVEN** los movimientos E e I de `batch-clean`, con el desglose de un fee abierto
- **WHEN** la ventana mide 1024 px
- **THEN** se ven las nueve columnas sin desplazarse y ningún importe ni ID de transacción se parte en dos líneas

### Requirement: Pantalla Settlement Summary: pestaña Movements
El Settlement Summary SHALL tener las pestañas **Summary** y **Movements**. **Movements** SHALL mostrar los movimientos del ciclo elegido (E, I o R, con E por defecto) en el orden del API, paginados en el servidor, con transacción, estado, ronda, fila de origen, fecha del evento, importe, fees con su desglose, reservas (en una columna **Reserves**) y Settled, tal como llegan. Pestaña, ciclo y página SHALL guardarse en la dirección.

#### Scenario: Reservas en una columna
- **GIVEN** un movimiento con `reserveHeldAmt = "11.5240"`, `reserveReleasedAmt = "7.2500"`, `reserveEarlyReleasedAmt = "1.1000"` y `expectedReserveReleaseAt = "2027-03-27T00:04:11.000Z"`
- **THEN** las columnas son **Transaction**, **Status**, **Round**, **Source row**, **Event date**, **Amount**, **Fees**, **Reserves** y **Settled**, y **Reserves** muestra `Held 11.5240`, `Released 7.2500`, `Released on chargeback 1.1000` y `Expected release 2027-03-27 ET`

#### Scenario: Movimientos E de batch-clean
- **GIVEN** `batch-clean` procesado
- **WHEN** `analyst` abre **Movements**
- **THEN** se pide `type=E&page=1`, ve los ciclos `E (450)`, `I (10)` y `R (320)` con los contadores de la vista y `Page 1 of 9 · 450 movements`

#### Scenario: Ajustes con su desglose
- **GIVEN** la pestaña **Movements**
- **WHEN** elige `I`
- **THEN** se pide `type=I&page=1`, ve los 10 movimientos con su estado, su ronda y su `feeAmount`, y al abrir el desglose de uno ve cada fee con su título y su `amountUsd`

#### Scenario: Movimiento sin fecha ni fila
- **GIVEN** un movimiento con `eventDate = null` y uno sembrado con `sheetId = null`
- **THEN** el primero dice `Undated` en la fecha y el segundo `—` en la fila de origen

#### Scenario: Settled según el intento
- **GIVEN** un batch sembrado `paid` y un intento `processed`
- **THEN** los movimientos del primero dicen `Settled` y los del segundo `Pending payment`

#### Scenario: Recargar en Movements
- **WHEN** recarga `/settlements/<batchId>?tab=movements&cycle=R&page=2`
- **THEN** ve **Movements** con `R` y la página 2

#### Scenario: Error al leer movimientos
- **WHEN** la lectura de movimientos falla
- **THEN** ve `The movements could not be loaded.` con **Retry**, y la pestaña **Summary** sigue disponible

### Requirement: Pantalla Settlement List: solo lectura
`viewer` SHALL poder usar la lista y las dos pestañas del Settlement Summary de las cuentas de su alcance. La lista SHALL NOT ofrecer pagar, retirar el pago, deshacer ni exportar para ningún usuario, y `viewer` SHALL NOT hacer peticiones de escritura desde estas pantallas.

#### Scenario: viewer recorre la lista y los movimientos
- **WHEN** `viewer` abre la lista de ProviderA-USD, abre el batch 122 y su pestaña **Movements**
- **THEN** ve lo mismo que `analyst` salvo las acciones del intento, sin botones de pagar, retirar el pago, deshacer ni exportar la lista, y no sale ninguna petición que no sea `GET`

#### Scenario: Las acciones no están en la lista
- **WHEN** `payments` o `analyst` abren la lista de ProviderA-USD
- **THEN** ninguna fila ofrece pagar, retirar el pago ni deshacer: se hace desde el intento

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
- **THEN** totales, `amountPayable`, fees, movimientos, `settlementStatusId` y los exports `transactions` y `reserves` son los mismos, el export `summary` solo cambia en sus líneas `Status` y `Payment`, que dicen el estado actual, y en la vista solo cambian el estado y los campos de pago

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
- **GIVEN** un undo que falla después de reabrir los faltantes y superar la corrida
- **WHEN** termina
- **THEN** el intento sigue `processed`, el import `processed` con su `currentBatchId`, la corrida vigente, los faltantes `resolved` y sin auditoría `settlement.undo`

#### Scenario: Un intento deshecho no cuenta como anterior
- **GIVEN** un intento `undone`
- **WHEN** otro import del proveedor se valida con las mismas transacciones
- **THEN** no hay `duplicate_across_batches` ni `status_collision_across_batches` contra ese intento

#### Scenario: Intento procesado que no es el vigente
- **GIVEN** datos inconsistentes: un intento `processed` que no es el `currentBatchId` de su import
- **WHEN** se deshace
- **THEN** responde `409 settlement_not_current` y no escribe nada

### Requirement: Alcance y permisos de las acciones del intento
`pay`, `unpay` y `undo` SHALL responder `401 unauthorized` sin token, `403 forbidden` sin su permiso (antes de mirar el alcance), `400 validation_error` con un id que no es UUID, y el mismo `404 not_found` (`"Settlement not found"`) para un intento inexistente o de un merchant fuera del alcance. El id y el cuerpo SHALL validarse antes que la autenticación y el permiso, como en el resto del API: una petición inválida responde `400` sea quien sea quien la envía.

#### Scenario: Sin permiso
- **WHEN** `viewer` llama a cualquiera de las tres, `analyst` a `pay` o `unpay`, o `payments` a `undo`
- **THEN** con un cuerpo válido recibe `403` con `code = "forbidden"`, aunque el intento no exista

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
- **GIVEN** un `undo` del batch 118 sin confirmar y un proceso de otro import de la cuenta con `batchNo = 118` esperando a que el `undo` confirme, en sus lecturas de los intentos o en el bloqueo del número
- **WHEN** el `undo` confirma
- **THEN** el proceso crea el intento 2 del batch 118, y el `undo` no ha dejado rastro en él

#### Scenario: Ida y vuelta entre la guarda y la lectura
- **GIVEN** una acción cuya guarda no escribió nada y un intento que, al releerlo, admite esa acción porque otra lo cambió y otra lo devolvió
- **WHEN** termina
- **THEN** responde `409 settlement_busy` y no escribe nada

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
