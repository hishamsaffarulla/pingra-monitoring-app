/**
 * Check Results and Metrics Routes
 * Handles retrieval of check history, uptime metrics, and response time statistics
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { MonitorRepository } from '../database/repositories';
import { CheckResultRepository } from '../database/repositories/check-result-repository';
import { setTenantCache, getTenantCache } from '../services/tenant-cache-service';
import { ProbeLocation, TimePeriod } from '../types';
import { logger } from '../utils/logger';

const METRICS_CACHE_TTL = 60; // 1 minute
const CHECK_HISTORY_CACHE_TTL = 30; // 30 seconds

export function createMetricsRouter(
  dbPool: Pool,
  influxWriteApi: WriteApi,
  influxQueryApi: QueryApi,
  influxBucket: string
): Router {
  const router = Router();
  const monitorRepo = new MonitorRepository(dbPool);
  const checkResultRepo = new CheckResultRepository(influxWriteApi, influxQueryApi, influxBucket);

  // Apply authentication and tenant isolation to all routes
  router.use(authenticate);
  router.use(enforceTenantIsolation);

  /**
   * GET /api/monitors/:id/checks
   * Get check history for a monitor
   */
  router.get('/:id/checks', async (req: Request, res: Response) => {
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
      const limit = parseInt(req.query['limit'] as string) || 100;
      const location = req.query['location'] as ProbeLocation | undefined;
      const startTime = req.query['startTime'] 
        ? new Date(req.query['startTime'] as string)
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
      const endTime = req.query['endTime'] 
        ? new Date(req.query['endTime'] as string)
        : new Date();

      // Try to get from cache
      const cacheKey = `checks:${id}:${limit}:${location || 'all'}:${startTime.getTime()}:${endTime.getTime()}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Check history cache hit', { tenantId, monitorId: id });
        res.status(200).json(cached);
        return;
      }

      // Fetch from InfluxDB
      const filters: any = {
        monitorId: id,
        startTime,
        endTime,
      };
      
      if (location) filters.location = location;
      
      const checks = await checkResultRepo.findMany(
        filters,
        { limit, direction: 'DESC' }
      );

      const response = {
        monitorId: id,
        checks,
        startTime,
        endTime,
        location: location || 'all',
        count: checks.length,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, CHECK_HISTORY_CACHE_TTL);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get check history', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve check history',
      });
    }
  });

  /**
   * GET /api/monitors/:id/uptime
   * Get uptime percentage for a monitor
   */
  router.get('/:id/uptime', async (req: Request, res: Response) => {
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
      const period = (req.query['period'] as TimePeriod) || TimePeriod.LAST_24_HOURS;
      const location = req.query['location'] as ProbeLocation | undefined;

      // Calculate time range based on period
      const endTime = new Date();
      let startTime: Date;
      
      switch (period) {
        case TimePeriod.LAST_24_HOURS:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_7_DAYS:
          startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_30_DAYS:
          startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      // Try to get from cache
      const cacheKey = `uptime:${id}:${period}:${location || 'all'}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Uptime metrics cache hit', { tenantId, monitorId: id });
        res.status(200).json(cached);
        return;
      }

      // Fetch from InfluxDB
      const stats = await checkResultRepo.getUptimeStats(id, startTime, endTime, location);

      const response = {
        monitorId: id,
        period,
        location: location || 'all',
        ...stats,
        startTime,
        endTime,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, METRICS_CACHE_TTL);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get uptime metrics', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve uptime metrics',
      });
    }
  });

  /**
   * GET /api/monitors/:id/response-times
   * Get response time metrics and aggregations
   */
  router.get('/:id/response-times', async (req: Request, res: Response) => {
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
      const period = (req.query['period'] as TimePeriod) || TimePeriod.LAST_24_HOURS;
      const location = req.query['location'] as ProbeLocation | undefined;

      // Calculate time range based on period
      const endTime = new Date();
      let startTime: Date;
      
      switch (period) {
        case TimePeriod.LAST_24_HOURS:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_7_DAYS:
          startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_30_DAYS:
          startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      // Try to get from cache
      const cacheKey = `response-times:${id}:${period}:${location || 'all'}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        logger.debug('Response time metrics cache hit', { tenantId, monitorId: id });
        res.status(200).json(cached);
        return;
      }

      // Fetch from InfluxDB
      const stats = await checkResultRepo.getResponseTimeStats(id, startTime, endTime, location);

      const response = {
        monitorId: id,
        period,
        location: location || 'all',
        statistics: stats,
        startTime,
        endTime,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, METRICS_CACHE_TTL);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get response time metrics', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve response time metrics',
      });
    }
  });

  /**
   * GET /api/monitors/:id/latest-check
   * Get the latest check result for a monitor
   */
  router.get('/:id/latest-check', async (req: Request, res: Response) => {
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

      const location = req.query['location'] as ProbeLocation | undefined;

      // Try to get from cache
      const cacheKey = `latest-check:${id}:${location || 'all'}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      // Fetch from InfluxDB
      const latestCheck = await checkResultRepo.findLatestByMonitor(id, location);

      if (!latestCheck) {
        res.status(404).json({
          error: 'Not found',
          message: 'No check results found for this monitor',
        });
        return;
      }

      const response = {
        monitorId: id,
        location: location || 'all',
        latestCheck,
      };

      // Cache for shorter duration (10 seconds)
      await setTenantCache(tenantId, cacheKey, response, 10);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get latest check', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve latest check',
      });
    }
  });

  /**
   * GET /api/monitors/:id/daily-status
   * Get daily status summary for a monitor
   */
  router.get('/:id/daily-status', async (req: Request, res: Response) => {
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

      const days = Math.min(Math.max(parseInt(req.query['days'] as string) || 7, 1), 30);
      const offsetDays = Math.max(parseInt(req.query['offsetDays'] as string) || 0, 0);
      const now = Date.now();
      const endTime = new Date(now - offsetDays * 24 * 60 * 60 * 1000);
      const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

      const cacheKey = `daily-status:${id}:${days}:${offsetDays}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      const daily = await checkResultRepo.getDailyStatus(id, startTime, endTime);

      const response = {
        monitorId: id,
        days,
        offsetDays,
        startTime,
        endTime,
        daily,
      };

      await setTenantCache(tenantId, cacheKey, response, METRICS_CACHE_TTL);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get daily status', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve daily status',
      });
    }
  });

  /**
   * GET /api/monitors/:id/metrics/summary
   * Get comprehensive metrics summary for a monitor
   */
  router.get('/:id/metrics/summary', async (req: Request, res: Response) => {
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

      const period = (req.query['period'] as TimePeriod) || TimePeriod.LAST_24_HOURS;

      // Try to get from cache
      const cacheKey = `metrics-summary:${id}:${period}`;
      const cached = await getTenantCache(tenantId, cacheKey);
      
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      // Calculate time range
      const endTime = new Date();
      let startTime: Date;
      
      switch (period) {
        case TimePeriod.LAST_24_HOURS:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_7_DAYS:
          startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case TimePeriod.LAST_30_DAYS:
          startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      // Fetch all metrics in parallel
      const [uptimeStats, responseTimeStats, latestCheck] = await Promise.all([
        checkResultRepo.getUptimeStats(id, startTime, endTime),
        checkResultRepo.getResponseTimeStats(id, startTime, endTime),
        checkResultRepo.findLatestByMonitor(id),
      ]);

      const response = {
        monitorId: id,
        period,
        uptime: uptimeStats,
        responseTime: responseTimeStats,
        latestCheck,
        startTime,
        endTime,
      };

      // Cache the result
      await setTenantCache(tenantId, cacheKey, response, METRICS_CACHE_TTL);

      res.status(200).json(response);
      return;
    } catch (error) {
      logger.error('Failed to get metrics summary', { error, monitorId: req.params['id'] });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve metrics summary',
      });
    }
  });

  return router;
}
