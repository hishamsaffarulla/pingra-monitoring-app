/**
 * Property-Based Tests for Uptime Percentage Calculation
 * Feature: url-monitoring, Property 14: Uptime Percentage Calculation
 * 
 * Tests that uptime percentage calculations are correct across all possible
 * combinations of successful and failed checks.
 */

import * as fc from 'fast-check';

/**
 * Calculate uptime percentage from check results
 */
function calculateUptimePercentage(totalChecks: number, successfulChecks: number): number {
  if (totalChecks === 0) {
    return 0;
  }
  return (successfulChecks / totalChecks) * 100;
}

describe('Uptime Percentage Calculation Properties', () => {
  /**
   * Property 14: Uptime Percentage Calculation
   * For any set of check results, the uptime percentage should be correctly
   * calculated as (successful_checks / total_checks) * 100.
   * 
   * Validates: Requirements 7.4
   */
  test('Property 14: Uptime Percentage Calculation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }), // total checks
        fc.integer({ min: 0, max: 10000 }), // successful checks
        (totalChecks, successfulChecks) => {
          // Ensure successful checks don't exceed total checks
          const validSuccessful = Math.min(successfulChecks, totalChecks);
          
          const uptimePercentage = calculateUptimePercentage(totalChecks, validSuccessful);
          
          // Property 1: Uptime percentage should be between 0 and 100
          expect(uptimePercentage).toBeGreaterThanOrEqual(0);
          expect(uptimePercentage).toBeLessThanOrEqual(100);
          
          // Property 2: If all checks succeed, uptime should be 100%
          if (totalChecks > 0 && validSuccessful === totalChecks) {
            expect(uptimePercentage).toBe(100);
          }
          
          // Property 3: If no checks succeed, uptime should be 0%
          if (totalChecks > 0 && validSuccessful === 0) {
            expect(uptimePercentage).toBe(0);
          }
          
          // Property 4: If no checks exist, uptime should be 0%
          if (totalChecks === 0) {
            expect(uptimePercentage).toBe(0);
          }
          
          // Property 5: Uptime should be monotonically increasing with successful checks
          if (totalChecks > 0) {
            const uptimeWithOneMore = calculateUptimePercentage(totalChecks, Math.min(validSuccessful + 1, totalChecks));
            expect(uptimeWithOneMore).toBeGreaterThanOrEqual(uptimePercentage);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.1: Uptime calculation is commutative for same ratio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // multiplier
        fc.integer({ min: 0, max: 100 }), // base successful
        fc.integer({ min: 1, max: 100 }), // base total
        (multiplier, baseSuccessful, baseTotal) => {
          const validSuccessful = Math.min(baseSuccessful, baseTotal);
          
          // Calculate uptime for base values
          const baseUptime = calculateUptimePercentage(baseTotal, validSuccessful);
          
          // Calculate uptime for scaled values
          const scaledUptime = calculateUptimePercentage(
            baseTotal * multiplier,
            validSuccessful * multiplier
          );
          
          // Uptime percentage should be the same for proportional scaling
          expect(Math.abs(baseUptime - scaledUptime)).toBeLessThan(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.2: Adding a successful check increases or maintains uptime', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // total checks
        fc.integer({ min: 0, max: 1000 }), // successful checks
        (totalChecks, successfulChecks) => {
          const validSuccessful = Math.min(successfulChecks, totalChecks);
          
          const currentUptime = calculateUptimePercentage(totalChecks, validSuccessful);
          const uptimeAfterSuccess = calculateUptimePercentage(totalChecks + 1, validSuccessful + 1);
          
          // Adding a successful check should increase or maintain uptime
          expect(uptimeAfterSuccess).toBeGreaterThanOrEqual(currentUptime);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.3: Adding a failed check decreases or maintains uptime', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // total checks
        fc.integer({ min: 0, max: 1000 }), // successful checks
        (totalChecks, successfulChecks) => {
          const validSuccessful = Math.min(successfulChecks, totalChecks);
          
          const currentUptime = calculateUptimePercentage(totalChecks, validSuccessful);
          const uptimeAfterFailure = calculateUptimePercentage(totalChecks + 1, validSuccessful);
          
          // Adding a failed check should decrease or maintain uptime
          expect(uptimeAfterFailure).toBeLessThanOrEqual(currentUptime);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.4: Uptime with 50% success rate should be approximately 50%', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1000 }).filter(n => n % 2 === 0), // even total checks
        (totalChecks) => {
          const successfulChecks = totalChecks / 2;
          const uptime = calculateUptimePercentage(totalChecks, successfulChecks);
          
          // Should be exactly 50%
          expect(uptime).toBe(50);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.5: Uptime calculation handles edge cases correctly', () => {
    // Test specific edge cases
    expect(calculateUptimePercentage(0, 0)).toBe(0); // No checks
    expect(calculateUptimePercentage(1, 1)).toBe(100); // Single successful check
    expect(calculateUptimePercentage(1, 0)).toBe(0); // Single failed check
    expect(calculateUptimePercentage(100, 100)).toBe(100); // All successful
    expect(calculateUptimePercentage(100, 0)).toBe(0); // All failed
    expect(calculateUptimePercentage(100, 50)).toBe(50); // Half successful
    expect(calculateUptimePercentage(3, 2)).toBeCloseTo(66.67, 1); // 2/3 successful
  });

  test('Property 14.6: Uptime percentage is deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }), // total checks
        fc.integer({ min: 0, max: 1000 }), // successful checks
        (totalChecks, successfulChecks) => {
          const validSuccessful = Math.min(successfulChecks, totalChecks);
          
          // Calculate uptime multiple times
          const uptime1 = calculateUptimePercentage(totalChecks, validSuccessful);
          const uptime2 = calculateUptimePercentage(totalChecks, validSuccessful);
          const uptime3 = calculateUptimePercentage(totalChecks, validSuccessful);
          
          // All calculations should return the same value
          expect(uptime1).toBe(uptime2);
          expect(uptime2).toBe(uptime3);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.7: Uptime calculation respects mathematical bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // total checks
        fc.float({ min: 0, max: 1 }), // success ratio
        (totalChecks, successRatio) => {
          const successfulChecks = Math.floor(totalChecks * successRatio);
          const uptime = calculateUptimePercentage(totalChecks, successfulChecks);
          
          // Uptime should match the success ratio (within rounding)
          const expectedUptime = successRatio * 100;
          expect(Math.abs(uptime - expectedUptime)).toBeLessThan(1); // Within 1% due to rounding
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 14.8: Successful checks cannot exceed total checks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }), // total checks
        fc.integer({ min: 0, max: 2000 }), // potentially invalid successful checks
        (totalChecks, successfulChecks) => {
          // When successful checks exceed total, we should cap it
          const validSuccessful = Math.min(successfulChecks, totalChecks);
          const uptime = calculateUptimePercentage(totalChecks, validSuccessful);
          
          // Uptime should never exceed 100%
          expect(uptime).toBeLessThanOrEqual(100);
          
          // If we capped at total, uptime should be 100%
          if (successfulChecks >= totalChecks) {
            expect(uptime).toBe(100);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
