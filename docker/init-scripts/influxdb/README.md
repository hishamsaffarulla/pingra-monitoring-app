# InfluxDB Initialization

InfluxDB 2.x is initialized automatically using environment variables in docker-compose.yml:

- `DOCKER_INFLUXDB_INIT_MODE=setup` - Enables automatic setup
- `DOCKER_INFLUXDB_INIT_USERNAME` - Admin username
- `DOCKER_INFLUXDB_INIT_PASSWORD` - Admin password
- `DOCKER_INFLUXDB_INIT_ORG` - Organization name
- `DOCKER_INFLUXDB_INIT_BUCKET` - Default bucket name
- `DOCKER_INFLUXDB_INIT_RETENTION` - Data retention period
- `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` - Admin API token

The application will automatically create the necessary bucket and retention policies on first startup using the InfluxDB setup service.

## Manual Setup (if needed)

If you need to manually configure InfluxDB:

1. Access the InfluxDB UI at http://localhost:8086
2. Login with the credentials from docker-compose.yml
3. Create a bucket named "check-results" with 90-day retention
4. Generate an API token with read/write permissions
5. Update the INFLUXDB_TOKEN in your .env file
