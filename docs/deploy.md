# Guía de despliegue

Esta guía publica Recon Tool en una URL pública desde un servidor con Docker. Está pensada para quien no lo ha hecho antes: sigue las secciones en orden y no te saltes ninguna. La aplicación solo debe usarse con datos sintéticos.

> **Contrastado el 2026-10-31.** Los pasos del panel de Cloudflare (secciones 5, 6 y 10) se han comprobado en un despliegue real. Cloudflare cambia sus menús con frecuencia: si algo aparece con otro nombre, busca el equivalente y corrige esta guía.

## 1. Qué es cada pieza

- **Contenedor:** un programa empaquetado con todo lo que necesita, aislado del resto del servidor.
- **Imagen:** la plantilla a partir de la que se crea un contenedor.
- **Docker Compose:** la herramienta que arranca varios contenedores juntos, según un archivo de configuración.
- **Volumen:** el espacio de disco donde un contenedor guarda lo que debe sobrevivir. Aunque el contenedor se borre, el volumen sigue ahí.
- **Túnel de Cloudflare:** una conexión que sale del servidor hacia Cloudflare. Las visitas llegan por ella, así que no hay que abrir puertos en el router.
- **Migración:** un cambio en la estructura de la base de datos, guardado en el repositorio. Se aplica con una orden explícita, nunca al arrancar.
- **Seed:** la carga del mundo de datos sintéticos de demostración.

El despliegue tiene cuatro servicios siempre en marcha:

| Servicio | Qué hace | ¿Sale a internet? |
|---|---|---|
| `cloudflared` | Mantiene el túnel | Sí, es el único |
| `web` | Sirve la aplicación y reenvía `/api` a `api` | No |
| `api` | La API, conectada como `recon_app`, que no puede cambiar la estructura de la base | No |
| `mssql` | SQL Server 2022 | No |

Ningún servicio publica puertos en el servidor. `migrate` y `seed` solo se ejecutan cuando se les ordena, con su propia identidad de base de datos, `recon_migrator`.

## 2. Qué necesitas

- Un servidor Linux de arquitectura x86-64 (la imagen de SQL Server 2022 no existe para ARM), con al menos 2 GB de memoria para SQL Server. Los ejemplos usan Ubuntu.
- Una cuenta de Cloudflare con un dominio propio ya añadido.
- Acceso por SSH al servidor, con permisos de `sudo`.

## 3. Instalar Docker y clonar

Instala Docker Engine con el plugin de Compose, versión 2.24 o superior, y da permiso a tu usuario:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Cierra la sesión SSH, vuelve a entrar y comprueba la versión:

```bash
docker compose version
```

Clona el repositorio:

```bash
git clone -b feature/entrega-3-MVP https://github.com/kajirioji/AI4Devs-finalproject.git recon-tool
cd recon-tool
```

Todas las órdenes siguientes se ejecutan desde esa carpeta.

## 4. Crear la configuración

```bash
cp infra/.env.deploy.example infra/.env.deploy
chmod 600 infra/.env.deploy
```

`infra/.env.deploy` guarda los secretos. Git lo ignora y nunca debe subirse. Genera un valor distinto para cada contraseña con esta orden, que cumple la política de SQL Server y evita el carácter `$`, que Compose interpretaría:

```bash
echo "Rc1-$(openssl rand -hex 20)"
```

Y el secreto de firma con esta otra:

```bash
openssl rand -hex 32
```

Rellena el archivo con un editor (`nano infra/.env.deploy`):

| Variable | Qué poner |
|---|---|
| `MSSQL_SA_PASSWORD` | Contraseña generada; es la del administrador de SQL Server |
| `RECON_APP_PASSWORD` | Contraseña generada; la usa la API |
| `RECON_MIGRATOR_PASSWORD` | Contraseña generada; la usan `migrate` y `seed` |
| `JWT_SECRET` | El secreto de firma |
| `SEED_PASSWORD` | Contraseña generada; será la de los usuarios de demostración |
| `TUNNEL_TOKEN` | Se rellena en la sección siguiente |

Guarda el archivo en tu gestor de contraseñas: sin backups, es lo único que te da acceso a la base.

**Cambiar una contraseña de base de datos después del primer arranque no basta con editar este archivo:** los usuarios ya existen en SQL Server con la anterior. Hay que cambiarla también dentro con `ALTER LOGIN`.

## 5. Crear el túnel y copiar el token

1. Entra en [one.dash.cloudflare.com](https://one.dash.cloudflare.com) y elige tu cuenta.
2. Abre **Networks** → **Tunnels** y pulsa **Create a tunnel**.
3. Elige **Cloudflared**, ponle un nombre y pulsa **Save tunnel**.
4. La pantalla de instalación muestra un selector de sistema operativo y una orden truncada con un botón de copiar. Elige **Docker** y copia la orden. **No la ejecutes:** toma solo el texto que va después de `--token`, que empieza por `eyJ`, y pégalo como valor de `TUNNEL_TOKEN` en `infra/.env.deploy`.
5. Deja esa pantalla abierta. El botón **Continue** sigue desactivado hasta que el túnel conecta, y eso ocurre en la sección siguiente.

El token permite conectar con tu túnel: trátalo como una contraseña.

## 6. Construir y levantar

```bash
scripts/deploy.sh build
scripts/deploy.sh up --wait
scripts/deploy.sh ps
```

`build` tarda varios minutos la primera vez. Al terminar, `ps` debe mostrar los cuatro servicios como `healthy`. El panel de Cloudflare debe mostrar el túnel como **Healthy**.

Con el túnel conectado, añade la URL pública en el panel:

1. Pulsa **Continue**. Llegarás a la vista del túnel, con las pestañas **Overview**, **Routes** y **Live logs**.
2. Pulsa **Add route** y elige **Published application**.
3. En **Subdomain** y **Domain**, elige la URL pública. **Full hostname** muestra el resultado. Deja **Path** vacío.
4. En **Service URL**, escribe `http://web:8080`. Es el nombre del servicio dentro de Docker, no el del servidor.
5. Guarda la ruta.

La URL ya responde, pero **el login todavía falla**: la base está vacía hasta completar las dos secciones siguientes.

## 7. Migrar

Crea las tablas en la base:

```bash
scripts/deploy.sh migrate
```

Debe terminar con `All migrations have been successfully applied`. Si la repites sin cambios pendientes, dice `No pending migrations to apply` y no cambia nada.

## 8. Sembrar los datos de demostración

```bash
scripts/deploy.sh seed
```

**Esta orden borra todos los datos de la base** y carga el mundo sintético, por eso pide escribir `seed` para continuar. Tarda unos minutos. Ejecútala solo en una instalación nueva o cuando quieras volver a empezar.

## 9. Comprobar

Comprueba el estado de salud sustituyendo el dominio por el tuyo:

```bash
curl https://recon.example.com/api/v1/health
```

Debe responder `{"status":"ok","db":"ok"}`. Después abre la URL en un navegador y entra con el usuario `analyst` y el valor de `SEED_PASSWORD` de `infra/.env.deploy`. No sirve la contraseña de un entorno local: el despliegue no lee el `.env` de la raíz. Si cambias `SEED_PASSWORD`, no surte efecto hasta volver a sembrar. Repite la prueba desde un dispositivo fuera de la red local, por ejemplo un móvil con datos.

## 10. Proteger la entrada (obligatorio)

**Sin estos dos pasos la URL no se da por publicada.**

### Forzar HTTPS

Sin este paso, quien entre por `http://` envía su contraseña sin cifrar hasta Cloudflare. Estos ajustes afectan a todo el dominio: si tienes otros servicios en él que solo funcionan por `http://`, resuélvelo antes.

1. Entra en [dash.cloudflare.com](https://dash.cloudflare.com) y abre tu dominio.
2. Abre **SSL/TLS** → **Edge Certificates**.
3. Activa **Always Use HTTPS**.
4. En **HTTP Strict Transport Security (HSTS)**, pulsa **Enable HSTS** y acepta el aviso.
5. Activa **Enable HSTS**, elige `Max Age` de `1 month`, deja **Include subdomains** y **Preload** desactivados y pulsa **Save**. Los navegadores recuerdan este ajuste durante ese tiempo, así que desactivarlo no surte efecto al momento. Una vez activado, el botón pasa a llamarse **Change HSTS Settings**.

Comprueba que funciona. La primera orden debe mostrar una redirección `301` o `308` hacia `https://`, y la segunda una línea `strict-transport-security`:

```bash
curl -sI http://recon.example.com | grep -iE '^(HTTP|location)'
curl -sI https://recon.example.com | grep -i '^strict-transport-security'
```

### Limitar los intentos de login

La API no limita los intentos de login, así que hace falta esta regla.

1. Entra en [dash.cloudflare.com](https://dash.cloudflare.com) y abre tu dominio.
2. Abre **Security** → **Security rules** y, en la sección **Rate limiting rules**, crea una regla. El plan gratuito solo admite una; si ya la tienes ocupada (`1/1 rules`), tendrás que editarla o eliminarla.
3. En **Rule name**, escribe `login`.
4. En **When incoming requests match...**, abre el editor de expresión (en el alta, el enlace **Edit expression**, no reverificado) y pega:

   ```text
   (http.request.uri.path eq "/api/v1/auth/login" and http.request.method eq "POST")
   ```

5. En **With the same characteristics...**, deja **IP**. En el plan gratuito no se puede cambiar.
6. En **When rate exceeds...**, pon **Requests** `5` y **Period** `10 seconds`.
7. En **Then take action...**, elige **Block** en **Choose action**.
8. En **For duration...**, elige `10 seconds`, la única opción del plan gratuito.
9. Deja **Execution order** en **First** y **Status** en **Active**.
10. Guarda la regla: el botón es **Deploy** en el alta (no reverificado) y **Save** al editarla.

Comprueba que funciona. Esta orden usa una contraseña equivocada y debe mostrar varios `401` y, después, `429`:

```bash
for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -d '{"userName":"analyst","password":"wrong"}' https://recon.example.com/api/v1/auth/login; done
```

## 11. Actualizar a una versión nueva

```bash
git pull
scripts/deploy.sh build
scripts/deploy.sh migrate
scripts/deploy.sh up --wait
```

La base y los archivos subidos viven en volúmenes y se conservan. No ejecutes `seed` al actualizar.

Para volver a una versión anterior, haz `git checkout` de esa versión, `scripts/deploy.sh build` y `scripts/deploy.sh up --wait`. Las migraciones no se deshacen solas: si la versión nueva aplicó alguna incompatible con la anterior, necesitas un plan propio.

## 12. Órdenes de uso diario

| Orden | Qué hace | ¿Borra datos? |
|---|---|---|
| `scripts/deploy.sh ps` | Muestra el estado de los servicios | No |
| `scripts/deploy.sh logs api` | Sigue los registros de un servicio (`Ctrl+C` para salir) | No |
| `scripts/deploy.sh down` | Para y elimina los contenedores; los volúmenes siguen | No |
| `scripts/deploy.sh seed` | Recarga el mundo sintético | **Sí, toda la base** |
| `docker compose --env-file infra/.env.deploy -f infra/docker-compose.deploy.yml down -v` | Elimina también los volúmenes | **Sí, base y archivos** |

**No hay backups programados:** los volúmenes son la única copia. Por seguridad, `scripts/deploy.sh` no ofrece eliminar volúmenes.

Nunca se usan `prisma migrate dev`, `prisma db push` ni `prisma migrate reset` en un despliegue.

## 13. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `required variable ... is missing a value` | Falta un valor en `infra/.env.deploy` | Rellena la variable que nombra el error |
| `TUNNEL_TOKEN is empty` | No se copió el token | Sección 5 |
| `cloudflared` queda `unhealthy` | Token incorrecto o sin salida a internet | `scripts/deploy.sh logs cloudflared` y revisa el token |
| Cloudflare muestra el error 1033 | El túnel no está conectado | Comprueba `cloudflared` con `ps` y `logs` |
| Cloudflare muestra un error 502 | La **Service URL** de la ruta está mal | Debe ser `http://web:8080` |
| La URL abre pero el login falla | Falta migrar o sembrar | Secciones 7 y 8 |
| `api` no arranca y sus registros indican `Login failed` | La contraseña se cambió después del primer arranque | Sección 4, `ALTER LOGIN` |
| `Msg 904` en los registros de `mssql` | SQL Server aún arranca | Es normal si va seguido de `[init] done`: se reintenta solo |
| `mssql` se reinicia y aparece `[init] failed` | La inicialización no pudo terminar, a menudo por una contraseña débil | Lee el `Msg` anterior en `scripts/deploy.sh logs mssql` |
| `mssql` no arranca, sin más detalle | Poca memoria o disco | `free -h` y `df -h` |
| Una subida grande falla por la URL pública | Límites de Cloudflare (sección 15) | Divide el archivo |
| `429` al entrar | Se activó la regla de login | Espera y vuelve a probar |

## 14. Opciones

### Probar sin túnel

Con `DEPLOY_DEBUG=1`, `cloudflared` no arranca, el token puede estar vacío y la web responde solo en la propia máquina, en `http://127.0.0.1:8080`. Es el único puerto de depuración. Por eso `web` tiene salida a internet en este modo: no lo uses para publicar.

```bash
DEPLOY_DEBUG=1 scripts/deploy.sh build
DEPLOY_DEBUG=1 scripts/deploy.sh up --wait
DEPLOY_DEBUG=1 scripts/deploy.sh migrate
DEPLOY_DEBUG=1 scripts/deploy.sh seed
DEPLOY_DEBUG=1 scripts/deploy.sh ps
```

Usa `DEPLOY_DEBUG=1` en todas las órdenes de la sesión.

### Usar un SQL Server externo

Con esta opción el servicio `mssql` no arranca y `api`, `migrate` y `seed` salen de Docker para llegar a la base.

1. Pide a quien administre ese servidor que ejecute, como administrador, [`infra/mssql/init.sql`](../infra/mssql/init.sql) y luego [`infra/mssql/init.deploy.sql`](../infra/mssql/init.deploy.sql). Reciben sus valores como variables de `sqlcmd`:

   ```bash
   sqlcmd -S SERVIDOR -U ADMIN -C -b -v RECON_APP_PASSWORD="..." DB_NAME="ReconTool" -i infra/mssql/init.sql
   sqlcmd -S SERVIDOR -U ADMIN -C -b -v RECON_MIGRATOR_PASSWORD="..." DB_NAME="ReconTool" -i infra/mssql/init.deploy.sql
   ```

2. En `infra/.env.deploy`, pon `DEPLOY_DB=external` y rellena `DB_HOST`, `DB_PORT` y `DB_NAME`.
3. Deja un valor cualquiera en `MSSQL_SA_PASSWORD`. No se usa, pero Compose lo exige.
4. Sigue desde la sección 6.

Con base externa la copia de seguridad y los permisos de red corren por cuenta de quien administra ese servidor.

## 15. Límites de Cloudflare

El plan gratuito corta las peticiones de más de 100 MB y las respuestas que tardan más de unos 100 segundos. La aplicación admite 20 MiB por archivo y hasta 200 MiB en total, así que un batch que supere los 100 MB puede fallar por la URL pública aunque el servidor lo acepte. Los archivos de `data/samples/` quedan muy por debajo de ese límite.

## 16. Limitación conocida: IP en la auditoría

La auditoría de los logins registra la IP del contenedor `web`, no la de quien entra, porque la API todavía no confía en la cabecera `X-Forwarded-For`. No uses ese dato para identificar a nadie. Para ver los intentos por IP, usa el panel de Cloudflare.
