# Documento de Prompts para Desarrollo de Proyecto

> Detalla en esta sección los prompts principales utilizados durante la creación del proyecto, que justifiquen el uso de asistentes de código en todas las fases del ciclo de vida del desarrollo. Esperamos un máximo de 3 por sección, principalmente los de creación inicial o los de corrección o adición de funcionalidades que consideres más relevantes.
> Puedes añadir adicionalmente la conversación completa como link o archivo adjunto si así lo consideras

## Cómo se ha usado la IA en este proyecto

**Flujo de trabajo con el código (Entrega 2).** Cada feature es un change de **OpenSpec** que nace de su issue. `/opsx:propose` genera el proposal, los delta specs, el design y las tareas, y ahí está el **gate humano**: la persona revisa los artefactos, resuelve las preguntas abiertas y decide las reglas de negocio que el README no cubría (se llevan al README antes de programarlas); sin esa aprobación no se escribe código. `/opsx:apply` implementa `tasks.md` **grupo a grupo con TDD**: primero los tests, en un commit `test:` que falla; después el código; y al cerrar el grupo se rompe el código a propósito una vez para ver caer su test. Ningún test se modifica para que pase; si uno está mal, se dice y lo decide la persona. Las migraciones las escribe el agente y las revisa y aplica la persona. Con el change terminado, `/opsx:verify` contrasta el código con la spec, el design y las tareas. Después, `review-diff` revisa el diff con los cinco focos del proyecto **en una sesión independiente** de la que escribió el código, para que nadie se dé el visto bueno a sí mismo. Cada hallazgo se reproduce antes de corregirlo y se cierra con su pareja de commits test/fix o pasa a un issue tras el triaje de la persona. El PR se fusiona con la CI en verde y el change se archiva con `/opsx:archive` en un PR propio. Para avanzar en paralelo (por ejemplo, el backend de un tramo y sus pantallas, construidas contra el contrato que publica el design del backend y con un API falso de MSW), cada línea de trabajo tiene su propio **git worktree** y su propia sesión. La persona coordina los turnos de la base de datos y de los puertos que comparten, y el orden de los rebases sobre la rama de entrega.

**Herramientas y modelos.** La documentación técnica se ha trabajado con **Claude (aplicación de escritorio, modo Cowork; modelo Claude Opus 5.5)** dentro de un proyecto de Claude que aporta contexto persistente: el documento de situación actual del sistema que se reemplaza, limitantes actuales y funcionalidades deseadas, el esquema actual de su base de datos y los documentos de trabajo del proyecto. La revisión cruzada de la documentación se realizó con **ChatGPT, modelo GPT-6 Astra**, contrastando los dos archivos con los requisitos de entrega y las reglas del negocio aclaradas por el autor. El código y los tests se trabajan con **Claude Code** sobre el repositorio: cada feature es un change de **OpenSpec** (`/opsx:propose` → revisión humana del proposal, la spec y el design → `/opsx:apply` → `/opsx:verify` → `/opsx:archive`), con `AGENTS.md` como contexto y **skills** del proyecto versionadas (`new-feature`, `tdd`, `review-diff`). Los **hooks** formatean con Biome al guardar, bloquean la edición de `schema.prisma` y de las migraciones fuera de un change abierto, e impiden que el agente ejecute el seed o las migraciones (los ejecuta la persona dentro de la sesión, con la salida visible). Cada diff se revisa con `review-diff` (los cinco focos de la sección 7) **en una sesión aparte** de la que escribió el código.

**Método de trabajo.** Se aplican los tres pilares: **herramienta** (el copiloto adecuado a cada fase), **contexto** (todo el conocimiento del dominio se entrega como documentos, no se deja que el modelo lo invente) y **prompt** (peticiones con criterios de éxito explícitos y vocabulario cerrado). Cada sección de la plantilla sigue el mismo ciclo Explore → Plan → Execute con gate humano: el asistente explica qué pide la sección ; el autor aporta el dominio; el asistente **propone en la conversación antes de escribir en el documento**; el autor corrige vocabulario, reglas de negocio y alcance; y solo entonces se aplica al borrador y se registra la decisión. Las decisiones de producto y de arquitectura las toma el autor respondiendo preguntas cerradas del asistente; el asistente redacta, estructura, propone alternativas y hace de *poke-holes* sobre lo que falta.

**Qué ha aportado la IA.** Análisis del enunciado y de los repositorios de ejemplo para calibrar el nivel esperado; mapa de cada requisito de la plantilla; redacción de todas las secciones a partir de las fuentes del autor; ingeniería inversa del esquema de la versión actual (30 tablas) para proponer el modelo nuevo y justificar cada cambio; contrato OpenAPI; y verificación de los diagramas Mermaid renderizándolos antes de entregar.

**Ajustes humanos.** Los de más peso: el vocabulario del dominio ("creación de cuentas", no "alta"; los fees no se dan de baja, se cierran por vigencia); que las validaciones no bloquean pero quedan registradas con quién aprobó el batch; la jerarquía real merchant → proveedor → cuenta → canal y qué viene del gateway frente a qué es propio de la herramienta; la regla de la cuenta principal de un canal; los fees por batch como algo que indica el proveedor y se agrega a mano; la elección de SQL Server 2022 para aprovechar la versión actual; y `DECIMAL(19,4)` en lugar de `MONEY`. En varios puntos el asistente propuso lo contrario de lo decidido y la decisión final, documentada como ADR, fue del autor.

### Revisión cruzada de la documentación — 25 de septiembre de 2026

**Herramienta y modelo.** ChatGPT — GPT-6 Astra.

*Contexto.* Con el borrador de `readme.md` y `prompts.md` preparado, se solicitó una segunda revisión antes de completar la entrega técnica. Se proporcionaron los requisitos del curso, las plantillas oficiales y aclaraciones del funcionamiento actual: el gateway principal y un gateway alterno que se evaluó, consolidación en el servidor de base de datos y reportes, diferencia entre transacción reconciliada y batch pagado, cruce por identificadores y reglas de rolling reserve según proveedor.

*Prompt representativo (literal).* «Listo, te voy a mandar mis dos archivos para que los revises en contra de estos requerimientos. Sé que le faltan unos detalles. Pero quiero ver que analices inconsistencias, faltantes, cosas por mejorar.»

*Resultado.* Revisión de cobertura de la plantilla y de coherencia entre funcionalidades, modelo de datos, API, historias y tickets. Se señalaron conflictos entre las restricciones de unicidad y el reprocesamiento de batches; falta de definición del tratamiento de duplicados aceptados; reglas de reserva ante chargeback no representadas; identidad de transacciones entre gateways; desglose de fees y moneda del batch; contradicciones de estados y pareo; y una diferencia de 500 en el ejemplo de `amountPayable`. También se identificaron ajustes necesarios en el contrato OpenAPI y un alcance elevado para el tiempo orientativo del curso.

*Ajuste humano y estado.* El autor decidió trabajar primero en el registro de IA y solicitó incorporar esta revisión. Las observaciones sobre diseño y alcance quedan pendientes de evaluación y aplicación; no se consideran decisiones aprobadas ni correcciones implementadas. Esta revisión fue documental: no acredita pruebas del código ni del sistema en ejecución.

### Revisión colaborativa por secciones — decisiones del autor

**Herramienta y modelo.** ChatGPT — GPT-6 Astra. **Fecha:** 25 de septiembre de 2026.

*Solicitud y contexto utilizado (resumen).* El autor pidió revisar y actualizar el README paso a paso a partir de su documentación del sistema existente. La conversación se utilizó para aclarar reglas reales, presentar cada historia y ticket, recibir correcciones y aplicar únicamente las decisiones acordadas. Los prompts breves dependían del contexto documental y de las respuestas anteriores; no eran solicitudes aisladas de generar un sistema desde cero.

*Aportes y correcciones humanas.* El autor confirmó importación directa con reglas de interpretación; revisión conjunta de advertencias; persistencia de incidencias y no doble contabilización de duplicados; reprocesamiento con historial; USD y formatos de identificadores; múltiples fees según fecha del evento; reserva según porcentaje aplicado a la transacción y plazos del canal recibidos del gateway; y aislamiento por merchant con perfiles separados. Corrigió expresamente que Settled requiere batch procesado y pagado, mientras los CSV se generan al procesar y se ejecutan manualmente después del pago. Precisó que el gateway no conserva un historial completo de eventos y que la asignación de canales solo distribuye pendientes, sin reversión automática al deshacer.

*Resultado.* Se actualizaron las reglas y sus referencias y se aprobaron tres historias (importar e interpretar; revisar resultados; procesar y dar seguimiento al pago) y tres tickets representativos (persistencia, duplicados/colisiones e interfaz de importación). Arquitectura, stack y despliegue siguen como propuestas pendientes de validar; las pruebas están previstas, no ejecutadas.

*Estado.* Se aplicaron las historias y tickets aprobados. Quedan pendientes el detalle técnico de interpretación, fechas por ciclo para faltantes, matriz de incompatibilidades y rondas, contrato OpenAPI completo, wireframes y revisión final de consistencia. La aprobación de las reglas no equivale a implementación ni a validación técnica.

**Convención de cada entrada.** *Contexto* → *Prompt* (resumen de lo que se pidió, no literal) → *Resultado* → *Ajuste humano*.

---

## Índice

1. [Descripción general del producto](#1-descripción-general-del-producto)
2. [Arquitectura del sistema](#2-arquitectura-del-sistema)
3. [Modelo de datos](#3-modelo-de-datos)
4. [Especificación de la API](#4-especificación-de-la-api)
5. [Historias de usuario](#5-historias-de-usuario)
6. [Tickets de trabajo](#6-tickets-de-trabajo)
7. [Pull requests](#7-pull-requests)

---

## 1. Descripción general del producto

**Prompt 1:**

*Contexto.* Arranque del proyecto: entender el enunciado y elegir la idea sin dedicar demasiado tiempo a decidir.

*Prompt.* Con el enunciado oficial y la descripción de los dos proyectos de ejemplo como contexto, se pidió al asistente que, conociendo el perfil del autor, listara las opciones de dominio mencionadas, las de los ejemplos con un resumen de cada una, y sugerencias; y que propusiera ideas de proyecto adecuadas y planteara las preguntas de filtro necesarias; que analizara requisitos y ejemplos para trazar una lista de requerimientos a ir completando a manera de checklist.

*Resultado.* Lista de opciones; cuatro ideas ajustadas al perfil con una recomendación; un documento de trabajo con el checklist de las tres entregas, la lectura de los dos ejemplos (el listón realista para 30 horas es el Ejemplo 1), el mapa requisito → módulo y las fuentes pendientes; y cuatro preguntas cerradas para decidir stack, base de datos, visibilidad del repositorio y núcleo del MVP.

*Ajuste humano.* No se adoptó ninguna idea tal cual: se decidió **Recon Tool 2.0**, la sustitución de una herramienta real de reconciliaciones, pero incluía una idea recomendada por el asistente (cruce de archivos del proveedor contra las transacciones propias) se incorporó como núcleo del MVP.

**Prompt 2:**

*Contexto.* El asistente pidió el conocimiento del dominio antes de redactar el objetivo. En lugar de responder por partes, el autor escribió un documento propio.

*Prompt.* Se entregó al asistente un documento de situación actual del sistema que se reemplaza, en tono "se lo explico a alguien nuevo del equipo": qué es (reportes SSRS usados como aplicación), una reconciliación de principio a fin, los archivos de los proveedores y la plantilla, con qué campos se hace el enlace, las ocho validaciones, las tablas que se consultan, qué duele de la versión actual, el sistema de un merchant como referencia de reportería y qué cambia en la versión nueva. Se le pidió leerlo, aclarar dudas en caso de haberlas, separar funcionalidades para establecer un alcance para el MVP y poder redactar el objetivo y las funcionalidades a partir de él.

*Resultado.* Copia de referencia del documento en el proyecto; tres observaciones que corregían lo hablado hasta entonces (el cruce es presencia por ID y coherencia de estados, no matching por monto; el tipo de liquidación E/I/R debe ser el eje del modelo; aparecen requisitos nuevos como roles, fees con historial y deshacer con rastro); roadmap y la redacción de 1.1 y 1.2 con el corte MVP.

*Ajuste humano.* Correcciones puntuales al texto: que la nueva versión habilita funcionalidades nuevas y mejora la experiencia en las existentes; "los analistas del equipo"; que el Back-Office tampoco indica los fees pagados; que SSRS no está diseñado para ese uso y obliga a rodeos; y, en el valor aportado, el control sobre los parámetros de la herramienta desde la propia herramienta.

**Prompt 3:**

*Contexto.* Cerrar el catálogo y los fees en 1.2 y el mapa de pantallas en 1.3 con reglas de negocio que el asistente no podía conocer.

*Prompt.* Se aclaró la jerarquía merchant → proveedor → cuenta → canal; que un merchant no ve los proveedores de otro aunque los compartan; que merchants, proveedores, canales y transacciones vienen de los gateways y que la cuenta es la única entidad propia de la herramienta (agrupación lógica de canales para llevar contabilidades separadas); que un canal nuevo no viene asociado a ninguna cuenta y se asocia al procesar un settlement; que solo los fees por transacción se calculan y los demás se agregan manualmente al batch porque los indica el proveedor; y se pidió una lista de pantallas con nombres en inglés (login, dashboard, settlements, payments, search, reports, administración de cuentas, fees y usuarios). Ante la pregunta del asistente sobre qué ocurre con la cuenta principal de un canal cuando otra cuenta procesa un settlement con él, se definió que la principal pasa a ser la última cuenta que procesó un settlement de ese canal.

*Resultado.* El asistente confirmó por escrito lo entendido y listó los cambios que disparaba en 1.2, 1.3, 3, 4 y 5 antes de aplicarlos; propuso una tabla de 23 pantallas en inglés agrupadas por menú y marcadas MVP / roadmap, y el recorrido del flujo principal en Mermaid con los mismos nombres.

*Ajuste humano.* La regla de la cuenta principal se definió al contrario de lo que sugería el asistente (que proponía mantenerla fija y cambiarla solo por acción explícita).

---

## 2. Arquitectura del Sistema

### **2.1. Diagrama de arquitectura:**

**Prompt 1:**

*Contexto.* Decidir la arquitectura y las dos incógnitas que cambiaban el diagrama.

*Prompt.* Tras la explicación del asistente sobre qué evalúa cada punto de la sección, se respondieron sus dos preguntas cerradas: la nueva versión lee las transacciones propias desde **una tabla propia** (sintética en el MVP, alimentada desde los gateways en producción), no consulta al gateway en vivo; y el despliegue de demostración se hace en un **servidor propio con túnel público**.

*Resultado.* Sección 2.1 con monolito modular hexagonal (Fastify + Prisma + Zod), justificación específica del proyecto (la lógica de reconciliación es lo que hay que testear; el origen de las transacciones va a cambiar; un solo despliegue para el tamaño del equipo), sacrificios explícitos y una tabla de cinco ADR.

*Ajuste humano.* Se observó que el diagrama de arquitectura era ilegible por tamaño, que si se podia reorganizar o dividir de forma que se lea mejor. El asistente explicó que GitHub escala el Mermaid al ancho de página sin zoom propio y partió el diagrama en tres vistas C4 (contexto, contenedores, interior del backend).

**Prompt 2:**

*Contexto.* La base de datos: la decisión inicial era PostgreSQL con portabilidad posterior a SQL Server.

*Prompt.* Se planteó al asistente quedarse en SQL Server 2022 desde el MVP para aprovechar el esquema y la lógica de la versión actual y evitar cambios entre versiones.

*Resultado.* El asistente aceptó y argumentó que era mejor que la decisión anterior (el paso a producción es un despliegue, no una migración), con dos condiciones: `docker-compose` con la imagen oficial para que el proyecto se levante en cualquier máquina, y ORM agnóstico igualmente. Quedó como ADR-002 y cambió 0.4, 1.4, 2.1, 2.4 y el ticket de base de datos.

*Ajuste humano.* Se detectó una contradicción entre las instrucciones de instalación (que usaban `sa`) y la sección de seguridad (que lo prohibía). Se corrigió con un script de inicialización que crea un usuario de aplicación con permisos mínimos.

### **2.2. Descripción de componentes principales:**

**Prompt 1:**

*Contexto.* Los componentes se derivan del diagrama; se pidió redactarlos sin introducir decisiones nuevas.

*Prompt.* Redactar la descripción de componentes a partir de las decisiones de 2.1, con la tecnología de cada uno y sin añadir piezas que no estuvieran en el diagrama.

*Resultado.* Nueve componentes con su tecnología: frontend, API HTTP, los módulos de catálogo, fees, importación, validaciones, settlement y exports, persistencia y autenticación.

*Ajuste humano.* Ninguno de fondo; el asistente ofreció sustituir nombres de librerías por descripciones genéricas y no fue necesario.

### **2.3. Descripción de alto nivel del proyecto y estructura de ficheros**

**Prompt 1:**

*Contexto.* Definir el monorepo y la estructura interna por módulo.

*Prompt.* Proponer la estructura de carpetas coherente con el patrón hexagonal por módulo y siguiendo las buenas prácticas (contexto para copilotos y documentación versionadas junto al código).

*Resultado.* Árbol con `backend/` (módulos `domain/ application/ infrastructure/ http/`), `frontend/` por *feature*, `docs/` (ADR, diagramas, `openapi.yaml`, wireframes), `data/samples/`, `e2e/`, `AGENTS.md` y `.claude/`.

*Ajuste humano.* Pendiente de validar contra el código en la siguiente entrega.

### **2.4. Infraestructura y despliegue**

**Prompt 1:**

*Contexto.* Elegir dónde vive la demostración pública de las entregas de código.

*Prompt.* Se eligió, entre las opciones planteadas por el asistente (servidor propio con túnel público, PaaS gratuita y vídeo como evidencia), el servidor propio con Docker Compose y túnel público, con SQL Server en una máquina dedicada.

*Resultado.* Tabla de tres entornos (local, demostración, producción futura), diagrama de infraestructura, proceso de despliegue manual primero y automatizado con GitHub Actions después, túnel para la URL pública y vídeo como respaldo ante indisponibilidad del servidor.

*Ajuste humano.* Ninguno todavía; el montaje del túnel se documentará paso a paso en la entrega de código.

**Prompt 2:**

*Contexto.* Issue #97: desplegar con URL pública. Change de OpenSpec `deploy-compose`, limitado a lo que vive en el repositorio; el túnel y el servidor se configuran a mano siguiendo la guía.

*Prompt.* `/opsx:propose deploy-compose` con el alcance del issue (Dockerfiles, compose con túnel y red interna, migración y seed explícitos, plantilla de variables, CI de imágenes y `docs/deploy.md` en lenguaje llano), sin mencionar el nombre ni la ubicación del servidor. Después, `/opsx:apply` con un commit por grupo, parando en cada paso que necesita Docker.

*Resultado.* Imágenes de API y web, `infra/docker-compose.deploy.yml` con overrides para depuración y SQL Server externo, identidad `recon_migrator` separada de `recon_app`, `scripts/deploy.sh`, job `images` en la CI y la guía. Con SQL Server en el compose por defecto, en lugar de la máquina dedicada del plan inicial.

*Ajuste humano.* El autor revisó el gate de diseño y exigió tres cambios: el arreglo de `pnpm start` en su propio commit, la regla de rate limiting sobre el login como paso obligatorio con sus clics y la base en `feature/entrega-3-MVP`. Las pruebas que el autor ejecutó con Docker destaparon un fallo que los tests no veían: tras reiniciar sobre un volumen con datos, `mssql` moría con `Msg 904`. Se corrigió reintentando la inicialización, y de paso se evitó que un reinicio devolviera `db_ddladmin` a `recon_app`.

### **2.5. Seguridad**

**Prompt 1:**

*Contexto.* La sección incorporó prácticas del módulo de privacidad (datos sintéticos) y del de bases de datos (usuario de aplicación, revisión humana de DDL, solo lectura para agentes).

*Prompt.* Se cuestionó la afirmación de que los montos nunca deben manejarse como `float`, preguntando si el tipo `MONEY` de SQL Server tampoco era adecuado y cuál era la recomendación.

*Resultado.* Explicación de por qué `DECIMAL(19,4)` sobre `MONEY` (redondeo en operaciones intermedias, que en reconciliación se traduce en disputas de centavos; portabilidad y mapeo limpio en el ORM) y actualización de 2.5 y 3.2.

*Ajuste humano.* Se aceptó la recomendación; la versión actual usa `money` en 40 columnas y el cambio quedó justificado en la tabla de migración del modelo.

### **2.6. Tests**

**Prompt 1:**

*Contexto.* Estrategia de tests para una entrega sin código.

*Prompt.* Redactar la estrategia aplicando los módulos de testing (TDD con agentes, romper el test a propósito, Playwright y Gherkin, contenedores efímeros para integración), con ejemplos concretos del dominio en cada nivel.

*Resultado.* Tres niveles con ejemplos: la colisión de estados como test unitario, el conflicto de fee solapado como integración, el flujo importar → validar → liquidar como E2E; cobertura objetivo y mutation testing sobre validaciones.

*Ajuste humano.* Se pidió aclarar en el texto qué significa el código de respuesta `409`.

---

### 3. Modelo de Datos

**Prompt 1:**

*Contexto.* Evitar que el asistente inventara el modelo: trabajar sobre el esquema real y nuevas funcionalidades.

*Prompt.* Se preguntó al asistente si disponía del esquema actual y, como no era así, se le entregó el script generado desde SQL Server Management Studio (30 tablas, 15 procedimientos, 3 vistas/funciones) con la petición de analizar qué sirve, qué hay que agregar y qué se va.

*Resultado.* El asistente parseó el script (tablas, tipos, claves, `UNIQUE`, `DEFAULT`, índices y el uso de ciertos campos en los procedimientos) y produjo: una tabla "de la versión actual a la nueva" fila por fila; cinco diagramas `erDiagram` por área; y la descripción de entidades con tipos y restricciones. Cambios principales propuestos: normalizar las 40 columnas `money` de la tabla de batches en tablas de totales; unificar seis tablas de validación e incidencias en corrida → resultado → caso con la decisión del analista; sustituir la unicidad por tipo y cuenta de los fees por no solapamiento de vigencias; y reemplazar los tres flags de liquidación por filas de settlement por ciclo.

*Ajuste humano.* Se aclaró el significado de *file group* (varios archivos que constituyen un mismo settlement y una sola contabilidad) y el asistente lo hizo explícito en la entidad de importación.

**Prompt 2:**

*Contexto.* Verificar que los diagramas funcionen donde se van a leer.

*Prompt.* A partir de la observación de legibilidad hecha en 2.1, el asistente propuso y ejecutó por iniciativa propia el renderizado de todos los bloques Mermaid con `mermaid-cli`.

*Resultado.* Los diez diagramas compilan; el mayor se partió en dos ("Catálogo y fees" y "Reglas de pareo, usuarios y roles").

*Ajuste humano.* Ninguno.

**Prompt 3:**

*Contexto.* Incorporar al modelo la jerarquía real del gateway y los fees por batch.

*Prompt.* Las aclaraciones de negocio del Prompt 3 de la sección 1, más la regla de que los fees no transaccionales tienen un monto preestablecido ajustable al agregarlos a un batch y que existen categorías de importe libre (correcciones de batches anteriores, ajustes por duplicados, penalizaciones). Se pidió al asistente confirmar lo entendido y los cambios que disparaba antes de aplicarlos.

*Resultado.* Merchant, proveedor y canal como tablas de solo lectura alimentadas desde el gateway; la asociación cuenta-canal como relación con historia (una sola principal por canal, garantizada con un índice único filtrado); tipos de fee con importe libre; y una tabla de fees por batch con su restricción.

*Ajuste humano.* La regla de cuenta principal es del autor.

---

### 4. Especificación de la API

**Prompt 1:**

*Contexto.* Elegir los tres endpoints que la plantilla permite documentar.

*Prompt.* Ante la propuesta inicial del asistente (importar, validaciones, settlement), se pidió primero una lista de todos los endpoints posibles y se sugirió elegir endpoints vistosos, poniendo como ejemplo la creación de un fee para una cuenta: una pantalla donde se agregan uno a uno con tipo, monto fijo o porcentaje, importe y vigencia, con la regla de que no puede haber dos fees del mismo tipo con rangos que se solapen.

*Resultado.* Inventario de endpoints por área con permisos; propuesta de tres (crear fee, importar, liquidar) con la justificación de qué demuestra cada uno; y la consecuencia sobre el alcance: la administración de fees pasaba de roadmap a MVP.

*Ajuste humano.* Se movió fees al MVP **con historial de cambios** (el asistente lo proponía sin historial) y se confirmaron los tres endpoints.

**Prompt 2:**

*Contexto.* Revisar la propuesta antes de incluirla en el documento.

*Prompt.* Se pidió al asistente presentar la propuesta completa en la conversación para compararla antes de ponerla en el borrador. El asistente entregó los tres endpoints en OpenAPI con ejemplos y planteó cuatro decisiones: importes como cadenas decimales, propuesta de pareo en la misma respuesta, rechazo con `409` si hay casos de validación sin decidir, y campos que faltaran en el summary.

*Resultado.* Sección 4 con convenciones comunes (autenticación, errores, dinero como cadena), los tres endpoints en YAML con ejemplos coherentes con un batch de muestra y el inventario consolidado de 45 endpoints.

*Ajuste humano.* Se aprobaron los tres y se pidió además el inventario completo para consolidar y depurar en las siguientes entregas.

**Prompt 3:**

*Contexto.* Reflejar en la API los fees por batch y la asociación de canales.

*Prompt.* Aplicar en la API los cambios derivados de las aclaraciones de negocio, tras la confirmación de lo entendido.

*Resultado.* La respuesta de importación incluye la situación de cada canal; la liquidación admite fees por batch y confirmación de asociación de canales, devuelve ambos desglosados y añade el conflicto de asociación no confirmada.

*Ajuste humano.* Ninguno adicional.

---

### 5. Historias de Usuario

**Prompt 1:**

*Contexto.* Definir cuáles son las tres historias antes de escribirlas.

*Prompt.* Se eligieron, entre las opciones del asistente, importar y confirmar pareo, validar y decidir, y liquidar y exportar; y se precisó que las reglas de pareo por cuenta solo hacen el pareo inicial: quien ejecuta debe revisar que tenga sentido y puede modificarlo antes del análisis.

*Resultado.* Tres historias con rol, necesidad y beneficio, contexto, criterios Given/When/Then, fuera de alcance y nota AI-ready con enumeraciones cerradas (las siete condiciones del módulo de planificación). El gate humano sobre el pareo quedó como criterio explícito.

*Ajuste humano.* —

**Prompt 2:**

*Contexto.* Revisar la propuesta de las tres historias en la conversación.

*Prompt.* Se confirmó que un archivo idéntico dentro del mismo import debe rechazarse por huella; se precisó que, como los archivos se procesan juntos, se pueden quitar y añadir antes de analizar sin afectar ningún dato interno; se rechazó la idea de sustituir un archivo y reanalizar (si hace falta otro archivo, se procesa todo de nuevo); y se aprobó la historia de liquidación.

*Resultado.* HU1 ganó el criterio de quitar y añadir archivos; en HU2, devolver el archivo cancela el import conservando todo como historial y el corregido se procesa como import nuevo; HU3 quedó con la regla de que un batch pagado no se deshace.

*Ajuste humano.* Los tres puntos anteriores son correcciones del autor a la propuesta.

**Prompt 3:**

*Contexto.* Añadir los criterios derivados de canales y fees por batch.

*Prompt.* Aplicar los cambios tras confirmar el resumen del asistente de lo entendido.

*Resultado.* HU1 con el aviso de canales sin asociar o de otra cuenta; HU3 con los criterios de fees por batch (preestablecidos ajustables o importe libre) y de confirmación de asociación de canales.

*Ajuste humano.* —

---

### 6. Tickets de Trabajo

**Prompt 1:**

*Contexto.* Elegir los tres tickets (base de datos, backend, frontend).

*Prompt.* Se respondieron las preguntas cerradas del asistente: ticket de base de datos de esquema, migraciones y seed sintético; de backend, el motor de validaciones; de frontend, la pantalla de importación con pareo editable. Se pidió la propuesta completa en la conversación antes de incluirla.

*Resultado.* Propuesta de los tres tickets con contexto, tareas, criterios de aceptación, definición de hecho por tipo, estimación Fibonacci, dependencias y fuera de alcance; y dos preguntas del asistente: partir el de base de datos para que ninguno pasara de 8 puntos, y limitar el de backend a las cuatro validaciones de duplicados y colisiones.

*Ajuste humano.* Se aceptó partir el de base de datos (esquema y migraciones por un lado; seed y archivos de muestra por otro) y limitar el de backend.

**Prompt 2:**

*Contexto.* Escribir los tickets en el documento.

*Prompt.* Continuar con la sección 6 aplicando lo acordado.

*Resultado.* Tres tickets con identificador, tabla de cabecera, tareas con nombres de ficheros y rutas, criterios de aceptación como pruebas concretas contra las restricciones y los archivos de muestra, reglas de negocio cerradas (un batch deshecho no cuenta como anterior; ciclos distintos nunca colisionan) y un criterio de rendimiento para evitar comparaciones cuadráticas.

*Ajuste humano.* Pendiente de revisión final antes de crear los issues en GitHub.

**Prompt 3:**

—

---

### 7. Pull Requests

Las pull requests de código van de una rama por feature (`feat/<módulo>-<tema>`) hacia la rama de entrega `feature/entrega-2-MVP`, con la plantilla del repositorio y CI en verde. Cada diff generado con IA se revisa según los cinco focos del módulo de backend (correctitud, seguridad, rendimiento, legibilidad y tests), concretados para este proyecto en la skill `review-diff`: fidelidad al README y al vocabulario fijo, dinero y fechas, pruebas reales, seguridad y datos sintéticos, y arquitectura hexagonal.

**Prompt 1:**

*Contexto.* `auth-login` (PR #19, issue #1): el primer change de código y el primer ciclo completo de OpenSpec sobre el armazón del tramo 0. Login con JWT de acceso (15 min) y refresh (7 días) con rotación, `GET /auth/me`, logout y el plugin `requirePermission`. Hacía falta una tabla nueva, `RefreshToken`, y que `AuditLog.userId` admitiera nulos para auditar intentos con usuarios inexistentes.

*Prompt.* Proponer el change a partir del issue con `/opsx:propose`, con los tests de dominio primero, y parar antes de tocar el esquema: editar `schema.prisma`, generar el SQL de la migración `0003_auth` sin aplicarlo y presentarlo para revisión.

*Resultado.* Proposal, spec de `auth`, design y tareas aprobados antes de escribir código. El grupo de esquema quedó marcado como «requiere confirmación humana»: el asistente generó el SQL y se detuvo. El SQL que produce Prisma no funcionaba en SQL Server (error 5074: no se puede hacer `ALTER COLUMN` sobre una columna con índice o FK), así que se ajustó para eliminar y recrear el índice y la FK de `AuditLog.userId` dentro de la transacción. Durante `apply` salieron dos cambios de diseño que se anotaron en el design: el access token lleva también `jti` (el test de integración detectó que dos tokens emitidos en el mismo segundo eran idénticos) y el repositorio expone `findById` + `listMerchants`. Además, respuesta 401 idéntica para contraseña errónea, usuario inactivo o inexistente, y un test que comprueba que el log no contiene contraseñas, hashes ni JWT.

*Ajuste humano.* La migración la revisa, la aprueba y la aplica la persona (`pnpm db:migrate && pnpm db:seed`), nunca el agente: los hooks lo impiden y las tareas lo dicen expresamente. Se corrigió un orden de borrado del seed heredado del tramo 0 que rompía al volver a sembrar.

**Prompt 2:**

*Contexto.* `catalog-read` (PR #23, issue #2): nueve lecturas del catálogo con el alcance por merchant aplicado en la consulta (un recurso ajeno responde `404`, nunca `403`). Con el código en verde, se lanzó `review-diff` en una sesión distinta de la que lo había escrito.

*Prompt.* Revisar el diff de la rama con los cinco focos del proyecto y corregir los hallazgos con test primero: un commit `test:` que falla y después el `fix:`.

*Resultado.* La primera revisión encontró, entre otros: el alcance solo se aplicaba en un lado de las uniones `AccountChannel`, de modo que una fila que cruzara merchants podía revelar el nombre de una cuenta o un canal ajenos; y `IntId` no tenía tope, por lo que un id fuera del rango de `INT` no se validaba. La revisión suponía un `500`; contra SQL Server respondía `404`, y tras el arreglo responde `400 validation_error`. Cada hallazgo se cerró con su pareja de commits test/fix, con filas cruzadas temporales en la integración, y `NotFoundError` pasó a `src/shared`. Una segunda revisión dejó cuatro ajustes menores, entre ellos que `IntId` solo acepte dígitos antes de convertir a número (`Number()` admitía `1e3`, `0x10` y espacios).

*Ajuste humano.* Parar cuando la revisión ya solo devuelve hallazgos bajos, en lugar de iterar sin fin, y que la sesión que revisa no sea la que corrige, para que nadie se dé el visto bueno a sí mismo.

**Prompt 3:**

*Contexto.* `web-shell` (PR #26, issue #3): el primer código de frontend (Vite, React 19, Tailwind, shadcn/ui, TanStack Router y Query, cliente generado desde el contrato OpenAPI) con las pantallas Login y Accounts. El proposal dejó cuatro decisiones explícitas para aprobar antes de programar: dónde viven los tokens, CORS en desarrollo, librería de rutas y capability de los escenarios de interfaz.

*Prompt.* Proponer el change leyendo el issue, los wireframes, el mapa de pantallas y las rutas reales del API, y después implementarlo grupo a grupo con test primero, rompiendo a propósito cada pieza crítica (refresh de un solo vuelo, guarda de permiso, filtro del menú) para comprobar que su test falla. Tras la prueba manual, revisar el diseño de la sesión y del formulario de Login antes de cerrar.

*Resultado.* Durante `apply` apareció un hallazgo serio: `openapi-fetch` captura `fetch` al crear el cliente, antes de que MSW lo intercepte, así que el cliente sin autenticación de los tests hablaba con la API real que estaba levantada en el puerto 3000 y dos tests fallaban por credenciales. Se corrigió buscando `fetch` en cada llamada. Tras la prueba manual, la decisión D1 cambió de una sesión por pestaña (refresh en `sessionStorage`) a una sesión compartida: refresh en `localStorage`, renovaciones serializadas entre pestañas con Web Locks y relectura del refresh dentro del candado, y `BroadcastChannel` solo para login y logout. Un test de dos pestañas comprueba dos renovaciones en serie con refresh distintos y nunca uno revocado; falla si se quita el candado o la relectura. El formulario de Login (vacío al montarse, contraseña borrada tras un rechazo conservando el usuario, `autocomplete` para los gestores de contraseñas) ya cumplía lo pedido: se fijó con tests, comprobando que cada uno falla al romper el comportamiento que protege.

*Ajuste humano.* Para la renovación entre pestañas, el asistente propuso que la pestaña que renueva pasara el access token nuevo a las demás (una sola llamada al API). Se eligió en su lugar renovar en serie (una llamada por pestaña) para que el access token nunca salga de la memoria de su pestaña. Se asumió como riesgo documentado que la sesión sobrevive al cierre del navegador durante la vida del refresh (7 días) y que Sign out la corta en todas las pestañas. Se aprobó el cliente generado desde el contrato con la condición de parar y proponer la alternativa si se atascaba, y Merchants & Providers y Account Detail pasaron a la Entrega 3.

**Prompt 4:**

*Contexto.* `api-collection` (PR #30, issue #29): una colección Bruno del API para probarlo a mano y como suite de humo contra el backend local. Es transversal al tramo 1: cubre auth, catálogo y health con un caso feliz y uno negativo por endpoint, y añade los scripts `pnpm test:api` y `pnpm test:api:smoke`. No toca el backend.

*Prompt.* Proponer el change con `/opsx:propose` y aplicarlo con las condiciones de partida:
- La colección se importa una sola vez desde `docs/openapi.yaml` y después se mantiene a mano.
- El login es automático, para que cualquier carpeta o petición se pueda ejecutar sola.
- Las credenciales viven solo en `api-collection/.env`, ignorado por git y que el agente no lee; los tokens, solo en variables de ejecución, nunca en disco.
- Una aserción se rompe a propósito para comprobar que la ejecución da rojo.

*Resultado.* Tres carpetas: `00-auth` (10 peticiones), `10-smoke` (19) y `20-flows` (11). Bruno 4.2.1 importa en YAML por defecto, así que la importación se forzó en formato `bru`. El pre-request de la colección inicia sesión como `analyst`; `viewer` solo se usa en los negativos de alcance. Refresh, logout y el flujo de sesión hacen su propio login (`selfAuth`) para no invalidar la sesión que comparten las demás peticiones. Resultados: 40/40 en verde; con el backend inalcanzable o una contraseña incorrecta, la ejecución termina con código 1. Los scripts usan `cd api-collection && bru run`, porque `pnpm exec` arranca desde la raíz del workspace, y `-r`, porque `20-flows` tiene subcarpetas.

El review-diff encontró el README §4 desalineado con el API real: refresh, logout y health son anónimos, y el código es `validation_error` en minúsculas. Además: los logins pasaron a declarar `selfAuth` en lugar de reconocerse por el nombre; la cuenta de prueba se resuelve en un solo punto con un error explícito; las listas se comparan por miembros y no por orden; y se quitó una entrada duplicada de `.gitignore`. Por el camino, los hooks del agente pasaron a lanzarse con `$CLAUDE_PROJECT_DIR`, porque desde una subcarpeta no se ejecutaban. Al comprobarlo, el seed lanzado desde `api-collection/` quedó bloqueado como debía. `guard-schema` reconoce ahora las rutas de Windows, y los hooks tienen pruebas propias en la CI (`pnpm test:hooks`).

*Ajuste humano.* La persona fijó la convención de los códigos de error: snake_case en minúsculas en todo el API. Los ejemplos en mayúsculas del README quedaron marcados como desactualizados y la regla pasó a `CLAUDE.md`. Aceptó el peso de `@usebruno/cli` (unos 280 paquetes transitivos, solo como devDependency) porque hará falta para ejecutar la colección en la CI de la Entrega 3. Probó la colección a mano en la aplicación de escritorio de Bruno, como `analyst` y como `viewer`.

**Prompt 5:**

*Contexto.* `import-upload-mapping` (PR #33, issue #4): el primer tramo de HU1 y el primer change que recibe archivos del usuario. Subida de uno o varios `.xlsx` de la plantilla por cuenta, conservación del archivo original bajo `UPLOAD_DIR`, lectura de las hojas como texto y propuesta de pareo con el origen de cada decisión (`account`, `global` o `none`) más `readiness`. Cinco rutas nuevas y sin cambios de esquema.

*Prompt.* Proponer el change a partir del issue con `/opsx:propose`, dejando explícitas para aprobación las decisiones de riesgo: con qué se leen los `.xlsx`, cómo evitar que IDs e importes pasen por `number`, los límites de subida y descompresión, la ruta en disco, el alcance del rechazo por duplicado y el orden archivo/base cuando algo falla a medias. La pieza de riesgo era el lector `.xlsx` propio sobre `fflate` y `saxes`: ExcelJS convierte toda celda numérica a `number` y descomprime sin tope, y SheetJS arrastra CVE sin corregir en npm. Se aprobó con timebox: el lector sería el primer grupo de tareas y tenía que quedar en verde contra las cinco muestras y contra un archivo guardado por Excel de escritorio; si no, se paraba y se proponía la alternativa (ExcelJS con detección de precisión y un límite de descompresión previo con `fflate`), documentada como deuda.

*Resultado.* El lector quedó en verde dentro del timebox y el design absorbió tres ajustes. Excel no conserva más de 15 dígitos significativos en una celda numérica, así que el lector no puede deshacer una pérdida que ya está en el archivo: cuenta por columna las celdas numéricas con notación científica o más de 15 dígitos y `readiness.notes` avisa cuando la columna propuesta como ID las tiene, en lugar de ocultarlo. `ImportSheet.kind` no admite nulos, de modo que una hoja sin propuesta se guarda con el marcador `ignore` y la API la muestra como `kind: null` con `source: none`. Y el archivo de Excel real pasó de prueba manual a fixture del repositorio (`data/samples/excel-real`, con datos sintéticos y los metadatos personales limpiados), con un ID en notación científica que la integración comprueba en `readiness.notes`. La primera revisión con `review-diff` dejó dos hallazgos HIGH: una celda vacía con una referencia de columna gigante (`ZZZZZ1`) dimensionaba la cabecera y el mapa de la fila sin pasar por el límite de columnas, una denegación de servicio con un archivo de pocos KB; y el detalle del import se construía dentro del ámbito de limpieza, así que un fallo tras la transacción borraba archivos cuyas filas ya estaban en base, justo el estado que D6 prohíbe. Entre los MEDIUM: un cuerpo multipart malformado respondía `500` en vez de `400 validation_error`, el `422` filtraba mensajes de errores internos del lector, y los límites de descompresión, pensados para volúmenes que no existen, bajaron de 256 MiB y 500 000 filas a 64 MiB y 200 000, con tests frontera (el valor exacto pasa, uno más falla). La segunda revisión encontró que el arreglo del multipart había introducido un cuelgue: si el almacenamiento rechazaba una parte sin consumir su stream, el parser quedaba esperando y la petición nunca respondía. Ahora la parte se drena también en ese caso y el fallo llega como `500` cuando el parser termina; quedaron además dos ajustes menores (no cachear un `mkdir` fallido y reportar un deflate corrupto con el nombre de la entrada).

*Ajuste humano.* Las seis decisiones de riesgo del design se aprobaron antes de `apply`, y la puerta de salida del lector la fijó la persona, que además aportó el archivo de Excel real cuando el primer grupo lo pidió. Se aceptaron como deuda registrada el marcador `ignore` hasta que una migración por otro motivo haga `kind` nullable, y el barrido de archivos huérfanos en `UPLOAD_DIR`; y se decidió que el duplicado por `sha256` se rechace solo dentro del import, no entre imports, para poder reprocesar tras cancelar.

**Prompt 6:**

*Contexto.* `import-analyze` (PR #36, issue #5): el tramo backend que cierra HU1. El analista confirma el pareo de cada hoja y el servidor analiza el import: normaliza los IDs según el `idFormat` del gateway, los cruza contra las transacciones propias y guarda una `ImportRow` por fila con su fila original. Después lista las filas con las no asociadas y las ambiguas primero, permite resolver una ambigua eligiendo gateway y cancela conservando la evidencia. Cinco rutas nuevas y sin cambios de esquema.

*Prompt.* Proponer el change a partir del issue con `/opsx:propose`, dejando como preguntas abiertas lo que el README no decidía, y revisar el diseño antes de `apply`. La pieza de riesgo era la inserción masiva de `ImportRow` (D1): se aprobó con una puerta de medición contra SQL Server como primer grupo de tareas, con umbrales por volumen, y la instrucción de parar y proponer alternativa si no se cumplían.

*Resultado.* La revisión del diseño cerró nueve decisiones. Dos eran reglas de negocio nuevas y se llevaron al README antes de programarlas: los gateways del cruce son los de los canales de la cuenta y, si no tiene ninguno, los de los canales de su proveedor (sin ninguno, las filas quedan `unmatched` con `no_gateways`); y si una hoja tiene estado fijo y además se parea una columna de estado, gana la hoja y la discrepancia sale como advertencia por fila. El resto (columna `gateway`, `txnDate`, filas de `Other Fees` sin `ImportRow`, reglas de ignorar por patrón) quedó como deuda registrada. La medición de D1 (lotes de 125 filas, 2 000 parámetros, dentro de una transacción) cumplía con 783 y con 20 000 filas, pero 200 000 tardaban 125 s frente a un umbral de 90 s. Como el coste crece de forma lineal y el volumen real es de cientos de filas, en lugar de cambiar de estrategia se fijó un tope de 100 000 filas por import (la suma de las hojas de transacciones de todos los archivos, comprobada antes de leer ninguna fila; `422 import_too_large`), que deja el peor caso en unos 60 s. Usar las muestras como oráculo destapó un error en el propio oráculo: el generador contaba las filas de `Other Fees` como transacciones, y el `expected.json` de `batch-issues` pasó de 772 a 770 filas leídas y de 768 a 766 asociadas, sin tocar ningún `.xlsx`. Tras `/opsx:verify`, el análisis de 20 000 filas tardaba 24,5 s, 10,8 de ellos en buscar transacciones: Prisma envía los strings como `NVARCHAR`, la columna es `VARCHAR(36)` y la conversión implícita impedía usar el índice único con un seek. Ahora los pares viajan en un único parámetro JSON que se abre con `OPENJSON … WITH` y un `CAST` a `VARCHAR(36)`, sin interpolar valores: de unas 150 lecturas lógicas por búsqueda a 3 para un ID, y 14 s de extremo a extremo. La primera revisión con `review-diff` dejó un HIGH y tres MEDIUM. H1: las escrituras del import no tenían guarda en la máquina de estados, de modo que un `PUT mapping` leído en `mapped` podía devolver a `mapped` un import ya analizado o cancelado; ahora cada escritura empieza por un `UPDATE` condicionado al estado y al `updatedAt` leídos, como el claim del análisis. M1: dos `PATCH` simultáneos sobre la misma fila ambigua respondían `200` los dos, sumaban dos a `rowsMatched` y dejaban dos auditorías; la resolución quedó condicionada a que la fila siga ambigua y el import analizado. M2: una columna pareada dos veces o un estado fijo inexistente llegaban a la base y la violación de PK o FK respondía `500`; ahora se rechazan antes con `400 validation_error`. M3: con un gateway compartido, el aviso de canales y las filas mostraban la cuenta y la transacción de otro merchant. La segunda revisión encontró más fugas del mismo tipo (el canal, las candidatas de una fila ambigua y el estado de una fila R), una carrera en el estado anterior que audita el cancel, que pasó a leerse en la misma sentencia que lo reemplaza, y casos límite sueltos (un ID de más de 36 caracteres, un import analizado sin filas). Al perseguir la intermitencia del test de 21 MiB heredado de #4 apareció la causa real: Vitest ignora `fileParallelism` dentro de un project, así que los archivos de integración corrían en paralelo contra la misma base y el `afterAll` de uno borraba imports mientras otro los contaba. Un solo fork por project los serializa sin alargar el tiempo total.

*Ajuste humano.* Las preguntas abiertas y las nueve decisiones del diseño las resolvió la persona antes de `apply`, incluidas las dos reglas nuevas del README. Ante el caso de 200 000 filas eligió el tope por import en lugar de un análisis asíncrono o de insertar también con `OPENJSON`, que quedan como deuda por si aparecen imports reales grandes. Para M3 decidió ocultar: el cruce no cambia, pero al leer, lo que pertenece a un merchant fuera del alcance de quien consulta sale a `null` con `outOfScope: true`, conservando solo lo necesario para resolver la fila, y la forma oculta se documentó en el README.

**Prompt 7:**

*Contexto.* `validation-engine` (PR #41, issue #8): el motor de las ocho validaciones de HU2 como funciones puras, sin base de datos ni HTTP, con los cinco puertos de lectura que implementará #9 y sus dobles en memoria sobre el mundo sintético. Trae dos migraciones (`0004_validation_outcome`, el nuevo vocabulario del resultado, y `0005_conflict_occurrence_unresolved_status`, `ConflictOccurrence.statusId` nullable) y varias decisiones de negocio que se llevaron al README.

*Prompt.* Aplicar `tasks.md` grupo a grupo: primero los tests, en un commit `test:` que falla, y después el código; al cerrar cada grupo, romper el código a propósito una vez y comprobar que cae su test. Sin modificar un test para que pase. El grupo 1 era una puerta: si `runValidations` no bajaba de 2 s con 2 000 filas contra 50 000 movimientos, se paraba con los números en la mano. La migración la escribe el agente y la aplica la persona; la integración solo se lanza tras confirmar que la otra sesión (`web-import`), que comparte base, no está corriendo la suya; y no se toca `vocabulary.ts`, que esa sesión está modificando. Tras `/opsx:verify`, tres rondas de `review-diff` en una sesión distinta, cada hallazgo de código con su pareja de commits test/fix.

*Resultado.* La puerta se cumplió con holgura: 29–51 ms con el orquestador y los índices, y unos 100 ms al final con las ocho validaciones reales; con los índices rotos a propósito (historia buscada con `filter` por fila) subía a 1 990 ms. Las cinco muestras reproducen su `expected.json` leyendo los `.xlsx` reales con el análisis de #5, sin SQL Server. El refactor de `seed.ts` (movimientos históricos como función pura compartida con los tests) se protegió antes con un test de caracterización sin base, y al volver a sembrar los conteos de `SettlementTransaction` coincidieron con sus literales. La generación con `--create-only` no pudo ejecutarse porque `recon_app` no tiene permiso para crear la shadow database, lo correcto por mínimo privilegio, así que las dos migraciones se escribieron a mano. La implementación destapó tres huecos pequeños del diseño, cerrados sin cambiar reglas: la fila de origen en los hallazgos de una fila (`source`), excluir el import en curso de la historia (`excludeImportId`) y el proveedor en `computeRanges` para descartar filas ajenas. La primera revisión encontró que el rango R por fecha de creación daba faltantes falsos en una cuenta con canales de 180 y 120 días: el máximo lo marcaba una reserva de 120 días reciente y caían dentro reservas de 180 días todavía sin vencer. El rango y las candidatas R pasaron a compararse por vencimiento, y el oráculo de las muestras se recalculó. La segunda encontró que una fila RR repetida de una reserva ya liberada, cuya transacción había pasado después a `Chargeback`, salía como colisión con la fila incluida, de modo que la reserva se liberaba dos veces; que el contrato de candidatas I descartaba en SQL las que no tienen fecha de cambio de estado, con lo que su contador valía siempre cero; y que la colisión contra el histórico no listaba el `CHB 2` compatible, como sí hacía la del batch. La tercera fue solo de documentación. Al cierre, 99,9 % de líneas y 94,9 % de ramas en el módulo.

*Ajuste humano.* Las decisiones de negocio las tomó la persona y se documentaron en el README antes de programarlas. El resultado de cada validación usa `passed`, `warning`, `blocked`, `not_applicable` y `not_implemented`, y desaparece `failed`: solo `provider_mismatch` bloquea. `non_recorded_adjustment` incluye `status_mismatch`: una fila E reportada `Declined` que el gateway tiene aprobada, o al revés, es un hallazgo no bloqueante con la fila incluida. Una aparición con estado no resuelto (`status_unresolved`) cuenta como distinta de cualquier otra: es colisión con todas las apariciones actuales incluidas, nunca duplicado, en el batch y contra el histórico, y por eso `ConflictOccurrence.statusId` admite NULL. El rango R se calcula por vencimiento de la reserva, creación más `rollingReserveDays` del canal; entre usar el plazo vigente del canal o el aplicado al liquidar (`expectedReserveReleaseAt`), eligió el vigente (opción B), porque el plazo de un canal no cambia con el tiempo, con la condición de que la fuente de reservas retenidas de #9 filtre con el mismo cálculo; el plazo aplicado queda como deuda para la Entrega 3. Y R no tiene estado: dos apariciones R de la misma transacción son siempre duplicado. Además revisó el SQL de las migraciones antes de aplicarlas, confirmó cada lanzamiento de la integración y decidió no editar `0004`, ya aplicada, y dejar la observación de la revisión anotada en el PR.

**Prompt 8:**

*Contexto.* `web-import` (PR #43, issues #6 y #7): las pantallas de HU1 sobre las rutas de #4 y #5. New Reconciliation con la elección de la cuenta y un espacio por import con tres pasos (Files, Mapping y Analysis), cancelación y solo lectura sin permiso, más el primer smoke E2E con Playwright y playwright-bdd. Sin tocar el backend salvo un test de integración que contrasta el catálogo de estados de la base con la constante compartida.

*Prompt.* Aplicar el change grupo a grupo con `/opsx:apply`: primero los tests y luego el código, sin modificar un test para que pase. Al cerrar cada grupo, romper a propósito su pieza crítica: la guarda de doble envío, la fusión `keepDirtyValues` del formulario, la cola de subida que sobrevive a la navegación, el filtro de canales y la comprobación de tamaño. No leer `.env*`. El smoke lee `SEED_PASSWORD` en tiempo de ejecución, pero la contraseña no puede aparecer en logs, en la consola ni en el informe de Playwright. Parar si faltaba algo en el API. Tras `/opsx:verify`, dos rondas de `review-diff`, cada hallazgo de código con su pareja de commits test/fix y la verificación contra la base que fijara la persona.

*Resultado.* Los tests corren contra un API falso con MSW: una máquina de estados con las hojas, propuestas y vistas previas copiadas de respuestas reales del API sembrado, y huellas `sha256` del contenido para los duplicados. El contraste con el API real destapó dos diferencias con la spec, que se corrigieron antes de seguir:
- Cada parte de `batch-split` trae las diez hojas, así que quitar `part2` quita su tarjeta, no los nombres de sus hojas.
- La readiness del detalle no lista las hojas sin confirmar (solo lo hace el `422` de analyze), así que la pantalla las deriva de `mappingConfirmed`.

En jsdom hubo que usar los `FormData`, `File` y `Blob` nativos de Node, porque los de jsdom colgaban la subida multipart, y añadir polyfills para los selects de Radix. Con la suite completa, un test pasaba del tiempo límite porque cada cambio en el formulario repintaba todas las tarjetas; se arregló suscribiendo cada tarjeta solo a los errores de su hoja. La guarda de doble envío se comprueba con dos clics en el mismo tick dentro de un `act`: sin la guarda llegan dos peticiones. El smoke recorre `batch-clean` de punta a punta contra la aplicación levantada y escribe la contraseña desde la página, no con `fill()`, porque el título del paso llevaría el texto. Las comprobaciones de fuga se hicieron con una contraseña falsa inyectada por variable de entorno, buscándola en `test-results`, en el informe (incluido el zip que lleva embebido) y en la salida de consola.

La primera revisión dejó dos HIGH. H1: el formulario seguía validando y contando como cambio las hojas de un archivo quitado, así que una edición en `part2` bloqueaba Confirm mapping y Analyze después de quitarlo. Ahora el resolver valida solo las hojas del detalle y las del archivo quitado se dan de baja del formulario; un segundo test distingue las dos piezas, que por separado bastaban para el primero. H2: si el login fallaba, la instantánea de la página que adjunta el informe podía guardar la contraseña escrita. La verificación tuvo tres casos: un login rechazado no demuestra el arreglo, porque la aplicación ya borra la contraseña tras un rechazo; un login colgado a propósito la dejaba ver sin el arreglo y no con él. Entre el resto:
- El test del PUT pasó a compararse con los literales de la spec, no con el fixture del que sale el API falso.
- Las filas del import se invalidan al terminar el análisis; el test espía la invalidación, porque con `staleTime` 0 el refetch no se ve en pantalla.
- `403` y `404` de analyze tienen mensaje propio, y una hoja compacta se rotula **Show** cuando no hay edición posible.
- Una hoja sin tipo lanza un error en vez de enviarse como `ignore`, y un `409` al quitar un archivo recarga el import.
- Un escenario del smoke que falla a medias cancela el import que creó.

La segunda revisión se centró en el smoke. Vaciar el campo en un `finally` alrededor del clic, sin esperar al elemento, cubre el login colgado y el clic que agota su tiempo, pero no el caso en que se agota el tiempo del test: entonces el `evaluate` ya no llega y la contraseña aparecía. Por eso las acciones y la navegación tienen un timeout propio muy por debajo del del test, y el comentario del `finally` dice qué cubre y qué no. La limpieza de un escenario fallido corre en una pestaña nueva, para que la instantánea describa la pantalla del fallo; toma el `importId` de la respuesta del POST que crea el import y, si no puede cancelarlo, lo anota en el test en lugar de sumar un segundo error. Se comprobó forzando un fallo dentro del paso de subida y, después, otro en la propia limpieza. En el formulario, un fallo del envío que no es un error del API muestra que el pareo no se pudo confirmar.

*Ajuste humano.* La persona hizo la prueba manual con `analyst` y `viewer`, con teclado y a 1280 y 1024 px, y pidió cuatro ajustes de interfaz, cada uno con su test y su commit:
- **Continue to mapping** en el paso Files.
- Una línea compacta para las hojas sin nada que parear, con **Edit** en las ignoradas por regla.
- La readiness agrupada por archivo, con las notas informativas plegadas.
- La hoja siempre visible en la tabla del análisis.

Aprobó que dos tests cambiaran con la spec. Dejó para la revisión de la Entrega 3 los importes a dos decimales y un aviso fuerte cuando ninguna fila es de los canales de la cuenta elegida. Los huecos del API (catálogo de estados, motivo al cancelar, límite de archivos por import) y el job E2E en CI quedaron como deuda en #40, y las hojas sin confirmar en la readiness del detalle, en #42. Hizo el triaje de las dos revisiones y fijó cómo verificar cada hallazgo contra la base. Corrigió además al asistente: la regla de no leer `.env*` vale igual para un script propio que cargue el archivo aunque no imprima nada, y una comprobación con la contraseña real la ejecuta la persona.

En la segunda revisión, el hallazgo sobre los cambios sin confirmar describía un mecanismo real: al quitar un archivo, el reset con `keepDirtyValues` deja `isDirty` en `false`. Reproducido con el código anterior al arreglo, Analyze no llegaba a habilitarse, porque `useForm` vuelve a calcular `isDirty` en la pasada siguiente, cuando Mapping ni siquiera está montado. Entre conservar el cálculo nuevo, basado en `dirtyFields`, y volver a `isDirty`, la persona eligió volver a `isDirty` (opción a): revertir el arreglo y conservar su test como regresión, con la aserción negativa esperando antes a que Mapping muestre un solo archivo y comprobando que cae si nada cuenta como cambio. También coordinó con la sesión de `validation-engine` el orden de las entradas de esta sección y el rebase sobre la rama de entrega.

**Prompt 9:**

*Contexto.* `validation-runs` (PR #52, issue #9): el backend que cierra HU2 sobre el motor de #8. Adaptadores Prisma de los cinco puertos de lectura, corridas persistidas con una sola vigente por import, lista y detalle de hallazgos, cambio de inclusión y resolución manual auditados, decisión de conjunto (`POST review`) y su invalidación, y la máquina de estados `analyzed ↔ validated`. Siete rutas nuevas y la migración `0006_validation_runs`. Las siete preguntas que el README no resolvía (P1–P7) se decidieron en la revisión del design, antes de `apply`.

*Prompt.* Aplicar `tasks.md` grupo a grupo: primero los tests, en un commit `test:` que falla, y después el código; sin modificar un test para que pase y, si uno está mal, decirlo. Al cerrar cada grupo, romper el código a propósito una vez y ver caer su test. La migración la aplica la persona; no leer `.env*`; nada de `cd`, rutas absolutas ni código en línea en Bash; la base la comparte otra línea de trabajo (#10, solo frontend con MSW), así que nada de `db:reset` ni `migrate dev`. El bench solo con `RECON_BENCH=1` y cuando lo diga la persona.

*Resultado.* La rotura del grupo de adaptadores confirmó la decisión más delicada del design: sin el `CAST(… AS datetime2(7))` de `@rMax`, la reserva que vence 1 ms después del límite entraba. La causa se aclaró después, en la revisión: el adaptador envía el `Date` del SQL crudo como texto ISO, que se asigna exacto a una columna `datetime2`, pero `DATEADD(day, …, @p)` sobre un texto devuelve `datetime`, que redondea a 1/300 s. La entrada construida desde la base para las cinco muestras produce con el motor el mismo informe que la de memoria, y las cinco reproducen su `expected.json` por la API. La concurrencia se probó de forma determinista: un repositorio envuelto pausa la escritura de una corrida hasta que llega la otra (o hasta confirmar un review o un cambio de inclusión), y quitar la versión optimista de la guarda hace caer su test. La regla de R comprobada antes de la guarda la detectaba al principio solo un test con `Promise.all`, que cayó 3 de 3 veces pero depende de los tiempos; tras el review-diff independiente la garantiza una variante determinista que pausa la primera inclusión antes de su guarda mientras confirma la segunda. En el grupo 8, la rotura quitó la comprobación de la corrida vigente del review; el review-diff independiente señaló que leerla antes de la guarda no hacía caer ningún test, porque la pausa estaba antes de llamar al repositorio. Se reprodujo, y el test pasó a pausar el review dentro de su transacción, justo antes de la guarda (gancho `beforeClaim`); con esa rotura ahora cae. Un primer intento con la pausa después de la guarda (`afterClaim`) no servía: mientras la corrida retiene el bloqueo de `Import`, el review ya espera en su lectura del import. La auditoría va dentro de la transacción de cada acción: con una extensión de Prisma que hace fallar `auditLog.create`, ni la inclusión ni la resolución quedan. Salieron tres correcciones de montaje de tests, notificadas: los inputs de muestra numeran sus imports con la misma secuencia (`batch-issues` y `legacy-provider` compartían id), un fixture de batch `paid` sin `paidAt` violaba una `CHECK`, y dos aserciones antiguas de cancelación comparaban el detalle de auditoría con `toEqual`, cuando la spec añade `runId`. El primer bench, ejecutado por la persona, falló: 24,6 s, 20,3 de ellos de escritura, con 23 482 hallazgos, y su limpieza dejó datos 9xxx en la base compartida (`ConflictOccurrence_batchId_fkey`). El diagnóstico mostró que la entrada del benchmark del motor tenía rangos APP y DEC de casi cuatro meses (24 798 de 25 000 transacciones sin liquidar dentro) y que 17 de los 17,7 s de escritura eran los `createMany` troceados de los hallazgos sin apariciones. La limpieza pasó a orden de FK e idempotente; la escritura, a un `INSERT … SELECT … FROM OPENJSON` con tipos explícitos y el `MERGE … OUTPUT` de D5 (20 301 hallazgos, de 19,8 s a 1,1 s). El bench se dividió en un volumen de referencia y un caso extremo. Segundo bench, con la máquina tranquila:
- Referencia: 2 603 ms (carga 2 231, motor 10, escritura 288: guarda 6, cierre de la anterior 4, corrida 11, resultados 59, hallazgos sin apariciones 87, con apariciones 110); 1 023 hallazgos. Pasa la aserción de menos de 4 s, no el objetivo local de 2 s.
- Extremo: 5 060 ms (carga 3 922, motor 40, escritura 935, de ella 845 en hallazgos sin apariciones); 23 659 hallazgos. Sin aserción.

*Ajuste humano.* La persona decidió P1–P7, revisó y aplicó la `0006`, y a mitad del change fijó la convención de fechas: las de negocio son hora de pared de America/New_York sin zona (la `Z` del API es solo transporte, deuda en #48) y las de auditoría, instantes UTC; pidió documentarla y revisar, sin corregir, si alguna regla mezclaba las dos clases (no las mezcla ninguna). Pidió además dejar escrito en README §3.3 que la inclusión manual de un duplicado E entre batches existe solo para procesar batches históricos, porque un E no se paga dos veces, y abrir el issue #49 para cerrarla. Tras el primer bench decidió que aquel escenario no representaba un batch real y fijó los dos nuevos: un volumen de referencia (historial grande, rangos de pocos días calibrados con el doc 06, 2 000 filas, como máximo 2 000 faltantes) con aserción de menos de 4 s, y un caso extremo sin aserción, solo registrado. Con el segundo bench aceptó el resultado para la Entrega 2: la escritura queda por debajo de 300 ms (D5 cumplido) y el cuello de botella es la carga (86 % del total), que pasa a un issue de la Entrega 3.

**Prompt 10:**

*Contexto.* `web-validations` (PR #57, issue #10): la pantalla Analysis & Validations de HU2. Muestra la corrida con sus rangos, la tabla de las ocho validaciones, la lista de hallazgos y un drawer con las apariciones, el historial y las dos acciones del analista (cambiar una inclusión y resolver con nota). Añade el aviso de revisión invalidada y la decisión de conjunto (Continue / Cancel and reprocess). Se construyó mientras #9 seguía en curso, contra el contrato que publicaba su design y con un API falso de MSW. El último grupo de tareas era el rebase sobre #9 ya fusionado.

*Prompt.* Proponer el change con `/opsx:propose` a partir del issue y del contrato de #9, leído solo con `git show`, sin cambiarlo y diciendo en el proposal lo que faltara. Restricciones de partida:
- El drawer lleva las acciones completas; el resumen previo por ciclo es de #13.
- Run se deshabilita mientras corre y relee ante `409 import_changed`; avisa antes de re-ejecutar si hay cambios manuales; Continue se deshabilita con un bloqueante, con el motivo visible.
- Los controles siguen `editable`, `includable` y `resolvable` sin duplicar reglas, y `viewer` queda en solo lectura.
- El motivo al cancelar queda como pregunta abierta, y Settlement Review, que aún no existe, se resuelve con una propuesta.
- Tipos y handlers del contrato aislados en un solo sitio.

Después, aplicar grupo a grupo con test primero y una rotura a propósito por grupo, sin integración ni E2E contra la base compartida mientras #9 siguiera en curso. Las capturas, con Playwright y avisando antes de lanzarlas.

*Resultado.* En el gate del design el asistente se detuvo al fijar la zona horaria. Todas las fechas son `DATETIME2` sin zona y el API las serializa con `Z`, pero ningún documento decía si las de negocio eran instantes UTC u hora de Nueva York, y presentó lo que había encontrado antes de decidir nada. Con la convención fijada, las fechas se tipan con marcas `BusinessDate` y `AuditInstant`, de modo que pasar una al formateador de la otra no compila, y los dos formateadores se prueban con la zona del proceso en Tokio, en horario de verano y en horario estándar. El API falso quedó guionizado: los resultados y las marcas vienen fijados en las fixtures, cada `PATCH` devuelve lo que el escenario declara, y el falso solo modela lo que cambia entre peticiones.

En `apply`, una rotura no cayó porque `dblClick` da tiempo a React a deshabilitar el botón entre los dos clics. Se añadió el test de dos clics dentro de un `act`, como en web-import. Otra pasaba con el foco en el `body`, porque la página entera contiene el ID del hallazgo; la aserción pasó a exigir el botón exacto. Al volver a las esperas por defecto de `findBy`, la suite fallaba unos 25 tests en cada pasada. La medición dio dos causas:
- Una cascada propia: el drawer pedía el hallazgo después de la corrida.
- El primer render del paso Analysis en frío, unos 750 ms aislado y más de 1 s con la suite en paralelo.

Se corrigió la cascada y solo las aperturas de esas pantallas esperan más. Al abrir con un hallazgo en la dirección, el drawer modal oculta el fondo con `aria-hidden`, así que esos tests esperan primero el drawer.

En el rebase, los esquemas Zod compartidos de #9 encontraron tres desajustes en el falso: UUID no válidos, `page` sin tope y un `occurrenceId` fuera del rango de BIGINT. Contra el API real, los conteos de las ocho validaciones de `batch-issues` coincidieron con el oráculo y se cumplieron los cuatro criterios del issue. También aparecieron diferencias con el falso:
- `missing_in_range` de `batch-blocked` trae diez faltantes.
- Los hallazgos de una sola fila llegan sin apariciones.
- Un estado reportado y el del gateway estaban invertidos en la fixture.
- Las filas reales del duplicado son otras.

Y cuatro defectos de pantalla:
- El drawer salía estrecho, porque una clase del sheet de shadcn pisaba la anchura.
- Un hallazgo de una sola fila decía que la transacción no estaba en el batch.
- El título quedaba bajo el botón de cerrar.
- La decisión de un import cancelado quedaba vacía.

Se corrigieron con test primero y se comprobaron en las capturas a 1280 y 1024 px, sin desplazamiento horizontal. El smoke de web-import siguió en verde.

*Ajuste humano.* La persona fijó la convención de fechas: las de negocio son la hora de pared de America/New_York del gateway principal, mostradas sin convertir; las de auditoría son instantes UTC convertidos a Nueva York, todas con el sufijo `ET`. Dejó en el roadmap averiguar la zona del gateway UUID y abrió con el asistente los issues de deuda:
- #48, para serializar sin `Z` las fechas de negocio;
- #47, el motivo al cancelar, que el 23 se queda sin motivo;
- #55, el motivo de `includable = false`.

Pidió que el falso no recalculara reglas de negocio. Decidió cada test que estaba mal, en lugar de dejar que se ajustara para pasar: comprobar el fondo de un modal después de cerrarlo, alargar solo las esperas de apertura y buscar la reserva también por su validación. Hizo en persona el login como `viewer`, porque el asistente no inicia sesión. Corrigió dos veces el texto de un import procesado: no podía decir que el batch estaba *settled*, porque solo lo está cuando está `paid`, ni que ya no cambiaba nada, porque un ajuste se sigue resolviendo a mano (P5 de #9).

**Prompt 11:**

*Contexto.* `settlement-process` (PR #66, issue #11) cierra la HU3 mínima en el backend. Procesar un import `validated` crea un intento de batch, pendiente de pago, con:
- número propuesto e intento;
- un movimiento por fila y ciclo (E/I/R);
- fees transaccionales vigentes a la fecha del evento, con su desglose;
- fees por batch prellenados desde `Other Fees`;
- totales por categoría y desglose del amount payable;
- asociación de canales auditada;
- resolución de los faltantes que trae el batch.

Todo va en una transacción. Añade cinco rutas y las migraciones `0007` y `0008`. Su design publica los contratos que leen #13 (pantallas) y #12 (summary y CSV).

*Prompt.* Proponer el change a partir del issue y de las decisiones que dejó pendientes `validation-runs`. Cinco decisiones obligadas:
- la clave única de `SettlementTransaction`;
- procesar solo desde `validated` con la revisión de la corrida vigente;
- el gancho `MissingResolution`;
- qué hacer con las filas sin estado resuelto;
- los códigos de error en minúsculas.

Las reglas de negocio no se inventan: lo que el README no dice queda como pregunta abierta con una opción provisional. Más restricciones:
- El dinero, siempre `Decimal` o texto.
- Las vigencias se comparan con fechas de negocio.
- Ningún movimiento queda Settled al procesar.
- La concurrencia se prueba con compuertas, nunca con `Promise.all` solo.
- El recorte deja el núcleo de la HU3 y pone al final, como recortables, los fees transaccionales y la reserva ante chargeback.
- Cada decisión del design lleva su alternativa descartada.

Después, aplicar grupo a grupo con test primero y una rotura a propósito por grupo. Las migraciones las revisa y aplica la persona, la base no se reinicia (la comparte #13) y hay un punto de control antes del grupo de fees.

*Resultado.* **La clave única.** La `UNIQUE (transactionId, cycle, batchId)` chocaba con Refund + Chargeback de la misma transacción y con Chargeback + CHB 2. La `0007` la cambia por una clave por fila (`batchId, sheetId, rowNo`) y deja `eventDate` nullable para el ajuste que no se puede fechar.

**Oráculos y seed.** Regenerar los oráculos a 4 decimales (grupo 0) cambió cifras de `batch-clean`, `batch-split` y `legacy-provider` y los literales de un test de caracterización. Se presentó el diff por muestra antes de seguir.

**La migración `0008`.** Al activar los fees, la integración destapó que el fee de un ajuste sin fecha no se podía guardar: `SettlementTransactionFee.eventDate` era `NOT NULL`.

**Fees y Bruno.** Los fees, la reserva y el `amountPayable` cuadran con los oráculos. En Bruno salieron dos tropiezos:
- El parser de sus scripts no admite el literal `0n`.
- El servidor que respondía era el del otro checkout.

**El verify.** Sin críticos. Encontró un error de código: la última barrera del número podía nombrar el intento de otra cuenta. También siete escenarios sin test y desfases en el design y el README. En el triaje, un `deleteMany` de limpieza se ejecutó con un id indefinido, que en Prisma vacía la tabla. Lo frenó una FK y no se borró nada. Desde entonces, `fixtureId` y `fixtureIds` hacen fallar cualquier limpieza con un filtro indefinido.

**El primer review-diff.** Dos HIGH:
- Ningún test ejercitaba el `UPDLOCK, HOLDLOCK` del número.
- La última barrera se probaba con errores inventados, y el código se había aflojado para aceptarlos. Ahora exige P2002 y los tests provocan violaciones reales con `$extends` dentro de la misma transacción.

De los MEDIUM, el principal: la asociación de canales decidía sobre un estado leído sin bloqueo. Ahora se relee bloqueado después del número. Los demás pedían límites de entrada que evitan 500 y un lector que admita los batches del seed. Los LOW, filtrar por alcance la cuenta de otro merchant.

**La segunda vuelta.** El test del bloqueo del número no lo aislaba:
- El segundo proceso esperaba igualmente en la relectura de canales, también con un canal distinto.
- "Sigue pendiente" no distinguía a un proceso bloqueado de uno lento.

El repositorio avisa ahora justo antes de cada bloqueo (`number`, `channelLock`). Con esas señales, quitar el hint solo del número hace caer el test.

**La tercera vuelta.** Confirmó que los interbloqueos ocurren. El procesado se reintenta ante el 1205, identificado por la forma real del error del adaptador (`P2010` o `P2034` con causa `TransactionWriteConflict`), y responde `409 settlement_busy` si se agotan los intentos. La solución de fondo queda en #67: no se ha visto el recurso de la espera porque el usuario de la aplicación no tiene `VIEW SERVER STATE`.

*Ajuste humano.* En el gate del design, la persona decidió:
- **RDR:** resta con su importe, como un Chargeback o un Refund.
- **Redondeo:** todo a 4 decimales, y solo el producto importe × porcentaje redondea mitad hacia arriba.
- **Desglose:** el amount payable lleva nueve líneas con signo.
- **Fecha de un ajuste (P6):** la del proveedor; si no viene, el último cambio de estado cuando coincide con el de la fila; si tampoco, sin fecha y con advertencia.
- **Fee de un ajuste sin fecha (P6b):** opción provisional, solo el único fee de su tipo sin vigencia.
- **Pending:** una fila Pending en el gateway se procesa con su propio estado. El `status_mismatch` que eso debería dar quedó en #63.

Además:
- Revisó a mano el diff de los oráculos del grupo 0 antes de dejar seguir.
- Recortó el grupo de la reserva ante chargeback a #62.
- Eligió la `0008` frente a inventar una fecha.
- Aplicó las dos migraciones, sembró y ejecutó Bruno.
- Llevó a #56 los timeouts de `pnpm -r test` en paralelo.
- En cada review pidió reproducir el hallazgo antes de corregirlo; así se vio que el primer arreglo del test del número no lo aislaba.

**Prompt 12:**

*Contexto.* `summary-exports` (PR #71, issue #12) añade las lecturas y las descargas del intento de settlement:
- volver a abrir el intento;
- ver sus movimientos por ciclo con el desglose de fees;
- listar los intentos de un import;
- descargar el summary del merchant y los CSV del Back-Office (TXN y RR), cada descarga auditada.

Se desarrolló en una rama apilada sobre `settlement-process`, que se rebasó con `git rebase --onto` cuando esta se fusionó.

*Prompt.* Proponer el change con `/opsx:propose` a partir del issue y del contrato que publicaba el design de #11: cuatro lecturas y tres descargas por intento, con seis decisiones abiertas para el gate. Después, aplicar grupo a grupo con test primero y una rotura a propósito por grupo, con los `expected.json` de las muestras como oráculo de cada export.

*Resultado.* Los exports reproducen los oráculos. El summary de `batch-clean` cuadra su amount payable con la suma con signo de sus nueve líneas, y el `CHB 2` de `legacy-provider` sale como `CHB` en el TXN. Una tarea no se podía comprobar contra la base: el desempate del orden de los movimientos. Los movimientos sembrados empatan en la fila de origen y el índice ya los devuelve en ese orden, así que quitar el desempate dejaba la integración en verde. Se fijó con un test unitario del adaptador, que sí cae al quitarlo. El review-diff pidió el negativo `404` de Bruno que faltaba en los intentos de un import y algunas limpiezas menores. Dejó como deuda transversal que la validación del esquema corra antes que la autenticación en todo el API (#72). Bruno, 141/141.

*Ajuste humano.* En el gate, la persona decidió:
- **CSV limpios.** Los del Back-Office van sin trucos para Excel (ni `="…"`, ni apóstrofo), porque los consume una herramienta de terceros. El aviso de cómo abrirlos sin estropear los IDs queda junto a las descargas, y un `.xlsx` para lectura humana pasa a la Entrega 3 (#68).
- **Filas:** una por par (ID, Status).
- **Reserva:** la R que libera 0 sale igualmente en el RR.
- **Formato:** RFC 4180, CRLF y UTF-8 sin BOM.
- **Sin CORS,** porque la SPA y el API comparten origen.
- **Summary:** sus advertencias llevan el ID de origen, no el interno, y las fechas, el sufijo "(ET)".

En el triaje añadió neutralizar fórmulas en las celdas de texto del summary: un texto que empieza por `=`, `+`, `-` o `@` lleva un apóstrofo delante. Los importes, las fechas y los IDs no se tocan.

**Prompt 13:**

*Contexto.* `web-settlement` (PR #74, issue #13): las pantallas Settlement Review y Settlement Summary de la HU3. El analista revisa el número de batch propuesto, la fecha de liquidación y los fees por batch (prellenados de `Other Fees`, preestablecidos de la cuenta e importes libres), ve un resumen previo que calcula el servidor, confirma los canales que se asociarán y procesa; el Summary muestra el intento con su desglose auditable. Se construyó mientras #11 seguía en curso, contra los contratos que publicaba su design y con un API falso de MSW. El último grupo de tareas era el rebase sobre #11 ya fusionado; #12 (relectura del intento y descargas) seguía sin fusionar.

*Prompt.* Proponer el change con `/opsx:propose` a partir del issue y de los contratos de #11 y #12, leídos solo con `git show` y sin tocar la carpeta de #11. Restricciones de partida:
- Ninguna cifra se calcula en el navegador y el dinero es texto de principio a fin.
- Fechas con `BusinessDate` y `AuditInstant`, como en web-validations.
- Contrato aislado en un solo fichero y falso de MSW guionizado.
- Guardas síncronas en Process y en la vista previa, sin actualizaciones optimistas.
- Interfaz en inglés y usable con teclado; cada botón deshabilitado dice por qué con `aria-describedby`.
- El último grupo espera a que #11 esté fusionado.

Después, aplicar grupo a grupo: primero los tests, después el código, una rotura a propósito por grupo y sin modificar un test para que pase. Sin integración, E2E ni `pnpm dev` hasta el último grupo, porque la base y los puertos los usaba #11.

*Resultado.* **El design.** En la revisión se cerraron los huecos del contrato:
- La fecha de liquidación es obligatoria en la pantalla.
- Una fila de `Other Fees` de tipo desconocido queda marcada hasta que se le elige un tipo de importe libre o se quita (#60).
- #11 conserva el orden de `batchFees` y exige la descripción del importe libre (`description_required`).
- `Content-Disposition` se pidió a #12, y la lista de Settlements quedó en #64.

**Vista previa y Process.** La vista previa es una consulta con el cuerpo entero como clave, enviada 400 ms después del último cambio. Process envía el cuerpo de la vista previa que está en pantalla, nunca uno recompuesto del formulario. Una rotura prevista no podía caer: mientras la vista previa no está al día Process está deshabilitado, así que formulario y vista previa coinciden siempre que se puede pulsar. Se rompió en su lugar la espera de Process a la vista previa. Otra rotura, la guarda síncrona, enviaba dos `POST` con dos clics en el mismo tick. El test de teclado encontró un hueco real: las listas para añadir fees se deshabilitaban mientras cargaban sin decir por qué.

**El rebase.** Los tipos pasaron a ser alias de los generados y las llamadas, del cliente tipado. Las rutas de #12 siguen escritas a mano y las descargas, deshabilitadas con su motivo. Los esquemas de `@recon/shared` encontraron dos desajustes en el falso:
- devolvía los importes tal como se escribieron (`30`), no con cuatro decimales;
- no rechazaba un campo desconocido, un número de batch fuera de `INT` ni un día que no existe.

Con el merge llegaron cambios del contrato que se llevaron a la spec, cada uno con su test nuevo:
- la cuenta de otro merchant, que solo se nombra como tal;
- un intento sin resumen de incidencias;
- `409 settlement_busy` con **Retry** y el mismo cuerpo;
- el tope del número de batch.

**Contra el API real.** La forma de las respuestas coincidió con el falso y el orden de `batchFees` es el del cuerpo. El `400 description_required`, forzado quitando la descripción en la página, se pinta en su fila. Un batch sembrado como pagado cuenta como número ocupado. La recarga del Summary dice que no existe hasta que entre #12. El smoke falló una vez porque el procesado manual había asociado RAM-07; tras volver a sembrar, en verde.

**Las capturas.** Destaparon importes recortados: a 1024 px en el resumen previo, y a 1280 px en el desglose y en los totales del Summary. El contenedor de la tabla de shadcn los desplazaba fuera de la vista sin que la página desbordara, así que la comprobación de desplazamiento horizontal decía que todo estaba bien y jsdom no calcula el diseño. Ahora las etiquetas se parten, el resumen previo pasa debajo del formulario por debajo de 1280 px y el Summary usa dos columnas desde ese ancho. El script también falla si una tabla queda recortada; hicieron falta dos vueltas, porque la primera aún recortaba los totales por tipo. Por último, la intermitencia de #56 apareció en tres ficheros de imports con la suite del frontend sola, por la carga de las esperas reales del debounce.

*Ajuste humano.* La persona revisó el design punto por punto: la fecha obligatoria, el tipo desconocido con #60, los dos huecos de #11, el comentario en #12 y el issue #64. Aprobó también el debounce de 400 ms y el enlace desde un import procesado a su Summary. Revisó los tests que cambiaron (los dos de Analysis que fijaban el escenario retirado y cuatro tests propios todavía en rojo) y aceptó los desvíos del design. Tras el rebase pidió juntar dos commits para que cada uno compilara por separado. Decidió que las descargas se habiliten en un commit aparte cuando entre #12. Dio los turnos de base, aplicó las migraciones, sembró antes y después de cada procesado y entró como `analyst` y como `viewer` en el navegador, porque el asistente no inicia sesión. Vio en directo cada ejecución de las capturas y pidió llevar a #13 las notas del PR y a #56 los ficheros nuevos que fallaban por carga.

**Prompt 14:**

*Contexto.* `settlements-browse` (PR #88, issue #64): la opción Settlements del menú para la Entrega 2. Es un change pequeño y de solo lectura. El backend añade `GET /accounts/{id}/settlements`, con filtros, paginación y alcance por merchant. El frontend añade la pantalla Settlement List, a la que se llega desde el menú y desde Accounts, y una pestaña Movements en el Settlement Summary que ya existía, con los movimientos E/I/R paginados. Pagar, retirar el pago y deshacer quedan para el tramo 6.

*Prompt.* Proponer el change a partir del issue, con una sección "Contrato" para la ruta nueva y una alternativa descartada en cada decisión. Lo que hacía falta saber de la persona se listó en el proposal. Después, aplicar grupo a grupo: primero los tests, una rotura a propósito por grupo y el último grupo contra el API real con el seed, Bruno y capturas. Más restricciones:
- El dinero, siempre como texto.
- Las fechas de negocio, sin convertir; las de auditoría, en ET.
- La base, solo con turno.
- Avisar antes de lanzar el script de capturas.

*Resultado.* **Las dos fechas.** El issue no decía si `from` y `to` filtraban la fecha de liquidación o la de procesado. Se admiten las dos con `dateField`. Con `processedAt`, el día se calcula en Nueva York dentro del SQL con `AT TIME ZONE`, y lo prueban la medianoche de Nueva York y el cambio de hora de noviembre. La rotura con un desfase fijo de `-04:00` hace caer el caso del cambio de hora. La primera fixture de integración chocó con el índice único que admite un solo intento activo por import, así que cada intento tiene su propio import.

**El selector de cuenta.** Pasó a compartirse con New Reconciliation sin modificar ninguno de sus tests. Los tests de la lista destaparon dos defectos:
- Dos cambios de filtro seguidos se pisaban, porque el segundo partía de valores ya viejos. Ahora cada filtro envía solo lo que cambia.
- Al llegar por un enlace con la cuenta, completar merchant y proveedor devolvía la lista a la página 1.

El desglose de fees iba a ser un `<details>`, pero jsdom no lo abre con Enter y se cambió por un botón con `aria-expanded`. Al cerrar, el commit `feat` del endpoint no compilaba sin el adaptador y se juntaron.

**Las capturas.** La primera pasada midió tablas recortadas, que ni jsdom ni la prueba manual habían visto:
- En la lista, a 1024 px no se veían el amount payable ni los canales.
- En Movements, las once columnas no cabían ni a 1280 px: **Released on chargeback** y **Settled** quedaban fuera.

Ahora los textos se parten y los importes nunca. Las tres reservas van en una columna **Reserves**, con una línea y su etiqueta por cifra, y quedan nueve columnas. La segunda pasada midió todo bien, pero las imágenes mostraban `RAM-` / `07` y fechas partidas en el guion: el navegador también corta tras un guion, y la medición no lo ve. Cada nombre de canal y cada fecha quedaron en una sola línea, y la tercera pasada se versionó. El verify no encontró errores de código. Señaló que el flujo de Bruno filtraba por estado y no comprobaba que tras el intento nuevo viniera el 122, y se añadió esa petición.

*Ajuste humano.* La persona aprobó el design, con las dos fechas y `All statuses` por defecto, con los intentos deshechos atenuados. Dio los turnos de base, sembró antes y después de cada procesado, ejecutó Bruno y probó como `analyst` y como `viewer`. Ante las tablas recortadas eligió la columna **Reserves** frente a aceptar el desplazamiento dentro de la tabla. Exigió que cada línea llevara su etiqueta y que ningún importe se partiera, y que los PNG se versionaran solo con todas las mediciones limpias. Mantuvo sin tocar los tiempos de los tests (#56). En el triaje del verify dejó para `ui-polish` unificar los dos ayudantes que evitan partir el texto.

**Prompt 15:**

*Contexto.* `ui-polish` (PR #91): pulido de la interfaz tras la revisión con el líder del equipo del 20 de octubre (`docs/uat/2026-10-20-revision-interfaz.md`). Solo frontend, sin cambios de API ni de reglas. Doce observaciones entran en el change: menú, tarjetas, barra superior, bloques por archivo, readiness, nombre de archivo, colores de estado, tabla de rangos, contadores, cabecera del Summary, fechas sin hora y navegación dentro de la página. Seis quedan fuera: plegar archivos (#85), columna Round (#86), Transactions en Validations (#87), summary `.xlsx` (#82), selector de merchant (#83) y modo oscuro (#84).

*Prompt.* Proponer el change con su design (D1–D17) y, tras el merge y el archivo de `settlements-browse`, aplicarlo grupo a grupo: test primero, una rotura a propósito por grupo, dos commits por grupo (`test` y `feat`) y push al cerrar cada uno. Más restricciones:
- Ningún color, sombra ni tono fuera del tema, con valor claro y oscuro.
- Ninguna cifra calculada en el navegador.
- Parar solo si una decisión cambia el alcance o hace falta turno de base.

*Resultado.* **Colores de estado (D8).** Un mapa por enumeración en `lib/status-tone.ts`, con `satisfies` para que un valor nuevo de `@recon/shared` rompa `typecheck`, y `toneOf`, que da gris a un valor sin entrada. La rotura `blocked → warning` hizo caer el mapa y la corrida bloqueada.

**Navegación dentro de la página (D13).** El router vuelve arriba en cada cambio de búsqueda, también en jsdom, y los tests lo vieron con un espía de `window.scrollTo`. Cada navegación que solo cambia lo que muestra la pantalla lleva `resetScroll: false`. El foco va al encabezado de la lista solo cuando lo pide la acción del usuario: un botón de filtro, una validación, el ciclo o Previous/Next. Nunca lo piden un desplegable, una fecha, una recarga, un enlace ni el `useLastPageLimit`. Dos roturas: quitar `resetScroll` de `go` y quitar la comprobación de la petición pendiente, que robaba el foco al llegar por enlace.

**Tests que cambiaron a propósito.** Además de los listados en D15, cambiaron `SettlementSummary.test.tsx:151` en el grupo de fechas (el formateador ya lo cambiaba ahí) y tres aserciones de la readiness en `analyze.test.tsx`; quedaron anotados en D15. El Badge de estado del Summary pasó a la rejilla para no repetirse, porque `read-only` y `exports` lo buscan por su texto. La suite completa en local mostró otra vez la intermitencia de #56 bajo carga, la misma en el commit base.

*Ajuste humano.* La persona aprobó el mapa de D8 con un criterio que quedó escrito en el design: el color responde a "¿queda algo pendiente?", no a "¿salió bien el paso?". Pidió gris para lo que no está en el mapa, con un test, y el color nunca solo, con el texto del estado y contraste AA. Mantuvo dos commits por grupo y dejó para la revisión de capturas ajustar el verde del import frente al ámbar del batch si confunde.

**Prompt 16:**

*Contexto.* Cierre de la Entrega 2 (issue #18): solo documentación, sin tocar código, base ni migraciones. El vídeo de la demo pasa a la Entrega 3.

*Prompt.* Auditar primero y devolver una lista de huecos antes de escribir nada. La auditoría compara el repositorio con el enunciado de la Entrega 2 (flujo conectado, configuración reproducible, ADR de los cambios de rumbo, pruebas de las partes críticas, `prompts.md`) y con las tareas del #18. Tiene que comprobar que cada comando del §1.4 existe en un `package.json`, que el `.env.example` tiene todas las variables que lee el código y que los enlaces del README funcionan. Después del visto bueno, commits pequeños por sección y PR hacia la rama de entrega. Más restricciones:
- Sin `cd` ni rutas absolutas.
- No leer los `.env`.
- Ningún nombre de sistema real.

*Resultado.* La auditoría encontró:
- `docs/adr/` vacía, aunque el README anunciaba seis ADR.
- Textos que seguían diciendo "Entrega 1", "todavía no se ha comenzado a programar" o "pruebas previstas", y un árbol de ficheros que no coincidía con el repositorio.
- El §1.5 con #64 como recortado, aunque ya se había entregado.
- El §7 sin los dos últimos PR.
- Numeración repetida en esta sección.
- El §1.4 pidiendo un solo `.env`, aunque la colección Bruno necesita el suyo.

Los comandos del §1.4 y los enlaces relativos estaban bien. El agente no pudo leer los `.env.example`, porque los ajustes de permisos se lo impedían, y no intentó saltárselo: la persona los pegó en la sesión. En `.env.example` aparecieron `JWT_SECRET` duplicado, un `CORS_ORIGIN` que no lee ningún código y la falta de un salto de línea final. Con el visto bueno se escribieron ADR-001 a ADR-011. Un subagente reunió la evidencia de cada decisión y el agente la contrastó con las migraciones y el código antes de escribir. También se actualizaron los §0, §1.2 a §1.5, §2 y §7 y el registro de `docs/uat/`, y se abrió el issue del vídeo (#96).

*Ajuste humano.* La persona aprobó escribir los ADR con los cambios de rumbo reales y confirmó que solo hubo una sesión con revisores, la del 20 de octubre: buena valoración general y observaciones sobre todo de interfaz. Pidió que el §1.4 dejara claros los dos `.env` y todo lo que una instalación desde cero necesita. Dictó la regla de importes y moneda y la limitación del batch solo de fees (#92). Al comprobar las notas de la sesión, el agente vio que el resumen que había escrito no coincidía con lo ocurrido y lo corrigió: fue una revisión de pantallas con el líder del equipo, no de tareas guiadas.
