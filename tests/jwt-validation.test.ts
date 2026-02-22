/**
 * Property-Based Tests for JWT Token Validation
 * Feature: url-monitoring, Property 11: JWT Token Validation
 * Validates: Requirements 8.1, 8.5
 */

import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  hashPassword,
  verifyPassword,
} from '../src/services/auth-service';
import { JWTPayload } from '../src/types';

// Mock config for testing
jest.mock('../src/config', () => ({
  getConfig: () => ({
    jwt: {
      secret: 'test-secret-key-for-jwt-testing',
      expiresIn: '1h',
      refreshExpiresIn: '7d',
    },
  }),
}));

// Mock Redis for testing
jest.mock('../src/database/redis-setup', () => ({
  getRedisClient: () => ({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
  }),
}));

describe('JWT Token Validation Property Tests', () => {
  /**
   * Property 11: JWT Token Validation
   * For any valid userId and tenantId, the generated token should be verifiable
   * and contain the correct payload information
   */
  test('Property 11: generated tokens should be verifiable and contain correct payload', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (userId, tenantId) => {
          // Generate access token
          const token = generateAccessToken(userId, tenantId);

          // Token should be a non-empty string
          expect(typeof token).toBe('string');
          expect(token.length).toBeGreaterThan(0);

          // Verify token
          const decoded = verifyToken(token);

          // Decoded payload should contain correct user and tenant IDs
          expect(decoded.userId).toBe(userId);
          expect(decoded.tenantId).toBe(tenantId);

          // Token should have expiry and issued-at timestamps
          expect(decoded.exp).toBeDefined();
          expect(decoded.iat).toBeDefined();
          expect(decoded.exp).toBeGreaterThan(decoded.iat);

          // Expiry should be in the future
          const now = Math.floor(Date.now() / 1000);
          expect(decoded.exp).toBeGreaterThan(now);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Refresh tokens should have longer expiry than access tokens
   */
  test('refresh tokens should have longer expiry than access tokens', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (userId, tenantId) => {
          const accessToken = generateAccessToken(userId, tenantId);
          const refreshToken = generateRefreshToken(userId, tenantId);

          const accessDecoded = jwt.decode(accessToken) as JWTPayload;
          const refreshDecoded = jwt.decode(refreshToken) as JWTPayload;

          // Refresh token should expire after access token
          expect(refreshDecoded.exp).toBeGreaterThan(accessDecoded.exp);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Token verification should fail for tampered tokens
   */
  test('token verification should fail for tampered tokens', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (userId, tenantId, randomString) => {
          const token = generateAccessToken(userId, tenantId);

          // Tamper with the token by appending random string
          const tamperedToken = token + randomString;

          // Verification should throw an error
          expect(() => verifyToken(tamperedToken)).toThrow();
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Token verification should fail with wrong secret
   */
  test('token signed with different secret should fail verification', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 10, maxLength: 50 }),
        (userId, tenantId, wrongSecret) => {
          // Skip if wrong secret matches test secret
          fc.pre(wrongSecret !== 'test-secret-key-for-jwt-testing');

          // Generate token with wrong secret
          const payload = { userId, tenantId };
          const tokenWithWrongSecret = jwt.sign(payload, wrongSecret, { expiresIn: '1h' });

          // Verification should throw an error
          expect(() => verifyToken(tokenWithWrongSecret)).toThrow('Invalid token');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Expired tokens should fail verification
   */
  test('expired tokens should fail verification', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (userId, tenantId) => {
          // Generate token that expires immediately
          const payload = { userId, tenantId };
          const expiredToken = jwt.sign(payload, 'test-secret-key-for-jwt-testing', {
            expiresIn: '0s',
          });

          // Wait a bit to ensure expiry
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              // Verification should throw expired error
              expect(() => verifyToken(expiredToken)).toThrow('Token expired');
              resolve();
            }, 100);
          });
        }
      ),
      { numRuns: 10 } // Reduced runs due to timeout
    );
  });

  /**
   * Property: Password hashing should be deterministic for verification
   */
  test('hashed passwords should verify correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 100 }),
        async (password) => {
          // Hash the password
          const hash = await hashPassword(password);

          // Hash should be different from original password
          expect(hash).not.toBe(password);

          // Verification should succeed with correct password
          const isValid = await verifyPassword(password, hash);
          expect(isValid).toBe(true);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property: Password verification should fail for incorrect passwords
   */
  test('password verification should fail for incorrect passwords', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 100 }),
        fc.string({ minLength: 8, maxLength: 100 }),
        async (password, wrongPassword) => {
          // Skip if passwords are the same
          fc.pre(password !== wrongPassword);

          // Hash the correct password
          const hash = await hashPassword(password);

          // Verification should fail with wrong password
          const isValid = await verifyPassword(wrongPassword, hash);
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property: Token payload should be immutable after generation
   */
  test('token payload should remain consistent across multiple verifications', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (userId, tenantId) => {
          const token = generateAccessToken(userId, tenantId);

          // Verify token multiple times
          const decoded1 = verifyToken(token);
          const decoded2 = verifyToken(token);
          const decoded3 = verifyToken(token);

          // All verifications should return the same payload
          expect(decoded1.userId).toBe(decoded2.userId);
          expect(decoded1.userId).toBe(decoded3.userId);
          expect(decoded1.tenantId).toBe(decoded2.tenantId);
          expect(decoded1.tenantId).toBe(decoded3.tenantId);
          expect(decoded1.exp).toBe(decoded2.exp);
          expect(decoded1.exp).toBe(decoded3.exp);
          expect(decoded1.iat).toBe(decoded2.iat);
          expect(decoded1.iat).toBe(decoded3.iat);
        }
      ),
      { numRuns: 20 }
    );
  });
});
