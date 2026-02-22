/**
 * Incident Management Routes
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { IncidentRepository } from '../database/repositories';
import type { IncidentFilters, IncidentRecord } from '../database/repositories/incident-repository';
import { logger } from '../utils/logger';

export function createIncidentRouter(dbPool: Pool): Router {
  const router = Router();
  const incidentRepo = new IncidentRepository(dbPool);

  router.use(authenticate);
  router.use(enforceTenantIsolation);

  /**
   * GET /api/incidents
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const status = req.query['status'] as string | undefined;
      const severity = req.query['severity'] as string | undefined;
      const search = req.query['search'] as string | undefined;

      const filters: IncidentFilters = { tenantId };
      if (status !== undefined) filters.status = status;
      if (severity !== undefined) filters.severity = severity;
      if (search !== undefined) filters.search = search;

      const incidents = await incidentRepo.findMany(filters);
      res.status(200).json(incidents);
    } catch (error) {
      logger.error('Failed to list incidents', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incidents',
      });
    }
  });

  /**
   * GET /api/incidents/:id
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const incident = await incidentRepo.findById(req.params['id'] as string, req.user!.tenantId);
      if (!incident) {
        res.status(404).json({ error: 'Not found', message: 'Incident not found' });
        return;
      }
      const updates = await incidentRepo.findUpdates(incident.id);
      res.status(200).json({ ...incident, updates });
    } catch (error) {
      logger.error('Failed to get incident', { error, incidentId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve incident' });
    }
  });

  /**
   * POST /api/incidents
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const payload = req.body;

      if (!payload.title || !payload.severity) {
        res.status(400).json({ error: 'Validation error', message: 'Title and severity are required' });
        return;
      }

      const incident = await incidentRepo.create({
        tenantId,
        title: payload.title,
        description: payload.description || null,
        monitorId: payload.monitorId || null,
        severity: payload.severity,
        status: payload.status || 'investigating',
        assigneeUserId: payload.assigneeUserId || null,
        resolvedAt: null,
      });

      await incidentRepo.addUpdate(incident.id, incident.status, 'Incident created');

      res.status(201).json(incident);
    } catch (error) {
      logger.error('Failed to create incident', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create incident' });
    }
  });

  /**
   * PUT /api/incidents/:id
   */
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const updates: Partial<IncidentRecord> = {
        title: req.body.title,
        description: req.body.description,
        monitorId: req.body.monitorId,
        severity: req.body.severity,
        status: req.body.status,
        assigneeUserId: req.body.assigneeUserId,
      };
      if (req.body.resolvedAt) {
        updates.resolvedAt = new Date(req.body.resolvedAt);
      }

      const incident = await incidentRepo.update(req.params['id'] as string, tenantId, updates);

      if (!incident) {
        res.status(404).json({ error: 'Not found', message: 'Incident not found' });
        return;
      }

      res.status(200).json(incident);
    } catch (error) {
      logger.error('Failed to update incident', { error, incidentId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to update incident' });
    }
  });

  /**
   * POST /api/incidents/:id/updates
   */
  router.post('/:id/updates', async (req: Request, res: Response) => {
    try {
      const incidentId = req.params['id'] as string;
      const incident = await incidentRepo.findById(incidentId, req.user!.tenantId);
      if (!incident) {
        res.status(404).json({ error: 'Not found', message: 'Incident not found' });
        return;
      }

      const status = req.body.status || incident.status;
      const message = req.body.message;
      if (!message) {
        res.status(400).json({ error: 'Validation error', message: 'Message is required' });
        return;
      }

      const update = await incidentRepo.addUpdate(incidentId, status, message);
      const updatePayload: Partial<IncidentRecord> = { status };
      if (status === 'resolved') {
        updatePayload.resolvedAt = new Date();
      }
      await incidentRepo.update(incidentId, req.user!.tenantId, updatePayload);

      res.status(201).json(update);
    } catch (error) {
      logger.error('Failed to add incident update', { error, incidentId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to add update' });
    }
  });

  /**
   * POST /api/incidents/:id/close
   */
  router.post('/:id/close', async (req: Request, res: Response) => {
    try {
      const incidentId = req.params['id'] as string;
      const incident = await incidentRepo.update(incidentId, req.user!.tenantId, {
        status: 'resolved',
        resolvedAt: new Date(),
      });
      if (!incident) {
        res.status(404).json({ error: 'Not found', message: 'Incident not found' });
        return;
      }
      await incidentRepo.addUpdate(incidentId, 'resolved', 'Incident closed');
      res.status(200).json(incident);
    } catch (error) {
      logger.error('Failed to close incident', { error, incidentId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to close incident' });
    }
  });

  return router;
}
