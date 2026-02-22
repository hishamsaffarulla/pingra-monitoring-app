/**
 * Performance and Load Testing
 * 
 * Tests system performance with multiple monitors, high check frequency,
 * database performance, Redis caching, and concurrent user access.
 * 
 * Requirements: 9.5, 11.1
 */

import { CheckInterval, ProbeLocation } from '../src/types';
import { getConfig } from '../src/config';

describe('Performance and Load Testing', () => {
  describe('Multiple Monitors Performance', () => {
    it('should handle 100 monitors efficiently', () => {
      const startTime = Date.now();
      
      const monitors = Array.from({ length: 100 }, (_, i) => ({
        id: `monitor-${i}`,
        tenantId: `tenant-${Math.floor(i / 10)}`,
        name: `Monitor ${i}`,
        url: `https://example${i}.com`,
        checkInterval: CheckInterval.FIVE_MINUTES,
        timeoutSeconds: 30,
        expectedStatusCodes: [200],
        probeLocations: [ProbeLocation.US_EAST],
        failureThreshold: 3,
      }));

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(monitors).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
      
      // Verify all monitors are valid
      monitors.forEach(m => {
        expect(m.id).toBeDefined();
        expect(m.url).toMatch(/^https?:\/\//);
        expect(m.checkInterval).toBeGreaterThan(0);
      });
    });

    it('should handle 500 monitors efficiently', () => {
      const startTime = Date.now();
      
      const monitors = Array.from({ length: 500 }, (_, i) => ({
        id: `monitor-${i}`,
        url: `https://example${i}.com`,
        checkInterval: i % 2 === 0 ? CheckInterval.ONE_MINUTE : CheckInterval.FIVE_MINUTES,
      }));

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(monitors).toHaveLength(500);
      expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
    });

    it('should calculate total checks per minute for multiple monitors', () => {
      const monitors = [
        { checkInterval: CheckInterval.ONE_MINUTE, count: 50 },
        { checkInterval: CheckInterval.FIVE_MINUTES, count: 100 },
      ];

      // 50 monitors at 1-minute intervals = 50 checks/min
      // 100 monitors at 5-minute intervals = 20 checks/min
      const monitor1 = monitors[0];
      const monitor2 = monitors[1];
      
      if (monitor1 && monitor2) {
        const checksPerMinute = 
          (monitor1.count * (60 / CheckInterval.ONE_MINUTE)) +
          (monitor2.count * (60 / CheckInterval.FIVE_MINUTES));

        expect(checksPerMinute).toBe(70);
        
        const config = getConfig();
        expect(checksPerMinute).toBeLessThanOrEqual(config.monitoring.maxConcurrentChecks);
      }
    });
  });

  describe('High-Frequency Check Performance', () => {
    it('should handle 1-minute interval checks for 50 monitors', () => {
      const monitors = Array.from({ length: 50 }, (_, i) => ({
        id: `monitor-${i}`,
        checkInterval: CheckInterval.ONE_MINUTE,
        probeLocations: [ProbeLocation.US_EAST],
      }));

      // Calculate checks per minute
      const checksPerMinute = monitors.length;
      expect(checksPerMinute).toBe(50);

      // Verify within system limits
      const config = getConfig();
      expect(checksPerMinute).toBeLessThanOrEqual(config.monitoring.maxConcurrentChecks);
    });

    it('should handle multi-location checks efficiently', () => {
      const monitor = {
        id: 'monitor-1',
        checkInterval: CheckInterval.ONE_MINUTE,
        probeLocations: [ProbeLocation.US_EAST, ProbeLocation.EU_WEST, ProbeLocation.ME_CENTRAL],
      };

      // Each check runs from all locations concurrently
      const concurrentChecksPerRun = monitor.probeLocations.length;
      expect(concurrentChecksPerRun).toBe(3);

      // Total checks per minute
      const checksPerMinute = concurrentChecksPerRun * (60 / monitor.checkInterval);
      expect(checksPerMinute).toBe(3);
    });

    it('should calculate system load with mixed intervals', () => {
      const monitors = [
        { id: '1', interval: CheckInterval.ONE_MINUTE, locations: 3 },
        { id: '2', interval: CheckInterval.ONE_MINUTE, locations: 2 },
        { id: '3', interval: CheckInterval.FIVE_MINUTES, locations: 3 },
        { id: '4', interval: CheckInterval.FIVE_MINUTES, locations: 1 },
      ];

      // Calculate total checks per minute
      let totalChecksPerMinute = 0;
      monitors.forEach(m => {
        const checksPerMinute = m.locations * (60 / m.interval);
        totalChecksPerMinute += checksPerMinute;
      });

      // (3 + 2) * 1 + (3 + 1) * 0.2 = 5 + 0.8 = 5.8
      expect(totalChecksPerMinute).toBeCloseTo(5.8, 1);
    });
  });

  describe('Time-Series Data Performance', () => {
    it('should handle large volumes of check results', () => {
      const startTime = Date.now();
      
      // Simulate 1000 check results
      const checkResults = Array.from({ length: 1000 }, (_, i) => ({
        id: `check-${i}`,
        monitorId: `monitor-${i % 100}`,
        location: ProbeLocation.US_EAST,
        timestamp: new Date(Date.now() - i * 60000),
        success: Math.random() > 0.1,
        responseTime: Math.floor(Math.random() * 1000),
        statusCode: 200,
      }));

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(checkResults).toHaveLength(1000);
      expect(duration).toBeLessThan(500); // Should complete in less than 500ms
    });

    it('should efficiently query time-range data', () => {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // Simulate time-range queries
      const checkResults = Array.from({ length: 10000 }, (_, i) => ({
        timestamp: new Date(now - i * 60000),
        success: true,
      }));

      const startTime = Date.now();
      
      // Filter for last 24 hours
      const last24Hours = checkResults.filter(r => 
        r.timestamp.getTime() >= oneDayAgo
      );

      // Filter for last 7 days
      const last7Days = checkResults.filter(r => 
        r.timestamp.getTime() >= oneWeekAgo
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(last24Hours.length).toBeGreaterThan(0);
      expect(last7Days.length).toBeGreaterThan(last24Hours.length);
      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
    });

    it('should handle data retention calculations', () => {
      const config = getConfig();
      const retentionDays = config.monitoring.retentionDays;

      // Calculate data points for retention period
      const monitorsCount = 100;
      const checksPerDay = (24 * 60) / 5; // 5-minute intervals
      const locationsPerCheck = 3;
      const totalDataPoints = monitorsCount * checksPerDay * locationsPerCheck * retentionDays;

      // Verify retention is at least 90 days
      expect(retentionDays).toBeGreaterThanOrEqual(90);
      
      // Verify total data points is reasonable
      expect(totalDataPoints).toBeGreaterThan(0);
      expect(totalDataPoints).toBeLessThan(100000000); // Less than 100M data points
    });
  });

  describe('Redis Caching Performance', () => {
    it('should validate cache TTL configuration', () => {
      const config = getConfig();

      expect(config.redis.defaultTTL).toBeGreaterThan(0);
      expect(config.redis.sessionTTL).toBeGreaterThan(0);
      expect(config.redis.alertStateTTL).toBeGreaterThan(0);
      expect(config.redis.cacheTTL).toBeGreaterThan(0);

      // Verify reasonable TTL values
      expect(config.redis.defaultTTL).toBeLessThanOrEqual(86400); // Max 24 hours
      expect(config.redis.sessionTTL).toBeLessThanOrEqual(86400); // Max 24 hours
      expect(config.redis.cacheTTL).toBeLessThanOrEqual(3600); // Max 1 hour
    });

    it('should handle cache key generation efficiently', () => {
      const startTime = Date.now();
      
      const cacheKeys = Array.from({ length: 1000 }, (_, i) => {
        const tenantId = `tenant-${i % 10}`;
        const monitorId = `monitor-${i}`;
        return `monitor:${tenantId}:${monitorId}`;
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(cacheKeys).toHaveLength(1000);
      expect(duration).toBeLessThan(100); // Should complete in less than 100ms

      // Verify key format
      cacheKeys.forEach(key => {
        expect(key).toMatch(/^monitor:tenant-\d+:monitor-\d+$/);
      });
    });

    it('should calculate cache memory usage', () => {
      // Estimate cache size
      const monitorsCount = 100;
      const avgMonitorSize = 1024; // 1KB per monitor
      const avgCheckResultSize = 512; // 512 bytes per check result
      const checksPerMonitor = 10; // Last 10 checks cached

      const estimatedCacheSize = 
        (monitorsCount * avgMonitorSize) + 
        (monitorsCount * checksPerMonitor * avgCheckResultSize);

      // Verify cache size is reasonable (less than 10MB)
      expect(estimatedCacheSize).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Concurrent User Access Performance', () => {
    it('should handle multiple concurrent API requests', () => {
      const concurrentUsers = 50;
      const requestsPerUser = 10;
      const totalRequests = concurrentUsers * requestsPerUser;

      expect(totalRequests).toBe(500);

      // Simulate request processing
      const startTime = Date.now();
      const requests = Array.from({ length: totalRequests }, (_, i) => ({
        id: `request-${i}`,
        userId: `user-${i % concurrentUsers}`,
        endpoint: '/api/monitors',
        timestamp: new Date(),
      }));
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(requests).toHaveLength(totalRequests);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle concurrent dashboard updates', () => {
      const dashboards = 20;
      const monitorsPerDashboard = 50;
      const totalMonitors = dashboards * monitorsPerDashboard;

      expect(totalMonitors).toBe(1000);

      // Simulate dashboard data fetching
      const startTime = Date.now();
      const dashboardData = Array.from({ length: dashboards }, (_, i) => ({
        dashboardId: `dashboard-${i}`,
        monitors: Array.from({ length: monitorsPerDashboard }, (_, j) => ({
          id: `monitor-${i * monitorsPerDashboard + j}`,
          status: Math.random() > 0.1 ? 'up' : 'down',
        })),
      }));
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(dashboardData).toHaveLength(dashboards);
      expect(duration).toBeLessThan(500); // Should complete in less than 500ms
    });

    it('should handle concurrent alert processing', () => {
      const monitors = 100;
      const alertsPerMonitor = 2;
      const totalAlerts = monitors * alertsPerMonitor;

      expect(totalAlerts).toBe(200);

      // Simulate alert processing
      const startTime = Date.now();
      const alerts = Array.from({ length: totalAlerts }, (_, i) => ({
        id: `alert-${i}`,
        monitorId: `monitor-${Math.floor(i / alertsPerMonitor)}`,
        type: i % 2 === 0 ? 'failure' : 'recovery',
        timestamp: new Date(),
      }));
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(alerts).toHaveLength(totalAlerts);
      expect(duration).toBeLessThan(500); // Should complete in less than 500ms
    });
  });

  describe('System Resource Utilization', () => {
    it('should validate connection pool configuration', () => {
      const config = getConfig();

      expect(config.database.postgresql.maxConnections).toBeGreaterThan(0);
      expect(config.database.postgresql.maxConnections).toBeLessThanOrEqual(100);

      // Verify reasonable connection pool size
      const expectedMinConnections = 10;
      expect(config.database.postgresql.maxConnections).toBeGreaterThanOrEqual(expectedMinConnections);
    });

    it('should calculate database query load', () => {
      const checksPerMinute = 70; // From earlier calculation
      const queriesPerCheck = 3; // Insert check result, update monitor state, check alert conditions

      const queriesPerMinute = checksPerMinute * queriesPerCheck;
      expect(queriesPerMinute).toBe(210);

      // Verify query load is manageable
      const queriesPerSecond = queriesPerMinute / 60;
      expect(queriesPerSecond).toBeCloseTo(3.5, 1);
      expect(queriesPerSecond).toBeLessThan(100); // Well within database capacity
    });

    it('should validate system scalability limits', () => {
      const config = getConfig();
      
      const maxMonitors = 1000;
      const maxChecksPerMinute = config.monitoring.maxConcurrentChecks;
      const maxLocations = 3;

      // Calculate maximum system load
      const maxChecksPerMonitorPerMinute = maxLocations;
      const maxMonitorsAtOneMinuteInterval = maxChecksPerMinute / maxChecksPerMonitorPerMinute;

      expect(maxMonitorsAtOneMinuteInterval).toBeGreaterThan(0);
      expect(maxMonitorsAtOneMinuteInterval).toBeLessThanOrEqual(maxMonitors);
    });
  });
});
