# Environment Variables Configuration

This document provides comprehensive documentation for all environment variables used by the URL Monitoring Application.

## Table of Contents

1. [Application Settings](#application-settings)
2. [PostgreSQL Configuration](#postgresql-configuration)
3. [InfluxDB Configuration](#influxdb-configuration)
4. [Redis Configuration](#redis-configuration)
5. [Authentication](#authentication)
6. [Monitoring Settings](#monitoring-settings)
7. [Notification Channels](#notification-channels)
8. [SSL Certificate Monitoring](#ssl-certificate-monitoring)
9. [Environment-Specific Examples](#environment-specific-examples)

## Application Settings

### NODE_ENV
- **Description**: Application environment mode
- **Required**: No
- **Default**: `development`
- **Valid Values**: `development`, `production`, `test`
- **Example**: `NODE_ENV=production`

### PORT
- **Description**: HTTP server port
- **Required**: No
- **Default**: `3000`
- **Valid Values**: Any valid port number (1-65535)
- **Example**: `PORT=3000`

### LOG_LEVEL
- **Description**: Logging verbosity level
- **Required**: No
- **Default**: `info`
- **Valid Values**: `error`, `warn`, `info`, `debug`
- **Example**: `LOG_LEVEL=info`

## PostgreSQL Configuration

### DATABASE_URL
- **Description**: PostgreSQL connection string
- **Required**: Yes
- **Format**: `postgresql://[user]:[password]@[host]:[port]/[database]`
- **Example**: `DATABASE_URL=postgresql://postgres:password@localhost:5432/url_monitoring`
- **Notes**: 
  - Use SSL in production: `?sslmode=require`
  - Connection pooling is handled automatically

### DB_MAX_CONNECTIONS
- **Description**: Maximum number of database connections in the pool
- **Required**: No
- **Default**: `20`
- **Valid Values**: 1-100 (depends on database server capacity)
- **Example**: `DB_MAX_CONNECTIONS=20`
- **Notes**: Adjust based on expected load and database server capacity

## InfluxDB Configuration

### INFLUXDB_URL
- **Description**: InfluxDB server URL
- **Required**: Yes
- **Format**: `http[s]://[host]:[port]`
- **Example**: `INFLUXDB_URL=http://localhost:8086`
- **Notes**: Use HTTPS in production

### INFLUXDB_TOKEN
- **Description**: InfluxDB API authentication token
- **Required**: Yes
- **Format**: Base64-encoded token string
- **Example**: `INFLUXDB_TOKEN=your-influxdb-token-here`
- **Notes**: 
  - Generate from InfluxDB UI or CLI
  - Requires read/write permissions on the bucket
  - Keep this secret secure

### INFLUXDB_ORG
- **Description**: InfluxDB organization name
- **Required**: Yes
- **Example**: `INFLUXDB_ORG=url-monitoring`
- **Notes**: Must match the organization in InfluxDB

### INFLUXDB_BUCKET
- **Description**: InfluxDB bucket name for storing check results
- **Required**: Yes
- **Example**: `INFLUXDB_BUCKET=check-results`
- **Notes**: Bucket will be created automatically if it doesn't exist

### INFLUXDB_RETENTION_DAYS
- **Description**: Data retention period in days
- **Required**: No
- **Default**: `90`
- **Valid Values**: 1-365 (or more, depending on storage capacity)
- **Example**: `INFLUXDB_RETENTION_DAYS=90`
- **Notes**: Older data is automatically deleted

## Redis Configuration

### REDIS_URL
- **Description**: Redis connection string
- **Required**: Yes
- **Format**: `redis://[password]@[host]:[port]` or `redis://[host]:[port]`
- **Example**: 
  - With password: `REDIS_URL=redis://:password@localhost:6379`
  - Without password: `REDIS_URL=redis://localhost:6379`
- **Notes**: Use password authentication in production

### REDIS_DB
- **Description**: Redis database number
- **Required**: No
- **Default**: `0`
- **Valid Values**: 0-15 (default Redis configuration)
- **Example**: `REDIS_DB=0`

### REDIS_KEY_PREFIX
- **Description**: Prefix for all Redis keys
- **Required**: No
- **Default**: `url-monitor`
- **Example**: `REDIS_KEY_PREFIX=url-monitor`
- **Notes**: Useful for multi-tenant Redis instances

### REDIS_DEFAULT_TTL
- **Description**: Default TTL for cached data (seconds)
- **Required**: No
- **Default**: `3600` (1 hour)
- **Example**: `REDIS_DEFAULT_TTL=3600`

### REDIS_SESSION_TTL
- **Description**: Session expiration time (seconds)
- **Required**: No
- **Default**: `86400` (24 hours)
- **Example**: `REDIS_SESSION_TTL=86400`

### REDIS_ALERT_STATE_TTL
- **Description**: Alert state tracking TTL (seconds)
- **Required**: No
- **Default**: `604800` (7 days)
- **Example**: `REDIS_ALERT_STATE_TTL=604800`

### REDIS_CACHE_TTL
- **Description**: General cache TTL (seconds)
- **Required**: No
- **Default**: `1800` (30 minutes)
- **Example**: `REDIS_CACHE_TTL=1800`

## Authentication

### JWT_SECRET
- **Description**: Secret key for JWT token signing
- **Required**: Yes
- **Format**: Strong random string (minimum 32 characters)
- **Example**: `JWT_SECRET=your-super-secret-jwt-key-change-in-production`
- **Notes**: 
  - Use a cryptographically secure random string
  - Never commit this to version control
  - Rotate regularly in production

### JWT_EXPIRES_IN
- **Description**: JWT token expiration time
- **Required**: No
- **Default**: `1h`
- **Valid Values**: Time string (e.g., `1h`, `30m`, `7d`)
- **Example**: `JWT_EXPIRES_IN=1h`

### JWT_REFRESH_EXPIRES_IN
- **Description**: Refresh token expiration time
- **Required**: No
- **Default**: `7d`
- **Valid Values**: Time string (e.g., `1h`, `30m`, `7d`)
- **Example**: `JWT_REFRESH_EXPIRES_IN=7d`

## Monitoring Settings

### DEFAULT_TIMEOUT
- **Description**: Default HTTP request timeout (seconds)
- **Required**: No
- **Default**: `30`
- **Valid Values**: 1-300
- **Example**: `DEFAULT_TIMEOUT=30`

### MAX_CONCURRENT_CHECKS
- **Description**: Maximum number of concurrent health checks
- **Required**: No
- **Default**: `100`
- **Valid Values**: 1-1000
- **Example**: `MAX_CONCURRENT_CHECKS=100`
- **Notes**: Adjust based on system resources

### DATA_RETENTION_DAYS
- **Description**: PostgreSQL data retention period (days)
- **Required**: No
- **Default**: `90`
- **Valid Values**: 1-365
- **Example**: `DATA_RETENTION_DAYS=90`

## Notification Channels

### Email (SMTP)

#### SMTP_HOST
- **Description**: SMTP server hostname
- **Required**: No (required if using email notifications)
- **Example**: `SMTP_HOST=smtp.gmail.com`

#### SMTP_PORT
- **Description**: SMTP server port
- **Required**: No
- **Default**: `587`
- **Valid Values**: Common ports: 25, 465, 587
- **Example**: `SMTP_PORT=587`

#### SMTP_USER
- **Description**: SMTP authentication username
- **Required**: No (required if using email notifications)
- **Example**: `SMTP_USER=your-email@gmail.com`

#### SMTP_PASS
- **Description**: SMTP authentication password
- **Required**: No (required if using email notifications)
- **Example**: `SMTP_PASS=your-app-password`
- **Notes**: Use app-specific passwords for Gmail

#### SMTP_FROM
- **Description**: Email sender address
- **Required**: No
- **Default**: `URL Monitor <noreply@example.com>`
- **Example**: `SMTP_FROM=URL Monitor <noreply@yourcompany.com>`

### Webhooks

#### SLACK_WEBHOOK_URL
- **Description**: Slack incoming webhook URL
- **Required**: No (required if using Slack notifications)
- **Format**: `https://hooks.slack.com/services/...`
- **Example**: `SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL`

#### TEAMS_WEBHOOK_URL
- **Description**: Microsoft Teams incoming webhook URL
- **Required**: No (required if using Teams notifications)
- **Format**: `https://[tenant].webhook.office.com/...`
- **Example**: `TEAMS_WEBHOOK_URL=https://your-tenant.webhook.office.com/webhookb2/YOUR-WEBHOOK-URL`

#### WEBHOOK_TIMEOUT
- **Description**: Webhook request timeout (milliseconds)
- **Required**: No
- **Default**: `10000` (10 seconds)
- **Example**: `WEBHOOK_TIMEOUT=10000`

### SMS (Twilio)

#### SMS_PROVIDER
- **Description**: SMS provider name
- **Required**: No
- **Default**: `twilio`
- **Valid Values**: `twilio`
- **Example**: `SMS_PROVIDER=twilio`

#### SMS_ACCOUNT_SID
- **Description**: Twilio account SID
- **Required**: No (required if using SMS notifications)
- **Example**: `SMS_ACCOUNT_SID=your-twilio-account-sid`

#### SMS_AUTH_TOKEN
- **Description**: Twilio authentication token
- **Required**: No (required if using SMS notifications)
- **Example**: `SMS_AUTH_TOKEN=your-twilio-auth-token`

#### SMS_FROM_NUMBER
- **Description**: Twilio phone number for sending SMS
- **Required**: No (required if using SMS notifications)
- **Format**: E.164 format (+1234567890)
- **Example**: `SMS_FROM_NUMBER=+1234567890`

### Voice (Twilio)

#### VOICE_PROVIDER
- **Description**: Voice call provider name
- **Required**: No
- **Default**: `twilio`
- **Valid Values**: `twilio`
- **Example**: `VOICE_PROVIDER=twilio`

#### VOICE_ACCOUNT_SID
- **Description**: Twilio account SID for voice calls
- **Required**: No (required if using voice notifications)
- **Example**: `VOICE_ACCOUNT_SID=your-twilio-account-sid`

#### VOICE_AUTH_TOKEN
- **Description**: Twilio authentication token for voice calls
- **Required**: No (required if using voice notifications)
- **Example**: `VOICE_AUTH_TOKEN=your-twilio-auth-token`

#### VOICE_FROM_NUMBER
- **Description**: Twilio phone number for making calls
- **Required**: No (required if using voice notifications)
- **Format**: E.164 format (+1234567890)
- **Example**: `VOICE_FROM_NUMBER=+1234567890`

## SSL Certificate Monitoring

### SSL_WARNING_DAYS
- **Description**: Days before expiry to send warning alert
- **Required**: No
- **Default**: `30`
- **Valid Values**: 1-365
- **Example**: `SSL_WARNING_DAYS=30`

### SSL_CRITICAL_DAYS
- **Description**: Days before expiry to send critical alert
- **Required**: No
- **Default**: `7`
- **Valid Values**: 1-365
- **Example**: `SSL_CRITICAL_DAYS=7`

## Environment-Specific Examples

### Development Environment

```bash
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/url_monitoring
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=dev-influxdb-token
INFLUXDB_ORG=url-monitoring
INFLUXDB_BUCKET=check-results
REDIS_URL=redis://:dev_password@localhost:6379

JWT_SECRET=dev-jwt-secret-not-for-production
JWT_EXPIRES_IN=24h

DEFAULT_TIMEOUT=30
MAX_CONCURRENT_CHECKS=50
```

### Production Environment

```bash
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DATABASE_URL=postgresql://url_monitor:STRONG_PASSWORD@prod-db.example.com:5432/url_monitoring?sslmode=require
INFLUXDB_URL=https://influxdb.example.com:8086
INFLUXDB_TOKEN=STRONG_INFLUXDB_TOKEN
INFLUXDB_ORG=url-monitoring
INFLUXDB_BUCKET=check-results
INFLUXDB_RETENTION_DAYS=90
REDIS_URL=redis://:STRONG_REDIS_PASSWORD@redis.example.com:6379

JWT_SECRET=STRONG_RANDOM_SECRET_MINIMUM_32_CHARACTERS
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

DB_MAX_CONNECTIONS=50
DEFAULT_TIMEOUT=30
MAX_CONCURRENT_CHECKS=200
DATA_RETENTION_DAYS=90

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=YOUR_SENDGRID_API_KEY
SMTP_FROM=URL Monitor <alerts@yourcompany.com>

SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### AWS Environment

```bash
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Use RDS endpoint
DATABASE_URL=postgresql://url_monitor:PASSWORD@url-monitor-db.abc123.us-east-1.rds.amazonaws.com:5432/url_monitoring?sslmode=require

# Use EC2 or managed InfluxDB
INFLUXDB_URL=https://influxdb.internal.example.com:8086
INFLUXDB_TOKEN=AWS_SECRETS_MANAGER_TOKEN
INFLUXDB_ORG=url-monitoring
INFLUXDB_BUCKET=check-results

# Use ElastiCache endpoint
REDIS_URL=redis://:PASSWORD@url-monitor-redis.abc123.cache.amazonaws.com:6379

# Use AWS Secrets Manager for sensitive values
JWT_SECRET=AWS_SECRETS_MANAGER_SECRET
```

## Security Best Practices

1. **Never commit secrets to version control**
   - Use `.env` files locally (add to `.gitignore`)
   - Use secrets management in production (AWS Secrets Manager, HashiCorp Vault)

2. **Use strong passwords and tokens**
   - Minimum 32 characters for JWT_SECRET
   - Use cryptographically secure random generators

3. **Rotate secrets regularly**
   - JWT secrets: Every 90 days
   - Database passwords: Every 180 days
   - API tokens: Every 90 days

4. **Use SSL/TLS in production**
   - Enable SSL for PostgreSQL connections
   - Use HTTPS for InfluxDB
   - Use TLS for Redis if available

5. **Limit access**
   - Use firewall rules to restrict database access
   - Use VPC/private networks in cloud environments
   - Implement least-privilege access controls

## Validation

The application validates required environment variables on startup. If any required variables are missing, the application will fail to start with a clear error message indicating which variables are missing.

To validate your configuration:

```bash
# Check configuration
npm run db:health

# View loaded configuration (development only)
NODE_ENV=development npm run dev
```
