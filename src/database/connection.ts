/**
 * Database Connection Management
 * Handles connections to PostgreSQL, InfluxDB, and Redis
 */

import { Pool, PoolClient } from 'pg';
import { InfluxDB, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export interface DatabaseConfig {
  postgresql: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
    maxConnections?: number;
  };
  influxdb: {
    url: string;
    token: string;
    org: string;
    bucket: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string | undefined;
    db?: number;
  };
}

export class DatabaseManager {
  private pgPool: Pool | null = null;
  private influxDB: InfluxDB | null = null;
  private influxWriteApi: WriteApi | null = null;
  private influxQueryApi: QueryApi | null = null;
  private redisClient: RedisClientType | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize all database connections
   */
  async initialize(): Promise<void> {
    try {
      await this.initializePostgreSQL();
      await this.initializeInfluxDB();
      await this.initializeRedis();
      
      logger.info('All database connections initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database connections:', error);
      throw error;
    }
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  private async initializePostgreSQL(): Promise<void> {
    const { postgresql } = this.config;
    
    this.pgPool = new Pool({
      host: postgresql.host,
      port: postgresql.port,
      database: postgresql.database,
      user: postgresql.username,
      password: postgresql.password,
      ssl: postgresql.ssl ? { rejectUnauthorized: false } : false,
      max: postgresql.maxConnections || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await this.pgPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    logger.info('PostgreSQL connection pool initialized');
  }

  /**
   * Initialize InfluxDB connection
   */
  private async initializeInfluxDB(): Promise<void> {
    const { influxdb } = this.config;
    
    this.influxDB = new InfluxDB({
      url: influxdb.url,
      token: influxdb.token,
    });

    this.influxWriteApi = this.influxDB.getWriteApi(influxdb.org, influxdb.bucket);
    this.influxQueryApi = this.influxDB.getQueryApi(influxdb.org);

    // Configure write options
    this.influxWriteApi.useDefaultTags({ application: 'url-monitoring' });

    // Test connection by creating the APIs (they will throw if connection fails)
    logger.info('InfluxDB connection initialized');
  }

  /**
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    const { redis } = this.config;
    
    const redisOptions: any = {
      socket: {
        host: redis.host,
        port: redis.port,
      },
      database: redis.db || 0,
    };

    if (redis.password) {
      redisOptions.password = redis.password;
    }

    this.redisClient = createClient(redisOptions);

    this.redisClient.on('error', (error) => {
      logger.error('Redis client error:', error);
    });

    this.redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    await this.redisClient.connect();
    
    // Test connection
    await this.redisClient.ping();
    
    logger.info('Redis connection initialized');
  }

  /**
   * Get PostgreSQL pool
   */
  getPostgreSQLPool(): Pool {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }
    return this.pgPool;
  }

  /**
   * Get PostgreSQL client from pool
   */
  async getPostgreSQLClient(): Promise<PoolClient> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }
    return this.pgPool.connect();
  }

  /**
   * Get InfluxDB write API
   */
  getInfluxWriteApi(): WriteApi {
    if (!this.influxWriteApi) {
      throw new Error('InfluxDB write API not initialized');
    }
    return this.influxWriteApi;
  }

  /**
   * Get InfluxDB query API
   */
  getInfluxQueryApi(): QueryApi {
    if (!this.influxQueryApi) {
      throw new Error('InfluxDB query API not initialized');
    }
    return this.influxQueryApi;
  }

  /**
   * Get Redis client
   */
  getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      throw new Error('Redis client not initialized');
    }
    return this.redisClient;
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    if (this.pgPool) {
      closePromises.push(this.pgPool.end());
    }

    if (this.influxWriteApi) {
      closePromises.push(this.influxWriteApi.close());
    }

    if (this.redisClient) {
      closePromises.push(this.redisClient.quit().then(() => {}));
    }

    await Promise.all(closePromises);
    logger.info('All database connections closed');
  }

  /**
   * Health check for all databases
   */
  async healthCheck(): Promise<{ postgresql: boolean; influxdb: boolean; redis: boolean }> {
    const health = {
      postgresql: false,
      influxdb: false,
      redis: false,
    };

    try {
      if (this.pgPool) {
        const client = await this.pgPool.connect();
        await client.query('SELECT 1');
        client.release();
        health.postgresql = true;
      }
    } catch (error) {
      logger.error('PostgreSQL health check failed:', error);
    }

    try {
      if (this.influxDB) {
        // Try a simple query to test connection
        const orgsAPI = new (await import('@influxdata/influxdb-client-apis')).OrgsAPI(this.influxDB);
        await orgsAPI.getOrgs();
        health.influxdb = true;
      }
    } catch (error) {
      logger.error('InfluxDB health check failed:', error);
    }

    try {
      if (this.redisClient) {
        await this.redisClient.ping();
        health.redis = true;
      }
    } catch (error) {
      logger.error('Redis health check failed:', error);
    }

    return health;
  }
}

// Singleton instance
let databaseManager: DatabaseManager | null = null;

export function createDatabaseManager(config: DatabaseConfig): DatabaseManager {
  if (databaseManager) {
    throw new Error('Database manager already created');
  }
  databaseManager = new DatabaseManager(config);
  return databaseManager;
}

export function getDatabaseManager(): DatabaseManager {
  if (!databaseManager) {
    throw new Error('Database manager not initialized');
  }
  return databaseManager;
}