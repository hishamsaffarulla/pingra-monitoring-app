/**
 * Property-based tests for notification delivery
 * Feature: url-monitoring, Property 9: Notification Channel Delivery
 */

import * as fc from 'fast-check';
import { NotificationService } from '../src/services/notification-service';
import { Alert, NotificationChannel, AlertType } from '../src/types';

describe('Property 9: Notification Channel Delivery', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = new NotificationService();
  });

  /**
   * Property 9: Notification Channel Delivery
   * For any alert and set of enabled notification channels,
   * the system should send notifications to ALL enabled channels.
   * Validates: Requirements 6.5
   */
  test('should send notifications to all enabled channels', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate an alert
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
        // Generate an array of notification channels (1-5 channels)
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenantId: fc.uuid(),
            type: fc.constantFrom('email', 'webhook', 'sms', 'voice'),
            configuration: fc.record({
              // Email config
              host: fc.constant('smtp.example.com'),
              port: fc.constant(587),
              from: fc.constant('alerts@example.com'),
              to: fc.constant('user@example.com'),
              username: fc.constant('user'),
              password: fc.constant('pass'),
              // Webhook config
              url: fc.constant('https://hooks.example.com/webhook'),
              // SMS/Voice config
              phoneNumber: fc.constant('+1234567890'),
              provider: fc.constant('twilio'),
              apiKey: fc.constant('test-key')
            }),
            enabled: fc.boolean(),
            createdAt: fc.date()
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (alertData, channels) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          // Send to multiple channels
          const results = await notificationService.sendToMultipleChannels(
            alert,
            channels as NotificationChannel[]
          );

          // Property: Results array length should match channels array length
          expect(results).toHaveLength(channels.length);

          // Property: Each channel should have a corresponding result
          const resultChannelIds = results.map(r => r.channelId);
          const channelIds = channels.map(c => c.id);
          expect(resultChannelIds.sort()).toEqual(channelIds.sort());

          // Property: Enabled channels should receive notifications
          const enabledChannels = channels.filter(c => c.enabled);
          const enabledResults = results.filter(r => {
            const channel = channels.find(c => c.id === r.channelId);
            return channel?.enabled;
          });

          // All enabled channels should have been attempted
          expect(enabledResults.length).toBe(enabledChannels.length);

          // Property: Disabled channels should not succeed
          const disabledResults = results.filter(r => {
            const channel = channels.find(c => c.id === r.channelId);
            return !channel?.enabled;
          });

          // All disabled channels should fail with appropriate message
          disabledResults.forEach(result => {
            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('Channel is disabled');
          });

          // Property: All results should have a deliveredAt timestamp
          results.forEach(result => {
            expect(result.deliveredAt).toBeInstanceOf(Date);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Single channel notification should always return exactly one result
   */
  test('should return exactly one result for single channel notification', async () => {
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
            password: fc.constant('pass'),
            url: fc.constant('https://hooks.example.com/webhook'),
            phoneNumber: fc.constant('+1234567890'),
            provider: fc.constant('twilio'),
            apiKey: fc.constant('test-key')
          }),
          enabled: fc.boolean(),
          createdAt: fc.date()
        }),
        async (alertData, channel) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          const result = await notificationService.sendNotification(
            alert,
            channel as NotificationChannel
          );

          // Property: Should always return a result
          expect(result).toBeDefined();
          expect(result.channelId).toBe(channel.id);
          expect(result.deliveredAt).toBeInstanceOf(Date);

          // Property: Disabled channels should fail
          if (!channel.enabled) {
            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('Channel is disabled');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Empty channel list should return empty results
   */
  test('should return empty results for empty channel list', async () => {
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
        async (alertData) => {
          const alert: Alert = {
            ...alertData,
            notificationStatus: {}
          };

          const results = await notificationService.sendToMultipleChannels(
            alert,
            []
          );

          // Property: Empty input should produce empty output
          expect(results).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Channel configuration validation should be consistent
   */
  test('should consistently validate channel configurations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('email', 'webhook', 'sms', 'voice'),
        fc.record({
          host: fc.option(fc.constant('smtp.example.com')),
          port: fc.option(fc.constant(587)),
          from: fc.option(fc.constant('alerts@example.com')),
          to: fc.option(fc.constant('user@example.com')),
          username: fc.option(fc.constant('user')),
          password: fc.option(fc.constant('pass')),
          url: fc.option(fc.constant('https://hooks.example.com/webhook')),
          phoneNumber: fc.option(fc.constant('+1234567890')),
          provider: fc.option(fc.constant('twilio')),
          apiKey: fc.option(fc.constant('test-key'))
        }),
        (type, config) => {
          const result1 = notificationService.validateChannelConfiguration(
            type,
            config
          );
          const result2 = notificationService.validateChannelConfiguration(
            type,
            config
          );

          // Property: Validation should be deterministic
          expect(result1).toBe(result2);

          // Property: Validation should return boolean
          expect(typeof result1).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });
});
