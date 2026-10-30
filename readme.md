# Recon Tool 2.0 — Proyecto Final AI4Devs

> Entrega 2 · Backend, frontend y base de datos conectados con el flujo principal (HU1 → HU2 → HU3). Sigue la plantilla oficial de `LIDR-academy/AI4Devs-finalproject`. Documento vivo: define el proyecto y se actualiza con cada entrega.

> **Sistema actual y desarrollo propuesto.** Existe una única herramienta Recon Tool en producción, implementada sobre reportes SSRS. "Recon Tool 2.0" es el nombre de este proyecto: su reemplazo como aplicación web independiente. Las versiones de los documentos de referencia son revisiones de la documentación, no versiones desplegadas del sistema.

## Índice

0. [Ficha del proyecto](#0-ficha-del-proyecto)
1. [Descripción general del producto](#1-descripción-general-del-producto)
2. [Arquitectura del sistema](#2-arquitectura-del-sistema)
3. [Modelo de datos](#3-modelo-de-datos)
4. [Especificación de la API](#4-especificación-de-la-api)
5. [Historias de usuario](#5-historias-de-usuario)
6. [Tickets de trabajo](#6-tickets-de-trabajo)
7. [Pull requests](#7-pull-requests)

---

## 0. Ficha del proyecto

### 0.1. Tu nombre completo

**Manfred Valverde Perrogón**

### 0.2. Nombre del proyecto

Recon Tool 2.0

### 0.3. Descripción breve del proyecto

Recon Tool 2.0 es una aplicación web para el equipo de reconciliaciones de una compañía que procesa pagos a través de varios gateways, proveedores y merchants. Automatiza el cruce de los archivos de settlement que envían los proveedores contra las transacciones propias, valida inconsistencias (faltantes, duplicados, colisiones de estado) y permite procesar batches de reconciliación con trazabilidad completa. Cada ciclo E/I/R está Settled únicamente cuando está incluido en un batch procesado y pagado; un batch procesado pendiente de pago todavía no confiere ese estado. El proyecto desarrolla una aplicación independiente para reemplazar la herramienta interna que actualmente funciona sobre reportes SSRS.

### 0.4. URL del proyecto

Sin despliegue público en la Entrega 2: la aplicación se ejecuta en local siguiendo [1.4](#14-instrucciones-de-instalación), con datos sintéticos. El despliegue descrito en [2.4](#24-infraestructura-y-despliegue) queda para la Entrega 3.

**Vídeo de la demo.** Previsto para la Entrega 3: el flujo import → validaciones → settlement → descargas con datos sintéticos ([#96](https://github.com/kajirioji/AI4Devs-finalproject/issues/96)).

### 0.5. URL o archivo comprimido del repositorio

**Repositorio:** [kajirioji/AI4Devs-finalproject](https://github.com/kajirioji/AI4Devs-finalproject).

**Rama de la Entrega 2:** [`feature/entrega-2-MVP`](https://github.com/kajirioji/AI4Devs-finalproject/tree/feature/entrega-2-MVP): monorepo con backend, frontend, base de datos (migraciones y seed), pruebas, `README.md` y `prompts.md`. La Entrega 1 (solo documentación) está en [`feature/entrega-1-MVP`](https://github.com/kajirioji/AI4Devs-finalproject/tree/feature/entrega-1-MVP); la final irá en `final-project-MVP`.

---

## 1. Descripción general del producto

### 1.1. Objetivo

**El problema.** La compañía procesa pagos a través de varios gateways y de entre 15 y 20 proveedores activos, cada uno con una o varias cuentas y canales. Cada proveedor envía periódicamente —normalmente cada 7, 10 o 14 días— un archivo de settlement con las transacciones que va a pagar. De lo aprobado libera alrededor del 90 % en ese plazo; el resto se retiene como rolling reserve y se libera a unos 180 días. Una transacción puede tener movimientos en tres ciclos de reconciliación: la operación original (E), los ajustes posteriores como chargeback o refund (I) y la reserva (R). Cada ciclo necesita su propio estado y seguimiento; tres ciclos no implica un máximo de tres eventos. Los porcentajes y plazos dependen de la configuración acordada con cada proveedor.

El Back-Office del gateway principal no sirve para dar ese seguimiento: solo guarda un flag de "settled" y una última fecha, sin número de batch ni historial, así que un archivo repetido sobrescribe lo anterior sin dejar rastro; tampoco indica cuántos fees se pagaron por esa transacción ni por el batch. Para cubrir ese hueco existe el Recon Tool actual, un conjunto de unos 24 reportes SSRS que el equipo usa como si fuera una aplicación web. Funciona, pero SSRS no está diseñado para ese uso y obliga a rodeos para poder utilizarlo: normalizar el archivo del proveedor es copiar y pegar a mano en una plantilla Excel sin ninguna validación; crear una cuenta o cargar un fee se hace por consulta directa a la base; reprocesar un batch lo borra sin dejar historia; y cada pantalla nueva cuesta mucho más de lo que debería. El resultado aguas abajo son disputas del merchant sobre el resumen preliminar, que en buena parte nacen de la falta de precisión y trazabilidad en la validación.

**Qué resuelve Recon Tool 2.0.** Lleva ese mismo proceso a una aplicación web propia, con el flujo de reconciliación de punta a punta: importar los archivos de settlement dentro de la aplicación, parear sus hojas y columnas con revisión humana, cruzar contra las transacciones propias, ejecutar las validaciones, dejar que el analista revise los resultados, procesar el batch separando los tres ciclos de reconciliación, y generar el resumen para el merchant y los exports para el Back-Office. Todo con trazabilidad por batch, administración de cuentas y fees desde la propia aplicación, y sin tocar la base de producción por consulta directa. El procesamiento del batch y su pago se controlan por separado. La finalidad del proyecto incluye importar directamente los Excel originales de cada proveedor sin plantilla intermedia; el MVP cubre la importación de la plantilla estandarizada con pareo configurable, y la importación directa queda documentada como roadmap. La aplicación habilita funcionalidades nuevas y mejora la experiencia en las que ya existen.

**Para quién.** Los usuarios principales son los analistas del equipo de reconciliaciones, que hoy ejecutan el proceso a mano y en SSRS. Los usuarios secundarios son quien administra cuentas y fees (hoy, por SQL) y, de forma indirecta, el merchant, que no entra a la herramienta pero recibe un resumen más preciso y con menos disputas.

**Qué valor aporta.** Menos tiempo por reconciliación (desaparece la carpeta compartida y la navegación forzada en SSRS; con la importación directa, además, el copiar y pegar a la plantilla), menos errores (se reduce la manipulación manual de archivos y con ella el error humano; validación de entrada, reglas de negocio en los fees, pareo revisado antes de analizar), mayor trazabilidad respecto al sistema actual (batches con estado e intentos, fees con historial de cambios, deshacer sin perder rastro, registro de quién aprobó cada batch) y más control sobre la propia herramienta: los parámetros propios de cada cuenta —política de reserva ante chargeback, fees y reglas de pareo— y los asociados al proceso se configuran desde la aplicación, sin depender de consultas directas a la base.

### 1.2. Características y funcionalidades principales

El producto se construye como MVP alrededor del flujo principal de reconciliación. Lo que sigue distingue entre las reglas de negocio confirmadas (que rigen todo el diseño), lo que entra en el MVP (Entregas 2 y 3) y lo que queda documentado como finalidad del proyecto o roadmap.

#### Reglas de negocio confirmadas

- **Ciclo (`cycle`) distinto de estado.** El estado (`Pending`, `Successful`, `Declined`, `Chargeback`, `Refund`, `RDR`) es lo que la transacción *es* en el gateway: nace `Pending`, pasa a `Successful` o `Declined`, y una `Successful` puede derivar después en `Chargeback`, `Refund` o `RDR`. El ciclo (E, I, R) es lo que el proveedor *está liquidando* en cada fila del archivo y se obtiene de la hoja o de la regla de pareo, no del estado. La rolling reserve no es un estado: es la parte retenida (≈10 %) de una transacción `Successful` ya liquidada en E, que el proveedor libera en R al cumplirse el plazo (≈180 días). Una fila de la hoja RR referencia la transacción original y conserva el estado que esta tenga en ese momento. `Pending` significa que el estado no se actualizó; nunca se procesa.
- **Settled por ciclo.** E, I y R se evalúan separadamente. Solo un movimiento incluido en un batch procesado **y pagado** está Settled. Procesado pendiente de pago, pagado y deshecho son situaciones distintas. Los pendientes se presentan separados entre no reconciliados y reconciliados pendientes de pago.
- **Creación de cuentas: fees y reglas de pareo.** Los fees son por cuenta, pero al crear una cuenta se elige entre *sin fees* (por defecto; se crean uno a uno después) o *copiar los fees de otra cuenta del mismo proveedor* (se copian solo los fees activos en ese momento, no su historial, y cada copia nace con vigencia `NULL…NULL` para cubrir todo lo que llegue a la cuenta nueva; se ajustan después si hace falta; la copia queda auditada). Las reglas de pareo no son por cuenta sino por proveedor: un proveedor tiene uno o más **conjuntos de reglas** (`MatchingRuleSet`) y cada cuenta se enlaza a uno de ellos o a ninguno (en cuyo caso aplican las reglas globales). Un cambio en el conjunto aplica a todas las cuentas enlazadas sin tocar imports ya analizados; una cuenta puede cambiar de conjunto desde Account Detail, con efecto en el siguiente import. Los alias de estado siguen siendo globales.
- **Exports operativos.** El resumen y ambos CSV se generan al procesar el batch, antes del pago. Reconciliaciones los guarda para revisar su composición y ejecuta manualmente los CSV en el Back-Office después de recibir el pago. Descargar un CSV no marca nada como pagado ni Settled.
- **Formato de los exports.** Los tres archivos son CSV RFC 4180: separador `,`, una fila de cabecera, fin de línea CRLF, UTF-8 sin BOM y comillas dobles (con las internas duplicadas) solo cuando el valor contiene `,`, `"` o un salto de línea. Los importes llevan punto decimal y cuatro decimales, sin separador de miles y con `-` si son negativos, y nunca pasan por coma flotante. Se generan al vuelo desde lo escrito al procesar, en cualquier estado del intento (también `undone`), y se nombran por intento: `<cuenta>_B<batchNo>_A<attemptNo>_<type>.csv`, con `type` ∈ `summary` | `transactions` | `reserves` y el nombre de la cuenta reducido a `[A-Za-z0-9-]` (cualquier otro tramo pasa a `_`; si no queda nada, `account`). Cada descarga queda auditada (`settlement.export`) antes de enviarse; si la auditoría falla no se envía el archivo.
  - **TXN** (`transactions`): `ID,Status` con los movimientos E `Successful` (`SUC`) y los I `Chargeback` (`CHB`, también los `CHB 2`/`excludeAmount`), `Refund` (`REF`) y `RDR` (`RDR`); los `Declined` no salen. Una fila por par (`ID`, `Status`) distinto, en el orden estable del intento `(cycle, sheetId, rowNo, settlementTxnId)`, que agrupa por hoja pero no sigue el orden de las hojas en el archivo: un Refund y un Chargeback de la misma transacción dan dos filas; un Chargeback y un `CHB 2`, o un duplicado E incluido a mano, una.
  - **RR** (`reserves`): `ID,Description` con los movimientos R y `Description = Batch <batchNo>`, una fila por `ID` distinto, también las R que liberan 0.
  - **Summary** (`summary`): nueve bloques, cada uno con su cabecera y separados por una línea vacía: intento (cuenta, batch, intento, estado, pago, quién y cuándo lo procesó en hora de Nueva York con sufijo `ET`, fecha de settlement, canales y rangos de fechas de negocio sin convertir), totales por categoría, marcas, fees por batch, reservas, desglose del amount payable (las nueve líneas con signo e importe y la fila `Amount payable`, para auditar la fórmula sumando la columna), incidencias, filas no procesadas y advertencias. Las cifras son las de la vista del intento, sin recalcular. Como el merchant lo abre en una hoja de cálculo, toda celda de **texto** (nombre de la cuenta, usuarios, canales, marcas, tipo y descripción de los fees por batch) que empiece por `=`, `+`, `-`, `@`, tabulador o retorno de carro lleva delante un apóstrofo (`'=HYPERLINK(…)`), para que se muestre y nunca se ejecute como fórmula. Las cifras (también los importes negativos) y los IDs no se tocan, y TXN y RR no llevan texto libre, así que no cambian. En los intentos sin auditoría de procesado (el histórico sembrado), incidencias y filas no procesadas dicen `Not available`.
- **Importes y moneda.** Todo se calcula en USD con el importe del gateway (lo que registró su API en el momento de la transacción): settlement, fees y reportes; los fees configurados también están en USD. El archivo del proveedor puede traer o no su propio importe, a veces en otra moneda (`Currency` en ISO de tres letras: EUR, MXN…): se guarda con su moneda solo como dato informativo, para revisión. La comparación de importes proveedor–gateway se omite cuando el proveedor no manda importe o lo manda en otra moneda. No se valida la moneda del archivo frente a la de la cuenta. No hay conversión cambiaria en el MVP; señalar importes del proveedor fuera de un tipo de cambio razonable queda en el roadmap ([#93](https://github.com/kajirioji/AI4Devs-finalproject/issues/93)).
- **Identidad.** `transactionId BIGINT IDENTITY` es la clave interna para relaciones; la identidad externa es `(gatewayId, sourceTransactionId)`, donde `sourceTransactionId VARCHAR(36)` conserva el ID de origen normalizado según el formato del gateway (`numeric`: solo dígitos, sin ceros a la izquierda; `uuid`: 36 caracteres en minúsculas, sin llaves). El mismo identificador de origen en gateways distintos no es la misma transacción. El cruce busca el ID normalizado en los gateways de los canales asociados a la cuenta (`AccountChannel`) o, si la cuenta todavía no tiene ninguno, en los gateways de los canales de su proveedor; sin ninguno, la fila queda sin asociar con motivo explícito. Una coincidencia es `matched`, ninguna es `unmatched` y más de una es `ambiguous`, que no se procesa hasta que el analista elija el gateway o cancele. Hoy conviven un gateway numérico y uno UUID, así que el formato desambigua por sí solo; `ambiguous` solo puede aparecer con dos gateways del mismo formato en la misma cuenta. La columna de ID se lee siempre como texto para no perder dígitos ni formato (hoy los IDs numéricos tienen 15 dígitos; hubo una época de 16, y Excel pierde precisión a partir de 15, por eso la plantilla los pega como texto). Los exports (CSV y resumen) escriben el ID tal cual, como texto y nunca como número, sin ningún formato para Excel (ni `="…"`, ni apóstrofo, ni comillas que RFC 4180 no exija), porque el Back-Office los lee. Abrir un CSV con doble clic en Excel convierte el ID a número: aparece en notación científica y, como Excel guarda 15 dígitos significativos, un ID de 16–17 dígitos pierde los últimos. Por eso el CSV se sube al Back-Office **sin abrirlo ni guardarlo con Excel**, y para mirarlo se usa Excel → **Datos → Desde texto/CSV** con la columna `ID` como **Texto**. Una descarga `.xlsx` con el ID como texto, para lectura humana, queda en el issue #68 (Entrega 3).
- **Fees múltiples y vigencias.** Cada movimiento puede tener varios fees; cada uno conserva tipo, configuración aplicada e importe USD. Para operaciones originales rige la fecha de la transacción; para chargebacks, refunds y returns, la fecha del evento. Ambas provienen del gateway; nunca se sustituyen por la fecha del batch. Las fechas de vigencia de un fee dicen **a qué movimientos aplica**, no cuándo se configuró: `startDate NULL` significa "desde siempre" (−∞) y `endDate NULL` "sin fin" (+∞); un fee `NULL…NULL` aplica a cualquier evento. Un fee nunca se ata a la fecha de creación de la cuenta ni del propio fee, porque una cuenta nueva puede recibir canales con historial.
- **Reserva por cuenta.** Se configura si, cuando una `Successful` con reserva retenida pasa a `Chargeback`, esa reserva se libera de inmediato o se mantiene retenida hasta cumplir el plazo. Se conserva la regla aplicada y el importe liberado anticipadamente; una reserva liberada por chargeback deja de reportarse como pendiente de liberación y no se espera en R.
- **Incidencias.** Las incidencias de validación permanecen persistentes o resueltas, nunca se eliminan. Las correcciones posteriores quedan vinculadas al batch que las resolvió.
- **Duplicados.** No se contabilizan dos veces. Los resultados parciales indican lo que se incluirá y las diferencias frente al archivo del proveedor; el analista las comunica fuera de la aplicación. No se exige una decisión por fila para continuar.
- **Validaciones y bloqueo.** Ninguna validación bloquea el procesamiento, con una sola excepción: `provider_mismatch` (el import se creó bajo un proveedor o cuenta incorrectos) bloquea sin override; el analista debe volver a la selección de contexto y procesar con el proveedor correcto. Las demás generan advertencias persistentes.
- **Approved + Declined.** La coexistencia se notifica como validación, pero no impide procesar. No se resuelve silenciosamente.
- **Refund + Chargeback.** Pueden coexistir; se notifican para revisión del negocio. No se tratan como duplicado ni se excluye uno de los dos automáticamente.
- **Duplicados y colisiones.** Se detectan por identidad externa y ciclo: dos apariciones del mismo movimiento en el mismo ciclo con el **mismo estado** son duplicado; con **estados distintos** son colisión. Ciclos distintos (E, I, R) nunca se comparan entre sí. Ambos generan advertencia, nunca bloqueo. El mismo ajuste (ciclo I) con el mismo estado en dos batches distintos es duplicado por defecto, con la aparición actual excluida; si es legítimo, el analista la incluye a mano.
- **CHB 2 (solo archivos legacy).** La plantilla actual no lo contempla: ya no se usa. Se conserva únicamente como alias de compatibilidad para archivos antiguos: si una columna de estado trae el texto `CHB 2`, se traduce a `Chargeback` (ciclo I) con `excludeAmount = 1` (cuenta en `chargebackQty`, no suma a `chargebackAmt`, aplica el fee de Chargeback) y no se considera duplicado del `Chargeback` del mismo movimiento. Sin ese alias, la regla de duplicados no tiene excepciones.
- **Importes del archivo siempre positivos.** En la plantilla, `Amount` es positivo en todas las hojas, sea E, I o R; el signo lo aplica el sistema según el ciclo y el tipo (los ajustes I y los fees restan, las aprobaciones E y las liberaciones R suman). Un importe negativo en el archivo se marca como advertencia de formato. En la hoja `RR`, `Amount` es la reserva liberada (≈10 % de la operación original), no el importe original.
- **Rondas.** Dato derivado al procesar, no una entrada: ronda 1 si E e I se procesan en el mismo batch; ronda 2 si la E ya estaba en un batch anterior vigente y el batch incorpora el movimiento I. La ronda clasifica el escenario; no crea un procesamiento distinto ni participa en la detección de duplicados. CHB 2 no significa "ronda 2".
- **Rangos de fechas por ciclo y faltantes.** APP, DEC, I y R conservan rangos independientes, obtenidos de los movimientos del batch que sí se asociaron: APP con las `Successful` y su fecha de creación; DEC con las `Declined`, solo si el archivo las trae; I con la fecha del evento (cambio de estado); R con la fecha de creación de las reservas incluidas, normalmente con antigüedad cercana o superior al plazo de liberación (típicamente 180 días). I no se combina con E aunque compartan settlement term. Son candidatas a faltante las transacciones del proveedor en los canales de la cuenta, no procesadas en ese ciclo en un batch vigente, con fecha ≤ máximo del rango: anterior al mínimo → `missing_previous_to_batch`; dentro del rango, inclusive → `missing_in_range`. Nada posterior al máximo se considera. Las declinadas faltantes solo se evalúan cuando el proveedor reporta declinadas, con el rango DEC. Las transacciones en `Pending` en el gateway no pertenecen a ningún rango hasta que su estado se corrija: se excluyen de faltantes y la corrida las cuenta aparte, de forma informativa. Un faltante se registra una sola vez por proveedor, ciclo y transacción, y se resuelve al incluirse en un batch `processed`.
- **Alcance del histórico.** Para duplicados, colisiones y faltantes, los batches anteriores son los intentos no deshechos de **todas las cuentas del proveedor**, no solo de la cuenta del batch.
- **Resultado de una validación.** Se deriva de sus hallazgos: `passed` (corrió sin hallazgos), `warning` (hay hallazgos y ninguno bloquea; no impide continuar), `blocked` (al menos un hallazgo bloqueante; hoy solo `provider_mismatch`), `not_applicable` (no hay movimientos o histórico sobre los que correr; se muestra como n/a) o `not_implemented`. Cuentan como aprobadas `passed` y `warning`; `not_applicable` y `not_implemented` nunca. La corrida está bloqueada si alguna validación es `blocked`.
- **Deshacer.** Solo batches procesados pendientes de pago. Se conserva el intento anterior con autor y motivo, el import vuelve a `analyzed` para validar de nuevo, y se permite un nuevo intento con el mismo número oficial. Se recalculan las incidencias cuya resolución dependía del intento anulado; no se revierte la asignación del canal.

#### En el alcance del MVP

**Acceso y roles.** Login con usuario y contraseña. Permisos por acción (procesar settlement, procesar pago, administrar cuentas, administrar fees, administrar usuarios, consultar) y visibilidad por merchant: cada usuario ve solo los merchants que tiene asignados, o todos si su alcance es `all`.

**Catálogo de merchants, proveedores, cuentas y canales.** Jerarquía merchant → proveedor → cuenta → canal. Merchants, proveedores (asociados a un merchant), canales y transacciones vienen suministrados por los gateways y son de solo lectura en la aplicación; es en esa información donde se detecta un proveedor o un canal nuevo. La **cuenta** es la entidad propia del Recon Tool: una agrupación lógica de canales de un proveedor para llevar contabilidades separadas. Se crea y edita desde la aplicación (hoy, por consulta directa), admite canales de varios gateways, administra sus fees y su política de reserva ante chargeback, y se enlaza a un conjunto de reglas de pareo del proveedor. Al crearla se indica si parte sin fees o copia los de otra cuenta del proveedor, y a qué conjunto de reglas se enlaza (o ninguno). El settlement term, el porcentaje de reserva y el plazo de liberación se reciben de los gateways como configuración del canal; el porcentaje efectivamente aplicado viene guardado en cada transacción. Un canal no viene asociado a ninguna cuenta: aparece como *not assigned yet* mientras tenga transacciones sin ningún batch procesado, y se asocia a una cuenta al procesar el primer settlement que lo incluye, con aviso previo al analista. Un canal puede tener historial en más de una cuenta, pero una sola es su **cuenta principal** —la última que procesó un settlement con ese canal— y los pendientes del canal se reportan solo en ella. Un merchant no ve los proveedores de otro merchant, aunque compartan proveedor. Los canales pueden quedar inactivos; no se borran.

**Administración de fees por cuenta, con historial.** Creación y edición de fees por cuenta: tipo, monto fijo o porcentaje, valor y vigencia (rango de fechas, con inicio o fin abiertos: "always"). El motor calcula automáticamente solo los **fees por transacción** (aprobadas, declinadas, chargebacks, refunds, RDR, MDR…). Los fees **no transaccionales** —por batch, setup, anuales— se mantienen en el mismo módulo como referencia con su monto preestablecido, pero los indica el proveedor batch a batch, así que llegan en la hoja `Other Fees` de la plantilla y se revisan (prellenados, con importe ajustable) al procesar el batch; además existen categorías de importe libre (ajustes por corrección de batches anteriores, ajustes por duplicados, penalizaciones). Los fees no se eliminan: quedan asociados a la cuenta aunque el canal pase a inactivo, porque el fee aplicado se guarda por movimiento. Regla de negocio: no pueden coexistir dos fees del mismo tipo con vigencias que se solapen en la misma cuenta. Cada cambio queda registrado con quién, cuándo y qué cambió, y al editar un fee el sistema permite simular el efecto del cambio antes de aplicarlo.

**Importación de archivos con pareo revisado.** Se suben uno o varios archivos `.xlsx` de settlement de una cuenta (en el MVP, la plantilla estandarizada que el equipo ya utiliza; en la versión actual solo se podía procesar un archivo por batch, aquí uno o varios archivos de plantilla forman un mismo batch: hojas `APP`, `DEC`, `CHB`, `REF`, `RDR` y `RR` con columnas `ID`, `Amount`, `Currency`; hoja `Other Fees` con los fees del batch (`Type of Fee`, `Amount`, `Currency`); hojas `Duplicate Corrections` y `CHB Alerts` fuera del MVP; hoja oculta `Settings` con los catálogos de las listas desplegables; varios archivos forman un mismo batch). La hoja `Other Fees` se lee en la importación y sus filas aparecen prellenadas como fees por batch propuestos en Settlement Review, donde el analista los confirma, ajusta o quita; un tipo que no exista en el catálogo se marca como advertencia y queda como importe libre con su texto. El sistema propone el pareo de hojas y columnas a partir de las reglas configuradas para la cuenta: qué hoja corresponde a qué estado (estado fijo por hoja), qué columna es el Transaction ID, qué columna aporta el estado y cómo se traducen sus valores al catálogo interno (alias), opcionalmente qué columna indica el gateway (para cuentas con varios gateways del mismo formato de ID), y qué filas se ignoran (totales, cabeceras repetidas). El analista revisa la propuesta, la ajusta si hace falta y la confirma antes de analizar. El resto de las columnas se conserva como fila original de referencia. Para analizar debe estar identificado el Transaction ID y confirmada la forma de obtener el estado, por hoja o por columna. Opcionalmente se parean monto, moneda y fecha para compararlos como advertencia.

**Cruce contra transacciones propias.** Cada fila se enlaza por la identidad externa `(gateway, sourceTransactionId)` contra la tabla de transacciones propias, buscando en los gateways de los canales asociados a la cuenta, o en los de los canales de su proveedor si la cuenta aún no tiene ninguno (o en el gateway indicado por la columna pareada como `gateway`, si existe); se muestran primero las filas no asociadas y las ambiguas, estas últimas con sus candidatas enfrentadas. Del enlace se derivan el canal y el estado actual; el ciclo (`cycle` E, I o R) lo fija la hoja o la columna pareada, no el estado. Si el import trae transacciones de un canal sin asociar o asociado a otra cuenta, el sistema lo avisa antes de validar: al procesar, ese canal quedará asociado a esta cuenta como principal. Como el gateway está por encima del merchant, el cruce puede encontrar transacciones de otros merchants; se enlazan igual, pero sus datos (canal, cuenta, importe, estado) se ocultan a quien no tiene ese merchant en su alcance.

**Ocho validaciones con detalle por caso.** Transacciones de otro proveedor o merchant (`provider_mismatch`, la única bloqueante); estados del archivo que no cuadran con el gateway (`non_recorded_adjustment`: un ajuste I sobre una transacción que el gateway aún tiene en un estado de ciclo E, y `status_mismatch`, una fila E declinada en el archivo y aprobada o ajustada en el gateway, o al revés); duplicados y colisiones de estado dentro del batch; duplicados y colisiones contra batches anteriores; transacciones faltantes anteriores al batch (`missing_previous_to_batch`); transacciones faltantes dentro del rango del archivo (`missing_in_range`). Las validaciones respetan la identidad externa y el ciclo E/I/R, y aplican las reglas confirmadas (Approved + Declined, Refund + Chargeback, CHB 2, rondas). Cada validación devuelve su resultado (`passed`, `warning`, `blocked`, `not_applicable`, `not_implemented`) y el número de hallazgos; cada hallazgo abre a un detalle con todas sus apariciones (en el import actual o en batches anteriores de cualquier cuenta del proveedor). Las reglas exactas están en 3.3.

**Revisión humana de resultados.** El analista revisa los resultados parciales: transacciones y cantidades por ciclo, advertencias con acceso al detalle, diferencias frente al archivo. Toma una sola decisión sobre el conjunto: continuar a la revisión del batch, o cancelar el import y procesarlo de nuevo con los archivos corregidos. De forma **opcional** puede actuar sobre un hallazgo concreto: cambiar qué aparición de un duplicado o colisión se incluye en el settlement, o marcar como resuelto un `non_recorded_adjustment` tras verificarlo en el gateway. Ninguna de esas acciones es obligatoria para continuar; todas quedan auditadas. Las incidencias se conservan como persistentes o resueltas.

**Procesamiento del batch.** Antes de confirmar, el analista revisa los fees por batch: los que trae la hoja `Other Fees` del archivo aparecen prellenados (tipo resuelto contra el catálogo, importe del archivo) y puede confirmarlos, ajustarlos, quitarlos o añadir otros (preestablecidos de la cuenta con importe ajustable, o de importe libre con su categoría). Al confirmar, el sistema propone el siguiente número de batch (editable), registra los movimientos incluidos por ciclo E/I/R —todavía no Settled—, aplica los fees vigentes a la fecha del evento de cada movimiento, suma los fees por batch, calcula reservas según la política de la cuenta, asocia a la cuenta los canales nuevos, y genera el Settlement Summary: totales por tipo y por marca, fees por tipo y por batch, reservas retenidas y liberadas, y amount payable.

**Exports.** Al procesar se generan el resumen para el merchant y los CSV de transacciones y rolling reserves. Reconciliaciones los guarda como documentos de trabajo y los ejecuta en el Back-Office después de recibir el pago. Su generación no implica pago ni cambia el estado Settled. Los CSV se suben al Back-Office tal como se descargan, sin abrirlos ni guardarlos con Excel; para revisarlos: Excel → Datos → Desde texto/CSV, con la columna `ID` como Texto (ver "Identidad").

**Pago y seguimiento.** Listado de settlements por cuenta con su estado (procesado, pagado, deshecho); marcar un batch como pagado o retirar la marca con el permiso correspondiente; consulta de faltantes y duplicados persistentes; canales con transacciones sin cuenta asignada; ficha de una transacción con sus movimientos por ciclo.

**Deshacer un batch.** Solo un batch procesado pendiente de pago. Se conserva el intento anterior con motivo y autor; el import vuelve a `analyzed`, se valida de nuevo y se procesa como nuevo intento del mismo número oficial. Un intento deshecho no contribuye a totales vigentes ni al estado Settled.

#### Finalidad del proyecto: importación directa de los archivos originales (roadmap)

La meta del proyecto es que el equipo deje de normalizar a mano: subir los Excel originales de cada proveedor y que la aplicación los interprete mediante reglas configurables por proveedor, sin un importador fijo por proveedor. Esa capacidad **no forma parte del MVP**; se documenta aquí para que el diseño del MVP no la cierre. Las reglas previstas, además del pareo de hojas y columnas que sí entra en el MVP:

- **Estado derivado por fila:** condiciones sobre uno o varios campos determinan el estado, con reglas configurables, no inferencias libres de IA.
- **Fees informados por el proveedor:** se identifican por separado del importe de la operación y de los fees calculados por la aplicación; las diferencias quedan explícitas en la revisión.
- **Varias filas para un movimiento:** las reglas relacionan apariciones y determinan cuáles participan en el cálculo (por ejemplo, una fila *pending* seguida de otra *approved*). Las repeticiones no justificadas por una regla siguen sujetas a las validaciones.
- **Filas excluidas del cálculo:** se conserva su contenido original y el motivo de exclusión.

La vista previa mostraría el resultado de la interpretación y las reglas aplicadas; una fila sin interpretación suficiente o con reglas contradictorias quedaría señalada, sin asignarle un estado en silencio. El modelo de datos del MVP (conjuntos de reglas por proveedor, `ImportSheetColumnMap`, `rawData` por fila) está pensado para admitir estas reglas sin rehacer la importación.

#### Fuera del alcance del MVP (roadmap)

- **Importación directa de los Excel originales** con las reglas de interpretación descritas arriba, y formatos de entrada distintos de `.xlsx`.
- **Entidad Pago separada del settlement:** registrar el dinero que llega del proveedor y aplicarlo a uno o varios settlements, con pagos parciales y montos sin aplicar.
- **Reportería avanzada** inspirada en el sistema de reconciliación de un merchant: Aged Receivables (settlements en tránsito envejecidos a 30/60/90 días, reconciliado no procesado, reservas por vencer), forecast de settlements esperados, cortes contables y fees por rango.
- **Ingreso automático de batches históricos** y archivado del archivo procesado.

La integración con el Back-Office del gateway se mantiene como hoy, mediante los CSV exportados: es una herramienta de terceros sobre la que no se pueden hacer cambios.

#### Limitaciones conocidas

- Un import cuyas filas no coinciden con la cuenta (p. ej., de otro merchant) puede procesarse como un batch solo de fees, sin aviso específico. Arreglo previsto en la Entrega 3 ([#92](https://github.com/kajirioji/AI4Devs-finalproject/issues/92)).
- Lo recortado de la Entrega 2 (administración de cuentas y fees, entre otros) está en [1.5](#15-plan-de-recorte-de-la-entrega-2).

### 1.3. Diseño y experiencia de usuario

> Esta sección describe el mapa del sitio y el recorrido del usuario. Los wireframes y el prototipo están en [`docs/wireframes/`](docs/wireframes/); las capturas de las pantallas construidas en la Entrega 2, en sus subcarpetas por change (`web-validations/`, `web-settlement/`, `settlements-browse/`). El vídeo llega en la Entrega 3 ([#96](https://github.com/kajirioji/AI4Devs-finalproject/issues/96)).

#### Mapa de pantallas

Los nombres son los que aparecerán en la interfaz (en inglés). La columna "Alcance" indica qué se construye en las Entregas 2 y 3 y qué queda como roadmap.

| Menú | Pantalla | Qué muestra / permite | Alcance |
|---|---|---|---|
| — | **Login** | Usuario y contraseña | MVP |
| — | **Dashboard** | Landing tras el login: imports en curso, batches recientes, settlements pendientes de pago, canales *not assigned yet*, accesos rápidos según permisos | MVP |
| Reconciliation | **New Reconciliation** | Elegir merchant → proveedor → cuenta y arrancar el flujo | MVP |
| Reconciliation | **Upload Files** | Subir uno o varios archivos del settlement; quitar y añadir antes de analizar | MVP |
| Reconciliation | **Column Mapping** | Propuesta de pareo por hoja y columna, editable; vista previa; estado de preparación | MVP |
| Reconciliation | **Analysis & Validations** | Filas asociadas / no asociadas; aviso de canales; ocho validaciones con hallazgos, apariciones y acciones opcionales; `provider_mismatch` bloquea | MVP |
| Reconciliation | **Settlement Review** | Número de batch, fees por batch (preestablecidos ajustables o importe libre), resumen previo, confirmar | MVP |
| Reconciliation | **Settlement Summary** | Totales, fees, reservas, amount payable, resumen de incidencias, exports | MVP |
| Reconciliation | **In Progress** | Imports abiertos (subidos, pareados, analizados, validados) para retomarlos | MVP |
| Settlements | **Settlement List** | Por merchant, proveedor, cuenta, estado, fechas e intento | MVP |
| Settlements | **Settlement Detail** | Summary, movimientos por ciclo E/I/R, fees por batch, exports, intentos anteriores, undo | MVP |
| Settlements | **Payments** | Marcar pagado / retirar la marca; pendientes de pago por proveedor | MVP |
| Search | **Transaction Search** | Ficha de una transacción con sus movimientos por ciclo y sus apariciones en validaciones | MVP |
| Search | **Missing & Duplicates** | Faltantes y duplicados persistentes por cuenta, con su resolución | MVP |
| Reports | **Unsettled Transactions per Channel** | Pendientes por canal, reportados en la cuenta principal del canal, separando no reconciliados y pendientes de pago | MVP |
| Reports | **Aged Receivables**, **Settlement Forecast**, **Fee Summary** | Reportería inspirada en el sistema del merchant | Roadmap |
| Administration | **Merchants & Providers** | Solo lectura: lo que viene del gateway, con sus cuentas y canales | MVP |
| Administration | **Accounts** / **Account Detail** | Lista a ancho completo; crear cuenta en un diálogo (nombre, merchant, proveedor, política de reserva, tope, fees: ninguno o copiar de otra cuenta, conjunto de reglas de pareo: ninguno o uno del proveedor); editar y cerrar; canales asociados (principal e históricos); fees; conjunto de reglas | MVP |
| Administration | **Channel Assignment** | Canales *not assigned yet* y cuenta principal de cada canal | MVP |
| Administration | **Fees** (vista global) | Solo lectura: todos los fees activos del sistema, agrupados por merchant › proveedor, con filtros por merchant, proveedor, cuenta, tipo, estado y búsqueda; cada cuenta enlaza a su página de fees | MVP |
| Administration | **Account Fees** / **Fee History** | Fees de una cuenta (transaccionales y no transaccionales): crear, editar, cerrar vigencia, historial de cambios, simulación de un cambio (roadmap); se llega desde Account Detail o desde la vista global | MVP |
| Administration | **Matching Rules** | Conjuntos de reglas por proveedor (hoja, columna y filas a ignorar), alias de estado globales y reglas globales por defecto; crear un conjunto nuevo y ver qué cuentas lo usan | MVP |
| Administration | **Interpretation Rules** | Estado derivado, filas relacionadas, fees informados | Roadmap |
| Administration | **Users & Roles** | Usuarios, rol, alcance y merchants visibles | MVP |
| Administration | **Audit Log** | Quién hizo qué y cuándo | MVP (solo lectura) |

#### Presentación de validaciones y resultados parciales

La pantalla Analysis & Validations presenta principalmente las transacciones y su cantidad por ciclo, el resumen conjunto de advertencias con acceso al detalle de cada hallazgo y sus apariciones, y las reservas liberadas que ya muestra el sistema actual. La estimación de fees, su desglose y la reserva por retener van en un detalle desplegable cuya utilidad y densidad se validarán con el prototipo. El total por pagar se revisa en Settlement Review, con los fees por batch incorporados.

Se toma una sola decisión sobre el conjunto: **Continue to settlement review** o **Cancel and reprocess**. No hay una pantalla ni una decisión obligatoria por advertencia. Dentro del detalle de un hallazgo, el analista puede opcionalmente cambiar la inclusión de una aparición o marcar resuelto un ajuste no registrado; esas acciones quedan auditadas. Si existe un `provider_mismatch`, el botón de continuar está deshabilitado y la pantalla indica que debe cancelarse y procesarse con el proveedor correcto.

#### Recorrido del flujo principal

El analista entra a la aplicación y recorre el flujo principal en seis pantallas. Cada una muestra lo justo para tomar la siguiente decisión, y el sistema nunca avanza solo: importar, confirmar el pareo, continuar tras las validaciones y procesar son acciones explícitas del usuario.

```mermaid
flowchart TD
    L[Login] --> D[Dashboard<br/>imports en curso · batches recientes<br/>pendientes de pago · canales not assigned yet]
    D --> NR[New Reconciliation<br/>merchant → proveedor → cuenta]
    NR --> P1

    subgraph Reconciliation
        P1[Upload Files<br/>subir 1..n archivos .xlsx · quitar / añadir] --> P2
        P2[Column Mapping<br/>propuesta hoja → estado y columna → campo<br/>editable · vista previa · readiness] -->|Analyze| P3
        P3[Analysis & Validations<br/>filas asociadas vs. no asociadas · aviso de canales<br/>8 validaciones · hallazgos · acciones opcionales] --> P3d{Resultado}
        P3d -->|Continue| P4
        P3d -->|Cancel and reprocess| X[Import cancelado<br/>se procesa de nuevo con los archivos corregidos]
        P3d -->|provider_mismatch| X
        P4[Settlement Review<br/>batch no. propuesto o manual · fees por batch<br/>resumen previo · confirmar] --> P5
        P5[Settlement Summary<br/>totales por tipo y marca · fees · reservas · amount payable<br/>exports: merchant summary · CSV transactions · CSV reserves]
    end

    P5 --> S[Settlement Detail<br/>pay / unpay · undo → nuevo intento]
    D --> A[Administration<br/>Accounts · Channel Assignment · Fees · Matching Rules · Users]
```

Lo que el usuario ve en cada paso del flujo principal:

1. **Upload Files.** Selecciona la cuenta y arrastra uno o varios archivos. El sistema lista los archivos recibidos con sus hojas y número de filas; se pueden quitar y añadir mientras no se haya analizado.
2. **Column Mapping.** Para cada hoja, la propuesta de a qué estado corresponde (APP, DEC, CHB, REF, RR, resumen o ignorar) y, para cada columna, a qué campo se parea (Transaction ID, estado, monto, moneda, fecha, o "conservar como dato de referencia"), con el origen de cada propuesta. El analista corrige lo que no cuadre y confirma. No se puede analizar sin Transaction ID identificado y una forma confirmada de obtener el estado, por hoja o por columna.
3. **Analysis & Validations.** Primero las filas que no se pudieron asociar y el aviso de canales sin asociar o de otra cuenta; después las ocho validaciones con su resultado y conteo. Cada hallazgo abre a un detalle con todas sus apariciones. El analista continúa o cancela; opcionalmente actúa sobre hallazgos concretos. La aprobación queda registrada.
4. **Settlement Review.** El sistema propone el siguiente número de batch (editable), el analista revisa los fees por batch que trae la hoja `Other Fees` (prellenados) y añade o ajusta los que falten, revisa el resumen previo y confirma.
5. **Settlement Summary.** Totales por tipo y por marca, fees por movimiento y por batch, reservas retenidas y liberadas, amount payable, resumen de incidencias (persistentes y resueltas), y los tres exports.
6. **Settlement Detail.** Desde aquí se marca pagado o se retira la marca y, si el batch está pendiente de pago, se deshace para reprocesarlo como nuevo intento.

### 1.4. Instrucciones de instalación

[![CI](https://github.com/kajirioji/AI4Devs-finalproject/actions/workflows/ci.yml/badge.svg?branch=feature/entrega-2-MVP)](https://github.com/kajirioji/AI4Devs-finalproject/actions/workflows/ci.yml?query=branch%3Afeature%2Fentrega-2-MVP)

Procedimiento de la Entrega 2, pensado para seguirse paso a paso en un clon limpio. Todos los datos son sintéticos: el seed crea el mundo de demostración y los archivos de prueba están en [`data/samples/`](data/samples/). Los comandos se ejecutan desde la raíz del repositorio; valen igual en PowerShell, Git Bash, macOS o Linux salvo donde se indica.

**1. Requisitos**

| Herramienta | Versión | Para qué |
|---|---|---|
| Git | cualquiera reciente | clonar el repositorio |
| Node.js | 22.x (fijada en [`.node-version`](.node-version); el `package.json` exige `>=22 <23`) | backend, frontend y scripts |
| pnpm | 10.18.0 (fijada en `packageManager` del [`package.json`](package.json)) | monorepo; se activa con Corepack, que viene con Node |
| Docker | Docker Desktop (Windows/macOS) o Docker Engine con el plugin Compose (Linux) | SQL Server 2022 en contenedor |
| Python 3 con `openpyxl` | opcional | solo para regenerar los archivos de `data/samples/`; no hace falta para instalar ni para probar |

Puertos que deben estar libres: `1433` (SQL Server), `3000` (API) y `5173` (web).

Notas por sistema:

- **Windows:** Docker Desktop con el backend WSL 2 activado. Los scripts del contenedor se versionan con fin de línea LF (`.gitattributes`), así que el clon no los rompe aunque Git convierta a CRLF.
- **macOS con Apple Silicon:** la imagen de SQL Server 2022 es solo x86-64; en Docker Desktop activa *Use Rosetta for x86_64/amd64 emulation* antes de `pnpm db:up`.
- **Linux:** el usuario debe poder ejecutar `docker` sin `sudo` (grupo `docker`), porque los scripts de `pnpm` lo invocan directamente.

**2. Clonar e instalar dependencias**

```bash
git clone -b feature/entrega-2-MVP https://github.com/kajirioji/AI4Devs-finalproject.git
cd AI4Devs-finalproject
corepack enable          # activa la versión de pnpm fijada en package.json
pnpm install             # instala todo el monorepo e instala los hooks de git (husky)
```

**3. Variables de entorno**

Hacen falta **dos** archivos `.env`, cada uno creado a partir de su plantilla versionada (las plantillas solo traen valores de ejemplo, ningún secreto real); un tercero es opcional:

| Archivo | Plantilla | Lo leen | ¿Obligatorio? |
|---|---|---|---|
| `.env` (raíz) | [`.env.example`](.env.example) | Docker Compose, Prisma, backend, seed, pruebas de integración y Playwright | Sí |
| `api-collection/.env` | [`api-collection/.env.example`](api-collection/.env.example) | la colección Bruno (`pnpm test:api`) | Sí, para probar el API |
| `frontend/.env` | [`frontend/.env.example`](frontend/.env.example) | Vite | No: sin él, el proxy de `/api` apunta a `http://localhost:3000` |

```bash
# Git Bash, macOS o Linux
cp .env.example .env
cp api-collection/.env.example api-collection/.env

# PowerShell
Copy-Item .env.example .env
Copy-Item api-collection/.env.example api-collection/.env
```

Abre el `.env` de la raíz y sustituye los valores de ejemplo, como indican sus comentarios:

- `MSSQL_SA_PASSWORD`: contraseña de `sa` dentro del contenedor. Solo la usa el script de arranque de SQL Server para crear la base y los usuarios; la aplicación nunca entra como `sa`. SQL Server exige una contraseña fuerte (8 caracteres o más, con mayúsculas, minúsculas, números y símbolos); si no la cumple, el contenedor no arranca.
- `RECON_APP_PASSWORD`: contraseña del usuario de aplicación `recon_app` (también fuerte, por el mismo motivo); el usuario de solo lectura `recon_reader` se crea con la misma.
- `JWT_SECRET`: secreto de firma de las sesiones, de **32 caracteres o más**; con menos, el backend no arranca.
- `SEED_PASSWORD`: contraseña común de los cuatro usuarios de demostración que crea el seed.

Las demás tienen un valor por defecto válido para local y solo se cambian si hace falta: `MSSQL_PORT` y `DB_PORT` (1433), `DB_HOST` (`localhost`), `DB_NAME` (`ReconTool`), `DB_USER` (`recon_app`), `PORT` (3000), `HOST` (`0.0.0.0`), `LOG_LEVEL` (`info`) y `UPLOAD_DIR` (`data/uploads`, relativo al directorio del backend). `DATABASE_URL`, si se define, sustituye a la conexión que Prisma arma con las `DB_*`; solo la usa la CI.

En `api-collection/.env`, pon en `SEED_PASSWORD` **el mismo valor** que en el `.env` de la raíz; `SEED_USER` (`analyst`) y `SEED_VIEWER_USER` (`viewer`) ya vienen con los usuarios del seed.

Los tres `.env` están en `.gitignore`: nunca se versionan.

**4. Base de datos**

```bash
pnpm db:up          # arranca SQL Server 2022 (contenedor recon-mssql)
pnpm db:logs        # opcional: espera a "ready for client connections" y sal con Ctrl+C
pnpm db:generate    # genera el cliente de Prisma
pnpm db:migrate     # aplica las migraciones escritas a mano (prisma migrate deploy)
pnpm db:seed        # carga el mundo sintético; tarda uno o dos minutos
```

El primer `db:up` tarda más (descarga la imagen); al arrancar por primera vez, el contenedor crea la base `ReconTool` y los usuarios `recon_app` (aplicación y migraciones) y `recon_reader` (solo lectura) con las contraseñas del `.env`. Los datos viven en el volumen `recon-mssql-data`, así que sobreviven a `pnpm db:down`. El seed es idempotente: vacía las tablas y recarga el mismo mundo sintético (catálogos, cuentas con sus fees y reglas de pareo, unas 24 000 transacciones e historial de batches pagados); ejecutarlo de nuevo deja la base exactamente igual y borra el trabajo hecho en la aplicación.

> No se usan `prisma db push` ni `prisma migrate dev`: los índices únicos filtrados y las `CHECK` solo existen en las migraciones escritas a mano y se perderían.

**5. Arrancar la aplicación**

```bash
pnpm dev            # backend (http://localhost:3000) y frontend (http://localhost:5173) en paralelo
```

Abre http://localhost:5173 y entra con cualquiera de los usuarios de demostración y la contraseña de `SEED_PASSWORD`:

| Usuario | Rol | Alcance |
|---|---|---|
| `analyst` | analista: importa, valida y procesa | merchants 1 y 2 |
| `payments` | pagos (permiso `payment.process`) | merchants 1 y 2 |
| `viewer` | solo consulta | merchant 1 |
| `admin` | administración | todos los merchants |

Comprobación rápida: http://localhost:5173/api/v1/health responde a través del proxy de Vite. Para recorrer el flujo principal, entra como `analyst`, crea una reconciliación nueva y sube los archivos de un conjunto de [`data/samples/`](data/samples/) (su [`README`](data/samples/README.md) explica cada conjunto y su resultado esperado).

Arranques siguientes: `pnpm db:up` y `pnpm dev`; no hace falta migrar ni sembrar otra vez. `pnpm db:down` para el contenedor sin borrar los datos.

**6. Pruebas**

| Comando | Qué ejecuta | Necesita |
|---|---|---|
| `pnpm lint` · `pnpm typecheck` | Biome y TypeScript en todo el monorepo | solo el paso 2 y `pnpm db:generate` |
| `pnpm test` | pruebas unitarias con Vitest (dominio, backend y frontend) | solo el paso 2 y `pnpm db:generate` |
| `pnpm --filter @recon/backend test:integration` | pruebas de integración del backend contra el SQL Server local | pasos 3 y 4 (base migrada y sembrada) |
| `pnpm test:api` | colección Bruno de la API ([`api-collection/`](api-collection/)); `pnpm test:api:smoke` ejecuta solo `10-smoke` | pasos 4 y 5 con `pnpm dev` en marcha, y `api-collection/.env` (paso 3) |
| `pnpm test:e2e` | smoke E2E del flujo de importación con Playwright y Gherkin ([`e2e/`](e2e/)) | pasos 4 y 5 con `pnpm dev` en marcha, y el navegador de Playwright (abajo) |

Preparación de una sola vez para el E2E (la CLI de Bruno ya llega con `pnpm install`):

```bash
# Playwright: descarga Chromium
pnpm --filter @recon/e2e exec playwright install chromium
```

Las pruebas de integración, la colección y el E2E crean sus propios imports y batches sobre la base local; `pnpm db:seed` la devuelve al estado inicial. La CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) ejecuta en cada pull request lint, typecheck, pruebas unitarias, la comprobación del contrato OpenAPI y el build del frontend; en otro job, migración, seed y pruebas de integración contra un SQL Server 2022 efímero; y gitleaks. La colección Bruno y el E2E se ejecutan en local; su job de CI queda para la Entrega 3 ([#40](https://github.com/kajirioji/AI4Devs-finalproject/issues/40)).

**Problemas frecuentes**

- *El contenedor se detiene nada más arrancar:* `pnpm db:logs` lo explica; casi siempre es una `MSSQL_SA_PASSWORD` que no cumple la política de SQL Server. Corrige el `.env`, borra el contenedor y su volumen con `docker compose --env-file .env -f infra/docker-compose.yml down -v` (destructivo: solo en local) y vuelve a `pnpm db:up`.
- *`Invalid environment variables: JWT_SECRET` al arrancar el backend:* el secreto tiene menos de 32 caracteres.
- *`pnpm` no se reconoce:* falta `corepack enable` (en Windows, a veces en una terminal como administrador).
- *La colección Bruno falla en el login con `401`:* falta `api-collection/.env` o su `SEED_PASSWORD` no coincide con el del `.env` de la raíz que usó el seed.
- *El contenedor no arranca en un Mac con Apple Silicon:* falta activar la emulación Rosetta en Docker Desktop (ver Requisitos).

### 1.5. Plan de recorte de la Entrega 2

La Entrega 2 exige el flujo principal operativo de punta a punta, no completo al 100 %. El criterio de recorte fue proteger la cadena **importar → parear → validar → decidir → procesar → resumir y exportar** (HU1 → HU2 → HU3) con sus pruebas, y sacar lo que la rodea. Nada se descarta: todo lo recortado tiene su issue en el milestone *Entrega 3 - 11 nov* (seguimiento en [#38](https://github.com/kajirioji/AI4Devs-finalproject/issues/38)) o la etiqueta `roadmap` cuando es una mejora fuera del MVP.

**Funcionalidad recortada del plan**

| Qué queda fuera | Por qué | Issue |
|---|---|---|
| Administración de cuentas, canales, fees y reglas de pareo (`POST /accounts/{id}/fees`, sección 4.1) | El seed crea cuentas, fees y reglas de pareo; el flujo solo necesita leerlos | [#80](https://github.com/kajirioji/AI4Devs-finalproject/issues/80) |
| Reserva ante chargeback por política de la cuenta (`release_on_chargeback`) | Recortable previsto en el design de `settlement-process`: el núcleo de HU3 no depende de ella | [#62](https://github.com/kajirioji/AI4Devs-finalproject/issues/62) |
| Resolver filas ambiguas desde la interfaz y lista *In Progress* para retomar imports | El endpoint de resolución ya existe (`PATCH` de la fila); la pantalla solo las muestra | [#38](https://github.com/kajirioji/AI4Devs-finalproject/issues/38) |
| Suite E2E completa y job E2E en CI | Entra solo el smoke de importación, en local; la integración y la colección Bruno cubren el resto del API | [#38](https://github.com/kajirioji/AI4Devs-finalproject/issues/38), [#40](https://github.com/kajirioji/AI4Devs-finalproject/issues/40) |
| Huecos del API vistos en las pantallas: límite de archivos por import, catálogo de estados, motivo al cancelar | No bloquean el flujo; el límite por petición ya existe | [#40](https://github.com/kajirioji/AI4Devs-finalproject/issues/40), [#47](https://github.com/kajirioji/AI4Devs-finalproject/issues/47) |
| Hojas sin confirmar en la readiness del detalle | La pantalla las deriva de `mappingConfirmed` mientras tanto | [#42](https://github.com/kajirioji/AI4Devs-finalproject/issues/42) |
| Motivo de `includable = false` en el detalle del hallazgo | La regla se aplica; falta mostrar el motivo al analista | [#55](https://github.com/kajirioji/AI4Devs-finalproject/issues/55) |
| La decisión de conjunto no fija las inclusiones que vio el analista | Aceptado en el review de `validation-runs`: la corrida vigente sí se exige | [#53](https://github.com/kajirioji/AI4Devs-finalproject/issues/53) |
| `status_mismatch` cuando el gateway está en `Pending` | Decisión del gate: la fila se procesa con su estado y el aviso llega después | [#63](https://github.com/kajirioji/AI4Devs-finalproject/issues/63) |
| Guardar `skipped`, `warnings` y `channelsAssigned` en el batch | Hoy se reconstruyen desde la auditoría; funciona, pero no es su sitio | [#65](https://github.com/kajirioji/AI4Devs-finalproject/issues/65) |
| Descarga `.xlsx` de los movimientos con el ID como texto | Los CSV del Back-Office ya salen; el `.xlsx` es para el analista | [#68](https://github.com/kajirioji/AI4Devs-finalproject/issues/68) |
| Aviso cuando ninguna fila del import coincide con la cuenta | Hoy puede procesarse como un batch solo de fees (ver "Limitaciones conocidas" en 1.2) | [#92](https://github.com/kajirioji/AI4Devs-finalproject/issues/92) |
| Vídeo de la demo | El tiempo de la Entrega 2 fue al flujo y a la revisión con usuarios | [#96](https://github.com/kajirioji/AI4Devs-finalproject/issues/96) |

**Lo que entró al final.** La lista de Settlements de una cuenta y la pestaña Movements del Summary, que estaban recortadas, entraron con `settlements-browse` ([#64](https://github.com/kajirioji/AI4Devs-finalproject/issues/64), PR [#88](https://github.com/kajirioji/AI4Devs-finalproject/pull/88)).

**Revisión con usuarios.** El 20 de octubre, el líder del equipo revisó con el analista del proyecto la interfaz del recorrido de la demo (Files → Mapping → Analysis → Settlement Review → Summary, y Settlement List) sobre el mundo sintético ([`docs/uat/`](docs/uat/), notas en [`2026-10-20-revision-interfaz.md`](docs/uat/2026-10-20-revision-interfaz.md)). La valoración general del progreso y del resultado fue buena; las observaciones fueron de legibilidad de la interfaz, ninguna de reglas ni cifras. Doce entraron en la Entrega 2 con `ui-polish` (PR [#91](https://github.com/kajirioji/AI4Devs-finalproject/pull/91)) y el resto pasó a issues:

| Observación de la revisión | Destino | Issue |
|---|---|---|
| Plegar y desplegar cada archivo en Column Mapping | Entrega 3 | [#85](https://github.com/kajirioji/AI4Devs-finalproject/issues/85) |
| Columna Round #1/#2 en las tablas de rangos | Entrega 3 | [#86](https://github.com/kajirioji/AI4Devs-finalproject/issues/86) |
| Transacciones por estado en la tabla de rangos de Validations | Entrega 3 | [#87](https://github.com/kajirioji/AI4Devs-finalproject/issues/87) |
| Merchant summary en `.xlsx` | Entrega 3 | [#82](https://github.com/kajirioji/AI4Devs-finalproject/issues/82) |
| Selector del merchant activo en la barra superior | Roadmap | [#83](https://github.com/kajirioji/AI4Devs-finalproject/issues/83) |
| Modo oscuro | Roadmap | [#84](https://github.com/kajirioji/AI4Devs-finalproject/issues/84) |

**Deuda técnica registrada** (no cambia el comportamiento visible del flujo)

| Qué | Issue |
|---|---|
| Endurecimiento de imports (hallazgos LOW del review de #33) | [#34](https://github.com/kajirioji/AI4Devs-finalproject/issues/34) |
| Vencimiento de reservas con el plazo aplicado al liquidar (`expectedReserveReleaseAt`) | [#44](https://github.com/kajirioji/AI4Devs-finalproject/issues/44) |
| Serializar las fechas de negocio sin `Z` | [#48](https://github.com/kajirioji/AI4Devs-finalproject/issues/48) |
| Carga de la corrida de validaciones: 2,2 s con 50 000 movimientos (objetivo local: 2 s) | [#50](https://github.com/kajirioji/AI4Devs-finalproject/issues/50) |
| Estructura del repositorio de validaciones | [#51](https://github.com/kajirioji/AI4Devs-finalproject/issues/51) |
| Tests intermitentes del frontend con las suites en paralelo | [#56](https://github.com/kajirioji/AI4Devs-finalproject/issues/56) |
| Concurrencia (interbloqueos) y precisión de `settlement-process` | [#67](https://github.com/kajirioji/AI4Devs-finalproject/issues/67) |
| Autenticación antes que la validación del esquema (`onRequest`) | [#72](https://github.com/kajirioji/AI4Devs-finalproject/issues/72) |
| Calidad de los tests de settlement con el API falso | [#75](https://github.com/kajirioji/AI4Devs-finalproject/issues/75) |
| Falsos positivos del hook `guard-db.sh` con comandos citados en mensajes de commit | [#81](https://github.com/kajirioji/AI4Devs-finalproject/issues/81) |
| Un solo ayudante para el texto que no se parte en el frontend | [#90](https://github.com/kajirioji/AI4Devs-finalproject/issues/90) |
| Cobertura pendiente tras el review de `ui-polish` | [#94](https://github.com/kajirioji/AI4Devs-finalproject/issues/94) |

**Roadmap** (etiqueta `roadmap`, sin fecha): cerrar la inclusión manual de duplicados E entre batches, que hoy existe solo para procesar batches históricos ([#49](https://github.com/kajirioji/AI4Devs-finalproject/issues/49)); mantenimiento de tipos de fees ([#60](https://github.com/kajirioji/AI4Devs-finalproject/issues/60)); alerta de tope de reserva alcanzado ([#61](https://github.com/kajirioji/AI4Devs-finalproject/issues/61)); y señalar importes del proveedor fuera de un tipo de cambio razonable ([#93](https://github.com/kajirioji/AI4Devs-finalproject/issues/93)).

---

## 2. Arquitectura del Sistema

### 2.1. Diagrama de arquitectura

> **Estado en la Entrega 2.** La arquitectura y el stack descritos están implementados: React 19, TypeScript, Fastify 5, Zod 4, Prisma 7 con `@prisma/adapter-mssql` y SQL Server 2022. Las decisiones y sus desviaciones respecto del plan están en los ADR de [`docs/adr/`](docs/adr/). En producción, la integración se alimentará de los datos consolidados de los gateways.

Recon Tool 2.0 es una aplicación web de tres piezas —una SPA en React, una API REST en Node/TypeScript y una base de datos SQL Server— organizada como **monolito modular con arquitectura hexagonal** (puertos y adaptadores) en el backend.

**Vista de contexto** — quién usa el sistema y con qué se relaciona:

```mermaid
flowchart LR
    A[Analistas de<br/>reconciliaciones] --> RT[Recon Tool 2.0]
    B[Administrador de<br/>cuentas y fees] --> RT
    P[Archivos de settlement<br/>de los proveedores] -->|.xlsx| RT
    G[Gateways<br/>merchants · proveedores · canales · transacciones] -->|solo lectura| RT
    RT -->|CSV cargados a mano tras el pago| BO[Back-Office del gateway<br/>herramienta de terceros]
    RT -->|resumen| M[Merchant]
```

**Vista de contenedores** — las tres piezas y cómo se comunican:

```mermaid
flowchart LR
    FE[Frontend<br/>React + TypeScript] -->|HTTPS · JSON<br/>contrato OpenAPI| API[API REST<br/>Node.js + TypeScript<br/>Fastify]
    API -->|Prisma| DB[(SQL Server 2022)]
```

**Vista interna del backend** — módulos de dominio y capas:

```mermaid
flowchart TB
    HTTP[Capa HTTP<br/>rutas · validación · autenticación · alcance por merchant]
    HTTP --> CAT[Catálogo] & FEE[Fees] & IMP[Importación] & VAL[Validaciones] & SET[Settlement] & EXP[Exports]
    CAT & FEE & IMP & VAL & SET & EXP --> PORTS[Puertos de persistencia]
    PORTS -->|adaptadores Prisma| DB[(SQL Server)]
```

**Patrón y por qué.** El backend se divide en módulos de dominio (catálogo, fees, importación, validaciones, settlement, exports), y dentro de cada uno la lógica de negocio no depende de HTTP ni de la base de datos: recibe y devuelve objetos del dominio, y habla con la persistencia a través de puertos (interfaces de repositorio) implementados con Prisma. Es la arquitectura hexagonal que el máster trabaja en el módulo de backend, en su versión pragmática de un solo despliegue.

Las razones son de este proyecto, no genéricas:

- **La lógica de reconciliación es lo que vale y lo que hay que testear.** Las ocho validaciones y el cálculo del settlement son funciones deterministas con entrada y salida conocidas. Aislarlas de la base de datos permite probarlas con datos en memoria, hacer TDD sobre ellas y reutilizarlas si mañana cambia el motor de base de datos o la interfaz.
- **El origen de las transacciones propias va a cambiar.** En el MVP viven en una tabla sintética; en producción se alimentarán desde los gateways. Un puerto `TransactionSource` con una implementación local hoy y otra mañana evita reescribir el dominio.
- **Un solo despliegue es lo correcto para el tamaño del equipo.** Un monolito modular se levanta con un `docker compose up`, se depura en un solo proceso y no necesita orquestación. Los módulos dan los límites internos que permitirían separar alguno después si hiciera falta, sin pagar ese coste ahora.

**Qué se sacrifica.** Más ficheros y más indirección que un CRUD directo (cada módulo tiene sus entidades, sus puertos y sus adaptadores), lo que cuesta al principio en un stack nuevo para el autor. El monolito no escala por partes, aunque la carga esperada (batches de 1.000–2.000 filas, decenas de usuarios) no lo requiere. Y la SPA obliga a mantener un contrato OpenAPI entre frontend y backend, que se convierte en tarea y en test.

**Decisiones de arquitectura** ([`docs/adr/`](docs/adr/), formato MADR). Las seis previstas en la Entrega 1 están **aceptadas** y cada ADR anota en qué se desvió la implementación; los cambios de rumbo de la Entrega 2 son ADR-007 a ADR-011 (migraciones escritas a mano, lector `.xlsx` propio, un movimiento por fila de origen, resultado de las validaciones y códigos de error en minúsculas):

| ADR | Decisión | Alternativa descartada | Consecuencia principal |
|---|---|---|---|
| [001](docs/adr/001-aplicacion-web-propia.md) | Aplicación web propia en lugar de seguir extendiendo SSRS | Añadir reportes al sistema actual | Formularios, validación, sesiones y errores se resuelven de forma nativa; hay que reconstruir lo que el sistema actual ya hace |
| [002](docs/adr/002-sql-server-2022.md) | SQL Server 2022 desde el MVP, contenedor oficial para desarrollo | PostgreSQL con portabilidad posterior | Reutiliza esquema y lógica del sistema actual; el paso a producción es un despliegue, no una migración; la imagen es solo x86-64 |
| [003](docs/adr/003-ciclos-e-i-r-y-settled.md) | Tres ciclos de reconciliación (E, I, R) como eje del modelo, con Settled solo tras el pago | Un único estado "settled" por transacción | Una transacción puede tener varios movimientos distribuidos en los tres ciclos, cada uno con seguimiento propio; el modelo y el summary se construyen alrededor de eso |
| [004](docs/adr/004-tabla-de-transacciones-propia.md) | Tabla de transacciones propia y desacoplada del gateway | Consultar la tabla de transacciones del gateway en vivo como el sistema actual | Tests reproducibles y sin acceso a producción; en producción hace falta un job o vista de carga |
| [005](docs/adr/005-monolito-modular-hexagonal.md) | Monolito modular hexagonal con Fastify + Prisma | NestJS (más estructura, más magia) · Express (menos estructura) | Curva corta, tipado de punta a punta, validación con Zod compartida con el frontend |
| [006](docs/adr/006-batches-como-intentos.md) | Batches como intentos conservados (`attemptNo`) en lugar de borrar al deshacer | Borrar y recrear el batch (comportamiento del sistema actual) | Trazabilidad completa del reprocesamiento; índices únicos filtrados para un solo intento vigente |
| [007](docs/adr/007-migraciones-escritas-a-mano.md) | Migraciones escritas a mano; prohibidos `migrate dev` y `db push` | Generarlas desde `schema.prisma` | Índices filtrados, `CHECK` y trigger viven solo en las migraciones; `recon_app` sin permisos de *shadow database* |
| [008](docs/adr/008-lector-xlsx-propio.md) | Lector `.xlsx` propio sobre `fflate` y `saxes`, todo como texto | SheetJS (CVE sin corregir en npm) · ExcelJS (convierte a `number`) | Ningún ID pierde dígitos; límites de descompresión propios; código propio que mantener |
| [009](docs/adr/009-un-movimiento-por-fila-de-origen.md) | Un movimiento por fila de origen `(batchId, sheetId, rowNo)` y fecha de evento NULL si se desconoce | `UNIQUE (transactionId, cycle, batchId)` · inventar la fecha | Refund + Chargeback o un duplicado incluido a mano caben en el mismo batch; migraciones `0007` y `0008` |
| [010](docs/adr/010-resultado-de-las-validaciones.md) | Resultado `passed` / `warning` / `blocked` / `not_applicable` / `not_implemented` | `passed` / `failed` | Solo `provider_mismatch` bloquea; "sin datos" no se confunde con "sin hallazgos" |
| [011](docs/adr/011-codigos-de-error-en-minusculas.md) | Códigos de error en snake_case minúsculas | Mayúsculas de los ejemplos de la Entrega 1 | Los ejemplos del README se corrigen al implementar cada endpoint |

### 2.2. Descripción de componentes principales

> Describe el diseño completo del MVP. En la Entrega 2 está implementado lo que necesita el flujo principal; lo recortado (administración de cuentas y fees, simulación de fees, entre otros) está en [1.5](#15-plan-de-recorte-de-la-entrega-2).

**Frontend (React 19, TypeScript, Vite).** SPA con enrutado por pantalla (login, dashboard, flujo de reconciliación en seis pasos, settlements, pagos, búsqueda, administración). Estado de servidor con TanStack Query (caché, reintentos, invalidación tras cada acción); componentes de UI con shadcn/ui sobre Tailwind; formularios con React Hook Form y los mismos esquemas Zod que valida el backend. Tabla de datos virtualizada para las vistas de filas, hallazgos y apariciones.

**API HTTP (Node.js 22, Fastify).** Expone la API REST bajo `/api/v1`, valida cada petición con Zod, publica la especificación OpenAPI en `/docs` (Swagger UI, en el puerto del backend) y protege las rutas con JWT de corta duración más refresh. Un plugin de autorización resuelve por petición los permisos del usuario y su alcance de merchants, y lo inyecta en los casos de uso.

**Módulo de catálogo.** Merchants, proveedores y canales de solo lectura (alimentados por el seed en el MVP y por un job desde los gateways en producción); cuentas con creación (sin fees o copiando los de otra cuenta del proveedor; enlace opcional a un conjunto de reglas) y edición, política de reserva ante chargeback, canales asociados y cuenta principal por canal; conjuntos de reglas de pareo por proveedor.

**Módulo de fees.** Fees por cuenta con tipo, monto fijo o porcentaje, valor y vigencia; regla de no solapamiento; historial de cambios; simulación del efecto de una edición.

**Módulo de importación.** Recibe uno o varios `.xlsx` por cuenta, los lee hoja a hoja con un lector OOXML propio que devuelve todas las celdas como texto ([ADR-008](docs/adr/008-lector-xlsx-propio.md)), aplica el conjunto de reglas de pareo enlazado a la cuenta (o las globales) para proponer el mapeo, guarda cada fila con su identificador de origen, estado y el resto de columnas como JSON de referencia, y ejecuta el cruce por identidad externa contra la tabla de transacciones propias.

**Módulo de validaciones.** Las ocho validaciones como funciones puras sobre el conjunto de filas del import, el histórico de settlements vigentes de la cuenta y el ciclo de vida de estados. Devuelve por validación el resultado y los hallazgos, cada uno con sus N apariciones y su inclusión por defecto; persiste hallazgos como incidencias persistentes o resueltas.

**Módulo de settlement.** Asigna el número de batch y el intento, registra los movimientos por ciclo E/I/R, aplica fees por fecha de evento y reservas por política de cuenta, produce el Settlement Summary y gestiona los estados del batch (`processed`, `paid`, `undone`).

**Exports (dentro del módulo de settlement).** Genera el resumen para el merchant y los dos CSV con el formato que el Back-Office necesita, identificados por intento.

**Persistencia (Prisma sobre SQL Server 2022).** Esquema propio del Recon Tool 2.0, migraciones versionadas escritas y revisadas a mano ([ADR-007](docs/adr/007-migraciones-escritas-a-mano.md)), seed sintético idempotente. Los repositorios son adaptadores de los puertos del dominio.

**Autenticación y autorización.** Usuarios con contraseña hasheada (Argon2), permisos por acción, alcance de merchants (`assigned` / `all`) y asignación de merchants por usuario.

### 2.3. Descripción de alto nivel del proyecto y estructura de ficheros

Monorepo con dos aplicaciones y la documentación al lado del código:

```
recon-tool-2/
├── readme.md                     # este documento (plantilla oficial)
├── prompts.md                    # registro del uso de IA
├── AGENTS.md · CLAUDE.md         # contexto para los copilotos
├── .claude/                      # skills, comandos de OpenSpec y hooks del proyecto
├── .github/                      # CI (lint · typecheck · unitarios · contrato · build · integración · gitleaks) y plantilla de PR
├── .env.example                  # plantilla del .env de la raíz (1.4)
├── infra/
│   ├── docker-compose.yml        # SQL Server 2022 para desarrollo
│   └── mssql/                    # arranque: crea la base y los usuarios recon_app y recon_reader
├── docs/
│   ├── adr/                      # ADR-001 … ADR-011 en formato MADR
│   ├── openapi.yaml              # contrato de la API, exportado del backend
│   ├── uat/                      # sesiones de revisión con usuarios
│   └── wireframes/               # prototipo (Entrega 1) y capturas por change (Entrega 2)
├── openspec/
│   ├── specs/                    # specs vivas por capacidad
│   └── changes/archive/          # un change archivado por feature
├── data/
│   └── samples/                  # archivos de settlement sintéticos (.xlsx) y expected.json
├── packages/
│   └── shared/                   # esquemas Zod y vocabulario compartidos por backend y frontend
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/           # escritas y revisadas a mano (ADR-007)
│   │   ├── synthetic.ts          # parámetros del mundo sintético
│   │   └── seed.ts               # seed idempotente
│   ├── src/
│   │   ├── modules/              # auth · catalog · fees · imports · matching · validation · settlement
│   │   │   └── <módulo>/         # domain/ · application/ · infrastructure/ · http/
│   │   ├── config/               # variables de entorno validadas con Zod
│   │   ├── plugins/              # Prisma y manejador de errores
│   │   ├── shared/               # errores y auditoría
│   │   ├── openapi/              # exportación del contrato
│   │   ├── app.ts                # composición de Fastify y plugins
│   │   └── server.ts
│   └── test/integration/         # rutas y repositorios contra SQL Server (los unitarios van junto al código)
├── frontend/
│   └── src/
│       ├── app/                  # rutas y layout
│       ├── features/             # accounts · auth · imports · validations · settlements
│       ├── components/ui/        # shadcn/ui
│       └── lib/api/              # cliente tipado generado desde openapi.yaml
├── api-collection/               # colección Bruno: 00-auth · 10-smoke · 20-flows
└── e2e/                          # Playwright + Gherkin: smoke de importación y scripts de capturas
```

Cada módulo del backend sigue la misma división interna: `domain/` (entidades, reglas y puertos, sin dependencias externas), `application/` (casos de uso), `infrastructure/` (adaptadores Prisma y ficheros) y `http/` (rutas y esquemas). Los tests unitarios viven junto al código que prueban (`*.test.ts`). El frontend se organiza por *feature* en lugar de por tipo de fichero, de modo que cada pantalla tiene juntos sus componentes, sus consultas y sus tests.

### 2.4. Infraestructura y despliegue

> **Estado en la Entrega 2: solo entorno local.** La aplicación se ejecuta con Docker Compose (SQL Server) y `pnpm dev` siguiendo [1.4](#14-instrucciones-de-instalación); la CI de GitHub Actions ya corre en cada pull request. El entorno de demostración con URL pública que sigue (servidor propio con Docker y túnel, solo con datos sintéticos) es el plan para la Entrega 3 y no está implementado.

**Entornos.**

| Entorno | Dónde | Base de datos | Para qué |
|---|---|---|---|
| Local (autor y TA) | Docker Compose en el portátil | SQL Server 2022 en contenedor | Desarrollo, tests, revisión de la entrega |
| Demostración (URL pública) | Servidor propio: host Docker para la aplicación + máquina dedicada para SQL Server | SQL Server 2022 en máquina dedicada | Entorno persistente y URL pública para las Entregas 2 y 3 |
| Producción (futuro, fuera del alcance del máster) | Infraestructura de la compañía | SQL Server existente | Destino final; el esquema y el ORM no cambian |

```mermaid
flowchart LR
    U[TA / usuario] -->|HTTPS| T[Túnel público<br/>Cloudflare Tunnel]
    subgraph Servidor["Servidor propio"]
        subgraph D01["Host Docker · Docker Compose"]
            W[web · Nginx<br/>sirve la SPA y hace proxy de /api]
            P[api · Node 22<br/>contenedor de la API]
            W --> P
        end
        S[(SQL Server 2022<br/>máquina dedicada)]
        P -->|1433, red interna| S
        BK[Backups programados<br/>de la BD]
        S --> BK
    end
    T --> W
```

**Proceso de despliegue previsto (Entrega 3).** Primero manual y reproducible: `git pull` en el host Docker, `docker compose build` y `docker compose up -d`, con las migraciones ejecutadas como paso separado del despliegue, mediante una identidad distinta de la aplicación. Después, automatizado con GitHub Actions: el build de las imágenes y el despliegue al servidor se disparan desde el runner sobre el túnel. La parte de integración continua ya existe desde la Entrega 2: en cada pull request, lint, typecheck, tests unitarios, contrato OpenAPI, build del frontend, migración, seed e integración contra un SQL Server efímero en el runner, y gitleaks. La URL pública sale por Cloudflare Tunnel, que no requiere abrir puertos en el router; como respaldo ante indisponibilidad del servidor el día de la revisión, la Entrega 3 incluye vídeo del sistema funcionando.

**Configuración.** Toda la configuración va por variables de entorno (`.env.example` versionado, `.env` no). Secretos del servidor fuera del repositorio.

### 2.5. Seguridad

> **Estado en la Entrega 2.** Implementados y probados: login con Argon2, JWT de acceso y refresh con rotación, permisos por acción, alcance por merchant aplicado en la consulta (lo ajeno responde `404`), validación de entrada con Zod y límites del lector `.xlsx`, auditoría de las acciones del flujo, usuario de base `recon_app` con permisos mínimos y gitleaks en la CI. La administración de usuarios y lo que depende del despliegue (HTTPS en el túnel, red interna) llegan con la Entrega 3.

**Perfiles y permisos.** Cada perfil agrupa acciones autorizadas. Se separan consulta y exports (`reports.view`), reconciliación y deshacer (`settlement.process`), registro y retiro de pago (`payment.process`), cuentas y reglas (`account.manage`), consulta y edición de fees (`fee.view`, `fee.manage`) y administración de usuarios, perfiles y asignaciones (`user.manage`). Administrar cuentas no concede administración de usuarios.

**Aislamiento por merchant.** Cada usuario tiene un alcance explícito: `assigned` usa las filas de `UserMerchant`; `all` concede acceso a todos los merchants. No tener asignaciones no significa acceso global. El backend comprueba permiso de acción y alcance de datos en cada petición. Listados, búsquedas, dashboards, conteos, archivos, exports, incidencias y auditoría no revelan merchants ajenos ni sus recursos; un recurso no autorizado responde como no encontrado. La gestión de usuarios no permite ampliar el propio alcance ni conceder merchants o permisos fuera de la autoridad del administrador.

- **Ningún dato real en el repositorio.** Todo el contenido de `data/samples/` y del seed es sintético: proveedores, merchants, IDs y montos generados. No hay nombres reales de proveedores ni de merchants, ni estructuras de la base de producción más allá de lo necesario para el modelo.
- **Autenticación.** Contraseñas con Argon2; JWT de acceso de corta duración con refresh; permisos y alcance resueltos en cada petición, nunca en el frontend.
- **Validación de entrada en el punto de entrada de datos externos.** Los archivos del proveedor se validan por tipo, tamaño, número de hojas y filas antes de parsearse; cada fila pasa por esquemas Zod; los montos se manejan como `DECIMAL(19,4)` en la base y como decimales en la aplicación, nunca como `float` ni como `MONEY` (ver 3.2). El cruce con transacciones propias se hace por identidad exacta, sin construir SQL dinámico.
- **Trazabilidad.** Toda aprobación de batch, pago, retiro de pago, deshacer, acción sobre un hallazgo, cambio de fee y creación o edición de cuenta quedan registrados con usuario y fecha.
- **Base de datos.** Usuario de aplicación con los permisos mínimos sobre el esquema (nunca `sa` fuera del contenedor local); cadenas de conexión en variables de entorno; migraciones revisadas por una persona antes de aplicarse, y ninguna migración destructiva sin respaldo previo. Cualquier conexión de un agente de IA a datos que no sean sintéticos se hace en modo solo lectura.
- **Transporte y perímetro.** HTTPS en el túnel público; la base de datos solo es alcanzable desde la red interna del servidor.

### 2.6. Tests

> **Estado en la Entrega 2.** Los tres niveles están en marcha sobre las partes críticas: unitarios con Vitest (dominio de validaciones, pareo, fees y summary escritos test-first contra los `expected.json` de `data/samples/`, y pantallas con Testing Library), integración contra SQL Server real (`backend/test/integration/`) y la colección Bruno del API; del E2E existe el smoke de importación. Unitarios e integración corren en la CI en cada pull request; Bruno y el E2E, en local (comandos en [1.4](#14-instrucciones-de-instalación), paso 6). Lo que sigue es la estrategia completa; lo pendiente se indica en cada nivel.

**Escenarios críticos de aceptación previstos:**

- Aislamiento por merchant en consultas, búsquedas, conteos, descargas, incidencias y acceso directo por ID; las respuestas no revelan recursos ajenos.
- Separación de permisos: consultar no permite procesar; procesar no permite registrar pagos; administrar cuentas no permite administrar usuarios.
- Importación de la plantilla con estado por hoja y por columna con alias; conservación de la fila original; readiness correcto cuando falta el estado.
- Duplicados contabilizados una sola vez, con hallazgos persistentes, N apariciones y resultados parciales verificables.
- Fees múltiples en USD elegidos por fecha de la operación o del ajuste, incluyendo límites de vigencia.
- Ciclos E/I/R no Settled al procesar y Settled al pagar; CSV disponibles desde el procesamiento sin cambiar esos estados.
- Deshacer solo estando pendiente de pago; conservación de intentos, mismo número oficial, import de vuelta a `analyzed` y recálculo de incidencias afectadas.
- Reserva mantenida o cancelada según la política de la cuenta, con la regla aplicada conservada.
- `provider_mismatch` bloquea; las demás validaciones no.

La estrategia sigue el principio del máster: el test es la especificación determinista que valida lo que genera el agente. Se organiza en tres niveles, con ejemplos de lo que se prueba en cada uno.

**Unitarios (Vitest, sin base de datos).** El dominio de validaciones y settlement es el candidato natural: para cada una de las ocho validaciones, un conjunto de filas de entrada y el resultado esperado (por ejemplo, un ID repetido con estados `Successful` y `Declined` en el mismo archivo produce una colisión con dos apariciones y advertencia no bloqueante). Cálculo del Settlement Summary con fees fijos, porcentuales y condicionales, y con fees por batch. Regla de no solapamiento de fees, con los casos límite de rangos contiguos y abiertos. Propuesta de pareo a partir de las reglas de la cuenta. Los tests se escriben primero (Red → Green → Refactor) y cada test generado por IA se rompe a propósito una vez para comprobar que detecta el fallo.

**Integración (Vitest + SQL Server efímero en contenedor).** Repositorios y rutas contra una base real: importar un archivo de ejemplo y verificar filas, hojas y JSON de referencia; procesar un batch y comprobar los movimientos E/I/R y sus fees en `SettlementTransaction` y `SettlementTransactionFee`; deshacer y comprobar el segundo intento; intentar crear un fee solapado y recibir `409 Conflict`. Cada test corre dentro de una transacción que se revierte al terminar. El contrato OpenAPI se contrasta contra las respuestas reales.

**End-to-end (Playwright).** El flujo principal completo en el navegador: login → cuenta → importar `data/samples/provider-a-batch-118-part1.xlsx` y `-part2.xlsx` → confirmar pareo → revisar validaciones → procesar → descargar el summary → marcar pagado. Escenarios en Gherkin para el flujo feliz, para "cancelar y reprocesar" y para `provider_mismatch`.

**Smoke E2E en local (Entrega 2).** El primer escenario de esa suite vive en `e2e/` (Playwright + playwright-bdd, `features/import-smoke.feature`): login como `analyst` → New Reconciliation en `ProviderA-USD` → subir `batch-clean` → confirmar la propuesta → analizar → ver `Rows read 783`, `Matched 780` y `RAM-07 is not assigned yet` → cancelar el import como limpieza. Como la colección Bruno, corre contra la base y la aplicación locales:

1. `pnpm db:up`, `pnpm db:seed` y `pnpm dev` (en otra terminal), con `SEED_PASSWORD` en el `.env` de la raíz.
2. La primera vez, el navegador de Playwright: `pnpm --filter @recon/e2e exec playwright install chromium`.
3. `pnpm test:e2e`. Si la aplicación o el API no responden, falla antes del primer paso indicando esos comandos. El informe queda en `e2e/playwright-report/` (no versionado), sin traza ni vídeo para no guardar lo que se escribe en el login.

Todavía no corre en CI: el job llega con la suite completa en la Entrega 3.

**En pipeline.** Unitarios e integración ya corren en cada pull request desde la Entrega 2. Para la Entrega 3: E2E y colección Bruno en la CI ([#40](https://github.com/kajirioji/AI4Devs-finalproject/issues/40)) y objetivo de cobertura del 80 % en el dominio. Como métrica complementaria, mutation testing sobre el módulo de validaciones, que es donde un test que "pasa" sin detectar nada haría más daño.

---

## 3. Modelo de Datos

El modelo propuesto parte del esquema real del Recon Tool actual (30 tablas, 15 procedimientos almacenados) y lo reorganiza con tres criterios: conservar lo que ya funciona (la cadena de ingesta archivo → hoja → fila, los tres ciclos E/I/R, los catálogos de estados), normalizar lo que el sistema actual resolvía con columnas repetidas o con `UNIQUE` que impiden historial, y añadir lo que el MVP necesita y el sistema actual no tiene (usuarios con permisos y alcance, merchants, conjuntos de reglas de pareo por proveedor, hallazgos con N apariciones, fees por movimiento con historial, intentos de batch, Settled solo tras el pago).

### Del sistema actual al desarrollo propuesto: qué se conserva, qué cambia, qué se va

| Sistema actual (`ReconTool.dbo`) | Desarrollo propuesto | Cambio |
|---|---|---|
| `Gateways`, `Account`, `AccountChannels` | `Gateway`, `Merchant`, `Provider`, `Channel`, `Account`, `AccountChannel` | `Merchant`, `Provider` (asociado a un merchant) y `Channel` pasan a ser tablas propias de solo lectura alimentadas desde los gateways. `Account` sigue siendo la única entidad exclusiva del Recon Tool: gana `chargebackReservePolicy` e `isActive`, pierde `originalPath`. Los parámetros `settlementTermDays`, `rollingReservePct` y `rollingReserveDays` pertenecen a `Channel` y provienen del gateway. `AccountChannel` pasa de lista fija a asignación con cuenta principal (`isPrimary`, una sola por canal) para atribuir pendientes una sola vez |
| `Transactions` (espejo de flags E/I/R) + la tabla de transacciones del gateway | `Transaction` | Tabla propia (sintética en el MVP) con identidad externa `(gatewayId, sourceTransactionId)` y clave interna `BIGINT`. Los flags `E/I/R_IsSettled` desaparecen: Settled por ciclo se deriva de `SettlementTransaction` en un intento de batch pagado |
| `TransactionStatus`, `TransactionTypes`, `SettlementStatus`, `FeeType` | `TransactionStatus`, `Cycle`, `SettlementStatus`, `FeeType` | Catálogos conservados con sus valores; `TransactionTypes` pasa a llamarse `Cycle` (`cycle` E/I/R en todo el modelo); `TransactionStatus` deja de tener una fila artificial para la reserva: R no es un estado; `FeeType` gana `allowsFreeAmount` |
| `MatchingSheets`, `MatchingSummarySheets`, `MatchingColumns`, `MatchingRowsIgnore`, `MatchingTransactionStatus` | `MatchingRuleSet`, `MatchingSheetRule`, `MatchingColumnRule`, `MatchingRowIgnoreRule`, `MatchingStatusAlias` | Las reglas de hoja y de filas a ignorar eran globales; pasan a agruparse en conjuntos por proveedor (`MatchingRuleSet`) a los que se enlaza cada cuenta, con reglas globales (`ruleSetId NULL`) como fallback. `MatchingSummarySheets` se funde en `MatchingSheetRule.kind` |
| `FoundFileGroups`, `FoundFiles`, `FoundSheets`, `FoundTransactions` | `Import`, `ImportFile`, `ImportSheet`, `ImportRow` + `ImportSheetColumnMap` | Misma cadena. `Import` gana estado explícito (`uploaded → mapped → analyzed → validated → processed`, o `cancelled`). `ImportSheetColumnMap` es nueva: el pareo **confirmado por el analista**, distinto de la regla que lo propuso. `ImportRow` conserva `rawData` y gana `transactionId` resuelto, `amount`, `currency` y `txnDate` opcionales |
| `ValidationMissing`, `ValidationDuplicates`, `ValidationMismatch` (pantalla) + `SettlementTransactionMissing/Duplicate/Collision` (logs persistentes) | `ValidationRun`, `ValidationResult`, `ValidationIssue`, `ConflictOccurrence` | Seis tablas se unifican: una corrida por import, un resultado por validación, un hallazgo por caso y **N apariciones** por hallazgo (el sistema actual solo admitía dos). Cada hallazgo es persistente o resuelto, con el batch que lo resolvió; cada aparición lleva su inclusión en el settlement, por defecto y tras acción humana opcional |
| `SettlementBatches` (57 columnas, 40 de ellas `money`) | `SettlementBatch` + `SettlementBatchTotal` + `SettlementBatchBrandTotal` | Los totales por tipo y por marca pasan de columnas a filas. El batch gana `attemptNo`, estado (`processed` / `paid` / `undone`), quién aprobó, y rangos de fechas APP/DEC/I/R; deshacer conserva la fila |
| — | `SettlementBatchFee` | Nueva: fees no transaccionales aplicados a un batch (preestablecidos con importe ajustable, o de importe libre). Hoy se pierden en `otherFee` |
| `SettlementTransactionLog` | `SettlementTransaction` + `SettlementTransactionFee` | Se conserva y gana importe, fecha de evento, reserva retenida / liberada / liberada anticipadamente por chargeback y política aplicada por movimiento; los fees pasan a un detalle 1:N con la configuración aplicada. Un movimiento por fila de origen del batch `(batchId, sheetId, rowNo)` |
| `FeeAccount` + `UQ (feeTypeId, accountId)` | `Fee` + `FeeHistory` | El `UNIQUE` impedía vigencias sucesivas del mismo fee; se sustituye por **no solapamiento de vigencias** por tipo y cuenta. Todo cambio queda en `FeeHistory` |
| `Users` (solo nombre) | `User`, `Role`, `RolePermission`, `UserMerchant` | Autenticación real, permisos por acción, alcance y merchants visibles por usuario |
| `ErrorLog` | `ImportError` | Igual, ligado al archivo |
| — | `AuditLog` | Nueva: aprobación de batch, pago, deshacer, acciones sobre hallazgos, cambios de configuración |
| `FeesTemp`, `Settings` | se eliminan | Tabla de trabajo temporal y configuración clave-valor que en el desarrollo propuesto vive en la cuenta o el canal |
| Tipos `money`, `datetime`, `uniqueidentifier` | `DECIMAL(19,4)`, `datetime2`, `uniqueidentifier` | `money` redondea en operaciones intermedias y no es portable; `DECIMAL(19,4)` tiene el mismo rango y precisión sin esos problemas. Los `uniqueidentifier` se mantienen donde el sistema actual los usa, con `int identity` en tablas de alto volumen |

### 3.1. Diagrama del modelo de datos

Para que se lea, el modelo se presenta en cinco diagramas por área; comparten las entidades que aparecen en más de uno. Tipos en notación SQL Server; `PK`, `FK` y `UK` (única) en la columna de claves. Mermaid no admite comas en los tipos: `decimal(19_4)` representa `DECIMAL(19,4)` y `decimal(9_6)`, `DECIMAL(9,6)`. Las restricciones compuestas (por ejemplo `UNIQUE (gatewayId, sourceTransactionId)`) se describen en 3.2.

**Catálogo y fees**

```mermaid
erDiagram
    Gateway ||--o{ Channel : "origina"
    Merchant ||--o{ Provider : "tiene"
    Provider ||--o{ Channel : "tiene"
    Provider ||--o{ Account : "tiene"
    Account ||--o{ AccountChannel : "asocia"
    Channel ||--o{ AccountChannel : "asociado a"
    Account ||--o{ Fee : "aplica"
    FeeType ||--o{ Fee : "tipifica"
    Fee ||--o{ FeeHistory : "registra"
    User ||--o{ FeeHistory : "hace"

    Gateway {
        int gatewayId PK
        varchar(50) name UK
        varchar(10) idFormat
    }
    Merchant {
        int merchantId PK
        varchar(100) name UK
        bit isActive
    }
    Provider {
        int providerId PK
        int merchantId FK
        varchar(100) name
        bit isActive
    }
    Channel {
        int channelId PK
        int gatewayId FK
        int providerId FK
        varchar(25) name
        bit isActive
        int settlementTermDays
        decimal(9_6) rollingReservePct
        int rollingReserveDays
    }
    Account {
        uniqueidentifier accountId PK
        int providerId FK
        varchar(50) name UK
        varchar(30) chargebackReservePolicy
        decimal(19_4) rollingReserveCapAmt
        bit isActive
        datetime2 createdAt
        int createdByUserId FK
    }
    AccountChannel {
        uniqueidentifier accountId PK, FK
        int channelId PK, FK
        bit isPrimary
        datetime2 assignedAt
        uniqueidentifier assignedInBatchId FK
        int assignedByUserId FK
    }
    FeeType {
        int feeTypeId PK
        varchar(50) code UK
        varchar(50) title
        bit isTransactional
        bit allowsFreeAmount
        int appliesToStatusId FK
    }
    Fee {
        uniqueidentifier feeId PK
        uniqueidentifier accountId FK
        int feeTypeId FK
        decimal(19_4) fixedAmount
        decimal(9_6) percentage
        decimal(9_6) conditionalPercentage
        decimal(19_4) conditionThresholdAmt
        decimal(19_4) brandFixedAmount
        decimal(9_6) brandPercentage
        date startDate
        date endDate
        varchar(100) description
        datetime2 createdAt
        int createdByUserId FK
    }
    FeeHistory {
        int historyId PK
        uniqueidentifier feeId FK
        int changedByUserId FK
        datetime2 changedAt
        varchar(10) action
        nvarchar(max) beforeJson
        nvarchar(max) afterJson
        nvarchar(500) reason
    }
    User {
        int userId PK
        varchar(50) userName UK
    }
```

**Reglas de pareo, usuarios y roles**

```mermaid
erDiagram
    Provider ||--o{ MatchingRuleSet : "define"
    MatchingRuleSet o|--o{ Account : "enlaza"
    MatchingRuleSet ||--o{ MatchingSheetRule : "agrupa"
    MatchingRuleSet ||--o{ MatchingColumnRule : "agrupa"
    MatchingRuleSet ||--o{ MatchingRowIgnoreRule : "agrupa"
    TransactionStatus o|--o{ MatchingSheetRule : "asigna estado"
    Cycle ||--o{ MatchingSheetRule : "asigna ciclo"
    TransactionStatus ||--o{ MatchingStatusAlias : "traduce"
    Role ||--o{ User : "tiene"
    Role ||--o{ RolePermission : "concede"
    User ||--o{ UserMerchant : "ve"
    Merchant ||--o{ UserMerchant : "visible para"

    Account {
        uniqueidentifier accountId PK
        varchar(50) name UK
        int matchingRuleSetId FK
    }
    Provider {
        int providerId PK
        varchar(100) name
    }
    MatchingRuleSet {
        int ruleSetId PK
        int providerId FK
        varchar(80) name
        bit isActive
    }
    Merchant {
        int merchantId PK
        varchar(100) name UK
    }
    MatchingSheetRule {
        int ruleId PK
        int ruleSetId FK
        nvarchar(128) sheetNamePattern
        char(1) cycle FK
        int statusId FK
        varchar(20) kind
        int priority
    }
    MatchingColumnRule {
        int ruleId PK
        int ruleSetId FK
        nvarchar(128) sheetNamePattern
        nvarchar(100) sourceColumnPattern
        varchar(20) targetField
        int priority
    }
    MatchingRowIgnoreRule {
        int ruleId PK
        int ruleSetId FK
        nvarchar(100) pattern
        bit isRegex
    }
    MatchingStatusAlias {
        nvarchar(50) alias PK
        int statusId FK
        bit excludeAmount
    }
    TransactionStatus {
        int statusId PK
        varchar(50) name UK
        char(1) cycle FK
    }
    Cycle {
        char(1) cycle PK
        varchar(50) name
    }
    User {
        int userId PK
        varchar(50) userName UK
        varchar(254) email UK
        varchar(255) passwordHash
        int roleId FK
        varchar(10) merchantScope
        bit isActive
        datetime2 createdAt
    }
    Role {
        int roleId PK
        varchar(30) name UK
    }
    RolePermission {
        int roleId PK, FK
        varchar(40) permissionCode PK
    }
    UserMerchant {
        int userId PK, FK
        int merchantId PK, FK
    }
```

**Transacciones propias e importación**

```mermaid
erDiagram
    Account ||--o{ Import : "recibe"
    User ||--o{ Import : "crea"
    Import ||--|{ ImportFile : "contiene"
    ImportFile ||--|{ ImportSheet : "contiene"
    ImportSheet ||--o{ ImportSheetColumnMap : "pareo confirmado"
    ImportSheet ||--o{ ImportRow : "contiene"
    ImportFile ||--o{ ImportError : "registra"
    Transaction o|--o{ ImportRow : "se asocia a"
    TransactionStatus ||--o{ ImportRow : "estado leído"
    TransactionStatus ||--o{ ImportSheet : "estado de la hoja"
    TransactionStatus ||--o{ Transaction : "estado actual"
    Cycle ||--o{ TransactionStatus : "clasifica"
    Gateway ||--o{ Transaction : "procesa"
    Merchant ||--o{ Transaction : "pertenece"
    Provider ||--o{ Transaction : "enruta por"
    Channel ||--o{ Transaction : "canal"

    Transaction {
        bigint transactionId PK
        varchar(36) sourceTransactionId
        int gatewayId FK
        int merchantId FK
        int providerId FK
        int channelId FK
        varchar(50) orderId
        decimal(19_4) amount
        char(3) currency
        varchar(20) cardBrand
        int statusId FK
        datetime2 transactionDate
        datetime2 lastStatusChangedAt
        decimal(9_6) appliedReservePct
    }
    Cycle {
        char(1) cycle PK
        varchar(50) name
    }
    Channel {
        int channelId PK
        int gatewayId FK
        int providerId FK
        varchar(25) name
        int settlementTermDays
        decimal(9_6) rollingReservePct
        int rollingReserveDays
    }
    Import {
        uniqueidentifier importId PK
        uniqueidentifier accountId FK
        int createdByUserId FK
        datetime2 createdAt
        varchar(20) status
        datetime2 analyzedAt
        int rowsTotal
        int rowsMatched
        int rowsUnmatched
        uniqueidentifier currentBatchId FK
    }
    ImportFile {
        uniqueidentifier fileId PK
        uniqueidentifier importId FK
        nvarchar(255) fileName
        nvarchar(500) storagePath
        bigint sizeBytes
        char(64) sha256
        datetime2 uploadedAt
        bit ignore
    }
    ImportSheet {
        uniqueidentifier sheetId PK
        uniqueidentifier fileId FK
        nvarchar(128) sheetName
        char(1) cycle FK
        int statusId FK
        varchar(20) kind
        int rowCount
        bit mappingConfirmed
        int sheetIndex
    }
    ImportSheetColumnMap {
        uniqueidentifier sheetId PK, FK
        nvarchar(100) sourceColumn PK
        varchar(20) targetField
    }
    ImportRow {
        uniqueidentifier sheetId PK, FK
        int rowNo PK
        nvarchar(100) transactionIdRaw
        bigint transactionId FK
        int gatewayId FK
        nvarchar(50) statusRaw
        int statusId FK
        char(1) cycle FK
        decimal(19_4) amount
        char(3) currency
        datetime2 txnDate
        nvarchar(max) rawData
        bit ignore
        varchar(20) matchResult
    }
    ImportError {
        int errorId PK
        uniqueidentifier fileId FK
        nvarchar(max) message
        datetime2 loggedAt
    }
```

**Validaciones e incidencias**

```mermaid
erDiagram
    Import ||--o{ ValidationRun : "se valida en"
    User ||--o{ ValidationRun : "ejecuta"
    ValidationRun ||--|{ ValidationResult : "8 resultados"
    ValidationResult ||--o{ ValidationIssue : "hallazgos"
    ValidationIssue ||--o{ ConflictOccurrence : "apariciones"
    User o|--o{ ValidationIssue : "resuelve"
    User o|--o{ ConflictOccurrence : "cambia inclusión"
    SettlementBatch o|--o{ ConflictOccurrence : "origen histórico"
    SettlementBatch o|--o{ ValidationIssue : "resuelto en"

    ValidationRun {
        uniqueidentifier runId PK
        uniqueidentifier importId FK
        int ranByUserId FK
        datetime2 ranAt
        datetime2 dateMinApp
        datetime2 dateMaxApp
        datetime2 dateMinDec
        datetime2 dateMaxDec
        datetime2 dateMinI
        datetime2 dateMaxI
        datetime2 dateMinR
        datetime2 dateMaxR
        int pendingInRangeCount
        int undatedAdjustmentCount
        int undatedCandidateCount
        bit isSuperseded
    }
    ValidationResult {
        int resultId PK
        uniqueidentifier runId FK
        varchar(40) validationCode
        varchar(20) outcome
        int issueCount
    }
    ValidationIssue {
        int issueId PK
        int resultId FK
        varchar(30) issueType
        varchar(30) scope
        bit blocking
        varchar(36) transactionIdRaw
        bigint transactionId FK
        char(1) cycle
        int statusId FK
        varchar(30) missingType
        datetime2 relevantDate
        uniqueidentifier detectedInBatchId FK
        nvarchar(max) detailJson
        varchar(20) resolutionStatus
        uniqueidentifier resolvedInBatchId FK
        datetime2 resolvedAt
        int resolvedByUserId FK
        nvarchar(500) resolutionNote
    }
    ConflictOccurrence {
        bigint occurrenceId PK
        int issueId FK
        varchar(20) sourceType
        uniqueidentifier batchId FK
        uniqueidentifier fileId FK
        uniqueidentifier sheetId FK
        int rowNo
        int statusId FK
        bit includeInSettlement
        bit defaultIncluded
        int changedByUserId FK
        datetime2 changedAt
    }
```

**Settlement**

```mermaid
erDiagram
    Account ||--o{ SettlementBatch : "procesa"
    Import ||--o{ SettlementBatch : "intentos"
    User ||--o{ SettlementBatch : "aprueba"
    SettlementBatch ||--|{ SettlementTransaction : "incluye"
    SettlementBatch ||--|{ SettlementBatchTotal : "totales por tipo"
    SettlementBatch ||--o{ SettlementBatchBrandTotal : "totales por marca"
    SettlementBatch ||--o{ SettlementBatchFee : "fees por batch"
    FeeType ||--o{ SettlementBatchFee : "tipifica"
    SettlementBatch ||--o{ AccountChannel : "asocia canales"
    Transaction ||--o{ SettlementTransaction : "se procesa como"
    Cycle ||--o{ SettlementTransaction : "ciclo"
    SettlementStatus ||--o{ SettlementTransaction : "estado"
    SettlementTransaction ||--o{ SettlementTransactionFee : "fees aplicados"
    Fee ||--o{ SettlementTransactionFee : "configuración"
    User ||--o{ AuditLog : "genera"

    SettlementBatch {
        uniqueidentifier batchId PK
        uniqueidentifier accountId FK
        int batchNo
        int attemptNo
        uniqueidentifier importId FK
        varchar(20) status
        int approvedByUserId FK
        datetime2 processedAt
        date settlementDate
        datetime2 paidAt
        int paidByUserId FK
        datetime2 undoneAt
        int undoneByUserId FK
        nvarchar(500) undoReason
        datetime2 dateMinApp
        datetime2 dateMaxApp
        datetime2 dateMinDec
        datetime2 dateMaxDec
        datetime2 dateMinI
        datetime2 dateMaxI
        datetime2 dateMinR
        datetime2 dateMaxR
        decimal(19_4) mdrAmt
        decimal(9_6) mdrRate
        decimal(19_4) otherFeeAmt
        decimal(19_4) reserveHeldAmt
        decimal(19_4) reserveReleasedAmt
        decimal(19_4) amountPayable
        varchar(100) channels
    }
    SettlementBatchTotal {
        uniqueidentifier batchId PK, FK
        varchar(20) category PK
        int qty
        decimal(19_4) amount
        decimal(19_4) feeAmount
        decimal(9_6) feeRate
    }
    SettlementBatchBrandTotal {
        uniqueidentifier batchId PK, FK
        varchar(20) cardBrand PK
        int qty
        decimal(19_4) amount
    }
    SettlementBatchFee {
        int batchFeeId PK
        uniqueidentifier batchId FK
        int feeTypeId FK
        uniqueidentifier feeId FK
        decimal(19_4) amount
        nvarchar(200) description
        int enteredByUserId FK
    }
    AccountChannel {
        uniqueidentifier accountId PK, FK
        int channelId PK, FK
        bit isPrimary
        uniqueidentifier assignedInBatchId FK
    }
    FeeType {
        int feeTypeId PK
        varchar(50) code UK
    }
    SettlementTransaction {
        bigint settlementTxnId PK
        uniqueidentifier batchId FK
        bigint transactionId FK
        char(1) cycle FK
        int statusId FK
        int settlementStatusId FK
        int roundNo
        uniqueidentifier sheetId
        int rowNo
        decimal(19_4) amount
        bit excludeAmount
        decimal(19_4) feeAmount
        datetime2 eventDate
        nvarchar(max) reservePolicySnapshot
        decimal(9_6) appliedReservePct
        int reserveDaysUsed
        datetime2 expectedReserveReleaseAt
        decimal(19_4) reserveEarlyReleasedAmt
        decimal(19_4) reserveHeldAmt
        decimal(19_4) reserveReleasedAmt
    }
    SettlementTransactionFee {
        bigint appliedFeeId PK
        bigint settlementTxnId FK
        uniqueidentifier feeId FK
        int feeTypeId FK
        datetime2 eventDate
        decimal(19_4) amountUsd
        nvarchar(max) configurationSnapshot
    }
    SettlementStatus {
        int settlementStatusId PK
        varchar(50) name UK
    }
    AuditLog {
        bigint auditId PK
        int userId FK
        varchar(40) action
        varchar(40) entity
        varchar(64) entityId
        datetime2 at
        nvarchar(max) detailJson
    }
```

### 3.2. Descripción de entidades principales

Convenciones: todas las tablas llevan `createdAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()` y, las que se editan, `updatedAt`; se omiten por brevedad. Los importes son `DECIMAL(19,4)`; los porcentajes, `DECIMAL(9,6)` como fracción (0.025000 = 2,5 %); las fechas, `datetime2` o `date`. Los `uniqueidentifier` se generan en la aplicación. Se listan las entidades del flujo principal con detalle completo y las de apoyo de forma resumida.

**Fechas y zona horaria.** Hay dos clases de fecha y no se mezclan. Las **fechas de negocio** (`Transaction.transactionDate` y `lastStatusChangedAt`, los rangos `dateMin/Max*` de `ValidationRun` y `SettlementBatch`, `ValidationIssue.relevantDate`, `ImportRow.txnDate`, `SettlementTransaction.eventDate` y `expectedReserveReleaseAt`, `SettlementTransactionFee.eventDate` y las demás fechas de batch, como `settlementDate`) son hora de pared de America/New_York, tal como las entrega el gateway principal (comprobado contra el gateway real), y se guardan sin zona. Las **fechas de auditoría** (`createdAt`, `updatedAt`, `runAt`, `changedAt`, `resolvedAt` y la fecha de revisión que queda en `AuditLog`) son instantes UTC reales. El API serializa todas en ISO 8601 con `Z`, pero en las fechas de negocio esa `Z` es solo transporte: no indica que la hora esté en UTC. Cambiar esa serialización es la deuda registrada en el issue #48. Excepción: las columnas que son solo día (`date`: `SettlementBatch.settlementDate`, `Fee.startDate` y `endDate`, y el parámetro `asOf`) viajan como `YYYY-MM-DD`, sin hora ni `Z`.

#### Catálogo

**Gateway → Merchant → Provider → Channel** — la jerarquía que viene de los gateways, de solo lectura para la aplicación (en el MVP la carga el seed; en producción, un job desde los gateways). `Gateway` (`gatewayId`, `name`, `idFormat` ∈ {`numeric`, `uuid`} — define cómo se normaliza `sourceTransactionId` antes de guardarlo o cruzarlo); `Merchant` (`merchantId`, `name`, `isActive`); `Provider` (`providerId`, `merchantId`, `name`, `isActive`) — un mismo proveedor usado por dos merchants llega como dos registros; `Channel` (`channelId`, `gatewayId`, `providerId`, `name`, `isActive`) — el canal (RAM) por el que se procesan las transacciones, con sus parámetros: `settlementTermDays INT NOT NULL CHECK > 0`, `rollingReservePct DECIMAL(9,6) NOT NULL CHECK BETWEEN 0 AND 1`, `rollingReserveDays INT NOT NULL CHECK >= 0` (normalmente 180, excepcionalmente 120, contados desde la creación de la transacción). El porcentaje a usar en el cálculo es el aplicado a la transacción, no el actual del canal. Aquí se detecta un proveedor o canal nuevo: un proveedor sin cuentas, o un canal con transacciones y sin fila en `AccountChannel` (*not assigned yet*).

**Account** — cuenta de un proveedor; es la unidad de reconciliación y la única entidad exclusiva del Recon Tool. Agrupa canales (posiblemente de varios gateways) para llevar contabilidades separadas.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| accountId | uniqueidentifier | PK | Identificador (se conserva el del sistema actual) |
| providerId | int | FK → Provider, NOT NULL | Proveedor que envía los archivos; el merchant se deriva de él; el gateway se identifica en cada canal y transacción |
| name | varchar(50) | UNIQUE, NOT NULL | Nombre de la cuenta (`UC_Account` en el sistema actual) |
| chargebackReservePolicy | varchar(30) | NOT NULL, CHECK | `hold_until_term` (la reserva sigue retenida hasta el plazo y se libera en R) / `release_on_chargeback` (se libera de inmediato al registrarse el chargeback) |
| rollingReserveCapAmt | decimal(19,4) | NULL | Tope de reserva retenida, si el proveedor lo aplica |
| matchingRuleSetId | int | FK → MatchingRuleSet, NULL | Conjunto de reglas de pareo del proveedor al que se enlaza la cuenta; NULL = solo reglas globales. Cambiable desde Account Detail, con efecto en el siguiente import |
| isActive | bit | NOT NULL DEFAULT 1 | Las cuentas se cierran, no se borran |
| createdByUserId | int | FK → User | Quién la creó |

Relaciones: 1:N con AccountChannel, Fee, Import, SettlementBatch; N:1 opcional con MatchingRuleSet. Creación: `POST /providers/{id}/accounts` admite `copyFeesFromAccountId` (otra cuenta del mismo proveedor; copia solo sus fees activos, cada uno con `startDate NULL` y `endDate NULL`, y lo registra en el historial y en la auditoría) y `matchingRuleSetId`.

**AccountChannel** — asociación de cuenta y canal para atribuir pendientes una sola vez; no es un historial de reasignaciones.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| accountId, channelId | | PK compuesta, FK | |
| isPrimary | bit | NOT NULL | Cuenta principal del canal. Índice único filtrado `(channelId) WHERE isPrimary = 1`: una sola principal por canal |
| assignedAt | datetime2 | NOT NULL | Cuándo se asoció |
| assignedInBatchId | uniqueidentifier | FK → SettlementBatch, NULL | Batch cuyo procesamiento creó la asociación |
| assignedByUserId | int | FK → User | Quién aprobó ese batch |

Reglas: la asociación se crea al procesar el primer batch de la cuenta que incluye transacciones del canal (con aviso previo en el análisis). La **principal es la última cuenta que procesó un settlement con ese canal**: al procesar, `isPrimary` pasa a la cuenta del batch y se retira de la anterior, y cada canal asociado deja una entrada `account_channel.assign` en `AuditLog` (batch, `new_primary` o `primary_moved_from`, cuenta anterior). Los pendientes del canal (faltantes, no reconciliados, reconciliados pendientes de pago) se reportan solo en la cuenta principal. Los movimientos ya procesados permanecen en su batch y cuenta. Deshacer un batch no revierte la cuenta principal.

#### Fees

**Fee** — un fee vigente para una cuenta y un tipo. Si `FeeType.isTransactional = 1` el motor lo aplica automáticamente por movimiento; si no, es el monto preestablecido que el analista agrega al batch (ajustable) en Settlement Review.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| feeId | uniqueidentifier | PK | |
| accountId | uniqueidentifier | FK → Account, NOT NULL | |
| feeTypeId | int | FK → FeeType, NOT NULL | Tipo (aprobada, declinada, chargeback, refund, RDR, chargeback > 1 %, mensual, MDR…) |
| fixedAmount | decimal(19,4) | NULL | Monto fijo por movimiento o por batch |
| percentage | decimal(9,6) | NULL | Porcentaje sobre el monto |
| conditionalPercentage | decimal(9,6) | NULL | Porcentaje alternativo cuando se cumple la condición |
| conditionThresholdAmt | decimal(19,4) | NULL | Umbral de la condición (en el sistema actual estaba implícito en el procedimiento) |
| brandFixedAmount, brandPercentage | decimal | NULL | Variante por marca de tarjeta (`br_*` en el sistema actual) |
| startDate | date | NULL | Inicio de vigencia; NULL = desde siempre (−∞). Se muestra como "always", nunca en blanco |
| endDate | date | NULL | Fin de vigencia; NULL = sin fin (+∞) |
| description | varchar(100) | NULL | |
| createdByUserId | int | FK → User | |

Restricciones: `CHECK (fixedAmount IS NOT NULL OR percentage IS NOT NULL)`; `CHECK (startDate IS NULL OR endDate IS NULL OR endDate >= startDate)`; **no solapamiento**: para una misma (`accountId`, `feeTypeId`) no pueden existir dos filas cuyas vigencias se intersequen, evaluando los NULL como centinelas: dos fees A y B se solapan si `COALESCE(A.startDate,'0001-01-01') <= COALESCE(B.endDate,'9999-12-31') AND COALESCE(B.startDate,'0001-01-01') <= COALESCE(A.endDate,'9999-12-31')` (dos fees `NULL…NULL` del mismo tipo se solapan). SQL Server no lo expresa como constraint declarativa; se implementa en el caso de uso (transacción con bloqueo por cuenta) y se respalda con un trigger `AFTER INSERT, UPDATE` que rechaza la operación. Sustituye al `UNIQUE (feeTypeId, accountId)` del sistema actual. Selección del fee vigente para un movimiento con fecha de evento `d`: `(startDate IS NULL OR startDate <= d) AND (endDate IS NULL OR endDate >= d)`. Los NULL se guardan como tales (no como fechas centinela) para no contaminar informes y exports. Los fees no se eliminan: para retirar uno se le pone `endDate`; cambiar un fee cierra el vigente con `endDate = nuevo startDate − 1 día` y abre el nuevo, y el primero de la cadena puede tener `startDate NULL`. Un ajuste sin fecha de evento (`eventDate NULL`, advertencia `undated_adjustment`) no tiene día con que elegir: recibe el fee de su tipo solo si el único fee de ese tipo en la cuenta es `NULL…NULL`; si no, se queda sin fee de ese tipo y la advertencia lleva `feeSkipped: true` (decisión P6b del gate de `settlement-process`). Si la cuenta no tiene ningún fee del tipo, `feeSkipped` es `false`: no hay fee que saltar.

**FeeHistory** — una fila por cambio: `feeId`, `changedByUserId`, `changedAt`, `action` (`created` / `updated` / `closed`), `beforeJson` y `afterJson` con la fila completa antes y después, `reason`. Permite auditar un summary contra el fee vigente a la fecha del evento. **FeeType** — catálogo conservado (`feeTypeId`, `code`, `title`, `isTransactional`, `appliesToStatusId`) más `allowsFreeAmount` para las categorías de importe libre e `isActive`; `GET /fee-types` devuelve solo los tipos activos. El catálogo no transaccional se siembra con los 21 valores de la lista `Non-Transactional Fees` de la plantilla (Annual Fee, Bram Fine, Chargeback Assessment Fee, Chargeback Order Deduction, Chargeback over 1 %/2 %/3 %, Chargeback Reversed, Cross Border Fee, Customer Service Fee, Monthly Fee, Rebate 2 %/3 %, Release of Frozen Funds, Remittance Charges, Service Fee, Settlement Fee, Setup Fee, Special Adjustment, Special Deduction, Wire Fee).

#### Reglas de pareo

**MatchingRuleSet** — conjunto de reglas de un proveedor (`ruleSetId`, `providerId`, `name` UNIQUE por proveedor, `isActive`); agrupa las reglas de hoja, columna y filas a ignorar, y es a lo que se enlaza cada cuenta. Un proveedor suele tener un solo conjunto; se crea otro cuando el proveedor cambia de formato y no conviene migrar todas las cuentas a la vez. **MatchingSheetRule** — por conjunto: patrón de nombre de hoja → `cycle` (E, I o R) y `statusId` opcional (estado fijo por hoja: APP → E/`Successful`, DEC → E/`Declined`, CHB → I/`Chargeback`, REF → I/`Refund`, RDR → I/`RDR`; RR → R sin estado, porque la liberación de reserva no es un estado), `kind` ∈ {`transactions`, `batch_fees`, `ignore`} (una hoja de fees por batch, como `Other Fees`, no tiene ciclo ni estado) y `priority`, que decide cuando varios patrones coinciden. Reglas globales de la plantilla: `APP`→E/`Successful`, `DEC`→E/`Declined`, `CHB`→I/`Chargeback`, `REF`→I/`Refund`, `RDR`→I/`RDR`, `RR`→R, `Other Fees`→`batch_fees`, `Duplicate Corrections`, `CHB Alerts` y `Settings`→`ignore` con aviso. **MatchingColumnRule** — por conjunto y opcionalmente por hoja: patrón de nombre de columna → `targetField` ∈ {`transactionId`, `status`, `gateway`, `amount`, `currency`, `txnDate`, `feeType`, `providerRef`, `orderId`, `reference`} (globales de la plantilla: `ID`→`transactionId`, `Amount`→`amount`, `Currency`→`currency`, `Type of Fee`→`feeType`). `transactionId` debe quedar identificado para analizar; el estado debe poder resolverse por hoja o por columna. **MatchingRowIgnoreRule** — patrones de filas a saltar (totales, cabeceras repetidas), con `isRegex`; regla global: toda fila con `ID` vacío (la plantilla deja celdas `=SUM(...)` bajo la última fila). **MatchingStatusAlias** — global: texto de estado leído (`Successful`, `App`, `Chargeback`, `CHB 2`…) → `statusId`, más `excludeAmount bit` para los alias que se traducen a un estado pero no suman importe (`CHB 2` → `Chargeback` con `excludeAmount = 1`). Las reglas con `ruleSetId NULL` son las globales y actúan como valores por defecto; una regla del conjunto prevalece sobre la global con el mismo patrón, y una cuenta sin conjunto usa solo las globales. Las reglas de interpretación avanzada (estado derivado, filas relacionadas, fees informados) quedan para el roadmap y se añadirían como tablas nuevas sin modificar estas.

#### Transacciones propias

**Transaction** — la tabla contra la que se cruza el archivo del proveedor. Sintética en el MVP; en producción se alimentaría desde los gateways.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| transactionId | bigint | PK IDENTITY | Clave interna para relaciones |
| sourceTransactionId | varchar(36) | NOT NULL; `UNIQUE (gatewayId, sourceTransactionId)` | ID de origen **normalizado** según `Gateway.idFormat`: numérico de hasta 15 dígitos sin ceros a la izquierda, o UUID en minúsculas sin llaves. La identidad externa es el par con el gateway |
| gatewayId, merchantId, providerId | int | FK, NOT NULL | Contexto de enrutamiento |
| channelId | int | FK → Channel, NOT NULL | Canal (RAM) por el que se procesó |
| orderId | varchar(50) | NULL | Referencia del comercio |
| amount | decimal(19,4) | NOT NULL | Importe en USD suministrado por el gateway |
| currency | char(3) | NOT NULL, CHECK = 'USD' | Moneda de cálculo del sistema |
| cardBrand | varchar(20) | NULL | Para totales por marca |
| statusId | int | FK → TransactionStatus, NOT NULL | Estado actual |
| transactionDate | datetime2 | NOT NULL | Creación en el gateway; fecha para fees de la operación original |
| lastStatusChangedAt | datetime2 | NULL | Última fecha de cambio de estado recibida del gateway; no es un historial |
| appliedReservePct | decimal(9,6) | NOT NULL, CHECK 0–1 | Porcentaje de reserva aplicado a esta transacción, suministrado por el gateway |

Índices: (`gatewayId`, `sourceTransactionId`) único, (`providerId`, `transactionDate`), (`merchantId`, `transactionDate`), (`statusId`). Si el cruce numérico necesitara más velocidad, se añadiría una columna calculada persistida `sourceTransactionIdNum AS TRY_CONVERT(bigint, sourceTransactionId)` con su índice, sin cambiar el modelo. Settled por ciclo no vive aquí: se deriva de `SettlementTransaction` unido a un intento de batch pagado. La fuente conserva únicamente creación, estado actual y última fecha de cambio de estado; para un ajuste se usa esa última fecha solo si corresponde al evento reconciliado. No se reconstruyen rondas ni eventos sobrescritos: un ajuste que no pueda fecharse con esos datos genera advertencia de revisión. Cada procesamiento conserva estado, fecha utilizada, importe USD y fees como evidencia propia.

**TransactionStatus** (`statusId`, `name`, `cycle` E/I) y **Cycle** (`E` transacción, `I` ajuste, `R` reserva) — catálogos conservados; `TransactionTypes` pasa a llamarse `Cycle` y el término `cycle` se usa en todo el modelo y el código. Estados del gateway actual: `Successful`, `Declined` y `Pending` (ciclo natural E; `Pending` es el estado inicial o no actualizado y nunca se procesa), `Chargeback`, `Refund` y `RDR` (ciclo natural I). **El ciclo R no tiene estado propio**: la rolling reserve es la parte retenida de una `Successful` liquidada en E, y su liberación llega en la hoja RR, que `MatchingSheetRule` asigna al ciclo R sin estado. Por eso el ciclo con que se procesa una fila (`ImportRow.cycle`) viene de la hoja o de la regla de pareo, y `TransactionStatus.cycle` solo sirve para validar coherencia (una fila E con estado de ciclo I es un `non_recorded_adjustment` al revés y se advierte) y para derivar el ciclo cuando el estado llega por columna. Pendiente de validar contra el catálogo del nuevo gateway.

#### Importación

**Import** — un lote de archivos subidos para una cuenta; es el objeto que recorre el flujo principal. Equivale al *file group* del sistema actual: algunos proveedores envían las transacciones de un mismo settlement repartidas en varios archivos, y para nosotros forman un solo batch y una sola contabilidad.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| importId | uniqueidentifier | PK | |
| accountId | uniqueidentifier | FK → Account, NOT NULL | |
| createdByUserId | int | FK → User, NOT NULL | |
| status | varchar(20) | NOT NULL, CHECK | `uploaded` → `mapped` → `analyzed` → `validated` → `processed`; o `cancelled`. Deshacer el batch vigente devuelve el import a `analyzed` |
| analyzedAt | datetime2 | NULL | |
| rowsTotal, rowsMatched, rowsUnmatched | int | NULL | Resumen del cruce |
| currentBatchId | uniqueidentifier | FK → SettlementBatch, NULL | Intento vigente (no deshecho); los intentos históricos se consultan por `SettlementBatch.importId` |

**ImportFile** — `fileId`, `importId`, `fileName`, `storagePath`, `sizeBytes`, `sha256` (`UNIQUE (importId, sha256)`: el mismo archivo no se sube dos veces al mismo import), `uploadedAt`, `ignore`. **ImportSheet** — `sheetId`, `fileId`, `sheetName`, `cycle` (ciclo asignado a la hoja tras confirmar el pareo), `statusId` (estado fijo de la hoja, NULL en RR o cuando el estado viene por columna), `kind` (`transactions` / `batch_fees` / `ignore`), `rowCount`, `mappingConfirmed`, `sheetIndex` (posición de la hoja en su libro, 0 = primera, `CHECK (sheetIndex >= 0)`; la fija la subida y la usa la regla de primera aparición de 3.3; NULL en los imports subidos antes de la migración `0006`, que se ordenan por nombre de hoja). **ImportSheetColumnMap** — el pareo confirmado para esa hoja: PK (`sheetId`, `sourceColumn`) → `targetField`; es la fuente de verdad del parseo, no la regla.

**ImportRow** — una fila leída del archivo.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| sheetId, rowNo | | PK compuesta | Posición exacta en el archivo (para el detalle de apariciones) |
| transactionIdRaw | nvarchar(100) | NULL | Texto leído de la columna pareada como ID, tal cual (antes de normalizar); la columna se lee como texto para no perder dígitos |
| transactionId | bigint | FK → Transaction, NULL | Resuelto en el cruce por `(gatewayId, sourceTransactionId)` dentro de los gateways de los canales asociados a la cuenta (o de los canales de su proveedor si aún no tiene ninguno); NULL = sin asociar o ambigua |
| gatewayId | int | FK → Gateway, NULL | Gateway leído de la columna pareada como `gateway`, o elegido por el analista para resolver una ambigüedad |
| statusRaw, statusId | nvarchar(50), int | | Estado leído y estado resuelto vía alias o hoja; en una fila R es el estado actual de la transacción |
| cycle | char(1) | FK → Cycle, NOT NULL | Ciclo E / I / R con que se procesará la fila, heredado de la hoja o de la regla de pareo |
| amount, currency, txnDate | decimal, char(3), datetime2 | NULL | Solo si se parearon esas columnas; se comparan como advertencia |
| rawData | nvarchar(max) | NOT NULL, CHECK ISJSON | La fila completa original |
| ignore | bit | NOT NULL DEFAULT 0 | Marcada por regla o por el analista |
| matchResult | varchar(20) | NOT NULL | `matched` / `unmatched` / `ambiguous` / `ignored`. `ambiguous`: el ID normalizado existe en más de un gateway de la cuenta; las candidatas se guardan en `detailJson` y la fila no se procesa hasta resolverla |

Índices: (`transactionId`), (`sheetId`, `statusId`), (`transactionIdRaw`). Lectura de Excel: una celda numérica conserva como máximo 15 dígitos significativos; el lector toma la columna de ID como texto y, si detecta notación científica o pérdida de precisión, marca la fila para revisión en lugar de cruzarla.

#### Validaciones e incidencias

**ValidationRun** — una ejecución de las ocho validaciones sobre un import, con los rangos de fechas por ciclo (`dateMin/MaxApp`, `dateMin/MaxDec`, `dateMin/MaxI`, `dateMin/MaxR`) obtenidos de los movimientos asociados del batch según 3.3, `pendingInRangeCount` (transacciones en `Pending` dentro de los rangos, informativo), `undatedAdjustmentCount` (filas I del import sin fecha de cambio de estado, informativo) y `undatedCandidateCount` (candidatas I sin fecha de cambio de estado, que no se evalúan como faltantes; informativo). Los rangos alimentan las validaciones de faltantes. Una nueva corrida marca la anterior como superada (`isSuperseded = 1`) sin borrarla e invalida su revisión; las corridas se conservan. **Una sola corrida vigente por import**: índice único filtrado `UX_ValidationRun_current_import (importId) WHERE isSuperseded = 0`.

**ValidationResult** — ocho filas por corrida: `validationCode` ∈ {`provider_mismatch`, `non_recorded_adjustment`, `duplicate_in_batch`, `status_collision_in_batch`, `duplicate_across_batches`, `status_collision_across_batches`, `missing_previous_to_batch`, `missing_in_range`}, `outcome` ∈ {`passed`, `warning`, `blocked`, `not_applicable`, `not_implemented`} (derivado de los hallazgos, ver 3.3), `issueCount`; `UNIQUE (runId, validationCode)`. Las dos validaciones de faltantes producen hallazgos por ciclo (APP, DEC, I, R) dentro del mismo resultado, con `not_applicable` cuando ningún ciclo tiene rango.

**ValidationIssue** — un hallazgo lógico producido por una validación. Para duplicados y colisiones no guarda dos apariciones en columnas fijas: las apariciones viven en `ConflictOccurrence`, lo que permite representar 2, 3 o N filas sin cambiar el esquema.

| Atributo | Tipo | Descripción |
|---|---|---|
| issueId | int PK | |
| resultId | FK → ValidationResult | Validación que lo produjo |
| issueType | varchar(30) | `provider_mismatch`, `non_recorded_adjustment`, `status_mismatch`, `duplicate`, `collision`, `missing`. `status_mismatch` lo produce la validación `non_recorded_adjustment` (ver 3.3) |
| scope | varchar(30) | `in_batch`, `across_batches`, `previous_to_batch`, `in_range` o NULL según el tipo |
| blocking | bit | `provider_mismatch = 1`; todas las demás = 0 |
| transactionIdRaw, transactionId, cycle | | Movimiento afectado |
| statusId | FK → TransactionStatus, NULL | Estado esperado o reportado; especialmente útil para faltantes |
| missingType | varchar(30), NULL | Para faltantes: `previous_to_batch` / `in_range` |
| relevantDate | datetime2, NULL | Fecha utilizada para clasificar el faltante según su ciclo |
| detectedInBatchId | FK → SettlementBatch, NULL | Batch durante cuya validación se detectó |
| detailJson | nvarchar(max) | Datos complementarios |
| resolutionStatus | varchar(20) | `persistent` / `resolved`; el hallazgo no se elimina |
| resolvedInBatchId, resolvedAt | | Batch `processed` posterior que lo resolvió, y cuándo |
| resolvedByUserId, resolutionNote | | Cuando la resolución es una acción humana (p. ej. `non_recorded_adjustment` verificado en el gateway) |

**ConflictOccurrence** — una aparición concreta de un hallazgo de tipo duplicado o colisión. Sustituye el diseño del sistema actual de `fileId #1/#2`, `sheetId #1/#2`, `RowNo #1/#2` y estados emparejados.

| Atributo | Tipo | Descripción |
|---|---|---|
| occurrenceId | bigint PK identity | |
| issueId | FK → ValidationIssue | Hallazgo al que pertenece |
| sourceType | varchar(20) | `current_import` / `previous_batch` |
| batchId | FK → SettlementBatch, NULL | Batch histórico de origen cuando aplica |
| fileId, sheetId, rowNo | | Ubicación exacta cuando proviene de un import |
| statusId | FK → TransactionStatus, NULL | Estado de esta aparición; NULL cuando el estado de la fila no se pudo resolver (colisiona igualmente, ver 3.3) |
| includeInSettlement | bit | Si esta aparición participa en el procesamiento actual |
| defaultIncluded | bit | Valor asignado automáticamente antes de intervención humana |
| changedByUserId, changedAt | | Quién cambió la inclusión y cuándo (acción opcional, auditada) |

Reglas de inclusión por defecto: `duplicate + in_batch`, primera aparición incluida y posteriores excluidas; `duplicate + across_batches`, aparición actual excluida (la histórica se conserva como evidencia); `collision + in_batch`, todas las apariciones actuales incluidas; `collision + across_batches`, aparición actual incluida. El analista puede modificar `includeInSettlement`, incluso para incluir un duplicado detectado; es una decisión de negocio opcional y queda auditada. El hallazgo sigue existiendo aunque cambie la inclusión: detección y contabilización son conceptos distintos.

Casos particulares. **Faltantes** usan `ValidationIssue` sin apariciones: una transacción interna que debió reconciliarse según el rango de su ciclo (`missingType` y `relevantDate` conservan la clasificación); se registra una sola vez por proveedor, ciclo y transacción, permanece `persistent` hasta que se incluye en un batch `processed` posterior de cualquier cuenta del proveedor, momento en que pasa a `resolved` con `resolvedInBatchId` (no hace falta esperar al pago), y vuelve a `persistent` si ese batch se deshace. Al procesar solo se resuelven hallazgos de corridas vigentes (`isSuperseded = 0`); al deshacer no se reabren los resueltos a mano (`resolvedByUserId` no nulo). **`provider_mismatch`** es el único hallazgo bloqueante: el import se creó bajo un proveedor o cuenta incorrectos; no hay override, el analista cancela y procesa con el proveedor correcto; el hallazgo conserva la evidencia. **`non_recorded_adjustment`**: el proveedor reporta un movimiento I que el gateway todavía refleja como APP; el movimiento viene incluido por defecto y el analista puede excluirlo; `resolutionStatus` es independiente de la inclusión y pasa a `resolved` cuando alguien verifica o corrige el estado en el gateway, con auditoría. Un **`status_mismatch`** (fila E cuyo estado reportado contradice el del gateway) se resuelve a mano igual, con nota y auditoría; los demás tipos no se resuelven a mano (`422 issue_not_resolvable`).

#### Settlement

**SettlementBatch** — un intento de procesamiento de un import.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| batchId | uniqueidentifier | PK | |
| accountId | uniqueidentifier | FK, NOT NULL | |
| batchNo | int | NOT NULL, CHECK > 0; `UNIQUE (accountId, batchNo, attemptNo)` | Número oficial del proveedor; propuesto por el sistema, editable |
| attemptNo | int | NOT NULL, CHECK > 0 | Versión de procesamiento del número oficial |
| importId | uniqueidentifier | FK → Import, NOT NULL | Un import puede tener varios intentos históricos |
| status | varchar(20) | NOT NULL, CHECK | `processed` → `paid`; `undone` solo desde `processed`; retirar la marca de pago devuelve a `processed` con auditoría |
| approvedByUserId, processedAt | | NOT NULL | Quién aprobó el batch y cuándo |
| settlementDate | date | NULL | |
| paidAt, paidByUserId | | NULL | Marcar pagado / retirar la marca |
| undoneAt, undoneByUserId, undoReason | | NULL | Deshacer conserva la fila; el import vuelve a `analyzed` |
| dateMin/MaxApp, dateMin/MaxDec, dateMin/MaxI, dateMin/MaxR | datetime2 | NULL | Rangos de fechas por ciclo |
| mdrAmt | decimal(19,4) | NOT NULL DEFAULT 0 | Suma de los fees de tipo `MDR` de los movimientos (parte del fee de los depósitos) |
| mdrRate | decimal(9,6) | NULL | Porcentaje MDR si todos los movimientos usaron el mismo; NULL si no hay o varía |
| otherFeeAmt | decimal(19,4) | NOT NULL DEFAULT 0 | Suma de `SettlementBatchFee` |
| reserveHeldAmt, reserveReleasedAmt | decimal(19,4) | NOT NULL DEFAULT 0 | |
| amountPayable | decimal(19,4) | NOT NULL DEFAULT 0 | Resultado del summary |
| channels | varchar(100) | NULL | Canales incluidos |

Reglas de intentos: índices únicos filtrados por `status <> 'undone'` garantizan un solo intento vigente por (`accountId`, `batchNo`) y por `importId`. Tras deshacer, el siguiente intento incrementa `attemptNo` conservando el número oficial. La confirmación y el cambio de intento vigente son atómicos. Se recalculan las incidencias afectadas; no se revierte la cuenta principal; los exports históricos se identifican por intento.

**SettlementBatchFee** — fees no transaccionales aplicados al batch: `batchFeeId`, `batchId`, `feeTypeId` (FK), `feeId` (FK → Fee, NULL si es de importe libre), `amount`, `description`, `source` (`file` si llega prellenado de la hoja `Other Fees`, `manual` si lo añade el analista), `enteredByUserId`. La suma alimenta `SettlementBatch.otherFeeAmt` y se guardan en el orden en que el analista los confirma. Regla, validada en el caso de uso (cruza tablas, no es una `CHECK`): si `feeId IS NULL`, el tipo debe tener `allowsFreeAmount = 1`, **salvo** que sea un fee prellenado de `Other Fees` (`source = file`) de un tipo que el archivo trae (decisión del gate de `settlement-process`; el mantenimiento de tipos es el issue #60). Un importe libre añadido a mano exige descripción. Un preestablecido solo con porcentaje no se calcula: el analista escribe su importe. Los motivos de rechazo (`400 batch_fee_invalid`) y el día de referencia de la vigencia están en 4.3.

**SettlementBatchTotal** — PK (`batchId`, `category`) con `category` ∈ {`deposit`, `declined`, `chargeback`, `refund`, `rdr`}: `qty`, `amount`, `feeAmount`, `feeRate`. **SettlementBatchBrandTotal** — PK (`batchId`, `cardBrand`): `qty`, `amount`.

**SettlementTransaction** — un movimiento procesado en un ciclo dentro de un intento de batch.

| Atributo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| settlementTxnId | bigint | PK identity | |
| batchId | uniqueidentifier | FK, NOT NULL | |
| transactionId | bigint | FK → Transaction, NOT NULL | |
| cycle | char(1) | FK → Cycle, NOT NULL | Ciclo E / I / R |
| statusId | int | FK → TransactionStatus, NOT NULL | Estado de la transacción al procesarse (en R, el estado vigente de la `Successful` original) |
| settlementStatusId | int | FK → SettlementStatus, NOT NULL | El procesamiento siempre escribe `0` (`Unsettled`); Settled se deriva del intento pagado |
| roundNo | int | NULL | Ronda 1 / 2 (clasificación del escenario E–I) |
| sheetId, rowNo | | NULL | De qué fila del archivo salió |
| amount | decimal(19,4) | NOT NULL | Importe USD procesado en este ciclo, siempre positivo: el de la transacción en una aprobada y en un ajuste I (también un `RDR`, que descuenta como un Chargeback o un Refund); 0 en una declinada y en R |
| excludeAmount | bit | NOT NULL DEFAULT 0 | `CHB 2`: cuenta en `chargebackQty` y aplica fee de Chargeback, pero no suma a `chargebackAmt` |
| feeAmount | decimal(19,4) | NOT NULL | Total del detalle `SettlementTransactionFee` |
| eventDate | datetime2 | NULL | Fecha del evento, usada para vigencias de fees. E: creación de la transacción. I: la fecha que trae el proveedor en la fila (columna pareada como `txnDate`) si viene; si no, `lastStatusChangedAt` cuando el estado del gateway es el de la fila; si no, NULL con advertencia `undated_adjustment` (no se inventa). R: vencimiento de la reserva (creación + `rollingReserveDays`). La zona horaria de la fecha del proveedor no se conoce: se guarda tal cual, como fecha de negocio |
| appliedReservePct | decimal(9,6) | NOT NULL | Copia del porcentaje aplicado recibido en la transacción |
| reserveDaysUsed | int | NOT NULL | Plazo recibido de la configuración del canal |
| expectedReserveReleaseAt | datetime2 | NULL | Creación original + plazo del canal; llegar a esta fecha no confiere Settled |
| reservePolicySnapshot | nvarchar(max) | NULL, JSON | Política de reserva aplicada |
| reserveEarlyReleasedAmt | decimal(19,4) | NOT NULL DEFAULT 0 | Reserva liberada anticipadamente al registrarse el chargeback (`release_on_chargeback`), guardada en el movimiento I del chargeback; esa reserva ya no se espera en R. En la Entrega 2 vale 0 y la política solo queda registrada (issue #62, Entrega 3) |
| reserveHeldAmt, reserveReleasedAmt | decimal(19,4) | NOT NULL DEFAULT 0 | Reserva retenida (ciclo E) o liberada (ciclo R); la liberación referencia la misma `transactionId` que el movimiento E |

Restricción: un movimiento por **fila de origen** del batch, índice único filtrado `UX_SettlementTransaction_batch_row (batchId, sheetId, rowNo) WHERE sheetId IS NOT NULL`, y `CHECK` de que hoja y fila van juntas (migración `0007`). Un batch admite así varios movimientos de la misma transacción y ciclo: Refund + Chargeback, Chargeback + `CHB 2` o un duplicado incluido a mano; los movimientos históricos sin fila no entran en el índice. Settled de un movimiento en un ciclo exige una fila aquí cuyo intento de batch tenga `status = 'paid'`; reemplaza a los tres flags del sistema actual y admite el chargeback por diferencia. Importes, fees y reservas se calculan a 4 decimales; lo que da más (importe × porcentaje) se redondea mitad hacia arriba en el cuarto.

**SettlementTransactionFee** — detalle 1:N de fees por movimiento: `appliedFeeId BIGINT IDENTITY PK`, `settlementTxnId FK`, `feeId FK`, `feeTypeId FK`, `eventDate` (copia la del movimiento; NULL cuando el movimiento no tiene fecha, el caso de un ajuste sin fecha con fee `NULL…NULL`, migración `0008`), `amountUsd DECIMAL(19,4)` y `configurationSnapshot NVARCHAR(MAX)` con la configuración aplicada. El total se conserva en `SettlementTransaction.feeAmount`; las ediciones posteriores del catálogo no recalculan históricos.

**SettlementStatus** — catálogo conservado; el estado efectivo Settled exige un intento de batch pagado.

#### Acceso y auditoría

**User** (`userId`, `userName` UNIQUE, `email` UNIQUE, `passwordHash` Argon2, `roleId`, `merchantScope` ∈ {`assigned`, `all`} por defecto `assigned`, `isActive`), **Role** (`roleId`, `name`), **RolePermission** (PK `roleId`, `permissionCode` ∈ {`settlement.process`, `payment.process`, `account.manage`, `fee.manage`, `fee.view`, `reports.view`, `user.manage`}), **UserMerchant** (PK `userId`, `merchantId`). **AuditLog** — acciones que no quedan ya en otra tabla con autor y fecha: aprobación de batch con hallazgos (`import.review`) y su invalidación al re-ejecutar o cambiar una inclusión (`import.review.invalidate`), pago y retiro de pago, deshacer, cambios de inclusión y resoluciones, creación y edición de cuenta. El procesamiento escribe `settlement.process` (detalle: `importId`, `runId`, `batchNo`, `attemptNo`, movimientos por ciclo, `skipped`, `warnings`, número de fees por batch, `resolvedMissing`, `channelsAssigned` y `note`) y una entrada `account_channel.assign` por canal asociado. Cada descarga de un export escribe `settlement.export` (`entityType = SettlementBatch`, `entityId` = el intento; detalle: `type`, `fileName` y `rows`, las filas de datos sin cabecera, `null` en el summary): registra que el servidor entregó el archivo, no que el usuario lo guardó. Las acciones sobre el intento escriben, con `entityType = SettlementBatch` y `entityId` = el intento: `settlement.pay` (detalle: `importId`, `batchNo`, `attemptNo` y `reason: null`), `settlement.unpay` (los mismos, con `reason`, `previousPaidAt` y `previousPaidByUserId`, porque retirar el pago vacía esas columnas) y `settlement.undo` (los mismos, con `reason`, `reopenedMissingIssueIds` y `supersededRunId`). Hoy la vista del intento reconstruye `skipped`, `warnings` y `channelsAssigned` a partir de ese detalle: es una excepción a "acciones que no quedan ya en otra tabla", y llevarlos al batch es el issue #65.

### 3.3. Reglas de validación cerradas (cross-validation funcional)

La revisión contra los procedimientos reales del Recon Tool actual (`recon_validation_duplicates`, `recon_validation_mismatch`, `recon_validation_missing`, `recon_settlement_process`, `recon_batch_reset`) está cerrada. Estas reglas son parte del diseño y no deben reinterpretarse al implementar.

**Identidad y ciclos.** Identidad externa por `(gatewayId, sourceTransactionId)` normalizado; relaciones internas por `transactionId`. Tres ciclos (`cycle` E, I, R) que nunca se comparan entre sí. El ciclo de cada fila lo fija la hoja o la regla de pareo (`ImportRow.cycle`), no el estado. Estados del gateway actual y su ciclo natural: `Successful`, `Declined`, `Pending` → E (`Pending` nunca se procesa); `Chargeback`, `Refund`, `RDR` → I. R no tiene estado: es la liberación de la reserva retenida a una `Successful` ya procesada en E (hoja RR). Pendiente de validar el catálogo del nuevo gateway cuando entre al proceso.

**Duplicados y colisiones** (regla del sistema actual, conservada). Clave de comparación: `(transactionId, cycle)`. Mismo estado → `duplicate`; estados distintos → `collision`. Aplica dentro del batch y contra el histórico. Única excepción, y solo para archivos legacy con alias `CHB 2`: un `Chargeback` y un `CHB 2` del mismo movimiento no generan hallazgo (el alias se traduce a `Chargeback` con `excludeAmount = 1`); la plantilla actual no lo produce. Consecuencias ya confirmadas: Approved + Declined es colisión en E con advertencia; Refund + Chargeback es colisión en I con advertencia; el mismo ajuste con el mismo estado en dos batches es duplicado, con la aparición actual excluida e incluible a mano. Ningún par bloquea.

**Rondas.** Derivadas al procesar: ronda 1 si E e I van en el mismo batch, ronda 2 si la E está en un batch anterior vigente. No participan en la detección. CHB 2 no equivale a ronda 2.

**`non_recorded_adjustment`.** El estado que reporta el archivo no cuadra con el del gateway. La validación produce dos tipos de hallazgo sobre filas del proveedor de la cuenta:

| `issueType` | Ciclo | Cuándo |
|---|---|---|
| `non_recorded_adjustment` | I | Fila de ciclo I cuya transacción está en el gateway en un estado de ciclo natural E (`Pending`, `Successful`, `Declined`) |
| `status_mismatch` | E | Fila E que el archivo reporta `Declined` y el gateway tiene `Successful`, `Chargeback`, `Refund` o `RDR`; o fila E que el archivo reporta `Successful` y el gateway tiene `Declined` |

Una fila E con el gateway en `Pending` no se compara (ya cuenta en `pendingInRangeCount`). Una fila APP cuya transacción pasó después a `Chargeback`, `Refund` o `RDR` no es hallazgo: fue `Successful` al liquidarse (ronda 1 normal); tampoco una fila E con el gateway en estado de ciclo I. Ambos tipos son advertencias no bloqueantes, con la fila incluida por defecto, llevan el estado reportado y el del gateway, y se resuelven a mano tras verificar el gateway. El `issueCount` de la validación suma los dos tipos. `status_mismatch` convive con las colisiones: la colisión dice que el archivo trae dos estados del mismo movimiento; `status_mismatch`, cuál de ellos contradice al gateway. Sin ninguna fila asociada, de cualquier ciclo, el resultado es `not_applicable`.

**`provider_mismatch`.** La transacción asociada pertenece a otro proveedor que el de la cuenta del import. Es el único hallazgo bloqueante: no hay override; se cancela y se procesa bajo el proveedor correcto.

**Faltantes** (límites del sistema actual, conservados, con nombres nuevos).

| Ciclo | Rango del batch (sobre movimientos asociados) | Candidatas | Fecha comparada |
|---|---|---|---|
| APP | `Successful` del batch, por fecha de creación | Transacciones `Successful` del proveedor en los canales de la cuenta, no procesadas en E en un batch vigente | Creación |
| DEC | `Declined` del batch, **solo si el archivo trae declinadas** | Transacciones `Declined` del proveedor en los canales de la cuenta, no procesadas en E | Creación |
| I | Movimientos I del batch, por fecha del evento | Transacciones en estado de ciclo natural I, no procesadas en I | Cambio de estado |
| R | Filas R del batch (hoja RR), por fecha de vencimiento de la reserva (creación de la transacción original + `rollingReserveDays` de su canal) | Reservas retenidas: movimientos E procesados en un batch vigente con `reserveHeldAmt > 0`, sin `reserveEarlyReleasedAmt` por política y sin movimiento R procesado | Vencimiento (creación + `rollingReserveDays` del canal) |

Para cada ciclo con rango: candidata con fecha anterior al mínimo → `missing_previous_to_batch`; con fecha dentro de `[mínimo, máximo]` (inclusive) → `missing_in_range`; con fecha posterior al máximo → no se considera. Se excluyen las transacciones presentes en el batch, las ya procesadas en ese ciclo en un batch vigente de cualquier cuenta del proveedor, y las ya registradas como faltantes para ese proveedor y ciclo. `Pending` se excluye de los faltantes y se cuenta aparte en la corrida (`pendingInRangeCount`), de forma informativa. Un faltante se registra una vez, se resuelve al incluirse en un batch `processed` y vuelve a `persistent` si ese batch se deshace.

**Alcance del histórico.** Batches anteriores = intentos con `status <> 'undone'` de todas las cuentas del proveedor. El import en curso nunca cuenta como histórico.

**Reglas de detalle de las ocho validaciones** (revisión del change `validation-engine`, 2026-10-17).

- **Filas que forman cada rango.** APP: filas E asociadas cuya transacción no está `Declined` ni `Pending` en el gateway (una `Chargeback`, `Refund` o `RDR` nació `Successful`), por fecha de creación. DEC: filas E cuya transacción está `Declined` en el gateway, por fecha de creación; se lee el estado del gateway y no el de la fila, para que una aprobada reportada como declinada no adelante el rango. I: filas I cuya transacción tiene en el gateway el mismo estado que la fila, por fecha del último cambio de estado; las filas I sin esa fecha (incluida la de un `non_recorded_adjustment`) no aportan fecha y se cuentan aparte (`undatedAdjustmentCount`, informativo, no es hallazgo). R: filas R por fecha de vencimiento de la reserva (creación + `rollingReserveDays` de su canal). Una reserva retenida está vencida cuando esa fecha llega; las candidatas R se comparan por la misma fecha, así que una cuenta con canales de plazos distintos (180 y 120 días) no da faltantes falsos. El plazo es el vigente del canal (`Channel.rollingReserveDays`), no el aplicado al liquidar (`SettlementTransaction.reserveDaysUsed`, `expectedReserveReleaseAt`): el plazo de un canal no cambia con el tiempo, así que el vigente coincide con el aplicado. La carga de reservas retenidas filtra con el mismo cálculo, nunca con `expectedReserveReleaseAt`. Usar el plazo aplicado queda como deuda para la Entrega 3.
- **Filas de otro proveedor.** Una fila asociada a una transacción de otro proveedor solo produce `provider_mismatch`: no entra en las validaciones 2–8 ni en los rangos. Ese hallazgo copia lo que trae la fila (estado reportado, hoja y fila) y el `transactionId`; nunca el canal, la cuenta, el importe, la fecha ni el estado del gateway de la transacción ajena. El histórico de todas las cuentas del proveedor sí aparece, porque es del mismo merchant.
- **`not_applicable`.** `provider_mismatch`, `non_recorded_adjustment`, `duplicate_in_batch` y `status_collision_in_batch` solo cuando el import no tiene ninguna fila asociada, de ningún ciclo; las dos *across* cuando el proveedor no tiene ningún intento no deshecho; las dos de faltantes cuando ningún ciclo tiene rango.
- **Grupos de N apariciones en el batch.** Por clave `(transactionId, cycle)`, cada estado repetido produce un `duplicate` (primera aparición incluida, demás excluidas) y la presencia de estados distintos produce una `collision` con la primera aparición de cada estado, todas incluidas, para que ninguna aparición se cuente dos veces. En el ciclo R el estado no cuenta (la reserva no tiene estado): todas las apariciones R de una clave son el mismo movimiento, un `duplicate`, nunca una `collision`.
- **Contra batches anteriores.** Por clave, un `duplicate_across_batches` si alguna aparición histórica tiene el mismo estado que una actual (las actuales con ese estado, excluidas; las históricas, como evidencia) y un `status_collision_across_batches` si alguna tiene estado distinto (la actual, incluida). En el ciclo R el estado no cuenta: cualquier aparición R histórica hace duplicadas las actuales. La colisión lista también, como evidencia, los movimientos históricos compatibles con la actual (el `CHB 2` junto a su `Chargeback`). Las detecciones *in batch* y *across* son independientes; cómo se combinan las inclusiones de una fila presente en varios hallazgos lo decide el procesamiento (viñeta siguiente).
- **Inclusiones al procesar** (change `settlement-process`). Una fila asociada se procesa si **ninguna** de sus apariciones `current_import` de la corrida vigente la excluye: una fila en varios hallazgos se excluye si cualquiera de ellos la excluye, así que ningún movimiento se cuenta dos veces por defecto; una inclusión manual cuenta si la fila no está excluida en otro hallazgo. No se procesan, y se cuentan aparte por motivo (`skipped`), las filas ignoradas, sin asociar o ambiguas, las excluidas, las E o I con estado no resuelto y las cuyo propio estado es `Pending`. Una fila con otro estado cuya transacción está en `Pending` en el gateway **sí** se procesa, con el estado de la fila, como un desajuste APP/DEC que se corrige del lado del merchant; que la validación lo avise como `status_mismatch` es el issue #63. Una fila E cuyo propio estado es de ajuste (`Chargeback`, `Refund` o `RDR`) se procesa como depósito sin reserva: cualquier estado E distinto de `Declined` suma a `deposit`, solo una `Successful` retiene reserva, y lleva los fees transaccionales de su estado.
- **Inclusión manual de una aparición** (`PATCH /conflict-occurrences/{id}`, change `validation-runs`). Solo se cambian las apariciones `current_import` de la corrida vigente, con el import en `analyzed` o `validated` (en `validated` el import vuelve a `analyzed` y la revisión queda invalidada y auditada); una aparición `previous_batch` es evidencia de un batch ya procesado y no se edita. **Ciclo R:** la reserva no tiene estado y no se libera dos veces, así que un hallazgo tiene como máximo una aparición incluida y ninguna aparición del import actual se incluye si el hallazgo tiene una `previous_batch` (esa reserva ya se liberó en un batch anterior); incluir otra responde `409 occurrence_not_includable` y excluir siempre se admite (regla "Ciclo R sin estado" del change `validation-engine`). **Ciclos E e I:** incluir a mano un duplicado, en el batch o entre batches, está permitido y queda auditado con usuario y fecha. En los duplicados E entre batches, esa inclusión manual existe solo para procesar batches históricos: la regla de fondo es que un E no se paga dos veces, y cerrarla cuando ya no se procesen batches históricos es el issue #49.
- **Corridas, revisión y acciones del analista** (decisiones P1–P7 de la revisión del change `validation-runs`, 2026-10-18).
  - **P1. Validar de nuevo un import `validated`.** Se admite: la corrida nueva supera a la anterior, el import vuelve a `analyzed` y la revisión queda invalidada y auditada (`import.review.invalidate`, motivo `rerun`). `import_not_analyzed` queda para `uploaded`, `mapped`, `processed` y `cancelled`.
  - **P2. Qué apariciones se editan.** Solo las `current_import`. Una `previous_batch` es evidencia de un batch ya procesado: `409 occurrence_not_editable`.
  - **P3. Inclusión manual por ciclo.** R, como máximo una aparición incluida por hallazgo y ninguna si la reserva ya se liberó; I y E, permitida y auditada (viñeta anterior).
  - **P4. Cambiar una inclusión en `validated`.** Se admite: en la misma transacción el import vuelve a `analyzed`, la corrida se conserva y la revisión queda invalidada y auditada (motivo `inclusion_change`).
  - **P5. Resolver a mano.** Un `non_recorded_adjustment` o un `status_mismatch` de la corrida vigente, en cualquier estado del import, con nota y sin vuelta atrás (`409 issue_already_resolved`). No cambia ninguna inclusión, así que no invalida la revisión.
  - **P6. Lo hecho a mano no pasa a la corrida siguiente.** Cada corrida nace con las inclusiones por defecto y los hallazgos `persistent`; lo anterior queda en la corrida superada y en `AuditLog`. `run.manualChangeCount` cuenta las apariciones con `includeInSettlement` distinto de `defaultIncluded` más los hallazgos resueltos a mano, para avisar antes de re-ejecutar de cuántos cambios se perderán (volver una aparición a su valor por defecto la descuenta). Heredarlos es deuda de la Entrega 3.
  - **P7. Resolver una fila ambigua invalida la corrida.** La corrida vigente pasa a superada sin sustituta, en la misma transacción que la fila: `GET validations` responde `run: null`, el review exige validar de nuevo (`409 validation_run_required`) y la auditoría de la fila guarda `supersededRunId`. Solo ocurre en `analyzed`, así que no hay revisión que invalidar.
  - **Decisión de conjunto.** `POST review` decide sobre la corrida que el analista vio (`runId`): solo pasa a `validated` si es la vigente (`409 validation_run_superseded` si no) y no está bloqueada (`409 blocking_validation_issue`, sin override). Un review y una corrida simultáneos se serializan: nunca queda un import `validated` cuya corrida vigente no sea la revisada.
- **Estado no resuelto.** Una aparición cuyo estado no se pudo resolver cuenta como un estado distinto de cualquier otro, incluido otro no resuelto: frente a otra aparición de la misma `(transactionId, cycle)`, en el batch o en un batch anterior vigente, es una colisión con todas las apariciones actuales incluidas, nunca un duplicado; ninguna se descarta en silencio (`ConflictOccurrence.statusId` queda NULL). No aplica al ciclo R, que no tiene estado.
- **Excepción `CHB 2`.** Se compara por `(estado, excludeAmount)`. Solo el par `Chargeback` ↔ `Chargeback` con `excludeAmount` no genera hallazgo, en el batch y contra el histórico (que guarda `SettlementTransaction.excludeAmount`); dos `CHB 2` del mismo movimiento son duplicado y `CHB 2` frente a `Refund` es colisión. Cuando hay colisión, el `CHB 2` compatible se lista también como evidencia, en el batch y contra el histórico.
- **Faltantes ya registrados.** Cuentan como registrados solo los faltantes persistentes de imports que tienen un `SettlementBatch` `processed` o `paid`. Los de imports sin procesar, o cuyo único batch está `undone`, vuelven a salir en cualquier corrida, también en una corrida repetida del mismo import.
- **Candidatas sin el histórico liquidado.** La fuente de candidatas devuelve solo transacciones no procesadas en ese ciclo en un intento vigente de cualquier cuenta del proveedor, para que su volumen no crezca con el histórico; el motor lo vuelve a comprobar y descarta cualquier candidata procesada que reciba.
- **Canales de la cuenta.** Las candidatas salen de los canales cuya cuenta principal es la del import (`AccountChannel.isPrimary`); un canal sin asignar que aparece en el import no aporta candidatas.
- **Candidatas I sin fecha.** Una transacción en estado de ciclo I sin fecha de cambio de estado no puede compararse con el rango I: no es hallazgo y se cuenta aparte, una vez por transacción, en `undatedCandidateCount` (informativo, como `undatedAdjustmentCount` para las filas I sin fecha).
- **`Pending`.** `pendingInRangeCount` cuenta, una vez cada una, las transacciones `Pending` de los canales de la cuenta con fecha de creación dentro del rango APP o del DEC.
- **Primera aparición.** Orden de subida del archivo, posición de la hoja en el libro y `rowNo` (y, si aún empatan, los identificadores de archivo y hoja); las apariciones históricas, por `batchNo`, `attemptNo` y fila (las sin fila primero), luego el batch y por último el id del movimiento (`settlementTxnId`), que es estable. Los empates de texto se comparan por código, no según el idioma del entorno.

**Resultados y persistencia.** El resultado de cada validación se deriva de sus hallazgos:

| `outcome` | Significado | ¿Aprobada? |
|---|---|---|
| `passed` | Corrió y no produjo hallazgos | Sí |
| `warning` | Hay hallazgos y ninguno es bloqueante | Sí; se muestra como advertencia |
| `blocked` | Al menos un hallazgo con `blocking = 1` (hoy solo `provider_mismatch`) | No |
| `not_applicable` | Sin movimientos o sin histórico sobre el que correr; se muestra como n/a | No |
| `not_implemented` | La validación no está implementada | Nunca |

La corrida está bloqueada (`blocked`) si alguna validación lo está; entonces no se puede continuar y la única salida es cancelar el import. Los resultados y hallazgos se conservan por corrida (el sistema actual los borraba y reinsertaba por batch; sus tablas `SettlementTransactionMissing/Duplicate/Collision`, que ningún procedimiento usaba, no se migran). Lo que en el sistema actual hacía `SettlementTransactionLog` (fuente de "ya procesado" y de batches anteriores) lo hace `SettlementTransaction` filtrado por intento vigente.

**Pendiente, fuera de esta cross-validation:** catálogo de estados y formato de ID del nuevo gateway, cuando entre al proceso.

---

## 4. Especificación de la API

La API es REST bajo `/api/v1`, con contrato OpenAPI 3.1 en `docs/openapi.yaml` (publicado por el backend en `/docs`). Convenciones comunes a todos los endpoints:

- **Autenticación y alcance:** `Authorization: Bearer <JWT>` en todas las rutas salvo las anónimas: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (llevan el refresh token en el cuerpo) y `GET /health`. Cada petición resuelve los permisos del usuario y su alcance de merchants; un recurso de un merchant no visible responde `404`, no `403`, para no revelar su existencia.
- **Errores:** cuerpo uniforme `{ code, message, details? }`. `400` datos inválidos · `401` sin sesión · `403` sin permiso · `404` no existe o no visible · `409` conflicto con el estado actual · `422` archivo que no se puede procesar.
- **Dinero y porcentajes:** viajan como **strings** decimales (`"25.0000"`, `"0.025000"`), nunca como números JSON. Fechas en ISO 8601 con `Z` (en las de negocio la `Z` es solo transporte, ver 3.2); las columnas de solo día (`settlementDate`, `Fee.startDate`/`endDate`, `asOf`) como `YYYY-MM-DD`.
- **Identificadores:** UUID para cuentas, imports, archivos, hojas, fees y batches; enteros para catálogos, usuarios, hallazgos y resultados; `bigint` para transacciones, movimientos y apariciones.

Se documentan los tres endpoints principales, uno por cada capacidad que define el producto: administrar fees con reglas de negocio, importar con propuesta de pareo, y procesar. El inventario completo de endpoints previstos está al final de la sección.

### 4.1. `POST /accounts/{accountId}/fees` — crear un fee

Permiso `fee.manage`. Crea un fee vigente para la cuenta. Regla de negocio: no puede solaparse en vigencia con otro fee del mismo tipo en la misma cuenta; `startDate: null` significa "desde siempre" y `endDate: null` "sin fin", y ambos NULL se tratan como −∞ y +∞ en la comprobación de solapamiento.

```yaml
/accounts/{accountId}/fees:
  post:
    summary: Crea un fee para la cuenta
    security: [{ bearerAuth: [] }]
    parameters:
      - { name: accountId, in: path, required: true, schema: { type: string, format: uuid } }
    requestBody:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/FeeCreate' }
          example:
            feeTypeId: 3
            percentage: "0.025000"
            fixedAmount: "25.0000"
            startDate: null
            endDate: null
            description: "Chargeback fee (applies to every event)"
    responses:
      '201':
        description: Fee creado
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Fee' }
            example:
              feeId: "8f1c2b3e-…"
              accountId: "efb2446e-…"
              feeType: { feeTypeId: 3, code: "CHB", title: "Chargeback", isTransactional: true }
              fixedAmount: "25.0000"
              percentage: "0.025000"
              conditionalPercentage: null
              conditionThresholdAmt: null
              brandFixedAmount: null
              startDate: null
              endDate: null
              description: "Chargeback fee (applies to every event)"
              createdBy: { userId: 7, userName: "analyst1" }
              createdAt: "2026-10-01T14:02:11Z"
      '400':
        description: Datos inválidos (ni monto fijo ni porcentaje; endDate anterior a startDate cuando ambos están informados)
        content:
          application/json:
            example: { code: validation_error, message: "fixedAmount o percentage es obligatorio", details: { field: "fixedAmount" } }
      '409':
        description: Vigencia solapada con otro fee del mismo tipo
        content:
          application/json:
            example:
              code: FEE_OVERLAP
              message: "Ya existe un fee de tipo CHB vigente en ese rango"
              details:
                conflicts:
                  - { feeId: "2a9d…", startDate: null, endDate: null }

components:
  schemas:
    FeeCreate:
      type: object
      required: [feeTypeId]
      properties:
        feeTypeId: { type: integer }
        fixedAmount: { type: string, pattern: '^-?\d+(\.\d{1,4})?$', nullable: true }
        percentage: { type: string, pattern: '^\d+(\.\d{1,6})?$', nullable: true }
        conditionalPercentage: { type: string, nullable: true }
        conditionThresholdAmt: { type: string, nullable: true }
        brandFixedAmount: { type: string, nullable: true }
        startDate: { type: string, format: date, nullable: true, description: 'null = desde siempre' }
        endDate: { type: string, format: date, nullable: true, description: 'null = sin fin' }
        description: { type: string, maxLength: 100 }
```

### 4.2. `POST /accounts/{accountId}/imports` — importar archivos y obtener la propuesta de pareo

Permiso `settlement.process`. Recibe uno o varios `.xlsx` (hasta 20 MB cada uno) que forman un mismo batch. Crea el `Import` en estado `uploaded`, lee las hojas, aplica el conjunto de reglas de pareo enlazado a la cuenta (o las globales) y devuelve la propuesta hoja por hoja y columna por columna, con una vista previa de filas. **No analiza**: el analista revisa la propuesta, la ajusta con `PUT /imports/{importId}/mapping` y lanza el análisis con `POST /imports/{importId}/analyze`.

```yaml
/accounts/{accountId}/imports:
  post:
    summary: Sube uno o varios archivos de settlement y devuelve la propuesta de pareo
    security: [{ bearerAuth: [] }]
    parameters:
      - { name: accountId, in: path, required: true, schema: { type: string, format: uuid } }
    requestBody:
      required: true
      content:
        multipart/form-data:
          schema:
            type: object
            required: [files]
            properties:
              files:
                type: array
                minItems: 1
                items: { type: string, format: binary }
    responses:
      '201':
        description: Import creado con la propuesta de pareo
        content:
          application/json:
            example:
              importId: "c41e7d10-…"
              accountId: "efb2446e-…"
              status: uploaded
              createdBy: { userId: 7, userName: "analyst1" }
              files:
                - fileId: "9b02…"
                  fileName: "provider-a-batch-119-part1.xlsx"
                  sizeBytes: 184320
                  sheets:
                    - sheetId: "d77a…"
                      sheetName: "APP"
                      rowCount: 1913
                      proposed: { kind: transactions, cycle: E, statusId: 1, statusName: "Successful", source: global }
                      columns:
                        - { sourceColumn: "ID",       targetField: transactionId, source: global }
                        - { sourceColumn: "Amount",   targetField: amount,        source: global }
                        - { sourceColumn: "Currency", targetField: currency,      source: global }
                      preview:
                        - { "ID": "4512308877", "Amount": "120.50", "Currency": "USD" }
                    - sheetId: "e10c…"
                      sheetName: "RR"
                      rowCount: 1149
                      proposed: { kind: transactions, cycle: R, statusId: null, source: global }
                      columns:
                        - { sourceColumn: "ID",       targetField: transactionId, source: global }
                        - { sourceColumn: "Amount",   targetField: amount,        source: global }
                        - { sourceColumn: "Currency", targetField: currency,      source: global }
                    - sheetId: "e2b1…"
                      sheetName: "Other Fees"
                      rowCount: 3
                      proposed: { kind: batch_fees, cycle: null, statusId: null, source: global }
                      columns:
                        - { sourceColumn: "Type of Fee", targetField: feeType,  source: global }
                        - { sourceColumn: "Amount",      targetField: amount,   source: global }
                        - { sourceColumn: "Currency",    targetField: currency, source: global }
                    - sheetId: "e3c2…"
                      sheetName: "CHB Alerts"
                      rowCount: 0
                      proposed: { kind: ignore, source: global, note: "Hoja fuera del MVP; se omite" }
                      columns: []
                - fileId: "a3f4…"
                  fileName: "provider-a-batch-119-part2.xlsx"
                  sizeBytes: 90112
                  sheets:
                    - sheetId: "f88b…"
                      sheetName: "DEC"
                      rowCount: 388
                      proposed: { kind: transactions, cycle: E, statusId: 2, statusName: "Declined", source: global }
                      columns:
                        - { sourceColumn: "ID",       targetField: transactionId, source: global }
                        - { sourceColumn: "Amount",   targetField: amount,        source: global }
                        - { sourceColumn: "Currency", targetField: currency,      source: global }
              batchFees:
                - { feeTypeId: 22, code: "MONTHLY", title: "Monthly Fee", amount: "150.0000", currency: "USD", source: file }
                - { feeTypeId: 31, code: "WIRE",    title: "Wire Fee",    amount: "25.0000",  currency: "USD", source: file }
                - { feeTypeId: null, code: null,    title: "Special Deduction (typo)", amount: "-42.5000", currency: "USD", source: file, warning: "Tipo no encontrado en el catálogo; queda como importe libre" }
              readiness:
                canAnalyze: true
                notes:
                  - { sheetId: "f88b…", sheetName: "DEC", message: "Estado fijo por hoja (Declined); el archivo trae declinadas, se abrirá rango DEC" }
                  - { sheetId: "e3c2…", sheetName: "CHB Alerts", message: "Hoja fuera del MVP; se omite" }
              channels:
                - { channelId: 31, name: "RAM-01", assignment: assigned }
                - { channelId: 38, name: "RAM-07", assignment: unassigned, note: "Se asociará a esta cuenta al procesar" }
                - { channelId: 12, name: "RAM-03", assignment: assigned_to_other_account, otherAccount: { accountId: "a0b1…", name: "ProviderA-EUR" }, note: "Esta cuenta pasará a ser la principal del canal" }
                # Canal de un merchant fuera del alcance de quien consulta: se conservan channelId, gatewayId, rowCount y assignment
                - { channelId: 54, name: null, gatewayId: 1, providerId: null, rowCount: 1, assignment: assigned_to_other_account, otherAccount: { accountId: null, name: null, outOfScope: true }, note: "Esta cuenta pasará a ser la principal del canal", outOfScope: true }
      '400':
        description: Sin archivos, tipo no permitido o tamaño excedido
      '404':
        description: Cuenta inexistente o no visible para el usuario
      '409':
        description: Archivo idéntico ya incluido en el import
        content:
          application/json:
            example: { code: duplicate_file, message: "ProviderA_batch118_part1.xlsx is already in this import", details: { fileId: "9b02…", fileName: "ProviderA_batch118_part1.xlsx" } }
      '422':
        description: Archivo ilegible o sin hojas reconocibles
        content:
          application/json:
            example: { code: file_unreadable, message: "ProviderA_batch118_part2.xlsx is not a readable .xlsx: not a zip package", details: { fileName: "ProviderA_batch118_part2.xlsx" } }
```

`source` indica de dónde salió cada propuesta (`account` regla del conjunto enlazado a la cuenta, `global` regla global, `none` sin propuesta); `readiness` dice si ya se puede analizar y, si no, exactamente qué falta (`missing`) o qué conviene revisar (`notes`); `channels` resume la situación de cada canal detectado; si el canal o su cuenta principal son de un merchant fuera del alcance de quien consulta, sus datos salen a `null` con `outOfScope: true` (último elemento del ejemplo).

### 4.3. `POST /imports/{importId}/settlements` — procesar el batch

Permiso `settlement.process`. Requiere un import en `validated` cuya revisión sea de la corrida vigente (`runId` en el cuerpo) y sin hallazgos bloqueantes. Las advertencias persistentes no requieren acciones individuales. En **una** transacción crea un intento de batch en estado `processed` (pendiente de pago), incluye cada fila según la inclusión vigente de sus apariciones (§3.3, "Inclusiones al procesar"), aplica fees por fecha de evento, suma los fees por batch, calcula totales USD a 4 decimales y el amount payable con su desglose, asocia los canales a la cuenta y resuelve los faltantes que el batch incluye. Los importes de los totales viajan en positivo: el signo lo aplica quien los presenta, y `payableBreakdown` dice el de cada línea. Ningún movimiento queda Settled: eso solo pasa con `POST /settlements/{id}/pay`. Un reprocesamiento tras deshacer conserva el número oficial e incrementa el intento. `POST /imports/{importId}/settlements/preview` acepta el mismo cuerpo, hace el mismo cálculo sin escribir ni auditar nada y responde `200` con un `SettlementPreview`: las mismas cifras (rangos, canales, movimientos, totales, MDR, fees, reservas, `amountPayable`, `payableBreakdown`, `skipped`, `warnings`), con `batchFees` sin `batchFeeId` ni `enteredBy` (`null`), y sin lo que solo existe al escribir (`batchId`, `accountName`, `status`, `settledStatus`, `approvedBy`, `processedAt`, `settlementDate`, `channelsAssigned`, `validationSummary`, `exports`). Añade `runId`, `batchNoAvailable`, `requiresChannelConfirmation` y `channelsToAssign`: no responde `batch_no_taken` ni `channel_assignment_not_confirmed`, los informa con esos campos. Sí responde `409 import_not_validated` / `validation_run_required` / `validation_run_superseded` / `blocking_validation_issue` y `400 batch_fee_invalid`.

```yaml
/imports/{importId}/settlements:
  post:
    summary: Procesa el import como un intento de batch y devuelve el Settlement Summary
    security: [{ bearerAuth: [] }]
    parameters:
      - { name: importId, in: path, required: true, schema: { type: string, format: uuid } }
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [runId]
            additionalProperties: false
            properties:
              runId: { type: integer, minimum: 1, maximum: 2147483647, description: "Corrida de validaciones revisada; otra vigente → 409 validation_run_superseded" }
              batchNo: { type: integer, minimum: 1, maximum: 2147483647, description: "Si se omite, el siguiente de la cuenta; tras deshacer, el mismo número con nuevo intento" }
              settlementDate: { type: string, format: date, description: "Fecha de negocio de referencia del batch; una fecha de calendario válida (2026-02-30 → 400)" }
              note: { type: string, maxLength: 500, description: "Solo queda en la auditoría" }
              confirmChannelAssignment: { type: boolean, description: "Obligatorio en true si el batch trae canales sin asociar o de otra cuenta" }
              batchFees:
                type: array
                maxItems: 100
                description: "En el orden en que el analista los confirma; la respuesta los devuelve igual"
                items:
                  type: object
                  required: [feeTypeId, feeId, amount, source]
                  properties:
                    feeTypeId: { type: integer }
                    feeId: { type: string, format: uuid, nullable: true, description: "Preestablecido de la cuenta; null si es importe libre" }
                    amount: { type: string, description: "Decimal con signo, hasta 15 dígitos enteros y 4 decimales (DECIMAL(19,4)), distinto de 0" }
                    description: { type: string, maxLength: 200, description: "Obligatoria en un importe libre añadido a mano" }
                    source: { type: string, enum: [file, manual], description: "file: prellenado de Other Fees" }
          example:
            runId: 12
            batchNo: 123
            settlementDate: "2026-10-24"
            confirmChannelAssignment: true
            batchFees:
              - { feeTypeId: 121, feeId: null, amount: "25.0000", description: "Wire Fee", source: file }
              - { feeTypeId: 117, feeId: null, amount: "15.0000", description: "Settlement Fee", source: file }
    responses:
      '201':
        description: Intento de batch procesado, pendiente de pago
        content:
          application/json:
            example:
              batchId: "5c3f9e21-…"
              importId: "7b0c2a52-…"
              accountId: "efb2446e-…"
              accountName: ProviderA-USD
              batchNo: 123
              attemptNo: 1
              status: processed
              settledStatus: pending_payment
              approvedBy: { userId: 2, userName: "analyst" }
              processedAt: "2026-10-19T15:40:03.120Z"
              settlementDate: "2026-10-24"
              dateRanges:
                APP: { min: "2026-09-28T00:04:11.000Z", max: "2026-10-07T23:58:40.000Z" }
                DEC: { min: "2026-09-28T00:10:02.000Z", max: "2026-10-07T23:41:19.000Z" }
                I:   { min: "2026-09-28T03:00:00.000Z", max: "2026-10-11T21:12:00.000Z" }
                R:   { min: "2026-09-27T05:00:00.000Z", max: "2026-10-06T22:00:00.000Z" }
              channels: ["RAM-01", "RAM-02", "RAM-07"]
              movements: { E: 450, I: 10, R: 320 }
              totals:
                - { category: deposit,    qty: 340, amount: "39181.0700", feeAmount: "4139.1070", feeRate: "0.100000" }
                - { category: declined,   qty: 110, amount: "0.0000",     feeAmount: "27.5000",   feeRate: null }
                - { category: chargeback, qty: 2,   amount: "193.8600",   feeAmount: "90.0000",   feeRate: null }
                - { category: refund,     qty: 6,   amount: "843.9900",   feeAmount: "30.0000",   feeRate: null }
                - { category: rdr,        qty: 2,   amount: "391.5500",   feeAmount: "50.0000",   feeRate: null }
              brandTotals:
                - { cardBrand: VISA, qty: 204, amount: "23508.6400" }
              reservesReleasedQty: 320
              mdrAmt: "3918.1070"
              mdrRate: "0.100000"
              transactionalFeeAmt: "4336.6070"
              batchFees:
                - { batchFeeId: 41, feeTypeId: 121, code: "Wire Fee", title: "Wire Fee", feeId: null, amount: "25.0000", description: "Wire Fee", source: file, enteredBy: { userId: 2, userName: "analyst" } }
                - { batchFeeId: 42, feeTypeId: 117, code: "Settlement Fee", title: "Settlement Fee", feeId: null, amount: "15.0000", description: "Settlement Fee", source: file, enteredBy: { userId: 2, userName: "analyst" } }
              otherFeeAmt: "40.0000"
              reserveHeldAmt: "3918.1070"
              reserveReleasedAmt: "4314.4040"
              reserveEarlyReleasedAmt: "0.0000"
              amountPayable: "33771.3600"
              payableBreakdown:
                - { code: deposit,                label: "Deposits",                       sign: "+", amount: "39181.0700" }
                - { code: chargeback,             label: "Chargebacks",                    sign: "-", amount: "193.8600" }
                - { code: refund,                 label: "Refunds",                        sign: "-", amount: "843.9900" }
                - { code: rdr,                    label: "RDR",                            sign: "-", amount: "391.5500" }
                - { code: transactional_fees,     label: "Transaction fees",               sign: "-", amount: "4336.6070" }
                - { code: batch_fees,             label: "Batch fees",                     sign: "-", amount: "40.0000" }
                - { code: reserve_held,           label: "Reserve held",                   sign: "-", amount: "3918.1070" }
                - { code: reserve_released,       label: "Reserve released",               sign: "+", amount: "4314.4040" }
                - { code: reserve_early_released, label: "Reserve released on chargeback", sign: "+", amount: "0.0000" }
              skipped: { ignored: 3, unmatched: 0, ambiguous: 0, excluded: 0, unresolvedStatus: 0, pending: 0 }
              warnings: []
              channelsAssigned:
                - { channelId: 1007, name: "RAM-07", assignment: new_primary, previousAccount: null }
              validationSummary: { runId: 12, persistent: 0, resolved: 0, blocking: 0, resolvedMissing: 0 }
              exports:
                summary: "/api/v1/settlements/5c3f9e21-…/export?type=summary"
                transactions: "/api/v1/settlements/5c3f9e21-…/export?type=transactions"
                reserves: "/api/v1/settlements/5c3f9e21-…/export?type=reserves"
      '400':
        description: Cuerpo inválido (validation_error) o un fee por batch no válido
        content:
          application/json:
            examples:
              batchFeeInvalid:
                value: { code: batch_fee_invalid, message: "Batch fee 1 is not valid: free_amount_not_allowed", details: { index: 1, reason: free_amount_not_allowed } }
      '409':
        description: El import no está validado, no hay corrida vigente, la corrida no es la revisada, hay hallazgos bloqueantes, ya existe un intento vigente para ese número, faltan confirmaciones, o el procesado fue víctima de un interbloqueo tres veces seguidas (reintentar)
        content:
          application/json:
            examples:
              notValidated:
                value: { code: import_not_validated, message: "The import must be validated before processing (status: analyzed)", details: { status: analyzed } }
              runRequired:
                value: { code: validation_run_required, message: "Run the validations before reviewing", details: {} }
              runSuperseded:
                value: { code: validation_run_superseded, message: "A newer validation run exists; review it before continuing", details: { runId: 11, currentRunId: 12 } }
              blockingIssue:
                value: { code: blocking_validation_issue, message: "provider_mismatch: cancel the import and process it under the correct provider", details: { runId: 7, validationCodes: [provider_mismatch], issueIds: [4411] } }
              batchNoTaken:
                value: { code: batch_no_taken, message: "Batch 123 already has an active attempt for this account", details: { batchNo: 123, attemptNo: 1, importId: "0a1b2c3d-…" } }
              channelsNotConfirmed:
                value: { code: channel_assignment_not_confirmed, message: "The import includes channels not assigned to this account; confirm the assignment", details: { channels: [{ channelId: 1007, name: "RAM-07", assignment: unassigned, otherAccount: null }] } }
              settlementBusy:
                value: { code: settlement_busy, message: "Another settlement is being processed for this provider; retry" }
```

El ejemplo es de `batch-clean` (cifras de `data/samples/batch-clean/expected.json`), con los fees transaccionales calculados, como siempre en el API, y los dos fees de `Other Fees` prellenados. `mdrAmt` es la parte MDR incluida en el fee de los depósitos. La suma con signo de `payableBreakdown` es `amountPayable`.

Un cuerpo que la base no podría guardar responde `400 validation_error` antes de escribir: `runId` o `batchNo` por encima de 2147483647 (`INT`), un `amount` con más de 15 dígitos enteros, una `settlementDate` que no es una fecha de calendario o más de 100 `batchFees`.

`otherAccount` (en `channelsToAssign` de la vista previa y en `details.channels` de `409 channel_assignment_not_confirmed`) y `previousAccount` (en `channelsAssigned`) pasan el mismo filtro de alcance que el aviso de canales de `GET /imports/{id}`: si la otra cuenta es de un merchant fuera del alcance de quien llama, sale como `{ accountId: null, name: null, outOfScope: true }`.

La respuesta `201` se lee de lo escrito, con la forma de `GET /settlements/{id}` (#12) y de la respuesta `200` de `pay`, `unpay` y `undo`; `paidAt`, `paidBy`, `undoneAt`, `undoneBy` y `undoReason` son `null` mientras no aplican. `skipped`, `warnings`, `channelsAssigned` y `validationSummary` se leen de la auditoría `settlement.process` del intento; un intento sin esa auditoría (el histórico del seed) devuelve `skipped` a ceros, `warnings` y `channelsAssigned` vacíos y `validationSummary: null`.

**`400 batch_fee_invalid`.** Los fees por batch se validan en el orden del cuerpo y la validación se detiene en el primero no válido: `details.index` es su posición (desde 0) y `details.reason`, uno de:

| `reason` | Cuándo |
|---|---|
| `unknown_fee_type` | `feeTypeId` no existe |
| `transactional_fee_type` | El tipo es transaccional: lo aplica el motor por movimiento, no va por batch |
| `fee_not_in_account` | `feeId` no es un fee de la cuenta de un tipo no transaccional (un fee transaccional de la cuenta no es preestablecido de un batch) |
| `fee_type_mismatch` | El fee preestablecido es de otro tipo que `feeTypeId` |
| `fee_not_in_force` | El fee preestablecido no está vigente el día de referencia del batch |
| `free_amount_not_allowed` | Importe libre (`feeId: null`) de un tipo sin `allowsFreeAmount`, salvo un prellenado de `Other Fees` (`source: file`) de un tipo que el archivo trae |
| `description_required` | Importe libre añadido a mano (`source: manual`) sin descripción |

El día de referencia es `settlementDate` si viene en el cuerpo; si no, el mayor de los máximos de los rangos de la corrida (como día de negocio); si no hay ninguno de los dos, no se comprueba la vigencia.

### 4.4. Inventario de endpoints previstos

Lista consolidada de lo que el MVP necesita; los tres documentados arriba están marcados. Sirve de guía para la Entrega 2 y se depura conforme avance la implementación.

| Área | Método y ruta | Permiso | Qué hace |
|---|---|---|---|
| Auth | `POST /auth/login` | — | Devuelve JWT de acceso y refresh |
| Auth | `POST /auth/refresh` · `POST /auth/logout` | — | Renovar / cerrar sesión |
| Auth | `GET /auth/me` | — | Usuario, rol, permisos, alcance y merchants visibles |
| Catálogo | `GET /merchants` · `GET /merchants/{id}/providers` | — | Jerarquía de los gateways (solo lectura), filtrada por alcance |
| Catálogo | `GET /providers/{id}` · `GET /providers/{id}/channels` | — | Proveedor con sus cuentas y canales (parámetros del canal incluidos) |
| Catálogo | `GET /channels?unassigned=true` | — | Canales con transacciones y sin cuenta (*not assigned yet*) |
| Catálogo | `GET /channels/{id}/accounts` | — | Cuentas asociadas al canal y cuál es la principal |
| Catálogo | `GET /providers/{id}/accounts` · `POST /providers/{id}/accounts` | `account.manage` (POST) | Cuentas del proveedor; crear cuenta (nombre, política de reserva ante chargeback, tope de reserva, `copyFeesFromAccountId` opcional, `matchingRuleSetId` opcional) |
| Catálogo | `GET /accounts/{id}` · `PATCH /accounts/{id}` | `account.manage` (PATCH) | Detalle / editar cuenta, activar o cerrar |
| Catálogo | `GET /accounts/{id}/channels` | — | Canales asociados a la cuenta (principal e históricos) |
| Fees | `GET /fees?merchantId=&providerId=&accountId=&kind=&status=&q=` | `fee.view` | Vista global de fees activos, programados o cerrados, con filtros |
| Fees | `GET /accounts/{id}/fees?asOf=&transactional=` | `fee.view` | Fees de la cuenta, vigentes a una fecha de negocio (`asOf`, YYYY-MM-DD); `transactional=false` da los preestablecidos por batch (un preestablecido solo con porcentaje sale sin importe: lo escribe el analista) |
| Fees | **`POST /accounts/{id}/fees`** ✅ | `fee.manage` | Crear fee (4.1) |
| Fees | `PATCH /fees/{id}` | `fee.manage` | Editar o cerrar vigencia; registra en historial |
| Fees | `POST /fees/{id}/simulate` | `fee.manage` | Efecto de un cambio sobre los settlements afectados, sin aplicar |
| Fees | `GET /fees/{id}/history` | `fee.view` | Historial de cambios |
| Fees | `GET /fee-types` | — | Catálogo de tipos (transaccional, importe libre) |
| Pareo | `GET /providers/{id}/matching-rule-sets` · `POST …/matching-rule-sets` | `account.manage` (POST) | Conjuntos de reglas del proveedor, con las cuentas que usan cada uno; crear conjunto |
| Pareo | `GET /matching-rule-sets/{id}` · `PUT /matching-rule-sets/{id}` | `account.manage` (PUT) | Reglas de hoja, columna y filas a ignorar del conjunto |
| Pareo | `GET /matching-rules/global` · `PUT /matching-rules/global` | `account.manage` (PUT) | Reglas globales por defecto y alias de estado |
| Pareo | `PATCH /accounts/{id}` con `matchingRuleSetId` | `account.manage` | Enlazar la cuenta a otro conjunto (efecto en el siguiente import) |
| Importación | **`POST /accounts/{id}/imports`** ✅ | `settlement.process` | Subir archivos y obtener propuesta de pareo (4.2) |
| Importación | `GET /accounts/{id}/imports?status=` | — | Imports de la cuenta por estado |
| Importación | `GET /imports/{id}` | — | Detalle: archivos, hojas, pareo, contadores, estado, intento vigente |
| Importación | `PUT /imports/{id}/mapping` | `settlement.process` | Confirmar o corregir el pareo por hoja y columna |
| Importación | `POST /imports/{id}/analyze` | `settlement.process` | Parsear con el pareo confirmado y cruzar por identidad externa |
| Importación | `GET /imports/{id}/rows?match=unmatched&page=` | — | Filas leídas, con las no asociadas primero |
| Importación | `PATCH /imports/{id}/rows/{sheetId}/{rowNo}` | `settlement.process` | Resolver una fila ambigua con `{ gatewayId }` (solo en `analyzed`); en la misma transacción supera la corrida de validaciones vigente sin sustituta (hay que validar de nuevo) y la auditoría guarda `supersededRunId`. `400 validation_error` / `409 row_not_ambiguous` / `409 import_not_editable` |
| Importación | `POST /imports/{id}/files` · `DELETE /imports/{id}/files/{fileId}` | `settlement.process` | Añadir o quitar archivos antes de analizar |
| Importación | `POST /imports/{id}/cancel` | `settlement.process` | Cancelar un import no procesado (conserva archivos, filas y hallazgos como historial) |
| Validaciones | `POST /imports/{id}/validations` | `settlement.process` | Ejecutar las ocho validaciones en `analyzed` o `validated`: nueva corrida vigente, la anterior queda superada (no se borra); en `validated` el import vuelve a `analyzed` y la revisión queda invalidada. `409 import_not_analyzed` / `import_changed` |
| Validaciones | `GET /imports/{id}/validations` | — | Corrida vigente (`run: null` si no hay): resultado, conteo, bloqueo y desglose por validación, rangos por ciclo, contadores informativos, `manualChangeCount`, revisión vigente; y `lastInvalidatedReview` |
| Validaciones | `GET /imports/{id}/validation-issues?type=&scope=&status=&validationCode=&cycle=&page=&pageSize=` | — | Hallazgos de la corrida vigente en orden fijo, paginados (`pageSize` ≤ 500, 50 por defecto), con su resolución e inclusiones por defecto y actuales |
| Validaciones | `GET /validation-issues/{id}` | — | Hallazgo con todas sus apariciones (import actual y batches anteriores), resolución, historial de cambios y si la corrida es la vigente |
| Validaciones | `PATCH /validation-issues/{id}` | `settlement.process` | Acción opcional: `{ resolutionStatus: "resolved", note }` resuelve a mano un `non_recorded_adjustment` o un `status_mismatch` de la corrida vigente, con nota, en cualquier estado del import. `409 issue_already_resolved` / `validation_run_superseded`, `422 issue_not_resolvable` |
| Validaciones | `PATCH /conflict-occurrences/{id}` | `settlement.process` | Acción opcional: `{ includeInSettlement }` en una aparición `current_import` de la corrida vigente, en `analyzed` o `validated` (vuelve a `analyzed`), auditado; regla de R de 3.3. `409 import_not_editable` / `validation_run_superseded` / `occurrence_not_editable` / `occurrence_not_includable` |
| Validaciones | `POST /imports/{id}/review` | `settlement.process` | Decisión de conjunto "continuar" con cuerpo `{ runId }`: el import pasa a `validated` si es la corrida vigente y no hay bloqueantes, auditado. `409 import_not_analyzed` / `validation_run_required` / `validation_run_superseded` / `blocking_validation_issue` |
| Settlement | **`POST /imports/{id}/settlements`** ✅ | `settlement.process` | Procesar (4.3). `409 import_not_validated` / `validation_run_required` / `validation_run_superseded` / `blocking_validation_issue` / `batch_no_taken` / `channel_assignment_not_confirmed` / `settlement_busy`, `400 batch_fee_invalid` |
| Settlement | `POST /imports/{id}/settlements/preview` | `settlement.process` | El mismo cálculo y cuerpo que procesar, sin escribir ni auditar; responde `200` con `SettlementPreview`: resumen previo de Settlement Review con `batchNoAvailable` y los canales a asociar (`requiresChannelConfirmation`, `channelsToAssign`) en lugar de `409 batch_no_taken` / `channel_assignment_not_confirmed`. `409 import_not_validated` / `validation_run_required` / `validation_run_superseded` / `blocking_validation_issue`, `400 batch_fee_invalid` |
| Settlement | **`GET /settlements/{id}`** ✅ | — | La vista del intento, la misma forma que la respuesta `201` de procesar, leída de lo escrito y sin recalcular; `settledStatus` sale del estado del intento (`paid` → `settled`). Los intentos sin auditoría de procesado (el histórico del seed) responden con `validationSummary: null`. La cuenta anterior de un canal asociado se oculta si es de un merchant fuera del alcance. `404 not_found` igual para un intento inexistente y para uno fuera del alcance |
| Settlement | **`GET /settlements/{id}/transactions?type=E\|I\|R&page=&pageSize=`** ✅ | — | Movimientos de un ciclo del intento (`type` obligatorio), paginados (`page` desde 1, `pageSize` 1–500, 50 por defecto) en orden estable `(cycle, sheetId, rowNo, settlementTxnId)`: estable entre páginas y llamadas, pero por `sheetId` (un identificador), no por el orden de las hojas en el archivo; el histórico sin hoja sale por movimiento, cada uno con su desglose de fees (`SettlementTransactionFee`), reserva, fecha del evento y `settled` (verdadero solo si el intento está `paid`). `400 validation_error` / `404 not_found` |
| Settlement | **`GET /settlements/{id}/export?type=summary\|transactions\|reserves`** ✅ | `reports.view` | Descarga CSV (formato en §1.2 "Formato de los exports") con `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store` y `Content-Disposition: attachment; filename="<cuenta>_B<batchNo>_A<attemptNo>_<type>.csv"`; en cualquier estado del intento, sin cambiar ninguno. Cada descarga escribe `settlement.export` en `AuditLog` antes de enviarse. Los errores son JSON: `400 validation_error`, `403 forbidden` (antes del alcance), `404 not_found`, `500 internal_error` sin archivo si la descarga no se pudo auditar |
| Settlement | **`POST /settlements/{id}/pay`** ✅ | `payment.process` | Sin cuerpo. `processed` → `paid`: los movimientos E, I y R pasan a Settled, sin cambiar cifras ni movimientos. Responde `200` con la vista del intento. Auditado (`settlement.pay`). `409 settlement_not_processed` desde `paid` o `undone` (`details.status`) / `settlement_busy`; `403 forbidden` antes del alcance; `404 not_found` igual para un intento inexistente y para uno fuera del alcance |
| Settlement | **`POST /settlements/{id}/unpay`** ✅ | `payment.process` | Cuerpo `{ reason }` (1–500 caracteres sin los espacios de los extremos). `paid` → `processed`, con `paidAt` y `paidByUserId` vacíos; no revierte nada del Back-Office. Responde `200` con la vista del intento. Auditado (`settlement.unpay`). `400 validation_error` / `409 settlement_not_paid` desde `processed` o `undone` (`details.status`) / `settlement_busy`, `403` y `404` como `pay` |
| Settlement | **`POST /settlements/{id}/undo`** ✅ | `settlement.process` | Cuerpo `{ reason }`. `processed` → `undone`, conservando movimientos, fees, totales y exports. En la misma transacción, el import vuelve a `analyzed` sin `currentBatchId`, su corrida vigente queda superada sin sustituta (hay que validar y revisar otra vez), los faltantes `resolved` por el intento en corridas vigentes vuelven a `persistent` y la cuenta principal de los canales no cambia. Responde `200` con la vista del intento. Auditado (`settlement.undo`). `400 validation_error` / `409 settlement_payment_not_removed` desde `paid` / `settlement_not_processed` desde `undone` / `settlement_not_current` / `settlement_busy`, `403` y `404` como `pay` |
| Settlement | **`GET /imports/{id}/settlements`** ✅ | — | Intentos del import, vigente y deshechos, del más reciente al más antiguo (`processedAt`): `{ importId, currentBatchId, items }`, cada uno con `batchNo`, `attemptNo`, `status`, `settledStatus`, `processedAt`, `approvedBy`, `amountPayable` e `isCurrent`; lista vacía si no se ha procesado. `404 not_found` igual fuera del alcance |
| Settlement | **`GET /accounts/{id}/settlements?status=&dateField=&from=&to=&page=&pageSize=`** ✅ | — | Intentos de la cuenta en cualquier estado, del más reciente al más antiguo (`processedAt`, luego `batchNo` e intento): `{ accountId, items, page, pageSize, total }`, cada uno con `batchId`, `importId`, `batchNo`, `attemptNo`, `status`, `settledStatus`, `settlementDate`, `processedAt`, `approvedBy`, `amountPayable` y `channels` (el texto guardado). `status` ∈ `processed` \| `paid` \| `undone`; `from` / `to` son días `YYYY-MM-DD` inclusivos de `dateField`: `settlementDate` (por defecto, fecha de negocio sin convertir; sin ella el intento queda fuera) o `processedAt` (día de calendario en Nueva York, con cambio de hora). `page` desde 1, `pageSize` 1–500 (50). `400 validation_error` (también `from > to`), `404 not_found` igual fuera del alcance |
| Settlement | `GET /accounts/{id}/batch-number/next?importId=` | — | Siguiente `batchNo` propuesto: el mayor de la cuenta en cualquier estado + 1, o, con `importId` de un import con un intento deshecho, su mismo número con el intento siguiente (`reason: reprocess`) |
| Consultas | `GET /accounts/{id}/issues?type=missing\|duplicate&status=persistent` | — | Faltantes y duplicados persistentes de la cuenta |
| Consultas | `GET /providers/{id}/pending-payments` | — | Settlements procesados y no pagados por proveedor |
| Consultas | `GET /channels/{id}/unsettled` | `reports.view` | Pendientes del canal (no reconciliados y reconciliados pendientes de pago), reportados en la cuenta principal |
| Consultas | `GET /transactions/{transactionId}` · `GET /transactions?gatewayId=&sourceTransactionId=` | — | Ficha de una transacción con sus movimientos por ciclo y sus apariciones en validaciones |
| Dashboard | `GET /dashboard` | — | Imports en curso, batches recientes, pendientes de pago, canales sin asignar, para el alcance del usuario |
| Usuarios | `GET /users` · `POST /users` · `PATCH /users/{id}` | `user.manage` | Usuarios, rol, alcance y merchants asignados dentro de la autoridad del administrador |
| Sistema | `GET /health` | — | Estado del servicio y de la conexión a la base |

Fuera del MVP (roadmap, no se implementan): pagos como entidad (`/payments`), reportes avanzados (`/reports/aged-receivables`, `/reports/forecast`), reglas de interpretación avanzada (`/accounts/{id}/interpretation-rules`) y formatos adicionales a `.xlsx`.

---

## 5. Historias de Usuario

Tres historias principales del flujo. Son amplias y se descomponen en tickets; los criterios describen comportamiento previsto, todavía no implementado ni probado, en formato Given/When/Then para que sean traducibles a tests.

### HU1 — Importar los archivos de un settlement y confirmar el pareo

**Como** analista de reconciliaciones, **quiero** cargar los archivos del settlement de una cuenta y revisar cómo se interpretan sus hojas y columnas antes de analizar, **para** preparar la reconciliación dentro de la aplicación con control sobre lo que se va a cruzar.

**Criterios de aceptación:**

1. *Dado* una cuenta de un merchant dentro de mi alcance y permiso `settlement.process`, *cuando* subo uno o varios `.xlsx` válidos de hasta 20 MB, *entonces* se crea un import en estado `uploaded` que agrupa todos los archivos, y veo cada archivo con sus hojas y su número de filas.
2. *Dado* un import en `uploaded` o `mapped`, *cuando* añado o quito un archivo, *entonces* el grupo se actualiza sin afectar ningún dato interno y la propuesta de pareo se recalcula; *cuando* subo un archivo idéntico a uno ya incluido, *entonces* se rechaza por su huella indicando con cuál coincide, sin perder la configuración revisada.
3. *Dado* un import con archivos, *cuando* el sistema aplica las reglas de la cuenta, *entonces* para cada hoja veo el estado propuesto (fijo por hoja, resumen o ignorar) y para cada columna el campo propuesto, indicando si viene de una regla de la cuenta, de una regla global o no tiene propuesta.
4. *Dado* que una propuesta no es correcta, *cuando* cambio el estado de una hoja o el campo de una columna y confirmo, *entonces* el pareo confirmado se guarda para ese import, pasa a `mapped` y la vista previa se actualiza.
5. *Dado* que en alguna hoja no ignorada falta el Transaction ID o no hay forma confirmada de obtener el estado (ni fijo por hoja ni por columna), *cuando* intento analizar, *entonces* el sistema no analiza y me indica qué hoja y qué campo faltan.
6. *Dado* un pareo confirmado completo, *cuando* lanzo el análisis, *entonces* cada fila queda guardada con su fila original de referencia, su ID se normaliza según el formato del gateway y se cruza por `(gateway, sourceTransactionId)` dentro de los gateways de la cuenta, el import pasa a `analyzed` y veo filas asociadas, no asociadas, ambiguas e ignoradas, con las no asociadas y ambiguas primero; *dado* una fila ambigua, *cuando* elijo el gateway entre las candidatas, *entonces* pasa a asociada y la elección queda registrada.
7. *Dado* que las transacciones asociadas incluyen un canal sin cuenta o cuya cuenta principal es otra, *cuando* termina el análisis, *entonces* veo el aviso con cada canal, su situación y la cuenta principal actual.
8. *Dado* un import en cualquier estado anterior a `processed`, *cuando* lo abro desde In Progress, *entonces* puedo retomarlo donde quedó; *dado* un import ya analizado, *entonces* sus archivos no se modifican: una corrección cancela el import conservando evidencia y se procesa de nuevo en un import nuevo.

**Fuera de alcance:** importación directa de los Excel originales sin plantilla y reglas de interpretación avanzada (estado derivado, filas relacionadas, fees informados); formatos distintos de `.xlsx`; matching difuso; administración de reglas de pareo desde esta pantalla.

### HU2 — Revisar validaciones y resultados parciales

**Como** analista de reconciliaciones, **quiero** revisar las transacciones que se contabilizarán y las advertencias detectadas, **para** decidir si continuar con el settlement o cancelar el import y procesarlo de nuevo con los archivos corregidos.

**Criterios de aceptación:**

1. *Dado* un import en `analyzed`, *cuando* ejecuto las validaciones, *entonces* se crea una corrida con las ocho validaciones, cada una con su resultado, su número de hallazgos y si bloquea, más los rangos de fechas APP, DEC, I y R usados; una corrida nueva invalida la revisión de la anterior.
2. *Dado* una validación con hallazgos, *cuando* abro uno, *entonces* veo todas sus apariciones (en este import o en batches anteriores) con archivo, hoja, fila, estado y cuál está incluida en el settlement por defecto.
3. *Dado* dos apariciones del mismo movimiento con la misma identidad externa y el mismo ciclo, *cuando* se validan, *entonces* se genera un hallazgo de duplicado, una sola aparición queda incluida y las demás excluidas; *dado* un movimiento E y su reserva R, *entonces* no son duplicado.
4. *Dado* Approved + Declined para el mismo movimiento, *cuando* se valida, *entonces* se genera una advertencia que no bloquea; *dado* Refund + Chargeback, *entonces* coexisten con advertencia y sin exclusión automática; *dado* un archivo legacy con alias `CHB 2`, *entonces* cuenta en cantidad y fee de chargeback, su importe queda excluido de `chargebackAmt` y no es duplicado del `Chargeback` del mismo movimiento; *dado* una validación sin ciclo o sin histórico sobre el que correr, *entonces* su resultado es `not_applicable` y no cuenta como aprobada.
5. *Dado* un `provider_mismatch`, *cuando* reviso, *entonces* el botón de continuar está deshabilitado y el sistema indica que debo cancelar y procesar con el proveedor correcto; no existe override.
6. *Dado* hallazgos no bloqueantes, *cuando* elijo continuar, *entonces* el import pasa a `validated` sin exigir decisión por hallazgo; los hallazgos quedan `persistent` y la aprobación con mi usuario.
7. *Dado* el detalle de un hallazgo, *cuando* opcionalmente cambio la inclusión de una aparición o marco resuelto un `non_recorded_adjustment` tras verificarlo en el gateway, *entonces* el cambio se guarda con mi usuario y fecha, y el hallazgo sigue existiendo.
8. *Dado* que decido no continuar, *cuando* cancelo, *entonces* el import pasa a `cancelled` conservando archivos, filas, corrida y hallazgos; el corregido se procesa como import nuevo; la comunicación con el proveedor ocurre fuera de la aplicación.
9. *Dado* un faltante `persistent`, *cuando* la transacción aparece en un batch `processed` posterior de la cuenta, *entonces* el hallazgo pasa a `resolved` con ese batch; *cuando* ese batch se deshace, *entonces* el hallazgo vuelve a `persistent` conservando la evidencia.

**Fuera de alcance:** comunicaciones automáticas al proveedor; corrección parcial de archivos ya analizados; validación del catálogo de estados del nuevo gateway.

### HU3 — Procesar el batch, generar los archivos y registrar su pago

**Como** analista de reconciliaciones, **quiero** confirmar el batch, obtener su resumen y sus archivos, y registrar después el pago, **para** documentar lo reconciliado y que los movimientos queden Settled solo cuando el proveedor haya pagado.

**Criterios de aceptación:**

1. *Dado* un import en `validated`, *cuando* abro Settlement Review, *entonces* veo propuesto el siguiente número de batch de la cuenta y puedo cambiarlo; *dado* que ya existe un intento vigente con ese número, *cuando* confirmo, *entonces* el sistema lo rechaza; *dado* un import cuyo intento anterior fue deshecho, *entonces* el mismo número se acepta con intento incrementado.
2. *Dado* que estoy en Settlement Review, *cuando* agrego fees por batch, *entonces* puedo elegir entre los no transaccionales preestablecidos de la cuenta con importe ajustable o ingresar uno de importe libre con su categoría y descripción; se reflejan en el resumen previo y quedan con mi usuario.
3. *Dado* que confirmo, *cuando* el sistema procesa, *entonces* cada movimiento incluido genera una fila por ciclo E/I/R; cada uno recibe los fees vigentes a la fecha de la operación (E) o del evento (I), con su desglose y configuración aplicada; *dado* que la fuente no permite fechar un ajuste, *entonces* se advierte y no se inventa la fecha.
4. *Dado* que confirmo, *entonces* la reserva usa el porcentaje guardado en la transacción y el plazo del canal, y cuando la transacción ya pasó a `Chargeback` aplica la política de la cuenta (mantener retenida hasta el plazo o liberar de inmediato), conservando la regla aplicada y el importe.
5. *Dado* que el import incluye canales sin asociar o de otra cuenta, *cuando* confirmo con la asociación aceptada, *entonces* cada canal queda asociado a esta cuenta como principal y el hecho queda en auditoría.
6. *Dado* un batch recién procesado, *entonces* su estado es `processed`, sus movimientos no están Settled, y están disponibles el resumen para el merchant y los dos CSV identificados por intento; descargarlos no altera ningún estado.
7. *Dado* permiso `payment.process`, *cuando* marco el batch como pagado, *entonces* pasa a `paid`, sus movimientos E/I/R quedan Settled y la acción queda auditada; *cuando* retiro la marca, *entonces* vuelve a `processed` con auditoría, sin revertir acciones del Back-Office.
8. *Dado* un batch `processed` pendiente de pago, *cuando* lo deshago indicando el motivo, *entonces* pasa a `undone` conservando sus datos, el import vuelve a `analyzed`, se recalculan las incidencias afectadas, la cuenta principal del canal no se revierte y el hecho queda en auditoría; *dado* un batch `paid`, *entonces* no puede deshacerse sin retirar antes la marca de pago.

**Fuera de alcance:** pagos parciales, aplicación de un pago a varios batches, ejecución automática de los CSV en el Back-Office.

---

## 6. Tickets de Trabajo

Tres tickets representativos del backlog, uno por capa; no representan todo el trabajo del MVP. Responsable: **Manfred Valverde Perrogón**. Estimación en puntos Fibonacci (1 punto ≈ media jornada), a validar antes de implementar. Las dependencias se crean como tareas separadas, sin afirmar que ya están resueltas; en particular **RT2-DB-000 · Esquema base y migraciones** (catálogo, transacciones, importación, conjuntos de reglas de pareo por proveedor, usuarios) precede a los tres.

**Estado de RT2-DB-000 en la Entrega 2 (hecho).** El esquema base entró con el tramo 0 en las migraciones [`0001_init`](backend/prisma/migrations/0001_init/) y [`0002_constraints`](backend/prisma/migrations/0002_constraints/), esta última escrita y revisada a mano. Tres decisiones del modelo (3.1 y 3.2) quedan fijadas en él:

- **`MatchingRuleSet`.** Las reglas de pareo se agrupan en conjuntos por proveedor (`UNIQUE (providerId, name)`), a los que se enlaza cada cuenta con `Account.matchingRuleSetId`; las reglas con `ruleSetId NULL` son globales y actúan como fallback. Así dos cuentas del mismo proveedor pueden compartir reglas y una cuenta nueva hereda las globales sin configurar nada.
- **`Fee.startDate NULL`** significa "desde siempre" y `endDate NULL` "sin fin": la `CHECK CK_Fee_validity` solo compara fechas cuando ambas están informadas, y el trigger `TR_Fee_NoOverlap` trata los NULL como −∞ y +∞ al impedir el solapamiento de fees del mismo tipo en la misma cuenta. Los fees no se borran: se cierran informando `endDate`.
- **`MatchingSheetRule.kind`** ∈ `transactions` | `batch_fees` | `ignore` sustituye a la antigua tabla de hojas resumen. Tres `CHECK` mantienen la coherencia: una hoja `transactions` lleva ciclo; `batch_fees` e `ignore` no llevan ni ciclo ni estado; y el ciclo `R` nunca lleva estado.

### Ticket 1 — RT2-DB-001 · Persistencia de intentos de batch, movimientos y fees aplicados

**Tipo:** Base de datos. **Historia:** HU3. **Estimación:** 8 puntos. **Depende de:** RT2-DB-000. **Issue:** [#11](https://github.com/kajirioji/AI4Devs-finalproject/issues/11).

> **Estado en la Entrega 2 (hecho).** Las tablas de settlement, sus `CHECK` y los índices únicos filtrados por `status <> 'undone'` venían en el esquema base (RT2-DB-000). El change `settlement-process` ([#66](https://github.com/kajirioji/AI4Devs-finalproject/pull/66)) añadió dos migraciones escritas a mano: [`0007_settlement_process`](backend/prisma/migrations/0007_settlement_process/) sustituye `UNIQUE (transactionId, cycle, batchId)` por un movimiento por fila de origen `(batchId, sheetId, rowNo)` y admite una fecha de evento desconocida (NULL) en lugar de inventarla; [`0008_settlement_fee_event_date`](backend/prisma/migrations/0008_settlement_fee_event_date/) extiende ese NULL al detalle de fees del movimiento. Los fees se resuelven con la vigencia de RT2-DB-000 (un `Fee` con `startDate NULL` y `endDate NULL` aplica también a un ajuste sin fecha); el ciclo de cada movimiento lo fija la regla de hoja (`MatchingSheetRule.kind = 'transactions'` con su `cycle`), y los fees de la hoja `batch_fees` llegan prellenados al Settlement Review y se guardan en `SettlementBatchFee` con `source = 'file'`. Queda para la Entrega 3 la reserva por política ante chargeback ([#62](https://github.com/kajirioji/AI4Devs-finalproject/issues/62)).

**Objetivo:** guardar cada procesamiento con trazabilidad, distinguirlo del pago y permitir reprocesar sin borrar el intento anterior.

**Tareas:**

1. Crear `SettlementBatch` (con `attemptNo`, estado, rangos por ciclo, totales), `SettlementBatchTotal`, `SettlementBatchBrandTotal`, `SettlementBatchFee`, `SettlementTransaction` (con reserva y política aplicada) y `SettlementTransactionFee`, con PK/FK y migración revisada a mano.
2. Relacionarlas con cuentas, transacciones (`transactionId BIGINT`) e imports (`Import.currentBatchId`).
3. Importes USD como `DECIMAL(19,4)`, porcentajes `DECIMAL(9,6)`, fecha de evento y parámetros usados para fees y reservas; `CHECK` de estados y de `SettlementBatchFee.source IN ('file','manual')`; la regla de importe libre cruza tablas y se valida en el caso de uso (3.2), no con una `CHECK`.
4. Índices únicos filtrados por `status <> 'undone'`: un solo intento vigente por (`accountId`, `batchNo`) y por `importId`; `UNIQUE (accountId, batchNo, attemptNo)`; un movimiento por fila de origen `(batchId, sheetId, rowNo)` (en el MVP sustituye a `UNIQUE (transactionId, cycle, batchId)`, migración `0007`).
5. Vista o consulta de Settled por ciclo: existe fila en `SettlementTransaction` cuyo batch tiene `status = 'paid'`.
6. Pruebas de integración sobre SQL Server efímero con datos sintéticos que verifiquen migración, relaciones y restricciones.

**Criterios de aceptación:**

1. Dos intentos vigentes del mismo número y cuenta se rechazan; tras marcar uno como `undone` se admite otro con `attemptNo + 1`.
2. Un movimiento admite varios fees con importe y configuración aplicada, y `feeAmount` coincide con su suma.
3. La consulta de Settled no devuelve movimientos de batches `processed` ni `undone`; sí los de batches `paid`.
4. Las FK impiden guardar movimientos o fees sin batch, transacción o fee asociados.
5. Ninguna columna de importe es `money`, `float` ni `real`.
6. La migración aplica en limpio y las pruebas pasan en CI.

**Definición de hecho:** migración aplicable en una base limpia y documentada en 1.4; esquema y 3.2 alineados; revisión humana del DDL; pruebas de integración ejecutadas; sin datos reales; ADR-006 escrito.

**Fuera de alcance:** interfaz, lectura de Excel, motor de cálculo y flujo de deshacer (este ticket prepara su almacenamiento); esquema base (RT2-DB-000).

### Ticket 2 — RT2-BE-002 · Ejecutar validaciones de duplicados y colisiones

**Tipo:** Backend. **Historia:** HU2. **Estimación:** 8 puntos. **Depende de:** RT2-DB-000, RT2-DB-001, caso de uso de análisis (HU1), archivos de muestra con resultado esperado. **Issue:** [#8](https://github.com/kajirioji/AI4Devs-finalproject/issues/8) (motor de validaciones, [#41](https://github.com/kajirioji/AI4Devs-finalproject/pull/41)); las corridas, los endpoints y las acciones del analista siguieron en [#9](https://github.com/kajirioji/AI4Devs-finalproject/issues/9) ([#52](https://github.com/kajirioji/AI4Devs-finalproject/pull/52)).

**Objetivo:** identificar repeticiones e incompatibilidades después del cruce, conservar hallazgos con todas sus apariciones y evitar contabilizar dos veces un movimiento.

**Tareas:**

1. Implementar cuatro validaciones como funciones puras en `modules/validation/domain/`: `duplicate_in_batch`, `status_collision_in_batch`, `duplicate_across_batches`, `status_collision_across_batches`.
2. Comparar por identidad externa `(gatewayId, sourceTransactionId)` resuelta a `transactionId`, y por `cycle`, con la regla de 3.3: mismo estado → duplicado, estado distinto → colisión, con la excepción legacy `Chargeback` / `CHB 2` (`excludeAmount`) codificada en `statusRules.ts`; ningún par bloquea.
3. Considerar como anteriores los batches `processed` y `paid` de **todas las cuentas del proveedor**; excluir `undone`. Respetar el alcance por merchant del usuario.
4. Producir `ValidationIssue` con N `ConflictOccurrence` y la inclusión por defecto de cada aparición según las reglas de 3.2.
5. Caso de uso `RunValidations`: persiste corrida, ocho resultados con `outcome` (`passed` / `warning` / `blocked` / `not_applicable` / `not_implemented`, derivado de los hallazgos; `not_applicable` y las no implementadas nunca como aprobadas) y hallazgos en una transacción; una corrida nueva invalida la anterior sin borrarla.
6. Rutas `POST /imports/{id}/validations`, `GET /imports/{id}/validations`, `GET /imports/{id}/validation-issues`, `GET /validation-issues/{id}` con esquemas Zod, permiso y alcance; OpenAPI actualizado.
7. Tests unitarios primero (Red → Green → Refactor) y de integración contra `data/samples/provider-a-batch-118-collisions.xlsx` con su `expected.json`.

**Criterios de aceptación:**

1. Dos apariciones del mismo movimiento en el mismo ciclo generan un hallazgo de duplicado con dos apariciones, una incluida y otra excluida.
2. Un movimiento E y su reserva R no generan hallazgo.
3. Un movimiento incluido en un batch vigente anterior se señala con la aparición histórica como evidencia y la actual excluida.
4. Un batch `undone` no cuenta como anterior.
5. Una colisión muestra todas las apariciones con sus estados; ninguna se resuelve en silencio.
6. Los hallazgos quedan guardados sin exigir acción individual; los endpoints devuelven resultado, conteo y bloqueo por validación.
7. En un archivo legacy, un `Chargeback` y un `CHB 2` del mismo movimiento no generan hallazgo; un `Refund` y un `Chargeback` del mismo movimiento generan colisión no bloqueante. Para el archivo de muestra, la corrida reproduce exactamente el resultado esperado; para el batch limpio, las cuatro validaciones dan cero hallazgos; sin batches anteriores del proveedor, las dos validaciones *across batches* devuelven `not_applicable`. Cobertura del dominio ≥ 90 %; cada test se ha roto a propósito una vez. 2.000 filas contra 50.000 movimientos anteriores en menos de 2 segundos.

**Definición de hecho:** dominio sin dependencias de Prisma ni Fastify; pruebas unitarias e integración en verde en CI; contrato OpenAPI contrastado contra la respuesta real; sin `any`; diff revisado con los cinco focos del módulo de backend; `prompts.md` actualizado.

**Fuera de alcance:** las otras cuatro validaciones (`provider_mismatch`, `non_recorded_adjustment`, dos de faltantes); cambio de inclusión por el analista; cálculo de fees; interfaz.

### Ticket 3 — RT2-FE-003 · Pantallas Upload Files y Column Mapping

**Tipo:** Frontend. **Historia:** HU1. **Estimación:** 8 puntos. **Issue:** [#6](https://github.com/kajirioji/AI4Devs-finalproject/issues/6). **Depende de:** contrato OpenAPI 4.2 (puede empezar con respuestas simuladas); RT2-DB-000 y caso de uso de importación para la integración real.

**Objetivo:** cargar los archivos de la plantilla, revisar el pareo propuesto y confirmarlo antes de analizar.

**Tareas:**

1. Rutas en `features/imports/`: `/reconciliations/new?merchantId=&providerId=&accountId=`, donde se elige merchant → proveedor → cuenta activa dentro del alcance del usuario, y `/imports/$importId?step=files|mapping|analysis` para el espacio de trabajo de un import, que abre en el paso de su estado.
2. **Upload Files:** arrastrar y soltar, selector múltiple, solo `.xlsx` hasta 20 MB; lista de archivos con quitar y añadir mientras el import esté en `uploaded` o `mapped`; el `409` de archivo duplicado se muestra con el nombre coincidente sin perder el estado de la pantalla.
3. **Column Mapping:** una tarjeta por archivo y una sección por hoja con su nombre y la propuesta en lenguaje del analista (p. ej. `CHB` · `Proposed: I · Chargeback — global rule`); por hoja, tres controles que reflejan el contrato: tipo (`transactions` / `batch_fees` / `ignore`), ciclo y estado fijo, con el origen de la propuesta; selector de campo por columna con la lista cerrada de `targetField` salvo `gateway` (el API aún lo rechaza) y "Keep as reference"; vista previa de las 5 filas que devuelve el API, con la cabecera según el pareo en edición. La columna pareada como Transaction ID se muestra como texto tal cual se leyó, nunca como número.
4. **Readiness:** barra con "Ready to analyze" o la lista de lo que falta por hoja; **Analyze** deshabilitado hasta `canAnalyze = true`.
5. Acciones separadas **Confirm mapping** (`PUT /imports/{id}/mapping`) y **Analyze** (`POST /imports/{id}/analyze`) con estados de carga, errores `400/409/422` en contexto y navegación a Analysis & Validations con los contadores.
6. React Hook Form con los esquemas Zod compartidos; shadcn/ui; TanStack Table para la tabla de filas del análisis; TanStack Query con la respuesta de cada acción escrita en la caché.
7. Tests con Vitest y Testing Library: propuesta renderizada desde una respuesta del contrato; cambiar un selector actualiza la vista previa; `canAnalyze = false` deshabilita Analyze y muestra los faltantes; `409` y `422` se muestran junto al archivo. Accesibilidad: teclado, etiquetas, contraste AA, axe sin violaciones críticas.

**Criterios de aceptación:**

1. Solo aparecen cuentas de merchants dentro de mi alcance; la API impone la misma restricción.
2. Subir los dos archivos del batch de muestra produce dos tarjetas con sus hojas y número de filas; el estado fijo por hoja de `DEC` permite continuar sin columna de estado.
3. Si a una hoja no ignorada le falta el Transaction ID, Analyze está deshabilitado y la barra indica hoja y campo; al corregir y guardar, se habilita.
4. Subir de nuevo el mismo archivo muestra el error de duplicado y la pantalla conserva el pareo editado; quitar un archivo recalcula la barra.
5. Analyze lleva a la pantalla siguiente con filas asociadas, no asociadas, ambiguas e ignoradas; un ID de 16 dígitos o un UUID se muestran íntegros en la vista previa, sin notación científica ni truncado.
6. Después del análisis no se pueden modificar archivos; la pantalla ofrece cancelar y crear un import nuevo.
7. Funciona a 1280 px y 1024 px sin desplazamiento horizontal; tests en verde; sin errores de lint ni de tipos.

**Definición de hecho:** cliente generado desde el contrato (sin `fetch` manual); sin estado de servidor fuera de TanStack Query; tests en verde en CI; revisión visual contra 1.3 y capturas en `docs/wireframes/`; `prompts.md` actualizado.

**Fuera de alcance:** pantalla Analysis & Validations; administración de reglas de pareo; reglas de interpretación avanzada (roadmap); internacionalización (interfaz solo en inglés).

---

## 7. Pull Requests

Las pull requests de la Entrega 2 van de una rama por change (`feat/<módulo>-<tema>`) a `feature/entrega-2-MVP`, con la plantilla del repositorio y la CI en verde. Cada change pasa dos revisiones de IA antes del merge:

- **`/opsx:verify`** contrasta el código con la spec, el design y las tareas del change de OpenSpec (completitud, escenarios sin test, desfases con el README).
- **`review-diff`**, en una sesión independiente de la que escribió el código, revisa el diff con los cinco focos del módulo de backend (correctitud, seguridad, rendimiento, legibilidad y tests), concretados para este proyecto en la skill [`review-diff`](.claude/skills/review-diff/SKILL.md): fidelidad al README y al vocabulario fijo, dinero y fechas, pruebas reales, seguridad y datos sintéticos, y arquitectura hexagonal. Los hallazgos se clasifican HIGH / MEDIUM / LOW; cada uno se reproduce antes de corregirlo y se cierra con una pareja de commits test/fix o pasa a un issue tras el triaje humano.

El PR de archive (`/opsx:archive`, que sincroniza los delta specs con `openspec/specs/`) va en la misma fila que su change. Los issues que nacen del propose o del gate del design, no de las revisiones, se citan en la sección 1.5.

#### Tramo 1 — Acceso y catálogo

| PR | Título | Resumen | Qué revisó la IA |
|---|---|---|---|
| [#19](https://github.com/kajirioji/AI4Devs-finalproject/pull/19) · [#20](https://github.com/kajirioji/AI4Devs-finalproject/pull/20) | feat(auth): login con JWT, /auth/me y plugin de permisos | Access de 15 min y refresh de 7 días con rotación, logout, `/auth/me`, `requirePermission`; migración `0003_auth` | **Verify:** `authenticate` lee los merchants del usuario en una consulta; el `204` de logout, al OpenAPI; design y tareas alineados. Corregido en el PR. **Review-diff:** primer PR del proyecto, revisado con los cinco focos en la misma sesión; de ahí salió la regla de revisar cada diff en una sesión distinta de la que escribió el código |
| [#22](https://github.com/kajirioji/AI4Devs-finalproject/pull/22) | chore(openspec): regla de escenarios para los delta specs | Todo change que toque una capability deja cada requisito con al menos un escenario | Sin verify ni review-diff: configuración de OpenSpec, sin código ([#21](https://github.com/kajirioji/AI4Devs-finalproject/issues/21)) |
| [#23](https://github.com/kajirioji/AI4Devs-finalproject/pull/23) · [#25](https://github.com/kajirioji/AI4Devs-finalproject/pull/25) | feat(catalog): catálogo en solo lectura con alcance por merchant | Nueve `GET` del catálogo con el alcance aplicado en la consulta; lo ajeno responde `404`, nunca `403` | **Verify:** sin críticos; aviso y sugerencia resueltos. **Review-diff:** el alcance solo se aplicaba en un lado de las uniones `AccountChannel` y podía revelar una cuenta o un canal ajenos → corregido con filas cruzadas en la integración; la garantía en BD, a [#24](https://github.com/kajirioji/AI4Devs-finalproject/issues/24). `IntId` sin tope ni solo dígitos → `400 validation_error` |
| [#26](https://github.com/kajirioji/AI4Devs-finalproject/pull/26) · [#28](https://github.com/kajirioji/AI4Devs-finalproject/pull/28) | feat(frontend): scaffold, sesión con JWT, Login y Accounts | Frontend con cliente generado del OpenAPI, sesión compartida entre pestañas (Web Locks), menú por permisos, Login y Accounts | **Verify:** tras el merge; en #28 el delta se alineó con las correcciones del review. **Review-diff:** 7 hallazgos; corregidos la expiración anunciada a todas las pestañas, Sign out con una petición en vuelo, `safeRedirect` por origen y validación del refresh; dos aceptados como nota y los LOW, a [#27](https://github.com/kajirioji/AI4Devs-finalproject/issues/27) |
| [#30](https://github.com/kajirioji/AI4Devs-finalproject/pull/30) · [#31](https://github.com/kajirioji/AI4Devs-finalproject/pull/31) | chore(api): colección Bruno de la API y pnpm test:api | Colección Bruno con caso feliz y negativo por endpoint, y `pnpm test:api` / `test:api:smoke` | **Verify:** dos sugerencias de design (`selfAuth`, `bru run -r`) aplicadas en #31. **Review-diff:** README §4 desalineado (endpoints anónimos, códigos en minúsculas), `selfAuth` en los logins, cuenta de prueba resuelta en un solo punto. Corregido en el PR |

#### Tramo 2 — Importar y parear (HU1)

| PR | Título | Resumen | Qué revisó la IA |
|---|---|---|---|
| [#33](https://github.com/kajirioji/AI4Devs-finalproject/pull/33) · [#35](https://github.com/kajirioji/AI4Devs-finalproject/pull/35) | feat(import): subida de archivos de la plantilla y propuesta de pareo | Lector `.xlsx` propio (todo como texto), archivo original conservado y propuesta de pareo con `readiness` | **Verify:** sin críticos; mover `scope.ts` a `shared/` → [#32](https://github.com/kajirioji/AI4Devs-finalproject/issues/32). **Review-diff:** dos HIGH: una referencia de celda gigante (`ZZZZZ1`) eludía el límite de columnas (DoS) y un fallo tras la transacción borraba archivos ya guardados → corregidos; multipart malformado `500` → `400`; la 2.ª ronda halló un cuelgue introducido por ese arreglo → corregido. LOW → [#34](https://github.com/kajirioji/AI4Devs-finalproject/issues/34) |
| [#36](https://github.com/kajirioji/AI4Devs-finalproject/pull/36) · [#37](https://github.com/kajirioji/AI4Devs-finalproject/pull/37) | feat(import): confirmar pareo, analizar y cruzar por identidad externa | Confirmar pareo, analizar (IDs normalizados, cruce por identidad externa, `ImportRow`), resolver ambiguas y cancelar | **Verify:** sin críticos; escenarios pendientes cubiertos; la búsqueda sin seek (`NVARCHAR` contra `VARCHAR`) pasó a `OPENJSON … WITH`: de 24,5 s a 14 s con 20 000 filas. **Review-diff:** escrituras sin guarda de estado → `UPDATE` condicionado; doble `PATCH` de una ambigua; datos de otro merchant visibles → ocultos con `outOfScope`; la 2.ª ronda halló más fugas y una carrera en el cancel. Todo corregido en el PR |
| [#43](https://github.com/kajirioji/AI4Devs-finalproject/pull/43) · [#46](https://github.com/kajirioji/AI4Devs-finalproject/pull/46) | feat(web): pantallas de importación y smoke E2E | New Reconciliation, Upload Files, Column Mapping y Analysis sobre MSW, y el primer smoke E2E con Playwright y Gherkin | **Verify:** ejecutado; sus hallazgos no constan en el PR. **Review-diff:** las hojas de un archivo quitado seguían en el formulario y bloqueaban Analyze; la contraseña podía quedar en la instantánea de Playwright si el login fallaba (verificado con un login colgado). Corregidos, con timeouts propios en el smoke en la 2.ª ronda |

#### Tramo 3 — Validar y decidir (HU2)

| PR | Título | Resumen | Qué revisó la IA |
|---|---|---|---|
| [#41](https://github.com/kajirioji/AI4Devs-finalproject/pull/41) · [#45](https://github.com/kajirioji/AI4Devs-finalproject/pull/45) | feat(validation): motor puro de las ocho validaciones | Las ocho validaciones como funciones puras con TDD contra los `expected.json`; nuevo vocabulario de `outcome` | **Verify:** sin críticos. **Review-diff:** tres rondas. El rango R por fecha de creación daba faltantes falsos → por vencimiento, con oráculos recalculados; una RR repetida liberaba dos veces la reserva; el contador de candidatas I siempre valía 0. Corregidos; el plazo aplicado de la reserva → [#44](https://github.com/kajirioji/AI4Devs-finalproject/issues/44) |
| [#52](https://github.com/kajirioji/AI4Devs-finalproject/pull/52) · [#54](https://github.com/kajirioji/AI4Devs-finalproject/pull/54) | feat(validation): corridas, hallazgos, acciones del analista y decisión de conjunto | Corridas con una sola vigente, hallazgos, inclusión y resolución auditadas, `POST review` y su invalidación; migración `0006` | **Verify:** sin críticos; separar el lector de hallazgos → [#51](https://github.com/kajirioji/AI4Devs-finalproject/issues/51). **Review-diff:** `occurrenceId` fuera de BIGINT daba `500` → `400`; un test no detectaba un review leído antes de la guarda → reproducido y reescrito con el gancho `beforeClaim`; el review no fija las inclusiones vistas → aceptado, [#53](https://github.com/kajirioji/AI4Devs-finalproject/issues/53). Resto → #51 |
| [#57](https://github.com/kajirioji/AI4Devs-finalproject/pull/57) · [#58](https://github.com/kajirioji/AI4Devs-finalproject/pull/58) | feat(frontend): pantalla Analysis & Validations | Tabla de las ocho validaciones, hallazgos, drawer con inclusión y resolución, Continue y Cancel | **Verify:** tests de subida intermitentes con las tres suites en paralelo → [#56](https://github.com/kajirioji/AI4Devs-finalproject/issues/56). **Review-diff:** sin guarda síncrona en las acciones del drawer (dos clics, dos `PATCH`) → guarda con test; el API falso pasa ahora por los esquemas de `@recon/shared`. LOW corregidos |
| [#59](https://github.com/kajirioji/AI4Devs-finalproject/pull/59) | docs(openspec): specs principales en verde con --strict | Escenarios para `fees` y `settlement`: `openspec validate --specs --strict` en verde | Sin verify ni review-diff: solo specs |

#### Tramo 4 — Liquidar y resumir (HU3)

| PR | Título | Resumen | Qué revisó la IA |
|---|---|---|---|
| [#66](https://github.com/kajirioji/AI4Devs-finalproject/pull/66) · [#69](https://github.com/kajirioji/AI4Devs-finalproject/pull/69) · [#70](https://github.com/kajirioji/AI4Devs-finalproject/pull/70) | feat(settlement): procesar el batch con fees, canales y resolución de faltantes | Intento de batch con movimientos por ciclo, fees vigentes, `Other Fees`, desglose del payable y canales; migraciones `0007` y `0008` | **Verify:** el número podía nombrar el intento de otra cuenta → corregido; siete escenarios sin test, cubiertos; lo pendiente → [#65](https://github.com/kajirioji/AI4Devs-finalproject/issues/65). **Review-diff:** ningún test ejercitaba el bloqueo del número y la última barrera se probaba con errores inventados → violaciones reales; canales decididos sin bloqueo → relectura bloqueada; reintento ante interbloqueos y `409 settlement_busy`. Fondo → [#67](https://github.com/kajirioji/AI4Devs-finalproject/issues/67) |
| [#71](https://github.com/kajirioji/AI4Devs-finalproject/pull/71) · [#73](https://github.com/kajirioji/AI4Devs-finalproject/pull/73) | feat(settlement): Settlement Summary, movimientos y CSV del Back-Office | Relectura del intento y sus movimientos, Summary del merchant y CSV del Back-Office (TXN y RR) auditados | **Verify:** intento deshecho, desglose del seed y orden de los intentos → corregidos. **Review-diff:** faltaban negativos `404` en Bruno → añadidos; mapeos y validación del ciclo → corregidos; la validación corre antes que la autenticación en todo el API → [#72](https://github.com/kajirioji/AI4Devs-finalproject/issues/72) |
| [#74](https://github.com/kajirioji/AI4Devs-finalproject/pull/74) · [#76](https://github.com/kajirioji/AI4Devs-finalproject/pull/76) | feat(frontend): pantallas Settlement Review y Settlement Summary | Review con número, fecha, fees por batch, vista previa calculada en el servidor y canales; Summary con descargas | **Verify:** 47/48 tareas (faltaba la descripción del PR); todos los requisitos con implementación y test; ninguna cifra calculada en el navegador; cuatro huecos de documentación corregidos en el PR (escenario "Summary con teclado", y D15, D16 y D17 del design). **Review-diff:** Retry tras `settlement_busy` sin los motivos de Process; se perdía el motivo del `409 import_not_validated`; Process pulsable con la vista previa recargándose. Corregidos; la calidad de los tests del falso → [#75](https://github.com/kajirioji/AI4Devs-finalproject/issues/75) |

#### Cierre — Navegación y revisión con usuarios

| PR | Título | Resumen | Qué revisó la IA |
|---|---|---|---|
| [#88](https://github.com/kajirioji/AI4Devs-finalproject/pull/88) · [#89](https://github.com/kajirioji/AI4Devs-finalproject/pull/89) | feat(settlement): Settlement List de una cuenta y pestaña Movements (#64) | `GET /accounts/{id}/settlements` con filtros, paginación y alcance; pantalla Settlement List desde el menú y desde Accounts; pestaña Movements del Summary con los movimientos E/I/R | **Verify:** sin errores de código; el flujo de Bruno no comprobaba el orden tras el intento nuevo → petición añadida; unificar los ayudantes de texto → [#90](https://github.com/kajirioji/AI4Devs-finalproject/issues/90). **Review-diff:** aprobar con cambios menores. El test del rango al revés no esperaba a la petición; `whitespace-nowrap` y el script de capturas pasaron a fallar si algo desborda; filtro por `processedAt` en Bruno sin efecto si se ignoraba `dateField`; páginas fuera de rango; placeholder de Movements con filas del intento anterior. Corregidos con test y rotura a propósito |
| [#91](https://github.com/kajirioji/AI4Devs-finalproject/pull/91) · [#95](https://github.com/kajirioji/AI4Devs-finalproject/pull/95) | feat(frontend): pulido de la interfaz tras la revisión del 20-oct (ui-polish) | Las doce observaciones de la [revisión del 20 de octubre](docs/uat/2026-10-20-revision-interfaz.md): menú, tarjetas, barra superior, bloques por archivo, readiness, colores de estado por enumeración, tabla de rangos, contadores, cabecera del Summary, fechas sin `ET` y navegación sin volver arriba. Solo frontend | **Verify y revisión del PR:** el foco podía pedirse sin cambio en la lista → defensas complementarias con su test; el aviso de no Settled usaba un color fijo → tono del mapa, con test que falla ante un color fijo; la línea de por qué es faltante se ciñe a §3.3; docs y tareas desactualizados, corregidos. Cobertura y deuda menor sin bloquear → [#94](https://github.com/kajirioji/AI4Devs-finalproject/issues/94) |
