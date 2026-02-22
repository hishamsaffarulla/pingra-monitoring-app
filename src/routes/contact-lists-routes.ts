/**
 * Contact Lists Routes
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { ContactListRepository } from '../database/repositories/contact-list-repository';
import { logger } from '../utils/logger';

export function createContactListRouter(dbPool: Pool): Router {
  const router = Router();
  const repo = new ContactListRepository(dbPool);

  router.use(authenticate);
  router.use(enforceTenantIsolation);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const lists = await repo.findLists(tenantId);
      res.status(200).json(lists);
    } catch (error) {
      logger.error('Failed to list contact lists', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve contact lists' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const payload = req.body;
      if (!payload.name) {
        res.status(400).json({ error: 'Validation error', message: 'Name is required' });
        return;
      }
      const list = await repo.createList({
        tenantId,
        name: payload.name,
        description: payload.description || null,
      });
      res.status(201).json(list);
    } catch (error) {
      logger.error('Failed to create contact list', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create contact list' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const updated = await repo.updateList(req.params['id'] as string, tenantId, {
        name: req.body.name,
        description: req.body.description,
      });
      if (!updated) {
        res.status(404).json({ error: 'Not found', message: 'Contact list not found' });
        return;
      }
      res.status(200).json(updated);
    } catch (error) {
      logger.error('Failed to update contact list', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to update contact list' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const deleted = await repo.deleteList(req.params['id'] as string, tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'Contact list not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete contact list', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete contact list' });
    }
  });

  router.get('/:id/members', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const members = await repo.findMembers(req.params['id'] as string, tenantId);
      res.status(200).json(members);
    } catch (error) {
      logger.error('Failed to list contact list members', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve members' });
    }
  });

  router.post('/:id/members', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const listId = req.params['id'] as string;
      const payload = req.body;
      const legacyType = (payload.channelType || '').toString().trim();
      const legacyContact = (payload.contact || '').toString().trim();
      const label = (payload.label || payload.name || '').toString().trim();
      let email = (payload.email || '').toString().trim();
      let phone = (payload.phone || '').toString().trim();

      // Backward compatibility for older clients that still send channelType/contact
      if (!email && !phone && legacyType && legacyContact) {
        if (legacyType === 'email') {
          email = legacyContact;
        } else if (legacyType === 'phone') {
          phone = legacyContact;
        }
      }

      if (!email && !phone) {
        res.status(400).json({ error: 'Validation error', message: 'At least one contact (email or mobile) is required' });
        return;
      }

      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({ error: 'Validation error', message: 'Invalid email format' });
          return;
        }
      }

      if (phone) {
        const phoneRegex = /^[+()\-.\s0-9]{7,20}$/;
        if (!phoneRegex.test(phone)) {
          res.status(400).json({ error: 'Validation error', message: 'Invalid mobile number format' });
          return;
        }
      }

      const effectiveLabel = label || 'Contact';

      const list = await repo.findListById(listId, tenantId);
      if (!list) {
        res.status(404).json({ error: 'Not found', message: 'Contact list not found' });
        return;
      }

      const createdMembers = [];

      if (email) {
        const member = await repo.createMember({
          listId,
          label: effectiveLabel,
          channelType: 'email',
          contact: email,
          enabled: payload.enabled ?? true,
        });
        createdMembers.push(member);
      }

      if (phone) {
        const member = await repo.createMember({
          listId,
          label: effectiveLabel,
          channelType: 'phone',
          contact: phone,
          enabled: payload.enabled ?? true,
        });
        createdMembers.push(member);
      }

      res.status(201).json({ members: createdMembers });
    } catch (error) {
      logger.error('Failed to create contact list member', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create member' });
    }
  });

  router.delete('/:id/members/:memberId', async (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const listId = req.params['id'] as string;
      const memberId = req.params['memberId'] as string;
      const deleted = await repo.deleteMember(memberId, listId, tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'Member not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to delete contact list member', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete member' });
    }
  });

  return router;
}
