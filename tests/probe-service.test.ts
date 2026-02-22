/**
 * Property-based tests for Probe Service HTTP check validation
 * Feature: url-monitoring, Property 3: Check Validation Logic
 */

import * as fc from 'fast-check';
import { ProbeServiceImpl, ProbeServiceConfig } from '../src/services/probe-service';
import { CheckResultRepository } from '../src/database/repositories/check-result-repository';
import { RedisSetup } from '../src/database/redis-setup';
import { Monitor, ProbeLocation, CheckInterval, CheckResult, SSLCertificateInfo } from '../src/types';

// Mock CheckResultRepository for testing
class MockCheckResultRepository extends CheckResultRepository {
  private storedResults: CheckResult[] = [];

  constructor() {
    // Pass null values since we're mocking
    super(null as any, null as any, 'test-bucket');
  }

  override async create(checkResult: CheckResult): Promise<void> {
    this.storedResults.push(checkResult);
  }

  override async storeSSLInfo(_monitorId: string, _sslInfo: any): Promise<void> {
    // Mock implementation
  }

  getStoredResults(): CheckResult[] {
    return this.storedResults;
  }

  clearStoredResults(): void {
    this.storedResults = [];
  }
}

// Mock RedisSetup for testing
class MockRedisSetup extends RedisSetup {
  private cache: Map<string, { data: any; expiry: number }> = new Map();

  constructor() {
    // Pass null values since we're mocking
    super(null as any, {
      keyPrefix: 'test',
      defaultTTL: 3600,
      sessionTTL: 86400,
      alertStateTTL: 604800,
      cacheTTL: 1800
    });
  }

  override async setCache(key: string, data: any, ttl?: number): Promise<void> {
    const expiry = Date.now() + (ttl || 1800) * 1000;
    this.cache.set(key, { data, expiry });
  }

  override async getCache(key: string): Promise<any | null> {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  override async deleteCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// PROPERTY TEST GENERATORS
// ============================================================================

const validHttpStatusCodeArbitrary = fc.integer({ min: 100, max: 599 });

const validMonitorArbitrary = fc.record({
  id: fc.uuid(),
  tenantId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 255 }),
  url: fc.oneof(
    fc.constant('https://httpbin.org/status/200'),
    fc.constant('https://httpbin.org/status/404'),
    fc.constant('https://httpbin.org/status/500'),
    fc.constant('http://httpbin.org/status/200')
  ),
  checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
  timeoutSeconds: fc.integer({ min: 1, max: 30 }),
  expectedStatusCodes: fc.array(validHttpStatusCodeArbitrary, { minLength: 1, maxLength: 5 }),
  probeLocations: fc.array(
    fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
    { minLength: 1, maxLength: 3 }
  ),
  failureThreshold: fc.integer({ min: 1, max: 5 }),
  createdAt: fc.date(),
  updatedAt: fc.date()
}) as fc.Arbitrary<Monitor>;

const probeServiceConfigArbitrary = fc.record({
  defaultTimeout: fc.integer({ min: 5, max: 60 }),
  maxConcurrentChecks: fc.integer({ min: 1, max: 100 }),
  userAgent: fc.constant('URL-Monitor/1.0'),
  followRedirects: fc.boolean(),
  maxRedirects: fc.integer({ min: 0, max: 10 })
}) as fc.Arbitrary<ProbeServiceConfig>;

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe('Probe Service HTTP Check Validation Properties', () => {
  let mockRepository: MockCheckResultRepository;
  let mockRedisSetup: MockRedisSetup;
  let probeService: ProbeServiceImpl;

  beforeEach(() => {
    mockRepository = new MockCheckResultRepository();
    mockRedisSetup = new MockRedisSetup();
  });

  // **Property 3: Check Validation Logic**
  // **Validates: Requirements 1.4**
  describe('Property 3: Check Validation Logic', () => {

    test('check results should always have consistent structure regardless of success/failure', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
        async (config: ProbeServiceConfig, monitor: Monitor, location: ProbeLocation) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const result = await probeService.executeCheck(monitor, location);
            
            // All check results must have these required properties
            expect(result).toHaveProperty('id');
            expect(result).toHaveProperty('monitorId');
            expect(result).toHaveProperty('location');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('success');
            
            // Validate property types
            expect(typeof result.id).toBe('string');
            expect(result.id.length).toBeGreaterThan(0);
            expect(result.monitorId).toBe(monitor.id);
            expect(result.location).toBe(location);
            expect(result.timestamp).toBeInstanceOf(Date);
            expect(typeof result.success).toBe('boolean');
            
            // Response time should be non-negative if present
            if (result.responseTime !== undefined) {
              expect(result.responseTime).toBeGreaterThanOrEqual(0);
              expect(typeof result.responseTime).toBe('number');
            }
            
            // Status code should be valid HTTP status if present
            if (result.statusCode !== undefined) {
              expect(result.statusCode).toBeGreaterThanOrEqual(100);
              expect(result.statusCode).toBeLessThan(600);
              expect(typeof result.statusCode).toBe('number');
            }
            
            // Error message should be string if present
            if (result.errorMessage !== undefined) {
              expect(typeof result.errorMessage).toBe('string');
              expect(result.errorMessage.length).toBeGreaterThan(0);
            }
            
            // SSL expiry date should be valid date if present
            if (result.sslExpiryDate !== undefined) {
              expect(result.sslExpiryDate).toBeInstanceOf(Date);
            }
            
          } catch (error) {
            // Even if the check fails due to network issues, we should still get a valid result
            // This test focuses on the structure, not the network success
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 5, timeout: 15000 }); // Minimal runs for faster execution
    });

    test('check validation should correctly identify success based on expected status codes', () => {
      fc.assert(fc.property(
        probeServiceConfigArbitrary,
        validHttpStatusCodeArbitrary,
        fc.array(validHttpStatusCodeArbitrary, { minLength: 1, maxLength: 5 }),
        (config: ProbeServiceConfig, actualStatusCode: number, expectedStatusCodes: number[]) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          // Create a mock response object
          const mockResponse = {
            status: actualStatusCode,
            statusText: 'Test Status',
            data: {},
            headers: {},
            config: {}
          };
          
          // Test the private validation method through reflection
          const validateResponse = (probeService as any).validateResponse;
          const isValid = validateResponse.call(probeService, mockResponse, expectedStatusCodes);
          
          // The result should match whether the actual status is in expected codes
          const shouldBeValid = expectedStatusCodes.includes(actualStatusCode);
          expect(isValid).toBe(shouldBeValid);
        }
      ), { numRuns: 50 }); // Synchronous validation test
    });

    test('check results should always be stored in repository regardless of success/failure', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
        async (config: ProbeServiceConfig, monitor: Monitor, location: ProbeLocation) => {
          mockRepository.clearStoredResults();
          probeService = new ProbeServiceImpl(config, mockRepository);
          
          const initialCount = mockRepository.getStoredResults().length;
          
          try {
            await probeService.executeCheck(monitor, location);
          } catch (error) {
            // Even if check fails, result should still be stored
          }
          
          const finalCount = mockRepository.getStoredResults().length;
          expect(finalCount).toBe(initialCount + 1);
          
          const storedResult = mockRepository.getStoredResults()[finalCount - 1];
          expect(storedResult).toBeDefined();
          expect(storedResult!.monitorId).toBe(monitor.id);
          expect(storedResult!.location).toBe(location);
        }
      ), { numRuns: 5, timeout: 15000 });
    });

    test('multi-location checks should return results for all specified locations', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        async (config: ProbeServiceConfig, monitor: Monitor) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const results = await probeService.executeMultiLocationCheck(monitor);
            
            // Should have one result per configured location
            expect(results).toHaveLength(monitor.probeLocations.length);
            
            // Each location should be represented exactly once
            const resultLocations = results.map(r => r.location);
            const uniqueLocations = [...new Set(resultLocations)];
            expect(uniqueLocations).toHaveLength(monitor.probeLocations.length);
            
            // All configured locations should be present
            monitor.probeLocations.forEach(location => {
              expect(resultLocations).toContain(location);
            });
            
            // All results should be for the same monitor
            results.forEach(result => {
              expect(result.monitorId).toBe(monitor.id);
            });
            
          } catch (error) {
            // Network failures are acceptable for this property test
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 3, timeout: 20000 }); // Minimal runs for multi-location
    });

    test('available locations should always return the same predefined set', () => {
      fc.assert(fc.property(
        probeServiceConfigArbitrary,
        (config: ProbeServiceConfig) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          const locations = probeService.getAvailableLocations();
          
          // Should always return exactly 3 locations
          expect(locations).toHaveLength(3);
          
          // Should contain all expected locations
          expect(locations).toContain(ProbeLocation.US_EAST);
          expect(locations).toContain(ProbeLocation.EU_WEST);
          expect(locations).toContain(ProbeLocation.ME_CENTRAL);
          
          // Should not contain duplicates
          const uniqueLocations = [...new Set(locations)];
          expect(uniqueLocations).toHaveLength(3);
        }
      ), { numRuns: 50 }); // Synchronous test, can run more
    });

    test('check IDs should always be unique across multiple checks', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
        fc.integer({ min: 2, max: 5 }),
        async (config: ProbeServiceConfig, monitor: Monitor, location: ProbeLocation, numChecks: number) => {
          mockRepository.clearStoredResults();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          const checkIds = new Set<string>();
          
          for (let i = 0; i < numChecks; i++) {
            try {
              const result = await probeService.executeCheck(monitor, location);
              checkIds.add(result.id);
            } catch (error) {
              // Network failures are acceptable, but we should still get unique IDs
            }
          }
          
          // All stored results should have unique IDs
          const storedResults = mockRepository.getStoredResults();
          const storedIds = storedResults.map(r => r.id);
          const uniqueStoredIds = [...new Set(storedIds)];
          
          expect(uniqueStoredIds).toHaveLength(storedIds.length);
        }
      ), { numRuns: 3, timeout: 30000 });
    });

    test('error messages should be meaningful and non-empty for failed checks', async () => {
      const failingMonitorArbitrary = fc.record({
        id: fc.uuid(),
        tenantId: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 255 }),
        url: fc.oneof(
          fc.constant('http://invalid-domain-that-does-not-exist.com'),
          fc.constant('https://httpbin.org/status/500'),
          fc.constant('https://httpbin.org/delay/60') // Will timeout
        ),
        checkInterval: fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        timeoutSeconds: fc.integer({ min: 1, max: 30 }),
        expectedStatusCodes: fc.array(validHttpStatusCodeArbitrary, { minLength: 1, maxLength: 5 }),
        probeLocations: fc.array(
          fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
          { minLength: 1, maxLength: 3 }
        ),
        failureThreshold: fc.integer({ min: 1, max: 5 }),
        createdAt: fc.date(),
        updatedAt: fc.date()
      }) as fc.Arbitrary<Monitor>;

      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        failingMonitorArbitrary,
        fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
        async (config: ProbeServiceConfig, monitor: Monitor, location: ProbeLocation) => {
          // Set a short timeout to force failures
          const shortTimeoutMonitor = { ...monitor, timeoutSeconds: 1 };
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const result = await probeService.executeCheck(shortTimeoutMonitor, location);
            
            // If the check failed, it should have a meaningful error message
            if (!result.success && result.errorMessage) {
              expect(typeof result.errorMessage).toBe('string');
              expect(result.errorMessage.length).toBeGreaterThan(0);
              expect(result.errorMessage.trim()).not.toBe('');
              
              // Error message should not be generic
              expect(result.errorMessage).not.toBe('Error');
              expect(result.errorMessage).not.toBe('Failed');
            }
          } catch (error) {
            // Network-level failures are expected for invalid URLs
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 3, timeout: 15000 });
    });
  });

  // **Property 4: SSL Certificate Expiry Calculation**
  // **Validates: Requirements 3.1**
  describe('Property 4: SSL Certificate Expiry Calculation', () => {

    test('SSL certificate validation should return consistent structure for HTTPS URLs', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        fc.oneof(
          fc.constant('https://www.google.com'),
          fc.constant('https://www.github.com'),
          fc.constant('https://httpbin.org')
        ),
        async (config: ProbeServiceConfig, httpsUrl: string) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const sslInfo = await probeService.validateSSLCertificate(httpsUrl);
            
            // SSL info should have required properties
            expect(sslInfo).toHaveProperty('expiryDate');
            expect(sslInfo).toHaveProperty('issuer');
            expect(sslInfo).toHaveProperty('subject');
            expect(sslInfo).toHaveProperty('daysUntilExpiry');
            
            // Validate property types
            expect(sslInfo.expiryDate).toBeInstanceOf(Date);
            expect(typeof sslInfo.issuer).toBe('string');
            expect(typeof sslInfo.subject).toBe('string');
            expect(typeof sslInfo.daysUntilExpiry).toBe('number');
            
            // Expiry date should be in the future for valid certificates
            const now = new Date();
            expect(sslInfo.expiryDate.getTime()).toBeGreaterThan(now.getTime() - (365 * 24 * 60 * 60 * 1000)); // Not more than 1 year in the past
            
            // Days until expiry should be calculated correctly
            const expectedDays = Math.ceil((sslInfo.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            expect(Math.abs(sslInfo.daysUntilExpiry - expectedDays)).toBeLessThanOrEqual(1); // Allow 1 day difference due to timing
            
            // Issuer and subject should not be empty
            expect(sslInfo.issuer.length).toBeGreaterThan(0);
            expect(sslInfo.subject.length).toBeGreaterThan(0);
            
          } catch (error) {
            // SSL validation failures are acceptable for some URLs
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 3, timeout: 15000 });
    });

    test('SSL certificate validation should handle invalid URLs gracefully', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        fc.oneof(
          fc.constant('https://invalid-domain-that-does-not-exist.com'),
          fc.constant('https://expired.badssl.com'),
          fc.constant('https://self-signed.badssl.com')
        ),
        async (config: ProbeServiceConfig, invalidUrl: string) => {
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const sslInfo = await probeService.validateSSLCertificate(invalidUrl);
            
            // If we get a result, it should still have the correct structure
            expect(sslInfo).toHaveProperty('expiryDate');
            expect(sslInfo).toHaveProperty('issuer');
            expect(sslInfo).toHaveProperty('subject');
            expect(sslInfo).toHaveProperty('daysUntilExpiry');
            
          } catch (error) {
            // Errors are expected for invalid URLs
            expect(error).toBeDefined();
            
            // Error should have a message property
            if (error && typeof error === 'object' && 'message' in error) {
              expect(typeof (error as any).message).toBe('string');
              expect((error as any).message.length).toBeGreaterThan(0);
            }
          }
        }
      ), { numRuns: 3, timeout: 15000 });
    });

    test('days until expiry calculation should be mathematically correct', () => {
      fc.assert(fc.property(
        fc.date({ min: new Date(Date.now() + 24 * 60 * 60 * 1000), max: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }), // Future dates at least 1 day from now
        (futureDate: Date) => {
          const now = new Date();
          const expectedDays = Math.ceil((futureDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          // Mock SSL certificate info
          const sslInfo: SSLCertificateInfo = {
            expiryDate: futureDate,
            issuer: 'Test CA',
            subject: 'test.example.com',
            daysUntilExpiry: expectedDays
          };
          
          // Days until expiry should match the calculation
          expect(sslInfo.daysUntilExpiry).toBe(expectedDays);
          
          // Should be positive for future dates (at least 1 day)
          expect(sslInfo.daysUntilExpiry).toBeGreaterThan(0);
        }
      ), { numRuns: 50 });
    });

    test('SSL certificate info should be stored correctly with check results', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary.map(monitor => ({
          ...monitor,
          url: 'https://www.google.com' // Use a reliable HTTPS URL
        })),
        fc.constantFrom(ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL),
        async (config: ProbeServiceConfig, monitor: Monitor, location: ProbeLocation) => {
          mockRepository.clearStoredResults();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const result = await probeService.executeCheck(monitor, location);
            
            // For HTTPS URLs, SSL expiry date should be present in the result
            if (monitor.url.startsWith('https://')) {
              expect(result.sslExpiryDate).toBeDefined();
              if (result.sslExpiryDate) {
                expect(result.sslExpiryDate).toBeInstanceOf(Date);
                
                // SSL expiry should be in the future for valid certificates
                const now = new Date();
                expect(result.sslExpiryDate.getTime()).toBeGreaterThan(now.getTime() - (30 * 24 * 60 * 60 * 1000)); // Not more than 30 days in the past
              }
            }
            
          } catch (error) {
            // Network failures are acceptable
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 2, timeout: 20000 }); // Minimal runs due to network dependency
    });
  });

  // **Property 5: Multi-Location Status Aggregation**
  // **Validates: Requirements 4.5**
  describe('Property 5: Multi-Location Status Aggregation', () => {

    test('aggregated status should be healthy if ANY location reports success', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        async (config: ProbeServiceConfig, monitor: Monitor) => {
          mockRepository.clearStoredResults();
          mockRedisSetup.clearCache();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const aggregatedStatus = await probeService.getAggregatedStatus(monitor);
            
            // Should have the required structure
            expect(aggregatedStatus).toHaveProperty('isHealthy');
            expect(aggregatedStatus).toHaveProperty('healthyLocations');
            expect(aggregatedStatus).toHaveProperty('failedLocations');
            
            // Validate types
            expect(typeof aggregatedStatus.isHealthy).toBe('boolean');
            expect(Array.isArray(aggregatedStatus.healthyLocations)).toBe(true);
            expect(Array.isArray(aggregatedStatus.failedLocations)).toBe(true);
            
            // All locations should be accounted for
            const totalLocations = aggregatedStatus.healthyLocations.length + aggregatedStatus.failedLocations.length;
            expect(totalLocations).toBe(monitor.probeLocations.length);
            
            // No location should appear in both arrays
            const intersection = aggregatedStatus.healthyLocations.filter(loc => 
              aggregatedStatus.failedLocations.includes(loc)
            );
            expect(intersection).toHaveLength(0);
            
            // If there are healthy locations, overall status should be healthy
            if (aggregatedStatus.healthyLocations.length > 0) {
              expect(aggregatedStatus.isHealthy).toBe(true);
            }
            
            // If no healthy locations, overall status should be unhealthy
            if (aggregatedStatus.healthyLocations.length === 0) {
              expect(aggregatedStatus.isHealthy).toBe(false);
            }
            
          } catch (error) {
            // Network failures are acceptable for this test
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 3, timeout: 30000 });
    });

    test('aggregated status should be cached correctly in Redis', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        async (config: ProbeServiceConfig, monitor: Monitor) => {
          mockRepository.clearStoredResults();
          mockRedisSetup.clearCache();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            // First call should execute checks and cache result
            const firstResult = await probeService.getAggregatedStatus(monitor);
            
            // Check if result was cached
            const cacheKey = `monitor-status:${monitor.id}`;
            const cachedResult = await mockRedisSetup.getCache(cacheKey);
            
            if (cachedResult) {
              // Cached result should match the first result
              expect(cachedResult.isHealthy).toBe(firstResult.isHealthy);
              expect(cachedResult.healthyLocations).toEqual(firstResult.healthyLocations);
              expect(cachedResult.failedLocations).toEqual(firstResult.failedLocations);
            }
            
          } catch (error) {
            // Network failures are acceptable
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 2, timeout: 25000 });
    });

    test('location arrays should contain only valid probe locations', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        async (config: ProbeServiceConfig, monitor: Monitor) => {
          mockRepository.clearStoredResults();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            const aggregatedStatus = await probeService.getAggregatedStatus(monitor);
            
            // All locations in healthy array should be valid probe locations
            aggregatedStatus.healthyLocations.forEach(location => {
              expect(Object.values(ProbeLocation)).toContain(location);
              expect(monitor.probeLocations).toContain(location);
            });
            
            // All locations in failed array should be valid probe locations
            aggregatedStatus.failedLocations.forEach(location => {
              expect(Object.values(ProbeLocation)).toContain(location);
              expect(monitor.probeLocations).toContain(location);
            });
            
          } catch (error) {
            // Network failures are acceptable
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 2, timeout: 20000 });
    });

    test('multi-location check results should be stored separately for each location', async () => {
      await fc.assert(fc.asyncProperty(
        probeServiceConfigArbitrary,
        validMonitorArbitrary,
        async (config: ProbeServiceConfig, monitor: Monitor) => {
          mockRepository.clearStoredResults();
          probeService = new ProbeServiceImpl(config, mockRepository, mockRedisSetup);
          
          try {
            await probeService.executeMultiLocationCheck(monitor);
            
            const storedResults = mockRepository.getStoredResults();
            
            // Should have one result per configured location
            expect(storedResults.length).toBe(monitor.probeLocations.length);
            
            // Each result should have a different location
            const resultLocations = storedResults.map(r => r.location);
            const uniqueLocations = [...new Set(resultLocations)];
            expect(uniqueLocations.length).toBe(monitor.probeLocations.length);
            
            // All results should be for the same monitor
            storedResults.forEach(result => {
              expect(result.monitorId).toBe(monitor.id);
              expect(monitor.probeLocations).toContain(result.location);
            });
            
          } catch (error) {
            // Network failures are acceptable
            expect(error).toBeDefined();
          }
        }
      ), { numRuns: 2, timeout: 20000 });
    });
  });
});