/**
 * Alert and Notification Channel Routes
 * Handles alert history retrieval and notification channel management
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { AlertRepository, MonitorRepository, NotificationChannelRepository } from '../database/repositories';
import { validateNotificationChannel } from '../utils/validation';
import { setTenantCache, getTenantCache } from '../services/tenant-cache-service';
import { AlertType, CreateNotificationChannelRequest } from '../types';
import { logger } from '../utils/logger';

const ALERT_CACHE_TTL = 60; // 1 minute

export function createAlertRouter(dbPool: Pool): Router {
  const router = Router();
  const alertRepo = new AlertRepository(dbPool);
  const monitorRepo = new MonitorRepository(dbPool);
  const channelRepo = new NotificationChannelRepository(dbPool);

  // Apply authentication and tenant isolation to all routes
  router.use(authenticate);
  router.use(enforceTenantIsolation);

  /**
   * GET /api/alerts
   * Get alert history with filtering
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      
      // Parse query parameters
      const limit = parseInt(req.query['limit'] as string) || 50;
      const offset = parseInt(req.query['offset'] as string) || 0;
      const monitorId = req.query['monitorId'] as string | undefined;
      const alertType = req.query['type'] as AlertType | undefined;
      const resolved = req.query['resolved'] === 'true' ? true : 
                       req.query['resolved'] === 'false' ? false : undefined;
      const startTime = req.query['startTime'] 
        ? new Date(req.query['startTime'] as string)
        : undefined;
      const endTime = req.query['endTime'] 
        ? new Date(req.query['endTime'] as string)
        : undefined;

      // If monitorId is provided, verify it belongs to tenant
      if (monitorId) {
        const monitor = await monitorRepo.findById(monitorId, tenantId);
        if (!monitor) {
          res.status(404).json({
            error: 'Not found',
            message: 'Monitor not found',
          });
          return;
        }
      }

      // Try to get from cache
      const cacheKey = `alerts:${monitorId || 'all'}:${alertType || 'all'}:${resolved}:${limit}:${offset}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Alert history cache hit', { tenantId });
        res.status(200).json(cached);
        return;
      }

      // Fetch from database
      const filters: any = {
        triggeredAfter: startTime,
        triggeredBefore: endTime,
      };
      
      if (monitorId) filters.monitorId = monitorId;
      if (alertType) filters.type = alertType;
      if (resolved !== undefined) filters.resolved = resolved;
      
      const { alerts } = await alertRepo.findMany(
        filters,
        { limit, offset, direction: 'DESC' }
      );

      // Filter alerts to only include those from tenant's monitors
      const tenantMonitors = await monitorRepo.findByTenant(tenantId);
      const tenantMonitorIds = new Set(tenantMonitors.map((m: any) => m.id));
      const filteredAlerts = alerts.filter((alert: any) => tenantMonitorIds.has(alert.monitorId));

      const response = {
        alerts: filteredAlerts,
        total: filteredAlerts.length,
        limit,
        offset,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, ALERT_CACHE_TTL);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Failed to get alert history', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve alert history',
      });
    }
  });

  /**
   * GET /api/monitors/:id/alerts
   * Get alerts for a specific monitor
   */
  router.get('/monitors/:id/alerts', async (req: Request, res: Response) => {
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

      // Parse query parameters
      const limit = parseInt(req.query['limit'] as string) || 50;
      const offset = parseInt(req.query['offset'] as string) || 0;
      const alertType = req.query['type'] as AlertType | undefined;
      const resolved = req.query['resolved'] === 'true' ? true : 
                       req.query['resolved'] === 'false' ? false : undefined;

      // Try to get from cache
      const cacheKey = `monitor-alerts:${id}:${alertType || 'all'}:${resolved}:${limit}:${offset}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      // Fetch from database
      const filters: any = {
        monitorId: id,
      };
      
      if (alertType) filters.type = alertType;
      if (resolved !== undefined) filters.resolved = resolved;
      
      const { alerts, total } = await alertRepo.findMany(
        filters,
        { limit, offset, direction: 'DESC' }
      );

      const response = {
        monitorId: id,
        alerts,
        total,
        limit,
        offset,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, ALERT_CACHE_TTL);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Failed to get monitor alerts', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve monitor alerts',
      });
    }
  });

  /**
   * GET /api/notification-channels
   * List all notification channels for the tenant
   */
  router.get('/notification-channels', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;

      // Try to get from cache
      const cacheKey = 'notification-channels:list';
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      const channels = await channelRepo.findMany(tenantId);
      const response = channels;

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, ALERT_CACHE_TTL);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Failed to list notification channels', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve notification channels',
      });
    }
  });

  /**
   * GET /api/notification-channels/:id
   * Get a specific notification channel
   */
  router.get('/notification-channels/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const tenantId = req.user!.tenantId;

      // Try to get from cache
      const cacheKey = `notification-channel:${id}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      const response = await channelRepo.findById(id, tenantId);
      if (!response) {
        res.status(404).json({
          error: 'Not found',
          message: 'Notification channel not found',
        });
        return;
      }

      await setTenantCache(tenantId, cacheKey, response, ALERT_CACHE_TTL);
      res.status(200).json(response);
    } catch (error) {
      logger.error('Failed to get notification channel', { error, channelId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve notification channel',
      });
    }
  });

  /**
   * POST /api/notification-channels
   * Create a new notification channel
   */
  router.post('/notification-channels', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const channelData: CreateNotificationChannelRequest = req.body;

      // Validate channel data
      const validation = validateNotificationChannel({ ...channelData, tenantId, id: '' });
      if (!validation.isValid) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid notification channel configuration',
          errors: validation.errors,
        });
        return;
      }

      const response = await channelRepo.create({
        tenantId,
        name: channelData.name || `${channelData.type}-channel`,
        type: channelData.type,
        configuration: channelData.configuration,
        enabled: channelData.enabled ?? true,
      });

      await setTenantCache(tenantId, 'notification-channels:list', null, 1);
      res.status(201).json(response);
    } catch (error) {
      logger.error('Failed to create notification channel', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create notification channel',
      });
    }
  });

  /**
   * PUT /api/notification-channels/:id
   * Update a notification channel
   */
  router.put('/notification-channels/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const id = req.params['id'] as string;
      const updated = await channelRepo.update(id, tenantId, req.body);
      if (!updated) {
        res.status(404).json({
          error: 'Not found',
          message: 'Notification channel not found',
        });
        return;
      }
      await setTenantCache(tenantId, 'notification-channels:list', null, 1);
      res.status(200).json(updated);
    } catch (error) {
      logger.error('Failed to update notification channel', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update notification channel',
      });
    }
  });

  /**
   * DELETE /api/notification-channels/:id
   * Delete a notification channel
   */
  router.delete('/notification-channels/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const id = req.params['id'] as string;
      const deleted = await channelRepo.delete(id, tenantId);
      if (!deleted) {
        res.status(404).json({
          error: 'Not found',
          message: 'Notification channel not found',
        });
        return;
      }
      await setTenantCache(tenantId, 'notification-channels:list', null, 1);
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete notification channel', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete notification channel',
      });
    }
  });

  /**
   * POST /api/notification-channels/:id/test
   * Test a notification channel
   */
  router.post('/notification-channels/:id/test', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const _tenantId = req.user!.tenantId;

      // TODO: Implement notification channel testing
      const testResult = {
        channelId: id,
        type: 'email',
        success: true,
        message: 'Test notification sent successfully (placeholder)',
        timestamp: new Date(),
      };

      logger.info('Notification channel tested', { tenantId: _tenantId, channelId: id });

      res.status(200).json(testResult);
    } catch (error) {
      logger.error('Failed to test notification channel', { error, channelId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to test notification channel',
      });
    }
  });

  return router;
}
