# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the URL Monitoring Application.

## Table of Contents

1. [Application Startup Issues](#application-startup-issues)
2. [Database Connection Problems](#database-connection-problems)
3. [Authentication Issues](#authentication-issues)
4. [Monitoring and Check Issues](#monitoring-and-check-issues)
5. [Notification Delivery Problems](#notification-delivery-problems)
6. [Performance Issues](#performance-issues)
7. [Docker-Specific Issues](#docker-specific-issues)
8. [Diagnostic Commands](#diagnostic-commands)

## Application Startup Issues

### Application Won't Start

**Symptoms:**
- Application crashes immediately on startup
- Error: "Missing required environment variables"

**Solutions:**

1. **Check environment variables:**
   ```bash
   # Verify all required variables are set
   cat .env
   
   # Required variables:
   # - DATABASE_URL
   # - INFLUXDB_URL
   # - INFLUXDB_TOKEN
   # - INFLUXDB_ORG
   # - INFLUXDB_BUCKET
   # - REDIS_URL
   # - JWT_SECRET
   ```

2. **Validate environment file format:**
   ```bash
   # Ensure no spaces around = sign
   # Correct: DATABASE_URL=postgresql://...
   # Incorrect: DATABASE_URL = postgresql://...
   ```

3. **Check for syntax errors:**
   ```bash
   # Run with debug logging
   LOG_LEVEL=debug npm start
   ```

### Port Already in Use

**Symptoms:**
- Error: "EADDRINUSE: address already in use :::3000"

**Solutions:**

1. **Find process using the port:**
   ```bash
   # Windows
   netstat -ano | findstr :3000
   
   # Linux/Mac
   lsof -i :3000
   ```

2. **Kill the process or change port:**
   ```bash
   # Change port in .env
   PORT=3001
   
   # Or kill the process (Windows)
   taskkill /PID <process-id> /F
   
   # Or kill the process (Linux/Mac)
   kill -9 <process-id>
   ```

### Migration Failures

**Symptoms:**
- Error: "Migration failed"
- Database schema not created

**Solutions:**

1. **Check database connectivity:**
   ```bash
   npm run db:health
   ```

2. **Verify database exists:**
   ```sql
   -- Connect to PostgreSQL
   psql -U postgres
   
   -- List databases
   \l
   
   -- Create database if missing
   CREATE DATABASE url_monitoring;
   ```

3. **Run migrations manually:**
   ```bash
   # Check migration status
   npm run migrate:status
   
   # Run migrations
   npm run migrate
   
   # If stuck, rollback and retry
   npm run migrate down
   npm run migrate up
   ```

4. **Reset database (WARNING: deletes all data):**
   ```bash
   # Drop and recreate database
   psql -U postgres -c "DROP DATABASE url_monitoring;"
   psql -U postgres -c "CREATE DATABASE url_monitoring;"
   npm run migrate
   ```

## Database Connection Problems

### PostgreSQL Connection Refused

**Symptoms:**
- Error: "ECONNREFUSED" or "Connection refused"
- Cannot connect to PostgreSQL

**Solutions:**

1. **Verify PostgreSQL is running:**
   ```bash
   # Check service status
   systemctl status postgresql
   
   # Start if not running
   systemctl start postgresql
   ```

2. **Check connection string:**
   ```bash
   # Verify DATABASE_URL format
   # postgresql://[user]:[password]@[host]:[port]/[database]
   
   # Test connection
   psql "postgresql://postgres:password@localhost:5432/url_monitoring"
   ```

3. **Check firewall rules:**
   ```bash
   # Allow PostgreSQL port
   sudo ufw allow 5432/tcp
   ```

4. **Verify PostgreSQL configuration:**
   ```bash
   # Edit postgresql.conf
   listen_addresses = '*'
   
   # Edit pg_hba.conf
   host    all    all    0.0.0.0/0    md5
   
   # Restart PostgreSQL
   systemctl restart postgresql
   ```

### InfluxDB Connection Issues

**Symptoms:**
- Error: "Failed to connect to InfluxDB"
- Time-series data not being stored

**Solutions:**

1. **Verify InfluxDB is running:**
   ```bash
   # Check service status
   systemctl status influxdb
   
   # Check if accessible
   curl http://localhost:8086/health
   ```

2. **Validate token and permissions:**
   ```bash
   # Test token with InfluxDB CLI
   influx auth list --token YOUR_TOKEN
   
   # Verify bucket exists
   influx bucket list --token YOUR_TOKEN
   ```

3. **Check organization and bucket:**
   ```bash
   # List organizations
   influx org list --token YOUR_TOKEN
   
   # Create bucket if missing
   influx bucket create \
     --name check-results \
     --org url-monitoring \
     --retention 90d \
     --token YOUR_TOKEN
   ```

4. **Review InfluxDB logs:**
   ```bash
   # View logs
   journalctl -u influxdb -f
   
   # Or Docker logs
   docker logs url-monitor-influxdb
   ```

### Redis Connection Problems

**Symptoms:**
- Error: "Redis connection failed"
- Sessions not persisting
- Cache not working

**Solutions:**

1. **Verify Redis is running:**
   ```bash
   # Check service status
   systemctl status redis
   
   # Test connection
   redis-cli ping
   # Should return: PONG
   ```

2. **Check authentication:**
   ```bash
   # If password protected
   redis-cli -a YOUR_PASSWORD ping
   
   # Verify REDIS_URL format
   # redis://:password@host:port
   ```

3. **Check Redis configuration:**
   ```bash
   # View configuration
   redis-cli CONFIG GET requirepass
   
   # Set password if needed
   redis-cli CONFIG SET requirepass "your_password"
   ```

4. **Clear Redis cache:**
   ```bash
   # Flush all keys (WARNING: clears all data)
   redis-cli FLUSHALL
   
   # Or flush specific database
   redis-cli -n 0 FLUSHDB
   ```

## Authentication Issues

### JWT Token Invalid

**Symptoms:**
- Error: "Invalid token" or "Token expired"
- Cannot authenticate API requests

**Solutions:**

1. **Verify JWT_SECRET is set:**
   ```bash
   # Check environment variable
   echo $JWT_SECRET
   
   # Ensure it's the same across all instances
   ```

2. **Check token expiration:**
   ```bash
   # Decode JWT token (use jwt.io or jwt-cli)
   # Verify 'exp' claim is in the future
   ```

3. **Clear sessions and re-login:**
   ```bash
   # Clear Redis sessions
   redis-cli --scan --pattern "url-monitor:session:*" | xargs redis-cli DEL
   ```

4. **Regenerate token:**
   ```bash
   # Login again to get new token
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"password"}'
   ```

### Tenant Isolation Issues

**Symptoms:**
- Users seeing data from other tenants
- Cross-tenant data access

**Solutions:**

1. **Verify tenant middleware is active:**
   ```bash
   # Check logs for tenant isolation
   LOG_LEVEL=debug npm start
   ```

2. **Check database queries:**
   ```sql
   -- Verify tenant_id is in WHERE clauses
   SELECT * FROM monitors WHERE tenant_id = 'xxx';
   ```

3. **Clear tenant cache:**
   ```bash
   # Clear Redis tenant cache
   redis-cli --scan --pattern "url-monitor:tenant:*" | xargs redis-cli DEL
   ```

## Monitoring and Check Issues

### Checks Not Running

**Symptoms:**
- No check results in database
- Monitors show "never checked"

**Solutions:**

1. **Verify scheduler is running:**
   ```bash
   # Check logs for scheduler activity
   docker logs url-monitor-app | grep -i scheduler
   ```

2. **Check monitor configuration:**
   ```bash
   # Verify monitors are enabled
   psql -U postgres url_monitoring -c "SELECT id, name, check_interval FROM monitors;"
   ```

3. **Review scheduler state in Redis:**
   ```bash
   # Check scheduled checks
   redis-cli --scan --pattern "url-monitor:schedule:*"
   ```

4. **Restart application:**
   ```bash
   # Restart to reinitialize scheduler
   docker-compose restart app
   ```

### SSL Certificate Checks Failing

**Symptoms:**
- SSL certificate information not captured
- SSL alerts not triggering

**Solutions:**

1. **Verify HTTPS URL:**
   ```bash
   # Ensure monitor URL uses https://
   # Check certificate manually
   openssl s_client -connect example.com:443 -servername example.com
   ```

2. **Check SSL configuration:**
   ```bash
   # Verify SSL_WARNING_DAYS and SSL_CRITICAL_DAYS
   echo $SSL_WARNING_DAYS
   echo $SSL_CRITICAL_DAYS
   ```

3. **Review probe service logs:**
   ```bash
   # Look for SSL-related errors
   docker logs url-monitor-app | grep -i ssl
   ```

### High Response Times

**Symptoms:**
- Checks timing out
- Slow response times recorded

**Solutions:**

1. **Increase timeout:**
   ```bash
   # Adjust DEFAULT_TIMEOUT in .env
   DEFAULT_TIMEOUT=60
   ```

2. **Check network connectivity:**
   ```bash
   # Test from application server
   curl -w "@curl-format.txt" -o /dev/null -s https://target-url.com
   ```

3. **Review concurrent check limit:**
   ```bash
   # Adjust MAX_CONCURRENT_CHECKS
   MAX_CONCURRENT_CHECKS=50
   ```

## Notification Delivery Problems

### Email Notifications Not Sending

**Symptoms:**
- Alerts triggered but emails not received
- SMTP errors in logs

**Solutions:**

1. **Verify SMTP configuration:**
   ```bash
   # Check SMTP settings
   echo $SMTP_HOST
   echo $SMTP_PORT
   echo $SMTP_USER
   ```

2. **Test SMTP connection:**
   ```bash
   # Use telnet or openssl
   openssl s_client -connect smtp.gmail.com:587 -starttls smtp
   ```

3. **Check email credentials:**
   ```bash
   # For Gmail, use app-specific password
   # Enable "Less secure app access" or use OAuth2
   ```

4. **Review notification logs:**
   ```bash
   # Check for SMTP errors
   docker logs url-monitor-app | grep -i smtp
   ```

### Webhook Notifications Failing

**Symptoms:**
- Slack/Teams notifications not appearing
- Webhook errors in logs

**Solutions:**

1. **Verify webhook URL:**
   ```bash
   # Test webhook manually
   curl -X POST $SLACK_WEBHOOK_URL \
     -H "Content-Type: application/json" \
     -d '{"text":"Test message"}'
   ```

2. **Check webhook timeout:**
   ```bash
   # Increase timeout if needed
   WEBHOOK_TIMEOUT=30000
   ```

3. **Review webhook format:**
   ```bash
   # Ensure correct payload format for Slack/Teams
   # Check application logs for request/response
   ```

## Performance Issues

### High Memory Usage

**Symptoms:**
- Application consuming excessive memory
- Out of memory errors

**Solutions:**

1. **Check Redis memory usage:**
   ```bash
   # View Redis memory stats
   redis-cli INFO memory
   
   # Set max memory limit
   redis-cli CONFIG SET maxmemory 512mb
   redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```

2. **Review connection pool sizes:**
   ```bash
   # Reduce DB_MAX_CONNECTIONS if needed
   DB_MAX_CONNECTIONS=10
   ```

3. **Monitor Node.js heap:**
   ```bash
   # Start with increased heap size
   NODE_OPTIONS="--max-old-space-size=2048" npm start
   ```

4. **Check for memory leaks:**
   ```bash
   # Use Node.js profiling tools
   node --inspect dist/index.js
   ```

### Slow Database Queries

**Symptoms:**
- API responses slow
- High database CPU usage

**Solutions:**

1. **Check query performance:**
   ```sql
   -- Enable query logging
   ALTER SYSTEM SET log_min_duration_statement = 1000;
   SELECT pg_reload_conf();
   
   -- View slow queries
   SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
   ```

2. **Verify indexes exist:**
   ```sql
   -- Check indexes
   \di
   
   -- Recreate if missing
   CREATE INDEX idx_check_results_monitor_time ON check_results (monitor_id, timestamp DESC);
   ```

3. **Analyze and vacuum:**
   ```sql
   -- Update statistics
   ANALYZE;
   
   -- Reclaim space
   VACUUM;
   ```

4. **Review partition strategy:**
   ```sql
   -- Check partitions
   SELECT * FROM pg_partitions WHERE tablename = 'check_results';
   ```

### InfluxDB Performance Issues

**Symptoms:**
- Slow time-series queries
- High InfluxDB CPU usage

**Solutions:**

1. **Check retention policy:**
   ```bash
   # Verify retention is appropriate
   influx bucket list --token YOUR_TOKEN
   ```

2. **Optimize queries:**
   ```bash
   # Use time ranges in queries
   # Limit data points returned
   # Use aggregation functions
   ```

3. **Monitor InfluxDB metrics:**
   ```bash
   # Check InfluxDB metrics
   curl http://localhost:8086/metrics
   ```

## Docker-Specific Issues

### Container Won't Start

**Symptoms:**
- Container exits immediately
- Health check failing

**Solutions:**

1. **Check container logs:**
   ```bash
   docker logs url-monitor-app
   docker logs url-monitor-postgres
   docker logs url-monitor-influxdb
   docker logs url-monitor-redis
   ```

2. **Verify dependencies:**
   ```bash
   # Check if databases are healthy
   docker-compose ps
   
   # Wait for dependencies
   docker-compose up -d postgres influxdb redis
   # Wait 30 seconds
   docker-compose up -d app
   ```

3. **Check resource limits:**
   ```bash
   # Increase memory limits in docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 2G
   ```

### Volume Permission Issues

**Symptoms:**
- Cannot write to volumes
- Permission denied errors

**Solutions:**

1. **Fix volume permissions:**
   ```bash
   # Change ownership
   sudo chown -R 1001:1001 ./volumes/postgres
   sudo chown -R 1001:1001 ./volumes/influxdb
   ```

2. **Use named volumes:**
   ```yaml
   # In docker-compose.yml
   volumes:
     postgres_data:
       driver: local
   ```

### Network Issues

**Symptoms:**
- Containers cannot communicate
- DNS resolution failing

**Solutions:**

1. **Check network:**
   ```bash
   # List networks
   docker network ls
   
   # Inspect network
   docker network inspect url-monitor-network
   ```

2. **Recreate network:**
   ```bash
   docker-compose down
   docker network prune
   docker-compose up -d
   ```

3. **Use service names:**
   ```bash
   # In DATABASE_URL, use service name
   DATABASE_URL=postgresql://postgres:password@postgres:5432/url_monitoring
   ```

## Diagnostic Commands

### Health Check Commands

```bash
# Application health
curl http://localhost:3000/health

# Readiness check
curl http://localhost:3000/ready

# Database health
npm run db:health

# PostgreSQL connection
psql "postgresql://postgres:password@localhost:5432/url_monitoring" -c "SELECT 1;"

# InfluxDB health
curl http://localhost:8086/health

# Redis health
redis-cli ping
```

### Log Commands

```bash
# Application logs
docker logs -f url-monitor-app

# Database logs
docker logs -f url-monitor-postgres

# InfluxDB logs
docker logs -f url-monitor-influxdb

# Redis logs
docker logs -f url-monitor-redis

# All logs
docker-compose logs -f
```

### Database Inspection

```bash
# PostgreSQL
psql -U postgres url_monitoring

# List tables
\dt

# Check monitors
SELECT * FROM monitors;

# Check recent check results
SELECT * FROM check_results ORDER BY timestamp DESC LIMIT 10;

# InfluxDB
influx query 'from(bucket:"check-results") |> range(start: -1h) |> limit(n:10)' --token YOUR_TOKEN

# Redis
redis-cli
KEYS url-monitor:*
GET url-monitor:session:xxx
```

### Performance Monitoring

```bash
# Docker stats
docker stats

# System resources
top
htop

# Disk usage
df -h
du -sh /var/lib/docker/volumes/*

# Network connections
netstat -an | grep ESTABLISHED
```

## Getting Help

If you're still experiencing issues:

1. **Collect diagnostic information:**
   - Application logs
   - Database logs
   - Environment configuration (redact secrets)
   - Error messages and stack traces

2. **Check documentation:**
   - [Deployment Guide](./DEPLOYMENT.md)
   - [Environment Variables](./ENVIRONMENT.md)
   - [Monitoring Guide](./MONITORING.md)

3. **Contact support:**
   - Include diagnostic information
   - Describe steps to reproduce
   - Specify environment (Docker, AWS, on-premises)
