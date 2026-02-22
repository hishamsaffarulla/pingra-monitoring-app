/**
 * Notification Service - Handles multi-channel alert delivery
 */

import { Alert, NotificationChannel, NotificationResult } from '../types';
import { logger } from '../utils/logger';
import { NotificationRepository } from '../database/repositories/notification-repository';
import { NotificationRetryService } from './notification-retry-service';
import axios from 'axios';
import nodemailer from 'nodemailer';

// ============================================================================
// BASE NOTIFICATION CHANNEL INTERFACE
// ============================================================================

export interface NotificationChannelHandler {
  send(alert: Alert, channel: NotificationChannel): Promise<NotificationResult>;
  validate(configuration: Record<string, any>): boolean;
}

// ============================================================================
// EMAIL NOTIFICATION CHANNEL
// ============================================================================

export class EmailNotificationChannel implements NotificationChannelHandler {
  async send(alert: Alert, channel: NotificationChannel): Promise<NotificationResult> {
    const startTime = new Date();
    
    try {
      const config = channel.configuration;
      
      // Validate required SMTP configuration
      if (!this.validate(config)) {
        throw new Error('Invalid email configuration');
      }

      // In a real implementation, this would use nodemailer or similar
      // For now, we'll simulate the email sending
      logger.info('Sending email notification', {
        channelId: channel.id,
        alertType: alert.type,
        to: config['to'],
        subject: this.buildSubject(alert)
      });

      // Simulate email sending (in production, use nodemailer)
      await this.sendEmail(config, alert);

      return {
        channelId: channel.id,
        success: true,
        deliveredAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send email notification', {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        channelId: channel.id,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        deliveredAt: startTime
      };
    }
  }

  validate(configuration: Record<string, any>): boolean {
    const config = this.getSmtpConfig(configuration);
    return !!(config['host'] && config['port'] && config['from'] && config['username'] && config['password'] && config['to']);
  }

  private buildSubject(alert: Alert): string {
    switch (alert.type) {
      case 'failure':
        return `[ALERT] Monitor Down: ${alert.monitorId}`;
      case 'recovery':
        return `[RECOVERY] Monitor Up: ${alert.monitorId}`;
      case 'ssl_warning':
        return `[WARNING] SSL Certificate Expiring Soon: ${alert.monitorId}`;
      case 'ssl_critical':
        return `[CRITICAL] SSL Certificate Expiring: ${alert.monitorId}`;
      default:
        return `[ALERT] Monitor Alert: ${alert.monitorId}`;
    }
  }

  private getSmtpConfig(configuration: Record<string, any>): Record<string, any> {
    return {
      host: configuration['host'] || process.env['SMTP_HOST'],
      port: configuration['port'] || process.env['SMTP_PORT'],
      secure: configuration['secure'] ?? process.env['SMTP_SECURE'] === 'true',
      username: configuration['username'] || process.env['SMTP_USER'],
      password: configuration['password'] || process.env['SMTP_PASS'],
      from: configuration['from'] || process.env['SMTP_FROM'],
      to: configuration['to'] || configuration['recipients'],
    };
  }

  private buildHtmlBody(alert: Alert): string {
    return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>${this.buildSubject(alert)}</h2>
        <p>${alert.message}</p>
        <ul>
          <li><strong>Monitor ID:</strong> ${alert.monitorId}</li>
          <li><strong>Alert Type:</strong> ${alert.type}</li>
          <li><strong>Triggered At:</strong> ${alert.triggeredAt.toISOString()}</li>
        </ul>
      </div>
    `;
  }

  private async sendEmail(configInput: Record<string, any>, alert: Alert): Promise<void> {
    const config = this.getSmtpConfig(configInput);
    const toValue = Array.isArray(config['to']) ? config['to'].join(',') : config['to'];

    const transporter = nodemailer.createTransport({
      host: config['host'],
      port: Number(config['port']),
      secure: !!config['secure'],
      auth: {
        user: config['username'],
        pass: config['password'],
      },
    });

    await transporter.sendMail({
      from: config['from'],
      to: toValue,
      subject: this.buildSubject(alert),
      text: alert.message,
      html: this.buildHtmlBody(alert),
    });
  }
}

// ============================================================================
// WEBHOOK NOTIFICATION CHANNEL (Slack/Teams)
// ============================================================================

export class WebhookNotificationChannel implements NotificationChannelHandler {
  async send(alert: Alert, channel: NotificationChannel): Promise<NotificationResult> {
    const startTime = new Date();
    
    try {
      const config = channel.configuration;
      
      if (!this.validate(config)) {
        throw new Error('Invalid webhook configuration');
      }

      const payload = this.buildPayload(alert, config['format'] || 'slack');

      logger.info('Sending webhook notification', {
        channelId: channel.id,
        alertType: alert.type,
        url: config['url']
      });

      const response = await axios.post(config['url'], payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(config['headers'] || {})
        },
        timeout: 10000
      });

      if (response.status >= 200 && response.status < 300) {
        return {
          channelId: channel.id,
          success: true,
          deliveredAt: new Date()
        };
      } else {
        throw new Error(`Webhook returned status ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send webhook notification', {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        channelId: channel.id,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        deliveredAt: startTime
      };
    }
  }

  validate(configuration: Record<string, any>): boolean {
    return !!(configuration['url'] && this.isValidUrl(configuration['url']));
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private buildPayload(alert: Alert, format: string): Record<string, any> {
    if (format === 'teams') {
      return this.buildTeamsPayload(alert);
    }
    return this.buildSlackPayload(alert);
  }

  private buildSlackPayload(alert: Alert): Record<string, any> {
    const color = this.getAlertColor(alert.type);
    const emoji = this.getAlertEmoji(alert.type);

    return {
      text: `${emoji} ${alert.message}`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Monitor ID',
              value: alert.monitorId,
              short: true
            },
            {
              title: 'Alert Type',
              value: alert.type,
              short: true
            },
            {
              title: 'Triggered At',
              value: alert.triggeredAt.toISOString(),
              short: true
            },
            ...(alert.consecutiveFailures > 0 ? [{
              title: 'Consecutive Failures',
              value: alert.consecutiveFailures.toString(),
              short: true
            }] : [])
          ]
        }
      ]
    };
  }

  private buildTeamsPayload(alert: Alert): Record<string, any> {
    const color = this.getAlertColor(alert.type);

    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: alert.message,
      themeColor: color,
      title: `Monitor Alert: ${alert.type}`,
      sections: [
        {
          facts: [
            {
              name: 'Monitor ID',
              value: alert.monitorId
            },
            {
              name: 'Alert Type',
              value: alert.type
            },
            {
              name: 'Triggered At',
              value: alert.triggeredAt.toISOString()
            },
            ...(alert.consecutiveFailures > 0 ? [{
              name: 'Consecutive Failures',
              value: alert.consecutiveFailures.toString()
            }] : [])
          ]
        }
      ]
    };
  }

  private getAlertColor(alertType: string): string {
    switch (alertType) {
      case 'failure':
      case 'ssl_critical':
        return '#FF0000'; // Red
      case 'ssl_warning':
        return '#FFA500'; // Orange
      case 'recovery':
        return '#00FF00'; // Green
      default:
        return '#808080'; // Gray
    }
  }

  private getAlertEmoji(alertType: string): string {
    switch (alertType) {
      case 'failure':
        return '🔴';
      case 'recovery':
        return '✅';
      case 'ssl_warning':
        return '⚠️';
      case 'ssl_critical':
        return '🚨';
      default:
        return '📢';
    }
  }
}

// ============================================================================
// SMS NOTIFICATION CHANNEL (STUB)
// ============================================================================

export class SmsNotificationChannel implements NotificationChannelHandler {
  async send(alert: Alert, channel: NotificationChannel): Promise<NotificationResult> {
    const startTime = new Date();
    
    try {
      const config = channel.configuration;
      
      if (!this.validate(config)) {
        throw new Error('Invalid SMS configuration');
      }

      logger.info('Sending SMS notification', {
        channelId: channel.id,
        alertType: alert.type,
        to: config['phoneNumber']
      });

      await this.sendSms(config, alert);

      return {
        channelId: channel.id,
        success: true,
        deliveredAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send SMS notification', {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        channelId: channel.id,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        deliveredAt: startTime
      };
    }
  }

  validate(configuration: Record<string, any>): boolean {
    const provider = String(configuration['provider'] || '').toLowerCase();
    if (provider !== 'twilio') return false;
    return !!(
      configuration['phoneNumber'] &&
      configuration['accountSid'] &&
      configuration['authToken'] &&
      configuration['fromNumber']
    );
  }

  private async sendSms(config: Record<string, any>, alert: Alert): Promise<void> {
    const provider = String(config['provider'] || '').toLowerCase();
    if (provider !== 'twilio') {
      throw new Error(`Unsupported SMS provider: ${provider || 'unknown'}`);
    }

    const sid = String(config['accountSid'] || '').trim();
    const token = String(config['authToken'] || '').trim();
    const from = String(config['fromNumber'] || '').trim();
    const to = String(config['phoneNumber'] || '').trim();
    if (!sid || !token || !from || !to) {
      throw new Error('Twilio SMS config is incomplete');
    }

    const body = `[${alert.type.toUpperCase()}] ${alert.message}`.slice(0, 1500);
    const params = new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    });

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      params.toString(),
      {
        auth: { username: sid, password: token },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
  }
}

// ============================================================================
// VOICE NOTIFICATION CHANNEL (STUB)
// ============================================================================

export class VoiceNotificationChannel implements NotificationChannelHandler {
  async send(alert: Alert, channel: NotificationChannel): Promise<NotificationResult> {
    const startTime = new Date();
    
    try {
      const config = channel.configuration;
      
      if (!this.validate(config)) {
        throw new Error('Invalid voice configuration');
      }

      logger.info('Sending voice notification', {
        channelId: channel.id,
        alertType: alert.type,
        to: config['phoneNumber']
      });

      await this.sendVoiceCall(config, alert);

      return {
        channelId: channel.id,
        success: true,
        deliveredAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send voice notification', {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        channelId: channel.id,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        deliveredAt: startTime
      };
    }
  }

  validate(configuration: Record<string, any>): boolean {
    const provider = String(configuration['provider'] || '').toLowerCase();
    if (provider === 'twilio') {
      return !!(
        configuration['phoneNumber'] &&
        configuration['accountSid'] &&
        configuration['authToken'] &&
        configuration['fromNumber']
      );
    }
    if (provider === 'asterisk' || provider === 'freepbx') {
      return !!(
        configuration['phoneNumber'] &&
        (configuration['apiUrl'] || configuration['endpoint'])
      );
    }
    return false;
  }

  private async sendVoiceCall(config: Record<string, any>, alert: Alert): Promise<void> {
    const provider = String(config['provider'] || '').toLowerCase();
    if (provider === 'twilio') {
      const sid = String(config['accountSid'] || '').trim();
      const token = String(config['authToken'] || '').trim();
      const from = String(config['fromNumber'] || '').trim();
      const to = String(config['phoneNumber'] || '').trim();
      if (!sid || !token || !from || !to) {
        throw new Error('Twilio voice config is incomplete');
      }

      const spokenText = `Pingra alert. ${alert.type}. ${alert.message}`.replace(/["<>]/g, '');
      const twiml = `<Response><Say voice="alice">${spokenText}</Say></Response>`;
      const params = new URLSearchParams({
        To: to,
        From: from,
        Twiml: twiml,
      });

      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
        params.toString(),
        {
          auth: { username: sid, password: token },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );
      return;
    }

    if (provider === 'asterisk' || provider === 'freepbx') {
      const apiUrl = String(config['apiUrl'] || config['endpoint'] || '').trim();
      const to = String(config['phoneNumber'] || '').trim();
      const method = String(config['method'] || 'POST').toUpperCase();
      const apiToken = String(config['apiToken'] || '').trim();
      if (!apiUrl || !to) {
        throw new Error('Asterisk/FreePBX voice config is incomplete');
      }

      const payload = {
        to,
        message: alert.message,
        alertType: alert.type,
        monitorId: alert.monitorId,
        triggeredAt: alert.triggeredAt,
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      if (method === 'GET') {
        await axios.get(apiUrl, {
          params: payload,
          headers,
          timeout: 10000,
        });
      } else {
        await axios.post(apiUrl, payload, {
          headers,
          timeout: 10000,
        });
      }
      return;
    }

    throw new Error(`Unsupported voice provider: ${provider || 'unknown'}`);
  }
}

// ============================================================================
// NOTIFICATION SERVICE
// ============================================================================

export class NotificationService {
  private handlers: Map<string, NotificationChannelHandler>;
  private notificationRepository: NotificationRepository | undefined;
  private retryService: NotificationRetryService | undefined;

  constructor(
    notificationRepository?: NotificationRepository,
    retryService?: NotificationRetryService
  ) {
    this.handlers = new Map();
    this.notificationRepository = notificationRepository;
    this.retryService = retryService;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.handlers.set('email', new EmailNotificationChannel());
    this.handlers.set('webhook', new WebhookNotificationChannel());
    this.handlers.set('sms', new SmsNotificationChannel());
    this.handlers.set('voice', new VoiceNotificationChannel());
  }

  async sendNotification(
    alert: Alert,
    channel: NotificationChannel
  ): Promise<NotificationResult> {
    if (!channel.enabled) {
      logger.warn('Notification channel is disabled', { channelId: channel.id });
      return {
        channelId: channel.id,
        success: false,
        errorMessage: 'Channel is disabled',
        deliveredAt: new Date()
      };
    }

    const handler = this.handlers.get(channel.type);
    if (!handler) {
      logger.error('Unknown notification channel type', { type: channel.type });
      return {
        channelId: channel.id,
        success: false,
        errorMessage: `Unknown channel type: ${channel.type}`,
        deliveredAt: new Date()
      };
    }

    const result = await handler.send(alert, channel);

    // Store delivery record if repository is available
    if (this.notificationRepository) {
      try {
        await this.notificationRepository.create(
          alert.id,
          channel.id,
          channel.type,
          result,
          0 // Initial attempt, retry count is 0
        );
      } catch (error) {
        logger.error('Failed to store notification delivery record', {
          alertId: alert.id,
          channelId: channel.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Queue for retry if failed and retry service is available
    if (!result.success && this.retryService) {
      try {
        await this.retryService.queueForRetry(alert, channel, 0);
      } catch (error) {
        logger.error('Failed to queue notification for retry', {
          alertId: alert.id,
          channelId: channel.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return result;
  }

  async sendToMultipleChannels(
    alert: Alert,
    channels: NotificationChannel[]
  ): Promise<NotificationResult[]> {
    const results = await Promise.all(
      channels.map(channel => this.sendNotification(alert, channel))
    );

    const successCount = results.filter(r => r.success).length;
    logger.info('Notification batch completed', {
      alertId: alert.id,
      total: channels.length,
      successful: successCount,
      failed: channels.length - successCount
    });

    return results;
  }

  validateChannelConfiguration(
    type: string,
    configuration: Record<string, any>
  ): boolean {
    const handler = this.handlers.get(type);
    if (!handler) {
      return false;
    }
    return handler.validate(configuration);
  }
}
