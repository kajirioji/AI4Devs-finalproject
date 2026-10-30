#!/usr/bin/env bash
# Thin wrapper over docker compose for the deployment (docs/deploy.md). Needs Docker and Git, not Node.
#   scripts/deploy.sh build | up | migrate | seed | logs [service] | ps | down
# DEPLOY_DB=external in infra/.env.deploy targets an external SQL Server.
# DEPLOY_DEBUG=1 in the environment runs without a tunnel, on http://127.0.0.1:8080.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$root/infra/.env.deploy"

usage() {
  echo "Usage: scripts/deploy.sh build | up | migrate | seed | logs [service] | ps | down" >&2
  exit 2
}

[ $# -ge 1 ] || usage
command="$1"
shift

case "$command" in
  build | up | migrate | seed | logs | ps | down) ;;
  *) usage ;;
esac

if [ ! -f "$env_file" ]; then
  echo "Missing infra/.env.deploy: copy infra/.env.deploy.example and fill it in (docs/deploy.md)." >&2
  exit 1
fi

# Prints a variable from the env file without sourcing it.
setting() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1 | tr -d '\r'
}

compose=(docker compose --env-file "$env_file" -f "$root/infra/docker-compose.deploy.yml")
if [ "$(setting DEPLOY_DB)" = "external" ]; then
  compose+=(-f "$root/infra/docker-compose.deploy.external-db.yml")
fi
if [ "${DEPLOY_DEBUG:-}" = "1" ]; then
  compose+=(-f "$root/infra/docker-compose.deploy.debug.yml")
fi

case "$command" in
  build)
    "${compose[@]}" --profile ops build "$@"
    ;;
  up)
    if [ "${DEPLOY_DEBUG:-}" != "1" ] && [ -z "$(setting TUNNEL_TOKEN)" ]; then
      echo "TUNNEL_TOKEN is empty in infra/.env.deploy: create the tunnel first (docs/deploy.md)." >&2
      exit 1
    fi
    "${compose[@]}" up -d "$@"
    ;;
  migrate)
    "${compose[@]}" run --rm migrate
    ;;
  seed)
    echo "The seed DELETES all the data in the database and reloads the synthetic world."
    read -r -p "Type seed to continue: " answer
    if [ "$answer" != "seed" ]; then
      echo "Cancelled: nothing changed."
      exit 1
    fi
    "${compose[@]}" run --rm seed
    ;;
  logs)
    "${compose[@]}" logs -f --tail=200 "$@"
    ;;
  ps)
    "${compose[@]}" ps "$@"
    ;;
  down)
    # Volumes stay: removing them deletes the data, and is done by hand on purpose (docs/deploy.md).
    "${compose[@]}" down
    ;;
esac
