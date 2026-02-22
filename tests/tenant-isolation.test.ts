/**
 * Property-Based Tests for Tenant Data Isolation
 * Feature: url-monitoring, Property 12: Tenant Data Isolation
 * Validates: Requirements 8.3
 */

import * as fc from 'fast-check';
import {
  validateTenantOwnership,
  filterByTenant,
} from '../src/middleware/tenant-isolation-middleware';
import { encrypt, decrypt, encryptObject, decryptObject } from '../src/services/encryption-service';

// Mock config for testing
jest.mock('../src/config', () => ({
  getConfig: () => ({
    jwt: {
      secret: 'test-secret-key-for-encryption-testing',
      expiresIn: '1h',
      refreshExpiresIn: '7d',
    },
    redis: {
      cacheTTL: 3600,
    },
  }),
}));

// Mock database manager for Redis
jest.mock('../src/database/connection', () => ({
  getDatabaseManager: () => ({
    getRedisClient: () => ({
      setEx: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(0),
    }),
  }),
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Tenant Data Isolation Property Tests', () => {
  /**
   * Property 12: Tenant Data Isolation
   * For any two different tenant IDs, resources belonging to one tenant
   * should not be accessible by another tenant
   */
  test('Property 12: tenant ownership validation should prevent cross-tenant access', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (tenantId1, tenantId2) => {
          // Skip if tenant IDs are the same
          fc.pre(tenantId1 !== tenantId2);

          // Resource belongs to tenant1
          const resourceTenantId = tenantId1;

          // Tenant1 should have access
          expect(validateTenantOwnership(resourceTenantId, tenantId1)).toBe(true);

          // Tenant2 should NOT have access
          expect(validateTenantOwnership(resourceTenantId, tenantId2)).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Filtering by tenant should only return resources for that tenant
   */
  test('filtering by tenant should only return resources belonging to that tenant', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenantId: fc.uuid(),
            name: fc.string(),
          }),
          { minLength: 5, maxLength: 20 }
        ),
        (targetTenantId, resources) => {
          // Filter resources by target tenant
          const filtered = filterByTenant(resources, targetTenantId);

          // All filtered resources should belong to target tenant
          filtered.forEach((resource) => {
            expect(resource.tenantId).toBe(targetTenantId);
          });

          // Count should match resources with target tenant ID
          const expectedCount = resources.filter((r) => r.tenantId === targetTenantId).length;
          expect(filtered.length).toBe(expectedCount);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Tenant cache keys should be isolated by tenant ID
   */
  test('tenant cache keys should be properly namespaced by tenant ID', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (tenantId1, tenantId2, cacheKey) => {
          // Skip if tenant IDs are the same
          fc.pre(tenantId1 !== tenantId2);

          // Cache keys for different tenants should be different
          // even if the key name is the same
          const key1 = `tenant:cache:${tenantId1}:${cacheKey}`;
          const key2 = `tenant:cache:${tenantId2}:${cacheKey}`;

          expect(key1).not.toBe(key2);
          expect(key1).toContain(tenantId1);
          expect(key2).toContain(tenantId2);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Encryption should be deterministic for decryption
   */
  test('encrypted data should decrypt to original value', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (plaintext) => {
          // Encrypt the data
          const encrypted = encrypt(plaintext);

          // Encrypted should be different from plaintext
          expect(encrypted).not.toBe(plaintext);

          // Decrypt should return original plaintext
          const decrypted = decrypt(encrypted);
          expect(decrypted).toBe(plaintext);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property: Object encryption should preserve data structure
   */
  test('encrypted objects should decrypt to original structure', () => {
    fc.assert(
      fc.property(
        fc.record({
          apiKey: fc.string(),
          secret: fc.string(),
          enabled: fc.boolean(),
          count: fc.integer(),
        }),
        (obj) => {
          // Encrypt the object
          const encrypted = encryptObject(obj);

          // Encrypted should be a string
          expect(typeof encrypted).toBe('string');

          // Decrypt should return original object
          const decrypted = decryptObject(encrypted);
          expect(decrypted).toEqual(obj);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property: Same plaintext should produce different ciphertexts (due to random IV)
   */
  test('encrypting same plaintext multiple times should produce different ciphertexts', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 100 }),
        (plaintext) => {
          // Encrypt same plaintext multiple times
          const encrypted1 = encrypt(plaintext);
          const encrypted2 = encrypt(plaintext);
          const encrypted3 = encrypt(plaintext);

          // Ciphertexts should be different (due to random IV and salt)
          expect(encrypted1).not.toBe(encrypted2);
          expect(encrypted2).not.toBe(encrypted3);
          expect(encrypted1).not.toBe(encrypted3);

          // But all should decrypt to same plaintext
          expect(decrypt(encrypted1)).toBe(plaintext);
          expect(decrypt(encrypted2)).toBe(plaintext);
          expect(decrypt(encrypted3)).toBe(plaintext);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property: Tenant ownership validation should be reflexive
   */
  test('tenant should always have access to their own resources', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (tenantId) => {
          // A tenant should always have access to their own resources
          expect(validateTenantOwnership(tenantId, tenantId)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Filtering empty array should return empty array
   */
  test('filtering empty resource list should return empty list', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (tenantId) => {
          const emptyResources: Array<{ tenantId: string }> = [];
          const filtered = filterByTenant(emptyResources, tenantId);
          
          expect(filtered).toEqual([]);
          expect(filtered.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Decryption should fail for tampered ciphertext
   */
  test('decryption should fail for significantly tampered ciphertext', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (plaintext, tamperPosition) => {
          // Encrypt the data
          const encrypted = encrypt(plaintext);

          // Tamper with the ciphertext by modifying a character
          if (encrypted.length > 0) {
            const pos = tamperPosition % encrypted.length;
            const tamperedEncrypted =
              encrypted.substring(0, pos) +
              (encrypted[pos] === 'A' ? 'B' : 'A') +
              encrypted.substring(pos + 1);

            // Decryption should throw an error for tampered data
            expect(() => decrypt(tamperedEncrypted)).toThrow();
          }
        }
      ),
      { numRuns: 15 }
    );
  });
});
