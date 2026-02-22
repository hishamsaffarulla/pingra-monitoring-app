/**
 * Property-based tests for notification retry logic
 * Feature: url-monitoring, Property 10: Notification Retry Logic
 */

import * as fc from 'fast-check';
import { NotificationService } from '../src/services/notification-service';
import { NotificationRetryService } from '../src/services/notification-retry-service';
import { NotificationRepository } from '../src/database/repositories/notification-repository';
import { Alert, NotificationChannel, AlertType } from '../src/types';

describe('Property 10: Notification Retry Logic', () => {
  let redisClient: any;
  let notificationRepository: NotificationRepository;
  let notificationService: NotificationService;
  let retryService: NotificationRetryService;

  beforeAll(async () => {
    // Create mock Redis client
    redisClient = {
      zAdd: jest.fn().mockResolvedValue(1),
      zRangeByScore: jest.fn().mockResolvedValue([]),
      zRem: jest.fn().mockResolvedValue(1),
      zCard: jest.fn().mockResolvedValue(0),
      zCount: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1)
    };

    // Create mock repository
    notificationRepository = {
      create: jest.fn().mockResolvedValue({
        id: 'test-id',
        alertId: 'alert-id',
        channelId: 'channel-id',
        channelType: 'email',
        success: false,
        deliveredAt: new Date(),
        retryCount: 0,
        createdAt: new Date()
      })
    } as any;

    notificationService = new NotificationService();
    retryService = new NotificationRetryService(
      notificationService,
      notificationRepository,
      redisClient
    );
  });

  /**
   * Property 10: Notification Retry Logic
   * For any failed notification, the system should queue it for retry
   * with exponential backoff up to a maximum number of retries.
   * Validates: Requirements 6.6
   */
  test('should queue failed notifications for retry with exponential backoff', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          monitorId: fc.uuid(),
          type: fc.constantFrom<AlertType>(
            'failure' as AlertType,
            'recovery' as AlertType,
            'ssl_warning' as AlertType,
            'ssl_critical' as AlertType
          ),
          triggeredAt: fc.date(),
          consecutiveFailures: fc.nat({ max: 10 }),
          message: fc.string({ minLength: 10, maxLength: 200 })
        }),
        fc.record({
          id: fc.uuid(),
          tenantId: fc.uuid(),
          type: fc.constantFrom('email', 'webhook', 'sms', 'voice'),
          configuration: fc.record({
            host: fc.constant('smtp.example.com'),
            port: fc.constant(587),
            from: fc.constant('alerts@example.com'),
            to: fc.constant('user@example.com'),
            username: fc.constant('user'),
            password: fc.constant('pass')
          }),
          enabled: fc.constant(true),
          createdAt: fc.date()
        }),
        fc.nat({ max: 2 }), // retry count 0-2
        async (alertData, channel, retryCount) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          // Reset mock
          (redisClient.zAdd as jest.Mock).mockClear();

          // Queue for retry
          await retryService.queueForRetry(
            alert,
            channel as NotificationChannel,
            retryCount
          );

          // Property: Should call Redis zAdd
          expect(redisClient.zAdd).toHaveBeenCalledTimes(1);

          // Property: Should use correct queue key
          const callArgs = (redisClient.zAdd as jest.Mock).mock.calls[0];
          expect(callArgs[0]).toBe('notification:retry:queue');

          // Property: Score should be a future timestamp
          const queueItem = callArgs[1];
          expect(queueItem.score).toBeGreaterThan(Date.now());

          // Property: Value should contain alert and channel data
          const value = JSON.parse(queueItem.value);
          expect(value.alertId).toBe(alert.id);
          expect(value.channelId).toBe(channel.id);
          expect(value.retryCount).toBe(retryCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Retry delay should increase exponentially
   */
  test('should calculate exponentially increasing retry delays', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          monitorId: fc.uuid(),
          type: fc.constantFrom<AlertType>(
            'failure' as AlertType,
            'recovery' as AlertType,
            'ssl_warning' as AlertType,
            'ssl_critical' as AlertType
          ),
          triggeredAt: fc.date(),
          consecutiveFailures: fc.nat({ max: 10 }),
          message: fc.string({ minLength: 10, maxLength: 200 })
        }),
        fc.record({
          id: fc.uuid(),
          tenantId: fc.uuid(),
          type: fc.constantFrom('email', 'webhook', 'sms', 'voice'),
          configuration: fc.record({
            host: fc.constant('smtp.example.com'),
            port: fc.constant(587),
            from: fc.constant('alerts@example.com'),
            to: fc.constant('user@example.com'),
            username: fc.constant('user'),
            password: fc.constant('pass')
          }),
          enabled: fc.constant(true),
          createdAt: fc.date()
        }),
        async (alertData, channel) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          const delays: number[] = [];

          // Queue for retry multiple times
          for (let retryCount = 0; retryCount < 3; retryCount++) {
            (redisClient.zAdd as jest.Mock).mockClear();
            
            await retryService.queueForRetry(
              alert,
              channel as NotificationChannel,
              retryCount
            );

            const callArgs = (redisClient.zAdd as jest.Mock).mock.calls[0];
            const queueItem = callArgs[1];
            const delay = queueItem.score - Date.now();
            delays.push(delay);
          }

          // Property: Each delay should be greater than or equal to the previous
          for (let i = 1; i < delays.length; i++) {
            const prevDelay = delays[i - 1];
            if (prevDelay !== undefined) {
              expect(delays[i]).toBeGreaterThanOrEqual(prevDelay);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Should not queue beyond max retries
   */
  test('should not queue notifications beyond max retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          monitorId: fc.uuid(),
          type: fc.constantFrom<AlertType>(
            'failure' as AlertType,
            'recovery' as AlertType,
            'ssl_warning' as AlertType,
            'ssl_critical' as AlertType
          ),
          triggeredAt: fc.date(),
          consecutiveFailures: fc.nat({ max: 10 }),
          message: fc.string({ minLength: 10, maxLength: 200 })
        }),
        fc.record({
          id: fc.uuid(),
          tenantId: fc.uuid(),
          type: fc.constantFrom('email', 'webhook', 'sms', 'voice'),
          configuration: fc.record({
            host: fc.constant('smtp.example.com'),
            port: fc.constant(587),
            from: fc.constant('alerts@example.com'),
            to: fc.constant('user@example.com'),
            username: fc.constant('user'),
            password: fc.constant('pass')
          }),
          enabled: fc.constant(true),
          createdAt: fc.date()
        }),
        fc.integer({ min: 3, max: 10 }), // retry count >= max retries
        async (alertData, channel, retryCount) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          (redisClient.zAdd as jest.Mock).mockClear();

          // Try to queue beyond max retries
          await retryService.queueForRetry(
            alert,
            channel as NotificationChannel,
            retryCount
          );

          // Property: Should not call Redis zAdd when max retries reached
          expect(redisClient.zAdd).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Queue statistics should be consistent
   */
  test('should provide consistent queue statistics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        async (totalQueued, readyForRetry) => {
          // Mock Redis responses
          (redisClient.zCard as jest.Mock).mockResolvedValue(totalQueued);
          (redisClient.zCount as jest.Mock).mockResolvedValue(
            Math.min(readyForRetry, totalQueued)
          );

          const stats = await retryService.getQueueStats();

          // Property: Total should equal ready + pending
          expect(stats.totalQueued).toBe(totalQueued);
          expect(stats.readyForRetry).toBeLessThanOrEqual(stats.totalQueued);
          expect(stats.pendingRetry).toBe(
            stats.totalQueued - stats.readyForRetry
          );

          // Property: Ready should not exceed total
          expect(stats.readyForRetry).toBeLessThanOrEqual(stats.totalQueued);

          // Property: Pending should be non-negative
          expect(stats.pendingRetry).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Clear queue should remove all items
   */
  test('should clear all items from queue', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 100 }),
        async (itemCount) => {
          (redisClient.del as jest.Mock).mockResolvedValue(itemCount);

          const cleared = await retryService.clearQueue();

          // Property: Should call Redis del
          expect(redisClient.del).toHaveBeenCalledWith('notification:retry:queue');

          // Property: Should return count of cleared items
          expect(cleared).toBe(itemCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
