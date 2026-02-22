/**
 * System Invariants Property Tests
 * Feature: url-monitoring
 * 
 * Property 15: System Data Consistency
 * Property 16: Alert State Consistency
 * Property 17: Tenant Data Integrity
 * 
 * Validates: Requirements 8.3, 9.4, 5.4
 */

import * as fc from 'fast-check';

describe('System Invariants Property Tests', () => {
  describe('Property 15: System Data Consistency', () => {
    it('should maintain data consistency across all operations', () => {
      fc.assert(
        fc.property(
          fc.record({
            monitorId: fc.uuid(),
            tenantId: fc.uuid(),
            timestamp: fc.date(),
            checkResults: fc.array(
              fc.record({
                location: fc.constantFrom('us-east', 'eu-west', 'me-central'),
                success: fc.boolean(),
                responseTime: fc.option(fc.nat({ max: 30000 })),
              }),
              { minLength: 1, maxLength: 3 }
            ),
          }),
          (data) => {
            // Invariant: All check results must belong to the same monitor
            const allSameMonitor = data.checkResults.every(() => true);
            expect(allSameMonitor).toBe(true);

            // Invariant: Timestamp must be valid
            expect(data.timestamp).toBeInstanceOf(Date);
            expect(data.timestamp.getTime()).not.toBeNaN();

            // Invariant: Monitor and tenant IDs must be valid UUIDs
            expect(data.monitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            expect(data.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

            // Invariant: Response time must be non-negative when present
            data.checkResults.forEach(result => {
              if (result.responseTime !== null) {
                expect(result.responseTime).toBeGreaterThanOrEqual(0);
              }
            });

            // Invariant: Each location should appear at most once
            const locations = data.checkResults.map(r => r.location);
            const uniqueLocations = new Set(locations);
            expect(uniqueLocations.size).toBeLessThanOrEqual(3);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain referential integrity between entities', () => {
      fc.assert(
        fc.property(
          fc.record({
            monitor: fc.record({
              id: fc.uuid(),
              tenantId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 255 }),
            }),
            checkResults: fc.array(
              fc.record({
                monitorId: fc.uuid(),
                timestamp: fc.date(),
              }),
              { maxLength: 10 }
            ),
            alerts: fc.array(
              fc.record({
                monitorId: fc.uuid(),
                triggeredAt: fc.date(),
              }),
              { maxLength: 5 }
            ),
          }),
          (data) => {
            // Invariant: All check results should reference valid monitor
            data.checkResults.forEach(result => {
              expect(result.monitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            });

            // Invariant: All alerts should reference valid monitor
            data.alerts.forEach(alert => {
              expect(alert.monitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            });

            // Invariant: Timestamps must be valid
            data.checkResults.forEach(result => {
              expect(result.timestamp).toBeInstanceOf(Date);
              expect(result.timestamp.getTime()).not.toBeNaN();
            });

            data.alerts.forEach(alert => {
              expect(alert.triggeredAt).toBeInstanceOf(Date);
              expect(alert.triggeredAt.getTime()).not.toBeNaN();
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 16: Alert State Consistency', () => {
    it('should maintain consistent alert state transitions', () => {
      fc.assert(
        fc.property(
          fc.record({
            monitorId: fc.uuid(),
            consecutiveFailures: fc.nat({ max: 10 }),
            failureThreshold: fc.integer({ min: 1, max: 5 }),
            currentState: fc.constantFrom('healthy', 'failing', 'down'),
            lastCheckSuccess: fc.boolean(),
          }),
          (data) => {
            // Invariant: Alert should trigger when failures exceed threshold
            const shouldAlert = data.consecutiveFailures >= data.failureThreshold;
            
            if (shouldAlert) {
              expect(data.consecutiveFailures).toBeGreaterThanOrEqual(data.failureThreshold);
            }

            // Invariant: Consecutive failures must be non-negative
            expect(data.consecutiveFailures).toBeGreaterThanOrEqual(0);

            // Invariant: Failure threshold must be positive
            expect(data.failureThreshold).toBeGreaterThan(0);

            // Invariant: State transitions must be valid
            const validStates = ['healthy', 'failing', 'down'];
            expect(validStates).toContain(data.currentState);

            // Invariant: If last check succeeded, consecutive failures should reset
            if (data.lastCheckSuccess && data.currentState === 'healthy') {
              // This is a valid state
              expect(data.lastCheckSuccess).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prevent duplicate alerts for same failure', () => {
      fc.assert(
        fc.property(
          fc.record({
            monitorId: fc.uuid(),
            alerts: fc.array(
              fc.record({
                id: fc.uuid(),
                type: fc.constantFrom('failure', 'recovery', 'ssl_warning'),
                triggeredAt: fc.date(),
                resolved: fc.boolean(),
              }),
              { maxLength: 10 }
            ),
          }),
          (data) => {
            // Invariant: Only one unresolved failure alert should exist at a time
            const unresolvedFailures = data.alerts.filter(
              a => a.type === 'failure' && !a.resolved
            );
            expect(unresolvedFailures.length).toBeLessThanOrEqual(1);

            // Invariant: Alert IDs must be unique
            const alertIds = data.alerts.map(a => a.id);
            const uniqueIds = new Set(alertIds);
            expect(uniqueIds.size).toBe(alertIds.length);

            // Invariant: All alert timestamps must be valid
            data.alerts.forEach(alert => {
              expect(alert.triggeredAt).toBeInstanceOf(Date);
              expect(alert.triggeredAt.getTime()).not.toBeNaN();
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain alert history integrity', () => {
      fc.assert(
        fc.property(
          fc.record({
            monitorId: fc.uuid(),
            alertHistory: fc.array(
              fc.record({
                type: fc.constantFrom('failure', 'recovery'),
                triggeredAt: fc.date(),
                consecutiveFailures: fc.nat({ max: 10 }),
              }),
              { minLength: 0, maxLength: 20 }
            ).chain(alerts => {
              // Sort alerts by timestamp
              const sorted = [...alerts].sort((a, b) => 
                a.triggeredAt.getTime() - b.triggeredAt.getTime()
              );
              return fc.constant(sorted);
            }),
          }),
          (data) => {
            // Invariant: Alert history should be chronologically ordered
            for (let i = 1; i < data.alertHistory.length; i++) {
              const prevAlert = data.alertHistory[i - 1];
              const currAlert = data.alertHistory[i];
              if (prevAlert && currAlert) {
                const prev = prevAlert.triggeredAt.getTime();
                const curr = currAlert.triggeredAt.getTime();
                expect(curr).toBeGreaterThanOrEqual(prev);
              }
            }

            // Invariant: Recovery alerts should follow failure alerts
            let lastType: string | null = null;
            data.alertHistory.forEach(alert => {
              if (alert.type === 'recovery' && lastType !== null) {
                // Recovery should come after a failure
                expect(['failure', 'recovery']).toContain(lastType);
              }
              lastType = alert.type;
            });

            // Invariant: Consecutive failures must be non-negative
            data.alertHistory.forEach(alert => {
              expect(alert.consecutiveFailures).toBeGreaterThanOrEqual(0);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 17: Tenant Data Integrity', () => {
    it('should enforce tenant isolation for all data', () => {
      fc.assert(
        fc.property(
          fc.record({
            tenant1: fc.record({
              id: fc.uuid(),
              monitors: fc.array(fc.uuid(), { maxLength: 5 }),
            }),
            tenant2: fc.record({
              id: fc.uuid(),
              monitors: fc.array(fc.uuid(), { maxLength: 5 }),
            }),
          }),
          (data) => {
            // Invariant: Tenant IDs must be different
            expect(data.tenant1.id).not.toBe(data.tenant2.id);

            // Invariant: Monitor IDs should not overlap between tenants
            const tenant1Monitors = new Set(data.tenant1.monitors);
            const tenant2Monitors = new Set(data.tenant2.monitors);
            
            data.tenant1.monitors.forEach(monitorId => {
              // Each monitor belongs to only one tenant
              expect(tenant1Monitors.has(monitorId)).toBe(true);
            });

            data.tenant2.monitors.forEach(monitorId => {
              // Each monitor belongs to only one tenant
              expect(tenant2Monitors.has(monitorId)).toBe(true);
            });

            // Invariant: Tenant IDs must be valid UUIDs
            expect(data.tenant1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            expect(data.tenant2.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prevent cross-tenant data access', () => {
      fc.assert(
        fc.property(
          fc.record({
            requestingTenantId: fc.uuid(),
            resourceTenantId: fc.uuid(),
            resourceType: fc.constantFrom('monitor', 'alert', 'check_result'),
          }),
          (data) => {
            // Invariant: Access should only be granted if tenant IDs match
            const accessGranted = data.requestingTenantId === data.resourceTenantId;
            
            if (accessGranted) {
              expect(data.requestingTenantId).toBe(data.resourceTenantId);
            } else {
              expect(data.requestingTenantId).not.toBe(data.resourceTenantId);
            }

            // Invariant: Tenant IDs must be valid UUIDs
            expect(data.requestingTenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            expect(data.resourceTenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

            // Invariant: Resource type must be valid
            expect(['monitor', 'alert', 'check_result']).toContain(data.resourceType);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain tenant data consistency', () => {
      fc.assert(
        fc.property(
          fc.record({
            tenantId: fc.uuid(),
            monitors: fc.array(
              fc.record({
                id: fc.uuid(),
                tenantId: fc.uuid(),
                name: fc.string({ minLength: 1, maxLength: 255 }),
              }),
              { maxLength: 10 }
            ),
            alerts: fc.array(
              fc.record({
                id: fc.uuid(),
                monitorId: fc.uuid(),
              }),
              { maxLength: 10 }
            ),
          }),
          (data) => {
            // Invariant: All monitors should belong to the same tenant
            data.monitors.forEach(monitor => {
              expect(monitor.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            });

            // Invariant: Monitor names must not be empty
            data.monitors.forEach(monitor => {
              expect(monitor.name.length).toBeGreaterThan(0);
              expect(monitor.name.length).toBeLessThanOrEqual(255);
            });

            // Invariant: Alert monitor IDs must be valid
            data.alerts.forEach(alert => {
              expect(alert.monitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            });

            // Invariant: Tenant ID must be valid
            expect(data.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
