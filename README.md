# URL Monitoring Application

A lightweight URL monitoring application for uptime checks, response-time tracking, and alerting.

## Features

- HTTP/HTTPS monitoring with configurable intervals
- SSL expiry tracking
- Multi-channel notifications (email, webhook, SMS/voice)
- Dashboard + REST APIs
- Multi-tenant isolation with JWT auth

## Tech Stack

- Node.js + TypeScript + Express
- PostgreSQL (relational), InfluxDB (time-series), Redis (cache/session)
- Jest + fast-check for testing

## Host This Project (Recommended: On-Prem Docker)

This repository already includes a production-ready on-prem stack:
- `docker-compose.onprem.yml`
- `deploy/onprem/scripts/*.sh`
- `deploy/onprem/nginx/pingra.conf`

### 1. Server prerequisites

- Ubuntu/Debian Linux host
- Docker Engine + Docker Compose plugin
- DNS (optional, but recommended for HTTPS)
- Ports open: `80` and `443`

Install Docker on a fresh Ubuntu/Debian host:

```bash
chmod +x deploy/onprem/scripts/*.sh
./deploy/onprem/scripts/00-install-docker-ubuntu.sh
```

### 2. Prepare environment

From the project root on the server:

```bash
chmod +x deploy/onprem/scripts/*.sh
./deploy/onprem/scripts/10-prepare-env.sh
```

This creates `.env` from `.env.onprem.example` and auto-generates core secrets if values are missing or still `CHANGE_ME_*`.

Then edit `.env` and confirm:
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `INFLUXDB_INIT_PASSWORD`
- `INFLUXDB_TOKEN`
- `JWT_SECRET`
- SMTP/Twilio values (if you need notifications immediately)

### 3. Start the stack

```bash
./deploy/onprem/scripts/20-start.sh
./deploy/onprem/scripts/30-status.sh
```

Services started by `docker-compose.onprem.yml`:
- `postgres`
- `influxdb`
- `redis`
- `app` (Node.js API/UI on internal port `3000`)
- `nginx` (public entrypoint on ports `80`/`443`)

Open:
- `http://<SERVER_IP>`

Health endpoint:
- `http://<SERVER_IP>/health`

### 4. Enable HTTPS (optional but recommended)

1. Put cert files in `deploy/onprem/certs/`:
   - `fullchain.pem`
   - `privkey.pem`
2. Edit `deploy/onprem/nginx/pingra.conf` and uncomment the TLS server block.
3. Update `server_name your-domain.example.com;` to your real domain.
4. Restart services:

```bash
./deploy/onprem/scripts/50-update.sh
```

### 5. Operations

Check status and recent app logs:

```bash
./deploy/onprem/scripts/30-status.sh
```

Backup Postgres:

```bash
./deploy/onprem/scripts/40-backup-postgres.sh
```

Update/redeploy after pulling latest code:

```bash
./deploy/onprem/scripts/50-update.sh
```

## Local Development (Without Docker)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- InfluxDB 2.0+
- Redis 6+

### Run

```bash
npm install
cp .env.example .env
# edit .env
npm run build
npm start
```

Development mode:

```bash
npm run dev
```

## Testing and Linting

```bash
npm test
npm run test:coverage
npm run lint
npm run lint:fix
```

## License

MIT
