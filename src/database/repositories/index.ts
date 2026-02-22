/**
 * Repository Index
 * Exports all repository classes and creates a unified repository manager
 */

import { Pool } from 'pg';
import { WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { RepositoryOptions } from './base-repository';
import { MonitorRepository } from './monitor-repository';
import { CheckResultRepository } from './check-result-repository';
import { AlertRepository } from './alert-repository';
import { TenantRepository } from './tenant-repository';
import { NotificationRepository } from './notification-repository';
import { NotificationChannelRepository } from './notification-channel-repository';
import { UserRepository } from './user-repository';
import { IncidentRepository } from './incident-repository';
import { IntegrationRepository } from './integration-repository';
import { ContactListRepository } from './contact-list-repository';
import { AlertGroupRepository } from './alert-group-repository';
import { SettingsRepository } from './settings-repository';
import { ScheduledReportRepository } from './scheduled-report-repository';
import { getDatabaseManager } from '../connection';
import { logger } from '../../utils/logger';

// Export individual repositories
export { BaseRepository } from './base-repository';
export { MonitorRepository } from './monitor-repository';
export { CheckResultRepository } from './check-result-repository';
export { AlertRepository } from './alert-repository';
export { TenantRepository } from './tenant-repository';
export { NotificationRepository } from './notification-repository';
export { NotificationChannelRepository } from './notification-channel-repository';
export { UserRepository } from './user-repository';
export { IncidentRepository } from './incident-repository';
export { IntegrationRepository } from './integration-repository';
export { ContactListRepository } from './contact-list-repository';
export { AlertGroupRepository } from './alert-group-repository';
export { SettingsRepository } from './settings-repository';
export { ScheduledReportRepository } from './scheduled-report-repository';

// Export types
export type { RepositoryOptions } from './base-repository';
export type { MonitorFilters, MonitorListOptions } from './monitor-repository';
export type { CheckResultFilters, CheckResultQueryOptions } from './check-result-repository';
export type { AlertFilters, AlertListOptions } from './alert-repository';
export type { TenantFilters, TenantListOptions } from './tenant-repository';
export type { NotificationFilters, NotificationListOptions } from './notification-repository';
export type { NotificationChannelRecord } from './notification-channel-repository';
export type { CreateUserData } from './user-repository';
export type { IncidentFilters } from './incident-repository';

/**
 * Repository Manager
 * Provides centralized access to all repositories with shared configuration
 */
export class RepositoryManager {
  private pgPool: Pool;
  private influxWriteApi: WriteApi;
  private influxQueryApi: QueryApi;
  private influxBucket: string;
  private options: RepositoryOptions;

  // Repository instances
  private _monitorRepository: MonitorRepository | null = null;
  private _checkResultRepository: CheckResultRepository | null = null;
  private _alertRepository: AlertRepository | null = null;
  private _tenantRepository: TenantRepository | null = null;
  private _notificationRepository: NotificationRepository | null = null;
  private _notificationChannelRepository: NotificationChannelRepository | null = null;
  private _userRepository: UserRepository | null = null;
  private _incidentRepository: IncidentRepository | null = null;
  private _integrationRepository: IntegrationRepository | null = null;
  private _contactListRepository: ContactListRepository | null = null;
  private _alertGroupRepository: AlertGroupRepository | null = null;
  private _settingsRepository: SettingsRepository | null = null;
  private _scheduledReportRepository: ScheduledReportRepository | null = null;

  constructor(
    pgPool: Pool,
    influxWriteApi: WriteApi,
    influxQueryApi: QueryApi,
    influxBucket: string,
    options: RepositoryOptions = {}
  ) {
    this.pgPool = pgPool;
    this.influxWriteApi = influxWriteApi;
    this.influxQueryApi = influxQueryApi;
    this.influxBucket = influxBucket;
    this.options = {
      retryAttempts: 3,
      retryDelay: 1000,
      ...options,
    };
  }

  /**
   * Get Monitor Repository
   */
  get monitors(): MonitorRepository {
    if (!this._monitorRepository) {
      this._monitorRepository = new MonitorRepository(this.pgPool, this.options);
    }
    return this._monitorRepository;
  }

  /**
   * Get CheckResult Repository
   */
  get checkResults(): CheckResultRepository {
    if (!this._checkResultRepository) {
      this._checkResultRepository = new CheckResultRepository(
        this.influxWriteApi,
        this.influxQueryApi,
        this.influxBucket
      );
    }
    return this._checkResultRepository;
  }

  /**
   * Get Alert Repository
   */
  get alerts(): AlertRepository {
    if (!this._alertRepository) {
      this._alertRepository = new AlertRepository(this.pgPool, this.options);
    }
    return this._alertRepository;
  }

  /**
   * Get Tenant Repository
   */
  get tenants(): TenantRepository {
    if (!this._tenantRepository) {
      this._tenantRepository = new TenantRepository(this.pgPool, this.options);
    }
    return this._tenantRepository;
  }

  /**
   * Get Notification Repository
   */
  get notifications(): NotificationRepository {
    if (!this._notificationRepository) {
      this._notificationRepository = new NotificationRepository(this.pgPool, this.options);
    }
    return this._notificationRepository;
  }

  get notificationChannels(): NotificationChannelRepository {
    if (!this._notificationChannelRepository) {
      this._notificationChannelRepository = new NotificationChannelRepository(this.pgPool, this.options);
    }
    return this._notificationChannelRepository;
  }

  /**
   * Get User Repository
   */
  get users(): UserRepository {
    if (!this._userRepository) {
      this._userRepository = new UserRepository(this.pgPool, this.options);
    }
    return this._userRepository;
  }

  get incidents(): IncidentRepository {
    if (!this._incidentRepository) {
      this._incidentRepository = new IncidentRepository(this.pgPool, this.options);
    }
    return this._incidentRepository;
  }

  get integrations(): IntegrationRepository {
    if (!this._integrationRepository) {
      this._integrationRepository = new IntegrationRepository(this.pgPool, this.options);
    }
    return this._integrationRepository;
  }

  get contactLists(): ContactListRepository {
    if (!this._contactListRepository) {
      this._contactListRepository = new ContactListRepository(this.pgPool, this.options);
    }
    return this._contactListRepository;
  }

  get alertGroups(): AlertGroupRepository {
    if (!this._alertGroupRepository) {
      this._alertGroupRepository = new AlertGroupRepository(this.pgPool, this.options);
    }
    return this._alertGroupRepository;
  }

  get settings(): SettingsRepository {
    if (!this._settingsRepository) {
      this._settingsRepository = new SettingsRepository(this.pgPool, this.options);
    }
    return this._settingsRepository;
  }

  get scheduledReports(): ScheduledReportRepository {
    if (!this._scheduledReportRepository) {
      this._scheduledReportRepository = new ScheduledReportRepository(this.pgPool, this.options);
    }
    return this._scheduledReportRepository;
  }

  /**
   * Health check for all repositories
   */
  async healthCheck(): Promise<{
    postgresql: boolean;
    influxdb: boolean;
    overall: boolean;
  }> {
    const health = {
      postgresql: false,
      influxdb: false,
      overall: false,
    };

    try {
      // Check PostgreSQL repositories
      health.postgresql = await this.monitors.healthCheck();
    } catch (error) {
      logger.error('PostgreSQL repository health check failed:', error);
    }

    try {
      // Check InfluxDB repository
      health.influxdb = await this.checkResults.healthCheck();
    } catch (error) {
      logger.error('InfluxDB repository health check failed:', error);
    }

    health.overall = health.postgresql && health.influxdb;

    return health;
  }

  /**
   * Execute a transaction across PostgreSQL repositories
   */
  async executeTransaction<T>(
    operation: (repositories: {
      monitors: MonitorRepository;
      alerts: AlertRepository;
      tenants: TenantRepository;
    }) => Promise<T>
  ): Promise<T> {
    const client = await this.pgPool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create repository instances with the transaction client
      const transactionRepositories = {
        monitors: new MonitorRepository(this.pgPool, this.options),
        alerts: new AlertRepository(this.pgPool, this.options),
        tenants: new TenantRepository(this.pgPool, this.options),
      };

      const result = await operation(transactionRepositories);
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Repository transaction failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get repository statistics
   */
  async getStats(): Promise<{
    tenants: number;
    monitors: number;
    alerts: number;
    activeAlerts: number;
    checksToday: number;
  }> {
    try {
      // Get tenant count
      const { total: tenants } = await this.tenants.findMany({}, { limit: 0 });

      // Get monitor count
      const { total: monitors } = await this.monitors.findMany({}, { limit: 0 });

      // Get alert counts
      const { total: alerts } = await this.alerts.findMany({}, { limit: 0 });
      const activeAlerts = (await this.alerts.findActive()).length;

      // Get today's check count (approximate from InfluxDB)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // This is a simplified count - in practice you'd query InfluxDB for actual count
      const checksToday = 0; // Placeholder

      return {
        tenants,
        monitors,
        alerts,
        activeAlerts,
        checksToday,
      };
    } catch (error) {
      logger.error('Failed to get repository stats:', error);
      throw error;
    }
  }
}

/**
 * Create Repository Manager from Database Manager
 */
export function createRepositoryManager(
  influxBucket: string,
  options?: RepositoryOptions
): RepositoryManager {
  const dbManager = getDatabaseManager();
  
  return new RepositoryManager(
    dbManager.getPostgreSQLPool(),
    dbManager.getInfluxWriteApi(),
    dbManager.getInfluxQueryApi(),
    influxBucket,
    options
  );
}

// Singleton instance
let repositoryManager: RepositoryManager | null = null;

/**
 * Initialize global repository manager
 */
export function initializeRepositoryManager(
  influxBucket: string,
  options?: RepositoryOptions
): RepositoryManager {
  if (repositoryManager) {
    throw new Error('Repository manager already initialized');
  }
  
  repositoryManager = createRepositoryManager(influxBucket, options);
  logger.info('Repository manager initialized');
  
  return repositoryManager;
}

/**
 * Get global repository manager
 */
export function getRepositoryManager(): RepositoryManager {
  if (!repositoryManager) {
    throw new Error('Repository manager not initialized');
  }
  return repositoryManager;
}
