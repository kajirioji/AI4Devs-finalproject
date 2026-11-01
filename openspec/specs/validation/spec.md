# validation

## Purpose
Las ocho validaciones sobre un import analizado, sus rangos, hallazgos y decisiones de inclusión. README §3.3, §3.2 (ValidationRun, ValidationResult, ValidationIssue, ConflictOccurrence), HU2.

## Requirements

### Requirement: Ocho validaciones en orden fijo
Una corrida SHALL producir exactamente ocho resultados con `validationCode` en este orden: provider_mismatch, non_recorded_adjustment, duplicate_in_batch, status_collision_in_batch, duplicate_across_batches, status_collision_across_batches, missing_previous_to_batch, missing_in_range; cada uno con `outcome` ∈ passed | warning | blocked | not_applicable | not_implemented y `issueCount`. Una corrida nueva SHALL marcar la anterior como superada sin borrarla.

#### Scenario: Batch limpio
- **WHEN** se valida `data/samples/batch-clean` (o `batch-split`, con el mismo resultado)
- **THEN** las ocho validaciones son `passed` (o `not_applicable` donde no hay rango) con `issueCount = 0`
- **AND** ninguna es `warning`, `blocked` ni `not_implemented`

#### Scenario: Batch con incidencias
- **WHEN** se valida `data/samples/batch-issues`
- **THEN** los conteos coinciden con `expected.validations` y los IDs con `expected.affectedIds`
- **AND** `non_recorded_adjustment` tiene `issueCount = 3`: 1 hallazgo `non_recorded_adjustment` y 2 `status_mismatch`
- **AND** las validaciones con hallazgos son `warning` y ninguna es `blocked`

#### Scenario: Orden y forma del informe
- **WHEN** se valida cualquier import analizado
- **THEN** el informe trae ocho resultados, uno por código, en el orden fijo, aunque alguno no tenga hallazgos

### Requirement: Solo provider_mismatch bloquea
`provider_mismatch` SHALL ser el único hallazgo con `blocking = 1`; con uno o más, el import no puede procesarse y la única salida es cancelar. Las demás validaciones SHALL permitir continuar con una decisión única para todo el import, registrada con el usuario.

#### Scenario: Canal de otro proveedor
- **WHEN** se valida `data/samples/batch-blocked`
- **THEN** `provider_mismatch = 1`, su resultado es `blocked`, el resultado global es `blocked = true` y el botón de continuar no está disponible

#### Scenario: Advertencias no bloquean
- **WHEN** se valida `data/samples/batch-issues`
- **THEN** ningún hallazgo tiene `blocking = 1` y el resultado global es `blocked = false`

### Requirement: Clave de duplicado y colisión
Duplicados y colisiones SHALL evaluarse por `(transactionId, cycle)`: mismo estado → duplicado; estados distintos del mismo ciclo → colisión. Las apariciones SHALL guardarse en `ConflictOccurrence` (N por hallazgo). Valores por defecto de inclusión: duplicate in_batch → primera incluida; duplicate across_batches → actual excluida; collision in_batch → todas incluidas; collision across_batches → actual incluida. El analista puede cambiar la inclusión y queda auditado.

#### Scenario: Duplicado en el batch con sus dos apariciones
- **GIVEN** `data/samples/batch-issues`, donde la transacción `441706751475644` aparece dos veces en la hoja APP
- **WHEN** se valida
- **THEN** hay un hallazgo `duplicate` / `in_batch` en ciclo E con dos apariciones `current_import`, la primera con `defaultIncluded = true` y la segunda con `defaultIncluded = false`

#### Scenario: E y su reserva R no se comparan
- **GIVEN** una transacción con una fila en APP (ciclo E) y otra en RR (ciclo R) del mismo import
- **WHEN** se valida
- **THEN** no se produce ningún duplicado ni colisión

#### Scenario: Colisión en el batch
- **GIVEN** `data/samples/batch-issues`, donde `911545593909470` aparece en APP y en DEC
- **WHEN** se valida
- **THEN** hay un hallazgo `collision` / `in_batch` en ciclo E con dos apariciones (`Successful` y `Declined`), ambas incluidas por defecto

### Requirement: Aparición histórica de un movimiento concreto
Una aparición histórica SHALL corresponder a un movimiento concreto, también cuando su batch tiene varios de la misma clave.

#### Scenario: Dos movimientos históricos de la misma clave en un batch
- **GIVEN** un batch vigente con dos movimientos I `Chargeback` de la misma transacción, el segundo con `excludeAmount` (`CHB 2`), y un import nuevo que trae un `Refund` de esa transacción
- **WHEN** se valida y se abre el detalle de la colisión
- **THEN** cada aparición histórica muestra su propia hoja, fila y `excludeAmount`

### Requirement: Ciclo R sin estado
En el ciclo R el estado no cuenta, porque la reserva no tiene estado: dos apariciones R de la misma transacción SHALL ser siempre duplicado, nunca colisión, en el batch y contra el histórico.

#### Scenario: Dos filas RR de la misma transacción
- **GIVEN** un import con dos filas RR de la misma transacción, una con estado `Successful` y otra con `Chargeback`
- **WHEN** se valida
- **THEN** hay un `duplicate` / `in_batch` (la primera incluida, la segunda excluida) y ninguna colisión

### Requirement: Rangos y faltantes
Los rangos APP, DEC, I y R SHALL derivarse de las filas asociadas del batch. `missing_previous_to_batch` SHALL listar transacciones de los canales de la cuenta anteriores al rango de su ciclo sin liquidar; `missing_in_range`, las que caen dentro del rango y no vienen en el archivo. Para R, las candidatas son las reservas retenidas vencidas no liberadas ni liberadas anticipadamente. DEC vacía SHALL no abrir rango DEC. Transacciones `Pending` SHALL contarse aparte (informativo).

#### Scenario: Declinadas del primer día omitidas
- **GIVEN** `data/samples/batch-issues`, donde el archivo omite todas las DEC del 2026-09-28
- **THEN** `missing_previous_to_batch.E = 10` y `missing_in_range.E = 3`, `missing_in_range.R = 3`, con los IDs de `affectedIds.missing_previous_to_batch_DEC`, `missing_in_range_E` y `missing_in_range_R`

#### Scenario: Rangos de un batch completo
- **WHEN** se valida `data/samples/batch-clean`
- **THEN** los rangos son APP 2026-09-28…2026-10-07, DEC 2026-09-28…2026-10-07, I 2026-09-28…2026-10-11 y R 2026-09-27…2026-10-06 (`expected.ranges`; R por fecha de vencimiento de la reserva, creación + `rollingReserveDays`)

#### Scenario: Sin declinadas en el archivo
- **GIVEN** un import sin filas `Declined`
- **WHEN** se valida
- **THEN** no hay rango DEC y ninguna transacción `Declined` se evalúa como faltante

### Requirement: Los hallazgos persisten
Un faltante SHALL registrarse una sola vez por proveedor, ciclo y transacción y pasar a `resolved` cuando un batch `processed` posterior de cualquier cuenta del proveedor lo incluya; volver a `persistent` si ese batch se deshace. Cuentan como ya registrados solo los faltantes persistentes de imports que tienen un `SettlementBatch` `processed` o `paid`; los de imports sin procesar o cuyo batch está `undone` SHALL seguir saliendo como faltantes.

#### Scenario: Faltante ya registrado por un import procesado
- **GIVEN** una transacción `Declined` anterior al rango DEC que figura como faltante persistente del proveedor en ciclo E, registrado por la corrida vigente de otro import que tiene un batch `processed`
- **WHEN** se valida un import nuevo de una cuenta del proveedor
- **THEN** esa transacción no vuelve a aparecer como hallazgo `missing`

#### Scenario: Faltante de un import sin procesar
- **GIVEN** la misma transacción registrada como faltante solo por la corrida de otro import que aún no tiene batch
- **WHEN** se valida un import nuevo de una cuenta del proveedor
- **THEN** la transacción aparece como hallazgo `missing`

#### Scenario: Faltante de un import cuyo batch se deshizo
- **GIVEN** la misma transacción registrada como faltante por un import cuyo único batch está `undone`
- **WHEN** se valida un import nuevo de una cuenta del proveedor
- **THEN** la transacción aparece como hallazgo `missing`

#### Scenario: Corrida repetida del mismo import
- **GIVEN** una corrida anterior del mismo import, sin procesar, que encontró faltantes
- **WHEN** se valida de nuevo el import
- **THEN** los mismos faltantes vuelven a aparecer en la corrida nueva

#### Scenario: Resuelto por un batch processed de otra cuenta
- **GIVEN** un faltante persistente de la transacción X en ciclo E, en la corrida vigente de un import de ProviderA-USD
- **WHEN** se procesa un batch de ProviderA-EUR (mismo proveedor) que incluye a X en E
- **THEN** el hallazgo pasa a `resolved` con `resolvedInBatchId` de ese batch y `resolvedAt`, sin `resolvedByUserId` (no es una resolución a mano)

### Requirement: Resolución y reapertura en la transacción del batch
La resolución y la reapertura SHALL ocurrir dentro de la transacción que procesa o deshace el batch y afectar solo a hallazgos de corridas vigentes.

#### Scenario: Hallazgo de una corrida superada
- **GIVEN** el mismo faltante en una corrida ya superada y no en la vigente
- **WHEN** se procesa el batch que incluye a X en E
- **THEN** el hallazgo de la corrida superada sigue `persistent`

#### Scenario: Reapertura al deshacer
- **GIVEN** un faltante resuelto por el batch B
- **WHEN** se deshace B (la reapertura se ejecuta dentro de esa transacción)
- **THEN** el hallazgo vuelve a `persistent` con `resolvedInBatchId` y `resolvedAt` vacíos; los hallazgos resueltos por otros batches o a mano no cambian

#### Scenario: Fallo del procesamiento
- **GIVEN** un proceso que resolvería un faltante y falla después
- **WHEN** termina
- **THEN** el faltante sigue `persistent`

### Requirement: Resultado derivado de los hallazgos
El `outcome` de cada validación SHALL derivarse de sus hallazgos: `passed` sin hallazgos; `warning` con hallazgos y ninguno bloqueante; `blocked` con al menos un hallazgo `blocking`; `not_applicable` cuando no hay movimientos o histórico sobre los que correr; `not_implemented` si la validación no existe. `not_applicable` y `not_implemented` nunca cuentan como aprobadas. El resultado global SHALL ser `blocked` si alguna validación lo es.

#### Scenario: Validación con advertencias
- **WHEN** `duplicate_in_batch` produce un hallazgo no bloqueante
- **THEN** su `outcome` es `warning` e `issueCount = 1`

#### Scenario: Validación sin hallazgos
- **WHEN** `provider_mismatch` corre sobre filas asociadas y no encuentra ninguna de otro proveedor
- **THEN** su `outcome` es `passed`

#### Scenario: No implementada no aprueba
- **WHEN** una validación aún no implementada forma parte del informe
- **THEN** su `outcome` es `not_implemented`, no cuenta como aprobada y el informe sigue teniendo ocho resultados

#### Scenario: Ya no existe failed
- **WHEN** se produce cualquier informe
- **THEN** ningún `outcome` vale `failed`

### Requirement: provider_mismatch
Una fila `matched` cuya transacción pertenece a un proveedor distinto del de la cuenta del import SHALL producir un hallazgo `provider_mismatch`, `blocking`, con la fila de origen, `transactionIdRaw`, `transactionId`, ciclo y el estado reportado en la fila. Esa fila SHALL quedar fuera de las validaciones 2–8 y de los rangos. Sin filas `matched`, el resultado es `not_applicable`.

#### Scenario: Transacción de un canal de otro proveedor
- **GIVEN** `data/samples/batch-blocked` (cuenta ProviderB-Main) con una fila de RAM-01 (Provider A)
- **WHEN** se valida
- **THEN** hay un hallazgo `provider_mismatch` con `transactionIdRaw = 252570479111759` y `blocking = 1`

#### Scenario: La fila ajena no alimenta otras validaciones
- **GIVEN** una fila de otro proveedor repetida dos veces en APP
- **WHEN** se valida
- **THEN** producen hallazgos `provider_mismatch` pero ningún `duplicate`, y su fecha no amplía el rango APP

### Requirement: Nada de otro merchant en el informe
Ningún hallazgo ni aparición del informe SHALL contener canal, cuenta, importe, fecha ni estado del gateway de una transacción de otro proveedor; de ella solo SHALL figurar `transactionId` y lo que trae la propia fila del archivo. El histórico de todas las cuentas del proveedor sí aparece (es del mismo merchant).

#### Scenario: Transacción de otro merchant
- **GIVEN** una fila de la cuenta ProviderB-Main (merchant 1) asociada a una transacción de Provider C (merchant 2)
- **WHEN** se valida
- **THEN** el hallazgo `provider_mismatch` no incluye el canal, el proveedor, el importe, la fecha ni el estado de esa transacción

### Requirement: non_recorded_adjustment
La validación `non_recorded_adjustment` SHALL detectar, sobre filas del proveedor de la cuenta, las filas cuyo estado reportado no cuadra con el del gateway, con dos `issueType`: `non_recorded_adjustment` en ciclo I y `status_mismatch` en ciclo E. Ambos SHALL ser no bloqueantes, con la fila incluida por defecto, llevar el estado reportado y el del gateway, y resolverse a mano tras verificar el gateway. Sin ninguna fila `matched`, de cualquier ciclo, el resultado es `not_applicable`.

#### Scenario: Sin filas de ciclo I pero con filas asociadas
- **GIVEN** `data/samples/batch-blocked`, sin filas de ciclo I y con 20 filas APP del proveedor de la cuenta
- **WHEN** se valida
- **THEN** `non_recorded_adjustment` es `passed`, no `not_applicable`

#### Scenario: Sin filas asociadas
- **GIVEN** un import sin ninguna fila `matched`
- **WHEN** se valida
- **THEN** `non_recorded_adjustment` es `not_applicable`

### Requirement: Ajuste no registrado en ciclo I
Una fila de ciclo I cuya transacción está en el gateway en un estado de ciclo natural E (`Pending`, `Successful`, `Declined`) SHALL producir un hallazgo `issueType = non_recorded_adjustment`.

#### Scenario: Chargeback de una aprobación nunca liquidada
- **GIVEN** `data/samples/batch-issues`, con un chargeback de RAM-13 cuya transacción sigue `Successful` en el gateway
- **WHEN** se valida
- **THEN** hay un hallazgo `non_recorded_adjustment` para `281520820250015` con `blocking = 0`

### Requirement: status_mismatch en ciclo E
Una fila E reportada `Declined` cuya transacción está `Successful`, `Chargeback`, `Refund` o `RDR` en el gateway, o reportada `Successful` cuya transacción está `Declined`, SHALL producir un hallazgo `issueType = status_mismatch`. Una fila E con el gateway en `Pending` SHALL no compararse, y una fila reportada `Successful` cuya transacción está en estado de ciclo I SHALL no producir hallazgo (ronda 1).

#### Scenario: Declinada en el archivo, aprobada en el gateway
- **GIVEN** `data/samples/batch-issues`, donde `911545593909470` (también en APP) y `381797111970492` (liquidada `Successful` en el batch anterior) vienen en DEC y están `Successful` en el gateway
- **WHEN** se valida
- **THEN** hay dos hallazgos `status_mismatch` en ciclo E, uno por fila DEC, con `blocking = 0`, estado reportado `Declined` y estado del gateway `Successful`
- **AND** siguen existiendo la `collision` / `in_batch` de `911545593909470` y la `collision` / `across_batches` de `381797111970492`
- **AND** `non_recorded_adjustment` es `warning` con `issueCount = 3`

#### Scenario: Aprobada en el archivo, declinada en el gateway
- **GIVEN** una fila APP cuya transacción está `Declined` en el gateway
- **WHEN** se valida
- **THEN** hay un hallazgo `status_mismatch` en ciclo E con la fila incluida por defecto

#### Scenario: Ronda 1 no es discrepancia
- **GIVEN** `data/samples/batch-clean`, con filas APP cuya transacción ya pasó a `Chargeback` o `Refund`
- **WHEN** se valida
- **THEN** `non_recorded_adjustment` es `passed` con `issueCount = 0`

#### Scenario: Gateway Pending en E
- **GIVEN** una fila DEC y una fila APP cuyas transacciones están `Pending` en el gateway
- **WHEN** se valida
- **THEN** no hay hallazgo `status_mismatch` para ellas

### Requirement: Colisiones permitidas y CHB 2
Approved + Declined en E y Refund + Chargeback en I SHALL ser colisión con advertencia, nunca bloqueo. Un `Chargeback` y un `Chargeback` con `excludeAmount` (`CHB 2`) del mismo movimiento SHALL no generar hallazgo, ni en el batch ni contra el histórico; dos `CHB 2` del mismo movimiento son duplicado y `CHB 2` frente a `Refund` es colisión.

#### Scenario: Refund y Chargeback del mismo movimiento
- **GIVEN** un import con un `Refund` y un `Chargeback` de la misma transacción en ciclo I
- **WHEN** se valida
- **THEN** hay un hallazgo `collision` / `in_batch` no bloqueante con las dos apariciones incluidas

#### Scenario: Chargeback y CHB 2 en el mismo archivo legacy
- **GIVEN** un archivo legacy con `CHB` y `CHB 2` de la misma transacción en la hoja `CB`
- **WHEN** se valida
- **THEN** no hay duplicado ni colisión para esa transacción

#### Scenario: Chargeback, CHB 2 y Refund del mismo movimiento
- **GIVEN** un import con un `Chargeback`, un `CHB 2` y un `Refund` de la misma transacción en ciclo I
- **WHEN** se valida
- **THEN** hay una sola `collision` / `in_batch` con las tres apariciones incluidas, y ningún `duplicate`

#### Scenario: Colisión contra el histórico con un CHB 2 liquidado
- **GIVEN** un `Chargeback` en el import y, en batches vigentes anteriores, un `CHB 2` y un `Refund` de la misma transacción
- **WHEN** se valida
- **THEN** hay una `collision` / `across_batches` que lista la aparición actual (incluida), el `CHB 2` y el `Refund` históricos, igual que la colisión en el batch

#### Scenario: CHB 2 contra un Chargeback ya liquidado
- **GIVEN** un `CHB 2` en el import y un `Chargeback` sin `excludeAmount` de la misma transacción en un batch vigente anterior
- **WHEN** se valida
- **THEN** no hay `duplicate_across_batches` ni `status_collision_across_batches`

#### Scenario: Muestra legacy
- **WHEN** se valida `data/samples/legacy-provider`
- **THEN** la fila `df14616d-4b26-4ffb-9984-72717ebff6a6` cuenta como `Chargeback` con `excludeAmount` y no produce duplicado ni colisión
- **AND** `missing_previous_to_batch` cuenta I = 3 (los refunds de la ventana omitidos de la hoja `CB` con cambio de estado anterior al rango I, `affectedIds.missing_previous_to_batch_I`) y las demás validaciones no tienen hallazgos

### Requirement: Grupos de tres o más apariciones
Dentro de una clave `(transactionId, cycle)` del batch, cada estado repetido SHALL producir un `duplicate` (primera aparición incluida, demás excluidas) y la presencia de estados distintos SHALL producir una `collision` con la primera aparición de cada estado, todas incluidas, para que ninguna aparición se cuente dos veces. La primera aparición es la del archivo subido antes, la hoja anterior en el libro y el `rowNo` menor.

#### Scenario: Dos aprobaciones y una declinación
- **GIVEN** la misma transacción dos veces en APP y una en DEC
- **WHEN** se valida
- **THEN** hay un `duplicate` / `in_batch` (dos apariciones `Successful`, la segunda excluida) y una `collision` / `in_batch` (la primera `Successful` y la `Declined`, ambas incluidas)

### Requirement: Estado no resuelto en duplicados y colisiones
Una aparición cuyo estado no se pudo resolver (`status_unresolved`) SHALL compararse como un estado distinto de cualquier otro, incluido otro no resuelto: frente a otra aparición de la misma `(transactionId, cycle)`, del batch o de un batch anterior vigente, SHALL producir una colisión no bloqueante con todas las apariciones actuales incluidas, y nunca un duplicado. Ninguna aparición se excluye en silencio.

#### Scenario: Estado no resuelto frente a una aprobación del batch
- **GIVEN** una transacción con una fila APP `Successful` y otra fila E de la misma transacción cuyo estado no se resolvió
- **WHEN** se valida
- **THEN** hay una `collision` / `in_batch` con las dos apariciones incluidas, la segunda sin estado, y ningún `duplicate`

#### Scenario: Dos apariciones sin estado
- **GIVEN** dos filas E de la misma transacción con el estado sin resolver
- **WHEN** se valida
- **THEN** hay una `collision` / `in_batch` con las dos apariciones incluidas

#### Scenario: Estado no resuelto frente al histórico
- **GIVEN** una fila E sin estado resuelto de una transacción liquidada en E en un batch vigente anterior
- **WHEN** se valida
- **THEN** hay una `collision` / `across_batches` con la aparición actual incluida y ningún `duplicate_across_batches`

### Requirement: Comparación con batches anteriores
Las filas del import SHALL compararse por `(transactionId, cycle)` con los movimientos de los intentos no deshechos (`processed` o `paid`) de todas las cuentas del proveedor: mismo estado → `duplicate_across_batches` (actual excluida, histórica como evidencia); estado distinto → `status_collision_across_batches` (actual incluida). Sin intentos anteriores del proveedor, ambas son `not_applicable`.

#### Scenario: Aprobación ya liquidada
- **GIVEN** `data/samples/batch-issues`, donde `504712738863260` ya está en E en el batch anterior de ProviderB-Main
- **WHEN** se valida
- **THEN** hay un `duplicate` / `across_batches` con la aparición `previous_batch` (batch e intento) y la aparición `current_import` excluida por defecto

#### Scenario: Aprobación anterior reportada como declinada
- **GIVEN** `data/samples/batch-issues`, donde `381797111970492` se liquidó `Successful` en el batch anterior y ahora viene en DEC
- **WHEN** se valida
- **THEN** hay una `collision` / `across_batches` con la aparición actual incluida

#### Scenario: Reserva ya liberada que vuelve en RR
- **GIVEN** un movimiento R de un batch vigente anterior con estado `Successful` y, en el import, una fila RR de la misma transacción cuyo estado actual es `Chargeback`
- **WHEN** se valida
- **THEN** hay un `duplicate` / `across_batches` con la fila actual excluida por defecto, y ninguna `collision` (la reserva no se libera dos veces)

#### Scenario: Batch deshecho
- **GIVEN** una transacción cuyo único movimiento E anterior pertenece a un intento `undone`
- **WHEN** se valida un import que la incluye en APP
- **THEN** no hay hallazgo *across batches* para ella

#### Scenario: Otra cuenta del mismo proveedor
- **GIVEN** una transacción liquidada en E en un batch vigente de ProviderA-EUR
- **WHEN** se valida un import de ProviderA-USD que la incluye en APP
- **THEN** hay un `duplicate` / `across_batches` cuya aparición histórica es de ese batch

#### Scenario: Sin batches anteriores
- **GIVEN** un proveedor sin ningún intento no deshecho
- **WHEN** se valida
- **THEN** `duplicate_across_batches` y `status_collision_across_batches` son `not_applicable`

### Requirement: Filas que forman cada rango
APP SHALL formarse con las filas E asociadas cuya transacción no está `Declined` ni `Pending` en el gateway (fecha de creación); DEC con las filas E cuya transacción está `Declined` (fecha de creación); I con las filas I cuya transacción está en el gateway en el mismo estado que la fila (fecha del último cambio de estado); R con las filas R (vencimiento de la reserva: creación + `rollingReserveDays` de su canal). Las filas I sin fecha válida se cuentan aparte, de forma informativa.

#### Scenario: Declinada en el archivo, aprobada en el gateway
- **GIVEN** `data/samples/batch-issues`, donde una transacción de la ventana anterior, `Successful` en el gateway, viene en DEC
- **WHEN** se calculan los rangos
- **THEN** esa fila no adelanta el mínimo de DEC, que sigue siendo 2026-09-29

#### Scenario: Ajuste sin fecha
- **GIVEN** una fila de ciclo I cuya transacción está `Successful` en el gateway
- **WHEN** se calculan los rangos
- **THEN** la fila no aporta fecha al rango I y el informe la cuenta en `undatedAdjustmentCount`

### Requirement: Candidatas a faltante
Las candidatas SHALL ser transacciones de los canales cuya cuenta principal es la del import: APP `Successful`, DEC `Declined`, I en estado de ciclo I y R movimientos E vigentes con reserva vencida, sin liberación anticipada. Una reserva vence en su creación + `rollingReserveDays` de su canal, y se compara por esa fecha con el rango R, también de vencimiento. Se excluyen las presentes en el batch o procesadas en ese ciclo en un intento vigente del proveedor y las ya registradas.

#### Scenario: Canal sin asignar presente en el import
- **GIVEN** `data/samples/batch-issues`, donde también faltan las DEC de RAM-13 (sin cuenta) del 2026-09-28
- **WHEN** se valida
- **THEN** solo cuentan las 10 de RAM-11 y RAM-12: `missing_previous_to_batch.E = 10`

#### Scenario: Reserva vencida antes del rango R
- **GIVEN** un movimiento E vigente con `reserveHeldAmt > 0`, sin liberación anticipada ni movimiento R, cuya reserva venció antes del mínimo del rango R
- **WHEN** se valida un import que no lo trae en RR
- **THEN** es `missing_previous_to_batch` en R, con su fecha de vencimiento como `relevantDate`

#### Scenario: Reserva todavía no vencida
- **GIVEN** la misma reserva con fecha de vencimiento posterior al máximo del rango R
- **WHEN** se valida
- **THEN** no aparece en ninguna de las dos validaciones de faltantes

#### Scenario: Cuenta con plazos de retención mezclados
- **GIVEN** una cuenta con un canal de 180 días y otro de 120, filas RR de ambos y una reserva de 180 días creada entre esas filas que aún no ha vencido
- **WHEN** se valida un import que no la trae en RR
- **THEN** no aparece como faltante: el rango R y la reserva se comparan por fecha de vencimiento

#### Scenario: Reserva liberada anticipadamente
- **GIVEN** un movimiento E vigente con `reserveHeldAmt > 0` y `reserveEarlyReleasedAmt > 0`, con vencimiento dentro del rango R
- **WHEN** se valida un import que no lo trae en RR
- **THEN** no es faltante de R

#### Scenario: Posterior al máximo
- **GIVEN** una transacción `Successful` sin liquidar con fecha posterior al máximo del rango APP
- **WHEN** se valida
- **THEN** no aparece en ninguna de las dos validaciones de faltantes

#### Scenario: Límites inclusivos
- **GIVEN** candidatas con fecha igual al mínimo y al máximo del rango APP
- **WHEN** se valida
- **THEN** ambas son `missing_in_range`, y una con fecha anterior al mínimo es `missing_previous_to_batch`

### Requirement: Candidatas sin el histórico liquidado
La fuente de candidatas SHALL devolver solo transacciones no procesadas en ese ciclo en un intento vigente del proveedor, para que su volumen no crezca con el histórico; el motor SHALL volver a comprobarlo y descartar cualquier candidata procesada que reciba.

#### Scenario: Candidata ya procesada devuelta por error
- **GIVEN** una candidata `Successful` con fecha dentro del rango APP que tiene un movimiento E en un intento vigente del proveedor
- **WHEN** la fuente de candidatas la devuelve de todos modos y se valida
- **THEN** no es faltante

### Requirement: Faltantes por rango y por ciclo
Cada hallazgo `missing` SHALL llevar ciclo, rango (APP, DEC, I o R), `missingType` (`previous_to_batch` o `in_range`), `relevantDate` y el estado esperado. Los conteos SHALL poder leerse por rango y por ciclo (E = APP + DEC). Si ningún ciclo tiene rango, ambas validaciones de faltantes son `not_applicable`.

#### Scenario: Conteo por ciclo
- **WHEN** se valida `data/samples/batch-issues`
- **THEN** `missing_previous_to_batch` cuenta E 10 / I 0 / R 0 (las 10 en el rango DEC) y `missing_in_range` E 3 / I 0 / R 3 (las 3 de E en el rango APP)

#### Scenario: Sin rangos
- **GIVEN** un import sin ninguna fila asociada de ciclo E, I ni R del proveedor
- **WHEN** se valida
- **THEN** `missing_previous_to_batch` y `missing_in_range` son `not_applicable`

### Requirement: Plazo de retención de una reserva
El vencimiento de una reserva SHALL calcularse con el plazo vigente de su canal (`Channel.rollingReserveDays`), no con el aplicado al liquidar (`SettlementTransaction.reserveDaysUsed`, `expectedReserveReleaseAt`); el plazo de un canal no cambia con el tiempo, así que el vigente coincide con el aplicado. La fuente de reservas retenidas SHALL filtrar con el mismo cálculo que el motor.

#### Scenario: Fuente y motor con el mismo vencimiento
- **GIVEN** una reserva retenida de un canal de 120 días cuyo vencimiento (creación + 120 días) cae dentro del rango R
- **WHEN** la fuente carga las reservas retenidas con `rMax` del rango R y se valida
- **THEN** la fuente la devuelve y el motor la clasifica `missing_in_range`, con el mismo vencimiento en los dos

### Requirement: Candidatas I sin fecha
Una candidata I sin `lastStatusChangedAt` SHALL no producir hallazgo y SHALL contarse, una vez por transacción, en `undatedCandidateCount`, de forma informativa. La fuente de candidatas SHALL devolverlas (`lastStatusChangedAt <= máximo` o NULL).

#### Scenario: Ajuste sin fecha de cambio
- **GIVEN** una transacción `Chargeback` de un canal de la cuenta sin `lastStatusChangedAt`, con rango I en el import
- **WHEN** se valida
- **THEN** no aparece en ninguna validación de faltantes y `undatedCandidateCount = 1`

### Requirement: Pending aparte
Las transacciones `Pending` SHALL excluirse de los faltantes y contarse en `pendingInRangeCount`: las de los canales de la cuenta con fecha de creación dentro del rango APP o del DEC, una vez cada una.

#### Scenario: Pending dentro del rango
- **GIVEN** dos transacciones `Pending` de un canal de la cuenta con fecha dentro del rango APP
- **WHEN** se valida
- **THEN** no hay hallazgo `missing` para ellas y `pendingInRangeCount = 2`

### Requirement: Motor puro sobre una entrada explícita
Las validaciones SHALL ejecutarse sin base de datos ni HTTP, sobre una entrada que contiene: filas del import con los datos de su transacción, cuenta (proveedor y canales), movimientos de intentos no deshechos del proveedor, transacciones candidatas, faltantes ya registrados y catálogo de estados. La misma entrada SHALL producir siempre el mismo informe.

#### Scenario: Muestras sin base de datos
- **WHEN** se construye la entrada de cada muestra a partir del mundo sintético del seed y se valida
- **THEN** los resultados coinciden con su `expected.json` sin conectarse a SQL Server

#### Scenario: Determinismo
- **WHEN** se valida dos veces la misma entrada, con las filas en distinto orden de llegada
- **THEN** los dos informes son idénticos, incluido el orden de hallazgos y apariciones

### Requirement: Rendimiento del motor
Validar 2 000 filas contra 50 000 movimientos anteriores SHALL tardar menos de 2 segundos en el motor (sin contar la carga desde la base, que mide el caso de uso), medido en local y anotado en el PR. En CI la aserción SHALL tener margen (menos de 4 segundos) para no ser intermitente.

#### Scenario: Volumen de referencia
- **GIVEN** una entrada generada con 2 000 filas, 50 000 movimientos anteriores y unas 25 000 transacciones candidatas
- **WHEN** se ejecutan las ocho validaciones
- **THEN** terminan en menos de 2 s en local
- **AND** el test de CI afirma menos de 4 s

### Requirement: Ejecutar una corrida
`POST /api/v1/imports/{id}/validations` SHALL exigir `settlement.process`, ejecutar las ocho validaciones con los datos de la base, guardar la corrida con sus resultados, hallazgos y apariciones, marcar como superada la vigente anterior sin borrarla y responder `201`. SHALL aceptarse en `analyzed` o `validated` (P1); en `validated`, el import vuelve a `analyzed` en la misma transacción. En otro estado, `409 import_not_analyzed` con `details.status`.

#### Scenario: Corrida de batch-issues
- **GIVEN** `batch-issues` analizado en `ProviderB-Main`
- **WHEN** `analyst` llama a `POST /api/v1/imports/{id}/validations`
- **THEN** recibe `201` con ocho resultados en el orden fijo cuyos conteos coinciden con `expected.validations`, `blocked = false` y los rangos de la corrida
- **AND** en base hay una `ValidationRun` con `isSuperseded = 0`, ocho `ValidationResult` y 23 `ValidationIssue`, todos `persistent`

#### Scenario: Dos corridas seguidas
- **GIVEN** un import `analyzed` con una corrida vigente
- **WHEN** se ejecuta otra corrida
- **THEN** la anterior queda con `isSuperseded = 1` y conserva sus resultados, hallazgos y apariciones, y la nueva es la única con `isSuperseded = 0` (HU2 CA1)

#### Scenario: Re-validar un import validado
- **GIVEN** `batch-issues` `validated` con la corrida 1 revisada por `analyst`
- **WHEN** `analyst` llama a `POST validations`
- **THEN** recibe `201` con la corrida 2 e `importStatus = "analyzed"`, la corrida 1 queda superada y su revisión, invalidada (spec "Invalidación de la revisión", motivo `rerun`)

#### Scenario: Import que no está analizado ni validado
- **WHEN** se llama a `POST validations` sobre un import en `uploaded`, `mapped`, `processed` o `cancelled`
- **THEN** recibe `409` con `code = "import_not_analyzed"` y `details.status`, y no se crea ninguna corrida

#### Scenario: Sin permiso o fuera del alcance
- **WHEN** `viewer` llama a `POST validations`, o `analyst` lo llama sobre un import de otro merchant o inexistente
- **THEN** recibe `403 forbidden` en el primer caso y `404 not_found` idéntico en los otros dos

### Requirement: Una sola corrida vigente por import
Un import SHALL tener como máximo una corrida con `isSuperseded = 0`, también ante peticiones simultáneas. Una corrida SHALL persistirse solo si el import no cambió desde que empezó a calcularse; si cambió, SHALL responder `409 import_changed` con `details.status` sin escribir nada.

#### Scenario: Dos corridas simultáneas
- **GIVEN** un import `analyzed`
- **WHEN** dos peticiones `POST validations` se solapan
- **THEN** una recibe `201` y la otra `409 import_changed` (o `201` si empezó después de que la primera confirmara)
- **AND** al terminar hay exactamente una corrida con `isSuperseded = 0`

#### Scenario: Cambio de inclusión mientras se calcula una corrida
- **GIVEN** una corrida en cálculo sobre un import `analyzed`
- **WHEN** antes de que se persista se confirma un `PATCH` de inclusión en el mismo import
- **THEN** la corrida recibe `409 import_changed` y el cambio de inclusión se conserva

### Requirement: Qué se guarda de cada hallazgo
Cada hallazgo SHALL guardarse con su tipo, alcance, bloqueo, movimiento, ciclo, estado y, si es un faltante, `missingType` y `relevantDate`; SHALL conservar además, para releerlos, el rango del faltante (APP, DEC, I o R), el estado del gateway de un `non_recorded_adjustment` o `status_mismatch` y la fila de origen de los hallazgos de una sola fila. Cada aparición SHALL guardarse con `includeInSettlement = defaultIncluded`.

#### Scenario: Faltantes E distinguibles por rango
- **GIVEN** la corrida guardada de `batch-issues`
- **WHEN** se leen sus hallazgos `missing`
- **THEN** los 10 de `missing_previous_to_batch` tienen rango `DEC` y los 3 E de `missing_in_range` rango `APP`, con los IDs de `affectedIds`, aunque los 13 tengan `cycle = E`

#### Scenario: Estado del gateway y fila de origen
- **GIVEN** la corrida guardada de `batch-issues`
- **WHEN** se lee el hallazgo `non_recorded_adjustment` de `281520820250015`
- **THEN** trae el estado reportado, el estado del gateway `Successful` y el archivo, la hoja y la fila de origen

#### Scenario: Inclusión inicial
- **GIVEN** la corrida guardada de `batch-issues`
- **WHEN** se leen sus apariciones
- **THEN** todas tienen `includeInSettlement = defaultIncluded`, sin usuario ni fecha de cambio, y las de `441706751475644` son una incluida y otra excluida

#### Scenario: Aparición sin estado resuelto
- **GIVEN** una colisión con una aparición cuyo estado no se resolvió
- **WHEN** se guarda la corrida
- **THEN** esa aparición queda con estado nulo y `includeInSettlement = true`

#### Scenario: Contadores informativos
- **GIVEN** un import con una fila I sin fecha de cambio de estado y una candidata I sin fecha
- **WHEN** se guarda la corrida
- **THEN** la corrida conserva `pendingInRangeCount`, `undatedAdjustmentCount = 1` y `undatedCandidateCount = 1`, y la lectura los devuelve

### Requirement: Aparición histórica con su fila
Una aparición `previous_batch` SHALL llevar el batch (número, intento, estado y cuenta) y, cuando el movimiento histórico la tiene, la hoja y la fila de las que salió; si el movimiento no tiene fila, ambas SHALL ser nulas.

#### Scenario: Movimiento histórico con fila
- **GIVEN** un movimiento E de un batch vigente anterior con hoja y fila de su import
- **WHEN** un import nuevo trae la misma transacción en APP y se valida
- **THEN** el `duplicate` / `across_batches` tiene una aparición `previous_batch` con `batchNo`, `attemptNo`, esa hoja, su archivo y esa fila

#### Scenario: Movimiento histórico sin fila
- **GIVEN** un movimiento histórico sin hoja ni fila
- **WHEN** se valida un import que colisiona con él
- **THEN** su aparición `previous_batch` tiene archivo, hoja y fila nulos y conserva el batch y el intento

### Requirement: Leer la corrida vigente
`GET /api/v1/imports/{id}/validations` SHALL devolver, con autenticación y dentro del alcance, el estado del import, su corrida vigente (autor y fecha, ocho resultados con `outcome`, `issueCount` y si bloquean, `blocked`, rangos APP, DEC, I y R, contadores informativos, `manualChangeCount` y la revisión vigente si la hay) y la última revisión invalidada del import. Sin corrida vigente, la corrida SHALL ser `null`.

#### Scenario: Import validado de batch-issues
- **GIVEN** `batch-issues` con una corrida revisada
- **WHEN** `viewer` lee las validaciones
- **THEN** recibe `200` con `importStatus = "validated"`, la corrida con sus ocho resultados y la revisión con el usuario `analyst` y su fecha

#### Scenario: Import sin corrida
- **GIVEN** un import `analyzed` que nunca se validó
- **WHEN** se leen sus validaciones
- **THEN** recibe `200` con `run = null` y `lastInvalidatedReview = null`

#### Scenario: Cambios manuales contados
- **GIVEN** la corrida vigente de `batch-issues` con una aparición cuya inclusión cambió y el `non_recorded_adjustment` resuelto a mano
- **WHEN** se leen sus validaciones
- **THEN** `run.manualChangeCount = 2`; si la aparición se devuelve a su valor por defecto, baja a 1

#### Scenario: Import ajeno
- **WHEN** `viewer` lee las validaciones de un import de `ProviderC-Alt`, o de un id inexistente
- **THEN** recibe `404 not_found` idéntico en los dos casos

### Requirement: Listar los hallazgos de la corrida vigente
`GET /api/v1/imports/{id}/validation-issues` SHALL devolver, paginados, los hallazgos de la corrida vigente, filtrables por `type`, `scope`, `status`, `validationCode` y `cycle`, cada uno con su resolución y el número de apariciones incluidas por defecto y actualmente. Orden fijo: orden de las validaciones, ciclo, rango, `relevantDate`, `transactionIdRaw` e id. Sin corrida vigente, la lista SHALL estar vacía.

#### Scenario: Filtrar los duplicados en el batch
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** se piden `?type=duplicate&scope=in_batch`
- **THEN** recibe `200` con `total = 1` y el hallazgo de `441706751475644`, con 2 apariciones, 1 incluida por defecto

#### Scenario: Faltantes persistentes
- **WHEN** se piden `?type=missing&status=persistent&pageSize=50`
- **THEN** recibe los 16 faltantes de `batch-issues` en el orden fijo

#### Scenario: Filtro inválido
- **WHEN** se pide `?type=failed`
- **THEN** recibe `400 validation_error`

### Requirement: Detalle de un hallazgo
`GET /api/v1/validation-issues/{id}` SHALL devolver el hallazgo con todas sus apariciones (import actual y batches anteriores) con archivo, hoja, fila, estado, si está incluida por defecto y ahora, y el usuario y la fecha del último cambio; la resolución con usuario, fecha y nota; y el historial de cambios de inclusión y de resolución con usuario y fecha. Un hallazgo de una corrida superada SHALL leerse indicándolo.

#### Scenario: Colisión en el batch
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** se abre la `collision` / `in_batch` de `911545593909470`
- **THEN** ve dos apariciones `current_import` con su archivo, hoja `APP` y `DEC`, fila, estado `Successful` y `Declined`, ambas incluidas por defecto y ahora, sin usuario de cambio, y un historial vacío (HU2 CA2)

#### Scenario: Después de cambiar una inclusión
- **GIVEN** que `analyst` excluyó y luego volvió a incluir una aparición
- **WHEN** se abre su hallazgo
- **THEN** la aparición muestra `analyst` y la fecha del último cambio, y el historial trae los dos cambios con el valor anterior y el nuevo, el usuario y la fecha

#### Scenario: Hallazgo de una corrida superada
- **WHEN** se abre un hallazgo de una corrida superada
- **THEN** recibe `200` con `run.isCurrent = false`

#### Scenario: Id ajeno, inexistente o malformado
- **WHEN** se pide un hallazgo de un import de otro merchant, uno inexistente o `abc`
- **THEN** recibe `404 not_found` idéntico en los dos primeros casos y `400 validation_error` en el tercero

### Requirement: Nada de otro merchant en las lecturas
Las respuestas de corrida, lista y detalle SHALL limitarse a lo que guarda el informe: de una transacción de otro proveedor solo SHALL figurar `transactionId` y lo que trae la fila del archivo; nunca su canal, cuenta, importe, fecha ni estado del gateway.

#### Scenario: Hallazgo provider_mismatch de batch-blocked
- **GIVEN** la corrida vigente de `batch-blocked`
- **WHEN** se abre el hallazgo `provider_mismatch` de `252570479111759`
- **THEN** trae `transactionId`, `transactionIdRaw`, ciclo, estado reportado y la fila de origen, y no trae canal, proveedor, importe, fecha ni estado del gateway

### Requirement: Cambiar la inclusión de una aparición
`PATCH /api/v1/conflict-occurrences/{id}` con `{ includeInSettlement }` SHALL exigir `settlement.process`, admitirse solo en apariciones `current_import` (P2) de la corrida vigente de un import `analyzed` o `validated` (P4), guardar el valor con el usuario y la fecha, registrarlo en `AuditLog` con el valor anterior y responder `200` con el detalle del hallazgo. En `validated`, el import SHALL volver a `analyzed` en la misma transacción. El hallazgo SHALL seguir existiendo y con el mismo estado.

#### Scenario: Incluir el duplicado excluido
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** `analyst` pone `includeInSettlement = true` en la segunda aparición de `441706751475644`
- **THEN** recibe `200` con el detalle del hallazgo, en el que esa aparición tiene `includeInSettlement = true`, `defaultIncluded = false`, `changedBy.userName = "analyst"` y `changedAt`, y el historial trae el cambio
- **AND** hay una fila de `AuditLog` con `action = "validation.occurrence.set_inclusion"`, `entityId` = id de la aparición y `detailJson` con `from = false`, `to = true`, `issueId` y `runId`
- **AND** el hallazgo `duplicate` sigue `persistent`

#### Scenario: Mismo valor
- **WHEN** se envía el valor que ya tiene la aparición
- **THEN** recibe `200` con el detalle sin cambios y no se escribe nada en `AuditLog`

#### Scenario: Aparición histórica
- **WHEN** se intenta cambiar una aparición `previous_batch`
- **THEN** recibe `409 occurrence_not_editable` con `details.sourceType = "previous_batch"` (P2)

#### Scenario: Import ya revisado
- **GIVEN** `batch-issues` `validated` con la corrida vigente revisada
- **WHEN** `analyst` cambia una inclusión
- **THEN** recibe `200` con `importStatus = "analyzed"`, la corrida sigue vigente, el cambio queda guardado y la revisión, invalidada con motivo `inclusion_change` (P4)

#### Scenario: Import en otro estado
- **WHEN** se intenta cambiar una inclusión con el import en `processed` o `cancelled`
- **THEN** recibe `409 import_not_editable` con `details.status`

#### Scenario: Corrida superada
- **WHEN** se intenta cambiar una aparición de una corrida superada
- **THEN** recibe `409 validation_run_superseded` con `details.runId` y `details.currentRunId`

#### Scenario: Duplicado de ajuste o de E incluido a mano
- **GIVEN** un `duplicate` de ciclo I o E, en el batch o contra un batch anterior, con la aparición actual excluida
- **WHEN** `analyst` la incluye
- **THEN** recibe `200` y el cambio queda auditado; cómo se liquida lo decide el procesamiento (P3)

### Requirement: Una reserva se incluye una sola vez
En ciclo R (la reserva no tiene estado y no se libera dos veces), un hallazgo SHALL tener como máximo una aparición incluida, y ninguna aparición `current_import` SHALL incluirse si el hallazgo tiene una aparición `previous_batch`. Incluir otra SHALL responder `409 occurrence_not_includable` con `details.reason` sin cambiar nada (P3). Excluir siempre se admite.

#### Scenario: Segunda fila RR de la misma reserva
- **GIVEN** un `duplicate` / `in_batch` de ciclo R con la primera aparición incluida y la segunda excluida
- **WHEN** `analyst` incluye la segunda
- **THEN** recibe `409 occurrence_not_includable` con `details.reason = "reserve_already_included"`
- **AND** si antes excluye la primera, incluir la segunda responde `200`

#### Scenario: Reserva ya liberada en un batch anterior
- **GIVEN** un `duplicate` / `across_batches` de ciclo R con la aparición actual excluida y una `previous_batch`
- **WHEN** `analyst` incluye la aparición actual
- **THEN** recibe `409 occurrence_not_includable` con `details.reason = "reserve_already_released"`

#### Scenario: Excluir una reserva
- **WHEN** `analyst` excluye la aparición incluida de un hallazgo de ciclo R
- **THEN** recibe `200` y el hallazgo queda sin ninguna aparición incluida

### Requirement: Invalidación de la revisión
Una corrida nueva sobre un import `validated` o un cambio de inclusión sobre un import `validated` SHALL devolverlo a `analyzed` en la misma transacción y registrar en `AuditLog` la revisión invalidada: la corrida revisada, quién y cuándo revisó, quién y cuándo la invalidó y el motivo (`rerun`, `inclusion_change` o `settlement_undone`, este al deshacer el intento). `GET validations` SHALL devolver la última como `lastInvalidatedReview`.

#### Scenario: Invalidada al re-ejecutar
- **GIVEN** `batch-issues` revisado por `analyst` sobre la corrida 1
- **WHEN** `analyst` ejecuta la corrida 2 y se leen las validaciones
- **THEN** `run.review = null` y `lastInvalidatedReview` trae `runId` = 1, `reviewedBy.userName = "analyst"`, `reviewedAt`, `invalidatedBy`, `invalidatedAt` y `reason = "rerun"`
- **AND** hay una fila de `AuditLog` con `action = "import.review.invalidate"` y `entityId = importId`

#### Scenario: Invalidada al cambiar una inclusión
- **GIVEN** un import `validated`
- **WHEN** se cambia una inclusión y se leen las validaciones
- **THEN** `importStatus = "analyzed"`, la corrida es la misma, `run.review = null` y `lastInvalidatedReview.reason = "inclusion_change"` con el `occurrenceId` cambiado

#### Scenario: Nueva revisión tras invalidar
- **GIVEN** una revisión invalidada
- **WHEN** `analyst` revisa de nuevo la corrida vigente
- **THEN** el import pasa a `validated`, `run.review` trae la revisión nueva y `lastInvalidatedReview` sigue trayendo la invalidada

#### Scenario: Sin efecto en un import analizado
- **WHEN** se ejecuta una corrida o se cambia una inclusión con el import en `analyzed`
- **THEN** no se registra ninguna invalidación

#### Scenario: Sin permiso, ajena o cuerpo inválido
- **WHEN** `viewer` hace el `PATCH`, o se envía a una aparición de otro merchant, o con `includeInSettlement = "yes"`
- **THEN** recibe `403 forbidden`, `404 not_found` y `400 validation_error` respectivamente

### Requirement: Resolver a mano un ajuste o una discrepancia de estado
`PATCH /api/v1/validation-issues/{id}` con `{ resolutionStatus: "resolved", note }` (nota de 1 a 500 caracteres) SHALL exigir `settlement.process`, admitirse solo en `non_recorded_adjustment` y `status_mismatch` de la corrida vigente, en cualquier estado del import (P5), pasar el hallazgo a `resolved` con usuario, fecha y nota, auditarlo y responder `200` con el detalle. No SHALL cambiar ninguna inclusión.

#### Scenario: Ajuste verificado en el gateway
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** `analyst` resuelve el `non_recorded_adjustment` de `281520820250015` con la nota `Verified in the gateway`
- **THEN** recibe `200` con `resolutionStatus = "resolved"`, `resolvedBy.userName = "analyst"`, `resolvedAt` y la nota, y la inclusión de la fila no cambia
- **AND** hay una fila de `AuditLog` con `action = "validation.issue.resolve"`, `entityType = "ValidationIssue"` y la nota en `detailJson`

#### Scenario: Ya resuelto
- **WHEN** se resuelve de nuevo el mismo hallazgo
- **THEN** recibe `409 issue_already_resolved` con `details.resolvedAt` y `details.resolvedBy`

#### Scenario: Tipo que no se resuelve a mano
- **WHEN** se intenta resolver un `duplicate`, un `collision`, un `missing` o un `provider_mismatch`
- **THEN** recibe `422 issue_not_resolvable` con `details.issueType`

#### Scenario: Nota vacía o demasiado larga
- **WHEN** se envía `note = ""` o una nota de 501 caracteres
- **THEN** recibe `400 validation_error` y el hallazgo no cambia

#### Scenario: Corrida superada
- **WHEN** se intenta resolver un hallazgo de una corrida superada
- **THEN** recibe `409 validation_run_superseded`

### Requirement: Decisión de conjunto
`POST /api/v1/imports/{id}/review` con `{ runId }` SHALL exigir `settlement.process` y el import en `analyzed`. Solo con la corrida vigente y sin bloqueantes SHALL pasar el import a `validated` y registrar la aprobación en `AuditLog` con el usuario, sin exigir decisión por hallazgo; los hallazgos SHALL seguir `persistent`. Responde `200` con la corrida y la revisión.

#### Scenario: Continuar con advertencias
- **GIVEN** `batch-issues` analizado y validado, con un cambio de inclusión hecho
- **WHEN** `analyst` llama a `POST review` con el `runId` vigente
- **THEN** recibe `200` con `importStatus = "validated"` y la revisión con `analyst` y su fecha
- **AND** los 23 hallazgos siguen `persistent`, el cambio de inclusión sigue guardado y hay una fila de `AuditLog` con `action = "import.review"`, `entityId = importId` y `detailJson` con `runId` y el número de hallazgos por validación (criterio 3 del issue, HU2 CA6)

#### Scenario: Provider mismatch
- **GIVEN** `batch-blocked` analizado y validado
- **WHEN** `analyst` llama a `POST review` con el `runId` vigente
- **THEN** recibe `409 blocking_validation_issue` con un mensaje que dice que el import debe cancelarse y procesarse con el proveedor correcto y `details` con `runId`, `validationCodes = ["provider_mismatch"]` e `issueIds`; el import sigue `analyzed` y no hay forma de forzarlo (HU2 CA5)

#### Scenario: Corrida superada
- **GIVEN** que `analyst` revisó la corrida 1 y después se ejecutó la corrida 2
- **WHEN** envía `POST review` con `runId` = 1
- **THEN** recibe `409 validation_run_superseded` con `details.currentRunId` = 2 y el import sigue `analyzed`

#### Scenario: Sin corrida vigente
- **WHEN** se llama a `POST review` sobre un import `analyzed` sin corrida vigente
- **THEN** recibe `409 validation_run_required`

#### Scenario: Import no analizado
- **WHEN** se llama a `POST review` sobre un import `validated`, `processed` o `cancelled`
- **THEN** recibe `409 import_not_analyzed` con `details.status`

#### Scenario: Sin permiso
- **WHEN** `viewer` llama a `POST review`
- **THEN** recibe `403 forbidden`

### Requirement: Revisión y corrida concurrentes
Un review y una corrida que se solapan sobre el mismo import SHALL serializarse: si el review confirma primero, la corrida SHALL recibir `409 import_changed` (no invalida una revisión confirmada después de que empezara a calcularse); si la corrida confirma primero, el review SHALL recibir `409 validation_run_superseded`. Nunca SHALL quedar un import `validated` cuya corrida vigente no sea la revisada.

#### Scenario: Review y corrida a la vez
- **GIVEN** un import `analyzed` con la corrida 1 vigente
- **WHEN** se solapan `POST review` con `runId` = 1 y `POST validations`
- **THEN** o bien el import queda `validated` con la corrida 1 vigente y la corrida recibe `409 import_changed`, o bien queda `analyzed` con la corrida 2 vigente y el review recibe `409 validation_run_superseded`

### Requirement: Lo hecho a mano no pasa a la corrida siguiente
Una corrida nueva SHALL crear sus hallazgos `persistent` y sus apariciones con la inclusión por defecto, sin heredar los cambios de inclusión ni las resoluciones de la anterior (P6), que SHALL seguir legibles en la corrida superada y en `AuditLog`.

#### Scenario: Re-validar tras cambiar una inclusión
- **GIVEN** una corrida con una aparición cuya inclusión cambió `analyst`
- **WHEN** se ejecuta una corrida nueva
- **THEN** la aparición equivalente de la corrida nueva tiene `includeInSettlement = defaultIncluded` y sin usuario de cambio, la de la corrida superada conserva el cambio y la corrida nueva tiene `manualChangeCount = 0`

### Requirement: Corrida contra la base igual al oráculo
Ejecutada contra SQL Server con el seed, la corrida de cada muestra SHALL coincidir con su `expected.json`, igual que el motor sobre el mundo sintético en memoria.

#### Scenario: Las cinco muestras
- **WHEN** se suben, se parean con la propuesta, se analizan y se validan `batch-clean`, `batch-split`, `batch-issues`, `batch-blocked` y `legacy-provider` en su cuenta
- **THEN** los resultados, conteos, rangos, IDs afectados y `blocked` coinciden con su `expected.json`, leído del disco

### Requirement: Límite exacto del vencimiento en la carga de reservas
La carga de reservas retenidas desde la base SHALL usar el plazo vigente del canal y conservar la precisión de `datetime2`: una reserva que vence exactamente en el máximo del rango R SHALL cargarse y una que vence un milisegundo después no.

#### Scenario: Fuente y motor con el mismo vencimiento contra la base
- **GIVEN** dos reservas retenidas de un canal de 120 días, con creación de milisegundos distintos de cero, una que vence exactamente en el máximo del rango R y otra que vence 1 ms después
- **WHEN** la fuente de la base las carga con ese máximo y se valida
- **THEN** la primera llega y el motor la clasifica `missing_in_range` con el mismo vencimiento; la segunda no llega

#### Scenario: Candidatas I sin fecha desde la base
- **GIVEN** una transacción `Chargeback` de un canal de la cuenta sin fecha de cambio de estado y un rango I en el import
- **WHEN** se valida contra la base
- **THEN** la corrida guarda `undatedCandidateCount = 1` y ningún faltante para ella

#### Scenario: Candidata ya procesada
- **GIVEN** una transacción `Successful` dentro del rango APP con un movimiento E en un intento vigente de otra cuenta del proveedor
- **WHEN** se valida contra la base
- **THEN** la fuente no la devuelve y no es faltante

### Requirement: Rendimiento de extremo a extremo
Validar y guardar una corrida del volumen de referencia, carga desde SQL Server incluida, SHALL tardar menos de 4 segundos, afirmado por el test. La escritura tiene como objetivo menos de 300 ms, registrado en el log sin aserción (288 ms medidos). El objetivo local de 2 segundos no se alcanza en la Entrega 2 y la carga queda pendiente en el issue #50. El test SHALL ejecutarse solo con `RECON_BENCH=1`, nunca en CI, con la máquina tranquila (sin `pnpm dev`).

#### Scenario: Volumen de referencia contra la base
- **GIVEN** `RECON_BENCH=1`, un import analizado de 2 000 filas, 50 000 movimientos anteriores del proveedor en la base y rangos de pocos días (perfil del doc 06)
- **WHEN** se llama a `POST validations`
- **THEN** responde `201` en menos de 4 s, con la carga, el motor y la escritura (y sus fases) registrados por separado
- **AND** el dato medido en la Entrega 2 (2 603 ms, 2 231 de ellos de carga) queda anotado en el PR, sin alcanzar el objetivo de 2 s

#### Scenario: Sin la variable
- **WHEN** se ejecuta la suite de integración sin `RECON_BENCH=1` (también en CI)
- **THEN** el test de rendimiento se omite y no crea fixtures

### Requirement: Caso extremo registrado
El test de rendimiento SHALL ejecutar también un caso extremo (rangos de meses) solo para registrar su tiempo, sin aserción.

#### Scenario: Rangos de meses
- **GIVEN** `RECON_BENCH=1` y un escenario con rangos de meses y ~23 000 hallazgos
- **WHEN** se llama a `POST validations`
- **THEN** responde `201` y su tiempo, con la carga, el motor y la escritura, queda en el log

### Requirement: Pantalla Analysis & Validations: ejecutar la corrida
El paso Analysis de un import `analyzed` o `validated` SHALL ofrecer, con `settlement.process`, **Run validations** (sin corrida vigente) o **Run again** (con ella), que llama a `POST validations` y pinta la corrida devuelta. La pantalla SHALL NOT ejecutar las validaciones por su cuenta: ni al terminar el análisis ni al abrir el paso.

#### Scenario: Sin corrida todavía
- **GIVEN** el import de `batch-issues` analizado y sin corrida vigente
- **WHEN** `analyst` abre el paso Analysis
- **THEN** ve `No validation run yet.` y **Run validations**, y no se ha llamado a `POST validations`

#### Scenario: Primera corrida
- **GIVEN** el import de `batch-issues` analizado y sin corrida
- **WHEN** `analyst` pulsa **Run validations**
- **THEN** se llama una vez a `POST /imports/<importId>/validations` y la pantalla muestra las ocho validaciones de la corrida devuelta y el botón pasa a **Run again**

### Requirement: Pantalla Analysis & Validations: corrida sin doble envío y relectura ante conflicto
Mientras `POST validations` está en curso, **Run validations** / **Run again** y **Continue to settlement review** SHALL estar deshabilitados y un segundo clic SHALL NOT lanzar otra petición. Ante `409 import_changed` o `409 import_not_analyzed`, la pantalla SHALL releer la corrida vigente y el import y decir qué pasó.

#### Scenario: Doble clic
- **WHEN** `analyst` pulsa **Run validations** dos veces seguidas
- **THEN** el API recibe un solo `POST validations` y el botón queda deshabilitado hasta la respuesta

#### Scenario: El import cambió mientras se validaba
- **WHEN** `POST validations` responde `409 import_changed`
- **THEN** ve `The import changed while the validations ran. The results were reloaded.`, se vuelven a pedir `GET validations` y `GET /imports/<importId>`, y **Run again** vuelve a estar habilitado

#### Scenario: El import ya no admite validar
- **WHEN** `POST validations` responde `409 import_not_analyzed` con `status = cancelled`
- **THEN** ve `The validations cannot run on a cancelled import.`, el import se relee y ya no se ofrece **Run again**

### Requirement: Pantalla Analysis & Validations: aviso antes de volver a ejecutar
**Run again** SHALL pedir confirmación cuando la corrida vigente tiene `manualChangeCount > 0` o el import está `validated`. El diálogo SHALL decir cuántos cambios manuales se pierden y, si el import está `validated`, que la revisión quedará invalidada. Desistir SHALL NOT llamar al API. Sin ninguna de las dos condiciones, ejecuta sin diálogo.

#### Scenario: Cambios manuales que se pierden
- **GIVEN** la corrida vigente de `batch-issues` con `manualChangeCount = 2` y el import `analyzed`
- **WHEN** `analyst` pulsa **Run again**
- **THEN** ve `Running the validations again discards 2 manual changes (inclusions and resolutions).` y solo tras confirmar se llama a `POST validations`

#### Scenario: Revisión que se invalidará
- **GIVEN** el import de `batch-issues` `validated` con `manualChangeCount = 0`
- **WHEN** `analyst` pulsa **Run again**
- **THEN** el diálogo dice `The current review will be invalidated and the import returns to analyzed.`

#### Scenario: Desistir
- **WHEN** `analyst` cierra el diálogo de **Run again** sin confirmar
- **THEN** no se llama a `POST validations` y la corrida sigue igual

#### Scenario: Sin nada que perder
- **GIVEN** la corrida vigente con `manualChangeCount = 0` y el import `analyzed`
- **WHEN** `analyst` pulsa **Run again**
- **THEN** se llama a `POST validations` sin diálogo

### Requirement: Pantalla Analysis & Validations: cabecera de la corrida
Con corrida vigente, la pantalla SHALL mostrar junto al título `Validations` la etiqueta `Overall result` y el estado global (`Blocked` si `run.blocked`; si no, `Warnings` si alguna validación es `warning`; si no, `Passed`), seguido en texto secundario del número de corrida con su fecha y su usuario. Debajo SHALL mostrar, en su tarjeta y con el formato de las demás tablas, la tabla `Date ranges used by the validations` con el rango usado por ciclo y estado, salvo con estado `Blocked`, y los contadores informativos `pendingInRangeCount`, `undatedAdjustmentCount` y `undatedCandidateCount`, cada uno con una explicación corta de qué cuenta.

#### Scenario: Corrida con advertencias
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** abre el paso Analysis
- **THEN** ve junto al título `Validations` la etiqueta `Overall result` y `Warnings`, y en texto secundario `Run #<runId>` con su fecha en `ET` y `analyst`
- **AND** ve la tabla `Date ranges used by the validations` con sus seis filas y su rango con fecha y hora mínima y máxima en `ET`, y `Pending in range 0`, `Undated adjustments 1`, `Undated candidates 0`

#### Scenario: Filas de la tabla de rangos
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** mira la tabla de rangos
- **THEN** las filas son, en este orden, `E` `APP` con el rango APP, `E` `DEC` con el rango DEC, `I` `CHB`, `I` `REF` e `I` `RDR` con una sola celda de rango I que abarca las tres, y `R` `—` con el rango R
- **AND** la tabla tiene las columnas `Cycle`, `Status` y `Date range`, sin `Transactions`, porque el API no da el conteo por estado de la corrida (#87)
- **AND** está en una tarjeta con el título `Date ranges used by the validations`, alineada a la izquierda y con el ancho de su contenido

#### Scenario: Contadores explicados
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** mira los contadores
- **THEN** cada uno muestra su valor y una explicación de una línea: `Pending in range` cuenta las transacciones de los canales de la cuenta que siguen `Pending` en el gateway con fecha de creación dentro del rango APP o DEC; `Undated adjustments`, las filas I del batch sin fecha de cambio de estado; `Undated candidates`, las transacciones del gateway en un estado de I sin fecha de cambio de estado, que no se comparan con el rango I; ninguno es un hallazgo

#### Scenario: Corrida bloqueada
- **GIVEN** la corrida vigente de `batch-blocked`
- **WHEN** abre el paso Analysis
- **THEN** junto al título ve `Overall result` y `Blocked`
- **AND** no ve la tabla `Date ranges used by the validations`

#### Scenario: Rango sin filas
- **WHEN** la corrida trae `ranges.DEC = null`
- **THEN** la fila `E` `DEC` muestra `—` como rango

### Requirement: Pantalla Analysis & Validations: fechas en hora de Nueva York
Toda fecha de la pantalla SHALL mostrarse en hora de America/New_York con el sufijo `ET`, sin depender de la zona del navegador. Las fechas de negocio (rangos, `relevantDate`, fechas de batch) SHALL mostrarse tal como llegan, sin convertir, porque ya son hora de Nueva York aunque el API las serialice con `Z`. Las de auditoría (corrida, revisión, invalidación, cambios, resolución, historial) SHALL convertirse desde UTC.

#### Scenario: Rango de negocio sin desplazamiento
- **WHEN** la corrida trae `ranges.APP.min = 2026-09-28T00:00:00.000Z`
- **THEN** el rango APP empieza en `2026-09-28 00:00 ET`, también con el navegador en otra zona

#### Scenario: Auditoría en horario de verano
- **WHEN** una aparición trae `changedAt = 2026-10-18T14:20:00.000Z`
- **THEN** se muestra `2026-10-18 10:20 ET`

#### Scenario: Auditoría en horario estándar
- **WHEN** una resolución trae `resolvedAt = 2026-11-02T15:00:00.000Z`
- **THEN** se muestra `2026-11-02 10:00 ET`

### Requirement: Pantalla Analysis & Validations: tabla de las ocho validaciones
La pantalla SHALL listar las ocho validaciones en el orden en que llegan del API, cada una con su nombre en inglés, su resultado (`Passed`, `Warning`, `Blocked`, `n/a` para `not_applicable`, `Not implemented`), su número de hallazgos, si bloquea y su desglose cuando no es nulo. Una validación con hallazgos SHALL poder abrir su lista desde el teclado.

#### Scenario: Validaciones de batch-issues
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** abre el paso Analysis
- **THEN** ve en este orden `Provider mismatch` `Passed` `0`, `Non-recorded adjustment` `Warning` `3` con `1 non-recorded adjustment · 2 status mismatches`, `Duplicate in batch` `Warning` `1`, `Status collision in batch` `Warning` `1`, `Duplicate across batches` `Warning` `1`, `Status collision across batches` `Warning` `1`, `Missing previous to batch` `Warning` `10` con `DEC 10`, y `Missing in range` `Warning` `6` con `APP 3 · R 3`

#### Scenario: Validación bloqueante
- **GIVEN** la corrida vigente de `batch-blocked`
- **WHEN** abre el paso Analysis
- **THEN** `Provider mismatch` muestra `Blocked`, `1` y `Blocks`

#### Scenario: Validación no aplicable
- **WHEN** una validación llega con `outcome = not_applicable`
- **THEN** se muestra `n/a`, sin acceso a hallazgos y sin presentarse como aprobada

### Requirement: Pantalla Analysis & Validations: lista de hallazgos
Al elegir una validación, la pantalla SHALL listar los hallazgos de la corrida vigente filtrados por esa validación, paginados en el servidor (50 por página), en el orden del API, con ID leído como texto, ciclo, tipo y alcance, estado reportado y estado del gateway (si lo hay), rango del faltante, apariciones incluidas sobre el total y resolución. La validación, la página y el hallazgo abierto SHALL ir en la dirección.

#### Scenario: Faltantes anteriores al batch
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** elige `Missing previous to batch`
- **THEN** se pide `GET validation-issues?validationCode=missing_previous_to_batch&page=1&pageSize=50` y ve 10 hallazgos, todos con rango `DEC` y `Persistent`, entre ellos `292185165085382`

#### Scenario: Discrepancia de estado
- **WHEN** elige `Non-recorded adjustment`
- **THEN** ve 3 hallazgos: `281520820250015` como `Non-recorded adjustment` y `911545593909470` y `381797111970492` como `Status mismatch`, cada uno con el estado reportado y el del gateway

#### Scenario: Recargar conserva la vista
- **GIVEN** la lista de `Duplicate in batch` abierta con el hallazgo de `441706751475644` en el drawer
- **WHEN** recarga la página
- **THEN** vuelve a ver la misma validación elegida y el mismo hallazgo abierto

### Requirement: Pantalla Analysis & Validations: detalle de un hallazgo
Abrir un hallazgo SHALL mostrar en un panel lateral todas sus apariciones: las del import, con archivo, hoja y fila, y las de batches anteriores, con número de batch, intento, cuenta y estado actual del batch. De cada una SHALL mostrar el estado (`Unresolved status` si es nulo), `CHB 2` si `excludeAmount`, si está incluida por defecto, si está incluida ahora y quién y cuándo la cambió. Debajo, la resolución y el historial con usuario y fecha. Un faltante de la corrida vigente SHALL mostrar además el rango del batch de su ciclo y estado, tal como lo da la corrida. Todo faltante, también el de una corrida anterior, SHALL mostrar una línea que diga por qué es faltante, que solo depende de su `missingType`.

#### Scenario: Duplicado en el batch (HU2 CA2)
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** abre el hallazgo `Duplicate in batch` de `441706751475644`
- **THEN** ve dos apariciones de `Recon_Template_ProviderB-Main_batch-issues.xlsx` · `APP`, en las filas 12 y 338, ambas `Successful`; la primera `Included by default` e incluida, y la segunda excluida por defecto

#### Scenario: Aparición de un batch anterior
- **WHEN** abre el hallazgo `Duplicate across batches` de `504712738863260`
- **THEN** la aparición `previous_batch` muestra el número de batch, el intento, la cuenta y el estado del batch, y la del import aparece excluida por defecto

#### Scenario: Estado no resuelto
- **WHEN** una aparición llega con `status = null`
- **THEN** se muestra `Unresolved status` y la aparición no se oculta

#### Scenario: Hallazgo de una sola fila
- **WHEN** abre un hallazgo `Non-recorded adjustment`, `Status mismatch` o `Provider mismatch`, que el API devuelve con su fila en `source` y sin apariciones
- **THEN** ve la fila en `Row` (archivo, hoja y fila) y no la sección de apariciones ni ningún aviso de que la transacción no está en el batch

#### Scenario: Faltante sin apariciones
- **WHEN** abre un hallazgo `Missing previous to batch` o `Missing in range`
- **THEN** ve `No occurrences: the transaction is not in this batch.`

#### Scenario: Rango del batch de un faltante en rango
- **GIVEN** la corrida vigente con `ranges.APP` de `2026-09-28 00:04 ET` a `2026-10-07 23:58 ET`
- **WHEN** abre un hallazgo `Missing in range` con `missingRange = APP`
- **THEN** ve `Batch range (E/APP)` `2026-09-28 00:04 ET – 2026-10-07 23:58 ET`, leído de la corrida sin calcular nada en el navegador
- **AND** ve `Its date is inside the batch range, but it is not in this batch and no batch of the provider in force (not undone) processed it in this cycle.`

#### Scenario: Rango del batch de un faltante anterior
- **WHEN** abre un hallazgo `Missing previous to batch` con `missingRange = I` y estado del gateway `Chargeback`
- **THEN** ve `Batch range (I/CHB)` con el rango I de la corrida
- **AND** ve `Its date is before the batch range, it is not in this batch and no batch of the provider in force (not undone) processed it in this cycle.`

#### Scenario: Faltante de una corrida anterior
- **WHEN** abre un faltante cuya corrida ya no es la vigente
- **THEN** no ve `Batch range`, porque la pantalla solo tiene los rangos de la corrida vigente, y ve el ciclo en `Range` como hasta ahora
- **AND** ve la línea de por qué es faltante de su `missingType`, que no depende de la corrida

#### Scenario: Teclado
- **WHEN** el usuario abre un hallazgo con Enter desde la lista y pulsa Escape
- **THEN** el panel se abre con el foco dentro y, al cerrarse, el foco vuelve al hallazgo de la lista

### Requirement: Pantalla Analysis & Validations: cambiar la inclusión de una aparición
Una aparición con `editable = true` SHALL ofrecer un interruptor `Included in settlement`. Con `includable = false` solo SHALL permitir excluir y mostrar el motivo genérico. Al cambiarlo SHALL llamar a `PATCH conflict-occurrences` y pintar el detalle devuelto con el usuario, la fecha y la entrada del historial. Con `editable = false` SHALL mostrar el valor como texto.

#### Scenario: Incluir el duplicado (criterio 2 del issue)
- **GIVEN** el hallazgo `Duplicate in batch` de `441706751475644` abierto por `analyst`
- **WHEN** activa `Included in settlement` en la segunda aparición
- **THEN** se llama a `PATCH /conflict-occurrences/<occurrenceId>` con `{ "includeInSettlement": true }`, la aparición muestra `Changed by analyst` con la fecha, el historial suma `analyst` `excluded → included` con la fecha y la lista muestra `2 / 2` incluidas

#### Scenario: Reserva que no se puede incluir
- **WHEN** una aparición R llega con `editable = true`, `includable = false` y excluida
- **THEN** su interruptor está deshabilitado con `This reserve cannot be included: another occurrence is included or it was released in a previous batch.`

#### Scenario: Rechazo de la regla de R
- **WHEN** `PATCH conflict-occurrences` responde `409 occurrence_not_includable` con `reason = reserve_already_included`
- **THEN** ve `A reserve is released only once: exclude the included occurrence first.`, el hallazgo se relee y el interruptor muestra el valor del servidor

#### Scenario: Aparición histórica
- **WHEN** una aparición `previous_batch` llega con `editable = false`
- **THEN** muestra `Included` o `Excluded` como texto, sin interruptor

#### Scenario: Corrida superada
- **WHEN** `PATCH conflict-occurrences` responde `409 validation_run_superseded`
- **THEN** ve `A newer validation run exists. The results were reloaded.` y se relee la corrida vigente

### Requirement: Pantalla Analysis & Validations: inclusión sobre un import validado
Con el import `validated`, cambiar una inclusión SHALL pedir confirmación antes de llamar al API, avisando de que la revisión quedará invalidada y el import volverá a `analyzed`. Tras el cambio, la pantalla SHALL mostrar el import `analyzed` y el aviso de revisión invalidada.

#### Scenario: Confirmar el cambio
- **GIVEN** el import de `batch-issues` `validated`
- **WHEN** `analyst` cambia la inclusión de una aparición y confirma
- **THEN** se llama a `PATCH conflict-occurrences`, el import muestra `analyzed` y aparece el aviso de revisión invalidada con el motivo `an inclusion was changed`

#### Scenario: Desistir
- **WHEN** cierra el diálogo sin confirmar
- **THEN** no se llama al API y el interruptor conserva su valor

### Requirement: Pantalla Analysis & Validations: resolver a mano con nota
Un hallazgo con `resolvable = true` SHALL ofrecer **Mark as resolved** con una nota obligatoria de 1 a 500 caracteres (sin contar espacios de los extremos). Al guardar SHALL llamar a `PATCH validation-issues` y mostrar `Resolved`, el usuario, la fecha y la nota. Con `resolvable = false` SHALL NOT ofrecer la acción.

#### Scenario: Resolver el ajuste no registrado
- **GIVEN** el hallazgo `Non-recorded adjustment` de `281520820250015` abierto por `analyst`
- **WHEN** escribe `Checked in the gateway: adjustment recorded late` y pulsa **Mark as resolved**
- **THEN** se llama a `PATCH /validation-issues/<issueId>` con `{ "resolutionStatus": "resolved", "note": "Checked in the gateway: adjustment recorded late" }` y ve `Resolved by analyst` con la fecha y la nota, también en el historial

#### Scenario: Nota vacía
- **WHEN** pulsa **Mark as resolved** con la nota vacía o solo con espacios
- **THEN** ve `Write a note before resolving.` y no se llama al API

#### Scenario: Ya resuelto por otra persona
- **WHEN** `PATCH validation-issues` responde `409 issue_already_resolved`
- **THEN** ve `This finding was already resolved by <usuario> on <fecha>.` y el hallazgo se relee

#### Scenario: Hallazgo no resoluble a mano
- **WHEN** abre un hallazgo `Duplicate in batch`
- **THEN** no se ofrece **Mark as resolved**

### Requirement: Pantalla Analysis & Validations: aviso de revisión invalidada
Con `lastInvalidatedReview` no nulo y sin revisión vigente posterior (`run.review` nulo o con fecha anterior a `invalidatedAt`), la pantalla SHALL avisar de que la revisión anterior quedó invalidada: quién la hizo y cuándo, quién la invalidó y cuándo, y el motivo. Tras una revisión nueva SHALL dejar de mostrarlo.

#### Scenario: Volver a ejecutar tras revisar (criterio 4 del issue)
- **GIVEN** el import de `batch-issues` `validated` por `analyst`
- **WHEN** `analyst` pulsa **Run again** y confirma
- **THEN** ve `The review by analyst on <fecha> was invalidated by analyst on <fecha>: the validations ran again (run #<runId nuevo>).` y el import muestra `analyzed`

#### Scenario: Revisión nueva
- **GIVEN** el aviso de revisión invalidada a la vista
- **WHEN** `analyst` pulsa **Continue to settlement review** y el API responde `200`
- **THEN** el aviso desaparece

### Requirement: Pantalla Analysis & Validations: continuar o cancelar
La pantalla SHALL ofrecer una sola decisión de conjunto: **Continue to settlement review**, que llama a `POST review` con el `runId` de la corrida mostrada, y **Cancel and reprocess**, con confirmación. Continue SHALL estar deshabilitado sin corrida vigente o con la corrida bloqueada, con el motivo visible y asociado al botón.

#### Scenario: provider_mismatch (criterio 1 del issue, HU2 CA5)
- **GIVEN** la corrida vigente de `batch-blocked`
- **WHEN** `analyst` abre el paso Analysis
- **THEN** **Continue to settlement review** está deshabilitado y ve `provider_mismatch: cancel the import and process it under the correct provider.`, con un enlace al hallazgo de `252570479111759`, y **Cancel and reprocess** está disponible

#### Scenario: Sin corrida
- **GIVEN** el import analizado sin corrida vigente
- **THEN** **Continue to settlement review** está deshabilitado con `Run the validations before continuing.`

#### Scenario: Solo advertencias (criterio 3 del issue, HU2 CA6)
- **GIVEN** la corrida vigente de `batch-issues` sin cambios
- **WHEN** `analyst` pulsa **Continue to settlement review**
- **THEN** se llama a `POST /imports/<importId>/review` con `{ "runId": <runId> }`, el import muestra `validated`, ve `Reviewed by analyst on <fecha>` y se ofrece **Settlement Review**

#### Scenario: Corrida superada al continuar
- **WHEN** `POST review` responde `409 validation_run_superseded`
- **THEN** ve `A newer validation run exists. Review it before continuing.`, se relee la corrida y Continue usa el `runId` nuevo solo cuando se vuelva a pulsar

#### Scenario: Cancelar y reprocesar (HU2 CA8)
- **WHEN** `analyst` pulsa **Cancel and reprocess** y confirma
- **THEN** se llama a `POST cancel`, el import muestra `cancelled` y la corrida, la tabla y los hallazgos siguen visibles en solo lectura

### Requirement: Pantalla Analysis & Validations: import cancelado o procesado
En `cancelled` y `processed` la sección de la decisión SHALL mostrar un texto de solo lectura por estado; en `processed`, con un enlace al Settlement Summary de su intento vigente (`currentBatchId`).

#### Scenario: Import cancelado
- **GIVEN** el import de `batch-issues` `cancelled` con su corrida
- **WHEN** abre el paso Analysis
- **THEN** la sección de la decisión muestra `This import is cancelled. Its run and findings are kept for reference.` y ningún botón

#### Scenario: Import procesado
- **GIVEN** el import de `batch-issues` `processed` con su corrida y `currentBatchId`
- **WHEN** abre el paso Analysis
- **THEN** la sección de la decisión muestra `This import is processed. Its run and findings are kept for reference.` y el enlace **View settlement summary** al Settlement Summary de `currentBatchId`, ningún botón y nada que diga `cancelled`

### Requirement: Pantalla Analysis & Validations: enlace a Settlement Review
Con el import `validated` y `settlement.process`, la pantalla SHALL ofrecer **Settlement Review** como enlace a la pantalla Settlement Review de ese import. Sin el permiso SHALL NOT ofrecerlo: la pantalla de destino lo exige.

#### Scenario: Import validado
- **GIVEN** el import de `batch-issues` `validated`
- **WHEN** `analyst` abre el paso Analysis y pulsa **Settlement Review**
- **THEN** llega a Settlement Review de ese import

#### Scenario: Import validado visto por viewer
- **GIVEN** el import de `batch-issues` `validated`
- **WHEN** `viewer` abre el paso Analysis
- **THEN** ve `Reviewed by analyst on <fecha>` y ningún enlace ni botón **Settlement Review**

### Requirement: Pantalla Analysis & Validations: solo lectura
Sin `settlement.process`, la pantalla SHALL mostrar corrida, validaciones, hallazgos y detalle sin **Run validations**, **Continue**, **Cancel and reprocess**, interruptores ni **Mark as resolved**. Con permiso, Run y Continue SHALL ocultarse fuera de los estados que los admiten; los controles del detalle SHALL seguir solo `editable`, `includable` y `resolvable` del API.

#### Scenario: viewer
- **GIVEN** la corrida vigente de `batch-issues`
- **WHEN** `viewer` abre el paso Analysis y el hallazgo `Duplicate in batch`
- **THEN** ve las ocho validaciones, la lista y las dos apariciones con `Included` / `Excluded` como texto, sin ningún botón de acción, y no aparece la sección de la decisión vacía

#### Scenario: Import cancelado con un ajuste aún resoluble
- **GIVEN** el import de `batch-issues` `cancelled` y el hallazgo `Non-recorded adjustment` con `resolvable = true` y apariciones con `editable = false`
- **WHEN** `analyst` lo abre
- **THEN** no hay **Run again** ni **Continue**, las apariciones no tienen interruptor y sí se ofrece **Mark as resolved**

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
