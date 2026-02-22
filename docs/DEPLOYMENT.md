# URL Monitoring Application - Deployment Guide

This guide covers deployment of the URL Monitoring Application across different environments: Docker (local development), AWS (cloud), and on-premises infrastructure.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Deployment](#docker-deployment)
3. [AWS Deployment](#aws-deployment)
4. [On-Premises Deployment](#on-premises-deployment)
5. [Environment Variables](#environment-variables)
6. [Database Setup](#database-setup)
7. [Troubleshooting](#troubleshooting)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Prerequisites

### General Requirements

- Node.js 20.x or higher
- PostgreSQL 16.x
- InfluxDB 2.7.x
- Redis 7.x
- Docker and Docker Compose (for containerized deployment)

### System Requirements

**Minimum:**
- CPU: 2 cores
- RAM: 4 GB
- Storage: 20 GB

**Recommended:**
- CPU: 4 cores
- RAM: 8 GB
- Storage: 50 GB (with room for time-series data growth)

## Docker Deployment

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd url-monitoring
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Start services:**
   ```bash
   # Development mode with hot reload
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

   # Or in detached mode
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

4. **Run database migrations:**
   ```bash
   # Migrations run automatically on startup
   # To run manually:
   docker-compose exec app npm run migrate
   ```

5. **Access the application:**
   - Dashboard: http://localhost:3000
   - Health Check: http://localhost:3000/health
   - API: http://localhost:3000/api

6. **View logs:**
   ```bash
   # All services
   docker-compose logs -f

   # Specific service
   docker-compose logs -f app
   ```

7. **Stop services:**
   ```bash
   docker-compose down

   # Remove volumes (WARNING: deletes all data)
   docker-compose down -v
   ```

### Production Docker Deployment

1. **Set production environment variables:**
   ```bash
   # Create .env file with production values
   cat > .env << EOF
   POSTGRES_PASSWORD=<strong-password>
   INFLUXDB_PASSWORD=<strong-password>
   INFLUXDB_TOKEN=<strong-token>
   REDIS_PASSWORD=<strong-password>
   JWT_SECRET=<strong-secret>
   EOF
   ```

2. **Start production services:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

3. **Verify deployment:**
   ```bash
   # Check service health
   curl http://localhost:3000/health

   # Check logs
   docker-compose logs -f app
   ```

## AWS Deployment

### Architecture Overview

The application can be deployed on AWS using:
- **ECS/Fargate** for container orchestration
- **RDS PostgreSQL** for relational data
- **Amazon Managed Service for InfluxDB** or self-hosted InfluxDB on EC2
- **ElastiCache Redis** for caching and sessions
- **Application Load Balancer** for traffic distribution
- **CloudWatch** for logging and monitoring

### Deployment Steps

#### Option 1: ECS with Fargate

1. **Create RDS PostgreSQL instance:**
   ```bash
   aws rds create-db-instance \
     --db-instance-identifier url-monitor-db \
     --db-instance-class db.t3.medium \
     --engine postgres \
     --engine-version 16.1 \
     --master-username postgres \
     --master-user-password <password> \
     --allocated-storage 100 \
     --vpc-security-group-ids <security-group-id> \
     --db-subnet-group-name <subnet-group>
   ```

2. **Create ElastiCache Redis cluster:**
   ```bash
   aws elasticache create-cache-cluster \
     --cache-cluster-id url-monitor-redis \
     --cache-node-type cache.t3.medium \
     --engine redis \
     --engine-version 7.0 \
     --num-cache-nodes 1 \
     --security-group-ids <security-group-id> \
     --cache-subnet-group-name <subnet-group>
   ```

3. **Launch InfluxDB on EC2 (or use managed service):**
   ```bash
   # Launch EC2 instance with InfluxDB
   # Or use Amazon Timestream as an alternative
   ```

4. **Build and push Docker image to ECR:**
   ```bash
   # Authenticate to ECR
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

   # Build image
   docker build -t url-monitoring .

   # Tag image
   docker tag url-monitoring:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/url-monitoring:latest

   # Push image
   docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/url-monitoring:latest
   ```

5. **Create ECS task definition:**
   ```json
   {
     "family": "url-monitoring",
     "networkMode": "awsvpc",
     "requiresCompatibilities": ["FARGATE"],
     "cpu": "1024",
     "memory": "2048",
     "containerDefinitions": [
       {
         "name": "url-monitoring",
         "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/url-monitoring:latest",
         "portMappings": [
           {
             "containerPort": 3000,
             "protocol": "tcp"
           }
         ],
         "environment": [
           {"name": "NODE_ENV", "value": "production"},
           {"name": "PORT", "value": "3000"}
         ],
         "secrets": [
           {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
           {"name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..."}
         ],
         "logConfiguration": {
           "logDriver": "awslogs",
           "options": {
             "awslogs-group": "/ecs/url-monitoring",
             "awslogs-region": "us-east-1",
             "awslogs-stream-prefix": "ecs"
           }
         },
         "healthCheck": {
           "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
           "interval": 30,
           "timeout": 5,
           "retries": 3,
           "startPeriod": 60
         }
       }
     ]
   }
   ```

6. **Create ECS service:**
   ```bash
   aws ecs create-service \
     --cluster url-monitoring-cluster \
     --service-name url-monitoring-service \
     --task-definition url-monitoring \
     --desired-count 2 \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[<subnet-ids>],securityGroups=[<sg-id>],assignPublicIp=ENABLED}" \
     --load-balancers "targetGroupArn=<target-group-arn>,containerName=url-monitoring,containerPort=3000"
   ```

#### Option 2: EC2 with Docker

1. **Launch EC2 instance:**
   - AMI: Amazon Linux 2023
   - Instance type: t3.medium or larger
   - Security groups: Allow ports 22 (SSH), 3000 (App), 5432 (PostgreSQL), 8086 (InfluxDB), 6379 (Redis)

2. **Install Docker:**
   ```bash
   sudo yum update -y
   sudo yum install -y docker
   sudo systemctl start docker
   sudo systemctl enable docker
   sudo usermod -a -G docker ec2-user
   ```

3. **Install Docker Compose:**
   ```bash
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

4. **Deploy application:**
   ```bash
   # Clone repository
   git clone <repository-url>
   cd url-monitoring

   # Set environment variables
   cp .env.example .env
   # Edit .env with production values

   # Start services
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

## On-Premises Deployment

### Option 1: Kubernetes Deployment

1. **Create namespace:**
   ```bash
   kubectl create namespace url-monitoring
   ```

2. **Create secrets:**
   ```bash
   kubectl create secret generic url-monitoring-secrets \
     --from-literal=database-url=postgresql://... \
     --from-literal=jwt-secret=... \
     --from-literal=influxdb-token=... \
     --from-literal=redis-password=... \
     -n url-monitoring
   ```

3. **Deploy PostgreSQL:**
   ```yaml
   # postgres-deployment.yaml
   apiVersion: apps/v1
   kind: StatefulSet
   metadata:
     name: postgres
     namespace: url-monitoring
   spec:
     serviceName: postgres
     replicas: 1
     selector:
       matchLabels:
         app: postgres
     template:
       metadata:
         labels:
           app: postgres
       spec:
         containers:
         - name: postgres
           image: postgres:16-alpine
           ports:
           - containerPort: 5432
           env:
           - name: POSTGRES_DB
             value: url_monitoring
           - name: POSTGRES_PASSWORD
             valueFrom:
               secretKeyRef:
                 name: url-monitoring-secrets
                 key: postgres-password
           volumeMounts:
           - name: postgres-storage
             mountPath: /var/lib/postgresql/data
     volumeClaimTemplates:
     - metadata:
         name: postgres-storage
       spec:
         accessModes: ["ReadWriteOnce"]
         resources:
           requests:
             storage: 50Gi
   ```

4. **Deploy application:**
   ```yaml
   # app-deployment.yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: url-monitoring
     namespace: url-monitoring
   spec:
     replicas: 2
     selector:
       matchLabels:
         app: url-monitoring
     template:
       metadata:
         labels:
           app: url-monitoring
       spec:
         containers:
         - name: url-monitoring
           image: <your-registry>/url-monitoring:latest
           ports:
           - containerPort: 3000
           env:
           - name: NODE_ENV
             value: production
           - name: DATABASE_URL
             valueFrom:
               secretKeyRef:
                 name: url-monitoring-secrets
                 key: database-url
           livenessProbe:
             httpGet:
               path: /health
               port: 3000
             initialDelaySeconds: 60
             periodSeconds: 30
           readinessProbe:
             httpGet:
               path: /ready
               port: 3000
             initialDelaySeconds: 30
             periodSeconds: 10
   ```

5. **Apply configurations:**
   ```bash
   kubectl apply -f postgres-deployment.yaml
   kubectl apply -f influxdb-deployment.yaml
   kubectl apply -f redis-deployment.yaml
   kubectl apply -f app-deployment.yaml
   kubectl apply -f service.yaml
   kubectl apply -f ingress.yaml
   ```

### Option 2: Standalone Server

1. **Install dependencies:**
   ```bash
   # Install Node.js
   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
   sudo yum install -y nodejs

   # Install PostgreSQL
   sudo yum install -y postgresql16-server
   sudo postgresql-setup --initdb
   sudo systemctl start postgresql
   sudo systemctl enable postgresql

   # Install InfluxDB
   wget https://dl.influxdata.com/influxdb/releases/influxdb2-2.7.0.x86_64.rpm
   sudo yum localinstall influxdb2-2.7.0.x86_64.rpm
   sudo systemctl start influxdb
   sudo systemctl enable influxdb

   # Install Redis
   sudo yum install -y redis
   sudo systemctl start redis
   sudo systemctl enable redis
   ```

2. **Deploy application:**
   ```bash
   # Clone repository
   git clone <repository-url>
   cd url-monitoring

   # Install dependencies
   npm ci --production

   # Build application
   npm run build

   # Set environment variables
   cp .env.example .env
   # Edit .env with production values

   # Run migrations
   npm run migrate

   # Start application with PM2
   npm install -g pm2
   pm2 start dist/index.js --name url-monitoring
   pm2 save
   pm2 startup
   ```

## Environment Variables

See [ENVIRONMENT.md](./ENVIRONMENT.md) for complete environment variable documentation.

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/database
INFLUXDB_URL=http://host:8086
INFLUXDB_TOKEN=your-token
INFLUXDB_ORG=your-org
INFLUXDB_BUCKET=check-results
REDIS_URL=redis://host:6379

# Security
JWT_SECRET=your-secret-key
```

### Optional Variables

```bash
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Monitoring
DEFAULT_TIMEOUT=30
MAX_CONCURRENT_CHECKS=100
DATA_RETENTION_DAYS=90

# Notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password
```

## Database Setup

### PostgreSQL

1. **Create database:**
   ```sql
   CREATE DATABASE url_monitoring;
   CREATE USER url_monitor WITH PASSWORD 'password';
   GRANT ALL PRIVILEGES ON DATABASE url_monitoring TO url_monitor;
   ```

2. **Run migrations:**
   ```bash
   npm run migrate
   ```

3. **Verify setup:**
   ```bash
   npm run migrate:status
   ```

### InfluxDB

1. **Initial setup:**
   ```bash
   # Access InfluxDB UI at http://localhost:8086
   # Create organization and bucket
   # Generate API token
   ```

2. **Configure retention:**
   ```bash
   influx bucket update \
     --name check-results \
     --retention 90d \
     --org url-monitoring
   ```

### Redis

1. **Configure authentication:**
   ```bash
   # Edit redis.conf
   requirepass your-password
   ```

2. **Restart Redis:**
   ```bash
   sudo systemctl restart redis
   ```

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed troubleshooting guide.

### Common Issues

1. **Database connection failures:**
   - Check network connectivity
   - Verify credentials
   - Check firewall rules
   - Review connection pool settings

2. **Application won't start:**
   - Check environment variables
   - Verify database migrations
   - Review application logs
   - Check port availability

3. **High memory usage:**
   - Review Redis cache settings
   - Check for memory leaks
   - Adjust connection pool sizes
   - Monitor time-series data growth

## Monitoring and Maintenance

See [MONITORING.md](./MONITORING.md) for detailed monitoring and maintenance procedures.

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# Readiness check
curl http://localhost:3000/ready

# Database health
npm run db:health
```

### Backup Procedures

```bash
# PostgreSQL backup
pg_dump -U postgres url_monitoring > backup.sql

# InfluxDB backup
influx backup /path/to/backup --org url-monitoring

# Redis backup
redis-cli SAVE
```

### Log Management

```bash
# View application logs
docker-compose logs -f app

# View database logs
docker-compose logs -f postgres

# Rotate logs
logrotate /etc/logrotate.d/url-monitoring
```

### Performance Monitoring

- Monitor CPU and memory usage
- Track database query performance
- Monitor API response times
- Review error rates and patterns
- Track time-series data growth

## Security Considerations

1. **Use strong passwords** for all database connections
2. **Enable SSL/TLS** for production deployments
3. **Rotate JWT secrets** regularly
4. **Keep dependencies updated** with security patches
5. **Use secrets management** (AWS Secrets Manager, HashiCorp Vault)
6. **Enable firewall rules** to restrict access
7. **Regular security audits** and vulnerability scanning

## Support

For issues and questions:
- Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
- Review application logs
- Contact support team
