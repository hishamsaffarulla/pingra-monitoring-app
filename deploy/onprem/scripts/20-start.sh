#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f ".env" ]]; then
  echo ".env is missing. Run deploy/onprem/scripts/10-prepare-env.sh first."
  exit 1
fi

docker compose -f docker-compose.onprem.yml up -d --build
echo "Stack started."
