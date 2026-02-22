# Redis Initialization

Redis is initialized automatically with the following configuration:

- **Persistence**: AOF (Append-Only File) enabled for data durability
- **Authentication**: Password-based authentication (set via command in docker-compose.yml)
- **Data Directory**: /data (mounted as volume)

## Configuration

Redis is configured via command-line arguments in docker-compose.yml:
- `--appendonly yes` - Enable AOF persistence
- `--requirepass redis_password` - Set authentication password

## Key Namespaces

The application uses the following Redis key prefixes:

- `url-monitor:session:*` - User sessions (TTL: 24 hours)
- `url-monitor:cache:*` - General cache (TTL: 30 minutes)
- `url-monitor:alert-state:*` - Alert state tracking (TTL: 7 days)
- `url-monitor:schedule:*` - Scheduler state
- `url-monitor:tenant:*` - Tenant-specific cache

## Manual Configuration (if needed)

If you need to customize Redis configuration:

1. Create a redis.conf file
2. Mount it in docker-compose.yml: `./redis.conf:/usr/local/etc/redis/redis.conf`
3. Update the command to: `redis-server /usr/local/etc/redis/redis.conf`
