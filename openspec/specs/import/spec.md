# import

## Purpose
Subir uno o varios archivos de la plantilla estandarizada para una cuenta, reconocer sus hojas y columnas con las reglas de pareo, cruzar cada fila contra las transacciones propias y dejar el import listo para validar. README §1.2 (plantilla), §3.2 (Import, ImportFile, ImportSheet, ImportRow), §4.2, HU1.

## Requirements

### Requirement: Varios archivos por import
El sistema SHALL aceptar uno o varios archivos `.xlsx` en un mismo import de una cuenta y tratarlos como un solo batch: el análisis SHALL cruzar juntas las filas de todos los archivos y los contadores del import SHALL ser los del conjunto, con independencia de cómo estén repartidas las hojas entre archivos.

#### Scenario: Batch repartido en dos archivos
- **GIVEN** la cuenta ProviderA-USD y los archivos `part1.xlsx` (APP, DEC) y `part2.xlsx` (CHB, REF, RDR, RR, Other Fees) de `data/samples/batch-split`
- **WHEN** se crea un import con ambos, se confirma la propuesta tal cual y se analiza
- **THEN** `analysis.rows = { total: 783, matched: 780, unmatched: 0, ambiguous: 0, ignored: 3 }`, `analysis.byCycle = { E: 450, I: 10, R: 320 }`, `channels` y `batchFees` son idénticos a los de `data/samples/batch-clean/expected.json`, y las filas de `part1` y `part2` aparecen en `GET /api/v1/imports/{id}/rows` con el `fileId` de su archivo

#### Scenario: Archivo duplicado
- WHEN se añade un archivo cuyo `sha256` ya está en el import
- THEN se rechaza con 409 y el import no cambia

#### Scenario: Duplicado con el nombre del coincidente
- **GIVEN** el import creado con `batch-split_part1.xlsx` y `batch-split_part2.xlsx`
- **WHEN** `analyst` vuelve a subir `part1.xlsx` con `POST /api/v1/imports/{id}/files`
- **THEN** recibe `409` con `code = "duplicate_file"`, `details.fileName = "Recon_Template_ProviderA-USD_batch-split_part1.xlsx"` y `details.fileId` el del archivo original, y `GET /api/v1/imports/{id}` sigue mostrando exactamente dos archivos

#### Scenario: Duplicado dentro de la misma petición
- **WHEN** una sola petición trae dos veces el mismo `.xlsx` (mismos bytes, aunque cambie el nombre)
- **THEN** recibe `409 duplicate_file` con `details.fileId = null`, y no se crea el import ni queda ningún archivo en `UPLOAD_DIR`

#### Scenario: Mismo archivo en dos imports
- **GIVEN** un import de `ProviderA-USD` que ya contiene `batch-clean.xlsx`
- **WHEN** se crea otro import en la misma cuenta con el mismo archivo
- **THEN** recibe `201` con un `importId` distinto

### Requirement: Solo ID es obligatorio
El sistema SHALL poder analizar una hoja de transacciones cuando tiene identificada la columna `transactionId`; `amount` y `currency` son opcionales y solo generan advertencias. Ya en la propuesta de la subida, `readiness.missing` SHALL nombrar cada hoja `transactions` sin columna propuesta como `transactionId` y cada hoja de ciclo E o I sin estado fijo ni columna `status`; las hojas de ciclo R no necesitan estado. Un pareo confirmado sin ID SHALL guardarse, pero el análisis SHALL rechazarlo.

#### Scenario: Hoja sin columna ID
- **GIVEN** un import de `batch-clean` cuyo pareo confirmado deja la hoja `APP` (`kind = transactions`) sin ninguna columna como `transactionId`
- **WHEN** `analyst` llama a `POST /api/v1/imports/{id}/analyze`
- **THEN** recibe `422` con `code = "mapping_incomplete"` y `details.missing` contiene `{ sheetName: "APP", field: "transactionId", message }`, el import sigue en `mapped`, `analyzedAt = null` y no existe ninguna `ImportRow` del import

#### Scenario: Readiness al subir
- **GIVEN** un libro con una hoja `APP` cuya cabecera es `Reference, Amount, Currency`
- **WHEN** se sube a `ProviderA-USD`
- **THEN** `readiness.canAnalyze = false` y `missing` contiene `{ sheetName: "APP", message }` indicando que no hay columna propuesta como `transactionId`

#### Scenario: Hoja de ciclo I sin forma de obtener el estado
- **GIVEN** una cuenta cuyo conjunto de reglas parea la hoja `CB` a ciclo I sin estado fijo
- **WHEN** el archivo trae `CB` con cabecera `Merchant Order No#, Amount USD` (sin columna de estado)
- **THEN** `readiness.missing` nombra `CB` por falta de estado, mientras que una hoja `RR` (ciclo R) sin estado no aparece en `missing`

### Requirement: Ciclo y estado por hoja
El ciclo (`E`/`I`/`R`) de cada fila SHALL venir de la regla de hoja (o del pareo confirmado), nunca del estado. La hoja `RR` SHALL asignar ciclo `R` sin estado. `Other Fees` SHALL leerse como `batch_fees`; `Duplicate Corrections`, `CHB Alerts` y `Settings` SHALL ignorarse con aviso. La propuesta de la subida SHALL reflejar exactamente esa asignación por hoja con su origen.

#### Scenario: Plantilla estándar
- **GIVEN** `data/samples/batch-clean` subido a `ProviderA-USD` y la propuesta confirmada tal cual
- **WHEN** se analiza
- **THEN** las filas de APP tienen `cycle = "E"` y `statusName = "Successful"`, DEC `E`/`Declined`, CHB `I`/`Chargeback`, REF `I`/`Refund`, RDR `I`/`RDR`, RR `R` con el estado actual de la transacción asociada; `analysis.byCycle = { E: 450, I: 10, R: 320 }`; `batchFees` trae exactamente `Wire Fee` (`amount = "25.0000"`) y `Settlement Fee` (`"15.0000"`) con `feeTypeId` resuelto, `source = "file"` y sin `warning`; y ninguna fila proviene de `Duplicate Corrections`, `CHB Alerts` ni `Settings`

#### Scenario: Propuesta por hoja al subir
- **WHEN** se sube `batch-clean` y todavía no se ha confirmado nada
- **THEN** la respuesta propone APP→E/`Successful`, DEC→E/`Declined`, CHB→I/`Chargeback`, REF→I/`Refund`, RDR→I/`RDR`, RR→R sin estado, `Other Fees`→`batch_fees` y las tres hojas restantes → `ignore` con `note`, todas con `source = global`, y `readiness.notes` avisa de cada hoja ignorada

### Requirement: Cruce por identidad normalizada
Cada fila de una hoja `transactions` SHALL cruzarse por `(gatewayId, sourceTransactionId)` con el ID normalizado según el `idFormat` de cada gateway de la cuenta, y recibir `matchResult` `matched`, `unmatched` o `ambiguous`. Los gateways de la cuenta SHALL ser los de sus canales asociados (`AccountChannel`) o, si no tiene ninguno, los de los canales de su proveedor. La columna de ID SHALL leerse como texto y `transactionIdRaw` SHALL conservarla tal cual.

#### Scenario: ID desconocido
- **GIVEN** `data/samples/batch-issues` subido a `ProviderB-Main`, confirmado y analizado
- **WHEN** se consulta `GET /api/v1/imports/{id}/rows?match=unmatched`
- **THEN** `total = 1`, la fila trae `transactionIdRaw = "4260465812403708"`, `transactionId = null`, `matchResult = "unmatched"`, `reason = "no_match"` y sin advertencia `id_length` (16 dígitos), `analysis.rows.unmatched = 1`, `rowsUnmatched = 1` y el import está en `analyzed`

#### Scenario: Cruce en los gateways de la cuenta
- **GIVEN** `ProviderA-USD`, cuyos canales asociados (RAM-01, RAM-02) pertenecen al gateway numérico (`gatewayId = 1`)
- **WHEN** se analiza `batch-clean`
- **THEN** cada fila `matched` tiene `gatewayId = 1` y su `transactionId` corresponde a la transacción con ese `sourceTransactionId` en el gateway 1, incluidas las de RAM-07, canal sin fila en `AccountChannel` pero del mismo gateway

#### Scenario: Cuenta sin canales cruza por su proveedor
- **GIVEN** una cuenta del proveedor 101 sin ninguna fila en `AccountChannel`
- **WHEN** se analiza `batch-clean` en ella
- **THEN** las filas cruzan en el gateway 1 (780 `matched`, 0 `unmatched`) porque los canales del proveedor 101 usan ese gateway, y `channels` marca RAM-01 y RAM-02 como `assigned_to_other_account` con `otherAccount.name = "ProviderA-USD"` y RAM-07 como `unassigned`

### Requirement: Filas sin ID se ignoran
Toda fila de una hoja `transactions` cuya celda de ID esté vacía (restos `=SUM()` de la plantilla) SHALL persistirse como `ImportRow` con `matchResult = "ignored"`, `ignore = true` y `reason = "empty_id"`, SHALL contarse en `analysis.rows.ignored` y en `rowsTotal`, y no SHALL contarse como transacción ni en `byCycle`.

#### Scenario: Residuo de suma
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta `GET /api/v1/imports/{id}/rows?match=ignored`
- **THEN** `total = 3`, las filas pertenecen a CHB (`rowNo = 4`), REF (`rowNo = 8`) y RDR (`rowNo = 4`), cada una con `transactionIdRaw = ""`, `reason = "empty_id"` y `rawData.ID = ""`, y `analysis.rows.ignored = 3` mientras `byCycle.I = 10`

### Requirement: Importes positivos y moneda de referencia
`Amount` SHALL leerse siempre positivo (el sistema aplica el signo por ciclo); un negativo SHALL guardarse tal cual en `ImportRow.amount` con la advertencia `negative_amount`. `Currency` SHALL conservarse como referencia (ISO-3) sin bloquear ni comparar; una moneda distinta de `USD` SHALL generar la advertencia `non_usd_currency`. En la subida, `Amount` y `Currency` SHALL aparecer en la vista previa como texto tal cual, sin signo aplicado ni conversión.

#### Scenario: Importe y moneda en la vista previa
- **WHEN** se sube `batch-clean`
- **THEN** la primera fila de `preview` de RR trae `Amount = "2.27"` y `Currency = "USD"` como texto, y ninguna celda de la vista previa es un número JSON

#### Scenario: Importe negativo en el análisis
- **GIVEN** `batch-issues` analizado (la primera fila de REF trae `Amount` negativo)
- **WHEN** se consulta el detalle y esa fila
- **THEN** `analysis.warnings.negative_amount = 1`, la fila está `matched`, su `amount` es el valor negativo del archivo como string decimal y `warnings` contiene `"negative_amount"`; en `batch-clean` `analysis.warnings.negative_amount` y `non_usd_currency` son `0`

#### Scenario: Importe ilegible
- **GIVEN** una hoja `APP` con `Amount = "12,50"` en una fila
- **WHEN** se analiza
- **THEN** la fila conserva el texto en `rawData.Amount`, `amount = null` y `warnings` contiene `"amount_unparsed"`; el cruce por ID no se ve afectado

### Requirement: Subida de archivos de un import
`POST /api/v1/accounts/{id}/imports` SHALL exigir el permiso `settlement.process` y un cuerpo `multipart/form-data` con 1 a 10 partes `files`, cada una un `.xlsx` de como máximo 20 MiB (20 971 520 bytes). SHALL crear el `Import` en `uploaded` con `createdBy` el usuario de la petición y responder `201` con el detalle del import (archivos, hojas, propuesta de pareo, vista previa y `readiness`). Cualquier archivo rechazado SHALL impedir la creación del import completo.

#### Scenario: Plantilla en un archivo
- **GIVEN** `analyst` y la cuenta `ProviderA-USD`
- **WHEN** sube `data/samples/batch-clean/Recon_Template_ProviderA-USD_batch-clean.xlsx`
- **THEN** recibe `201` con `status = "uploaded"`, `createdBy.userName = "analyst"`, un archivo con `fileName` igual al del cliente, `sizeBytes = 31510` y diez hojas con `rowCount` APP 340, DEC 110, CHB 3, REF 7, RDR 3, RR 320, `Duplicate Corrections` 0, `CHB Alerts` 0, `Other Fees` 2 y `Settings` 21
- **AND** la suma de `rowCount` de las hojas propuestas como `transactions` es 783, igual que `rows.read` de `expected.json`

#### Scenario: Batch repartido en dos archivos en una sola petición
- **WHEN** `analyst` sube `batch-split_part1.xlsx` y `batch-split_part2.xlsx` juntos a `ProviderA-USD`
- **THEN** recibe `201` con un solo `importId`, dos archivos (part1 con APP 340 y DEC 110; part2 con CHB 3, REF 7, RDR 3, RR 320 y `Other Fees` 2) y la propuesta calculada para las hojas de ambos

#### Scenario: Sin archivos
- **WHEN** se envía un `multipart/form-data` sin ninguna parte `files`, una petición que no es multipart, o un cuerpo multipart malformado (por ejemplo cortado antes del boundary de cierre)
- **THEN** recibe `400` con `code = "validation_error"` y no se crea ningún import

#### Scenario: Tipo no permitido
- **WHEN** una de las partes se llama `batch.csv` (o `.xls`, `.xlsm`, sin extensión)
- **THEN** recibe `400` con `code = "unsupported_file_type"` y `details.fileName`, no se crea el import y no queda ningún archivo en `UPLOAD_DIR`

#### Scenario: Tamaño excedido
- **WHEN** una parte `.xlsx` supera los 20 MiB
- **THEN** recibe `400` con `code = "file_too_large"` y `details.fileName`, y no se crea el import

#### Scenario: Más de diez archivos
- **WHEN** la petición trae once partes `files`
- **THEN** recibe `400` con `code = "too_many_files"` y no se crea el import

#### Scenario: Archivo ilegible
- **WHEN** una parte se llama `batch.xlsx` pero su contenido no es un paquete OOXML (por ejemplo un `.xls` renombrado, un libro protegido con contraseña o un zip sin `xl/workbook.xml`)
- **THEN** recibe `422` con `code = "file_unreadable"` y `details.fileName`, y no se crea el import

#### Scenario: Sin permiso
- **GIVEN** `viewer` (sin `settlement.process`)
- **WHEN** sube cualquier archivo a una cuenta de su alcance
- **THEN** recibe `403` con `code = "forbidden"`

#### Scenario: Cuenta fuera del alcance
- **GIVEN** `viewer` o `analyst` con permiso pero sin la cuenta en su alcance
- **WHEN** sube un archivo al `accountId` de una cuenta de otro merchant
- **THEN** recibe `404` con `code = "not_found"`, el mismo cuerpo que para un UUID inexistente, y no se crea ningún import

### Requirement: Archivo original conservado
Cada archivo aceptado SHALL guardarse sin modificar bajo `UPLOAD_DIR`, en una ruta formada solo por identificadores del sistema (`imports/<importId>/<fileId>.xlsx`), nunca por el nombre que envió el cliente, que SHALL conservarse únicamente en `fileName` (sin componentes de directorio, máximo 255 caracteres). `sha256` SHALL ser la huella hexadecimal en minúsculas de los bytes recibidos y `sizeBytes` su tamaño exacto.

#### Scenario: Bytes idénticos y nombre aislado
- **WHEN** se sube `Recon_Template_ProviderA-USD_batch-clean.xlsx`
- **THEN** `sha256 = "c46857d3b6580aba6daf6b63b66e67583b399cd356a71bd16e659bc252128352"`, el archivo en `storagePath` tiene exactamente esos bytes y esa huella, y `storagePath` no contiene el texto `Recon_Template`

#### Scenario: Nombre con ruta
- **WHEN** el cliente envía la parte con `filename = "..\\..\\evil.xlsx"`
- **THEN** `fileName = "evil.xlsx"` y el archivo se guarda bajo `imports/<importId>/`, nunca fuera de `UPLOAD_DIR`

### Requirement: Añadir y quitar archivos antes de analizar
`POST /api/v1/imports/{id}/files` (mismo cuerpo multipart y mismas reglas que la subida) y `DELETE /api/v1/imports/{id}/files/{fileId}` SHALL exigir `settlement.process` y SHALL aceptarse solo con el import en `uploaded` o `mapped`; en otro estado SHALL responder `409` con `code = "import_not_editable"`. Ambos SHALL responder `200` con el detalle completo del import y la propuesta recalculada, sin tocar las hojas de los archivos que no cambian ni su pareo confirmado.

#### Scenario: Añadir la segunda parte
- **GIVEN** un import de `ProviderA-USD` creado con `batch-split_part1.xlsx`
- **WHEN** `analyst` añade `batch-split_part2.xlsx`
- **THEN** recibe `200` con dos archivos, los `sheetId` del primer archivo sin cambios y la propuesta cubriendo las hojas de los dos

#### Scenario: Quitar un archivo
- **GIVEN** el import con las dos partes
- **WHEN** `analyst` borra el `fileId` de part2
- **THEN** recibe `200` con un solo archivo, sus hojas desaparecen de la respuesta y el archivo deja de existir en `UPLOAD_DIR`

#### Scenario: Quitar el último archivo
- **WHEN** se borra el único archivo del import
- **THEN** recibe `200` con `files = []`, el import sigue en `uploaded` y `readiness.canAnalyze = false`

#### Scenario: Archivo o import desconocidos
- **WHEN** el `fileId` no pertenece al import, o el `importId` no existe o es de un merchant fuera del alcance
- **THEN** recibe `404` con `code = "not_found"`

#### Scenario: Import ya analizado
- **GIVEN** un import en `analyzed`, `validated`, `processed` o `cancelled`
- **WHEN** se intenta añadir o quitar un archivo
- **THEN** recibe `409` con `code = "import_not_editable"` y `details.status` con el estado actual, y el import no cambia

#### Scenario: Archivo añadido tras confirmar
- **GIVEN** un import en `mapped` con `part1.xlsx` confirmado
- **WHEN** `analyst` añade `part2.xlsx`
- **THEN** recibe `200`, el import sigue en `mapped`, las hojas de `part1` conservan `mappingConfirmed = true` y su `mapping`, las de `part2` llegan con `mappingConfirmed = false` y `mapping = null`, y un `POST analyze` inmediato responde `422 mapping_incomplete` nombrando cada hoja de `part2` con `field = "confirmation"`

### Requirement: Imports de una cuenta
`GET /api/v1/accounts/{id}/imports` SHALL responder `200` con los resúmenes de los imports de la cuenta, del más reciente al más antiguo, sin hojas ni propuesta. `status=` SHALL filtrar por un estado de `Import`; un valor fuera del vocabulario SHALL responder `400 validation_error`. Cuenta inexistente o fuera del alcance SHALL responder `404`. Tras el análisis, el resumen SHALL traer `analyzedAt`, `rowsTotal`, `rowsMatched` y `rowsUnmatched`.

#### Scenario: Lista tras una subida
- **GIVEN** un import recién creado con dos archivos en `ProviderA-USD`
- **WHEN** `viewer` llama a `GET /api/v1/accounts/{id}/imports?status=uploaded`
- **THEN** recibe `200` con ese import con `importId`, `accountId`, `status = "uploaded"`, `createdBy = { userId, userName: "analyst" }`, `createdAt`, `updatedAt`, `analyzedAt = null`, `rowsTotal = null`, `rowsMatched = null`, `rowsUnmatched = null`, `currentBatchId = null` y `fileCount = 2`

#### Scenario: Filtro sin coincidencias y cuenta ajena
- **WHEN** `viewer` pide `?status=processed` de `ProviderA-USD`
- **THEN** recibe `200` con `[]`
- **AND** `GET /api/v1/accounts/{id}/imports` con el `accountId` de `ProviderC-USD` responde `404` con `code = "not_found"`

#### Scenario: Lista tras analizar
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** `viewer` llama a `GET /api/v1/accounts/{id}/imports?status=analyzed`
- **THEN** el resumen trae `status = "analyzed"`, `analyzedAt` no nulo, `rowsTotal = 783`, `rowsMatched = 780`, `rowsUnmatched = 0` y `fileCount = 1`

### Requirement: Detalle de un import
`GET /api/v1/imports/{id}` SHALL responder `200` con la misma forma que la respuesta de la subida: archivos ordenados por `uploadedAt`, hojas en el orden del libro con su `sheetId` estable, propuesta de pareo recalculada, pareo confirmado (`mappingConfirmed`, `mapping`), vista previa y `readiness`, más `analysis`, `channels` y `batchFees` (`null` hasta que el import se analiza). `importId` mal formado SHALL responder `400`; inexistente o fuera del alcance, `404`.

#### Scenario: Retomar un import
- **GIVEN** el import creado con `batch-clean`
- **WHEN** `analyst` llama a `GET /api/v1/imports/{id}`
- **THEN** el cuerpo es igual al que devolvió `POST` (mismos `fileId`, `sheetId`, `rowCount`, `proposed`, `columns`, `preview` y `readiness`), cada hoja trae `mappingConfirmed = false` y `mapping = null`, y `analysis`, `channels` y `batchFees` son `null`

#### Scenario: Import de otro merchant
- **GIVEN** un import de `ProviderC-Alt` (merchant 2)
- **WHEN** `viewer` lo pide
- **THEN** recibe `404` con `code = "not_found"`, igual que para `GET /api/v1/imports/00000000-0000-4000-8000-00000000ffff`

#### Scenario: Detalle de un import analizado
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** `viewer` llama a `GET /api/v1/imports/{id}`
- **THEN** el cuerpo es igual al que devolvió `POST analyze`: `status = "analyzed"`, cada hoja con `mappingConfirmed = true` y su `mapping`, `analysis.rows`, `analysis.byCycle`, `analysis.warnings`, `channels` con RAM-01, RAM-02 y RAM-07, y `batchFees` con dos fees

### Requirement: Celdas leídas como texto
El lector SHALL devolver toda celda como texto, tomando el valor tal como está escrito en el archivo, sin pasar nunca por un número de coma flotante. Excel no conserva más de 15 dígitos significativos en una celda numérica: una celda numérica con notación científica o más de 15 dígitos SHALL detectarse como pérdida de precisión ya presente en el archivo (nunca ocultarse). `preview` SHALL traer como máximo las cinco primeras filas de datos de cada hoja como objetos `cabecera → texto`.

#### Scenario: Vista previa como texto
- **WHEN** se sube `batch-clean`
- **THEN** la primera fila de `preview` de APP es `{ "ID": "252570479111759", "Amount": "16.22", "Currency": "USD" }`, con los tres valores de tipo string

#### Scenario: ID numérico de 17 dígitos
- **GIVEN** un libro cuya celda A2 es numérica (`t="n"`) con el texto `12345678901234567`
- **WHEN** se lee la hoja
- **THEN** la vista previa muestra el texto del archivo (`"12345678901234567"`) y la columna cuenta una celda numérica con pérdida de precisión

#### Scenario: ID numérico en notación científica
- **GIVEN** un libro cuya celda A2 es numérica con el texto `1.2345678901234567E16`
- **WHEN** se lee la hoja
- **THEN** la vista previa muestra `"1.2345678901234567E16"` y la columna cuenta una celda numérica con pérdida de precisión, mientras que una celda numérica `4512308877` (10 dígitos) no cuenta como pérdida

#### Scenario: Celda numérica con el valor crudo de Excel
- **WHEN** la última fila de APP de `batch-clean` trae `Amount` escrito como `72.09999999999999`
- **THEN** el texto leído es exactamente `"72.09999999999999"`

### Requirement: Cabeceras, conteo de filas y hojas ocultas
La fila 1 de cada hoja SHALL ser la cabecera: cada nombre se recorta, un nombre vacío se sustituye por `Column <letra>` y los repetidos se distinguen con ` (2)`, ` (3)`. `rowCount` SHALL contar las filas posteriores a la cabecera con al menos una celda con valor, texto o fórmula. Cada hoja SHALL indicar `hidden`.

#### Scenario: Fila residual de suma
- **WHEN** CHB, REF y RDR de `batch-clean` terminan con una fila cuya celda `ID` está vacía y `Amount` es una fórmula `=SUM(...)`
- **THEN** esa fila cuenta en `rowCount` (CHB 3, REF 7, RDR 3) y su `ID` en la vista previa es `""`

#### Scenario: Hoja oculta y cabecera vacía
- **WHEN** se lee la hoja `Settings` de la plantilla
- **THEN** `hidden = true`, `rowCount = 21` y las columnas son `Chargeback Alert Fee Types`, `Column B` y `Non-Transactional Fees`

#### Scenario: Cabeceras repetidas
- **GIVEN** una hoja con cabecera `ID, Amount, Amount`
- **WHEN** se lee
- **THEN** las columnas son `ID`, `Amount` y `Amount (2)`

### Requirement: Propuesta de pareo en la respuesta
Cada hoja SHALL traer `proposed` (`kind`, `cycle`, `statusId`, `statusName`, `source` ∈ `account` | `global` | `none`, `note` opcional) y `columns` (`sourceColumn`, `targetField` o `null`, `source`). Una columna propuesta como `status` SHALL traer además `statusValues` con cada valor distinto de la hoja resuelto por alias (`statusId`, `statusName`, `excludeAmount`).

#### Scenario: Propuesta de la plantilla estándar
- **WHEN** se sube `batch-clean` a `ProviderA-USD` (cuenta sin conjunto de reglas)
- **THEN** APP → `{ kind: transactions, cycle: E, statusId: 2, statusName: "Successful", source: global }`, DEC → E/3 "Declined", CHB → I/4 "Chargeback", REF → I/5 "Refund", RDR → I/6 "RDR", RR → `{ kind: transactions, cycle: R, statusId: null }`, `Other Fees` → `{ kind: batch_fees, cycle: null, statusId: null }`, y `Duplicate Corrections`, `CHB Alerts` y `Settings` → `{ kind: ignore }` con `note`, todas con `source = global`
- **AND** en las seis hojas de transacciones `ID → transactionId`, `Amount → amount`, `Currency → currency` con `source = global`; en `Other Fees`, `Type of Fee → feeType`

#### Scenario: Propuesta del conjunto legacy
- **WHEN** se sube `legacy-provider` a `ProviderC-Alt`
- **THEN** TRX → `{ kind: transactions, cycle: E, statusId: null, source: account }`, Fail → E/3 "Declined" `account`, CB → I sin estado `account`, Summary → `ignore` `account`; `Merchant Order No# → transactionId`, `Order Status → status`, `Amount USD → amount` con `source = account`
- **AND** la columna `Order Status` de CB trae `statusValues = [{ value: "CHB 2", statusId: 4, statusName: "Chargeback", excludeAmount: true }]` y la de Fail `[{ value: "Failed", statusId: 3, statusName: "Declined", excludeAmount: false }]`

#### Scenario: Hoja y columna sin propuesta
- **GIVEN** un libro con una hoja `Bonus` cuya cabecera es `Reference, Importe`
- **WHEN** se sube a una cuenta sin conjunto de reglas
- **THEN** la hoja trae `proposed = { kind: null, cycle: null, statusId: null, source: none }` y ambas columnas `targetField = null` y `source = none`

#### Scenario: Persistencia de la propuesta de hoja
- **WHEN** se sube `batch-clean`
- **THEN** cada `ImportSheet` guarda `kind`, `cycle`, `statusId` y `rowCount` de la propuesta con `mappingConfirmed = false`, y no existe ninguna fila de `ImportSheetColumnMap`

#### Scenario: Marcador de hoja sin propuesta
- **GIVEN** una hoja que no coincide con ninguna regla
- **WHEN** se persiste
- **THEN** `ImportSheet.kind` guarda `ignore` únicamente como marcador de "sin propuesta" (la columna no admite NULL), la respuesta la muestra con `kind = null` y `source = none`, y la hoja no puede analizarse hasta que el pareo se confirme

### Requirement: Readiness de la propuesta
La respuesta SHALL traer `readiness` con `canAnalyze`, `missing` (lo que impide analizar con el pareo tal como está) y `notes` (lo que conviene revisar), cada elemento con `sheetId`, `sheetName`, `message` y, en `missing`, `field`. `readiness` SHALL evaluarse sobre el pareo efectivo de cada hoja: el confirmado si existe, la propuesta si no. `canAnalyze` SHALL ser `true` exactamente cuando `missing` está vacío.

#### Scenario: Plantilla lista para analizar
- **WHEN** se sube `batch-clean` a `ProviderA-USD`
- **THEN** `readiness.canAnalyze = true`, `missing = []` y `notes` incluye una entrada por cada hoja ignorada (`Duplicate Corrections`, `CHB Alerts`, `Settings`) y una por la hoja `Settings` oculta

#### Scenario: Legacy listo para analizar
- **WHEN** se sube `legacy-provider` a `ProviderC-Alt`
- **THEN** `readiness.canAnalyze = true` y `missing = []`

#### Scenario: Hoja sin propuesta bloquea
- **GIVEN** un libro con una hoja `Bonus` que no coincide con ninguna regla
- **WHEN** se sube
- **THEN** `readiness.canAnalyze = false` y `missing` contiene `{ sheetName: "Bonus", field: "kind", message }` pidiendo clasificarla como `transactions`, `batch_fees` o `ignore`

#### Scenario: IDs numéricos con pérdida de precisión
- **GIVEN** un libro cuya hoja `APP` trae en la columna `ID` dos celdas numéricas con notación científica o más de 15 dígitos
- **WHEN** se sube a `ProviderA-USD`
- **THEN** `readiness.notes` contiene `{ sheetName: "APP", message }` indicando 2 celdas con pérdida de precisión que se rechazarán al analizar, y `readiness.canAnalyze` no cambia por ello

#### Scenario: Readiness sobre el pareo confirmado
- **GIVEN** el libro con la hoja `Bonus` sin propuesta (`canAnalyze = false`)
- **WHEN** `analyst` confirma el pareo clasificando `Bonus` como `ignore` y el resto tal como se propuso
- **THEN** la respuesta del `PUT` trae `readiness.canAnalyze = true`, `missing = []` y `notes` incluye `Bonus` como hoja ignorada; y si después confirma `APP` sin `transactionId`, `missing` vuelve a nombrar `APP` con `field = "transactionId"` aunque la propuesta recalculada sí la tenga

### Requirement: Límites de lectura del archivo
Antes de parsear, el lector SHALL rechazar con `400 file_too_large` un `.xlsx` cuyo contenido descomprimido supere 64 MiB en total, una hoja con más de 200 000 filas o más de 256 columnas, o un paquete con más de 10 000 entradas; SHALL detenerse al superar el límite sin descomprimir el resto. Un `.xlsx` sin ninguna hoja SHALL rechazarse con `422 file_unreadable`.

#### Scenario: Bomba de descompresión
- **GIVEN** un `.xlsx` de pocos KB cuya hoja se descomprime a más del límite
- **WHEN** se sube
- **THEN** recibe `400` con `code = "file_too_large"` y `details.fileName`, la lectura se interrumpe al superar el límite y no se crea el import

#### Scenario: Justo en el límite
- **GIVEN** un `.xlsx` cuyo contenido descomprimido suma exactamente 64 MiB y otro que suma un byte más
- **WHEN** se leen
- **THEN** el primero se acepta y el segundo responde `400 file_too_large`
- **AND** una hoja con exactamente 200 000 filas de datos se acepta y una con 200 001 responde `400 file_too_large`

#### Scenario: Muestras dentro de los límites
- **WHEN** se suben las cinco muestras de `data/samples`
- **THEN** ninguna supera los límites (la mayor se descomprime a menos de 200 KB) y todas responden `201`

### Requirement: Archivo duplicado dentro del import
El mismo archivo (mismo `sha256`) no SHALL admitirse dos veces en el mismo import, ni dentro de una misma petición. El rechazo SHALL responder `409` con `code = "duplicate_file"` y `details = { fileId, fileName }` del archivo ya incluido, con `fileId = null` cuando la coincidencia es entre dos partes de la misma petición, y el import no SHALL cambiar.

#### Scenario: Repetir un archivo del import
- **GIVEN** un import con `batch-clean.xlsx`
- **WHEN** `analyst` añade de nuevo `batch-clean.xlsx` con otro nombre
- **THEN** recibe `409 duplicate_file` con `details.fileId` del archivo original y `details.fileName = "Recon_Template_ProviderA-USD_batch-clean.xlsx"`, y el import conserva un solo archivo

#### Scenario: Dos partes iguales en la petición
- **WHEN** una petición de creación trae dos partes con los mismos bytes
- **THEN** recibe `409 duplicate_file` con `details.fileId = null` y no se crea ningún import

### Requirement: Mismo archivo admitido en otro import
El mismo archivo SHALL poder subirse a otro import de la misma cuenta, en particular tras cancelar un import y reprocesar con los mismos archivos (HU1 CA8).

#### Scenario: Reprocesar tras cancelar
- **GIVEN** un import de `ProviderA-USD` con `batch-clean.xlsx` analizado y después cancelado
- **WHEN** `analyst` crea un import nuevo en la misma cuenta con el mismo archivo
- **THEN** recibe `201` con un `importId` distinto, `status = "uploaded"` y el mismo `sha256`

### Requirement: Confirmación del pareo
`PUT /api/v1/imports/{id}/mapping` SHALL exigir `settlement.process`, aceptarse solo con el import en `uploaded` o `mapped`, y guardar el pareo de **todas** las hojas del import: `kind`, `cycle`, `statusId` y las columnas con `targetField`. SHALL marcar `mappingConfirmed = true` en cada hoja, sustituir por completo `ImportSheetColumnMap`, pasar el import a `mapped` y responder `200` con el detalle del import. Una segunda confirmación SHALL reemplazar a la anterior.

#### Scenario: Confirmar la propuesta de la plantilla
- **GIVEN** el import de `batch-clean` en `uploaded`
- **WHEN** `analyst` envía la propuesta tal cual (seis hojas `transactions`, `Other Fees` como `batch_fees`, tres `ignore`)
- **THEN** recibe `200` con `status = "mapped"`, cada hoja con `mappingConfirmed = true` y `mapping` igual a lo enviado (con `statusName` resuelto), `readiness.canAnalyze = true`; en base, `ImportSheet.kind/cycle/statusId` reflejan lo confirmado y `ImportSheetColumnMap` tiene tres filas por hoja de transacciones (`ID → transactionId`, `Amount → amount`, `Currency → currency`) y tres para `Other Fees` (`Type of Fee → feeType`, `Amount → amount`, `Currency → currency`)

#### Scenario: Corregir una hoja sin propuesta
- **GIVEN** un import cuya hoja `Bonus` no tiene propuesta (`kind = null`)
- **WHEN** `analyst` la confirma como `{ kind: "transactions", cycle: "I", statusId: 5, columns: [{ sourceColumn: "Reference", targetField: "transactionId" }] }`
- **THEN** recibe `200` con `Bonus` en `mapping` con `statusName = "Refund"` y `readiness.missing` sin `Bonus`, y la propuesta recalculada (`proposed`) sigue mostrando `source = none`

#### Scenario: Reconfirmar reemplaza
- **GIVEN** un import `mapped` con `Currency → currency` en `APP`
- **WHEN** `analyst` vuelve a confirmar sin parear `Currency`
- **THEN** recibe `200`, el import sigue en `mapped`, `mapping.columns` de `APP` ya no incluye `Currency` y en base no queda la fila `(sheetId de APP, "Currency")` de `ImportSheetColumnMap`

#### Scenario: Confirmar un import analizado
- **GIVEN** un import en `analyzed`, `validated`, `processed` o `cancelled`
- **WHEN** se envía `PUT /api/v1/imports/{id}/mapping`
- **THEN** recibe `409` con `code = "import_not_editable"` y `details.status`, y el pareo persistido no cambia

#### Scenario: Sin permiso o fuera del alcance
- **WHEN** `viewer` envía `PUT /api/v1/imports/{id}/mapping` sobre un import de su alcance
- **THEN** recibe `403` con `code = "forbidden"`
- **AND** `analyst` sobre un `importId` inexistente o de un merchant fuera de su alcance recibe `404 not_found`, el mismo cuerpo en ambos casos

### Requirement: Forma del pareo confirmado
El cuerpo del `PUT` SHALL traer exactamente una entrada por cada hoja del import, identificada por `sheetId`. SHALL responder `400 validation_error` (con `details` que nombren la hoja y el campo) cuando falta u sobra una hoja, un `sourceColumn` no existe en la cabecera de la hoja, un `targetField` se repite en la misma hoja, una hoja `transactions` no trae `cycle`, una hoja de ciclo `R` trae `statusId`, o una hoja `batch_fees` o `ignore` trae `cycle` o `statusId`.

#### Scenario: Hoja omitida o desconocida
- **WHEN** el cuerpo omite la hoja `RR` del import, o trae un `sheetId` que no pertenece al import
- **THEN** recibe `400 validation_error` con `details` que nombra el `sheetId` afectado y nada cambia

#### Scenario: Columna inexistente o campo repetido
- **WHEN** `APP` trae `{ sourceColumn: "Reference", targetField: "transactionId" }` (la cabecera es `ID, Amount, Currency`), o dos columnas con `targetField = "amount"`
- **THEN** recibe `400 validation_error` con `details.sheetName = "APP"` y el `sourceColumn` o `targetField` conflictivo

#### Scenario: Ciclo y estado incoherentes
- **WHEN** `RR` se confirma con `cycle = "R"` y `statusId = 2`, o `Other Fees` como `batch_fees` con `cycle = "E"`, o `APP` como `transactions` sin `cycle`
- **THEN** recibe `400 validation_error` nombrando la hoja y el campo (`statusId` o `cycle`)

#### Scenario: Pareo incompleto se guarda
- **WHEN** `analyst` confirma `APP` como `transactions`/`E`/`Successful` sin ninguna columna `transactionId`
- **THEN** recibe `200` con `status = "mapped"` y `readiness.missing` con `{ sheetName: "APP", field: "transactionId" }`; no es un `400`

### Requirement: Campo gateway no admitido todavía
Mientras el README no fije cómo un valor de celda se traduce a un gateway, una columna confirmada con `targetField = "gateway"` SHALL rechazarse con `400 validation_error` que nombre la hoja y la columna; el resto de `targetField` del vocabulario (`txnDate`, `providerRef`, `orderId`, `reference`) SHALL aceptarse y conservarse en `rawData` sin efecto en el cruce.

#### Scenario: Columna gateway
- **WHEN** el pareo confirmado trae `{ sourceColumn: "Gateway", targetField: "gateway" }` en alguna hoja
- **THEN** recibe `400 validation_error` con `details.sheetName`, `details.sourceColumn = "Gateway"` y un mensaje que indica que el campo no está soportado en esta versión

#### Scenario: Columnas de referencia
- **WHEN** el pareo confirmado parea `Order` → `orderId` y `Date` → `txnDate` en `APP`
- **THEN** recibe `200`, el análisis conserva ambos valores en `rawData`, `ImportRow.txnDate` queda `null` y ninguna advertencia se emite por ello

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

### Requirement: Acciones sin cambio de estado en analyzed
En `analyzed`, validar, cambiar una inclusión y resolver una fila SHALL no cambiar el estado del import.

#### Scenario: Validar, cambiar una inclusión o resolver una fila en analyzed
- **GIVEN** un import en `analyzed`
- **WHEN** `analyst` llama a `POST validations`, `PATCH conflict-occurrence` o `PATCH row`
- **THEN** recibe `201`, `200` y `200` respectivamente, y el import sigue en `analyzed`

### Requirement: Transiciones no admitidas del import
Cualquier otra combinación de acción y estado del import SHALL responder `409` con `details.status`: `import_not_mapped` al analizar fuera de `mapped`; `import_not_analyzed` al validar fuera de `analyzed` o `validated` y al revisar fuera de `analyzed`; `import_not_editable` al confirmar, añadir o quitar archivos, resolver filas o cambiar una inclusión fuera de su estado; `import_not_cancellable` al cancelar en `processed` o `cancelled`.

#### Scenario: Analizar sin confirmar
- **GIVEN** un import en `uploaded` con `readiness.canAnalyze = true`
- **WHEN** `analyst` llama a `POST /api/v1/imports/{id}/analyze`
- **THEN** recibe `409` con `code = "import_not_mapped"` y `details.status = "uploaded"`, y el import no cambia

#### Scenario: Analizar dos veces
- **GIVEN** un import en `analyzed`
- **WHEN** se llama de nuevo a `POST /api/v1/imports/{id}/analyze`
- **THEN** recibe `409` con `code = "import_not_mapped"` y `details.status = "analyzed"`; las filas existentes no cambian

### Requirement: Procesar fuera de validated
Procesar o pedir la vista previa fuera de `validated` SHALL responder `409 import_not_validated` con `details.status`.

#### Scenario: Procesar un import ya procesado
- **GIVEN** un import en `processed`
- **WHEN** se llama de nuevo a `POST /api/v1/imports/{id}/settlements`
- **THEN** recibe `409` con `code = "import_not_validated"` y `details.status = "processed"`, y no se crea otro intento

### Requirement: Análisis del import
`POST /api/v1/imports/{id}/analyze` SHALL exigir `settlement.process`, releer los archivos con el pareo confirmado y crear una `ImportRow` por fila de datos de cada hoja `transactions` (`rowNo` = número de fila de la hoja; cabecera = 1). SHALL cruzar cada fila, fijar `rowsTotal`, `rowsMatched`, `rowsUnmatched` y `analyzedAt`, pasar el import a `analyzed` y responder `200`. Filas y estado SHALL persistirse de forma atómica: ante un fallo el import sigue en `mapped` sin filas.

#### Scenario: Plantilla limpia
- **GIVEN** `batch-clean` en `ProviderA-USD` con la propuesta confirmada
- **WHEN** `analyst` analiza
- **THEN** recibe `200` con `status = "analyzed"`, `analyzedAt` no nulo, `rowsTotal = 783`, `rowsMatched = 780`, `rowsUnmatched = 0`, `analysis.rows = { total: 783, matched: 780, unmatched: 0, ambiguous: 0, ignored: 3 }` y `analysis.byCycle = { E: 450, I: 10, R: 320 }`; en base hay 340, 110, 3, 7, 3 y 320 filas para APP, DEC, CHB, REF, RDR y RR, con `rowNo` de 2 en adelante, y ninguna para `Other Fees` ni las hojas ignoradas

#### Scenario: Conjunto legacy del proveedor C
- **GIVEN** `legacy-provider` en `ProviderC-Alt` con la propuesta confirmada
- **WHEN** se analiza
- **THEN** `analysis.rows = { total: 81, matched: 81, unmatched: 0, ambiguous: 0, ignored: 0 }`, `analysis.byCycle = { E: 80, I: 1, R: 0 }`, todas las filas tienen `gatewayId = 2` y `transactionIdRaw` es el UUID en minúsculas tal como está en el archivo

#### Scenario: Canal de otro proveedor
- **GIVEN** `batch-blocked` en `ProviderB-Main` confirmado
- **WHEN** se analiza
- **THEN** `analysis.rows = { total: 21, matched: 21, unmatched: 0, ambiguous: 0, ignored: 0 }` (la fila de RAM-01 cruza porque comparte gateway; que sea de otro proveedor lo detecta `provider_mismatch` al validar) y `channels` incluye RAM-01 con `assignment = "assigned_to_other_account"`

#### Scenario: Fallo a medias
- **GIVEN** un import `mapped` cuya escritura de filas falla tras el primer lote
- **WHEN** se analiza
- **THEN** recibe `500`, el import sigue en `mapped` con `analyzedAt = null` y `rowsTotal = null`, y no existe ninguna `ImportRow` del import

#### Scenario: Dos análisis a la vez
- **GIVEN** un import `mapped`
- **WHEN** dos peticiones `POST analyze` se solapan
- **THEN** una recibe `200 analyzed` y la otra `409 import_not_mapped`, y el número de filas persistidas es exactamente `rowsTotal`

### Requirement: Precondiciones del análisis
Antes de leer filas, el análisis SHALL comprobar que toda hoja tiene `mappingConfirmed = true`, que al menos una hoja es `transactions`, y que cada hoja `transactions` tiene columna `transactionId` y, si su ciclo es `E` o `I`, estado fijo o columna `status`. Si algo falta SHALL responder `422` con `code = "mapping_incomplete"` y `details.missing: { sheetId, sheetName, field, message }[]` (`field` ∈ `confirmation`, `transactions`, `transactionId`, `status`), sin crear filas ni cambiar el estado.

#### Scenario: Falta el estado
- **GIVEN** un import `mapped` cuya hoja `CB` (`cycle = "I"`) se confirmó sin `statusId` y sin columna `status`
- **WHEN** se analiza
- **THEN** recibe `422 mapping_incomplete` con `details.missing` conteniendo `{ sheetName: "CB", field: "status" }` y el import sigue en `mapped`

#### Scenario: Ninguna hoja de transacciones
- **GIVEN** un import `mapped` en el que todas las hojas se confirmaron como `ignore` o `batch_fees`
- **WHEN** se analiza
- **THEN** recibe `422 mapping_incomplete` con un elemento `{ sheetId: null, sheetName: null, field: "transactions" }`

#### Scenario: Varias carencias a la vez
- **GIVEN** `APP` sin `transactionId` y `CB` sin estado
- **WHEN** se analiza
- **THEN** `details.missing` trae ambas entradas en el orden de las hojas del import, y `readiness.missing` del detalle coincide con ellas

### Requirement: Fila original de referencia
Cada `ImportRow` SHALL guardar en `rawData` la fila completa como objeto `cabecera → texto` con todas las celdas leídas (también las no pareadas), en `transactionIdRaw` el texto exacto de la celda de ID y en `cycle` el ciclo de la hoja. Los IDs nunca SHALL pasar por un número: un ID de texto de 17 dígitos SHALL guardarse y devolverse íntegro.

#### Scenario: Primera fila de APP
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta la fila `rowNo = 2` de `APP`
- **THEN** `transactionIdRaw = "252570479111759"`, `rawData = { "ID": "252570479111759", "Amount": "16.22", "Currency": "USD" }`, `cycle = "E"`, `amount = "16.2200"`, `currency = "USD"`, `matchResult = "matched"`

#### Scenario: ID de texto de 17 dígitos
- **GIVEN** una hoja `APP` cuya celda de ID es de texto con `12345678901234567`
- **WHEN** se analiza y se consulta la fila
- **THEN** `transactionIdRaw` y `rawData.ID` son exactamente `"12345678901234567"` (string JSON), sin notación científica ni truncado, y la fila queda `unmatched` con `reason = "no_match"`

#### Scenario: Celda cruda de Excel
- **WHEN** la última fila de APP trae `Amount` como `72.09999999999999`
- **THEN** `rawData.Amount = "72.09999999999999"` y `amount = "72.1000"` (redondeo a cuatro decimales al persistir)

### Requirement: Estado e importe por fila
Para cada fila, `statusId` SHALL venir del estado fijo de la hoja o, si no lo hay, de resolver el texto de la columna `status` por alias (`statusRaw` conserva el texto); en una fila de ciclo `R` SHALL ser el estado actual de la transacción asociada. `amount` SHALL convertirse desde el texto a decimal de cuatro decimales (ilegible → `null` y advertencia `amount_unparsed`); `currency` SHALL guardarse en mayúsculas si son tres letras (si no, `null` y advertencia `currency_invalid`).

#### Scenario: Estado fijo por hoja
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta una fila de DEC
- **THEN** `statusId = 3`, `statusName = "Declined"` y `statusRaw = null`

#### Scenario: Estado por columna
- **GIVEN** `legacy-provider` analizado
- **WHEN** se consultan las filas de `TRX` y `Fail`
- **THEN** en `TRX` `statusRaw = "Successful"` y `statusId = 2`; en `Fail` `statusRaw = "Failed"`, `statusId = 3` y `statusName = "Declined"` sin advertencia

#### Scenario: Fila R toma el estado de la transacción
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta una fila `matched` de RR
- **THEN** `cycle = "R"`, `statusRaw = null` y `statusId` es el `statusId` actual de la transacción asociada (`Successful` en la muestra)

#### Scenario: Moneda inválida
- **GIVEN** una fila con `Currency = "US"`
- **WHEN** se analiza
- **THEN** `currency = null`, `warnings` incluye `"currency_invalid"` y `rawData.Currency = "US"`

### Requirement: Normalización del ID por formato del gateway
Para cada gateway de la cuenta, el texto de ID SHALL normalizarse según `Gateway.idFormat` antes de buscar: `numeric` → recortar espacios, exigir solo dígitos y quitar ceros a la izquierda; `uuid` → recortar, quitar llaves, pasar a minúsculas y exigir la forma `8-4-4-4-12` hexadecimal. Un texto que no encaje en el formato de un gateway no SHALL buscarse en ese gateway; si no encaja en ninguno, la fila queda `unmatched` con `reason = "id_format"`. Nunca SHALL adivinarse un ID.

#### Scenario: Ceros a la izquierda y espacios
- **GIVEN** la transacción `252570479111759` del gateway numérico
- **WHEN** una fila trae ` 00252570479111759 ` como texto
- **THEN** la fila queda `matched` con esa transacción y `transactionIdRaw` conserva `" 00252570479111759 "`

#### Scenario: UUID con llaves y mayúsculas
- **GIVEN** la transacción `df14616d-4b26-4ffb-9984-72717ebff6a6` del gateway UUID de `ProviderC-Alt`
- **WHEN** una fila trae `{DF14616D-4B26-4FFB-9984-72717EBFF6A6}`
- **THEN** la fila queda `matched` con esa transacción

#### Scenario: Formato que no encaja
- **GIVEN** `ProviderA-USD`, cuyos canales son solo del gateway numérico
- **WHEN** una fila trae `df14616d-4b26-4ffb-9984-72717ebff6a6`
- **THEN** la fila queda `unmatched` con `reason = "id_format"` y no se consulta ningún gateway
- **AND** un UUID de 32 hexadecimales sin guiones tampoco encaja en `uuid` (no se completa)

### Requirement: Resultado del cruce
Con el ID normalizado por gateway, el cruce SHALL buscar en `Transaction` por `(gatewayId, sourceTransactionId)` en todos los gateways de la cuenta: una coincidencia es `matched` (se fijan `transactionId` y `gatewayId`); ninguna, `unmatched` con `reason = "no_match"`; más de una, `ambiguous` con `transactionId = null` y las candidatas (gateway, transacción, canal, estado, importe) en `detailJson` y en la respuesta. `rowsUnmatched` no SHALL incluir las ambiguas.

#### Scenario: Dos gateways con el mismo formato
- **GIVEN** una cuenta con canales en dos gateways `numeric` y una transacción con el mismo `sourceTransactionId` en ambos
- **WHEN** se analiza una fila con ese ID
- **THEN** la fila queda `ambiguous`, `transactionId = null`, `gatewayId = null`, `candidates` trae las dos transacciones con sus gateways, `analysis.rows.ambiguous = 1` y `rowsUnmatched` no la cuenta

#### Scenario: Formato desambigua por sí solo
- **GIVEN** una cuenta con un gateway `numeric` y otro `uuid`
- **WHEN** se analiza un ID numérico
- **THEN** solo se busca en el gateway `numeric` y la fila nunca es `ambiguous`

#### Scenario: Ni la cuenta ni su proveedor tienen canales
- **GIVEN** una cuenta sin filas en `AccountChannel` cuyo proveedor no tiene ningún `Channel`
- **WHEN** se analiza un import con IDs válidos
- **THEN** toda fila con ID queda `unmatched` con `reason = "no_gateways"` (nunca `no_match`), sin consultar `Transaction`, y el import pasa a `analyzed` igualmente

### Requirement: Longitud del ID numérico
Un ID normalizado en formato `numeric` de 12 a 17 dígitos SHALL considerarse válido; otra longitud SHALL generar la advertencia `id_length` en la fila y contarse en `analysis.warnings.id_length`, sin impedir el cruce.

#### Scenario: Longitud fuera de rango
- **GIVEN** una hoja `APP` cuya columna `ID` trae como texto `12345678901` (11 dígitos) y `123456789012345678` (18 dígitos), ambos inexistentes
- **WHEN** se analiza
- **THEN** ambas filas quedan `unmatched` con `reason = "no_match"` y `warnings` incluye `"id_length"`, y `analysis.warnings.id_length = 2`

#### Scenario: Longitud válida
- **WHEN** se analiza `batch-clean` (IDs de 15 dígitos) y `batch-issues` (un ID inexistente de 16 dígitos)
- **THEN** `analysis.warnings.id_length = 0` en ambos

### Requirement: IDs con pérdida de precisión no se cruzan
Una celda de ID almacenada como número en la hoja con notación científica o más de 15 dígitos SHALL marcarse `unmatched` con `reason = "lossy_numeric_id"`, conservando el texto leído en `transactionIdRaw`, sin consultar ningún gateway ni intentar reconstruir el ID. SHALL contarse en `analysis.warnings.lossy_numeric_id`.

#### Scenario: Celda numérica de 17 dígitos
- **GIVEN** una hoja `APP` cuya celda de ID es numérica (`t="n"`) con `12345678901234567`
- **WHEN** se analiza
- **THEN** la fila queda `unmatched`, `reason = "lossy_numeric_id"`, `transactionIdRaw = "12345678901234567"`, `transactionId = null` y `analysis.warnings.lossy_numeric_id = 1`

#### Scenario: Notación científica
- **GIVEN** una celda de ID numérica con `1.2345678901234567E16`
- **WHEN** se analiza
- **THEN** la fila queda `unmatched` con `reason = "lossy_numeric_id"` y `transactionIdRaw = "1.2345678901234567E16"`
- **AND** una celda numérica `4512308877` (10 dígitos) sí se cruza, con advertencia `id_length`

### Requirement: Aviso de canales
Tras el análisis, `channels` SHALL listar cada canal de las transacciones asociadas con `channelId`, `name`, `gatewayId`, `providerId`, `rowCount` y `assignment`: `assigned` (la cuenta del import es su principal), `unassigned` (sin fila en `AccountChannel`) o `assigned_to_other_account` (otra cuenta es la principal), con `otherAccount = { accountId, name }` en ese caso y `null` en los demás, y una `note` cuando procesar cambiará la asociación. Ordenados por `channelId`.

#### Scenario: Canal nuevo en el batch limpio
- **GIVEN** `batch-clean` analizado en `ProviderA-USD`
- **WHEN** se consulta `channels`
- **THEN** contiene RAM-01 (1001) y RAM-02 (1002) con `assignment = "assigned"` y RAM-07 (1007) con `assignment = "unassigned"`, `otherAccount = null` y `note` indicando que se asociará a esta cuenta al procesar; ningún otro canal aparece

#### Scenario: Canal nuevo del proveedor B
- **GIVEN** `batch-issues` analizado en `ProviderB-Main`
- **WHEN** se consulta `channels`
- **THEN** RAM-13 (1013) aparece con `assignment = "unassigned"` y RAM-11, RAM-12 con `assigned`

#### Scenario: Canal principal de otra cuenta
- **GIVEN** `batch-blocked` analizado en `ProviderB-Main`
- **WHEN** se consulta `channels`
- **THEN** RAM-01 (1001) aparece con `assignment = "assigned_to_other_account"`, `otherAccount.name = "ProviderA-USD"`, `providerId = 101` y `rowCount = 1`

### Requirement: Cuenta principal de otro merchant en el aviso de canales
Cuando la cuenta principal de un canal de `channels` es de un merchant fuera del alcance de quien consulta, `otherAccount` SHALL ser `{ accountId: null, name: null, outOfScope: true }` y `assignment` SHALL conservarse (README §1.2: un merchant no ve los proveedores de otro). El cruce no cambia.

#### Scenario: Cuenta principal de otro merchant
- **GIVEN** un canal del gateway compartido cuya cuenta principal es de otro merchant, y un import analizado de `ProviderA-USD` con una fila asociada a una transacción de ese canal
- **WHEN** consulta el detalle un usuario cuyo alcance no incluye ese merchant
- **THEN** el canal aparece con `assignment = "assigned_to_other_account"` y `otherAccount = { accountId: null, name: null, outOfScope: true }`; un usuario con ambos merchants en su alcance ve `otherAccount = { accountId, name }`

### Requirement: Canal de otro merchant en el aviso de canales
Cuando un canal de `channels` pertenece a un merchant fuera del alcance de quien consulta, la entrada SHALL conservar `channelId`, `gatewayId`, `rowCount` y `assignment`, y SHALL devolver `name = null`, `providerId = null` y `outOfScope = true`. Para quien sí tiene ese merchant en su alcance la entrada no lleva `outOfScope`.

#### Scenario: Canal de otro merchant
- **GIVEN** un import analizado de `ProviderA-USD` con una fila asociada a una transacción de un canal de otro merchant en un gateway compartido
- **WHEN** consulta el detalle un usuario cuyo alcance no incluye ese merchant
- **THEN** el canal aparece con su `channelId`, `rowCount` y `assignment`, `name = null`, `providerId = null` y `outOfScope = true`, y ni su nombre ni su proveedor aparecen en la respuesta

### Requirement: Fees por batch prellenados desde la hoja de fees
En todo import analizado, `batchFees` SHALL derivarse de las filas de las hojas `batch_fees` con el pareo confirmado (`feeType`, `amount`, `currency`): cada fila con tipo o importe produce `{ feeTypeId, code, title, amount, currency, source: "file", warning? }`, con el tipo resuelto por título contra `FeeType` sin distinguir mayúsculas ni espacios. Tipo desconocido → `feeTypeId` y `code` nulos, el texto leído como `title` y `warning`. Antes de analizar, `batchFees` SHALL ser `null`.

#### Scenario: Dos fees de la plantilla
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta `batchFees`
- **THEN** trae exactamente `[{ title: "Wire Fee", amount: "25.0000", currency: "USD", source: "file" }, { title: "Settlement Fee", amount: "15.0000", … }]` con `feeTypeId` y `code` del catálogo y sin `warning`

#### Scenario: Tipo fuera de catálogo
- **GIVEN** `batch-issues` analizado
- **WHEN** se consulta `batchFees`
- **THEN** `Wire Fee` resuelve y `Fraud Monitoring Fee` trae `feeTypeId = null`, `code = null`, `title = "Fraud Monitoring Fee"`, `amount = "99.0000"` y `warning` indicando que el tipo no está en el catálogo

### Requirement: Resumen del análisis
En todo import analizado, `analysis` SHALL traer `rows` (`total`, `matched`, `unmatched`, `ambiguous`, `ignored`), `byCycle` (filas no ignoradas por ciclo `E`, `I`, `R`) y `warnings` (conteo por código: `negative_amount`, `non_usd_currency`, `amount_unparsed`, `currency_invalid`, `id_length`, `lossy_numeric_id`, `status_unresolved`, `status_differs_from_sheet`, `cycle_mismatch`), calculados desde las filas persistidas, de modo que `GET /api/v1/imports/{id}` devuelva lo mismo que `POST analyze`.

#### Scenario: Resumen sin advertencias
- **GIVEN** `batch-clean` analizado
- **WHEN** se consulta `analysis`
- **THEN** `rows = { total: 783, matched: 780, unmatched: 0, ambiguous: 0, ignored: 3 }`, `byCycle = { E: 450, I: 10, R: 320 }` y todos los códigos de `warnings` valen `0`

#### Scenario: Resumen con advertencias
- **GIVEN** `batch-issues` analizado
- **WHEN** se consulta `analysis`
- **THEN** `rows = { total: 770, matched: 766, unmatched: 1, ambiguous: 0, ignored: 3 }`, `byCycle = { E: 440, I: 10, R: 317 }`, `warnings.negative_amount = 1` y `warnings.non_usd_currency = 0`

### Requirement: Filas del import
`GET /api/v1/imports/{id}/rows` SHALL responder `200` con `{ items, page, pageSize, total }`, ordenando primero `unmatched`, después `ambiguous`, `matched` e `ignored`, y dentro de cada grupo por archivo (`uploadedAt`), nombre de hoja y `rowNo`. `match=` SHALL filtrar por `matchResult` y `sheetId=` por hoja; `page` (desde 1) y `pageSize` (1 a 500, por defecto 50) fuera de rango SHALL responder `400`. Antes del análisis la página SHALL estar vacía con `total = 0`.

#### Scenario: Forma de una fila
- **GIVEN** `batch-issues` analizado
- **WHEN** `viewer` pide `GET /api/v1/imports/{id}/rows?page=1&pageSize=50`
- **THEN** `total = 770`, `items[0]` es la fila `unmatched` (`transactionIdRaw = "4260465812403708"`) y cada elemento trae `fileId`, `fileName`, `sheetId`, `sheetName`, `rowNo`, `cycle`, `matchResult`, `reason`, `transactionIdRaw`, `transactionId` (string o `null`), `gatewayId`, `statusRaw`, `statusId`, `statusName`, `amount` (string decimal o `null`), `currency`, `excludeAmount`, `ignore`, `warnings` (lista de códigos), `candidates` (lista, vacía si no es ambigua), `transaction` (`{ transactionId, channelId, channelName, statusId, statusName, amount, transactionDate }` o `null`) y `rawData`

#### Scenario: Filtro y paginación
- **WHEN** se pide `?match=ignored` de `batch-clean`
- **THEN** `total = 3` y los tres elementos tienen `matchResult = "ignored"`
- **AND** `?page=0`, `?pageSize=0`, `?pageSize=501` o `?match=weird` responden `400 validation_error`
- **AND** `?match=matched&page=16&pageSize=50` de `batch-clean` responde `30` elementos y `total = 780`

#### Scenario: Antes de analizar y fuera del alcance
- **WHEN** se piden las filas de un import en `uploaded` o `mapped`
- **THEN** recibe `200` con `items = []` y `total = 0`
- **AND** `viewer` sobre un import de `ProviderC-Alt` o sobre un UUID inexistente recibe `404 not_found` con el mismo cuerpo

### Requirement: Transacción de otro merchant en las filas
Cuando la transacción asociada a una fila es de un merchant fuera del alcance de quien consulta, `GET rows` SHALL devolver `transaction = null` y añadir a `warnings` el aviso `out_of_scope_transaction`; `matchResult` y `transactionId` no cambian; en una fila R, cuyo estado es el de la transacción, `statusId` y `statusName` SHALL ser `null`. Ese aviso depende de quien lee y SHALL NOT contarse en `analysis.warnings`.

#### Scenario: Transacción de otro merchant
- **GIVEN** un import analizado con una fila `matched` a una transacción de otro merchant en un gateway compartido
- **WHEN** un usuario sin ese merchant en su alcance pide `GET /imports/{id}/rows`
- **THEN** la fila conserva `matchResult = "matched"` y `transactionId`, `transaction` es `null` y `warnings` contiene `out_of_scope_transaction`; ningún dato de la transacción (canal, importe, estado) aparece en la respuesta, y `analysis` es el mismo que ve un usuario con ambos merchants

### Requirement: Candidata de otro merchant en una fila ambigua
Una candidata cuya transacción es de un merchant fuera del alcance de quien consulta SHALL conservar `gatewayId`, `gatewayName` y `transactionId`, necesarios para resolver la fila, y SHALL devolver `channelId`, `channelName`, `statusId`, `statusName` y `amount` a `null` con `outOfScope = true`. La misma regla SHALL aplicarse a las candidatas que lista el `400` de un `PATCH` con un gateway que no es candidato.

#### Scenario: Candidata de otro merchant
- **GIVEN** una fila ambigua con una candidata de otro merchant (gateway compartido) y otra del merchant del usuario (gateway propio de la cuenta)
- **WHEN** un usuario sin el otro merchant en su alcance pide `GET /imports/{id}/rows?match=ambiguous`
- **THEN** la candidata de otro merchant lleva solo `gatewayId`, `gatewayName`, `transactionId` y `outOfScope = true`, con el resto a `null`; la propia sale completa; ni el canal ni el importe de la otra aparecen en la respuesta

### Requirement: Resolución de una fila ambigua
`PATCH /api/v1/imports/{id}/rows/{sheetId}/{rowNo}` con cuerpo `{ gatewayId }` SHALL exigir `settlement.process` y el import en `analyzed`. Si la fila es `ambiguous` y `gatewayId` es una de sus candidatas, SHALL fijar `transactionId` y `gatewayId`, pasarla a `matched`, incrementar `rowsMatched` y responder `200` con la fila.

#### Scenario: Elegir el gateway
- **GIVEN** una fila `ambiguous` con candidatas en los gateways 1 y 3
- **WHEN** `analyst` envía `{ gatewayId: 3 }`
- **THEN** recibe `200` con `matchResult = "matched"`, `gatewayId = 3`, `transactionId` de la candidata de ese gateway, `candidates` conservadas, `rowsMatched` del import aumenta en 1, `analysis.rows.ambiguous` baja en 1, y existe una fila de `AuditLog` con `userId` de `analyst`, `action = "import.row.resolve_gateway"` y `entityId = "<sheetId>:<rowNo>"`

#### Scenario: Gateway que no es candidato
- **WHEN** `analyst` envía `{ gatewayId: 2 }` y ninguna candidata pertenece al gateway 2
- **THEN** recibe `400 validation_error` con `details.candidates` y la fila no cambia

#### Scenario: Fila que no es ambigua
- **WHEN** se intenta resolver una fila `matched`, `unmatched` o `ignored`
- **THEN** recibe `409` con `code = "row_not_ambiguous"` y `details.matchResult`

#### Scenario: Estado, permiso y alcance
- **WHEN** el import no está en `analyzed`
- **THEN** recibe `409 import_not_editable` con `details.status`
- **AND** `viewer` recibe `403 forbidden`; una fila o un import inexistentes o fuera del alcance, `404 not_found`

### Requirement: Efectos de resolver una fila ambigua
Al resolver una fila ambigua, el sistema SHALL marcar como superada la corrida vigente si la hay (P7) y registrar en `AuditLog` (`import.row.resolve_gateway`, `entityType = "ImportRow"`, `entityId = "<sheetId>:<rowNo>"`, detalle con import, gateway, candidatas y la corrida superada).

#### Scenario: Resolver una fila tras validar
- **GIVEN** un import `analyzed` con una corrida vigente y una fila `ambiguous`
- **WHEN** `analyst` resuelve la fila
- **THEN** la corrida pasa a `isSuperseded = 1` sin sustituta, `GET validations` devuelve `run = null`, `POST review` responde `409 validation_run_required` y el detalle de auditoría trae `supersededRunId`

### Requirement: Cancelación del import
`POST /api/v1/imports/{id}/cancel` SHALL exigir `settlement.process`, aceptarse en `uploaded`, `mapped`, `analyzed` y `validated`, pasar el import a `cancelled`, registrar en `AuditLog` (`action = "import.cancel"`, `entityType = "Import"`, detalle con el estado anterior y la corrida vigente o `null`) y responder `200` con el detalle. En `processed` o `cancelled` SHALL responder `409 import_not_cancellable`.

#### Scenario: Cancelar un import analizado
- **GIVEN** `batch-clean` analizado
- **WHEN** `analyst` cancela
- **THEN** recibe `200` con `status = "cancelled"`, `files`, `analysis`, `channels` y `batchFees` iguales a los de antes, el archivo sigue en `storagePath`, las 783 filas siguen en base y `GET /api/v1/imports/{id}/rows` las devuelve; existe una fila de `AuditLog` con `action = "import.cancel"`, `entityId = importId`, `detailJson.previousStatus = "analyzed"` y `detailJson.runId = null`

#### Scenario: Cancelar sin analizar
- **GIVEN** un import en `uploaded`
- **WHEN** se cancela
- **THEN** recibe `200` con `status = "cancelled"`, `analysis = null`, y `POST /api/v1/imports/{id}/files` responde después `409 import_not_editable`

#### Scenario: Cancelar dos veces o un import procesado
- **WHEN** se cancela un import ya `cancelled`, o uno en `processed`
- **THEN** recibe `409` con `code = "import_not_cancellable"` y `details.status`
- **AND** `viewer` recibe `403 forbidden` y un import fuera del alcance `404 not_found`

### Requirement: Conservación al cancelar
Cancelar un import SHALL conservar sus archivos en `UPLOAD_DIR`, hojas, pareo confirmado, filas, corridas, hallazgos y apariciones.

#### Scenario: Cancelar tras validar
- **GIVEN** `batch-blocked` analizado con una corrida vigente bloqueada
- **WHEN** `analyst` cancela (la única salida, HU2 CA5 y CA8)
- **THEN** recibe `200` con `status = "cancelled"`, la corrida, sus resultados, hallazgos y apariciones siguen en base y legibles con `GET validations`, y `detailJson.runId` es el de esa corrida

### Requirement: Límite de filas por import
El análisis SHALL rechazar con `422` y `code = "import_too_large"` (`details = { rows, limit }`) un import cuya suma de `rowCount` de las hojas `transactions` de todos sus archivos supere 100 000 filas. La comprobación SHALL hacerse con los conteos obtenidos en la subida, antes de leer filas y antes de escribir nada, de modo que el import siga en `mapped` sin ninguna `ImportRow`.

#### Scenario: Justo en el límite
- **GIVEN** un import `mapped` cuyas hojas `transactions` suman exactamente 100 000 filas
- **WHEN** se analiza
- **THEN** el análisis se ejecuta y el import pasa a `analyzed` con `rowsTotal = 100000`

#### Scenario: Una fila por encima
- **GIVEN** un import `mapped` cuyas hojas `transactions` suman 100 001 filas (en uno o varios archivos)
- **WHEN** se analiza
- **THEN** recibe `422` con `code = "import_too_large"` y `details = { rows: 100001, limit: 100000 }`, no se lee ninguna fila, el import sigue en `mapped` y no existe ninguna `ImportRow`

#### Scenario: Las hojas ignoradas y de fees no cuentan
- **GIVEN** un import cuyas hojas `transactions` suman 90 000 filas y cuyas hojas `ignore` y `batch_fees` suman 20 000
- **WHEN** se analiza
- **THEN** no se rechaza por tamaño

### Requirement: Capacidad de análisis
El análisis SHALL admitir hasta 100 000 filas de transacciones por import (hojas de hasta 200 000 filas según el límite del lector) sin superar el límite de 2 100 parámetros por sentencia de SQL Server, y SHALL completar un import del tamaño de las muestras (783 filas) en menos de 3 segundos sobre la base local.

#### Scenario: Muestra mayor
- **WHEN** se analiza `batch-clean` en la base sembrada local
- **THEN** la petición responde `200` en menos de 3 s

#### Scenario: Veinte mil filas
- **GIVEN** un libro generado con una hoja `APP` de 20 000 filas de IDs de texto inexistentes
- **WHEN** se confirma y analiza
- **THEN** responde `200` en menos de 20 s con `analysis.rows.unmatched = 20000` y exactamente 20 000 filas en base

#### Scenario: Cien mil filas
- **GIVEN** 100 000 filas con la forma de `batch-clean`
- **WHEN** se persisten en una sola transacción (medición de referencia, fuera de CI)
- **THEN** la escritura termina en menos de 90 s

### Requirement: Pantalla Upload Files: elección de la cuenta
La pantalla New Reconciliation (`/reconciliations/new`) SHALL exigir `settlement.process` y ofrecer merchant → proveedor → cuenta, solo con merchants del alcance y cuentas activas; un único valor posible SHALL preseleccionarse. La selección SHALL reflejarse en la dirección (`merchantId`, `providerId`, `accountId`). La zona de subida SHALL habilitarse solo con una cuenta elegida.

#### Scenario: analyst elige la cuenta
- **GIVEN** `analyst` (merchants 1 y 2)
- **WHEN** abre New Reconciliation y elige `Merchant A`, `Provider A` y `ProviderA-USD`
- **THEN** la dirección es `/reconciliations/new?merchantId=1&providerId=101&accountId=<id de ProviderA-USD>` y la zona de subida queda habilitada

#### Scenario: Sin cuenta elegida
- **WHEN** `analyst` abre New Reconciliation con `Merchant A` y `Provider A` pero sin cuenta
- **THEN** la zona de subida está deshabilitada e indica que hay que elegir una cuenta, y no se llama a ninguna ruta de imports

#### Scenario: Cuenta fuera del alcance en el enlace
- **GIVEN** `analyst` cuyo alcance no incluye una cuenta
- **WHEN** abre `/reconciliations/new` con el `accountId` de esa cuenta
- **THEN** ve `This merchant, provider or account is not available.` y puede elegir entre sus merchants visibles

#### Scenario: viewer sin permiso
- **WHEN** `viewer` abre `/reconciliations/new`
- **THEN** ve `You don't have access to this page` y no se llama a ningún endpoint de la pantalla

### Requirement: Pantalla Upload Files: subida de archivos
El usuario SHALL poder arrastrar y soltar, o elegir con el teclado, uno o varios `.xlsx`, que se suben en orden. El primer archivo que el API acepta SHALL crear el import y la aplicación SHALL llevar a su paso Files sin esperar al resto; los demás SHALL añadirse a ese import aunque el usuario navegue. El paso Files SHALL listar cada archivo con sus hojas y sus filas.

#### Scenario: Batch repartido en dos archivos
- **GIVEN** `analyst` con `ProviderA-USD` elegida
- **WHEN** suelta `Recon_Template_ProviderA-USD_batch-split_part1.xlsx` y `…_part2.xlsx` a la vez
- **THEN** llega a `/imports/<importId>` en el paso Files con un solo import en `uploaded` y dos archivos: part1 con `APP` 340 y `DEC` 110; part2 con `CHB` 3, `REF` 7, `RDR` 3, `RR` 320 y `Other Fees` 2

#### Scenario: Plantilla en un archivo
- **WHEN** `analyst` sube `Recon_Template_ProviderA-USD_batch-clean.xlsx`
- **THEN** ve un archivo con diez hojas, `APP` 340, `DEC` 110, `CHB` 3, `REF` 7, `RDR` 3, `RR` 320, `Duplicate Corrections` 0, `CHB Alerts` 0, `Other Fees` 2 y `Settings` 21 marcada como oculta

#### Scenario: Añadir un archivo desde el paso Files
- **GIVEN** un import en `uploaded` creado con `batch-split_part1.xlsx`
- **WHEN** `analyst` añade `batch-split_part2.xlsx` en el paso Files
- **THEN** el import muestra los dos archivos y sigue siendo el mismo `importId`

#### Scenario: Subida en curso
- **WHEN** `analyst` suelta un archivo
- **THEN** el archivo aparece como `Uploading…` y la zona de subida no admite otra selección hasta que termina

#### Scenario: Diez archivos con navegación a mitad
- **GIVEN** `analyst` con `ProviderA-USD` elegida
- **WHEN** suelta diez `.xlsx` distintos y válidos, la aplicación pasa a `/imports/<importId>` tras el primero y, antes de que terminen, `analyst` abre Dashboard y vuelve al import
- **THEN** el API recibe las diez subidas, una sola de ellas crea el import, y el paso Files muestra los diez archivos

#### Scenario: Continuar al pareo
- **GIVEN** un import en `uploaded` con al menos un archivo
- **WHEN** `analyst` pulsa **Continue to mapping** en el paso Files
- **THEN** la pantalla pasa al paso Mapping (`step=mapping`); el botón no aparece sin archivos ni para `viewer`

#### Scenario: Primer archivo ilegible
- **GIVEN** `analyst` con `ProviderA-USD` elegida
- **WHEN** suelta `broken.xlsx` (el API responde `422 file_unreadable`) seguido de `Recon_Template_ProviderA-USD_batch-clean.xlsx`
- **THEN** `broken.xlsx` aparece rechazado con su motivo, `batch-clean` crea el import con `POST /api/v1/accounts/{id}/imports` y el import contiene solo `batch-clean`

### Requirement: Pantalla Upload Files: archivos rechazados
Un archivo rechazado SHALL mostrarse en la lista con su nombre y el motivo, sin afectar a los archivos ya incluidos ni al pareo en edición. Antes de enviar, la pantalla SHALL rechazar sin llamar al API un archivo que no sea `.xlsx` o que supere 20 MiB, y una selección de más de 10 archivos. Los rechazos del API SHALL mostrarse con el mismo texto que los del cliente.

#### Scenario: Duplicado con el nombre del coincidente
- **GIVEN** el import con `batch-split_part1.xlsx` y `batch-split_part2.xlsx` y un cambio sin confirmar en la hoja `DEC`
- **WHEN** `analyst` vuelve a subir `part1` con otro nombre
- **THEN** la fila del archivo rechazado muestra `This file is already in the import as Recon_Template_ProviderA-USD_batch-split_part1.xlsx.`, el import sigue con dos archivos y el cambio sin confirmar de `DEC` se conserva

#### Scenario: Tipo no permitido
- **WHEN** `analyst` suelta `batch.csv`
- **THEN** ve `batch.csv` con `Only .xlsx files are accepted.` y no se envía ninguna petición

#### Scenario: Tamaño excedido
- **WHEN** `analyst` suelta un `.xlsx` de 20 971 521 bytes
- **THEN** ve el archivo con `The file exceeds the 20 MB limit.` y no se envía ninguna petición; un archivo de exactamente 20 971 520 bytes sí se envía

#### Scenario: Más de diez archivos
- **WHEN** `analyst` suelta once `.xlsx` a la vez
- **THEN** ve `Select at most 10 files at a time.` y no se envía ninguno

#### Scenario: Archivo ilegible
- **WHEN** el API responde `422 file_unreadable` a `batch.xlsx`
- **THEN** ve `batch.xlsx` con `The file cannot be read as an Excel workbook.` y los demás archivos de la selección se siguen subiendo

### Requirement: Pantalla Upload Files: quitar archivos
Mientras el import esté en `uploaded` o `mapped`, cada archivo SHALL tener **Remove**. Quitarlo SHALL actualizar la lista, las hojas del paso Mapping y la readiness con la respuesta del API, conservando los cambios sin confirmar de las hojas que siguen.

#### Scenario: Quitar la segunda parte
- **GIVEN** el import con `part1` y `part2` de `batch-split`
- **WHEN** `analyst` pulsa **Remove** en `part2`
- **THEN** la lista muestra solo `part1`, el paso Mapping ya no muestra la tarjeta de `part2` (con `CHB` 3, `REF` 7, `RDR` 3, `RR` 320 y `Other Fees` 2) y solo quedan las hojas de `part1`, y la readiness es la que devolvió el API

#### Scenario: Quitar el último archivo
- **WHEN** `analyst` quita el único archivo del import
- **THEN** ve el import vacío con la zona de subida, y **Analyze** deshabilitado

### Requirement: Pantalla Column Mapping: propuesta por hoja
El paso Mapping SHALL mostrar una tarjeta por archivo y, por hoja, destacados su nombre y la propuesta en lenguaje del analista (`Proposed: <ciclo> · <estado> — <origen>`, `Proposed: batch fees`, `Proposed: ignore` o `No proposal`, con origen `account rule` o `global rule` y su `note`), sus filas, si está oculta, y los controles de tipo, ciclo y estado fijo con el pareo efectivo.

#### Scenario: Propuesta de la plantilla estándar
- **WHEN** `analyst` abre el paso Mapping del import de `batch-clean` recién subido
- **THEN** `APP` muestra `Proposed: E · Successful — global rule`, `DEC` `Proposed: E · Declined — global rule`, `CHB` `Proposed: I · Chargeback — global rule`, `REF` `Proposed: I · Refund — global rule`, `RDR` `Proposed: I · RDR — global rule`, `RR` `Proposed: R · reserve, no status — global rule` y `Other Fees` `Proposed: batch fees — global rule`
- **AND** los controles de `APP` muestran `Transactions`, `E` y `Successful`

#### Scenario: Propuesta del conjunto legacy
- **WHEN** abre el paso Mapping del import de `legacy-provider` en `ProviderC-Alt`
- **THEN** `TRX` muestra `Proposed: E · status from column — account rule`, `Fail` `Proposed: E · Declined — account rule`, `CB` `Proposed: I · status from column — account rule` y `Summary` `Proposed: ignore — account rule`

#### Scenario: La propuesta sigue visible al editar
- **WHEN** `analyst` cambia el ciclo de `DEC` a `I` sin confirmar
- **THEN** la cabecera de `DEC` sigue mostrando `Proposed: E · Declined — global rule` y el control de ciclo muestra `I`

#### Scenario: Hoja sin propuesta
- **GIVEN** un libro con una hoja `Bonus` sin regla
- **WHEN** abre el paso Mapping
- **THEN** `Bonus` muestra `No proposal` y el tipo sin elegir

### Requirement: Pantalla Column Mapping: hojas sin nada que parear
Una hoja con 0 filas y tipo propuesto SHALL mostrarse como una línea compacta con su nombre y `0 rows`, sin controles ni vista previa. Una hoja con filas ignorada por regla SHALL mostrarse como una línea compacta con su nombre, la propuesta y sus filas, con **Edit** para desplegar sus controles y su nota.

#### Scenario: Hojas compactas de la plantilla estándar
- **WHEN** `analyst` abre el paso Mapping del import de `batch-clean` recién subido
- **THEN** `Duplicate Corrections` y `CHB Alerts` (0 filas) son una línea con `0 rows` sin controles, y `Settings` (21 filas) una línea con `Proposed: ignore — global rule`, `21 rows` y **Edit**, sin controles

#### Scenario: Editar una hoja ignorada por regla
- **WHEN** `analyst` pulsa **Edit** en `Settings`
- **THEN** ve los controles de `Settings` con `Ignore` y su nota `Sheet "Settings" is ignored by rule "Settings"`, y puede cambiar el tipo

### Requirement: Pantalla Column Mapping: propuesta por columna
Por cada columna de una hoja `Transactions` o `Batch fees`, el paso Mapping SHALL mostrar el campo del pareo efectivo y el origen de la propuesta, o `Keep as reference` cuando no se parea. Una columna pareada como `status` SHALL mostrar cómo se resuelve cada valor distinto de la hoja (`statusValues`). La lista de campos SHALL excluir `gateway`.

#### Scenario: Columnas de la plantilla
- **WHEN** abre el paso Mapping del import de `batch-clean`
- **THEN** en `APP` ve `ID` → `Transaction ID`, `Amount` → `Amount`, `Currency` → `Currency`, cada una con `Global rule`, y en `Other Fees` `Type of Fee` → `Fee type`

#### Scenario: Valores de estado del legacy
- **WHEN** abre el paso Mapping del import de `legacy-provider`
- **THEN** la columna `Order Status` de `CB` muestra `CHB 2` → `Chargeback` con importe excluido, y la de `Fail` `Failed` → `Declined`

#### Scenario: Sin campo gateway
- **WHEN** abre la lista de campos de cualquier columna
- **THEN** no aparece `Gateway`

### Requirement: Pantalla Column Mapping: vista previa
Cada hoja SHALL mostrar la vista previa que devuelve el API (hasta cinco filas) como texto tal cual, sin convertir números. La cabecera de cada columna SHALL indicar el campo del pareo en edición y SHALL cambiar en cuanto el usuario cambia el campo, antes de confirmar.

#### Scenario: ID como texto
- **WHEN** abre la vista previa de `APP` de `batch-clean`
- **THEN** la primera fila muestra `252570479111759`, `16.22` y `USD` tal cual

#### Scenario: Cambiar un campo actualiza la vista previa
- **WHEN** `analyst` cambia `Currency` de `APP` a `Keep as reference`
- **THEN** la cabecera de esa columna en la vista previa deja de indicar `Currency` sin que se haya enviado ninguna petición

### Requirement: Pantalla Column Mapping: edición del pareo
Con permiso y el import en `uploaded` o `mapped`, el usuario SHALL poder cambiar tipo, ciclo, estado fijo y campo de cada columna. Ciclo `R` SHALL dejar el estado fijo sin valor y deshabilitado; `Batch fees` e `Ignore` SHALL deshabilitar ciclo y estado; `Ignore` SHALL deshabilitar las columnas. Un mismo campo en dos columnas de una hoja SHALL marcarse como error y bloquear la confirmación.

#### Scenario: Reserva sin estado
- **WHEN** `analyst` cambia el ciclo de `REF` a `R`
- **THEN** el estado fijo de `REF` queda vacío y deshabilitado

#### Scenario: Campo repetido
- **WHEN** `analyst` parea `Amount` y `Currency` de `APP` a `Amount`
- **THEN** ambas columnas muestran `Amount is mapped twice in this sheet.` y **Confirm mapping** está deshabilitado

#### Scenario: Clasificar una hoja sin propuesta
- **GIVEN** la hoja `Bonus` sin propuesta
- **WHEN** `analyst` la marca como `Ignore`
- **THEN** sus columnas quedan deshabilitadas y `Bonus` puede confirmarse

### Requirement: Pantalla Column Mapping: confirmación
**Confirm mapping** SHALL enviar el pareo de todas las hojas del import, también las que se muestran compactas, con las columnas no pareadas fuera y sin columnas en las hojas `Ignore`. Con `200` el import SHALL mostrarse en `mapped`, la pantalla SHALL tomar el pareo confirmado como estado sin cambios y SHALL mostrar la readiness de la respuesta. Un `400` o `409` SHALL mostrarse en contexto sin perder lo editado.

#### Scenario: Confirmar la propuesta de la plantilla
- **GIVEN** el import de `batch-clean` en `uploaded`
- **WHEN** `analyst` pulsa **Confirm mapping** sin cambiar nada
- **THEN** el `PUT` trae las diez hojas, con `ID`, `Amount` y `Currency` en las seis de transacciones, `Type of Fee`, `Amount` y `Currency` en `Other Fees` y ninguna columna en las tres ignoradas; el import muestra `mapped` y `Ready to analyze`

#### Scenario: Corregir una propuesta y confirmar
- **GIVEN** el import de `batch-clean` en `uploaded`
- **WHEN** `analyst` cambia `DEC` a ciclo `I` con estado `Refund` y confirma
- **THEN** el import muestra `mapped`, `DEC` muestra `I` · `Refund` como pareo confirmado y la vista previa sigue mostrando sus filas

#### Scenario: Import que ya no es editable
- **WHEN** el `PUT` responde `409 import_not_editable` con `details.status = "analyzed"`
- **THEN** ve `This import can no longer be edited (analyzed).` y la pantalla se recarga con el import tal como está

#### Scenario: Envío en curso
- **WHEN** `analyst` pulsa **Confirm mapping**
- **THEN** el botón queda deshabilitado hasta la respuesta y un segundo clic no envía otro `PUT`

### Requirement: Pantalla Column Mapping: readiness y Analyze
La barra de readiness SHALL mostrar `Ready to analyze` o cada elemento de `readiness.missing` como `<hoja> · <campo>: <mensaje>`, las `notes` y, en `mapped`, cada hoja con `mappingConfirmed = false` como `<hoja> · confirmation`. **Analyze** SHALL habilitarse solo en `mapped`, con `readiness.canAnalyze = true`, todas las hojas confirmadas y sin cambios sin confirmar; deshabilitado, SHALL indicar el motivo.

#### Scenario: Hoja sin ID
- **GIVEN** un import en `mapped` cuya hoja `APP` se confirmó sin `Transaction ID`
- **WHEN** `analyst` abre el paso Mapping
- **THEN** **Analyze** está deshabilitado y la barra muestra `APP · transactionId` con su mensaje
- **AND** al parear `ID` → `Transaction ID` y confirmar, la barra muestra `Ready to analyze` y **Analyze** se habilita

#### Scenario: Pareo sin confirmar
- **GIVEN** el import de `batch-clean` en `uploaded` con `readiness.canAnalyze = true`
- **WHEN** abre el paso Mapping
- **THEN** **Analyze** está deshabilitado con `Confirm the mapping before analyzing.`

#### Scenario: Cambios sin confirmar
- **GIVEN** un import en `mapped` listo para analizar
- **WHEN** `analyst` cambia un campo sin confirmar
- **THEN** **Analyze** se deshabilita con `Confirm the mapping before analyzing.` hasta que confirma

#### Scenario: Archivo añadido tras confirmar
- **GIVEN** un import en `mapped` con `part1` confirmado
- **WHEN** `analyst` añade `part2`
- **THEN** la barra nombra cada hoja de `part2` con `confirmation` y **Analyze** está deshabilitado, aunque el detalle del API responda `readiness.canAnalyze = true` (solo el `422` de analyze trae esas hojas; la pantalla las deriva de `mappingConfirmed`)

### Requirement: Pantalla Column Mapping: readiness por archivo
La barra de readiness SHALL agrupar sus elementos por archivo bajo su nombre, con lo del import sin hoja antes, y dentro de cada archivo lo accionable primero. Las notas puramente informativas (hoja sin filas, hoja oculta, hoja ignorada por regla) SHALL plegarse dentro de su archivo bajo `N informational notes`. En cada elemento, el nombre de la hoja (o `Import`) SHALL ir en negrita y separado de su descripción, también cuando la barra dice `Ready to analyze`.

#### Scenario: Notas por archivo
- **GIVEN** el import de `batch-split` recién subido
- **WHEN** abre el paso Mapping
- **THEN** la barra muestra un grupo por archivo con su nombre; en `part1`, el elemento de `DEC` (`Fixed status Declined with rows: the DEC range will open at validation`) a la vista y `8 informational notes` plegadas; en `part2`, solo `6 informational notes` plegadas

#### Scenario: Nombre de hoja destacado
- **GIVEN** el import de `batch-split` recién subido
- **WHEN** mira el elemento de `DEC` en el grupo de `part1`
- **THEN** `DEC` está en negrita en su propio elemento, separado de `Fixed status Declined with rows: the DEC range will open at validation`, y el elemento se lee entero como `DEC: Fixed status Declined with rows: the DEC range will open at validation`

#### Scenario: Ready to analyze
- **GIVEN** el import de `batch-clean` con el pareo confirmado
- **WHEN** la barra dice `Ready to analyze` y despliega las notas informativas
- **THEN** cada nota muestra el nombre de su hoja en negrita, separado de su descripción, como `CHB Alerts` y `The sheet has no rows`

### Requirement: Pantalla Column Mapping: análisis en curso
**Analyze** SHALL lanzar `POST analyze` una sola vez: durante la espera, que puede durar decenas de segundos, SHALL mostrarse `Analyzing… this can take up to a minute.` con los controles del import deshabilitados. Con `200` SHALL llevar al paso Analysis. Ante `422 mapping_incomplete` SHALL mostrar los faltantes; ante `409` o un fallo de red, SHALL releer el import antes de decidir.

#### Scenario: Doble clic
- **WHEN** `analyst` pulsa **Analyze** dos veces seguidas
- **THEN** el API recibe un solo `POST analyze` y la pantalla muestra el estado de análisis en curso

#### Scenario: Análisis terminado
- **WHEN** `POST analyze` del import de `batch-clean` responde `200`
- **THEN** la pantalla pasa al paso Analysis con el resultado

#### Scenario: Pareo incompleto
- **WHEN** `POST analyze` responde `422 mapping_incomplete` con `APP` · `transactionId`
- **THEN** sigue en Mapping, la barra muestra `APP · transactionId` y **Analyze** queda deshabilitado

#### Scenario: Conexión perdida durante el análisis
- **WHEN** la petición de análisis falla por red y el import releído está en `analyzed`
- **THEN** la pantalla muestra el paso Analysis sin error
- **AND** si el import releído sigue en `mapped`, ve `The analysis did not finish. Try again.` y **Analyze** vuelve a estar disponible

### Requirement: Resultado del análisis: contadores
El paso Analysis de un import analizado SHALL mostrar `Rows read` (`analysis.rows.total`), `Matched`, `Unmatched`, `Ambiguous` e `Ignored`, y las filas por ciclo `E`, `I` y `R`. `Unmatched` y `Ambiguous` mayores que cero SHALL resaltarse como advertencia.

#### Scenario: Batch limpio
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** abre el paso Analysis
- **THEN** ve `Rows read 783`, `Matched 780`, `Unmatched 0`, `Ambiguous 0`, `Ignored 3` y `E 450 · I 10 · R 320`, sin resaltado

#### Scenario: Batch con incidencias
- **GIVEN** el import de `batch-issues` analizado
- **WHEN** abre el paso Analysis
- **THEN** ve `Rows read 770`, `Matched 766`, `Unmatched 1` resaltado, `Ambiguous 0`, `Ignored 3` y `E 440 · I 10 · R 317`

### Requirement: Resultado del análisis: aviso de canales
El paso Analysis SHALL mostrar un aviso ámbar con cada canal de `channels` cuya situación no sea `assigned`: `unassigned` como `<canal> is not assigned yet` y `assigned_to_other_account` como `<canal> is primary in <cuenta>`, con su número de filas y su `note`. Un canal o cuenta fuera del alcance SHALL mostrarse sin nombre. Sin canales así, el aviso SHALL no aparecer.

#### Scenario: Canal nuevo en el batch limpio
- **GIVEN** el import de `batch-clean` analizado en `ProviderA-USD`
- **WHEN** abre el paso Analysis
- **THEN** el aviso muestra solo `RAM-07 is not assigned yet` con su nota; RAM-01 y RAM-02 no aparecen

#### Scenario: Canal principal de otra cuenta
- **GIVEN** el import de `batch-blocked` analizado en `ProviderB-Main`
- **WHEN** abre el paso Analysis
- **THEN** el aviso muestra `RAM-01 is primary in ProviderA-USD` con `1` fila

#### Scenario: Formas ocultas
- **GIVEN** un import analizado cuyo `channels` trae un canal con `outOfScope = true` y otro con `otherAccount.outOfScope = true`
- **WHEN** abre el paso Analysis
- **THEN** el primero se muestra como `Channel <channelId> (another merchant)` y el segundo como `<canal> is primary in an account of another merchant`, sin ningún otro dato de ese merchant

### Requirement: Resultado del análisis: advertencias
El paso Analysis SHALL listar cada código de `analysis.warnings` con conteo mayor que cero, con una etiqueta en inglés y el conteo; sin ninguno, SHALL mostrar `No warnings`.

#### Scenario: Importe negativo
- **GIVEN** el import de `batch-issues` analizado
- **WHEN** abre el paso Analysis
- **THEN** ve `Negative amount` con `1` y ningún otro código

#### Scenario: Sin advertencias
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** abre el paso Analysis
- **THEN** ve `No warnings`

### Requirement: Resultado del análisis: tabla de filas
El paso Analysis SHALL mostrar las filas de `GET rows` paginadas en el servidor (50 por página), en el orden del API, con hoja y archivo (la hoja primero y siempre visible; el archivo entero, partido en líneas si no cabe, y con su nombre completo también como tooltip), fila, ID leído como texto, ciclo, resultado y motivo, estado, importe, canal y advertencias. SHALL permitir filtrar por resultado. Una fila ambigua SHALL mostrar sus candidatas sin acción.

#### Scenario: No asociadas primero
- **GIVEN** el import de `batch-issues` analizado
- **WHEN** abre el paso Analysis
- **THEN** la primera fila de la tabla es la de `4260465812403708` con `Unmatched` y `No match`, y la paginación indica `770` filas

#### Scenario: Filtro y página
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** filtra por `Matched` y va a la página 16
- **THEN** la tabla muestra 30 filas, todas `Matched`, y se pidió `GET rows?match=matched&page=16&pageSize=50`

#### Scenario: Transacción de otro merchant
- **WHEN** una fila trae `transaction = null` y `out_of_scope_transaction` en `warnings`
- **THEN** la fila muestra `Matched` y `Transaction of another merchant`, sin canal ni importe

#### Scenario: Fila ambigua
- **WHEN** una fila es `ambiguous` con candidatas en dos gateways
- **THEN** muestra `Ambiguous` y el nombre de gateway de cada candidata, sin control para elegir

#### Scenario: Hoja y archivo de cada fila
- **GIVEN** el import de `batch-split` analizado
- **WHEN** abre el paso Analysis
- **THEN** cada fila muestra primero el nombre de su hoja y después el nombre entero de su archivo, sin cortar, partido en líneas dentro de su columna y con el nombre completo como tooltip

### Requirement: Cancelación del import desde la pantalla
Con permiso y el import en `uploaded`, `mapped`, `analyzed` o `validated`, el espacio del import SHALL ofrecer **Cancel import**, que pide confirmación antes de llamar a `POST cancel`. Cancelado, el import SHALL mostrarse en solo lectura con su estado y un enlace para empezar un import nuevo en la misma cuenta.

#### Scenario: Cancelar un import analizado
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** `analyst` pulsa **Cancel import** y confirma
- **THEN** el import muestra `cancelled`, el paso Analysis conserva contadores y filas, no hay acciones de edición y **Start a new import** lleva a `/reconciliations/new` con `ProviderA-USD` elegida

#### Scenario: Desistir
- **WHEN** `analyst` pulsa **Cancel import** y cierra el diálogo sin confirmar
- **THEN** no se llama a `POST cancel` y el import no cambia

#### Scenario: Ya no cancelable
- **WHEN** `POST cancel` responde `409 import_not_cancellable`
- **THEN** ve `This import can no longer be cancelled (<estado>).` y la pantalla se recarga

### Requirement: Import en solo lectura
Un import SHALL mostrarse en solo lectura, sin subir, quitar, editar, confirmar, analizar ni cancelar, cuando el usuario no tiene `settlement.process`. Con permiso, Files y Mapping SHALL quedar en solo lectura fuera de `uploaded` y `mapped`, y **Cancel import** SHALL ocultarse en `processed` y `cancelled`.

#### Scenario: viewer ve el resultado
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** `viewer` abre `/imports/<importId>`
- **THEN** ve el paso Analysis con los contadores, el aviso de canales y las filas, sin **Cancel import**; en Files no hay zona de subida ni **Remove**, y en Mapping los controles están deshabilitados sin **Confirm mapping** ni **Analyze**

#### Scenario: Import analizado para analyst
- **GIVEN** el import de `batch-clean` analizado
- **WHEN** `analyst` abre el paso Files
- **THEN** no hay zona de subida ni **Remove**, y ve `Files cannot change after the analysis. Cancel the import and start a new one.`

### Requirement: Retomar un import por su enlace
`/imports/<importId>` SHALL abrir el import en el paso de su estado: Files sin archivos, Mapping en `uploaded` o `mapped` con archivos, Analysis desde `analyzed` o si está cancelado con análisis. El usuario SHALL poder moverse a los pasos anteriores. Un import inexistente o fuera del alcance SHALL mostrar `This import is not available.`

#### Scenario: Import pareado
- **GIVEN** un import en `mapped`
- **WHEN** `analyst` abre su enlace
- **THEN** ve el paso Mapping con el pareo confirmado

#### Scenario: Import de otro merchant
- **WHEN** `viewer` abre el enlace de un import de `ProviderC-Alt`
- **THEN** ve `This import is not available.` y ningún dato del import

### Requirement: Smoke E2E de la importación
El proyecto SHALL tener un escenario E2E en Gherkin, ejecutable en local con un comando, que contra la aplicación y el API reales con el seed cargado recorra login → subida → confirmación → análisis, compruebe el resultado de `batch-clean` contra su `expected.json` y cancele el import al terminar.

#### Scenario: Batch limpio de punta a punta
- **GIVEN** la base sembrada y la aplicación levantada
- **WHEN** `analyst` entra, elige `ProviderA-USD`, sube `Recon_Template_ProviderA-USD_batch-clean.xlsx`, confirma la propuesta tal cual y pulsa **Analyze**
- **THEN** ve `Rows read 783` y `Matched 780` y el aviso `RAM-07 is not assigned yet`
- **AND** al cancelar el import como limpieza ve `cancelled`

#### Scenario: Aplicación no levantada
- **WHEN** se ejecuta el smoke sin la aplicación o el API levantados
- **THEN** falla antes del primer paso con un mensaje que indica cómo levantar la base, el seed y la aplicación

### Requirement: Pantallas Upload Files y Column Mapping: un bloque por archivo
En los pasos Files y Mapping, cada archivo del import SHALL verse como un bloque con un tono suave propio, distinto del fondo de la página y del archivo vecino, y una cabecera de archivo marcada con su nombre en negrita y su número de hojas. El mismo archivo SHALL tener el mismo tono en los dos pasos. Los archivos de la cola (pendientes, subiendo o rechazados) SHALL no tomar tono hasta que el API los acepta.

#### Scenario: Batch repartido en dos archivos
- **GIVEN** el import de `batch-split` con `part1` y `part2`
- **WHEN** `analyst` abre el paso Files y después el paso Mapping a 1280 px
- **THEN** en los dos pasos cada archivo es un bloque con su cabecera (`Recon_Template_ProviderA-USD_batch-split_part1.xlsx` y `…_part2.xlsx`, cada uno con su número de hojas, `10 sheets`), los dos bloques tienen tonos distintos entre sí y del fondo, y `part1` tiene el mismo tono en Files que en Mapping

#### Scenario: Nombre largo
- **GIVEN** un archivo cuyo nombre no cabe en una línea
- **THEN** su cabecera parte el nombre en varias líneas sin desplazamiento horizontal, a 1280 y a 1024 px

#### Scenario: Archivo en cola
- **WHEN** `analyst` suelta un archivo y aparece como `Uploading…`
- **THEN** su entrada se ve sin tono, con el borde discontinuo de la cola, hasta que el API lo acepta


