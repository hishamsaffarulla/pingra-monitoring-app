/**
 * Application Configuration
 * Centralized configuration management with environment variable support
 */

import dotenv from 'dotenv';
import { DatabaseConfig } from '../database/connection';
import { InfluxDBSetupConfig } from '../database/influx-setup';
import { RedisSetupConfig } from '../database/redis-setup';

// Load environment variables
dotenv.config();

export interface AppConfig {
  env: string;
  port: number;
  database: DatabaseConfig;
  influxdb: InfluxDBSetupConfig;
  redis: RedisSetupConfig;
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  monitoring: {
    defaultTimeout: number;
    maxConcurrentChecks: number;
    retentionDays: number;
  };
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): AppConfig {
  // Validate required environment variables
  const requiredEnvVars = [
    'DATABASE_URL',
    'INFLUXDB_URL',
    'INFLUXDB_TOKEN',
    'INFLUXDB_ORG',
    'INFLUXDB_BUCKET',
    'REDIS_URL',
    'JWT_SECRET',
  ];

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Parse DATABASE_URL
  const databaseUrl = new URL(process.env['DATABASE_URL']!);
  const sslMode = databaseUrl.searchParams.get('sslmode');
  const useSSL = sslMode !== 'disable' && process.env['NODE_ENV'] === 'production';
  
  // Parse REDIS_URL
  const redisUrl = new URL(process.env['REDIS_URL']!);

  const config: AppConfig = {
    env: process.env['NODE_ENV'] || 'development',
    port: parseInt(process.env['PORT'] || '3000', 10),
    
    database: {
      postgresql: {
        host: databaseUrl.hostname,
        port: parseInt(databaseUrl.port || '5432', 10),
        database: databaseUrl.pathname.slice(1), // Remove leading slash
        username: databaseUrl.username,
        password: databaseUrl.password,
        ssl: useSSL,
        maxConnections: parseInt(process.env['DB_MAX_CONNECTIONS'] || '20', 10),
      },
      influxdb: {
        url: process.env['INFLUXDB_URL']!,
        token: process.env['INFLUXDB_TOKEN']!,
        org: process.env['INFLUXDB_ORG']!,
        bucket: process.env['INFLUXDB_BUCKET']!,
      },
      redis: {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379', 10),
        password: redisUrl.password || undefined,
        db: parseInt(process.env['REDIS_DB'] || '0', 10),
      },
    },

    influxdb: {
      org: process.env['INFLUXDB_ORG']!,
      bucket: process.env['INFLUXDB_BUCKET']!,
      retentionPeriod: parseInt(process.env['INFLUXDB_RETENTION_DAYS'] || '90', 10) * 24 * 60 * 60, // Convert days to seconds
      description: 'URL monitoring check results and metrics',
    },

    redis: {
      keyPrefix: process.env['REDIS_KEY_PREFIX'] || 'url-monitor',
      defaultTTL: parseInt(process.env['REDIS_DEFAULT_TTL'] || '3600', 10), // 1 hour
      sessionTTL: parseInt(process.env['REDIS_SESSION_TTL'] || '86400', 10), // 24 hours
      alertStateTTL: parseInt(process.env['REDIS_ALERT_STATE_TTL'] || '604800', 10), // 7 days
      cacheTTL: parseInt(process.env['REDIS_CACHE_TTL'] || '1800', 10), // 30 minutes
    },

    jwt: {
      secret: process.env['JWT_SECRET']!,
      expiresIn: process.env['JWT_EXPIRES_IN'] || '1h',
      refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || '7d',
    },

    monitoring: {
      defaultTimeout: parseInt(process.env['DEFAULT_TIMEOUT'] || '30', 10),
      maxConcurrentChecks: parseInt(process.env['MAX_CONCURRENT_CHECKS'] || '100', 10),
      retentionDays: parseInt(process.env['DATA_RETENTION_DAYS'] || '90', 10),
    },
  };

  return config;
}

/**
 * Get configuration instance (singleton)
 */
let configInstance: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}