# On-Prem Deployment

This folder includes ready scripts so deployment is predictable and repeatable.

## Quick Start (Ubuntu/Debian)

From project root:

```bash
chmod +x deploy/onprem/scripts/*.sh
./deploy/onprem/scripts/10-prepare-env.sh
```

Edit `.env` and replace any `CHANGE_ME_*` values with your real secrets.

Then run:

```bash
./deploy/onprem/scripts/20-start.sh
./deploy/onprem/scripts/30-status.sh
```

Open:
- `http://SERVER_IP` (default)

## Scripts

- `deploy/onprem/scripts/00-install-docker-ubuntu.sh`
  Installs Docker + Compose plugin on Ubuntu/Debian.
- `deploy/onprem/scripts/10-prepare-env.sh`
  Creates `.env` from template and generates random secrets for common fields.
- `deploy/onprem/scripts/20-start.sh`
  Starts stack using `docker-compose.onprem.yml`.
- `deploy/onprem/scripts/30-status.sh`
  Prints health and recent app logs.
- `deploy/onprem/scripts/40-backup-postgres.sh`
  Creates a Postgres backup in `./backups`.
- `deploy/onprem/scripts/50-update.sh`
  Rebuilds and rolls services with latest code.

## What "Secrets" Mean in `.env`

Secrets are private credentials that must not be public:
- `JWT_SECRET` (session/token signing key)
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `INFLUXDB_TOKEN`
- `SMTP_PASS`
- `TWILIO_AUTH_TOKEN`

Rules:
- Use long random values (at least 32 chars for JWT secret).
- Never commit `.env` to Git.
- Restrict file permissions on server (`chmod 600 .env`).
- Rotate secrets if exposed.

## TLS / HTTPS (Optional)

1. Put cert files in `deploy/onprem/certs/`:
   - `fullchain.pem`
   - `privkey.pem`
2. Edit `deploy/onprem/nginx/pingra.conf` and uncomment TLS server block.
3. Restart:

```bash
./deploy/onprem/scripts/50-update.sh
```

## Backup / Restore Notes

- Backup (Postgres):
```bash
./deploy/onprem/scripts/40-backup-postgres.sh
```
- Restore command example is printed by backup script output.

## Production Notes

- Data persists in Docker volumes (Postgres/InfluxDB/Redis).
- SMTP can be configured in `.env` and/or in app UI SMTP Settings.
- Twilio can be configured in `.env` and/or in Integrations UI.
