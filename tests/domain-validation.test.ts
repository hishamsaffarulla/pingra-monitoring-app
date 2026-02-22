/**
 * Property-based tests for domain model validation
 * Feature: url-monitoring, Property 1: Monitor Configuration Validation
 */

import * as fc from 'fast-check';
import {
  validateMonitor,
  validateCreateMonitorRequest,
  validateCheckResult,
  validateAlert,
  validateTenant,
  validateUptimeMetrics,
  validateNotificationChannel
} from '../src/utils/validation';
import {
  CheckInterval,
  ProbeLocation,
  AlertType,
  TimePeriod,
  Monitor,
  CreateMonitorRequest,
  CheckResult,
  Alert,
  Tenant,
  UptimeMetrics,
  NotificationChannel
} from '../src/types/index';

// ============================================================================
// PROPERTY TEST GENERATORS
// ============================================================================

const validUrlArbitrary = fc.oneof(
  fc.constant('https://example.com'),
  fc.constant('http://test.org'),
  fc.constant('https://api.service.com/health'),
  fc.constant('http://localhost:3000/status')
);

const invalidUrlArbitrary = fc.oneof(
  fc.constant('not-a-url'),
  fc.constant('ftp://invalid.com'),
  fc.constant(''),
  fc.constant('javascript:alert(1)'),
  fc.constant('data:text/html,<script>alert(1)</script>')
);

const validMonitorArbitrary = fc.record({
  id: fc.uuid(),
  tenantId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 255 }).filter(s => s.trim().length > 0),
  url: validUrlArbitrary,
  checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
  timeoutSeconds: fc.integer({ min: 1, max: 300 }),
  expectedStatusCodes: fc.array(fc.integer({ min: 100, max: 599 }), { minLength: 1 }),
  probeLocations: fc.array(fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL), { minLength: 1 }),
  failureThreshold: fc.integer({ min: 1, max: 10 }),
  createdAt: fc.date(),
  updatedAt: fc.date()
}) as fc.Arbitrary<Monitor>;

const validCreateMonitorRequestArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 255 }).filter(s => s.trim().length > 0),
  url: validUrlArbitrary,
  checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
  timeoutSeconds: fc.integer({ min: 1, max: 300 }),
  expectedStatusCodes: fc.array(fc.integer({ min: 100, max: 599 }), { minLength: 1 }),
  probeLocations: fc.array(fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL), { minLength: 1 }),
  failureThreshold: fc.integer({ min: 1, max: 10 })
}) as fc.Arbitrary<CreateMonitorRequest>;

const validCheckResultArbitrary = fc.record({
  id: fc.uuid(),
  monitorId: fc.uuid(),
  location: fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
  timestamp: fc.date(),
  success: fc.boolean(),
  responseTime: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
  statusCode: fc.option(fc.integer({ min: 100, max: 599 }), { nil: undefined }),
  errorMessage: fc.option(fc.string(), { nil: undefined }),
  sslExpiryDate: fc.option(fc.date(), { nil: undefined })
}) as fc.Arbitrary<CheckResult>;

const validAlertArbitrary = fc.record({
  id: fc.uuid(),
  monitorId: fc.uuid(),
  type: fc.constantFrom(AlertType.FAILURE, AlertType.RECOVERY, AlertType.SSL_WARNING, AlertType.SSL_CRITICAL),
  triggeredAt: fc.date(),
  resolvedAt: fc.option(fc.date(), { nil: undefined }),
  consecutiveFailures: fc.integer({ min: 0 }),
  message: fc.string({ minLength: 1 }),
  notificationStatus: fc.object()
}) as fc.Arbitrary<Alert>;

const validTenantArbitrary = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 255 }).filter(s => s.trim().length > 0),
  encryptedConfig: fc.object(),
  createdAt: fc.date()
}) as fc.Arbitrary<Tenant>;

const validUptimeMetricsArbitrary = fc.record({
  monitorId: fc.uuid(),
  period: fc.constantFrom(TimePeriod.LAST_24_HOURS, TimePeriod.LAST_7_DAYS, TimePeriod.LAST_30_DAYS),
  totalChecks: fc.integer({ min: 0 }),
  successfulChecks: fc.integer({ min: 0 }),
  uptimePercentage: fc.float({ min: 0, max: Math.fround(100) }).filter(n => !isNaN(n)),
  averageResponseTime: fc.float({ min: 0, max: Math.fround(10000) }).filter(n => !isNaN(n)),
  lastOutageDuration: fc.option(fc.float({ min: 0, max: Math.fround(1440) }).filter(n => !isNaN(n)), { nil: undefined })
}).filter(metrics => metrics.successfulChecks <= metrics.totalChecks) as fc.Arbitrary<UptimeMetrics>;

const validNotificationChannelArbitrary = fc.oneof(
  // Email channel
  fc.record({
    id: fc.uuid(),
    tenantId: fc.uuid(),
    type: fc.constant('email' as const),
    configuration: fc.record({
      smtpHost: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      smtpPort: fc.integer({ min: 1, max: 65535 }),
      fromEmail: fc.emailAddress(),
      username: fc.option(fc.string(), { nil: undefined }),
      password: fc.option(fc.string(), { nil: undefined })
    }),
    enabled: fc.boolean(),
    createdAt: fc.date()
  }),
  // Webhook channel
  fc.record({
    id: fc.uuid(),
    tenantId: fc.uuid(),
    type: fc.constant('webhook' as const),
    configuration: fc.record({
      url: validUrlArbitrary,
      method: fc.constantFrom('POST', 'PUT'),
      headers: fc.option(fc.object(), { nil: undefined })
    }),
    enabled: fc.boolean(),
    createdAt: fc.date()
  }),
  // SMS channel
  fc.record({
    id: fc.uuid(),
    tenantId: fc.uuid(),
    type: fc.constant('sms' as const),
    configuration: fc.record({
      provider: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      apiKey: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      phoneNumber: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0)
    }),
    enabled: fc.boolean(),
    createdAt: fc.date()
  }),
  // Voice channel
  fc.record({
    id: fc.uuid(),
    tenantId: fc.uuid(),
    type: fc.constant('voice' as const),
    configuration: fc.record({
      provider: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      apiKey: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      phoneNumber: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0)
    }),
    enabled: fc.boolean(),
    createdAt: fc.date()
  })
) as fc.Arbitrary<NotificationChannel>;

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe('Domain Model Validation Properties', () => {
  
  // **Property 1: Monitor Configuration Validation**
  // **Validates: Requirements 2.4**
  describe('Property 1: Monitor Configuration Validation', () => {
    
    test('valid monitors should always pass validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        (monitor: Monitor) => {
          const result = validateMonitor(monitor);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('monitors with invalid URLs should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        invalidUrlArbitrary,
        (monitor: Monitor, invalidUrl: string) => {
          const invalidMonitor = { ...monitor, url: invalidUrl };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'url')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('monitors with empty names should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        fc.constantFrom('', '   ', '\t', '\n'),
        (monitor: Monitor, emptyName: string) => {
          const invalidMonitor = { ...monitor, name: emptyName };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'name')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('monitors with invalid timeout values should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.integer({ min: 301 })
        ),
        (monitor: Monitor, invalidTimeout: number) => {
          const invalidMonitor = { ...monitor, timeoutSeconds: invalidTimeout };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'timeoutSeconds')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('monitors with invalid status codes should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        fc.array(fc.oneof(
          fc.integer({ max: 99 }),
          fc.integer({ min: 600 })
        ), { minLength: 1 }),
        (monitor: Monitor, invalidCodes: number[]) => {
          const invalidMonitor = { ...monitor, expectedStatusCodes: invalidCodes };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'expectedStatusCodes')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('monitors with empty probe locations should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        (monitor: Monitor) => {
          const invalidMonitor = { ...monitor, probeLocations: [] };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'probeLocations')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('monitors with invalid failure threshold should always fail validation', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.integer({ min: 11 })
        ),
        (monitor: Monitor, invalidThreshold: number) => {
          const invalidMonitor = { ...monitor, failureThreshold: invalidThreshold };
          const result = validateMonitor(invalidMonitor);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'failureThreshold')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('CreateMonitorRequest Validation Properties', () => {
    
    test('valid create monitor requests should always pass validation', () => {
      fc.assert(fc.property(
        validCreateMonitorRequestArbitrary,
        (request: CreateMonitorRequest) => {
          const result = validateCreateMonitorRequest(request);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('create monitor requests missing required fields should always fail validation', () => {
      fc.assert(fc.property(
        validCreateMonitorRequestArbitrary,
        (request: CreateMonitorRequest) => {
          // Test missing checkInterval
          const { checkInterval, ...requestWithoutInterval } = request;
          const result = validateCreateMonitorRequest(requestWithoutInterval as CreateMonitorRequest);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'checkInterval')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('CheckResult Validation Properties', () => {
    
    test('valid check results should always pass validation', () => {
      fc.assert(fc.property(
        validCheckResultArbitrary,
        (checkResult: CheckResult) => {
          const result = validateCheckResult(checkResult);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('check results with invalid response times should always fail validation', () => {
      fc.assert(fc.property(
        validCheckResultArbitrary,
        fc.integer({ max: -1 }),
        (checkResult: CheckResult, invalidResponseTime: number) => {
          const invalidCheckResult = { ...checkResult, responseTime: invalidResponseTime };
          const result = validateCheckResult(invalidCheckResult);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'responseTime')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('Alert Validation Properties', () => {
    
    test('valid alerts should always pass validation', () => {
      fc.assert(fc.property(
        validAlertArbitrary,
        (alert: Alert) => {
          const result = validateAlert(alert);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('alerts with negative consecutive failures should always fail validation', () => {
      fc.assert(fc.property(
        validAlertArbitrary,
        fc.integer({ max: -1 }),
        (alert: Alert, negativeFailures: number) => {
          const invalidAlert = { ...alert, consecutiveFailures: negativeFailures };
          const result = validateAlert(invalidAlert);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'consecutiveFailures')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('Tenant Validation Properties', () => {
    
    test('valid tenants should always pass validation', () => {
      fc.assert(fc.property(
        validTenantArbitrary,
        (tenant: Tenant) => {
          const result = validateTenant(tenant);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('tenants with names exceeding 255 characters should always fail validation', () => {
      fc.assert(fc.property(
        validTenantArbitrary,
        fc.string({ minLength: 256 }),
        (tenant: Tenant, longName: string) => {
          const invalidTenant = { ...tenant, name: longName };
          const result = validateTenant(invalidTenant);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'name')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('UptimeMetrics Validation Properties', () => {
    
    test('valid uptime metrics should always pass validation', () => {
      fc.assert(fc.property(
        validUptimeMetricsArbitrary,
        (metrics: UptimeMetrics) => {
          const result = validateUptimeMetrics(metrics);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('uptime metrics with successful checks exceeding total checks should always fail validation', () => {
      fc.assert(fc.property(
        validUptimeMetricsArbitrary,
        fc.integer({ min: 1 }),
        (metrics: UptimeMetrics, excess: number) => {
          const invalidMetrics = { 
            ...metrics, 
            totalChecks: 10,
            successfulChecks: 10 + excess
          };
          const result = validateUptimeMetrics(invalidMetrics);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'successfulChecks')).toBe(true);
        }
      ), { numRuns: 100 });
    });

    test('uptime metrics with invalid percentage values should always fail validation', () => {
      fc.assert(fc.property(
        validUptimeMetricsArbitrary,
        fc.oneof(
          fc.constant(-1),
          fc.constant(101),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NaN)
        ),
        (metrics: UptimeMetrics, invalidPercentage: number) => {
          const invalidMetrics = { ...metrics, uptimePercentage: invalidPercentage };
          const result = validateUptimeMetrics(invalidMetrics);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'uptimePercentage')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  describe('NotificationChannel Validation Properties', () => {
    
    test('valid notification channels should always pass validation', () => {
      fc.assert(fc.property(
        validNotificationChannelArbitrary,
        (channel: NotificationChannel) => {
          const result = validateNotificationChannel(channel);
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ), { numRuns: 100 });
    });

    test('notification channels with invalid types should always fail validation', () => {
      fc.assert(fc.property(
        validNotificationChannelArbitrary,
        fc.string().filter(s => !['email', 'webhook', 'sms', 'voice'].includes(s)),
        (channel: NotificationChannel, invalidType: string) => {
          const invalidChannel = { ...channel, type: invalidType as any };
          const result = validateNotificationChannel(invalidChannel);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(error => error.field === 'type')).toBe(true);
        }
      ), { numRuns: 100 });
    });
  });

  // Universal validation properties
  describe('Universal Validation Properties', () => {
    
    test('validation results should always have consistent structure', () => {
      fc.assert(fc.property(
        validMonitorArbitrary,
        (monitor: Monitor) => {
          const result = validateMonitor(monitor);
          
          // Result should always have isValid and errors properties
          expect(result).toHaveProperty('isValid');
          expect(result).toHaveProperty('errors');
          expect(typeof result.isValid).toBe('boolean');
          expect(Array.isArray(result.errors)).toBe(true);
          
          // If isValid is true, errors should be empty
          if (result.isValid) {
            expect(result.errors).toHaveLength(0);
          }
          
          // If isValid is false, errors should not be empty
          if (!result.isValid) {
            expect(result.errors.length).toBeGreaterThan(0);
          }
          
          // All errors should have required properties
          result.errors.forEach(error => {
            expect(error).toHaveProperty('field');
            expect(error).toHaveProperty('message');
            expect(error).toHaveProperty('code');
            expect(typeof error.field).toBe('string');
            expect(typeof error.message).toBe('string');
            expect(typeof error.code).toBe('string');
          });
        }
      ), { numRuns: 100 });
    });
  });
});