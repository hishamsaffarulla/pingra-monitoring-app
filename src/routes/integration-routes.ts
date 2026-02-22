/**
 * Integration Management Routes
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { IntegrationRepository } from '../database/repositories';
import { logger } from '../utils/logger';

export function createIntegrationRouter(dbPool: Pool): Router {
  const router = Router();
  const integrationRepo = new IntegrationRepository(dbPool);

  router.use(authenticate);
  router.use(enforceTenantIsolation);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const integrations = await integrationRepo.findMany(tenantId);
      res.status(200).json(integrations);
    } catch (error) {
      logger.error('Failed to list integrations', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve integrations' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const payload = req.body;
      const type = String(payload.type || '').trim().toLowerCase();
      const name = String(payload.name || '').trim();
      let endpoint = String(payload.endpoint || '').trim();

      if (type === 'email' && !endpoint) {
        endpoint = 'contact-list-routing';
      }
      if (type === 'call' && !endpoint) {
        endpoint = 'voice-routing';
      }
      if (type === 'twilio' && !endpoint) {
        endpoint = 'sms-routing';
      }

      if (!type || !name || !endpoint) {
        res.status(400).json({ error: 'Validation error', message: 'Type, name, and endpoint are required' });
        return;
      }

      const integration = await integrationRepo.create({
        tenantId,
        type,
        name,
        endpoint,
        configuration: payload.configuration || {},
        enabled: payload.enabled ?? true,
      });

      res.status(201).json(integration);
    } catch (error) {
      const pgCode = (error as any)?.code;
      if (pgCode === '23505') {
        res.status(409).json({ error: 'Conflict', message: 'Integration name already exists. Use a different name.' });
        return;
      }
      logger.error('Failed to create integration', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create integration' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const integration = await integrationRepo.update(req.params['id'] as string, tenantId, {
        type: req.body.type,
        name: req.body.name,
        endpoint: req.body.endpoint,
        configuration: req.body.configuration,
        enabled: req.body.enabled,
      });

      if (!integration) {
        res.status(404).json({ error: 'Not found', message: 'Integration not found' });
        return;
      }

      res.status(200).json(integration);
    } catch (error) {
      logger.error('Failed to update integration', { error, integrationId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to update integration' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const deleted = await integrationRepo.delete(req.params['id'] as string, tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'Integration not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete integration', { error, integrationId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete integration' });
    }
  });

  return router;
}
