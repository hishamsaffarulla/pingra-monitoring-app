/**
 * Property-based tests for Alert Engine
 * Feature: url-monitoring, Property 6: Consecutive Failure Detection
 * Feature: url-monitoring, Property 7: Recovery Detection Logic
 * Feature: url-monitoring, Property 8: SSL Alert Timing
 */

import * as fc from 'fast-check';
import { AlertEngine, AlertEngineConfig } from '../src/services/alert-engine';
import { AlertRepository } from '../src/database/repositories/alert-repository';
import { CheckResultRepository } from '../src/database/repositories/check-result-repository';
import { MonitorRepository } from '../src/database/repositories/monitor-repository';
import { RedisSetup } from '../src/database/redis-setup';
import { 
  CheckResult, 
  Monitor, 
  Alert, 
  AlertType, 
  ProbeLocation, 
  CheckInterval 
} from '../src/types';

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

class MockAlertRepository extends AlertRepository {
  private alerts: Alert[] = [];
  private idCounter = 1;

  constructor() {
    super(null as any);
  }

  override async create(alert: Omit<Alert, 'id'>): Promise<Alert> {
    const newAlert: Alert = {
      ...alert,
      id: `alert-${this.idCounter++}`,
    };
    this.alerts.push(newAlert);
    return newAlert;
  }

  override async findActive(monitorId?: string): Promise<Alert[]> {
    return this.alerts.filter(a => 
      !a.resolvedAt && (!monitorId || a.monitorId === monitorId)
    );
  }

  override async findByMonitor(
    monitorId: string,
    options: any = {}
  ): Promise<Alert[]> {
    const filtered = this.alerts.filter(a => a.monitorId === monitorId);
    const sorted = options.direction === 'ASC' 
      ? filtered.sort((a, b) => a.triggeredAt.getTime() - b.triggeredAt.getTime())
      : filtered.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
    return sorted.slice(0, options.limit || filtered.length);
  }

  override async resolveAllForMonitor(monitorId: string, resolvedAt: Date = new Date()): Promise<number> {
    let count = 0;
    this.alerts.forEach(a => {
      if (a.monitorId === monitorId && !a.resolvedAt) {
        a.resolvedAt = resolvedAt;
        count++;
      }
    });
    return count;
  }

  getAlerts(): Alert[] {
    return this.alerts;
  }

  clearAlerts(): void {
    this.alerts = [];
    this.idCounter = 1;
  }
}

class MockCheckResultRepository extends CheckResultRepository {
  constructor() {
    super(null as any, null as any, 'test-bucket');
  }
}

class MockMonitorRepository extends MonitorRepository {
  private monitors: Map<string, Monitor> = new Map();

  constructor() {
    super(null as any);
  }

  override async findById(id: string): Promise<Monitor | null> {
    return this.monitors.get(id) || null;
  }

  addMonitor(monitor: Monitor): void {
    this.monitors.set(monitor.id, monitor);
  }

  clearMonitors(): void {
    this.monitors.clear();
  }
}

class MockRedisSetup extends RedisSetup {
  private alertStates: Map<string, any> = new Map();
  private counters: Map<string, number> = new Map();

  constructor() {
    super(null as any, {
      keyPrefix: 'test',
      defaultTTL: 3600,
      sessionTTL: 86400,
      alertStateTTL: 604800,
      cacheTTL: 1800
    });
  }

  override async getAlertState(monitorId: string): Promise<any | null> {
    return this.alertStates.get(monitorId) || null;
  }

  override async setAlertState(monitorId: string, state: any): Promise<void> {
    this.alertStates.set(monitorId, state);
  }

  override async incrementCounter(counterName: string, _ttl?: number): Promise<number> {
    const current = this.counters.get(counterName) || 0;
    const newValue = current + 1;
    this.counters.set(counterName, newValue);
    return newValue;
  }

  override async getCounter(counterName: string): Promise<number> {
    return this.counters.get(counterName) || 0;
  }

  override async resetCounter(counterName: string): Promise<void> {
    this.counters.delete(counterName);
  }

  clearAll(): void {
    this.alertStates.clear();
    this.counters.clear();
  }
}

// ============================================================================
// TEST GENERATORS
// ============================================================================

const monitorArbitrary = fc.record({
  id: fc.uuid(),
  tenantId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  url: fc.webUrl(),
  checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
  timeoutSeconds: fc.integer({ min: 5, max: 60 }),
  expectedStatusCodes: fc.array(fc.integer({ min: 200, max: 599 }), { minLength: 1, maxLength: 3 }),
  probeLocations: fc.array(
    fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
    { minLength: 1, maxLength: 3 }
  ).map(locs => [...new Set(locs)]),
  failureThreshold: fc.integer({ min: 1, max: 10 }),
  createdAt: fc.date(),
  updatedAt: fc.date()
}) as fc.Arbitrary<Monitor>;

const alertEngineConfigArbitrary = fc.record({
  defaultFailureThreshold: fc.integer({ min: 1, max: 10 }),
  sslWarningDays: fc.constant(30),
  sslCriticalDays: fc.constant(7),
  alertStateTTL: fc.constant(604800)
}) as fc.Arbitrary<AlertEngineConfig>;

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe('Alert Engine Properties', () => {
  let mockAlertRepo: MockAlertRepository;
  let mockCheckResultRepo: MockCheckResultRepository;
  let mockMonitorRepo: MockMonitorRepository;
  let mockRedis: MockRedisSetup;
  let alertEngine: AlertEngine;

  beforeEach(() => {
    mockAlertRepo = new MockAlertRepository();
    mockCheckResultRepo = new MockCheckResultRepository();
    mockMonitorRepo = new MockMonitorRepository();
    mockRedis = new MockRedisSetup();
  });

  // **Property 6: Consecutive Failure Detection**
  // **Validates: Requirements 5.1**
  describe('Property 6: Consecutive Failure Detection', () => {

    test('alert should trigger when consecutive failures reach threshold across all locations', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Simulate consecutive failures across all locations
          for (let i = 0; i < threshold; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Check that a failure alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const failureAlerts = alerts.filter(a => a.type === AlertType.FAILURE);
          
          expect(failureAlerts.length).toBeGreaterThan(0);
          
          if (failureAlerts.length > 0) {
            const alert = failureAlerts[0]!;
            expect(alert.monitorId).toBe(monitor.id);
            expect(alert.consecutiveFailures).toBeGreaterThanOrEqual(threshold);
          }
        }
      ), { numRuns: 20 });
    });

    test('alert should NOT trigger if failures are below threshold', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;
          const belowThreshold = Math.max(1, threshold - 1);

          // Simulate failures below threshold
          for (let i = 0; i < belowThreshold; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Check that NO failure alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const failureAlerts = alerts.filter(a => a.type === AlertType.FAILURE);
          
          expect(failureAlerts.length).toBe(0);
        }
      ), { numRuns: 20 });
    });

    test('consecutive failure count should reset on successful check', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        fc.integer({ min: 1, max: 5 }),
        async (monitor: Monitor, config: AlertEngineConfig, failuresBeforeSuccess: number) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Simulate some failures
          for (let i = 0; i < failuresBeforeSuccess; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-fail-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Simulate a successful check from at least one location
          const successLocation = monitor.probeLocations[0]!;
          const successCheck: CheckResult = {
            id: `check-success-${successLocation}`,
            monitorId: monitor.id,
            location: successLocation,
            timestamp: new Date(Date.now() + failuresBeforeSuccess * 1000),
            success: true,
            statusCode: 200,
            responseTime: 100
          };
          await alertEngine.processCheckResult(successCheck);

          // Get alert state and verify consecutive failures reset
          const decision = await alertEngine.evaluateFailureConditions(monitor.id);
          expect(decision.consecutiveFailures).toBe(0);
        }
      ), { numRuns: 20 });
    });

    test('alert should NOT trigger if only some locations fail', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary.filter(m => m.probeLocations.length > 1),
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Simulate failures where only some locations fail
          for (let i = 0; i < threshold + 2; i++) {
            // Fail all locations except the last one
            for (let j = 0; j < monitor.probeLocations.length - 1; j++) {
              const location = monitor.probeLocations[j]!;
              const failedCheck: CheckResult = {
                id: `check-fail-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }

            // Last location succeeds
            const successLocation = monitor.probeLocations[monitor.probeLocations.length - 1]!;
            const successCheck: CheckResult = {
              id: `check-success-${i}-${successLocation}`,
              monitorId: monitor.id,
              location: successLocation,
              timestamp: new Date(Date.now() + i * 1000),
              success: true,
              statusCode: 200,
              responseTime: 100
            };
            await alertEngine.processCheckResult(successCheck);
          }

          // Check that NO failure alert was triggered (because not all locations failed)
          const alerts = mockAlertRepo.getAlerts();
          const failureAlerts = alerts.filter(a => a.type === AlertType.FAILURE);
          
          expect(failureAlerts.length).toBe(0);
        }
      ), { numRuns: 15 });
    });

    test('duplicate failure alerts should be prevented', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Simulate many consecutive failures (more than threshold)
          for (let i = 0; i < threshold + 5; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Check that only ONE failure alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const failureAlerts = alerts.filter(a => a.type === AlertType.FAILURE);
          
          expect(failureAlerts.length).toBe(1);
        }
      ), { numRuns: 20 });
    });
  });

  // **Property 7: Recovery Detection Logic**
  // **Validates: Requirements 5.3**
  describe('Property 7: Recovery Detection Logic', () => {

    test('recovery alert should trigger when monitor recovers from failure state', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Simulate failures to trigger failure alert
          for (let i = 0; i < threshold; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-fail-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Verify failure alert was triggered
          let alerts = mockAlertRepo.getAlerts();
          const failureAlerts = alerts.filter(a => a.type === AlertType.FAILURE);
          expect(failureAlerts.length).toBeGreaterThan(0);

          // Simulate recovery (successful check)
          for (const location of monitor.probeLocations) {
            const successCheck: CheckResult = {
              id: `check-success-${location}`,
              monitorId: monitor.id,
              location,
              timestamp: new Date(Date.now() + threshold * 1000),
              success: true,
              statusCode: 200,
              responseTime: 100
            };
            await alertEngine.processCheckResult(successCheck);
          }

          // Check that recovery alert was triggered
          alerts = mockAlertRepo.getAlerts();
          const recoveryAlerts = alerts.filter(a => a.type === AlertType.RECOVERY);
          
          expect(recoveryAlerts.length).toBeGreaterThan(0);
          
          if (recoveryAlerts.length > 0) {
            const alert = recoveryAlerts[0]!;
            expect(alert.monitorId).toBe(monitor.id);
            expect(alert.consecutiveFailures).toBe(0);
          }
        }
      ), { numRuns: 20 });
    });

    test('recovery alert should NOT trigger if monitor was not in failure state', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Simulate successful checks without any prior failures
          for (const location of monitor.probeLocations) {
            const successCheck: CheckResult = {
              id: `check-success-${location}`,
              monitorId: monitor.id,
              location,
              timestamp: new Date(),
              success: true,
              statusCode: 200,
              responseTime: 100
            };
            await alertEngine.processCheckResult(successCheck);
          }

          // Check that NO recovery alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const recoveryAlerts = alerts.filter(a => a.type === AlertType.RECOVERY);
          
          expect(recoveryAlerts.length).toBe(0);
        }
      ), { numRuns: 20 });
    });

    test('failure alerts should be resolved when recovery occurs', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Trigger failure alert
          for (let i = 0; i < threshold; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-fail-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Trigger recovery
          for (const location of monitor.probeLocations) {
            const successCheck: CheckResult = {
              id: `check-success-${location}`,
              monitorId: monitor.id,
              location,
              timestamp: new Date(Date.now() + threshold * 1000),
              success: true,
              statusCode: 200,
              responseTime: 100
            };
            await alertEngine.processCheckResult(successCheck);
          }

          // Check that failure alerts are resolved
          const activeAlerts = await alertEngine.getActiveAlerts(monitor.id);
          const activeFailureAlerts = activeAlerts.filter(a => a.type === AlertType.FAILURE);
          
          expect(activeFailureAlerts.length).toBe(0);
        }
      ), { numRuns: 20 });
    });

    test('duplicate recovery alerts should be prevented', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const threshold = monitor.failureThreshold || config.defaultFailureThreshold;

          // Trigger failure
          for (let i = 0; i < threshold; i++) {
            for (const location of monitor.probeLocations) {
              const failedCheck: CheckResult = {
                id: `check-fail-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + i * 1000),
                success: false,
                statusCode: 500,
                errorMessage: 'Internal Server Error'
              };
              await alertEngine.processCheckResult(failedCheck);
            }
          }

          // Trigger multiple successful checks
          for (let i = 0; i < 5; i++) {
            for (const location of monitor.probeLocations) {
              const successCheck: CheckResult = {
                id: `check-success-${i}-${location}`,
                monitorId: monitor.id,
                location,
                timestamp: new Date(Date.now() + (threshold + i) * 1000),
                success: true,
                statusCode: 200,
                responseTime: 100
              };
              await alertEngine.processCheckResult(successCheck);
            }
          }

          // Check that only ONE recovery alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const recoveryAlerts = alerts.filter(a => a.type === AlertType.RECOVERY);
          
          expect(recoveryAlerts.length).toBe(1);
        }
      ), { numRuns: 20 });
    });
  });

  // **Property 8: SSL Alert Timing**
  // **Validates: Requirements 3.2, 3.3**
  describe('Property 8: SSL Alert Timing', () => {

    test('SSL warning alert should trigger when certificate expires within 30 days', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        fc.integer({ min: 8, max: 30 }),
        async (monitor: Monitor, config: AlertEngineConfig, daysUntilExpiry: number) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Create SSL expiry date within warning range (8-30 days)
          const sslExpiryDate = new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000);

          // Simulate check with SSL info
          const checkWithSSL: CheckResult = {
            id: 'check-ssl',
            monitorId: monitor.id,
            location: monitor.probeLocations[0]!,
            timestamp: new Date(),
            success: true,
            statusCode: 200,
            responseTime: 100,
            sslExpiryDate
          };

          await alertEngine.processCheckResult(checkWithSSL);

          // Check that SSL warning alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const sslWarningAlerts = alerts.filter(a => a.type === AlertType.SSL_WARNING);
          
          expect(sslWarningAlerts.length).toBeGreaterThan(0);
          
          if (sslWarningAlerts.length > 0) {
            const alert = sslWarningAlerts[0]!;
            expect(alert.monitorId).toBe(monitor.id);
            expect(alert.message).toContain('WARNING');
          }
        }
      ), { numRuns: 20 });
    });

    test('SSL critical alert should trigger when certificate expires within 7 days', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        fc.integer({ min: 1, max: 7 }),
        async (monitor: Monitor, config: AlertEngineConfig, daysUntilExpiry: number) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Create SSL expiry date within critical range (1-7 days)
          const sslExpiryDate = new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000);

          // Simulate check with SSL info
          const checkWithSSL: CheckResult = {
            id: 'check-ssl',
            monitorId: monitor.id,
            location: monitor.probeLocations[0]!,
            timestamp: new Date(),
            success: true,
            statusCode: 200,
            responseTime: 100,
            sslExpiryDate
          };

          await alertEngine.processCheckResult(checkWithSSL);

          // Check that SSL critical alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const sslCriticalAlerts = alerts.filter(a => a.type === AlertType.SSL_CRITICAL);
          
          expect(sslCriticalAlerts.length).toBeGreaterThan(0);
          
          if (sslCriticalAlerts.length > 0) {
            const alert = sslCriticalAlerts[0]!;
            expect(alert.monitorId).toBe(monitor.id);
            expect(alert.message).toContain('CRITICAL');
          }
        }
      ), { numRuns: 20 });
    });

    test('SSL alert should NOT trigger when certificate expires beyond 30 days', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        fc.integer({ min: 31, max: 365 }),
        async (monitor: Monitor, config: AlertEngineConfig, daysUntilExpiry: number) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Create SSL expiry date beyond warning range (>30 days)
          const sslExpiryDate = new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000);

          // Simulate check with SSL info
          const checkWithSSL: CheckResult = {
            id: 'check-ssl',
            monitorId: monitor.id,
            location: monitor.probeLocations[0]!,
            timestamp: new Date(),
            success: true,
            statusCode: 200,
            responseTime: 100,
            sslExpiryDate
          };

          await alertEngine.processCheckResult(checkWithSSL);

          // Check that NO SSL alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const sslAlerts = alerts.filter(a => 
            a.type === AlertType.SSL_WARNING || a.type === AlertType.SSL_CRITICAL
          );
          
          expect(sslAlerts.length).toBe(0);
        }
      ), { numRuns: 20 });
    });

    test('duplicate SSL alerts should be prevented within 24 hours', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        fc.integer({ min: 1, max: 7 }),
        async (monitor: Monitor, config: AlertEngineConfig, daysUntilExpiry: number) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          const sslExpiryDate = new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000);

          // Simulate multiple checks with same SSL info
          for (let i = 0; i < 5; i++) {
            const checkWithSSL: CheckResult = {
              id: `check-ssl-${i}`,
              monitorId: monitor.id,
              location: monitor.probeLocations[0]!,
              timestamp: new Date(Date.now() + i * 1000),
              success: true,
              statusCode: 200,
              responseTime: 100,
              sslExpiryDate
            };

            await alertEngine.processCheckResult(checkWithSSL);
          }

          // Check that only ONE SSL critical alert was triggered
          const alerts = mockAlertRepo.getAlerts();
          const sslCriticalAlerts = alerts.filter(a => a.type === AlertType.SSL_CRITICAL);
          
          expect(sslCriticalAlerts.length).toBe(1);
        }
      ), { numRuns: 20 });
    });

    test('SSL critical alert should take precedence over warning alert', async () => {
      await fc.assert(fc.asyncProperty(
        monitorArbitrary,
        alertEngineConfigArbitrary,
        async (monitor: Monitor, config: AlertEngineConfig) => {
          mockAlertRepo.clearAlerts();
          mockMonitorRepo.clearMonitors();
          mockRedis.clearAll();

          mockMonitorRepo.addMonitor(monitor);
          alertEngine = new AlertEngine(
            mockAlertRepo,
            mockCheckResultRepo,
            mockMonitorRepo,
            mockRedis,
            config
          );

          // Create SSL expiry date within critical range (5 days)
          const sslExpiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

          // Simulate check with SSL info
          const checkWithSSL: CheckResult = {
            id: 'check-ssl',
            monitorId: monitor.id,
            location: monitor.probeLocations[0]!,
            timestamp: new Date(),
            success: true,
            statusCode: 200,
            responseTime: 100,
            sslExpiryDate
          };

          await alertEngine.processCheckResult(checkWithSSL);

          // Check that SSL critical alert was triggered (not warning)
          const alerts = mockAlertRepo.getAlerts();
          const sslCriticalAlerts = alerts.filter(a => a.type === AlertType.SSL_CRITICAL);
          const sslWarningAlerts = alerts.filter(a => a.type === AlertType.SSL_WARNING);
          
          expect(sslCriticalAlerts.length).toBeGreaterThan(0);
          expect(sslWarningAlerts.length).toBe(0);
        }
      ), { numRuns: 20 });
    });
  });
});
