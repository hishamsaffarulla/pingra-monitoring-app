# URL Monitoring Application

A lightweight URL monitoring application that provides uptime monitoring, response time tracking, and multi-channel alerting capabilities. The system is designed for high reliability with minimal features, deployable across AWS, local Docker, and on-premises environments without modification.

## Features

- **HTTP/HTTPS URL Monitoring**: Check endpoint availability with configurable intervals (1m/5m)
- **Multi-Location Checks**: Monitor from US, EU, and ME regions
- **SSL Certificate Monitoring**: Track certificate expiry with advance warnings
- **Configurable Alerting**: Set failure thresholds and recovery notifications
- **Multi-Channel Notifications**: Email, webhook (Slack/Teams), SMS, and voice alerts
- **Real-time Dashboard**: View uptime status, response times, and historical data
- **Tenant Isolation**: Secure multi-tenant architecture with JWT authentication

## Technology Stack

- **Backend**: TypeScript, Node.js, Express.js
- **Databases**: PostgreSQL (relational data), InfluxDB (time-series), Redis (caching/sessions)
- **Authentication**: JWT with secure session management
- **Testing**: Jest (unit tests) + fast-check (property-based testing)

## Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- InfluxDB 2.0+
- Redis 6+

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`

5. Build the application:
   ```bash
   npm run build
   ```

6. Start the application:
   ```bash
   npm start
   ```

For development:
```bash
npm run dev
```

### Testing

Run unit tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

Run tests in watch mode:
```bash
npm run test:watch
```

### Linting

Check code style:
```bash
npm run lint
```

Fix linting issues:
```bash
npm run lint:fix
```

## Architecture

The application follows a monolithic architecture with clear separation of concerns:

- **Scheduler**: Manages check intervals and triggers probe execution
- **Probe Runner**: Executes HTTP/HTTPS checks from multiple locations  
- **Database Layer**: Handles data persistence across PostgreSQL, InfluxDB, and Redis
- **Alert Engine**: Processes failures and manages notification delivery
- **Web Interface**: Provides dashboard and REST API with JWT authentication

## Deployment

The application supports deployment across multiple environments:

- **AWS**: ECS/Fargate with RDS PostgreSQL, InfluxDB Cloud, and ElastiCache Redis
- **Docker**: Local development with docker-compose
- **On-premises**: Kubernetes or standalone Docker with external databases

Detailed deployment guides will be provided in the `/docs` directory.

## License

MIT License - see LICENSE file for details.