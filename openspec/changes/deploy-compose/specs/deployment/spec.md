# Spec Delta

## Purpose

Permite ejecutar Recon Tool fuera del entorno de desarrollo, en contenedores y con una única entrada pública por túnel, de forma reproducible, sin secretos en el repositorio y conservando los datos entre versiones.

## ADDED Requirements

### Requirement: Imagen de la API ejecutable
El repositorio SHALL permitir construir una imagen de la API que arranque desde el código compilado, sin herramientas de desarrollo y con un usuario distinto de root, y que se conecte a SQL Server.

#### Scenario: La API arranca y llega a la base
- **WHEN** el contenedor de la API arranca con las variables de conexión de una base migrada
- **THEN** `GET /api/v1/health` responde `200` con `status` `ok` y `db` `ok`, y un login con un usuario del seed devuelve tokens

#### Scenario: El proceso no es root
- **WHEN** se consulta el usuario del proceso dentro del contenedor de la API
- **THEN** no es `root`

#### Scenario: El estado de salud refleja la base
- **WHEN** la base deja de responder
- **THEN** `GET /api/v1/health` responde `503` y el contenedor pasa a `unhealthy`

### Requirement: Arranque compilado fuera de los contenedores
El script `start` del backend SHALL arrancar el backend compilado en un build limpio. El desarrollo, los tests y el typecheck SHALL seguir funcionando sin compilar antes el paquete compartido.

#### Scenario: Start tras un build limpio
- **WHEN** se compilan el paquete compartido y el backend y se ejecuta `start`
- **THEN** el proceso escucha y no falla por un módulo no encontrado

#### Scenario: Desarrollo sin compilar
- **WHEN** se ejecutan `pnpm typecheck` y `pnpm test` en un clon sin carpetas `dist`
- **THEN** terminan en verde

### Requirement: Web y API en un solo origen
La imagen web SHALL servir la SPA y reenviar `/api` a la API, de modo que el navegador use un único origen, sin CORS.

#### Scenario: Ruta profunda de la SPA
- **WHEN** se pide directamente una ruta de la SPA que no corresponde a un archivo
- **THEN** la respuesta es `200` con `index.html`

#### Scenario: Proxy de la API
- **WHEN** se pide `/api/v1/health` al servicio web
- **THEN** la respuesta es la de la API

#### Scenario: Subida al tamaño máximo
- **WHEN** se sube por el servicio web un archivo de 20 MiB, el máximo que admite la API
- **THEN** el servicio web no lo rechaza por tamaño

#### Scenario: Cabeceras de seguridad
- **WHEN** se pide cualquier respuesta del servicio web
- **THEN** incluye `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Content-Security-Policy`

### Requirement: Entrada única por túnel
En el despliegue, el túnel SHALL ser el único camino de entrada desde internet y ningún servicio SHALL publicar puertos en el host. Solo el servicio del túnel SHALL tener salida a internet, salvo con una base externa, donde la API también la necesita.

#### Scenario: Sin puertos publicados
- **WHEN** se inspecciona la configuración del despliegue estándar
- **THEN** ningún servicio publica puertos en el host

#### Scenario: Servicios internos sin salida
- **WHEN** se intenta abrir una conexión a internet desde `web`, `api` o `mssql` en el despliegue estándar
- **THEN** la conexión falla

#### Scenario: Prueba local
- **WHEN** se levanta el despliegue en modo de depuración
- **THEN** la web solo es accesible en `127.0.0.1` y el túnel no arranca

### Requirement: Arranque ordenado y saludable
La API SHALL esperar a que la base esté lista, incluidos su base de datos y sus usuarios, y la web SHALL esperar a la API. Con la configuración completa, todos los servicios SHALL quedar `healthy`.

#### Scenario: Primer arranque con volumen vacío
- **WHEN** se levanta el despliegue por primera vez
- **THEN** la API arranca solo después de que existan la base de datos y sus usuarios, y todos los servicios quedan `healthy`

### Requirement: Base de datos sustituible
La API SHALL conectarse únicamente a través de variables de entorno, de modo que se pueda usar un SQL Server externo sin levantar el servicio `mssql` y sin cambiar código.

#### Scenario: SQL Server externo
- **WHEN** se configura el modo de base externa con sus variables de conexión
- **THEN** el servicio `mssql` no arranca y la API responde `200` en el health contra esa base

### Requirement: Migraciones y seed explícitos
`up` SHALL NOT ejecutar migraciones ni seed. Las migraciones SHALL aplicarse con `prisma migrate deploy` bajo orden explícita. El seed SHALL pedir confirmación. Ningún flujo de despliegue SHALL usar `migrate dev`, `db push` ni `migrate reset`.

#### Scenario: Up no migra
- **WHEN** se ejecuta `up` con una migración pendiente
- **THEN** la migración sigue pendiente hasta que se da la orden de migrar

#### Scenario: Migrar sin migraciones pendientes
- **WHEN** se da la orden de migrar con la base al día
- **THEN** termina con éxito sin cambiar nada

#### Scenario: Seed sin confirmar
- **WHEN** se da la orden de seed y no se confirma
- **THEN** no se ejecuta y los datos no cambian

### Requirement: Identidades de base de datos separadas
Las migraciones SHALL ejecutarse con una identidad distinta de `recon_app`. En el despliegue, `recon_app` SHALL NOT poder cambiar el esquema y la API SHALL NOT usar `sa`.

#### Scenario: La aplicación no puede cambiar el esquema
- **WHEN** `recon_app` intenta crear una tabla en la base del despliegue
- **THEN** SQL Server lo rechaza por permisos

#### Scenario: Flujo completo sin DDL de la aplicación
- **WHEN** la API se ejecuta como `recon_app` en el despliegue
- **THEN** el recorrido import → validaciones → settlement → descargas funciona con `data/samples/batch-clean`

### Requirement: Configuración sin secretos en el repositorio
El repositorio SHALL incluir una plantilla versionada con todas las variables del despliegue, sin secretos reales y con `TUNNEL_TOKEN` vacío. El archivo real SHALL estar ignorado por Git y SHALL NOT entrar en las imágenes.

#### Scenario: Plantilla versionada y archivo real ignorado
- **WHEN** se consulta Git con `infra/.env.deploy.example` e `infra/.env.deploy`
- **THEN** el primero no está ignorado y el segundo sí

#### Scenario: Gitleaks en verde
- **WHEN** gitleaks analiza el repositorio
- **THEN** no informa de ningún hallazgo

#### Scenario: Variables obligatorias
- **WHEN** falta un secreto obligatorio en la configuración
- **THEN** el despliegue no arranca y el error nombra la variable, sin mostrar valores

#### Scenario: Secretos por servicio
- **WHEN** se inspeccionan las variables de cada contenedor
- **THEN** cada servicio recibe solo las que necesita: la API no ve la contraseña de `sa` ni el token del túnel, y el túnel no ve credenciales de base de datos

### Requirement: Actualización sin pérdida de datos
Actualizar a una versión nueva SHALL conservar la base de datos y los archivos subidos.

#### Scenario: Actualizar conserva los datos
- **WHEN** hay un import con archivos subidos y se ejecutan las órdenes de actualizar (traer cambios, construir, migrar, levantar)
- **THEN** el import y la descarga de sus archivos siguen disponibles

### Requirement: Comprobación de imágenes en la CI
La CI SHALL construir las imágenes en cada pull request, sin publicarlas, y SHALL validar la configuración del despliegue.

#### Scenario: Dockerfile roto
- **WHEN** un pull request rompe un Dockerfile
- **THEN** el check de la CI falla

#### Scenario: Sin publicación
- **WHEN** el job termina en verde
- **THEN** no se ha subido ninguna imagen a un registro

### Requirement: Procedimiento documentado
`docs/deploy.md` SHALL describir el procedimiento completo en lenguaje llano para quien no lo ha hecho antes, y el README SHALL enlazarlo. La documentación SHALL NOT incluir el nombre del servidor ni su ubicación física.

#### Scenario: Pasos completos
- **WHEN** se lee `docs/deploy.md`
- **THEN** cubre instalar Docker, clonar, crear el `.env.deploy`, crear el túnel y copiar el token, levantar, migrar, sembrar, comprobar, actualizar y resolver fallos

#### Scenario: Límite de intentos de login como paso obligatorio
- **WHEN** se lee el procedimiento de `docs/deploy.md`
- **THEN** crear la regla de rate limiting de Cloudflare sobre `/api/v1/auth/login` es un paso obligatorio, descrito clic a clic, antes de dar la URL por publicada

#### Scenario: Sin datos del servidor
- **WHEN** se revisan `docs/deploy.md` y README §0.4, §1.4 y §2.4
- **THEN** no aparecen el nombre del servidor, su ubicación ni un identificador de máquina
