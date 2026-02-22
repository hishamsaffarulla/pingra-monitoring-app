#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f ".env" ]]; then
  echo ".env is missing."
  exit 1
fi

set -a
source .env
set +a

mkdir -p backups
TS="$(date +%Y%m%d_%H%M%S)"
OUT="backups/postgres_${POSTGRES_DB}_${TS}.sql.gz"

docker compose -f docker-compose.onprem.yml exec -T postgres \
  sh -c "PGPASSWORD='${POSTGRES_PASSWORD}' pg_dump -U '${POSTGRES_USER}' '${POSTGRES_DB}'" \
  | gzip > "${OUT}"

echo "Backup saved: ${OUT}"
echo "Restore example:"
echo "  gunzip -c ${OUT} | docker compose -f docker-compose.onprem.yml exec -T postgres sh -c \"PGPASSWORD='${POSTGRES_PASSWORD}' psql -U '${POSTGRES_USER}' '${POSTGRES_DB}'\""
