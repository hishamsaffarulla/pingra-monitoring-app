# Monitoring and Maintenance Guide

This guide covers monitoring, maintenance, and operational procedures for the URL Monitoring Application.

## Table of Contents

1. [Health Monitoring](#health-monitoring)
2. [Performance Monitoring](#performance-monitoring)
3. [Database Maintenance](#database-maintenance)
4. [Backup and Recovery](#backup-and-recovery)
5. [Log Management](#log-management)
6. [Security Monitoring](#security-monitoring)
7. [Capacity Planning](#capacity-planning)
8. [Maintenance Procedures](#maintenance-procedures)

## Health Monitoring

### Application Health Checks

The application provides built-in health check endpoints:

#### Health Endpoint

```bash
# Check overall application health
curl http://localhost:3000/health

# Response (healthy):
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "databases": {
    "postgresql": "healthy",
    "influxdb": "healthy",
    "redis": "healthy"
  }
}

# Response (degraded):
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "databases": {
    "postgresql": "healthy",
    "influxdb": "unhealthy",
    "redis": "healthy"
  }
}
```

#### Readiness Endpoint

```bash
# Check if application is ready to serve traffic
curl http://localhost:3000/ready

# Response (ready):
{
  "ready": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}

# Response (not ready):
{
  "ready": false,
  "reason": "One or more database connections are unhealthy",
  "databases": {
    "postgresql": true,
    "influxdb": false,
    "redis": true
  }
}
```

### Database Health Checks

#### PostgreSQL

```bash
# Check connection
psql -U postgres -d url_monitoring -c "SELECT 1;"

# Check database size
psql -U postgres -d url_monitoring -c "
  SELECT pg_size_pretty(pg_database_size('url_monitoring')) AS size;
"

# Check active connections
psql -U postgres -d url_monitoring -c "
  SELECT count(*) FROM pg_stat_activity WHERE datname = 'url_monitoring';
"

# Check slow queries
psql -U postgres -d url_monitoring -c "
  SELECT query, calls, mean_exec_time, max_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"
```

#### InfluxDB

```bash
# Check health
curl http://localhost:8086/health

# Check bucket size
influx bucket list --token YOUR_TOKEN

# Check query performance
influx query 'from(bucket:"check-results") 
  |> range(start: -1h) 
  |> count()' --token YOUR_TOKEN
```

#### Redis

```bash
# Check connection
redis-cli ping

# Check memory usage
redis-cli INFO memory

# Check connected clients
redis-cli INFO clients

# Check key count
redis-cli DBSIZE

# Check slow log
redis-cli SLOWLOG GET 10
```

### Monitoring with External Tools

#### Prometheus Metrics

Add Prometheus metrics endpoint (optional enhancement):

```typescript
// Example metrics to expose
- http_requests_total
- http_request_duration_seconds
- check_executions_total
- check_failures_total
- alert_notifications_total
- database_connection_pool_size
- redis_cache_hit_rate
```

#### CloudWatch (AWS)

```bash
# Send custom metrics to CloudWatch
aws cloudwatch put-metric-data \
  --namespace URLMonitoring \
  --metric-name CheckExecutions \
  --value 100 \
  --unit Count

# Create alarm
aws cloudwatch put-metric-alarm \
  --alarm-name url-monitor-high-error-rate \
  --alarm-description "Alert when error rate is high" \
  --metric-name ErrorRate \
  --namespace URLMonitoring \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

## Performance Monitoring

### Application Performance

#### Response Time Monitoring

```bash
# Monitor API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/monitors

# curl-format.txt:
time_namelookup:  %{time_namelookup}\n
time_connect:  %{time_connect}\n
time_appconnect:  %{time_appconnect}\n
time_pretransfer:  %{time_pretransfer}\n
time_redirect:  %{time_redirect}\n
time_starttransfer:  %{time_starttransfer}\n
----------\n
time_total:  %{time_total}\n
```

#### Resource Usage

```bash
# Monitor Docker container resources
docker stats url-monitor-app

# Monitor system resources
top -p $(pgrep -f "node dist/index.js")

# Memory usage
ps aux | grep node | awk '{print $6}'

# CPU usage
ps aux | grep node | awk '{print $3}'
```

### Database Performance

#### PostgreSQL Performance

```sql
-- Connection pool usage
SELECT count(*) as active_connections,
       max_conn - count(*) as available_connections
FROM pg_stat_activity,
     (SELECT setting::int as max_conn FROM pg_settings WHERE name = 'max_connections') mc
WHERE datname = 'url_monitoring';

-- Table sizes
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage
SELECT schemaname, tablename, indexname,
       idx_scan as index_scans,
       idx_tup_read as tuples_read,
       idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Cache hit ratio (should be > 99%)
SELECT 
  sum(heap_blks_read) as heap_read,
  sum(heap_blks_hit) as heap_hit,
  sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100 as cache_hit_ratio
FROM pg_statio_user_tables;
```

#### InfluxDB Performance

```bash
# Query performance
influx query 'from(bucket:"check-results") 
  |> range(start: -24h) 
  |> filter(fn: (r) => r._measurement == "check_result")
  |> count()' --token YOUR_TOKEN --profilers query

# Cardinality (number of unique series)
influx query 'import "influxdata/influxdb/schema"
  schema.measurements(bucket: "check-results")' --token YOUR_TOKEN
```

#### Redis Performance

```bash
# Monitor operations per second
redis-cli INFO stats | grep instantaneous_ops_per_sec

# Monitor hit rate
redis-cli INFO stats | grep keyspace_hits
redis-cli INFO stats | grep keyspace_misses

# Monitor memory fragmentation
redis-cli INFO memory | grep mem_fragmentation_ratio

# Monitor evicted keys
redis-cli INFO stats | grep evicted_keys
```

## Database Maintenance

### PostgreSQL Maintenance

#### Regular Maintenance Tasks

```sql
-- Analyze tables (update statistics)
ANALYZE;

-- Vacuum tables (reclaim space)
VACUUM;

-- Full vacuum (requires downtime)
VACUUM FULL;

-- Reindex (rebuild indexes)
REINDEX DATABASE url_monitoring;

-- Check for bloat
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
       n_dead_tup
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

#### Partition Management

```sql
-- Create next month's partition
SELECT create_monthly_partition();

-- List partitions
SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE tablename LIKE 'check_results_%'
ORDER BY tablename DESC;

-- Drop old partitions (older than retention period)
DROP TABLE IF EXISTS check_results_2023_01;
```

#### Connection Pool Monitoring

```sql
-- Monitor connection pool
SELECT pid, usename, application_name, client_addr, state, query_start
FROM pg_stat_activity
WHERE datname = 'url_monitoring'
ORDER BY query_start;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'url_monitoring'
  AND state = 'idle'
  AND query_start < now() - interval '1 hour';
```

### InfluxDB Maintenance

```bash
# Compact data
influx backup /path/to/backup --org url-monitoring

# Check retention policies
influx bucket list --token YOUR_TOKEN

# Update retention policy
influx bucket update \
  --name check-results \
  --retention 90d \
  --token YOUR_TOKEN

# Delete old data manually (if needed)
influx delete \
  --bucket check-results \
  --start 2023-01-01T00:00:00Z \
  --stop 2023-06-30T23:59:59Z \
  --token YOUR_TOKEN
```

### Redis Maintenance

```bash
# Save data to disk
redis-cli SAVE

# Background save
redis-cli BGSAVE

# Check last save time
redis-cli LASTSAVE

# Flush expired keys
redis-cli --scan --pattern "url-monitor:*" | while read key; do
  redis-cli TTL "$key"
done

# Optimize memory
redis-cli MEMORY PURGE

# Check persistence
redis-cli INFO persistence
```

## Backup and Recovery

### PostgreSQL Backup

#### Full Database Backup

```bash
# Backup database
pg_dump -U postgres -d url_monitoring -F c -f backup_$(date +%Y%m%d).dump

# Backup with compression
pg_dump -U postgres -d url_monitoring | gzip > backup_$(date +%Y%m%d).sql.gz

# Backup specific tables
pg_dump -U postgres -d url_monitoring -t monitors -t alerts -F c -f config_backup.dump
```

#### Automated Backup Script

```bash
#!/bin/bash
# backup-postgres.sh

BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
pg_dump -U postgres -d url_monitoring -F c -f "$BACKUP_DIR/backup_$DATE.dump"

# Compress
gzip "$BACKUP_DIR/backup_$DATE.dump"

# Delete old backups
find "$BACKUP_DIR" -name "backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

# Upload to S3 (optional)
aws s3 cp "$BACKUP_DIR/backup_$DATE.dump.gz" s3://your-bucket/backups/
```

#### Restore Database

```bash
# Restore from backup
pg_restore -U postgres -d url_monitoring -c backup_20240115.dump

# Restore from SQL file
psql -U postgres -d url_monitoring < backup_20240115.sql

# Restore specific tables
pg_restore -U postgres -d url_monitoring -t monitors backup_20240115.dump
```

### InfluxDB Backup

```bash
# Backup InfluxDB
influx backup /backups/influxdb/backup_$(date +%Y%m%d) --token YOUR_TOKEN

# Backup specific bucket
influx backup /backups/influxdb/backup_$(date +%Y%m%d) \
  --bucket check-results \
  --token YOUR_TOKEN

# Restore InfluxDB
influx restore /backups/influxdb/backup_20240115 --token YOUR_TOKEN
```

### Redis Backup

```bash
# Manual backup
redis-cli SAVE
cp /var/lib/redis/dump.rdb /backups/redis/dump_$(date +%Y%m%d).rdb

# Automated backup with AOF
# Redis automatically persists with AOF enabled
cp /var/lib/redis/appendonly.aof /backups/redis/appendonly_$(date +%Y%m%d).aof

# Restore Redis
# Stop Redis
systemctl stop redis
# Copy backup
cp /backups/redis/dump_20240115.rdb /var/lib/redis/dump.rdb
# Start Redis
systemctl start redis
```

### Backup Strategy

**Recommended Schedule:**
- **PostgreSQL**: Daily full backup, retain 30 days
- **InfluxDB**: Weekly backup, retain 12 weeks
- **Redis**: Continuous AOF, daily RDB snapshot
- **Application Config**: Daily backup, retain 90 days

## Log Management

### Application Logs

```bash
# View logs
docker logs -f url-monitor-app

# View logs with timestamp
docker logs -f --timestamps url-monitor-app

# View last 100 lines
docker logs --tail 100 url-monitor-app

# Save logs to file
docker logs url-monitor-app > app_logs_$(date +%Y%m%d).log
```

### Log Rotation

```bash
# Configure logrotate
cat > /etc/logrotate.d/url-monitoring << EOF
/var/log/url-monitoring/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 nodejs nodejs
    sharedscripts
    postrotate
        docker kill -s USR1 url-monitor-app
    endscript
}
EOF
```

### Centralized Logging

#### ELK Stack (Elasticsearch, Logstash, Kibana)

```yaml
# docker-compose.yml addition
  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
```

#### CloudWatch Logs (AWS)

```json
// ECS task definition
"logConfiguration": {
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "/ecs/url-monitoring",
    "awslogs-region": "us-east-1",
    "awslogs-stream-prefix": "ecs"
  }
}
```

## Security Monitoring

### Access Monitoring

```sql
-- Monitor failed login attempts
SELECT * FROM audit_log
WHERE event_type = 'login_failed'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;

-- Monitor API access patterns
SELECT endpoint, count(*) as requests, avg(response_time) as avg_time
FROM api_logs
WHERE created_at > now() - interval '1 hour'
GROUP BY endpoint
ORDER BY requests DESC;
```

### Security Alerts

```bash
# Monitor for suspicious activity
# - Multiple failed login attempts
# - Unusual API access patterns
# - Database connection from unknown IPs
# - Excessive resource usage

# Set up alerts for:
# - Failed authentication > 5 in 5 minutes
# - API error rate > 5%
# - Database connection failures
# - Disk usage > 80%
```

## Capacity Planning

### Storage Growth

```sql
-- Monitor database growth
SELECT date_trunc('day', created_at) as day,
       count(*) as records,
       pg_size_pretty(sum(pg_column_size(check_results.*))) as size
FROM check_results
WHERE created_at > now() - interval '30 days'
GROUP BY day
ORDER BY day;

-- Estimate future storage needs
-- Assume: 100 monitors, 1-minute checks, 90-day retention
-- Records per day: 100 * 24 * 60 = 144,000
-- Records per 90 days: 144,000 * 90 = 12,960,000
-- Estimated size: ~500 bytes per record = 6.5 GB
```

### Resource Planning

**Scaling Guidelines:**

| Monitors | Check Interval | Daily Checks | Recommended Resources |
|----------|----------------|--------------|----------------------|
| 1-100    | 1 min          | 144,000      | 2 CPU, 4 GB RAM      |
| 100-500  | 1 min          | 720,000      | 4 CPU, 8 GB RAM      |
| 500-1000 | 1 min          | 1,440,000    | 8 CPU, 16 GB RAM     |
| 1000+    | 1 min          | 1,440,000+   | Scale horizontally   |

## Maintenance Procedures

### Routine Maintenance Checklist

**Daily:**
- [ ] Check application health endpoints
- [ ] Review error logs
- [ ] Monitor disk usage
- [ ] Verify backups completed

**Weekly:**
- [ ] Review performance metrics
- [ ] Check database query performance
- [ ] Analyze slow queries
- [ ] Review security logs
- [ ] Test backup restoration

**Monthly:**
- [ ] Update dependencies
- [ ] Review and optimize database indexes
- [ ] Clean up old data
- [ ] Review capacity planning
- [ ] Security audit

**Quarterly:**
- [ ] Major version updates
- [ ] Performance tuning
- [ ] Disaster recovery test
- [ ] Security penetration testing

### Maintenance Windows

```bash
# Schedule maintenance window
# 1. Notify users
# 2. Enable maintenance mode
# 3. Stop application
docker-compose stop app

# 4. Perform maintenance
npm run migrate
psql -U postgres -d url_monitoring -c "VACUUM FULL;"

# 5. Start application
docker-compose start app

# 6. Verify health
curl http://localhost:3000/health

# 7. Disable maintenance mode
```

### Emergency Procedures

**Database Failure:**
1. Check database logs
2. Attempt restart
3. Restore from backup if needed
4. Verify data integrity

**Application Crash:**
1. Check application logs
2. Verify database connectivity
3. Restart application
4. Monitor for recurring issues

**High Load:**
1. Identify bottleneck
2. Scale resources if needed
3. Optimize queries
4. Enable rate limiting

## Monitoring Tools

### Recommended Tools

- **Application Monitoring**: Prometheus + Grafana, Datadog, New Relic
- **Log Management**: ELK Stack, Splunk, CloudWatch Logs
- **Database Monitoring**: pgAdmin, InfluxDB UI, RedisInsight
- **Uptime Monitoring**: Pingdom, UptimeRobot, StatusCake
- **APM**: New Relic, Datadog APM, Elastic APM

### Dashboard Metrics

**Key Metrics to Monitor:**
- Application uptime
- API response times
- Check execution rate
- Alert delivery rate
- Database connection pool usage
- Redis cache hit rate
- Disk usage
- Memory usage
- CPU usage
- Error rate
