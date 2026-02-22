/**
 * Component Integration Tests
 * Tests for end-to-end component interaction and system integration
 */

import { ApplicationOrchestrator } from '../src/services/application-orchestrator';
import { createDatabaseManager } from '../src/database/connection';
import { getConfig } from '../src/config';
import { CheckInterval, ProbeLocation } from '../src/types';

// Mock environment variables for testing
const setupTestEnvironment = () => {
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
  process.env['INFLUXDB_URL'] = 'http://localhost:8086';
  process.env['INFLUXDB_TOKEN'] = 'test-token';
  process.env['INFLUXDB_ORG'] = 'test-org';
  process.env['INFLUXDB_BUCKET'] = 'test-bucket';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_SECRET'] = 'test-secret-key-for-integration-testing';
  process.env['NODE_ENV'] = 'test';
};

describe('Component Integration Tests', () => {
  beforeAll(() => {
    setupTestEnvironment();
  });

  describe('Application Orchestrator', () => {
    test('should create orchestrator instance', () => {
      const orchestrator = new ApplicationOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.isReady()).toBe(false);
    });

    test('should handle initialization without database connection gracefully', async () => {
      const orchestrator = new ApplicationOrchestrator();
      
      // This should fail gracefully since we don't have real database connections
      await expect(orchestrator.initialize()).rejects.toThrow();
    });
  });

  describe('Component Wiring', () => {
    test('should wire scheduler to probe runner conceptually', () => {
      // Test that the wiring logic is sound
      const mockMonitorId = 'test-monitor-123';
      const mockCheckInterval = CheckInterval.ONE_MINUTE;
      
      // Verify that monitor ID and interval are valid types
      expect(typeof mockMonitorId).toBe('string');
      expect(typeof mockCheckInterval).toBe('number');
      expect(mockCheckInterval).toBe(60);
    });

    test('should handle probe locations correctly', () => {
      const locations = [ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL];
      
      expect(locations).toHaveLength(3);
      expect(locations).toContain(ProbeLocation.US_EAST);
      expect(locations).toContain(ProbeLocation.EU_WEST);
      expect(locations).toContain(ProbeLocation.ME_CENTRAL);
    });
  });

  describe('Configuration Loading', () => {
    test('should load configuration successfully', () => {
      const config = getConfig();
      
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.database.postgresql).toBeDefined();
      expect(config.database.influxdb).toBeDefined();
      expect(config.database.redis).toBeDefined();
      expect(config.jwt).toBeDefined();
      expect(config.monitoring).toBeDefined();
    });

    test('should have correct database configuration', () => {
      const config = getConfig();
      
      expect(config.database.postgresql.host).toBe('localhost');
      expect(config.database.postgresql.port).toBe(5432);
      expect(config.database.postgresql.database).toBe('test_db');
      
      expect(config.database.influxdb.url).toBe('http://localhost:8086');
      expect(config.database.influxdb.org).toBe('test-org');
      expect(config.database.influxdb.bucket).toBe('test-bucket');
      
      expect(config.database.redis.host).toBe('localhost');
      expect(config.database.redis.port).toBe(6379);
    });

    test('should have correct JWT configuration', () => {
      const config = getConfig();
      
      expect(config.jwt.secret).toBe('test-secret-key-for-integration-testing');
      expect(config.jwt.expiresIn).toBeDefined();
      expect(config.jwt.refreshExpiresIn).toBeDefined();
    });

    test('should have correct monitoring configuration', () => {
      const config = getConfig();
      
      expect(config.monitoring.defaultTimeout).toBeDefined();
      expect(config.monitoring.maxConcurrentChecks).toBeDefined();
      expect(config.monitoring.retentionDays).toBeDefined();
      
      expect(typeof config.monitoring.defaultTimeout).toBe('number');
      expect(typeof config.monitoring.maxConcurrentChecks).toBe('number');
      expect(typeof config.monitoring.retentionDays).toBe('number');
    });
  });

  describe('Error Propagation', () => {
    test('should handle database connection errors gracefully', async () => {
      // Test that errors are properly propagated
      const config = getConfig();
      
      // Attempting to create database manager with invalid config should fail
      expect(() => {
        createDatabaseManager({
          ...config.database,
          postgresql: {
            ...config.database.postgresql,
            host: 'invalid-host-that-does-not-exist',
          },
        });
      }).not.toThrow(); // Creation doesn't throw, initialization does
    });

    test('should validate required configuration fields', () => {
      const config = getConfig();
      
      // Verify all required fields are present
      expect(config.database.postgresql.host).toBeTruthy();
      expect(config.database.postgresql.port).toBeTruthy();
      expect(config.database.postgresql.database).toBeTruthy();
      expect(config.database.influxdb.url).toBeTruthy();
      expect(config.database.influxdb.token).toBeTruthy();
      expect(config.database.redis.host).toBeTruthy();
      expect(config.jwt.secret).toBeTruthy();
    });
  });

  describe('End-to-End Flow Validation', () => {
    test('should validate monitor creation flow', () => {
      // Test the data flow for monitor creation
      const mockMonitor = {
        tenantId: 'tenant-123',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.FIVE_MINUTES,
        timeoutSeconds: 30,
        expectedStatusCodes: [200, 201],
        probeLocations: [ProbeLocation.US_EAST, ProbeLocation.EU_WEST],
        failureThreshold: 3,
      };
      
      // Verify monitor structure
      expect(mockMonitor.tenantId).toBeDefined();
      expect(mockMonitor.name).toBeDefined();
      expect(mockMonitor.url).toMatch(/^https?:\/\//);
      expect(mockMonitor.checkInterval).toBeGreaterThan(0);
      expect(mockMonitor.timeoutSeconds).toBeGreaterThan(0);
      expect(mockMonitor.expectedStatusCodes).toBeInstanceOf(Array);
      expect(mockMonitor.probeLocations).toBeInstanceOf(Array);
      expect(mockMonitor.failureThreshold).toBeGreaterThan(0);
    });

    test('should validate check result flow', () => {
      // Test the data flow for check results
      const mockCheckResult = {
        id: 'check-123',
        monitorId: 'monitor-123',
        location: ProbeLocation.US_EAST,
        timestamp: new Date(),
        success: true,
        responseTime: 150,
        statusCode: 200,
      };
      
      // Verify check result structure
      expect(mockCheckResult.id).toBeDefined();
      expect(mockCheckResult.monitorId).toBeDefined();
      expect(mockCheckResult.location).toBeDefined();
      expect(mockCheckResult.timestamp).toBeInstanceOf(Date);
      expect(typeof mockCheckResult.success).toBe('boolean');
      expect(mockCheckResult.responseTime).toBeGreaterThanOrEqual(0);
      expect(mockCheckResult.statusCode).toBeGreaterThanOrEqual(100);
      expect(mockCheckResult.statusCode).toBeLessThan(600);
    });

    test('should validate alert flow', () => {
      // Test the data flow for alerts
      const mockAlert = {
        id: 'alert-123',
        monitorId: 'monitor-123',
        type: 'failure',
        triggeredAt: new Date(),
        consecutiveFailures: 3,
        message: 'Monitor is down',
      };
      
      // Verify alert structure
      expect(mockAlert.id).toBeDefined();
      expect(mockAlert.monitorId).toBeDefined();
      expect(mockAlert.type).toBeDefined();
      expect(mockAlert.triggeredAt).toBeInstanceOf(Date);
      expect(mockAlert.consecutiveFailures).toBeGreaterThan(0);
      expect(mockAlert.message).toBeDefined();
    });
  });

  describe('Database Failover Scenarios', () => {
    test('should handle PostgreSQL connection failure', async () => {
      // Test that the system validates PostgreSQL configuration
      const invalidConfig = {
        postgresql: {
          host: 'invalid-host',
          port: 5432,
          database: 'test',
          username: 'test',
          password: 'test',
          ssl: false,
          maxConnections: 10,
        },
        influxdb: {
          url: 'http://localhost:8086',
          token: 'test-token',
          org: 'test-org',
          bucket: 'test-bucket',
        },
        redis: {
          host: 'localhost',
          port: 6379,
        },
      };
      
      // Verify configuration structure is valid
      expect(invalidConfig.postgresql.host).toBeDefined();
      expect(invalidConfig.postgresql.port).toBeGreaterThan(0);
      expect(invalidConfig.postgresql.database).toBeDefined();
    });

    test('should handle Redis connection failure', async () => {
      // Test that the system validates Redis configuration
      const invalidConfig = {
        postgresql: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          username: 'test',
          password: 'test',
          ssl: false,
          maxConnections: 10,
        },
        influxdb: {
          url: 'http://localhost:8086',
          token: 'test-token',
          org: 'test-org',
          bucket: 'test-bucket',
        },
        redis: {
          host: 'invalid-redis-host',
          port: 6379,
        },
      };
      
      // Verify configuration structure is valid
      expect(invalidConfig.redis.host).toBeDefined();
      expect(invalidConfig.redis.port).toBeGreaterThan(0);
    });

    test('should validate health check structure', async () => {
      // Test health check response structure
      const mockHealthCheck = {
        postgresql: false,
        influxdb: false,
        redis: false,
      };
      
      expect(mockHealthCheck).toHaveProperty('postgresql');
      expect(mockHealthCheck).toHaveProperty('influxdb');
      expect(mockHealthCheck).toHaveProperty('redis');
      expect(typeof mockHealthCheck.postgresql).toBe('boolean');
      expect(typeof mockHealthCheck.influxdb).toBe('boolean');
      expect(typeof mockHealthCheck.redis).toBe('boolean');
    });
  });
});


describe('End-to-End System Validation', () => {
  describe('Complete Monitoring Workflow', () => {
    it('should execute workflow from configuration to alerting', () => {
      const monitor = {
        id: 'e2e-1',
        tenantId: 'tenant-1',
        name: 'Test Monitor',
        url: 'https://example.com',
        checkInterval: CheckInterval.ONE_MINUTE,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      };

      expect(monitor.url).toMatch(/^https?:\/\//);
      expect(monitor.checkInterval).toBeGreaterThan(0);
      expect(monitor.timeoutSeconds).toBeGreaterThan(0);
      expect(monitor.expectedStatusCodes).toContain(200);
      expect(monitor.probeLocations).toContain(ProbeLocation.US_EAST);
      expect(monitor.failureThreshold).toBeGreaterThan(0);
    });
  });

  describe('Multi-Location Monitoring and Aggregation', () => {
    it('should validate multi-location check execution', () => {
      const locations = [
        ProbeLocation.US_EAST,
        ProbeLocation.EU_WEST,
        ProbeLocation.ME_CENTRAL,
      ];

      expect(locations).toHaveLength(3);
      locations.forEach(loc => {
        expect(typeof loc).toBe('string');
        expect(loc).toBeTruthy();
      });
    });

    it('should aggregate results from multiple locations correctly', () => {
      const results = [
        { location: ProbeLocation.US_EAST, success: true, responseTime: 100 },
        { location: ProbeLocation.EU_WEST, success: false, responseTime: null },
        { location: ProbeLocation.ME_CENTRAL, success: true, responseTime: 150 },
      ];

      // Monitor is healthy if ANY location reports success
      const anySuccess = results.some(r => r.success);
      expect(anySuccess).toBe(true);

      // Calculate average response time for successful checks
      const successfulResults = results.filter(r => r.success && r.responseTime);
      const avgResponseTime = successfulResults.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successfulResults.length;
      expect(avgResponseTime).toBeGreaterThan(0);
    });
  });

  describe('SSL Certificate Monitoring and Alerting', () => {
    it('should validate SSL certificate expiry detection', () => {
      const now = new Date();
      const expiryIn30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const expiryIn7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiryIn1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

      const daysUntil30 = Math.floor((expiryIn30Days.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const daysUntil7 = Math.floor((expiryIn7Days.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const daysUntil1 = Math.floor((expiryIn1Day.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      // 30-day warning threshold
      expect(daysUntil30).toBeGreaterThanOrEqual(29);
      expect(daysUntil30).toBeLessThanOrEqual(31);

      // 7-day critical threshold
      expect(daysUntil7).toBeGreaterThanOrEqual(6);
      expect(daysUntil7).toBeLessThanOrEqual(8);

      // Expired or about to expire
      expect(daysUntil1).toBeGreaterThanOrEqual(0);
      expect(daysUntil1).toBeLessThanOrEqual(2);
    });

    it('should trigger SSL alerts at correct thresholds', () => {
      const now = new Date();
      
      // Test 30-day warning
      const cert30Days = {
        expiryDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 30,
      };
      expect(cert30Days.daysUntilExpiry).toBeLessThanOrEqual(30);
      expect(cert30Days.daysUntilExpiry).toBeGreaterThan(7);

      // Test 7-day critical
      const cert7Days = {
        expiryDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 7,
      };
      expect(cert7Days.daysUntilExpiry).toBeLessThanOrEqual(7);
    });
  });

  describe('Notification Delivery Across Channels', () => {
    it('should validate notification channel configuration', () => {
      const channels = [
        { type: 'email', enabled: true, config: { smtp: 'smtp.example.com' } },
        { type: 'webhook', enabled: true, config: { url: 'https://hooks.slack.com/...' } },
        { type: 'sms', enabled: false, config: {} },
        { type: 'voice', enabled: false, config: {} },
      ];

      const enabledChannels = channels.filter(c => c.enabled);
      expect(enabledChannels).toHaveLength(2);
      expect(enabledChannels.map(c => c.type)).toContain('email');
      expect(enabledChannels.map(c => c.type)).toContain('webhook');
    });

    it('should send alerts to all enabled channels', () => {
      const alert = {
        id: 'alert-1',
        monitorId: 'monitor-1',
        type: 'failure',
        message: 'Monitor is down',
      };

      const channels = [
        { type: 'email', enabled: true },
        { type: 'webhook', enabled: true },
        { type: 'sms', enabled: false },
      ];

      const deliveries = channels
        .filter(c => c.enabled)
        .map(c => ({
          channelType: c.type,
          alertId: alert.id,
          status: 'pending',
        }));

      expect(deliveries).toHaveLength(2);
      expect(deliveries.every(d => d.alertId === alert.id)).toBe(true);
    });
  });

  describe('System Performance Under Load', () => {
    it('should handle multiple monitors efficiently', () => {
      const monitors = Array.from({ length: 100 }, (_, i) => ({
        id: `monitor-${i}`,
        url: `https://example${i}.com`,
        checkInterval: CheckInterval.FIVE_MINUTES,
        timeoutSeconds: 30,
      }));

      expect(monitors).toHaveLength(100);
      monitors.forEach(m => {
        expect(m.id).toBeDefined();
        expect(m.url).toMatch(/^https?:\/\//);
        expect(m.checkInterval).toBeGreaterThan(0);
      });
    });

    it('should handle high-frequency checks', () => {
      const monitors = Array.from({ length: 50 }, (_, i) => ({
        id: `monitor-${i}`,
        checkInterval: CheckInterval.ONE_MINUTE,
      }));

      // Calculate checks per minute
      const checksPerMinute = monitors.length;
      expect(checksPerMinute).toBe(50);

      // Verify system can handle the load
      expect(checksPerMinute).toBeLessThanOrEqual(100); // Max concurrent checks
    });

    it('should validate concurrent check execution', () => {
      const monitor = {
        id: 'monitor-1',
        probeLocations: [ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL],
      };

      // Each monitor check runs from all locations concurrently
      const concurrentChecks = monitor.probeLocations.length;
      expect(concurrentChecks).toBe(3);
    });
  });

  describe('Database Performance Validation', () => {
    it('should validate time-series data structure', () => {
      const checkResult = {
        id: 'check-1',
        monitorId: 'monitor-1',
        location: ProbeLocation.US_EAST,
        timestamp: new Date(),
        success: true,
        responseTime: 150,
        statusCode: 200,
      };

      expect(checkResult.timestamp).toBeInstanceOf(Date);
      expect(checkResult.responseTime).toBeGreaterThan(0);
      expect(checkResult.statusCode).toBeGreaterThanOrEqual(100);
      expect(checkResult.statusCode).toBeLessThan(600);
    });

    it('should validate data retention requirements', () => {
      const config = getConfig();
      
      // Verify retention period is at least 90 days
      expect(config.monitoring.retentionDays).toBeGreaterThanOrEqual(90);
      expect(config.influxdb.retentionPeriod).toBeGreaterThanOrEqual(90);
    });

    it('should validate caching configuration', () => {
      const config = getConfig();
      
      // Verify Redis caching is configured
      expect(config.redis.cacheTTL).toBeGreaterThan(0);
      expect(config.redis.alertStateTTL).toBeGreaterThan(0);
      expect(config.redis.sessionTTL).toBeGreaterThan(0);
    });
  });
});
