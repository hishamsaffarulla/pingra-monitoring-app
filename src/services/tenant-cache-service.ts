/**
 * Tenant Cache Service
 * Provides tenant-isolated caching with Redis
 */

import { getDatabaseManager } from '../database/connection';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

const TENANT_CACHE_PREFIX = 'tenant:cache:';

/**
 * Get tenant-specific cache key
 */
function getTenantCacheKey(tenantId: string, key: string): string {
  return `${TENANT_CACHE_PREFIX}${tenantId}:${key}`;
}

/**
 * Set cache value for a specific tenant
 */
export async function setTenantCache(
  tenantId: string,
  key: string,
  value: any,
  ttl?: number
): Promise<void> {
  const redis = getDatabaseManager().getRedisClient();
  const config = getConfig();
  const cacheKey = getTenantCacheKey(tenantId, key);
  const expiry = ttl || config.redis.cacheTTL;

  await redis.setEx(cacheKey, expiry, JSON.stringify(value));
  logger.debug('Tenant cache set', { tenantId, key, ttl: expiry });
}

/**
 * Get cache value for a specific tenant
 */
export async function getTenantCache(
  tenantId: string,
  key: string
): Promise<any | null> {
  const redis = getDatabaseManager().getRedisClient();
  const cacheKey = getTenantCacheKey(tenantId, key);

  const data = await redis.get(cacheKey);
  if (!data) {
    logger.debug('Tenant cache miss', { tenantId, key });
    return null;
  }

  logger.debug('Tenant cache hit', { tenantId, key });
  return JSON.parse(data);
}

/**
 * Delete cache value for a specific tenant
 */
export async function deleteTenantCache(
  tenantId: string,
  key: string
): Promise<void> {
  const redis = getDatabaseManager().getRedisClient();
  const cacheKey = getTenantCacheKey(tenantId, key);

  await redis.del(cacheKey);
  logger.debug('Tenant cache deleted', { tenantId, key });
}

/**
 * Invalidate all cache entries for a specific tenant
 */
export async function invalidateTenantCache(tenantId: string): Promise<number> {
  const redis = getDatabaseManager().getRedisClient();
  const pattern = `${TENANT_CACHE_PREFIX}${tenantId}:*`;

  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    const deleted = await redis.del(keys);
    logger.info('Tenant cache invalidated', { tenantId, keysDeleted: deleted });
    return deleted;
  }

  return 0;
}

/**
 * Invalidate cache entries matching a pattern for a specific tenant
 */
export async function invalidateTenantCachePattern(
  tenantId: string,
  pattern: string
): Promise<number> {
  const redis = getDatabaseManager().getRedisClient();
  const searchPattern = `${TENANT_CACHE_PREFIX}${tenantId}:${pattern}`;

  const keys = await redis.keys(searchPattern);
  if (keys.length > 0) {
    const deleted = await redis.del(keys);
    logger.info('Tenant cache pattern invalidated', {
      tenantId,
      pattern,
      keysDeleted: deleted,
    });
    return deleted;
  }

  return 0;
}

/**
 * Get all cache keys for a specific tenant
 */
export async function getTenantCacheKeys(tenantId: string): Promise<string[]> {
  const redis = getDatabaseManager().getRedisClient();
  const pattern = `${TENANT_CACHE_PREFIX}${tenantId}:*`;

  const keys = await redis.keys(pattern);
  
  // Remove prefix to return clean key names
  const prefix = `${TENANT_CACHE_PREFIX}${tenantId}:`;
  return keys.map((key) => key.replace(prefix, ''));
}

/**
 * Check if cache key exists for a specific tenant
 */
export async function tenantCacheExists(
  tenantId: string,
  key: string
): Promise<boolean> {
  const redis = getDatabaseManager().getRedisClient();
  const cacheKey = getTenantCacheKey(tenantId, key);

  const exists = await redis.exists(cacheKey);
  return exists === 1;
}

/**
 * Get cache statistics for a specific tenant
 */
export async function getTenantCacheStats(tenantId: string): Promise<{
  keyCount: number;
  keys: string[];
}> {
  const keys = await getTenantCacheKeys(tenantId);
  
  return {
    keyCount: keys.length,
    keys,
  };
}
