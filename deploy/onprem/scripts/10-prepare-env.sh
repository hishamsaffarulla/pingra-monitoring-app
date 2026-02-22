#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f ".env" ]]; then
  cp .env.onprem.example .env
  echo "Created .env from .env.onprem.example"
fi

generate_secret() {
  openssl rand -base64 48 | tr -d '\n' | tr '/+' 'ab' | cut -c1-64
}

replace_if_change_me() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env | head -n1 | cut -d'=' -f2- || true)"
  if [[ -z "${value}" || "${value}" == CHANGE_ME* ]]; then
    local secret
    secret="$(generate_secret)"
    if grep -qE "^${key}=" .env; then
      sed -i "s|^${key}=.*|${key}=${secret}|g" .env
    else
      echo "${key}=${secret}" >> .env
    fi
    echo "Generated ${key}"
  fi
}

replace_if_change_me "JWT_SECRET"
replace_if_change_me "POSTGRES_PASSWORD"
replace_if_change_me "REDIS_PASSWORD"
replace_if_change_me "INFLUXDB_INIT_PASSWORD"
replace_if_change_me "INFLUXDB_TOKEN"

ensure_key() {
  local key="$1"
  local default_value="${2:-}"
  if ! grep -qE "^${key}=" .env; then
    echo "${key}=${default_value}" >> .env
    echo "Added ${key}"
  fi
}

# Ensure SMTP keys exist (can remain blank if configured in UI)
ensure_key "SMTP_HOST" ""
ensure_key "SMTP_PORT" "587"
ensure_key "SMTP_USER" ""
ensure_key "SMTP_PASS" ""
ensure_key "SMTP_FROM" ""
ensure_key "SMTP_SECURE" "false"

# Ensure Twilio keys exist (can remain blank if configured in UI)
ensure_key "TWILIO_ACCOUNT_SID" ""
ensure_key "TWILIO_AUTH_TOKEN" ""
ensure_key "TWILIO_FROM_NUMBER" ""

chmod 600 .env || true
echo ".env prepared. Core secrets generated and SMTP/Twilio keys ensured."
