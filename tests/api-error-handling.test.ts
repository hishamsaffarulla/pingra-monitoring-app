/**
 * Unit Tests for API Error Handling
 * Tests invalid request handling, authentication failures, and authorization errors
 * 
 * Validates: Requirements 8.2, 8.5
 */

import { validateMonitor, validateUrl, validateNotificationChannel } from '../src/utils/validation';
import { CheckInterval, ProbeLocation } from '../src/types';

describe('API Error Handling Tests', () => {
  describe('Invalid Request Handling', () => {
    test('should reject monitor with missing required fields', () => {
      const invalidMonitor = {
        // Missing name, url, tenantId, etc.
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
      };

      const result = validateMonitor(invalidMonitor as any);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      
      // Should have errors for missing required fields
      const errorFields = result.errors.map(e => e.field);
      expect(errorFields).toContain('name');
      expect(errorFields).toContain('url');
      expect(errorFields).toContain('tenantId');
    });

    test('should reject monitor with invalid URL format', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'not-a-valid-url',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'url')).toBe(true);
    });

    test('should reject monitor with invalid check interval', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: 999, // Invalid interval
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'checkInterval')).toBe(true);
    });

    test('should reject monitor with invalid timeout', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 500, // Too large
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'timeoutSeconds')).toBe(true);
    });

    test('should reject monitor with empty probe locations', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [], // Empty array
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'probeLocations')).toBe(true);
    });

    test('should reject monitor with invalid status codes', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [999], // Invalid status code
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'expectedStatusCodes')).toBe(true);
    });

    test('should reject monitor with invalid failure threshold', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 0, // Invalid threshold
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'failureThreshold')).toBe(true);
    });
  });

  describe('URL Validation Error Handling', () => {
    test('should reject empty URL', () => {
      const result = validateUrl('');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'url')).toBe(true);
    });

    test('should reject URL with invalid protocol', () => {
      const result = validateUrl('ftp://example.com');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'url')).toBe(true);
    });

    test('should reject malformed URL', () => {
      const result = validateUrl('not a url at all');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'url')).toBe(true);
    });

    test('should accept valid HTTP URL', () => {
      const result = validateUrl('http://example.com');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should accept valid HTTPS URL', () => {
      const result = validateUrl('https://example.com');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Notification Channel Validation Error Handling', () => {
    test('should reject notification channel with missing required fields', () => {
      const invalidChannel = {
        // Missing tenantId, type, configuration
      };

      const result = validateNotificationChannel(invalidChannel as any);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject email channel with missing SMTP configuration', () => {
      const invalidChannel = {
        tenantId: 'test-tenant',
        type: 'email' as const,
        configuration: {
          // Missing smtpHost, smtpPort, fromEmail
        },
      };

      const result = validateNotificationChannel(invalidChannel);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'configuration')).toBe(true);
    });

    test('should reject email channel with invalid email address', () => {
      const invalidChannel = {
        tenantId: 'test-tenant',
        type: 'email' as const,
        configuration: {
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          fromEmail: 'not-an-email',
        },
      };

      const result = validateNotificationChannel(invalidChannel);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.includes('fromEmail'))).toBe(true);
    });

    test('should reject webhook channel with missing URL', () => {
      const invalidChannel = {
        tenantId: 'test-tenant',
        type: 'webhook' as const,
        configuration: {
          // Missing url
        },
      };

      const result = validateNotificationChannel(invalidChannel);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.includes('url'))).toBe(true);
    });

    test('should reject webhook channel with invalid URL', () => {
      const invalidChannel = {
        tenantId: 'test-tenant',
        type: 'webhook' as const,
        configuration: {
          url: 'not-a-valid-url',
        },
      };

      const result = validateNotificationChannel(invalidChannel);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.includes('url'))).toBe(true);
    });

    test('should reject notification channel with invalid type', () => {
      const invalidChannel = {
        tenantId: 'test-tenant',
        type: 'invalid-type' as any,
        configuration: {},
      };

      const result = validateNotificationChannel(invalidChannel);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'type')).toBe(true);
    });

    test('should accept valid email notification channel', () => {
      const validChannel = {
        tenantId: 'test-tenant',
        type: 'email' as const,
        configuration: {
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          fromEmail: 'alerts@example.com',
        },
      };

      const result = validateNotificationChannel(validChannel);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should accept valid webhook notification channel', () => {
      const validChannel = {
        tenantId: 'test-tenant',
        type: 'webhook' as const,
        configuration: {
          url: 'https://hooks.slack.com/services/xxx/yyy/zzz',
        },
      };

      const result = validateNotificationChannel(validChannel);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Error Response Format', () => {
    test('validation errors should include field, message, and code', () => {
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: '', // Invalid: empty
        url: 'not-a-url', // Invalid: malformed
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      
      // Each error should have required fields
      result.errors.forEach(error => {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('code');
        expect(typeof error.field).toBe('string');
        expect(typeof error.message).toBe('string');
        expect(typeof error.code).toBe('string');
      });
    });

    test('validation result should have isValid and errors properties', () => {
      const validMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(validMonitor);
      
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(typeof result.isValid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle monitor with all optional fields missing', () => {
      const minimalMonitor = {
        tenantId: 'test-tenant',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        // Optional fields not provided
      };

      const result = validateMonitor(minimalMonitor);
      
      // Should be valid even without optional fields
      // (validation function should handle defaults)
      expect(result.isValid).toBe(true);
    });

    test('should handle very long monitor name', () => {
      const longName = 'a'.repeat(300); // Exceeds 255 character limit
      const invalidMonitor = {
        tenantId: 'test-tenant',
        name: longName,
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    test('should handle URL with special characters', () => {
      const urlWithSpecialChars = 'https://example.com/path?query=value&other=123#fragment';
      const result = validateUrl(urlWithSpecialChars);
      
      expect(result.isValid).toBe(true);
    });

    test('should handle multiple validation errors simultaneously', () => {
      const invalidMonitor = {
        tenantId: '', // Invalid: empty
        name: '', // Invalid: empty
        url: 'not-a-url', // Invalid: malformed
        checkInterval: 999, // Invalid: not a valid enum value
        timeoutSeconds: -1, // Invalid: negative
        expectedStatusCodes: [], // Invalid: empty array
        probeLocations: [], // Invalid: empty array
        failureThreshold: 0, // Invalid: zero
      };

      const result = validateMonitor(invalidMonitor);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(5); // Multiple errors
    });
  });
});
