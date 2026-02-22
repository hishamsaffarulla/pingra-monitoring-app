# Database Setup and Migration System

This directory contains the database schema, migrations, and connection management for the URL Monitoring Application. The system uses a multi-database architecture:

- **PostgreSQL**: Relational data (tenants, monitors, alerts, notification channels)
- **InfluxDB**: Time-series data (check results and metrics)
- **Redis**: Caching, sessions, and real-time state management

## Quick Start

### 1. Start Database Services

Using Docker Compose (recommended for development):

```bash
# Start all databases
docker-compose up -d postgres influxdb redis

# Check database health
npm run db:health
```

### 2. Run Migrations

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status
```

### 3. Verify Setup

```bash
# Test all database connections
npm run db:health
```

## Database Architecture

### PostgreSQL Schema

The PostgreSQL database stores relational data with the following tables:

- `tenants`: Tenant isolation and configuration
- `monitors`: URL monitoring configurations
- `alerts`: Alert history and status
- `notification_channels`: Notification channel configurations
- `check_results`: Time-series check results (partitioned by month)
- `schema_migrations`: Migration tracking

### InfluxDB Schema

InfluxDB stores time-series data with the following measurements:

- `check_results`: HTTP/HTTPS check results with tags for monitor_id, location, and success status
- Retention policy: 90 days (configurable)
- Automatic data cleanup based on retention policy

### Redis Key Spaces

Redis uses namespaced keys for different purposes:

- `url-monitor:session:*`: User sessions and JWT tokens
- `url-monitor:alert:*`: Alert state tracking
- `url-monitor:cache:*`: General application caching
- `url-monitor:schedule:*`: Scheduler state persistence
- `url-monitor:lock:*`: Distributed locks
- `url-monitor:counter:*`: Failure counters

## Migration System

### Creating Migrations

```bash
# Create a new migration
npm run migrate:create add_new_feature "Add new feature table"
```

This creates a new SQL file in `src/database/migrations/` with the format:
`YYYYMMDD_migration_name.sql`

### Migration File Format

```sql
-- Migration: 001_initial_schema
-- Description: Create core tables for tenants, monitors, alerts

-- Your SQL statements here
CREATE TABLE example (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL
);

-- Migration tracking (automatically added)
INSERT INTO schema_migrations (version, description) 
VALUES ('001_initial_schema', 'Create core tables for tenants, monitors, alerts')
ON CONFLICT (version) DO NOTHING;
```

### Running Migrations

```bash
# Run all pending migrations
npm run migrate

# Check what migrations are pending
npm run migrate:status
```

## Table Partitioning

The `check_results` table is partitioned by month to optimize time-series queries:

- Automatic monthly partition creation
- Automatic cleanup of partitions older than 90 days
- Optimized indexes for time-range queries

### Partition Management

Partitions are managed automatically, but you can manually create them:

```sql
-- Create partition for specific month
SELECT create_monthly_partition();

-- Drop old partitions
SELECT drop_old_partitions();
```

## Performance Indexes

### PostgreSQL Indexes

- `idx_check_results_monitor_time`: Monitor-specific time queries
- `idx_check_results_location_time`: Location-specific queries
- `idx_alerts_monitor_triggered`: Alert history queries
- `idx_monitors_tenant`: Tenant isolation

### InfluxDB Indexes

InfluxDB automatically creates indexes on:
- Tags: `monitor_id`, `location`, `success`
- Time field: `timestamp`

## Environment Configuration

Required environment variables:

```bash
# PostgreSQL
DATABASE_URL=postgresql://user:pass@host:port/database

# InfluxDB
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your-token
INFLUXDB_ORG=your-org
INFLUXDB_BUCKET=check-results

# Redis
REDIS_URL=redis://localhost:6379
```

## Connection Management

The `DatabaseManager` class handles all database connections:

```typescript
import { createDatabaseManager, getDatabaseManager } from './database';

// Initialize (once at startup)
const config = getConfig();
const dbManager = createDatabaseManager(config.database);
await dbManager.initialize();

// Use throughout application
const dbManager = getDatabaseManager();
const pgClient = await dbManager.getPostgreSQLClient();
const influxWrite = dbManager.getInfluxWriteApi();
const redis = dbManager.getRedisClient();
```

## Health Checks

The system provides comprehensive health checks:

```bash
# CLI health check
npm run db:health

# Programmatic health check
const health = await dbManager.healthCheck();
console.log(health); // { postgresql: true, influxdb: true, redis: true }
```

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure databases are running
   ```bash
   docker-compose up -d postgres influxdb redis
   ```

2. **Migration Failures**: Check database permissions and connectivity
   ```bash
   npm run db:health
   ```

3. **InfluxDB Token Issues**: Verify token has read/write permissions
   ```bash
   influx auth list --org your-org
   ```

4. **Redis Memory Issues**: Check memory usage and eviction policy
   ```bash
   redis-cli info memory
   ```

### Logs

Application logs are stored in:
- `logs/combined.log`: All application logs
- `logs/error.log`: Error logs only
- Console output in development mode

### Docker Compose Services

```bash
# Start only databases
docker-compose up -d postgres influxdb redis

# Start full stack (including app)
docker-compose --profile full-stack up -d

# View logs
docker-compose logs -f postgres
docker-compose logs -f influxdb
docker-compose logs -f redis
```

## Security Considerations

1. **Database Credentials**: Use strong passwords and rotate regularly
2. **InfluxDB Token**: Generate tokens with minimal required permissions
3. **Redis**: Configure password authentication in production
4. **SSL/TLS**: Enable SSL for all database connections in production
5. **Network**: Use private networks and firewall rules

## Backup and Recovery

### PostgreSQL Backup

```bash
# Backup
pg_dump -h localhost -U postgres url_monitoring > backup.sql

# Restore
psql -h localhost -U postgres url_monitoring < backup.sql
```

### InfluxDB Backup

```bash
# Backup
influx backup --org your-org --bucket check-results /path/to/backup

# Restore
influx restore --org your-org /path/to/backup
```

### Redis Backup

Redis automatically creates snapshots. For manual backup:

```bash
# Create snapshot
redis-cli BGSAVE

# Copy RDB file
cp /var/lib/redis/dump.rdb backup-$(date +%Y%m%d).rdb
```