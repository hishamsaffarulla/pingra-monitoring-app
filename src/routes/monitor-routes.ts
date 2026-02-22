/**
 * Monitor Management Routes
 * Handles CRUD operations for monitor configuration
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { MonitorRepository } from '../database/repositories';
import { validateMonitor, validateUrl } from '../utils/validation';
import { setTenantCache, getTenantCache, invalidateTenantCachePattern } from '../services/tenant-cache-service';
import { CreateMonitorRequest, CheckInterval } from '../types';
import { logger } from '../utils/logger';
import { getOrchestrator } from '../services/application-orchestrator';
import { getDatabaseManager } from '../database/connection';
import { getConfig } from '../config';

const MONITOR_CACHE_TTL = 300; // 5 minutes

export function createMonitorRouter(dbPool: Pool): Router {
  const router = Router();
  const monitorRepo = new MonitorRepository(dbPool);

  const getScheduler = () => {
    try {
      const orchestrator = getOrchestrator();
      if (!orchestrator.isReady()) return null;
      return orchestrator.getComponents().scheduler;
    } catch {
      return null;
    }
  };

  // Apply authentication and tenant isolation to all routes
  router.use(authenticate);
  router.use(enforceTenantIsolation);

  /**
   * GET /api/monitors
   * List all monitors for the authenticated tenant
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const limit = parseInt(req.query['limit'] as string) || 50;
      const offset = parseInt(req.query['offset'] as string) || 0;
      const orderBy = (req.query['orderBy'] as string) || 'created_at';
      const direction = (req.query['direction'] as 'ASC' | 'DESC') || 'DESC';

      // Try to get from cache
      const cacheKey = `monitors:list:${limit}:${offset}:${orderBy}:${direction}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Monitor list cache hit', { tenantId });
        res.status(200).json(cached);
        return;
      }

      // Fetch from database
      const { monitors, total } = await monitorRepo.findMany(
        { tenantId },
        { limit, offset, orderBy: orderBy as any, direction }
      );

      const response = {
        monitors,
        total,
        limit,
        offset,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, MONITOR_CACHE_TTL);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Failed to list monitors', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve monitors',
      });
    }
  });

  /**
   * GET /api/monitors/:id
   * Get a specific monitor by ID
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      // Try to get from cache
      const cacheKey = `monitor:${id}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Monitor cache hit', { tenantId, monitorId: id });
        res.status(200).json(cached);
        return;
      }

      // Fetch from database
      const monitor = await monitorRepo.findById(id, tenantId);

      if (!monitor) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      // Cache the result
      await setTenantCache(tenantId, cacheKey, monitor, MONITOR_CACHE_TTL);

      res.status(200).json(monitor);
    } catch (error) {
      logger.error('Failed to get monitor', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve monitor',
      });
    }
  });

  /**
   * POST /api/monitors
   * Create a new monitor
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const monitorData: CreateMonitorRequest = req.body;

      // Validate monitor data
      const validation = validateMonitor(monitorData);
      if (!validation.isValid) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid monitor configuration',
          errors: validation.errors,
        });
        return;
      }

      // Validate URL format
      const urlValidation = validateUrl(monitorData.url);
      if (!urlValidation.isValid) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid URL format',
          errors: urlValidation.errors,
        });
        return;
      }

      // Create monitor
      const monitor = await monitorRepo.create({
        tenantId,
        name: monitorData.name,
        url: monitorData.url,
        checkInterval: monitorData.checkInterval,
        timeoutSeconds: monitorData.timeoutSeconds,
        expectedStatusCodes:
          monitorData.expectedStatusCodes || [200, 301, 302, 307, 308],
        probeLocations: monitorData.probeLocations,
        failureThreshold: monitorData.failureThreshold || 3,
      });

      // Invalidate list cache
      await invalidateTenantCachePattern(tenantId, 'monitors:list:*');

      logger.info('Monitor created', { tenantId, monitorId: monitor.id, name: monitor.name });

      // Schedule checks for new monitor
      try {
        const scheduler = getScheduler();
        if (scheduler) {
          scheduler.scheduleCheck(monitor.id, monitor.checkInterval);
        }
      } catch (scheduleError) {
        logger.warn('Failed to schedule monitor after creation', { error: scheduleError, monitorId: monitor.id });
      }

      res.status(201).json(monitor);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as any).code;
        const constraint = (error as any).constraint;
        if (code === '23505' && constraint === 'monitors_tenant_name_unique') {
          res.status(409).json({
            error: 'Conflict',
            message: 'A monitor with this name already exists',
          });
          return;
        }
      }
      logger.error('Failed to create monitor', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create monitor',
      });
    }
  });

  /**
   * POST /api/monitors/:id/run
   * Trigger an immediate check for a monitor
   */
  router.post('/:id/run', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      const monitor = await monitorRepo.findById(id, tenantId);
      if (!monitor) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      const orchestrator = getOrchestrator();
      if (!orchestrator.isReady()) {
        res.status(503).json({
          error: 'Service unavailable',
          message: 'Monitoring engine is not ready',
        });
        return;
      }

      const { probeService, repositories } = orchestrator.getComponents();
      const { alertEngine } = orchestrator.getComponents();
      const startedAt = new Date();
      const results = await probeService.executeMultiLocationCheck(monitor);
      const completedAt = new Date();

      for (const result of results) {
        await alertEngine.processCheckResult(result);
      }

      let latestCheck = null;
      try {
        latestCheck = await repositories.checkResult.findLatestByMonitor(id);
      } catch (latestError) {
        logger.warn('Failed to fetch latest check after run', { error: latestError, monitorId: id });
      }

      res.status(200).json({
        monitorId: id,
        startedAt,
        completedAt,
        locationCount: results.length,
        successCount: results.filter(result => result.success).length,
        failureCount: results.filter(result => !result.success).length,
        latestCheck,
      });
    } catch (error) {
      logger.error('Failed to run monitor check', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to run monitor check',
      });
    }
  });

  /**
   * PUT /api/monitors/:id
   * Update an existing monitor
   */
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;
      const updates: Partial<CreateMonitorRequest> = req.body;

      // Validate updates if provided
      if (updates.url) {
        const urlValidation = validateUrl(updates.url);
        if (!urlValidation.isValid) {
          res.status(400).json({
            error: 'Validation error',
            message: 'Invalid URL format',
            errors: urlValidation.errors,
          });
          return;
        }
      }

      // Validate intervals and timeouts
      if (updates.checkInterval !== undefined) {
        const validIntervals = [CheckInterval.ONE_MINUTE, CheckInterval.FIVE_MINUTES];
        if (!validIntervals.includes(updates.checkInterval)) {
          res.status(400).json({
            error: 'Validation error',
            message: 'Invalid check interval',
          });
          return;
        }
      }

      if (updates.timeoutSeconds !== undefined) {
        if (updates.timeoutSeconds < 1 || updates.timeoutSeconds > 60) {
          res.status(400).json({
            error: 'Validation error',
            message: 'Timeout must be between 1 and 60 seconds',
          });
          return;
        }
      }

      // Update monitor
      const monitor = await monitorRepo.update(id, updates, tenantId);

      if (!monitor) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      // Invalidate caches
      await invalidateTenantCachePattern(tenantId, `monitor:${id}`);
      await invalidateTenantCachePattern(tenantId, 'monitors:list:*');

      logger.info('Monitor updated', { tenantId, monitorId: id });

      // Update schedule if interval changed
      if (updates.checkInterval !== undefined) {
        try {
          const scheduler = getScheduler();
          if (scheduler) {
            scheduler.updateSchedule(id, updates.checkInterval);
          }
        } catch (scheduleError) {
          logger.warn('Failed to update monitor schedule', { error: scheduleError, monitorId: id });
        }
      }

      res.status(200).json(monitor);
    } catch (error) {
      logger.error('Failed to update monitor', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update monitor',
      });
    }
  });

  /**
   * DELETE /api/monitors/:id
   * Delete a monitor
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      const deleted = await monitorRepo.delete(id, tenantId);

      if (!deleted) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      // Invalidate caches
      await invalidateTenantCachePattern(tenantId, `monitor:${id}`);
      await invalidateTenantCachePattern(tenantId, 'monitors:list:*');

      logger.info('Monitor deleted', { tenantId, monitorId: id });

      // Cancel scheduled checks
      try {
        const scheduler = getScheduler();
        if (scheduler) {
          scheduler.cancelCheck(id);
        }
      } catch (scheduleError) {
        logger.warn('Failed to cancel monitor schedule', { error: scheduleError, monitorId: id });
      }

      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete monitor', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete monitor',
      });
    }
  });

  /**
   * GET /api/monitors/:id/status
   * Get current status of a monitor
   */
  router.get('/:id/status', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      // Verify monitor exists and belongs to tenant
      const monitor = await monitorRepo.findById(id, tenantId);
      if (!monitor) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      // Try to get status from cache
      const statusCacheKey = `monitor:${id}:status`;
      const cached = await getTenantCache(tenantId, statusCacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      const config = getConfig();
      const redis = getDatabaseManager().getRedisClient();
      const redisStatusKey = `${config.redis.keyPrefix}:cache:monitor-status:${id}`;
      let aggregated: any = null;
      try {
        const raw = await redis.get(redisStatusKey);
        aggregated = raw ? JSON.parse(raw) : null;
      } catch (error) {
        logger.warn('Failed to read aggregated status from Redis', { error, monitorId: id });
      }

      let latestCheck: any = null;
      try {
        const orchestrator = getOrchestrator();
        if (orchestrator.isReady()) {
          latestCheck = await orchestrator.getComponents().repositories.checkResult.findLatestByMonitor(id);
        }
      } catch (error) {
        logger.warn('Failed to read latest check for status', { error, monitorId: id });
      }

      const currentStatus = aggregated
        ? (aggregated.isHealthy ? 'up' : 'down')
        : (latestCheck ? (latestCheck.success ? 'up' : 'down') : 'unknown');

      const status = {
        monitorId: id,
        currentStatus,
        aggregatedStatus: aggregated || null,
        latestCheck,
      };

      // Cache for shorter duration (30 seconds)
      await setTenantCache(tenantId, statusCacheKey, status, 30);

      res.status(200).json(status);
    } catch (error) {
      logger.error('Failed to get monitor status', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve monitor status',
      });
    }
  });

  /**
   * GET /api/monitors/:id/health
   * Get health check information for a monitor
   */
  router.get('/:id/health', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      // Verify monitor exists and belongs to tenant
      const monitor = await monitorRepo.findById(id, tenantId);
      if (!monitor) {
        res.status(404).json({
          error: 'Not found',
          message: 'Monitor not found',
        });
        return;
      }

      // TODO: Implement actual health check retrieval
      // For now, return a placeholder
      const health = {
        monitorId: id,
        isHealthy: true,
        lastCheckTime: new Date(),
        consecutiveFailures: 0,
        uptime24h: 100.0,
      };

      res.status(200).json(health);
    } catch (error) {
      logger.error('Failed to get monitor health', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve monitor health',
      });
    }
  });

  return router;
}
