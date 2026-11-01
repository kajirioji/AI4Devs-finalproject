# api-collection Specification

## Purpose

Colección ejecutable de la API de Recon Tool para desarrollo local: peticiones versionadas en el repo que cualquier persona o agente lanza contra el backend levantado para explorar los endpoints y comprobar, como suite de humo, que auth, catálogo y health siguen cumpliendo su contrato.

## Requirements

### Requirement: Ubicación y origen de la colección
La colección SHALL vivir en `api-collection/` en formato de texto plano versionable, organizada en las carpetas `00-auth`, `10-smoke` y `20-flows`. Su contenido inicial SHALL generarse una única vez a partir de `docs/openapi.yaml`; después SHALL mantenerse a mano y nunca regenerarse por importación sobre la existente.

#### Scenario: Estructura tras el alta
- **WHEN** se lista `api-collection/`
- **THEN** existen la definición de la colección, el entorno `local`, `.env.example` y las carpetas `00-auth`, `10-smoke` y `20-flows`, y no queda ninguna petición fuera de esas carpetas

#### Scenario: Cada petición apunta a una ruta del contrato
- **WHEN** se compara cada petición de la colección con `docs/openapi.yaml`
- **THEN** su método y su ruta existen en el documento OpenAPI, bajo `/api/v1`

### Requirement: Entorno local y credenciales fuera del repo
La colección SHALL tener un entorno `local` con `baseUrl = http://localhost:3000` y todas las peticiones SHALL construir su URL a partir de `baseUrl`. Usuarios y contraseña SHALL leerse de `api-collection/.env`, que git SHALL ignorar; `api-collection/.env.example` SHALL versionarse con `SEED_USER`, `SEED_VIEWER_USER` y `SEED_PASSWORD` y sus valores sintéticos del seed. Ningún archivo versionado SHALL contener un token, y `reports/` SHALL estar ignorado.

#### Scenario: El .env no se versiona
- **GIVEN** un `api-collection/.env` con credenciales
- **WHEN** se ejecuta `git status` y `git check-ignore api-collection/.env`
- **THEN** el archivo aparece como ignorado y no figura entre los cambios

#### Scenario: Informes ignorados
- **WHEN** se ejecuta `git check-ignore reports/`
- **THEN** la ruta aparece como ignorada

#### Scenario: Sin tokens en el repo
- **WHEN** se busca en `api-collection/` un valor con forma de JWT (`eyJ…`)
- **THEN** no hay coincidencias en ningún archivo versionado

### Requirement: Autenticación automática y heredada
La colección SHALL obtener por sí sola un access token antes de la primera petición protegida, con login como `SEED_USER` (`analyst`), y SHALL guardar el par en variables de ejecución, no en archivos. Las peticiones protegidas SHALL heredar la autenticación `Bearer` de la colección; solo SHALL sobrescribirla los negativos de autenticación y los que necesitan `viewerToken`.

#### Scenario: Smoke sin login previo
- **GIVEN** el backend levantado con el seed y un `.env` válido
- **WHEN** se ejecuta solo la carpeta `10-smoke`, sin pasar por `00-auth`
- **THEN** las peticiones protegidas reciben `200` porque la colección hizo login primero

#### Scenario: Usuario principal
- **GIVEN** el `.env` copiado de `.env.example`
- **WHEN** se ejecuta `GET /api/v1/auth/me` con la auth heredada
- **THEN** recibe `200` con `userName = "analyst"`

#### Scenario: Credenciales inválidas
- **GIVEN** un `.env` con una contraseña incorrecta
- **WHEN** se ejecuta la colección
- **THEN** el login falla con `401` y la ejecución termina con fallos, sin quedarse colgada

### Requirement: Segundo usuario para los casos negativos
La colección SHALL obtener un segundo token, `viewerToken`, con login como `SEED_VIEWER_USER` (`viewer`) solo cuando una petición lo necesite, y SHALL usarlo únicamente en los negativos de alcance (`404`) y de permiso (`403`). `viewerToken` SHALL guardarse en variables de ejecución y nunca sustituir al token principal.

#### Scenario: Token de viewer bajo demanda
- **GIVEN** una ejecución que no ha usado `viewerToken`
- **WHEN** llega la primera petición que lo necesita
- **THEN** la colección hace login como `viewer`, la petición sale con `Bearer {{viewerToken}}` y las peticiones siguientes con la auth heredada siguen saliendo como `analyst`

#### Scenario: Negativo de permiso
- **GIVEN** un endpoint que exige un permiso que `viewer` no tiene (los primeros llegan con el tramo 2)
- **WHEN** se añade su petición a la colección
- **THEN** su negativo usa `viewerToken` y comprueba `403` con `code = "forbidden"`

### Requirement: Cobertura mínima por endpoint
Cada endpoint existente de auth, catálogo y health SHALL tener en la colección al menos una petición de caso feliz y una de caso negativo, con aserciones sobre el código de estado y, en los errores, sobre `code` del cuerpo. Las aserciones SHALL derivarse de los escenarios de las specs `auth` y `accounts` y del seed, sin inventar reglas. Excepción: health no tiene caso negativo (su `503` exige la base caída).

#### Scenario: Endpoints de auth
- **WHEN** se revisan las peticiones de `00-auth`
- **THEN** cubren login (`200` y `401 invalid_credentials` con contraseña incorrecta), me (`200` con `userName` del `.env` y `401 unauthorized` sin token), refresh (`200` con un par nuevo y `401 invalid_token` con un access token) y logout (`204` y su idempotencia)

#### Scenario: Endpoints de catálogo
- **WHEN** se revisan las peticiones de `10-smoke`
- **THEN** cada una de las nueve rutas de catálogo tiene un `200` y un negativo (`401` sin token, `400` con identificador mal formado o `404 not_found` para un recurso inexistente o fuera del alcance)

#### Scenario: Alcance por merchant
- **GIVEN** `viewerToken` (`viewer`, solo el merchant 1)
- **WHEN** pide `GET /api/v1/providers/201` (proveedor del merchant 2)
- **THEN** recibe `404` con `code = "not_found"`, nunca `403`
- **AND** la misma petición con la auth heredada (`analyst`, merchants 1 y 2) recibe `200`

#### Scenario: Health
- **WHEN** se ejecuta la petición de health con la base levantada
- **THEN** recibe `200` con `status = "ok"` y `db = "ok"`

### Requirement: Flujos encadenados
La carpeta `20-flows` SHALL contener recorridos que encadenan peticiones pasando identificadores y tokens de una respuesta a la siguiente, sin valores fijos de UUID: el ciclo de sesión (login, refresh, reuso del refresh rotado, logout, refresh tras logout) y la bajada por el catálogo (merchants, proveedores, cuentas, detalle de cuenta y sus canales). Los flujos no SHALL invalidar la sesión que usan las demás carpetas.

#### Scenario: Ciclo de sesión
- **WHEN** se ejecuta el flujo de sesión
- **THEN** login responde `200`, refresh `200`, el refresh ya rotado `401 invalid_token`, logout `204` y refresh tras logout `401 invalid_token`
- **AND** las peticiones protegidas ejecutadas después siguen recibiendo `200`

#### Scenario: Bajada por el catálogo
- **GIVEN** `analyst` autenticado con la auth heredada
- **WHEN** se ejecuta el flujo de catálogo
- **THEN** `GET /merchants` devuelve `Merchant A` y `Merchant B`, los proveedores del merchant 1 son `Provider A` y `Provider B`, y la cuenta `ProviderA-USD` obtenida de `GET /providers/101/accounts` responde `200` en su detalle y en sus canales

### Requirement: Ejecución por línea de comandos
El repositorio SHALL ofrecer `pnpm test:api`, que ejecuta la colección completa con el entorno `local`, y `pnpm test:api:smoke`, que ejecuta solo `10-smoke`. Ambos SHALL terminar con código distinto de cero si alguna aserción o petición falla, y SHALL funcionar en Windows y en sistemas POSIX.

#### Scenario: Suite verde
- **GIVEN** la base sembrada, `pnpm dev` levantado y un `.env` válido
- **WHEN** se ejecuta `pnpm test:api`
- **THEN** todas las peticiones pasan y el proceso termina con código `0`

#### Scenario: Backend caído
- **GIVEN** el backend parado
- **WHEN** se ejecuta `pnpm test:api:smoke`
- **THEN** el proceso termina con código distinto de `0`

### Requirement: Reglas para agentes
`CLAUDE.md` y `AGENTS.md` SHALL indicar que todo endpoint nuevo o modificado añade o actualiza su petición feliz y su negativa en la colección, que la colección no se reimporta desde OpenAPI y cómo ejecutarla. La configuración del agente SHALL permitir `pnpm test:api*` sin confirmación y SHALL denegar la lectura de `api-collection/.env`.

#### Scenario: Permisos del agente
- **WHEN** se revisa `.claude/settings.json`
- **THEN** `allow` contiene `Bash(pnpm test:api*)` y `deny` contiene la lectura de `api-collection/.env`

#### Scenario: Instrucciones alineadas
- **WHEN** se comparan `CLAUDE.md` y `AGENTS.md`
- **THEN** ambos contienen la misma regla de la colección y los comandos `pnpm test:api` y `pnpm test:api:smoke`

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
