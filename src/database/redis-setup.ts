/**
 * Redis Setup and Configuration
 * Handles Redis configuration for caching, sessions, and real-time state management
 */

import { RedisClientType } from 'redis';
import { getDatabaseManager } from './connection';
import { logger } from '../utils/logger';

export interface RedisSetupConfig {
  keyPrefix: string;
  defaultTTL: number; // seconds
  sessionTTL: number; // seconds
  alertStateTTL: number; // seconds
  cacheTTL: number; // seconds
}

export class RedisSetup {
  private client: RedisClientType;
  private config: RedisSetupConfig;

  constructor(client: RedisClientType, config: RedisSetupConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Initialize Redis setup - configure key spaces and policies
   */
  async initialize(): Promise<void> {
    try {
      await this.setupKeySpaces();
      await this.configureMemoryPolicy();
      await this.setupHealthCheck();
      
      logger.info('Redis setup completed successfully');
    } catch (error) {
      logger.error('Failed to initialize Redis setup:', error);
      throw error;
    }
  }

  /**
   * Setup key namespaces and patterns
   */
  private async setupKeySpaces(): Promise<void> {
    const keySpaces = {
      sessions: `${this.config.keyPrefix}:session:*`,
      alerts: `${this.config.keyPrefix}:alert:*`,
      cache: `${this.config.keyPrefix}:cache:*`,
      schedules: `${this.config.keyPrefix}:schedule:*`,
      locks: `${this.config.keyPrefix}:lock:*`,
      counters: `${this.config.keyPrefix}:counter:*`,
    };

    // Store key space configuration for reference
    await this.client.hSet(
      `${this.config.keyPrefix}:config:keyspaces`,
      keySpaces
    );

    logger.info('Redis key spaces configured:', Object.keys(keySpaces));
  }

  /**
   * Configure Redis memory policy
   */
  private async configureMemoryPolicy(): Promise<void> {
    try {
      // Set memory policy to evict least recently used keys when memory limit is reached
      await this.client.configSet('maxmemory-policy', 'allkeys-lru');
      
      // Set reasonable memory limit if not set (256MB)
      const maxMemory = await this.client.configGet('maxmemory');
      if (!maxMemory['maxmemory'] || maxMemory['maxmemory'] === '0') {
        await this.client.configSet('maxmemory', '268435456'); // 256MB
      }
      
      logger.info('Redis memory policy configured');
    } catch (error) {
      logger.warn('Could not configure Redis memory policy:', error);
    }
  }

  /**
   * Setup health check key
   */
  private async setupHealthCheck(): Promise<void> {
    const healthKey = `${this.config.keyPrefix}:health`;
    await this.client.set(healthKey, JSON.stringify({
      initialized: new Date().toISOString(),
      version: '1.0.0',
    }), { EX: 3600 }); // 1 hour TTL
  }

  /**
   * Session management methods
   */
  async setSession(sessionId: string, data: any): Promise<void> {
    const key = `${this.config.keyPrefix}:session:${sessionId}`;
    await this.client.set(key, JSON.stringify(data), { EX: this.config.sessionTTL });
  }

  async getSession(sessionId: string): Promise<any | null> {
    const key = `${this.config.keyPrefix}:session:${sessionId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `${this.config.keyPrefix}:session:${sessionId}`;
    await this.client.del(key);
  }

  /**
   * Alert state management methods
   */
  async setAlertState(monitorId: string, state: any): Promise<void> {
    const key = `${this.config.keyPrefix}:alert:${monitorId}`;
    await this.client.set(key, JSON.stringify(state), { EX: this.config.alertStateTTL });
  }

  async getAlertState(monitorId: string): Promise<any | null> {
    const key = `${this.config.keyPrefix}:alert:${monitorId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteAlertState(monitorId: string): Promise<void> {
    const key = `${this.config.keyPrefix}:alert:${monitorId}`;
    await this.client.del(key);
  }

  /**
   * Cache management methods
   */
  async setCache(key: string, data: any, ttl?: number): Promise<void> {
    const cacheKey = `${this.config.keyPrefix}:cache:${key}`;
    const expiry = ttl || this.config.cacheTTL;
    await this.client.set(cacheKey, JSON.stringify(data), { EX: expiry });
  }

  async getCache(key: string): Promise<any | null> {
    const cacheKey = `${this.config.keyPrefix}:cache:${key}`;
    const data = await this.client.get(cacheKey);
    return data ? JSON.parse(data) : null;
  }

  async deleteCache(key: string): Promise<void> {
    const cacheKey = `${this.config.keyPrefix}:cache:${key}`;
    await this.client.del(cacheKey);
  }

  async invalidateCachePattern(pattern: string): Promise<number> {
    const cachePattern = `${this.config.keyPrefix}:cache:${pattern}`;
    const keys = await this.client.keys(cachePattern);
    if (keys.length > 0) {
      return await this.client.del(keys);
    }
    return 0;
  }

  /**
   * Schedule management methods
   */
  async setSchedule(monitorId: string, schedule: any): Promise<void> {
    const key = `${this.config.keyPrefix}:schedule:${monitorId}`;
    await this.client.set(key, JSON.stringify(schedule));
  }

  async getSchedule(monitorId: string): Promise<any | null> {
    const key = `${this.config.keyPrefix}:schedule:${monitorId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async getAllSchedules(): Promise<Record<string, any>> {
    const pattern = `${this.config.keyPrefix}:schedule:*`;
    const keys = await this.client.keys(pattern);
    const schedules: Record<string, any> = {};
    
    for (const key of keys) {
      const monitorId = key.replace(`${this.config.keyPrefix}:schedule:`, '');
      const data = await this.client.get(key);
      if (data) {
        schedules[monitorId] = JSON.parse(data);
      }
    }
    
    return schedules;
  }

  async deleteSchedule(monitorId: string): Promise<void> {
    const key = `${this.config.keyPrefix}:schedule:${monitorId}`;
    await this.client.del(key);
  }

  /**
   * Distributed lock methods
   */
  async acquireLock(lockName: string, ttl: number = 30): Promise<boolean> {
    const key = `${this.config.keyPrefix}:lock:${lockName}`;
    const result = await this.client.set(key, '1', { EX: ttl, NX: true });
    return result === 'OK';
  }

  async releaseLock(lockName: string): Promise<void> {
    const key = `${this.config.keyPrefix}:lock:${lockName}`;
    await this.client.del(key);
  }

  /**
   * Counter methods for failure tracking
   */
  async incrementCounter(counterName: string, ttl?: number): Promise<number> {
    const key = `${this.config.keyPrefix}:counter:${counterName}`;
    const value = await this.client.incr(key);
    
    if (ttl && value === 1) {
      await this.client.expire(key, ttl);
    }
    
    return value;
  }

  async getCounter(counterName: string): Promise<number> {
    const key = `${this.config.keyPrefix}:counter:${counterName}`;
    const value = await this.client.get(key);
    return value ? parseInt(value, 10) : 0;
  }

  async resetCounter(counterName: string): Promise<void> {
    const key = `${this.config.keyPrefix}:counter:${counterName}`;
    await this.client.del(key);
  }

  /**
   * Pub/Sub methods for real-time updates
   */
  async publish(channel: string, message: any): Promise<number> {
    const channelName = `${this.config.keyPrefix}:pubsub:${channel}`;
    return await this.client.publish(channelName, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    const channelName = `${this.config.keyPrefix}:pubsub:${channel}`;
    
    // Note: This requires a separate Redis client for pub/sub
    // In practice, you'd create a dedicated subscriber client
    const subscriber = this.client.duplicate();
    await subscriber.connect();
    
    await subscriber.subscribe(channelName, (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        callback(parsedMessage);
      } catch (error) {
        logger.error('Failed to parse pub/sub message:', error);
      }
    });
  }

  /**
   * Get Redis statistics
   */
  async getStats(): Promise<{
    keyCount: number;
    memoryUsage: string;
    connectedClients: number;
    keySpaceHits: number;
    keySpaceMisses: number;
    hitRatio: number;
  }> {
    const info = await this.client.info();
    const lines = info.split('\r\n');
    const stats: Record<string, string> = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key] = value;
        }
      }
    }
    
    const keySpaceHits = parseInt(stats['keyspace_hits'] || '0', 10);
    const keySpaceMisses = parseInt(stats['keyspace_misses'] || '0', 10);
    const hitRatio = keySpaceHits + keySpaceMisses > 0 
      ? keySpaceHits / (keySpaceHits + keySpaceMisses) 
      : 0;

    return {
      keyCount: await this.client.dbSize(),
      memoryUsage: stats['used_memory_human'] || '0B',
      connectedClients: parseInt(stats['connected_clients'] || '0', 10),
      keySpaceHits,
      keySpaceMisses,
      hitRatio: Math.round(hitRatio * 100) / 100,
    };
  }

  /**
   * Cleanup expired keys and perform maintenance
   */
  async cleanup(): Promise<void> {
    try {
      // Force expire check
      await this.client.eval(`
        local keys = redis.call('keys', ARGV[1])
        local expired = 0
        for i=1,#keys do
          if redis.call('ttl', keys[i]) == -1 then
            redis.call('expire', keys[i], 1)
            expired = expired + 1
          end
        end
        return expired
      `, {
        keys: [],
        arguments: [`${this.config.keyPrefix}:*`],
      });
      
      logger.info('Redis cleanup completed');
    } catch (error) {
      logger.error('Redis cleanup failed:', error);
    }
  }
}

/**
 * Create and initialize Redis setup
 */
export async function setupRedis(config: RedisSetupConfig): Promise<RedisSetup> {
  const dbManager = getDatabaseManager();
  const client = dbManager.getRedisClient();
  
  const setup = new RedisSetup(client, config);
  await setup.initialize();
  
  return setup;
}