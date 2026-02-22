/**
 * Notification Retry Service
 * Handles retry logic for failed notifications with exponential backoff
 */

import { RedisClientType } from 'redis';
import { Alert, NotificationChannel } from '../types';
import { NotificationService } from './notification-service';
import { NotificationRepository } from '../database/repositories/notification-repository';
import { logger } from '../utils/logger';

export interface RetryQueueItem {
  alertId: string;
  channelId: string;
  alert: Alert;
  channel: NotificationChannel;
  retryCount: number;
  nextRetryAt: Date;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class NotificationRetryService {
  private notificationService: NotificationService;
  private notificationRepository: NotificationRepository;
  private redisClient: RedisClientType;
  private config: RetryConfig;
  private retryQueueKey = 'notification:retry:queue';
  private processingIntervalId: NodeJS.Timeout | null = null;

  constructor(
    notificationService: NotificationService,
    notificationRepository: NotificationRepository,
    redisClient: RedisClientType,
    config: Partial<RetryConfig> = {}
  ) {
    this.notificationService = notificationService;
    this.notificationRepository = notificationRepository;
    this.redisClient = redisClient;
    this.config = {
      maxRetries: config.maxRetries || 3,
      initialDelayMs: config.initialDelayMs || 60000, // 1 minute
      maxDelayMs: config.maxDelayMs || 3600000, // 1 hour
      backoffMultiplier: config.backoffMultiplier || 2
    };
  }

  /**
   * Calculate next retry delay using exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, retryCount);
    return Math.min(delay, this.config.maxDelayMs);
  }

  /**
   * Add failed notification to retry queue
   */
  async queueForRetry(
    alert: Alert,
    channel: NotificationChannel,
    retryCount: number = 0
  ): Promise<void> {
    if (retryCount >= this.config.maxRetries) {
      logger.warn('Max retries reached for notification', {
        alertId: alert.id,
        channelId: channel.id,
        retryCount
      });
      return;
    }

    const delay = this.calculateRetryDelay(retryCount);
    const nextRetryAt = new Date(Date.now() + delay);

    const queueItem: RetryQueueItem = {
      alertId: alert.id,
      channelId: channel.id,
      alert,
      channel,
      retryCount,
      nextRetryAt
    };

    try {
      // Store in Redis sorted set with score as timestamp
      await this.redisClient.zAdd(
        this.retryQueueKey,
        {
          score: nextRetryAt.getTime(),
          value: JSON.stringify(queueItem)
        }
      );

      logger.info('Notification queued for retry', {
        alertId: alert.id,
        channelId: channel.id,
        retryCount,
        nextRetryAt: nextRetryAt.toISOString(),
        delayMs: delay
      });
    } catch (error) {
      logger.error('Failed to queue notification for retry', {
        alertId: alert.id,
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process retry queue
   */
  async processRetryQueue(): Promise<void> {
    const now = Date.now();

    try {
      // Get items ready for retry (score <= now)
      const items = await this.redisClient.zRangeByScore(
        this.retryQueueKey,
        0,
        now
      );

      if (items.length === 0) {
        return;
      }

      logger.info('Processing retry queue', { itemCount: items.length });

      for (const itemStr of items) {
        try {
          const item: RetryQueueItem = JSON.parse(itemStr);

          // Attempt to send notification
          const result = await this.notificationService.sendNotification(
            item.alert,
            item.channel
          );

          // Store delivery record
          await this.notificationRepository.create(
            item.alertId,
            item.channelId,
            item.channel.type,
            result,
            item.retryCount + 1
          );

          if (result.success) {
            // Remove from retry queue on success
            await this.redisClient.zRem(this.retryQueueKey, itemStr);
            
            logger.info('Notification retry succeeded', {
              alertId: item.alertId,
              channelId: item.channelId,
              retryCount: item.retryCount + 1
            });
          } else {
            // Remove current item and re-queue with incremented retry count
            await this.redisClient.zRem(this.retryQueueKey, itemStr);
            await this.queueForRetry(item.alert, item.channel, item.retryCount + 1);
            
            logger.warn('Notification retry failed, re-queued', {
              alertId: item.alertId,
              channelId: item.channelId,
              retryCount: item.retryCount + 1,
              error: result.errorMessage
            });
          }
        } catch (error) {
          logger.error('Error processing retry queue item', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Remove problematic item from queue
          await this.redisClient.zRem(this.retryQueueKey, itemStr);
        }
      }
    } catch (error) {
      logger.error('Error processing retry queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Start automatic retry processing
   */
  startRetryProcessor(intervalMs: number = 60000): void {
    if (this.processingIntervalId) {
      logger.warn('Retry processor already running');
      return;
    }

    logger.info('Starting notification retry processor', { intervalMs });

    this.processingIntervalId = setInterval(() => {
      this.processRetryQueue().catch(error => {
        logger.error('Retry processor error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }, intervalMs);
  }

  /**
   * Stop automatic retry processing
   */
  stopRetryProcessor(): void {
    if (this.processingIntervalId) {
      clearInterval(this.processingIntervalId);
      this.processingIntervalId = null;
      logger.info('Notification retry processor stopped');
    }
  }

  /**
   * Get retry queue statistics
   */
  async getQueueStats(): Promise<{
    totalQueued: number;
    readyForRetry: number;
    pendingRetry: number;
  }> {
    try {
      const now = Date.now();
      const totalQueued = await this.redisClient.zCard(this.retryQueueKey);
      const readyForRetry = await this.redisClient.zCount(this.retryQueueKey, 0, now);
      const pendingRetry = totalQueued - readyForRetry;

      return {
        totalQueued,
        readyForRetry,
        pendingRetry
      };
    } catch (error) {
      logger.error('Failed to get queue stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        totalQueued: 0,
        readyForRetry: 0,
        pendingRetry: 0
      };
    }
  }

  /**
   * Clear retry queue (for testing/maintenance)
   */
  async clearQueue(): Promise<number> {
    try {
      const count = await this.redisClient.del(this.retryQueueKey);
      logger.info('Retry queue cleared', { itemsRemoved: count });
      return count;
    } catch (error) {
      logger.error('Failed to clear retry queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }
}
