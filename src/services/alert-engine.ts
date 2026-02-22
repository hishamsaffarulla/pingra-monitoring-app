/**
 * Alert Engine Service
 * Processes check results to determine alert conditions and manage notifications
 */

import { CheckResult, Alert, AlertType, AlertDecision, ProbeLocation, Monitor } from '../types';
import { AlertRepository } from '../database/repositories/alert-repository';
import { CheckResultRepository } from '../database/repositories/check-result-repository';
import { MonitorRepository } from '../database/repositories/monitor-repository';
import { IncidentRepository } from '../database/repositories/incident-repository';
import { IntegrationRepository } from '../database/repositories/integration-repository';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { ContactListRepository, ContactListMemberRecord } from '../database/repositories/contact-list-repository';
import { RedisSetup } from '../database/redis-setup';
import { logger } from '../utils/logger';
import { NotificationService } from './notification-service';
import { resolveSmtpConfig } from '../utils/smtp-config';
import axios from 'axios';
import dns from 'dns/promises';

type AlertTriggerMode = 'all' | 'any';

export interface AlertEngineConfig {
  defaultFailureThreshold: number;
  sslWarningDays: number;
  sslCriticalDays: number;
  alertStateTTL: number; // seconds
  alertTriggerMode: AlertTriggerMode;
}

export interface AlertState {
  monitorId: string;
  consecutiveFailures: number;
  failedLocations: ProbeLocation[];
  lastFailureTime: Date;
  isInFailureState: boolean;
  lastAlertId?: string;
  lastAlertType?: AlertType;
  lastAlertTime?: Date;
}

export class AlertEngine {
  private alertRepository: AlertRepository;
  private monitorRepository: MonitorRepository;
  private incidentRepository: IncidentRepository | undefined;
  private redis: RedisSetup;
  private config: AlertEngineConfig;
  private notificationService: NotificationService | undefined;
  private integrationRepository: IntegrationRepository | undefined;
  private contactListRepository: ContactListRepository | undefined;
  private settingsRepository: SettingsRepository | undefined;

  constructor(
    alertRepository: AlertRepository,
    _checkResultRepository: CheckResultRepository,
    monitorRepository: MonitorRepository,
    redis: RedisSetup,
    config: AlertEngineConfig,
    notificationService?: NotificationService,
    integrationRepository?: IntegrationRepository,
    contactListRepository?: ContactListRepository,
    incidentRepository?: IncidentRepository,
    settingsRepository?: SettingsRepository
  ) {
    this.alertRepository = alertRepository;
    // checkResultRepository is available for future use
    this.monitorRepository = monitorRepository;
    this.redis = redis;
    this.config = config;
    this.notificationService = notificationService;
    this.integrationRepository = integrationRepository;
    this.contactListRepository = contactListRepository;
    this.incidentRepository = incidentRepository;
    this.settingsRepository = settingsRepository;
  }

  /**
   * Process a check result and determine if alerts should be triggered
   */
  async processCheckResult(result: CheckResult): Promise<void> {
    try {
      logger.debug('Processing check result for alerting:', {
        monitorId: result.monitorId,
        location: result.location,
        success: result.success,
      });

      // Get monitor configuration
      const monitor = await this.monitorRepository.findById(result.monitorId);
      if (!monitor) {
        logger.warn('Monitor not found for check result:', { monitorId: result.monitorId });
        return;
      }

      // Get current alert state from Redis
      const alertState = await this.getAlertState(result.monitorId);

      // Update failure tracking
      await this.updateFailureTracking(result, monitor, alertState);

      // Evaluate alert conditions
      const decision = await this.evaluateFailureConditions(result.monitorId);

      // Handle failure alerts
      if (decision.shouldAlert && decision.alertType === AlertType.FAILURE) {
        await this.triggerFailureAlert(monitor, decision, result);
      }

      // Handle recovery alerts
      const shouldRecover =
        this.config.alertTriggerMode === 'any'
          ? result.success && alertState.isInFailureState && alertState.failedLocations.length === 0
          : result.success && alertState.isInFailureState;
      if (shouldRecover) {
        await this.triggerRecoveryAlert(monitor, alertState);
      }

      // Handle SSL certificate alerts
      if (result.sslExpiryDate) {
        await this.evaluateSSLAlerts(monitor, result.sslExpiryDate);
      }
    } catch (error) {
      logger.error('Failed to process check result for alerting:', {
        error,
        monitorId: result.monitorId,
      });
      throw error;
    }
  }

  /**
   * Evaluate failure conditions for a monitor
   */
  async evaluateFailureConditions(monitorId: string): Promise<AlertDecision> {
    try {
      const monitor = await this.monitorRepository.findById(monitorId);
      if (!monitor) {
        throw new Error(`Monitor not found: ${monitorId}`);
      }

      const alertState = await this.getAlertState(monitorId);
      const failureThreshold = monitor.failureThreshold || this.config.defaultFailureThreshold;
      const triggerMode = this.config.alertTriggerMode;

      // Check if we've reached the failure threshold
      const shouldAlert = 
        alertState.consecutiveFailures >= failureThreshold &&
        !alertState.isInFailureState;

      // Determine if alert condition is met based on configured trigger mode
      const hasFailedLocations = alertState.failedLocations.length > 0;
      const allLocationsFailing = alertState.failedLocations.length === monitor.probeLocations.length;
      const triggerConditionMet = triggerMode === 'any' ? hasFailedLocations : allLocationsFailing;

      return {
        shouldAlert: shouldAlert && triggerConditionMet,
        alertType: AlertType.FAILURE,
        consecutiveFailures: alertState.consecutiveFailures,
        affectedLocations: alertState.failedLocations,
      };
    } catch (error) {
      logger.error('Failed to evaluate failure conditions:', { error, monitorId });
      throw error;
    }
  }

  /**
   * Update failure tracking in Redis
   */
  private async updateFailureTracking(
    result: CheckResult,
    monitor: Monitor,
    alertState: AlertState
  ): Promise<void> {
    const counterKey = `failure:${result.monitorId}:${result.location}`;
    const triggerMode = this.config.alertTriggerMode;

    if (!result.success) {
      // Increment failure counter for this location
      await this.redis.incrementCounter(counterKey, 3600); // 1 hour TTL

      // Update failed locations set
      if (!alertState.failedLocations.includes(result.location)) {
        alertState.failedLocations.push(result.location);
      }

      // Increment consecutive failures based on trigger mode
      if (triggerMode === 'any') {
        alertState.consecutiveFailures++;
        alertState.lastFailureTime = result.timestamp;
      } else {
        // "all" mode increments only when all locations fail
        const allLocationsFailing =
          alertState.failedLocations.length === monitor.probeLocations.length;
        if (allLocationsFailing) {
          alertState.consecutiveFailures++;
          alertState.lastFailureTime = result.timestamp;
        }
      }
    } else {
      // Success - reset failure tracking for this location
      await this.redis.resetCounter(counterKey);

      // Remove location from failed locations
      alertState.failedLocations = alertState.failedLocations.filter(
        loc => loc !== result.location
      );

      // Reset consecutive failures when recovery condition is met for trigger mode
      if (triggerMode === 'any') {
        if (alertState.failedLocations.length === 0) {
          alertState.consecutiveFailures = 0;
        }
      } else {
        if (alertState.failedLocations.length < monitor.probeLocations.length) {
          alertState.consecutiveFailures = 0;
        }
      }
    }

    // Save updated alert state
    await this.saveAlertState(alertState);
  }

  /**
   * Trigger a failure alert
   */
  private async triggerFailureAlert(
    monitor: Monitor,
    decision: AlertDecision,
    result: CheckResult
  ): Promise<void> {
    try {
      // Check if we already have an active failure alert
      const activeAlerts = await this.alertRepository.findActive(monitor.id);
      const hasActiveFailureAlert = activeAlerts.some(
        alert => alert.type === AlertType.FAILURE
      );

      if (hasActiveFailureAlert) {
        logger.debug('Failure alert already active, skipping duplicate:', {
          monitorId: monitor.id,
        });
        return;
      }

      // Create failure alert
      const alert = await this.alertRepository.create({
        monitorId: monitor.id,
        type: AlertType.FAILURE,
        triggeredAt: new Date(),
        consecutiveFailures: decision.consecutiveFailures,
        message: this.generateFailureMessage(monitor, decision),
        notificationStatus: {},
      });

      // Update alert state
      const alertState = await this.getAlertState(monitor.id);
      alertState.isInFailureState = true;
      alertState.lastAlertId = alert.id;
      alertState.lastAlertType = AlertType.FAILURE;
      alertState.lastAlertTime = alert.triggeredAt;
      await this.saveAlertState(alertState);

      logger.info('Failure alert triggered:', {
        alertId: alert.id,
        monitorId: monitor.id,
        consecutiveFailures: decision.consecutiveFailures,
        affectedLocations: decision.affectedLocations,
      });

      await this.dispatchNotifications(monitor, alert);

      await this.createIncidentForFailure(monitor, decision, result, alert.id);
    } catch (error) {
      logger.error('Failed to trigger failure alert:', {
        error,
        monitorId: monitor.id,
      });
      throw error;
    }
  }

  /**
   * Trigger a recovery alert
   */
  private async triggerRecoveryAlert(monitor: Monitor, alertState: AlertState): Promise<void> {
    try {
      // Check if we already have a recent recovery alert
      const recentAlerts = await this.alertRepository.findByMonitor(monitor.id, {
        limit: 1,
        direction: 'DESC',
      });

      if (recentAlerts.length > 0 && recentAlerts[0]!.type === AlertType.RECOVERY) {
        logger.debug('Recovery alert already sent, skipping duplicate:', {
          monitorId: monitor.id,
        });
        return;
      }

      // Create recovery alert
      const alert = await this.alertRepository.create({
        monitorId: monitor.id,
        type: AlertType.RECOVERY,
        triggeredAt: new Date(),
        consecutiveFailures: 0,
        message: this.generateRecoveryMessage(monitor, alertState),
        notificationStatus: {},
      });

      // Resolve all active failure alerts
      await this.alertRepository.resolveAllForMonitor(monitor.id);

      // Reset alert state
      alertState.isInFailureState = false;
      alertState.consecutiveFailures = 0;
      alertState.failedLocations = [];
      alertState.lastAlertId = alert.id;
      alertState.lastAlertType = AlertType.RECOVERY;
      alertState.lastAlertTime = alert.triggeredAt;
      await this.saveAlertState(alertState);

      logger.info('Recovery alert triggered:', {
        alertId: alert.id,
        monitorId: monitor.id,
      });

      await this.dispatchNotifications(monitor, alert);

      await this.resolveIncidentForRecovery(monitor);
    } catch (error) {
      logger.error('Failed to trigger recovery alert:', {
        error,
        monitorId: monitor.id,
      });
      throw error;
    }
  }

  /**
   * Evaluate SSL certificate alerts
   */
  private async evaluateSSLAlerts(monitor: Monitor, sslExpiryDate: Date): Promise<void> {
    try {
      const now = new Date();
      const daysUntilExpiry = Math.floor(
        (sslExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check for critical alert (7 days)
      if (daysUntilExpiry <= this.config.sslCriticalDays) {
        await this.triggerSSLAlert(
          monitor,
          AlertType.SSL_CRITICAL,
          daysUntilExpiry,
          sslExpiryDate
        );
      }
      // Check for warning alert (30 days)
      else if (daysUntilExpiry <= this.config.sslWarningDays) {
        await this.triggerSSLAlert(
          monitor,
          AlertType.SSL_WARNING,
          daysUntilExpiry,
          sslExpiryDate
        );
      }
    } catch (error) {
      logger.error('Failed to evaluate SSL alerts:', {
        error,
        monitorId: monitor.id,
      });
      throw error;
    }
  }

  /**
   * Trigger an SSL certificate alert
   */
  private async triggerSSLAlert(
    monitor: Monitor,
    alertType: AlertType,
    daysUntilExpiry: number,
    expiryDate: Date
  ): Promise<void> {
    try {
      // Check if we already have a recent SSL alert of this type
      const recentAlerts = await this.alertRepository.findByMonitor(monitor.id, {
        limit: 5,
        direction: 'DESC',
      });

      const hasRecentSSLAlert = recentAlerts.some(
        alert => 
          alert.type === alertType &&
          alert.triggeredAt.getTime() > Date.now() - 24 * 60 * 60 * 1000 // Last 24 hours
      );

      if (hasRecentSSLAlert) {
        logger.debug('SSL alert already sent recently, skipping duplicate:', {
          monitorId: monitor.id,
          alertType,
        });
        return;
      }

      // Create SSL alert
      const alert = await this.alertRepository.create({
        monitorId: monitor.id,
        type: alertType,
        triggeredAt: new Date(),
        consecutiveFailures: 0,
        message: this.generateSSLMessage(monitor, alertType, daysUntilExpiry, expiryDate),
        notificationStatus: {},
      });

      logger.info('SSL alert triggered:', {
        alertId: alert.id,
        monitorId: monitor.id,
        alertType,
        daysUntilExpiry,
      });

      await this.dispatchNotifications(monitor, alert);
    } catch (error) {
      logger.error('Failed to trigger SSL alert:', {
        error,
        monitorId: monitor.id,
        alertType,
      });
      throw error;
    }
  }

  /**
   * Get alert state from Redis
   */
  private async getAlertState(monitorId: string): Promise<AlertState> {
    const state = await this.redis.getAlertState(monitorId);

    if (state) {
      // Parse dates
      if (state.lastFailureTime) {
        state.lastFailureTime = new Date(state.lastFailureTime);
      }
      if (state.lastAlertTime) {
        state.lastAlertTime = new Date(state.lastAlertTime);
      }
      return state;
    }

    // Return default state
    return {
      monitorId,
      consecutiveFailures: 0,
      failedLocations: [],
      lastFailureTime: new Date(),
      isInFailureState: false,
    };
  }

  /**
   * Save alert state to Redis
   */
  private async saveAlertState(state: AlertState): Promise<void> {
    await this.redis.setAlertState(state.monitorId, state);
  }

  /**
   * Generate failure alert message
   */
  private generateFailureMessage(monitor: Monitor, decision: AlertDecision): string {
    const locations = decision.affectedLocations.join(', ');
    const scope = this.config.alertTriggerMode === 'all' ? 'across all locations' : 'in one or more locations';
    return `Monitor "${monitor.name}" (${monitor.url}) has failed ${decision.consecutiveFailures} consecutive times ${scope} (${locations}).`;
  }

  /**
   * Generate recovery alert message
   */
  private generateRecoveryMessage(monitor: Monitor, alertState: AlertState): string {
    const downtime = alertState.lastFailureTime
      ? Math.floor((Date.now() - alertState.lastFailureTime.getTime()) / (1000 * 60))
      : 0;
    return `Monitor "${monitor.name}" (${monitor.url}) has recovered after ${downtime} minutes of downtime.`;
  }

  /**
   * Generate SSL alert message
   */
  private generateSSLMessage(
    monitor: Monitor,
    alertType: AlertType,
    daysUntilExpiry: number,
    expiryDate: Date
  ): string {
    const severity = alertType === AlertType.SSL_CRITICAL ? 'CRITICAL' : 'WARNING';
    return `${severity}: SSL certificate for "${monitor.name}" (${monitor.url}) expires in ${daysUntilExpiry} days (${expiryDate.toISOString()}).`;
  }

  private async createIncidentForFailure(
    monitor: Monitor,
    decision: AlertDecision,
    result: CheckResult,
    alertId: string
  ): Promise<void> {
    if (!this.incidentRepository) {
      return;
    }

    const tenantId = monitor.tenantId;
    const existing = await this.incidentRepository.findMany({ tenantId, status: 'active' });
    const activeForMonitor = existing.find(
      incident => incident.monitorId === monitor.id && incident.status !== 'resolved'
    );

    if (activeForMonitor) {
      return;
    }

    const rootCause = result.errorMessage || 'Endpoint unreachable or unexpected response';
    const statusCode = result.statusCode ? String(result.statusCode) : 'N/A';
    const locations = decision.affectedLocations.length > 0
      ? decision.affectedLocations.join(', ')
      : (result.location || 'unknown');
    const failedIp = await this.resolveFailedIp(monitor.url);

    const description = [
      `Root Cause: ${rootCause}`,
      `Status Code: ${statusCode}`,
      `Failed IP: ${failedIp}`,
      `Affected Regions: ${locations}`,
      `Alert ID: ${alertId}`,
    ].join('\n');

    const incident = await this.incidentRepository.create({
      tenantId,
      monitorId: monitor.id,
      title: `Monitor down: ${monitor.name}`,
      description,
      severity: 'high',
      status: 'investigating',
    });

    await this.incidentRepository.addUpdate(
      incident.id,
      'investigating',
      `Automatic incident created. Root cause: ${rootCause}. Status: ${statusCode}. Failed IP: ${failedIp}. Regions: ${locations}.`
    );
  }

  private async resolveFailedIp(url: string): Promise<string> {
    try {
      const hostname = new URL(url).hostname;
      const resolved = await dns.lookup(hostname);
      return resolved.address || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  private async resolveIncidentForRecovery(monitor: Monitor): Promise<void> {
    if (!this.incidentRepository) {
      return;
    }

    const tenantId = monitor.tenantId;
    const existing = await this.incidentRepository.findMany({ tenantId, status: 'active' });
    const activeForMonitor = existing.find(
      incident => incident.monitorId === monitor.id && incident.status !== 'resolved'
    );

    if (!activeForMonitor) {
      return;
    }

    const resolved = await this.incidentRepository.update(activeForMonitor.id, tenantId, {
      status: 'resolved',
      resolvedAt: new Date(),
    });

    if (resolved) {
      await this.incidentRepository.addUpdate(resolved.id, 'resolved', 'Automatic recovery detected.');
    }
  }

  private async dispatchNotifications(monitor: Monitor, alert: Alert): Promise<void> {
    try {
      const tenantId = monitor.tenantId;
      const members = this.contactListRepository
        ? await this.contactListRepository.findEnabledMembersByTenant(tenantId)
        : [];
      const emailRecipients = this.getUniqueContactsByType(members, 'email');
      const phoneRecipients = this.getUniqueContactsByType(members, 'phone');
      const settings = this.settingsRepository
        ? await this.settingsRepository.getSettings(tenantId)
        : null;
      const tenantSmtpConfig = settings ? resolveSmtpConfig(settings.config || {}) : null;

      if (!this.integrationRepository) {
        return;
      }

      const integrations = await this.integrationRepository.findMany(tenantId);
      const activeIntegrations = integrations.filter(integration => integration.enabled);

      if (this.notificationService) {
        const channels = this.buildContactChannelsFromIntegrations(
          activeIntegrations,
          emailRecipients,
          phoneRecipients,
          tenantId,
          tenantSmtpConfig
        );

        if (channels.length > 0) {
          await this.notificationService.sendToMultipleChannels(alert, channels as any);
        }
      }

      for (const integration of activeIntegrations) {
        if (integration.type === 'jira') {
          await this.sendJiraIssue(integration, alert, monitor);
        }
      }
    } catch (error) {
      logger.error('Failed to dispatch notifications', { error, monitorId: monitor.id });
    }
  }

  private getUniqueContactsByType(
    members: ContactListMemberRecord[],
    channelType: 'email' | 'phone'
  ): string[] {
    const set = new Set<string>();
    for (const member of members) {
      if (member.channelType !== channelType) continue;
      const value = (member.contact || '').trim();
      if (!value) continue;
      set.add(value);
    }
    return Array.from(set);
  }

  private buildContactChannelsFromIntegrations(
    integrations: any[],
    emailRecipients: string[],
    phoneRecipients: string[],
    tenantId: string,
    tenantSmtpConfig: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password: string;
      from: string;
    } | null
  ): any[] {
    const channels: any[] = [];

    for (const integration of integrations) {
      const type = (integration.type || '').toLowerCase();
      const config = integration.configuration || {};

      if (type === 'email' || type === 'sendgrid') {
        for (const email of emailRecipients) {
          channels.push({
            id: `dyn-email-${integration.id}-${email}`,
            tenantId,
            name: `${integration.name}:${email}`,
            type: 'email',
            enabled: true,
            createdAt: new Date(),
            configuration: {
              to: email,
              from: config.fromEmail || config.from || tenantSmtpConfig?.from || process.env['SMTP_FROM'],
              host: config.host || tenantSmtpConfig?.host || process.env['SMTP_HOST'],
              port: config.port || tenantSmtpConfig?.port || process.env['SMTP_PORT'],
              username: config.username || tenantSmtpConfig?.username || process.env['SMTP_USER'],
              password: config.password || tenantSmtpConfig?.password || process.env['SMTP_PASS'],
              secure: config.secure ?? tenantSmtpConfig?.secure ?? process.env['SMTP_SECURE'] === 'true',
            },
          });
        }
      }

      if (type === 'twilio') {
        for (const phone of phoneRecipients) {
          channels.push({
            id: `dyn-sms-${integration.id}-${phone}`,
            tenantId,
            name: `${integration.name}:${phone}`,
            type: 'sms',
            enabled: true,
            createdAt: new Date(),
            configuration: {
              phoneNumber: phone,
              provider: config.provider || 'twilio',
              accountSid: config.accountSid || process.env['SMS_ACCOUNT_SID'] || process.env['TWILIO_ACCOUNT_SID'],
              authToken: config.authToken || config.apiKey || process.env['SMS_AUTH_TOKEN'] || process.env['TWILIO_AUTH_TOKEN'],
              fromNumber: config.fromNumber || integration.endpoint || process.env['SMS_FROM'] || process.env['TWILIO_FROM_NUMBER'],
            },
          });
        }
      }

      if (type === 'call' || type === 'voice') {
        const provider = String(config.provider || 'twilio').toLowerCase();
        for (const phone of phoneRecipients) {
          if (provider === 'asterisk' || provider === 'freepbx') {
            channels.push({
              id: `dyn-voice-${integration.id}-${phone}`,
              tenantId,
              name: `${integration.name}:${phone}`,
              type: 'voice',
              enabled: true,
              createdAt: new Date(),
              configuration: {
                phoneNumber: phone,
                provider,
                apiUrl: config.apiUrl || integration.endpoint,
                endpoint: config.apiUrl || integration.endpoint,
                apiToken: config.apiToken || process.env['VOICE_API_TOKEN'],
                method: config.method || 'POST',
              },
            });
            continue;
          }

          channels.push({
            id: `dyn-voice-${integration.id}-${phone}`,
            tenantId,
            name: `${integration.name}:${phone}`,
            type: 'voice',
            enabled: true,
            createdAt: new Date(),
            configuration: {
              phoneNumber: phone,
              provider,
              accountSid: config.accountSid || process.env['VOICE_ACCOUNT_SID'] || process.env['TWILIO_ACCOUNT_SID'],
              authToken: config.authToken || config.key || config.apiKey || process.env['VOICE_AUTH_TOKEN'] || process.env['TWILIO_AUTH_TOKEN'],
              fromNumber: config.fromNumber || integration.endpoint || process.env['VOICE_FROM'] || process.env['TWILIO_FROM_NUMBER'],
            },
          });
        }
      }

      if (['slack', 'teams', 'discord', 'webhook', 'zapier'].includes(type)) {
        const endpoint = (integration.endpoint || '').trim();
        if (!endpoint) continue;

        let format = 'slack';
        if (type === 'teams') format = 'teams';
        if (type === 'discord') format = 'discord';

        channels.push({
          id: `dyn-webhook-${integration.id}`,
          tenantId,
          name: integration.name,
          type: 'webhook',
          enabled: true,
          createdAt: new Date(),
          configuration: {
            url: endpoint,
            format,
            headers: config.headers || {},
          },
        });
      }
    }

    return channels;
  }

  private async sendJiraIssue(integration: any, alert: Alert, monitor: Monitor): Promise<void> {
    const config = integration.configuration || {};
    const baseUrl = config.baseUrl || integration.endpoint;
    const email = config.email;
    const token = config.token;
    const projectKey = config.projectKey;
    const issueType = config.issueType || 'Incident';

    if (!baseUrl || !email || !token || !projectKey) {
      logger.warn('Jira integration missing configuration', { integrationId: integration.id });
      return;
    }

    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`;

    const summary = `[${alert.type.toUpperCase()}] ${monitor.name} - ${alert.message}`.slice(0, 255);
    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: alert.message }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Monitor: ${monitor.name} (${monitor.url})` }],
        },
      ],
    };

    await axios.post(url, {
      fields: {
        project: { key: projectKey },
        summary,
        description,
        issuetype: { name: issueType },
      },
    }, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * Get alert history for a monitor
   */
  async getAlertHistory(
    monitorId: string,
    limit: number = 50
  ): Promise<Alert[]> {
    return this.alertRepository.findByMonitor(monitorId, { limit, direction: 'DESC' });
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(monitorId?: string): Promise<Alert[]> {
    return this.alertRepository.findActive(monitorId);
  }

  /**
   * Manually resolve an alert
   */
  async resolveAlert(alertId: string): Promise<Alert | null> {
    return this.alertRepository.resolve(alertId);
  }

  /**
   * Get alert statistics
   */
  async getAlertStats(
    monitorId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    byType: Record<string, number>;
    resolved: number;
    unresolved: number;
    averageResolutionTime: number;
  }> {
    return this.alertRepository.getStats(monitorId, startDate, endDate);
  }
}
