/**
 * Property-Based Tests for Monitor API Parameter Validation
 * Feature: url-monitoring, Property 13: Monitor API Parameter Validation
 * 
 * Tests that monitor API parameter validation correctly accepts valid inputs
 * and rejects invalid inputs across all possible parameter combinations.
 */

import * as fc from 'fast-check';
import { validateMonitor, validateUrl } from '../src/utils/validation';
import { CheckInterval, ProbeLocation } from '../src/types';

describe('Monitor API Parameter Validation Properties', () => {
  /**
   * Property 13: Monitor API Parameter Validation
   * For any monitor configuration, the validation should correctly identify
   * valid and invalid parameters according to the business rules.
   * 
   * Validates: Requirements 2.4
   */
  test('Property 13: Monitor API Parameter Validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          tenantId: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 255 }),
          url: fc.webUrl(),
          checkInterval: fc.constantFrom(
            CheckInterval.ONE_MINUTE,
            CheckInterval.FIVE_MINUTES
          ),
          timeoutSeconds: fc.integer({ min: 1, max: 60 }),
          expectedStatusCodes: fc.array(fc.integer({ min: 100, max: 599 }), {
            minLength: 1,
            maxLength: 10,
          }),
          probeLocations: fc.array(
            fc.constantFrom(
              ProbeLocation.US_EAST,
              ProbeLocation.EU_WEST,
              ProbeLocation.ME_CENTRAL
            ),
            { minLength: 1, maxLength: 3 }
          ),
          failureThreshold: fc.integer({ min: 1, max: 10 }),
        }),
        (validMonitor) => {
          // Valid monitor configurations should pass validation
          const result = validateMonitor(validMonitor);
          
          // Should be valid
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
          
          // URL validation should also pass
          const urlResult = validateUrl(validMonitor.url);
          expect(urlResult.isValid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.1: Invalid monitor names should be rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''), // empty string
          fc.constant('   '), // whitespace only
          fc.string({ minLength: 256, maxLength: 300 }) // too long
        ),
        fc.uuid(),
        fc.webUrl(),
        fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        fc.integer({ min: 1, max: 60 }),
        (invalidName, tenantId, url, interval, timeout) => {
          const monitor = {
            tenantId,
            name: invalidName,
            url,
            checkInterval: interval,
            timeoutSeconds: timeout,
            expectedStatusCodes: [200],
            probeLocations: [ProbeLocation.US_EAST],
            failureThreshold: 3,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          
          // Should have a name-related error
          const hasNameError = result.errors.some(
            (err) => err.field === 'name'
          );
          expect(hasNameError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.2: Invalid URLs should be rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('not-a-url'),
          fc.constant('ftp://invalid-protocol.com'),
          fc.constant('javascript:alert(1)'),
          fc.constant(''),
          fc.constant('   ')
        ),
        (invalidUrl) => {
          // URL validation should fail
          const urlResult = validateUrl(invalidUrl);
          expect(urlResult.isValid).toBe(false);
          expect(urlResult.errors.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.3: Invalid check intervals should be rejected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.webUrl(),
        fc.integer().filter(
          (n) => n !== CheckInterval.ONE_MINUTE && n !== CheckInterval.FIVE_MINUTES
        ),
        fc.integer({ min: 1, max: 60 }),
        (tenantId, name, url, invalidInterval, timeout) => {
          const monitor = {
            tenantId,
            name,
            url,
            checkInterval: invalidInterval,
            timeoutSeconds: timeout,
            expectedStatusCodes: [200],
            probeLocations: [ProbeLocation.US_EAST],
            failureThreshold: 3,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          
          // Should have an interval-related error
          const hasIntervalError = result.errors.some(
            (err) => err.field === 'checkInterval'
          );
          expect(hasIntervalError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.4: Invalid timeout values should be rejected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.webUrl(),
        fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        fc.oneof(
          fc.integer({ max: 0 }), // zero or negative
          fc.integer({ min: 301, max: 1000 }) // too large (> 300)
        ),
        (tenantId, name, url, interval, invalidTimeout) => {
          const monitor = {
            tenantId,
            name,
            url,
            checkInterval: interval,
            timeoutSeconds: invalidTimeout,
            expectedStatusCodes: [200],
            probeLocations: [ProbeLocation.US_EAST],
            failureThreshold: 3,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          
          // Should have a timeout-related error
          const hasTimeoutError = result.errors.some(
            (err) => err.field === 'timeoutSeconds'
          );
          expect(hasTimeoutError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.5: Empty probe locations should be rejected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.webUrl(),
        fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        fc.integer({ min: 1, max: 60 }),
        (tenantId, name, url, interval, timeout) => {
          const monitor = {
            tenantId,
            name,
            url,
            checkInterval: interval,
            timeoutSeconds: timeout,
            expectedStatusCodes: [200],
            probeLocations: [], // empty array
            failureThreshold: 3,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          
          // Should have a probe locations error
          const hasLocationError = result.errors.some(
            (err) => err.field === 'probeLocations'
          );
          expect(hasLocationError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.6: Invalid status codes should be rejected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.webUrl(),
        fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        fc.integer({ min: 1, max: 60 }),
        fc.oneof(
          fc.constant([]), // empty array
          fc.array(fc.integer({ min: 600, max: 999 }), { minLength: 1 }), // invalid codes
          fc.array(fc.integer({ max: 99 }), { minLength: 1 }) // invalid codes
        ),
        (tenantId, name, url, interval, timeout, invalidCodes) => {
          const monitor = {
            tenantId,
            name,
            url,
            checkInterval: interval,
            timeoutSeconds: timeout,
            expectedStatusCodes: invalidCodes,
            probeLocations: [ProbeLocation.US_EAST],
            failureThreshold: 3,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          
          // Should have a status codes error
          const hasStatusCodeError = result.errors.some(
            (err) => err.field === 'expectedStatusCodes'
          );
          expect(hasStatusCodeError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 13.7: Invalid failure thresholds should be rejected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.webUrl(),
        fc.constantFrom(CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES),
        fc.integer({ min: 1, max: 60 }),
        fc.oneof(
          fc.integer({ max: 0 }), // zero or negative
          fc.integer({ min: 11, max: 100 }) // too large
        ),
        (tenantId, name, url, interval, timeout, invalidThreshold) => {
          const monitor = {
            tenantId,
            name,
            url,
            checkInterval: interval,
            timeoutSeconds: timeout,
            expectedStatusCodes: [200],
            probeLocations: [ProbeLocation.US_EAST],
            failureThreshold: invalidThreshold,
          };

          const result = validateMonitor(monitor);
          
          // Should be invalid
          expect(result.isValid).toBe(false);
          
          // Should have a failure threshold error
          const hasThresholdError = result.errors.some(
            (err) => err.field === 'failureThreshold'
          );
          expect(hasThresholdError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
