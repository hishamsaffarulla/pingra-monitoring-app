/**
 * URL Monitoring Application Entry Point
 * 
 * A lightweight URL monitoring application that provides uptime monitoring,
 * response time tracking, and multi-channel alerting capabilities.
 */

import dotenv from 'dotenv';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { logger } from './utils/logger';
import { getConfig } from './config';
import { createDatabaseManager, getDatabaseManager } from './database/connection';
import { setupInfluxDB } from './database/influx-setup';
import { setupRedis } from './database/redis-setup';
import { runMigrations } from './database/migrator';
import { initializeOrchestrator, shutdownOrchestrator } from './services/application-orchestrator';

// Import routes
import * as authRoutes from './routes/auth-routes';
import * as monitorRoutes from './routes/monitor-routes';
import * as metricsRoutes from './routes/metrics-routes';
import * as alertRoutes from './routes/alert-routes';
import * as incidentRoutes from './routes/incident-routes';
import * as integrationRoutes from './routes/integration-routes';
import * as contactListRoutes from './routes/contact-lists-routes';
import * as userManagementRoutes from './routes/user-management-routes';
import * as settingsRoutes from './routes/settings-routes';
import * as reportsRoutes from './routes/reports-routes';
import dashboardRoutes from './routes/dashboard-routes';

// Load environment variables
dotenv.config();

const PORT = process.env['PORT'] || 3000;
let server: any;
let isShuttingDown = false;

/**
 * Initialize all database connections and setup
 */
async function initializeDatabases(): Promise<void> {
  logger.info('Initializing database connections...');
  
  const config = getConfig();
  
  // Create and initialize database manager
  const dbManager = createDatabaseManager(config.database);
  await dbManager.initialize();
  
  logger.info('Database connections established');
  
  // Run PostgreSQL migrations
  logger.info('Running database migrations...');
  await runMigrations('up');
  logger.info('Database migrations completed');
  
  // Setup InfluxDB
  logger.info('Setting up InfluxDB...');
  await setupInfluxDB(config.influxdb);
  logger.info('InfluxDB setup completed');
  
  // Setup Redis
  logger.info('Setting up Redis...');
  await setupRedis(config.redis);
  logger.info('Redis setup completed');
  
  // Initialize application orchestrator (wires all components together)
  logger.info('Initializing application orchestrator...');
  await initializeOrchestrator();
  logger.info('Application orchestrator initialized - all components wired');
}

/**
 * Create Express application with all middleware and routes
 */
function createApp(): Application {
  const app: Application = express();
  
  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }));
  
  // CORS middleware
  app.use(cors());
  
  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Serve static files
  app.use(express.static(path.join(process.cwd(), 'public')));
  
  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    if (isShuttingDown) {
      return res.status(503).json({
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      });
    }
    
    try {
      const dbManager = getDatabaseManager();
      const health = await dbManager.healthCheck();
      
      const allHealthy = health.postgresql && health.influxdb && health.redis;
      const status = allHealthy ? 'healthy' : 'degraded';
      const statusCode = allHealthy ? 200 : 503;
      
      return res.status(statusCode).json({
        status,
        timestamp: new Date().toISOString(),
        databases: {
          postgresql: health.postgresql ? 'healthy' : 'unhealthy',
          influxdb: health.influxdb ? 'healthy' : 'unhealthy',
          redis: health.redis ? 'healthy' : 'unhealthy',
        },
      });
    } catch (error) {
      logger.error('Health check failed:', error);
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });
  
  // Readiness check endpoint
  app.get('/ready', async (_req: Request, res: Response) => {
    if (isShuttingDown) {
      return res.status(503).json({
        ready: false,
        reason: 'Application is shutting down',
      });
    }
    
    try {
      const dbManager = getDatabaseManager();
      const health = await dbManager.healthCheck();
      
      const allHealthy = health.postgresql && health.influxdb && health.redis;
      
      if (allHealthy) {
        return res.status(200).json({
          ready: true,
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(503).json({
          ready: false,
          reason: 'One or more database connections are unhealthy',
          databases: health,
        });
      }
    } catch (error) {
      logger.error('Readiness check failed:', error);
      return res.status(503).json({
        ready: false,
        reason: 'Readiness check failed',
      });
    }
  });
  
  // API routes - initialize with database connections
  const dbManager = getDatabaseManager();
  const pgPool = dbManager.getPostgreSQLPool();
  const influxWriteApi = dbManager.getInfluxWriteApi();
  const influxQueryApi = dbManager.getInfluxQueryApi();
  const config = getConfig();
  
  app.use('/api/auth', authRoutes.createAuthRouter(pgPool));
  app.use('/api/monitors', monitorRoutes.createMonitorRouter(pgPool));
  app.use('/api/monitors', metricsRoutes.createMetricsRouter(pgPool, influxWriteApi, influxQueryApi, config.influxdb.bucket));
  app.use('/api/alerts', alertRoutes.createAlertRouter(pgPool));
  app.use('/api/incidents', incidentRoutes.createIncidentRouter(pgPool));
  app.use('/api/integrations', integrationRoutes.createIntegrationRouter(pgPool));
  app.use('/api/contact-lists', contactListRoutes.createContactListRouter(pgPool));
  app.use('/api/users', userManagementRoutes.createUserManagementRouter(pgPool));
  app.use('/api/settings', settingsRoutes.createSettingsRouter(pgPool));
  app.use('/api/reports', reportsRoutes.createReportsRouter(pgPool));
  
  // Dashboard routes (must be last to not override API routes)
  app.use('/', dashboardRoutes);
  
  // Error handling middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  });
  
  return app;
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  logger.info('URL Monitoring Application starting...');
  
  try {
    // Load configuration
    logger.info('Loading configuration...');
    const config = getConfig();
    logger.info(`Environment: ${config.env}`);
    logger.info(`Port: ${config.port}`);
    
    // Initialize databases
    await initializeDatabases();
    
    // Create Express application
    const app = createApp();
    
    // Start server
    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Dashboard available at http://localhost:${PORT}`);
      logger.info(`Health check available at http://localhost:${PORT}/health`);
      logger.info(`Readiness check available at http://localhost:${PORT}/ready`);
    });
    
    logger.info('Application initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    throw error;
  }
}

/**
 * Handle graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring signal:', signal);
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  // Stop accepting new connections
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      
      try {
        // Shutdown application orchestrator (stops scheduler and components)
        logger.info('Shutting down application orchestrator...');
        await shutdownOrchestrator();
        logger.info('Application orchestrator shutdown complete');
        
        // Close database connections
        logger.info('Closing database connections...');
        const dbManager = getDatabaseManager();
        await dbManager.close();
        logger.info('Database connections closed');
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
}

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

// Start the application
main().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});
