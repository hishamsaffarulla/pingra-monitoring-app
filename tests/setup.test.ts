/**
 * Deployment Validation Tests
 * 
 * Tests application startup, configuration loading, and database connectivity
 * across different deployment environments.
 * 
 * Requirements: 10.1, 10.2, 10.3
 */

import { getConfig, loadConfig } from '../src/config';

describe('Deployment Validation Tests', () => {
  describe('Configuration Loading', () => {
    it('should load configuration from environment variables', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config).toBeDefined();
      expect(config.env).toBeDefined();
      expect(config.port).toBeGreaterThan(0);
      expect(config.database).toBeDefined();
      expect(config.influxdb).toBeDefined();
      expect(config.redis).toBeDefined();
      expect(config.jwt).toBeDefined();
      expect(config.monitoring).toBeDefined();
    });

    it('should validate required environment variables', () => {
      // Arrange
      const originalEnv = { ...process.env };
      
      // Remove required variable
      delete process.env['DATABASE_URL'];

      // Act & Assert
      expect(() => loadConfig()).toThrow('Missing required environment variables');

      // Cleanup
      process.env = originalEnv;
    });

    it('should parse DATABASE_URL correctly', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.database.postgresql).toBeDefined();
      expect(config.database.postgresql.host).toBeDefined();
      expect(config.database.postgresql.port).toBeGreaterThan(0);
      expect(config.database.postgresql.database).toBeDefined();
      expect(config.database.postgresql.username).toBeDefined();
    });

    it('should parse REDIS_URL correctly', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.database.redis).toBeDefined();
      expect(config.database.redis.host).toBeDefined();
      expect(config.database.redis.port).toBeGreaterThan(0);
    });

    it('should set default values for optional configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.monitoring.defaultTimeout).toBe(30);
      expect(config.monitoring.maxConcurrentChecks).toBe(100);
      expect(config.monitoring.retentionDays).toBe(90);
      expect(config.redis.defaultTTL).toBe(3600);
    });

    it('should handle production environment configuration', () => {
      // Arrange
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.env).toBe('production');
      expect(config.database.postgresql.ssl).toBe(true);

      // Cleanup
      process.env['NODE_ENV'] = originalEnv;
    });

    it('should handle development environment configuration', () => {
      // Arrange
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.env).toBe('development');
      expect(config.database.postgresql.ssl).toBe(false);

      // Cleanup
      process.env['NODE_ENV'] = originalEnv;
    });
  });

  describe('Application Startup', () => {
    it('should validate JWT secret is configured', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.jwt.secret).toBeDefined();
      expect(config.jwt.secret.length).toBeGreaterThan(0);
    });

    it('should validate monitoring configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.monitoring.defaultTimeout).toBeGreaterThan(0);
      expect(config.monitoring.maxConcurrentChecks).toBeGreaterThan(0);
      expect(config.monitoring.retentionDays).toBeGreaterThan(0);
    });

    it('should validate Redis configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.redis.keyPrefix).toBeDefined();
      expect(config.redis.defaultTTL).toBeGreaterThan(0);
      expect(config.redis.sessionTTL).toBeGreaterThan(0);
      expect(config.redis.alertStateTTL).toBeGreaterThan(0);
      expect(config.redis.cacheTTL).toBeGreaterThan(0);
    });

    it('should validate InfluxDB configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.influxdb.org).toBeDefined();
      expect(config.influxdb.bucket).toBeDefined();
      expect(config.influxdb.retentionPeriod).toBeGreaterThan(0);
    });

    it('should validate database connection configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert - PostgreSQL
      expect(config.database.postgresql.host).toBeDefined();
      expect(config.database.postgresql.port).toBeGreaterThan(0);
      expect(config.database.postgresql.database).toBeDefined();
      expect(config.database.postgresql.maxConnections).toBeGreaterThan(0);

      // Assert - InfluxDB
      expect(config.database.influxdb.url).toBeDefined();
      expect(config.database.influxdb.token).toBeDefined();
      expect(config.database.influxdb.org).toBeDefined();
      expect(config.database.influxdb.bucket).toBeDefined();

      // Assert - Redis
      expect(config.database.redis.host).toBeDefined();
      expect(config.database.redis.port).toBeGreaterThan(0);
    });
  });

  describe('Environment-Specific Tests', () => {
    it('should support Docker environment', () => {
      // Arrange
      const config = getConfig();

      // Act & Assert
      // Docker uses service names for hosts
      expect(config.database.postgresql.host).toBeDefined();
      expect(config.database.redis.host).toBeDefined();
    });

    it('should support AWS environment', () => {
      // Arrange
      const originalEnv = { ...process.env };
      
      // Simulate AWS environment
      process.env['DATABASE_URL'] = 'postgresql://user:pass@rds-endpoint.amazonaws.com:5432/db';
      process.env['REDIS_URL'] = 'redis://elasticache-endpoint.amazonaws.com:6379';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.database.postgresql.host).toContain('amazonaws.com');
      expect(config.database.redis.host).toContain('amazonaws.com');

      // Cleanup
      process.env = originalEnv;
    });

    it('should support on-premises environment', () => {
      // Arrange
      const originalEnv = { ...process.env };
      
      // Simulate on-premises environment
      process.env['DATABASE_URL'] = 'postgresql://user:pass@192.168.1.100:5432/db';
      process.env['REDIS_URL'] = 'redis://192.168.1.101:6379';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.database.postgresql.host).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(config.database.redis.host).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

      // Cleanup
      process.env = originalEnv;
    });

    it('should handle different port configurations', () => {
      // Arrange
      const originalEnv = { ...process.env };
      
      // Simulate custom ports
      process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5433/db';
      process.env['REDIS_URL'] = 'redis://localhost:6380';
      process.env['PORT'] = '8080';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.database.postgresql.port).toBe(5433);
      expect(config.database.redis.port).toBe(6380);
      expect(config.port).toBe(8080);

      // Cleanup
      process.env = originalEnv;
    });
  });

  describe('Configuration Validation', () => {
    it('should validate connection pool settings', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.database.postgresql.maxConnections).toBeDefined();
      expect(config.database.postgresql.maxConnections).toBeGreaterThan(0);
      expect(config.database.postgresql.maxConnections).toBeLessThanOrEqual(100);
    });

    it('should validate timeout settings', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.monitoring.defaultTimeout).toBeGreaterThan(0);
      expect(config.monitoring.defaultTimeout).toBeLessThanOrEqual(300);
    });

    it('should validate retention settings', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.monitoring.retentionDays).toBeGreaterThan(0);
      expect(config.influxdb.retentionPeriod).toBeGreaterThan(0);
    });

    it('should validate Redis TTL settings', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.redis.defaultTTL).toBeGreaterThan(0);
      expect(config.redis.sessionTTL).toBeGreaterThan(0);
      expect(config.redis.alertStateTTL).toBeGreaterThan(0);
      expect(config.redis.cacheTTL).toBeGreaterThan(0);
    });

    it('should validate JWT configuration', () => {
      // Arrange & Act
      const config = getConfig();

      // Assert
      expect(config.jwt.secret).toBeDefined();
      expect(config.jwt.secret.length).toBeGreaterThan(0);
      expect(config.jwt.expiresIn).toBeDefined();
      expect(config.jwt.refreshExpiresIn).toBeDefined();
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should parse integer environment variables correctly', () => {
      // Arrange
      const originalEnv = { ...process.env };
      process.env['PORT'] = '3001';
      process.env['DB_MAX_CONNECTIONS'] = '25';
      process.env['DEFAULT_TIMEOUT'] = '45';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.port).toBe(3001);
      expect(config.database.postgresql.maxConnections).toBe(25);
      expect(config.monitoring.defaultTimeout).toBe(45);

      // Cleanup
      process.env = originalEnv;
    });

    it('should handle missing optional environment variables with defaults', () => {
      // Arrange
      const originalEnv = { ...process.env };
      delete process.env['PORT'];
      delete process.env['LOG_LEVEL'];
      delete process.env['DEFAULT_TIMEOUT'];

      // Act
      const config = loadConfig();

      // Assert
      expect(config.port).toBe(3000); // Default
      expect(config.monitoring.defaultTimeout).toBe(30); // Default

      // Cleanup
      process.env = originalEnv;
    });

    it('should handle Redis URL with password', () => {
      // Arrange
      const originalEnv = { ...process.env };
      process.env['REDIS_URL'] = 'redis://:mypassword@localhost:6379';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.database.redis.password).toBe('mypassword');

      // Cleanup
      process.env = originalEnv;
    });

    it('should handle Redis URL without password', () => {
      // Arrange
      const originalEnv = { ...process.env };
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      // Act
      const config = loadConfig();

      // Assert
      expect(config.database.redis.password).toBeUndefined();

      // Cleanup
      process.env = originalEnv;
    });
  });
});
