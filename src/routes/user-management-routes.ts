/**
 * User Management Routes
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { AlertGroupRepository, UserRepository } from '../database/repositories';
import { hashPassword } from '../services/auth-service';
import { logger } from '../utils/logger';

export function createUserManagementRouter(dbPool: Pool): Router {
  const router = Router();
  const userRepo = new UserRepository(dbPool);
  const alertGroupRepo = new AlertGroupRepository(dbPool);

  const sanitizeUser = (user: any) => {
    if (!user) return user;
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  };

  router.use(authenticate);
  router.use(enforceTenantIsolation);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const users = await userRepo.findManyByTenant(req.user!.tenantId);
      res.status(200).json(users.map(user => sanitizeUser(user)));
    } catch (error) {
      logger.error('Failed to list users', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve users' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      if (!payload.email || !payload.name) {
        res.status(400).json({ error: 'Validation error', message: 'Name and email are required' });
        return;
      }

      const existing = await userRepo.findByEmail(payload.email);
      if (existing) {
        res.status(409).json({ error: 'Conflict', message: 'User with this email already exists' });
        return;
      }

      const tempPassword = Math.random().toString(36).slice(2, 12);
      const passwordHash = await hashPassword(tempPassword);
      const user = await userRepo.create({
        tenantId: req.user!.tenantId,
        email: payload.email,
        passwordHash,
        name: payload.name,
        role: payload.role || 'member',
        phone: payload.phone,
        alertPreferences: payload.alertPreferences || [],
        status: payload.status || 'active',
      });

      res.status(201).json(sanitizeUser(user));
    } catch (error) {
      logger.error('Failed to create user', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create user' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const user = await userRepo.update(req.params['id'] as string, req.user!.tenantId, {
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        phone: req.body.phone,
        alertPreferences: req.body.alertPreferences,
        status: req.body.status,
      });

      if (!user) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }

      res.status(200).json(sanitizeUser(user));
    } catch (error) {
      logger.error('Failed to update user', { error, userId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to update user' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await userRepo.delete(req.params['id'] as string, req.user!.tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete user', { error, userId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete user' });
    }
  });

  router.get('/groups', async (req: Request, res: Response) => {
    try {
      const groups = await alertGroupRepo.findMany(req.user!.tenantId);
      res.status(200).json(groups);
    } catch (error) {
      logger.error('Failed to list groups', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve groups' });
    }
  });

  router.post('/groups', async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      if (!payload.name) {
        res.status(400).json({ error: 'Validation error', message: 'Group name is required' });
        return;
      }

      const group = await alertGroupRepo.create(
        req.user!.tenantId,
        payload.name,
        payload.description || null,
        payload.members || []
      );
      res.status(201).json(group);
    } catch (error) {
      logger.error('Failed to create group', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create group' });
    }
  });

  router.delete('/groups/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await alertGroupRepo.delete(req.params['id'] as string, req.user!.tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'Group not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete group', { error, groupId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete group' });
    }
  });

  return router;
}
