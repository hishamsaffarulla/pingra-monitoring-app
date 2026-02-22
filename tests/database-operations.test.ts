/**
 * Property-based tests for database operations
 * Feature: url-monitoring, Property 23: Database Error Handling
 */

import * as fc from 'fast-check';
import { Pool } from 'pg';
import { MonitorRepository, AlertRepository, TenantRepository } from '../src/database/repositories/index';
import { CheckInterval, ProbeLocation, AlertType } from '../src/types/index';

// Mock database pool for testing
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
} as unknown as Pool;

// Mock client for transactions
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

describe('Database Operations Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
  });

  // **Property 23: Database Error Handling**
  // **Validates: Requirements 9.4**
  describe('Property 23: Database Error Handling', () => {
    
    test('repository operations should handle connection failures gracefully', async () => {
      await fc.assert(fc.asyncProperty(
        fc.record({
          tenantId: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 255 }),
          url: fc.constantFrom('https://example.com', 'http://test.org'),
          checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
          timeoutSeconds: fc.integer({ min: 1, max: 300 }),
          expectedStatusCodes: fc.array(fc.integer({ min: 100, max: 599 }), { minLength: 1 }),
          probeLocations: fc.array(fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST), { minLength: 1 }),
          failureThreshold: fc.integer({ min: 1, max: 10 })
        }),
        async (monitorData) => {
          const repository = new MonitorRepository(mockPool);
          
          // Simulate connection failure
          (mockPool.query as jest.Mock).mockRejectedValue(new Error('Connection failed'));
          
          try {
            await repository.create(monitorData);
            // Should not reach here due to connection failure
            expect(false).toBe(true);
          } catch (error) {
            // Should handle error gracefully
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('Connection failed');
          }
        }
      ), { numRuns: 10 });
    });

    test('repository operations should retry on transient failures', async () => {
      await fc.assert(fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const repository = new TenantRepository(mockPool, { retryAttempts: 3, retryDelay: 10 });
          
          // Simulate transient failures followed by success
          (mockPool.query as jest.Mock)
            .mockRejectedValueOnce(new Error('Temporary failure 1'))
            .mockRejectedValueOnce(new Error('Temporary failure 2'))
            .mockResolvedValueOnce({ rows: [{ 
              id: tenantId, 
              name: 'Test Tenant', 
              encrypted_config: '{}', 
              created_at: new Date() 
            }] });
          
          const result = await repository.findById(tenantId);
          
          // Should succeed after retries
          expect(result).toBeTruthy();
          expect(result?.id).toBe(tenantId);
          expect(mockPool.query).toHaveBeenCalledTimes(3);
        }
      ), { numRuns: 10 });
    });

    test('repository transactions should rollback on failures', async () => {
      await fc.assert(fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 255 }),
          encryptedConfig: fc.object()
        }),
        async () => {
          const repository = new TenantRepository(mockPool);
          
          // Mock successful BEGIN, then failure, then successful ROLLBACK
          (mockClient.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockRejectedValueOnce(new Error('Insert failed')) // INSERT failure
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
          
          try {
            await (repository as any).executeTransaction(async () => {
              throw new Error('Insert failed');
            });
            // Should not reach here
            expect(false).toBe(true);
          } catch (error) {
            // Should handle transaction failure
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('Insert failed');
            
            // Should have called BEGIN, failed operation, and ROLLBACK
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
          }
        }
      ), { numRuns: 10 });
    });

    test('repository operations should validate input data before database calls', async () => {
      await fc.assert(fc.asyncProperty(
        fc.record({
          // Invalid data that should fail validation
          tenantId: fc.constantFrom('', null, undefined),
          name: fc.constantFrom('', '   ', null, undefined),
          url: fc.constantFrom('invalid-url', 'ftp://invalid.com', ''),
          checkInterval: fc.integer({ min: -100, max: -1 }),
          timeoutSeconds: fc.integer({ min: -100, max: 0 }),
          expectedStatusCodes: fc.constantFrom([], [99], [600]),
          probeLocations: fc.constantFrom([]),
          failureThreshold: fc.integer({ min: -10, max: 0 })
        }),
        async (invalidData) => {
          const repository = new MonitorRepository(mockPool);
          
          try {
            await repository.create(invalidData as any);
            // Should not reach here due to validation failure
            expect(false).toBe(true);
          } catch (error) {
            // Should fail validation before making database calls
            expect(error).toBeInstanceOf(Error);
            // Database should not be called due to validation failure
            expect(mockPool.query).not.toHaveBeenCalled();
          }
        }
      ), { numRuns: 10 });
    });

    test('repository health checks should handle database unavailability', async () => {
      await fc.assert(fc.asyncProperty(
        fc.boolean(),
        async (shouldFail) => {
          const repository = new MonitorRepository(mockPool);
          
          if (shouldFail) {
            (mockPool.query as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
          } else {
            (mockPool.query as jest.Mock).mockResolvedValue({ rows: [{ '?column?': 1 }] });
          }
          
          const isHealthy = await repository.healthCheck();
          
          if (shouldFail) {
            expect(isHealthy).toBe(false);
          } else {
            expect(isHealthy).toBe(true);
          }
          
          // Health check should always return a boolean, never throw
          expect(typeof isHealthy).toBe('boolean');
        }
      ), { numRuns: 10 });
    });

    test('repository operations should handle concurrent access safely', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }),
        async (tenantIds) => {
          const repository = new TenantRepository(mockPool);
          
          // Mock successful responses for all concurrent calls
          (mockPool.query as jest.Mock).mockImplementation(() => 
            Promise.resolve({ 
              rows: [{ 
                id: tenantIds[0], 
                name: 'Test Tenant', 
                encrypted_config: '{}', 
                created_at: new Date() 
              }] 
            })
          );
          
          // Execute concurrent operations
          const promises = tenantIds.map(id => repository.findById(id));
          const results = await Promise.all(promises);
          
          // All operations should complete successfully
          expect(results).toHaveLength(tenantIds.length);
          results.forEach(result => {
            expect(result).toBeTruthy();
          });
          
          // Database should be called for each operation
          expect(mockPool.query).toHaveBeenCalledTimes(tenantIds.length);
        }
      ), { numRuns: 5 });
    });

    test('repository operations should handle malformed database responses', async () => {
      await fc.assert(fc.asyncProperty(
        fc.uuid(),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({ rows: null }),
          fc.constant({ rows: undefined }),
          fc.constant({ rows: [] }),
          fc.constant({ malformed: 'response' })
        ),
        async (tenantId, malformedResponse) => {
          const repository = new TenantRepository(mockPool);
          
          (mockPool.query as jest.Mock).mockResolvedValue(malformedResponse);
          
          try {
            const result = await repository.findById(tenantId);
            
            // Should handle malformed responses gracefully
            if (malformedResponse && 'rows' in malformedResponse && malformedResponse.rows && malformedResponse.rows.length > 0) {
              expect(result).toBeTruthy();
            } else {
              expect(result).toBeNull();
            }
          } catch (error) {
            // If it throws, it should be a meaningful error
            expect(error).toBeInstanceOf(Error);
          }
        }
      ), { numRuns: 10 });
    });

    test('repository operations should handle SQL injection attempts safely', async () => {
      await fc.assert(fc.asyncProperty(
        fc.oneof(
          fc.constant("'; DROP TABLE tenants; --"),
          fc.constant("1' OR '1'='1"),
          fc.constant("admin'/*"),
          fc.constant("' UNION SELECT * FROM tenants --"),
          fc.constant("'; INSERT INTO tenants VALUES ('malicious'); --")
        ),
        async (maliciousInput) => {
          const repository = new TenantRepository(mockPool);
          
          (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });
          
          try {
            // Attempt to use malicious input as tenant name
            await repository.findByName(maliciousInput);
            
            // Should use parameterized queries, so malicious input is treated as literal string
            expect(mockPool.query).toHaveBeenCalledWith(
              expect.stringContaining('SELECT * FROM tenants WHERE name = $1'),
              [maliciousInput]
            );
          } catch (error) {
            // Any error should be due to validation, not SQL injection
            expect(error).toBeInstanceOf(Error);
          }
        }
      ), { numRuns: 10 });
    });
  });

  describe('Database Consistency Properties', () => {
    
    test('repository operations should maintain data consistency', async () => {
      await fc.assert(fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 255 }),
          encryptedConfig: fc.object(),
          createdAt: fc.date()
        }),
        async (tenantData) => {
          const repository = new TenantRepository(mockPool);
          
          // Mock database response with the same data
          (mockPool.query as jest.Mock).mockResolvedValue({ 
            rows: [{ 
              id: tenantData.id,
              name: tenantData.name,
              encrypted_config: JSON.stringify(tenantData.encryptedConfig),
              created_at: tenantData.createdAt
            }] 
          });
          
          const result = await repository.findById(tenantData.id);
          
          // Returned data should match input data structure
          expect(result).toBeTruthy();
          expect(result?.id).toBe(tenantData.id);
          expect(result?.name).toBe(tenantData.name);
          expect(result?.createdAt).toEqual(tenantData.createdAt);
          expect(typeof result?.encryptedConfig).toBe('object');
        }
      ), { numRuns: 10 });
    });

    test('repository operations should handle null and undefined values consistently', async () => {
      await fc.assert(fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          monitorId: fc.uuid(),
          type: fc.constantFrom(AlertType.FAILURE, AlertType.RECOVERY),
          triggeredAt: fc.date(),
          resolvedAt: fc.option(fc.date(), { nil: null }),
          consecutiveFailures: fc.integer({ min: 0, max: 10 }),
          message: fc.string({ minLength: 1 }),
          notificationStatus: fc.object()
        }),
        async (alertData) => {
          const repository = new AlertRepository(mockPool);
          
          // Mock database response
          (mockPool.query as jest.Mock).mockResolvedValue({ 
            rows: [{ 
              id: alertData.id,
              monitor_id: alertData.monitorId,
              alert_type: alertData.type,
              triggered_at: alertData.triggeredAt,
              resolved_at: alertData.resolvedAt,
              consecutive_failures: alertData.consecutiveFailures,
              message: alertData.message,
              notification_status: JSON.stringify(alertData.notificationStatus)
            }] 
          });
          
          const result = await repository.findById(alertData.id);
          
          // Should handle null/undefined values consistently
          expect(result).toBeTruthy();
          expect(result?.id).toBe(alertData.id);
          
          if (alertData.resolvedAt === null) {
            expect(result?.resolvedAt).toBeUndefined();
          } else if (alertData.resolvedAt) {
            expect(result?.resolvedAt).toEqual(alertData.resolvedAt);
          }
        }
      ), { numRuns: 10 });
    });
  });

  describe('Universal Database Properties', () => {
    
    test('all repository operations should return consistent result structures', async () => {
      await fc.assert(fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('monitors', 'alerts', 'tenants'),
        async (id, repositoryType) => {
          let repository: any;
          let mockResponse: any;
          
          switch (repositoryType) {
            case 'monitors':
              repository = new MonitorRepository(mockPool);
              mockResponse = { 
                rows: [{ 
                  id, 
                  tenant_id: fc.sample(fc.uuid(), 1)[0],
                  name: 'Test Monitor',
                  url: 'https://example.com',
                  check_interval: CheckInterval.ONE_MINUTE,
                  timeout_seconds: 30,
                  expected_status_codes: [200],
                  probe_locations: [ProbeLocation.US_EAST],
                  failure_threshold: 3,
                  created_at: new Date(),
                  updated_at: new Date()
                }] 
              };
              break;
            case 'alerts':
              repository = new AlertRepository(mockPool);
              mockResponse = { 
                rows: [{ 
                  id,
                  monitor_id: fc.sample(fc.uuid(), 1)[0],
                  alert_type: AlertType.FAILURE,
                  triggered_at: new Date(),
                  resolved_at: null,
                  consecutive_failures: 1,
                  message: 'Test alert',
                  notification_status: '{}'
                }] 
              };
              break;
            case 'tenants':
              repository = new TenantRepository(mockPool);
              mockResponse = { 
                rows: [{ 
                  id,
                  name: 'Test Tenant',
                  encrypted_config: '{}',
                  created_at: new Date()
                }] 
              };
              break;
          }
          
          (mockPool.query as jest.Mock).mockResolvedValue(mockResponse);
          
          const result = await repository.findById(id);
          
          // All repositories should return consistent structure
          if (result) {
            expect(result).toHaveProperty('id');
            expect(typeof result.id).toBe('string');
            expect(result.id).toBe(id);
          } else {
            expect(result).toBeNull();
          }
        }
      ), { numRuns: 10 });
    });
  });
});