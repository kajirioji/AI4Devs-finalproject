#!/bin/bash
# Starts SQL Server and runs the init scripts (idempotent), retrying while the server finishes starting:
# with existing data it answers SELECT 1 before it can open the databases (Msg 904).
set -e

apply_init() {
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT 1" -b -o /dev/null 2>/dev/null || return 1
  echo "[init] SQL Server ready; applying init.sql"
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b \
    -v RECON_APP_PASSWORD="$RECON_APP_PASSWORD" DB_NAME="${DB_NAME:-ReconTool}" -i /init/init.sql || return 1
  # Mounted by infra/docker-compose.deploy.yml only.
  if [ -f /init/init.deploy.sql ]; then
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b \
      -v RECON_MIGRATOR_PASSWORD="$RECON_MIGRATOR_PASSWORD" DB_NAME="${DB_NAME:-ReconTool}" -i /init/init.deploy.sql || return 1
  fi
}

/opt/mssql/bin/sqlservr &
PID=$!
for i in $(seq 1 60); do
  if apply_init; then
    echo "[init] done"
    wait $PID
    exit $?
  fi
  sleep 2
done
echo "[init] failed: the init scripts did not complete" >&2
exit 1
