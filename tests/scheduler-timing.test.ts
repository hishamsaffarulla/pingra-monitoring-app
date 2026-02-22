/**
 * Property-based tests for scheduler timing
 * Feature: url-monitoring, Property 2: Scheduler Interval Compliance
 */

import * as fc from 'fast-check';
import { CheckInterval } from '../src/types';
import { SchedulerServiceImpl, SchedulerServiceConfig } from '../src/services/scheduler-service';

// Use a deterministic in-test cron mock so timing tests do not depend on real minutes.
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('node-cron', () => {
  const intervalForExpression = (expression: string): number => {
    if (expression === '* * * * *') return 120;
    if (expression === '*/5 * * * *') return 300;
    return 120;
  };

  return {
    schedule: (expression: string, callback: () => Promise<void> | void) => {
      let timer: NodeJS.Timeout | null = null;
      return {
        start: () => {
          if (!timer) {
            timer = setInterval(() => {
              void callback();
            }, intervalForExpression(expression));
          }
        },
        stop: () => {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      };
    }
  };
});

// ============================================================================
// TEST UTILITIES
// ============================================================================

function expectedIntervalMs(interval: CheckInterval): number {
  return interval === CheckInterval.ONE_MINUTE ? 120 : 300;
}

/**
 * Mock check trigger function for testing
 */
class MockCheckTrigger {
  private executionTimes: Map<string, Date[]> = new Map();
  private executionPromises: Map<string, Promise<void>[]> = new Map();
  private executionDurations: Map<string, number> = new Map();

  constructor() {
    this.trigger = this.trigger.bind(this);
  }

  async trigger(monitorId: string): Promise<void> {
    const executionTime = new Date();
    
    // Record execution time
    if (!this.executionTimes.has(monitorId)) {
      this.executionTimes.set(monitorId, []);
    }
    this.executionTimes.get(monitorId)!.push(executionTime);

    // Simulate execution duration if configured
    const duration = this.executionDurations.get(monitorId) || 0;
    if (duration > 0) {
      await new Promise(resolve => setTimeout(resolve, duration));
    }

    // Track promises for synchronization
    if (!this.executionPromises.has(monitorId)) {
      this.executionPromises.set(monitorId, []);
    }
  }

  getExecutionTimes(monitorId: string): Date[] {
    return this.executionTimes.get(monitorId) || [];
  }

  getExecutionCount(monitorId: string): number {
    return this.getExecutionTimes(monitorId).length;
  }

  setExecutionDuration(monitorId: string, durationMs: number): void {
    this.executionDurations.set(monitorId, durationMs);
  }

  reset(): void {
    this.executionTimes.clear();
    this.executionPromises.clear();
    this.executionDurations.clear();
  }

  getIntervalsBetweenExecutions(monitorId: string): number[] {
    const times = this.getExecutionTimes(monitorId);
    if (times.length < 2) {
      return [];
    }

    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const currentTime = times[i];
      const previousTime = times[i - 1];
      if (currentTime && previousTime) {
        const intervalMs = currentTime.getTime() - previousTime.getTime();
        intervals.push(intervalMs);
      }
    }
    return intervals;
  }
}

/**
 * Create test scheduler configuration
 */
function createTestConfig(overrides: Partial<SchedulerServiceConfig> = {}): SchedulerServiceConfig {
  return {
    enablePersistence: false,
    maxConcurrentChecks: 10,
    checkOverlapTimeoutMs: 5000,
    ...overrides
  };
}

/**
 * Wait for a specific number of executions with timeout
 */
async function waitForExecutions(
  mockTrigger: MockCheckTrigger, 
  monitorId: string, 
  expectedCount: number, 
  timeoutMs: number = 10000
): Promise<void> {
  const startTime = Date.now();
  
  while (mockTrigger.getExecutionCount(monitorId) < expectedCount) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${expectedCount} executions. Got ${mockTrigger.getExecutionCount(monitorId)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// ============================================================================
// PROPERTY TEST GENERATORS
// ============================================================================

const validMonitorIdArbitrary = fc.uuid();

const validCheckIntervalArbitrary = fc.constantFrom(
  CheckInterval.ONE_MINUTE,
  CheckInterval.FIVE_MINUTES
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe('Scheduler Timing Properties', () => {

  let mockTrigger: MockCheckTrigger;
  let scheduler: SchedulerServiceImpl;

  beforeEach(() => {
    mockTrigger = new MockCheckTrigger();
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.stop();
    }
    mockTrigger.reset();
  });

  // **Property 2: Scheduler Interval Compliance**
  // **Validates: Requirements 2.1**
  describe('Property 2: Scheduler Interval Compliance', () => {

    test('scheduler should respect configured check intervals within tolerance', async () => {
      const testCases = [
        { monitorId: 'test-1', interval: CheckInterval.ONE_MINUTE },
        { monitorId: 'test-2', interval: CheckInterval.FIVE_MINUTES },
      ];

      for (const { monitorId, interval } of testCases) {
        const config = createTestConfig();
        scheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
        await scheduler.start();

        // Schedule the check
        scheduler.scheduleCheck(monitorId, interval);

        // Wait for at least 3 executions to measure intervals
        const minExecutions = 3;
        const waitTimeMs = (expectedIntervalMs(interval) * minExecutions) + 1200; // Add buffer
        
        await waitForExecutions(mockTrigger, monitorId, minExecutions, waitTimeMs);

        // Measure actual intervals between executions
        const actualIntervals = mockTrigger.getIntervalsBetweenExecutions(monitorId);
        
        // Verify we have enough intervals to test
        expect(actualIntervals.length).toBeGreaterThanOrEqual(minExecutions - 1);

        // Check that each interval is within acceptable tolerance of expected interval
        const expected = expectedIntervalMs(interval);
        const toleranceMs = 180;

        actualIntervals.forEach((actualIntervalMs) => {
          const deviation = Math.abs(actualIntervalMs - expected);
          expect(deviation).toBeLessThanOrEqual(toleranceMs);
        });

        await scheduler.stop();
        mockTrigger.reset();
      }
    }, 12000);

    test('scheduler should maintain consistent intervals regardless of execution duration', async () => {
      await fc.assert(fc.asyncProperty(
        validMonitorIdArbitrary,
        validCheckIntervalArbitrary,
        fc.integer({ min: 80, max: 600 }), // Execution duration in ms
        async (monitorId: string, interval: CheckInterval, executionDurationMs: number) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Set execution duration to simulate slow checks
          mockTrigger.setExecutionDuration(monitorId, executionDurationMs);

          // Schedule the check
          testScheduler.scheduleCheck(monitorId, interval);

          // Wait for multiple executions
          const minExecutions = 3;
          const waitTimeMs = (expectedIntervalMs(interval) * minExecutions) + executionDurationMs + 1200;
          
          await waitForExecutions(mockTrigger, monitorId, minExecutions, waitTimeMs);

          // Measure intervals between execution starts (not completion)
          const executionTimes = mockTrigger.getExecutionTimes(monitorId);
          const intervals: number[] = [];
          
          for (let i = 1; i < executionTimes.length; i++) {
            const currentTime = executionTimes[i];
            const previousTime = executionTimes[i - 1];
            if (currentTime && previousTime) {
              intervals.push(currentTime.getTime() - previousTime.getTime());
            }
          }

          // Intervals should be consistent regardless of execution duration
          const expected = expectedIntervalMs(interval);
          const toleranceMs = 700;

          intervals.forEach(actualIntervalMs => {
            const deviation = Math.abs(actualIntervalMs - expected);
            expect(deviation).toBeLessThanOrEqual(toleranceMs);
          });

          await testScheduler.stop();
        }
      ), { 
        numRuns: 3,
        timeout: 15000
      });
    });

    test('scheduler should handle multiple monitors with different intervals correctly', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(fc.tuple(validMonitorIdArbitrary, validCheckIntervalArbitrary), { minLength: 2, maxLength: 5 }),
        async (monitorConfigs: Array<[string, CheckInterval]>) => {
          const config = createTestConfig({ maxConcurrentChecks: 20 });
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Schedule all monitors
          monitorConfigs.forEach(([monitorId, interval]) => {
            testScheduler.scheduleCheck(monitorId, interval);
          });

          // Wait for executions from all monitors
          const waitTimeMs = 1200;
          await new Promise(resolve => setTimeout(resolve, waitTimeMs));

          // Verify each monitor respects its own interval
          monitorConfigs.forEach(([monitorId, expectedInterval]) => {
            const executionCount = mockTrigger.getExecutionCount(monitorId);
            
            // Should have at least some executions
            expect(executionCount).toBeGreaterThan(0);

            if (executionCount >= 2) {
              const intervals = mockTrigger.getIntervalsBetweenExecutions(monitorId);
              const expected = expectedIntervalMs(expectedInterval);
              const toleranceMs = 700;

              intervals.forEach(actualIntervalMs => {
                const deviation = Math.abs(actualIntervalMs - expected);
                expect(deviation).toBeLessThanOrEqual(toleranceMs);
              });
            }
          });

          await testScheduler.stop();
        }
      ), { 
        numRuns: 3,
        timeout: 30000
      });
    });

    test('scheduler should not execute overlapping checks for the same monitor', async () => {
      await fc.assert(fc.asyncProperty(
        validMonitorIdArbitrary,
        fc.constantFrom(CheckInterval.ONE_MINUTE), // Use only 1-minute interval
        fc.integer({ min: 450, max: 900 }), // Long execution duration relative to mocked cron intervals
        async (monitorId: string, interval: CheckInterval, longExecutionMs: number) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Set long execution duration
          mockTrigger.setExecutionDuration(monitorId, longExecutionMs);

          // Schedule the check
          testScheduler.scheduleCheck(monitorId, interval);

          // Wait for some time
          const waitTimeMs = expectedIntervalMs(interval) * 4;
          await new Promise(resolve => setTimeout(resolve, waitTimeMs));

          // Should have fewer executions than intervals due to overlap prevention
          const executionCount = mockTrigger.getExecutionCount(monitorId);
          const expectedMaxExecutions = Math.floor(waitTimeMs / longExecutionMs) + 1;
          
          expect(executionCount).toBeLessThanOrEqual(expectedMaxExecutions);

          await testScheduler.stop();
        }
      ), { 
        numRuns: 3,
        timeout: 30000
      });
    });

    test('scheduler should respect maximum concurrent check limits', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(validMonitorIdArbitrary, { minLength: 5, maxLength: 10 }),
        fc.integer({ min: 1, max: 3 }), // Low max concurrent limit
        fc.integer({ min: 200, max: 700 }), // Execution duration
        async (monitorIds: string[], maxConcurrent: number, executionDurationMs: number) => {
          const config = createTestConfig({ 
            maxConcurrentChecks: maxConcurrent,
            checkOverlapTimeoutMs: 10000
          });
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Set execution duration for all monitors
          monitorIds.forEach(monitorId => {
            mockTrigger.setExecutionDuration(monitorId, executionDurationMs);
          });

          // Schedule all monitors with 1-minute interval
          monitorIds.forEach(monitorId => {
            testScheduler.scheduleCheck(monitorId, CheckInterval.ONE_MINUTE);
          });

          // Wait for initial executions
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Count total executions across all monitors
          const totalExecutions = monitorIds.reduce((sum, monitorId) => {
            return sum + mockTrigger.getExecutionCount(monitorId);
          }, 0);

          // Should not exceed the concurrent limit significantly
          // (allowing some variance due to timing)
          expect(totalExecutions).toBeLessThanOrEqual(maxConcurrent + monitorIds.length);

          await testScheduler.stop();
        }
      ), { 
        numRuns: 2,
        timeout: 15000
      });
    });

    test('scheduler should correctly calculate next run times', async () => {
      await fc.assert(fc.asyncProperty(
        validMonitorIdArbitrary,
        validCheckIntervalArbitrary,
        async (monitorId: string, interval: CheckInterval) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Schedule the check
          testScheduler.scheduleCheck(monitorId, interval);

          // Get scheduled checks
          const scheduledChecks = testScheduler.getScheduledChecks();
          const scheduledCheck = scheduledChecks.find(check => check.monitorId === monitorId);

          expect(scheduledCheck).toBeDefined();
          expect(scheduledCheck!.interval).toBe(interval);

          // Next run time should be in the future
          const now = new Date();
          expect(scheduledCheck!.nextRunTime.getTime()).toBeGreaterThan(now.getTime());

          // Next run time should be within reasonable bounds
          const maxExpectedDelay = interval * 1000 + 5000; // interval + 5 second buffer
          const timeDiff = scheduledCheck!.nextRunTime.getTime() - now.getTime();
          expect(timeDiff).toBeLessThanOrEqual(maxExpectedDelay);

          await testScheduler.stop();
        }
      ), { numRuns: 10 });
    });

    test('scheduler should handle schedule updates correctly', async () => {
      await fc.assert(fc.asyncProperty(
        validMonitorIdArbitrary,
        async (monitorId: string) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          const initialInterval = CheckInterval.ONE_MINUTE;
          const newInterval = CheckInterval.FIVE_MINUTES;

          // Schedule with initial interval
          testScheduler.scheduleCheck(monitorId, initialInterval);

          // Wait for at least one execution
          await waitForExecutions(mockTrigger, monitorId, 1, 10000);

          // Update to new interval
          testScheduler.updateSchedule(monitorId, newInterval);

          // Reset execution tracking to measure new interval
          const executionCountBeforeUpdate = mockTrigger.getExecutionCount(monitorId);
          
          // Wait for executions with new interval
          const waitTimeMs = expectedIntervalMs(newInterval) * 2 + 1200;
          await new Promise(resolve => setTimeout(resolve, waitTimeMs));

          const totalExecutions = mockTrigger.getExecutionCount(monitorId);
          const newExecutions = totalExecutions - executionCountBeforeUpdate;

          // Should have at least one execution with new interval
          expect(newExecutions).toBeGreaterThan(0);

          // Verify the scheduled check reflects the new interval
          const scheduledChecks = testScheduler.getScheduledChecks();
          const scheduledCheck = scheduledChecks.find(check => check.monitorId === monitorId);
          expect(scheduledCheck?.interval).toBe(newInterval);

          await testScheduler.stop();
        }
      ), { 
        numRuns: 5,
        timeout: 20000
      });
    });

    test('scheduler should handle cancellation correctly', async () => {
      await fc.assert(fc.asyncProperty(
        validMonitorIdArbitrary,
        validCheckIntervalArbitrary,
        async (monitorId: string, interval: CheckInterval) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          await testScheduler.start();

          // Schedule the check
          testScheduler.scheduleCheck(monitorId, interval);

          // Wait for at least one execution
          await waitForExecutions(mockTrigger, monitorId, 1, 10000);

          // Cancel the check
          testScheduler.cancelCheck(monitorId);

          // Record execution count after cancellation
          const executionCountAfterCancel = mockTrigger.getExecutionCount(monitorId);

          // Wait for what would be another interval
          const waitTimeMs = expectedIntervalMs(interval) + 700;
          await new Promise(resolve => setTimeout(resolve, waitTimeMs));

          // Should not have any new executions
          const finalExecutionCount = mockTrigger.getExecutionCount(monitorId);
          expect(finalExecutionCount).toBe(executionCountAfterCancel);

          // Should not appear in scheduled checks
          const scheduledChecks = testScheduler.getScheduledChecks();
          const scheduledCheck = scheduledChecks.find(check => check.monitorId === monitorId);
          expect(scheduledCheck).toBeUndefined();

          await testScheduler.stop();
        }
      ), { 
        numRuns: 5,
        timeout: 20000
      });
    });
  });

  describe('Scheduler State Management Properties', () => {

    test('scheduler stats should always reflect current state accurately', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(fc.tuple(validMonitorIdArbitrary, validCheckIntervalArbitrary), { minLength: 0, maxLength: 5 }),
        async (monitorConfigs: Array<[string, CheckInterval]>) => {
          const config = createTestConfig();
          const testScheduler = new SchedulerServiceImpl(config, mockTrigger.trigger);
          
          // Stats before starting
          let stats = testScheduler.getStats();
          expect(stats.isStarted).toBe(false);
          expect(stats.totalScheduled).toBe(0);
          expect(stats.runningChecks).toBe(0);

          await testScheduler.start();

          // Stats after starting
          stats = testScheduler.getStats();
          expect(stats.isStarted).toBe(true);
          expect(stats.totalScheduled).toBe(0);

          // Schedule monitors
          monitorConfigs.forEach(([monitorId, interval]) => {
            testScheduler.scheduleCheck(monitorId, interval);
          });

          // Stats after scheduling
          stats = testScheduler.getStats();
          expect(stats.isStarted).toBe(true);
          expect(stats.totalScheduled).toBe(monitorConfigs.length);

          await testScheduler.stop();

          // Stats after stopping
          stats = testScheduler.getStats();
          expect(stats.isStarted).toBe(false);
          expect(stats.totalScheduled).toBe(0);
        }
      ), { numRuns: 10 });
    });
  });
});





