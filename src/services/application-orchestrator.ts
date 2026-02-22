/**
 * Application Orchestrator
 * Wires all components together and manages the application lifecycle
 */

import { getDatabaseManager } from '../database/connection';
import { setupRedis } from '../database/redis-setup';
import { createSchedulerService, SchedulerService } from './scheduler-service';
import { ProbeServiceImpl, ProbeService } from './probe-service';
import { AlertEngine } from './alert-engine';
import { NotificationService } from './notification-service';
import { CheckResultRepository } from '../database/repositories/check-result-repository';
import { AlertRepository } from '../database/repositories/alert-repository';
import { MonitorRepository } from '../database/repositories/monitor-repository';
import { NotificationRepository } from '../database/repositories/notification-repository';
import { IntegrationRepository } from '../database/repositories/integration-repository';
import { ContactListRepository } from '../database/repositories/contact-list-repository';
import { IncidentRepository } from '../database/repositories/incident-repository';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

export interface ApplicationComponents {
  scheduler: SchedulerService;
  probeService: ProbeService;
  alertEngine: AlertEngine;
  notificationService: NotificationService;
  notificationRetryService: any; // NotificationRetryService
  repositories: {
    monitor: MonitorRepository;
    checkResult: CheckResultRepository;
    alert: AlertRepository;
    notification: NotificationRepository;
  };
}

export class ApplicationOrchestrator {
  private components: ApplicationComponents | null = null;
  private isInitialized = false;

  /**
   * Initialize all application components and wire them together
   */
  async initialize(): Promise<ApplicationComponents> {
    if (this.isInitialized) {
      logger.warn('Application orchestrator already initialized');
      return this.components!;
    }

    try {
      logger.info('Initializing application components...');

      const config = getConfig();
      const dbManager = getDatabaseManager();

      // Initialize Redis setup
      const redisSetup = await setupRedis(config.redis);

      // Initialize repositories
      logger.info('Initializing repositories...');
      const monitorRepository = new MonitorRepository(dbManager.getPostgreSQLPool());
      const checkResultRepository = new CheckResultRepository(
        dbManager.getInfluxWriteApi(),
        dbManager.getInfluxQueryApi(),
        config.influxdb.bucket
      );
      const alertRepository = new AlertRepository(dbManager.getPostgreSQLPool());
      const notificationRepository = new NotificationRepository(dbManager.getPostgreSQLPool());
      const integrationRepository = new IntegrationRepository(dbManager.getPostgreSQLPool());
      const contactListRepository = new ContactListRepository(dbManager.getPostgreSQLPool());
      const incidentRepository = new IncidentRepository(dbManager.getPostgreSQLPool());
      const settingsRepository = new SettingsRepository(dbManager.getPostgreSQLPool());

      // Initialize notification service (without retry service initially)
      logger.info('Initializing notification service...');
      const notificationService = new NotificationService(
        notificationRepository
      );
      
      // Initialize notification retry service
      const notificationRetryService = new (await import('./notification-retry-service')).NotificationRetryService(
        notificationService,
        notificationRepository,
        dbManager.getRedisClient(),
        {
          maxRetries: parseInt(process.env['NOTIFICATION_MAX_RETRIES'] || '3', 10),
          initialDelayMs: parseInt(process.env['NOTIFICATION_RETRY_DELAY'] || '60000', 10),
          maxDelayMs: parseInt(process.env['NOTIFICATION_MAX_RETRY_DELAY'] || '3600000', 10),
          backoffMultiplier: parseFloat(process.env['NOTIFICATION_BACKOFF_MULTIPLIER'] || '2'),
        }
      );

      // Initialize alert engine
      logger.info('Initializing alert engine...');
      const alertTriggerMode =
        process.env['ALERT_TRIGGER_MODE'] === 'any' ? 'any' : 'all';
      const alertEngine = new AlertEngine(
        alertRepository,
        checkResultRepository,
        monitorRepository,
        redisSetup,
        {
          defaultFailureThreshold: parseInt(process.env['DEFAULT_FAILURE_THRESHOLD'] || '3', 10),
          sslWarningDays: parseInt(process.env['SSL_WARNING_DAYS'] || '30', 10),
          sslCriticalDays: parseInt(process.env['SSL_CRITICAL_DAYS'] || '7', 10),
          alertStateTTL: parseInt(process.env['ALERT_STATE_TTL'] || '604800', 10), // 7 days
          alertTriggerMode,
        },
        notificationService,
        integrationRepository,
        contactListRepository,
        incidentRepository,
        settingsRepository
      );

      // Wire alert engine to notification service
      this.wireAlertEngineToNotifications(alertEngine, notificationService);

      // Initialize probe service
      logger.info('Initializing probe service...');
      const probeService = new ProbeServiceImpl(
        {
          defaultTimeout: config.monitoring.defaultTimeout,
          maxConcurrentChecks: config.monitoring.maxConcurrentChecks,
          userAgent: process.env['USER_AGENT'] || 'URL-Monitor/1.0',
          followRedirects: process.env['FOLLOW_REDIRECTS'] !== 'false',
          maxRedirects: parseInt(process.env['MAX_REDIRECTS'] || '5', 10),
        },
        checkResultRepository,
        redisSetup
      );

      // Wire probe service to alert engine
      this.wireProbeServiceToAlertEngine(probeService, alertEngine);

      // Initialize scheduler service
      logger.info('Initializing scheduler service...');
      const scheduler = createSchedulerService(
        {
          enablePersistence: process.env['SCHEDULER_PERSISTENCE'] !== 'false',
          maxConcurrentChecks: config.monitoring.maxConcurrentChecks,
          checkOverlapTimeoutMs: parseInt(process.env['CHECK_OVERLAP_TIMEOUT'] || '60000', 10),
        },
        async (monitorId: string) => {
          // This callback is triggered when a check should be executed
          await this.executeMonitorCheck(monitorId, probeService, monitorRepository, alertEngine);
        },
        redisSetup
      );

      // Start scheduler
      await scheduler.start();

      // Load and schedule all active monitors
      await this.scheduleActiveMonitors(scheduler, monitorRepository);

      // Setup Redis pub/sub for real-time dashboard updates
      await this.setupRedisPubSub(redisSetup, checkResultRepository);

      this.components = {
        scheduler,
        probeService,
        alertEngine,
        notificationService,
        notificationRetryService,
        repositories: {
          monitor: monitorRepository,
          checkResult: checkResultRepository,
          alert: alertRepository,
          notification: notificationRepository,
        },
      };

      this.isInitialized = true;
      logger.info('Application components initialized and wired successfully');

      return this.components;
    } catch (error) {
      logger.error('Failed to initialize application components:', error);
      throw error;
    }
  }

  /**
   * Execute a check for a specific monitor
   */
  private async executeMonitorCheck(
    monitorId: string,
    probeService: ProbeService,
    monitorRepository: MonitorRepository,
    alertEngine: AlertEngine
  ): Promise<void> {
    try {
      logger.debug(`Executing scheduled check for monitor ${monitorId}`);

      // Get monitor configuration
      const monitor = await monitorRepository.findById(monitorId);
      if (!monitor) {
        logger.warn(`Monitor ${monitorId} not found, skipping check`);
        return;
      }

      // Execute check from all configured locations
      const results = await probeService.executeMultiLocationCheck(monitor);

      // Process results for alerting/incident creation
      for (const result of results) {
        await alertEngine.processCheckResult(result);
      }

      logger.debug(`Completed scheduled check for monitor ${monitorId}`);
    } catch (error) {
      logger.error(`Failed to execute check for monitor ${monitorId}:`, error);
    }
  }

  /**
   * Wire probe service to alert engine
   * Check results from probe service are automatically processed by alert engine
   */
  private wireProbeServiceToAlertEngine(
    _probeService: ProbeService,
    _alertEngine: AlertEngine
  ): void {
    // The probe service stores results in InfluxDB
    // The alert engine processes results via the processCheckResult method
    // This wiring is handled through the check result repository and Redis pub/sub
    logger.info('Probe service wired to alert engine via InfluxDB and Redis');
  }

  /**
   * Wire alert engine to notification service
   * Alerts from alert engine are automatically sent via notification service
   */
  private wireAlertEngineToNotifications(
    _alertEngine: AlertEngine,
    _notificationService: NotificationService
  ): void {
    // The alert engine uses the notification service to send alerts
    // This is handled through the sendNotifications method
    logger.info('Alert engine wired to notification service');
  }

  /**
   * Schedule all active monitors
   */
  private async scheduleActiveMonitors(
    scheduler: SchedulerService,
    monitorRepository: MonitorRepository
  ): Promise<void> {
    try {
      logger.info('Loading active monitors for scheduling...');

      // Get all monitors from database
      const { monitors } = await monitorRepository.findMany({}, { limit: 1000 });

      let scheduledCount = 0;
      for (const monitor of monitors) {
        try {
          scheduler.scheduleCheck(monitor.id, monitor.checkInterval);
          scheduledCount++;
        } catch (error) {
          logger.error(`Failed to schedule monitor ${monitor.id}:`, error);
        }
      }

      logger.info(`Scheduled ${scheduledCount} active monitors`);
    } catch (error) {
      logger.error('Failed to schedule active monitors:', error);
      throw error;
    }
  }

  /**
   * Setup Redis pub/sub for real-time dashboard updates
   */
  private async setupRedisPubSub(
    redisSetup: any,
    _checkResultRepository: CheckResultRepository
  ): Promise<void> {
    try {
      logger.info('Setting up Redis pub/sub for real-time dashboard updates...');

      // Subscribe to check result updates
      await redisSetup.subscribe('check-results', async (message: any) => {
        try {
          logger.debug('Received check result update via pub/sub:', message);
          // Dashboard clients can subscribe to this channel for real-time updates
          // The actual WebSocket/SSE implementation would be in the dashboard routes
        } catch (error) {
          logger.error('Error processing pub/sub message:', error);
        }
      });

      logger.info('Redis pub/sub configured for real-time updates');
    } catch (error) {
      logger.warn('Failed to setup Redis pub/sub (non-critical):', error);
      // Don't throw - pub/sub is optional for core functionality
    }
  }

  /**
   * Shutdown all components gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized || !this.components) {
      logger.warn('Application orchestrator not initialized, nothing to shutdown');
      return;
    }

    try {
      logger.info('Shutting down application components...');

      // Stop scheduler first to prevent new checks
      await this.components.scheduler.stop();
      logger.info('Scheduler stopped');

      // Wait for any in-flight checks to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      logger.info('Application components shutdown complete');
      this.isInitialized = false;
    } catch (error) {
      logger.error('Error during component shutdown:', error);
      throw error;
    }
  }

  /**
   * Get application components
   */
  getComponents(): ApplicationComponents {
    if (!this.isInitialized || !this.components) {
      throw new Error('Application orchestrator not initialized');
    }
    return this.components;
  }

  /**
   * Check if orchestrator is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
let orchestrator: ApplicationOrchestrator | null = null;

/**
 * Get or create application orchestrator instance
 */
export function getOrchestrator(): ApplicationOrchestrator {
  if (!orchestrator) {
    orchestrator = new ApplicationOrchestrator();
  }
  return orchestrator;
}

/**
 * Initialize application orchestrator
 */
export async function initializeOrchestrator(): Promise<ApplicationComponents> {
  const orch = getOrchestrator();
  return await orch.initialize();
}

/**
 * Shutdown application orchestrator
 */
export async function shutdownOrchestrator(): Promise<void> {
  if (orchestrator) {
    await orchestrator.shutdown();
  }
}
