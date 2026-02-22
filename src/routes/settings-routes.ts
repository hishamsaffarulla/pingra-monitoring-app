/**
 * Settings Routes
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth-middleware';
import { enforceTenantIsolation } from '../middleware/tenant-isolation-middleware';
import { SettingsRepository, UserRepository } from '../database/repositories';
import { logger } from '../utils/logger';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from '../utils/totp';
import { mergeAndStoreSmtpConfig, resolveSmtpConfig, toPublicSmtpConfig } from '../utils/smtp-config';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';

export function createSettingsRouter(dbPool: Pool): Router {
  const router = Router();
  const settingsRepo = new SettingsRepository(dbPool);
  const userRepo = new UserRepository(dbPool);

  router.use(authenticate);
  router.use(enforceTenantIsolation);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const settings = await settingsRepo.getSettings(req.user!.tenantId);
      res.status(200).json(settings);
    } catch (error) {
      logger.error('Failed to load settings', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to load settings' });
    }
  });

  router.put('/', async (req: Request, res: Response) => {
    try {
      const incoming = req.body.config || {};
      const current = await settingsRepo.getSettings(req.user!.tenantId);
      const config = { ...(current.config || {}), ...incoming };
      const settings = await settingsRepo.upsertSettings(req.user!.tenantId, config);
      res.status(200).json(settings);
    } catch (error) {
      logger.error('Failed to update settings', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to update settings' });
    }
  });

  router.get('/api-keys', async (req: Request, res: Response) => {
    try {
      const keys = await settingsRepo.listApiKeys(req.user!.tenantId);
      res.status(200).json(keys);
    } catch (error) {
      logger.error('Failed to list api keys', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to retrieve api keys' });
    }
  });

  router.get('/smtp', async (req: Request, res: Response) => {
    try {
      const settings = await settingsRepo.getSettings(req.user!.tenantId);
      const smtp = toPublicSmtpConfig(settings.config || {});
      res.status(200).json(smtp);
    } catch (error) {
      logger.error('Failed to load SMTP settings', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to load SMTP settings' });
    }
  });

  router.put('/smtp', async (req: Request, res: Response) => {
    try {
      const host = String(req.body.host || '').trim();
      const username = String(req.body.username || '').trim();
      const from = String(req.body.from || '').trim();
      const secure = !!req.body.secure;
      const port = Number(req.body.port || 587);
      const password = String(req.body.password || '');

      if (!host || !username || !from || !Number.isFinite(port) || port <= 0) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Host, port, username, and from email are required',
        });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(from)) {
        res.status(400).json({ error: 'Validation error', message: 'Invalid from email address' });
        return;
      }

      const current = await settingsRepo.getSettings(req.user!.tenantId);
      const mergedConfig = mergeAndStoreSmtpConfig(current.config || {}, {
        host,
        port,
        secure,
        username,
        from,
        password,
      });

      const updated = await settingsRepo.upsertSettings(req.user!.tenantId, mergedConfig);
      res.status(200).json(toPublicSmtpConfig(updated.config || {}));
    } catch (error) {
      logger.error('Failed to save SMTP settings', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to save SMTP settings' });
    }
  });

  router.post('/smtp/test', async (req: Request, res: Response) => {
    try {
      const settings = await settingsRepo.getSettings(req.user!.tenantId);
      const resolved = resolveSmtpConfig(settings.config || {});
      if (!resolved) {
        res.status(400).json({
          error: 'Validation error',
          message: 'SMTP is not fully configured. Set host, port, username, password, and from email.',
        });
        return;
      }

      const user = await userRepo.findById(req.user!.userId);
      const to = String(req.body.to || '').trim() || String(user?.email || '');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!to || !emailRegex.test(to)) {
        res.status(400).json({ error: 'Validation error', message: 'A valid recipient email is required' });
        return;
      }

      const transporter = nodemailer.createTransport({
        host: resolved.host,
        port: resolved.port,
        secure: resolved.secure,
        auth: {
          user: resolved.username,
          pass: resolved.password,
        },
      });

      await transporter.sendMail({
        from: resolved.from,
        to,
        subject: 'Pingra SMTP Test',
        text: `SMTP test successful for tenant ${req.user!.tenantId} at ${new Date().toISOString()}`,
      });

      res.status(200).json({ success: true, message: `SMTP test email sent to ${to}` });
    } catch (error) {
      logger.error('SMTP test failed', { error });
      res.status(500).json({ error: 'Internal server error', message: 'SMTP test failed' });
    }
  });

  router.post('/api-keys', async (req: Request, res: Response) => {
    try {
      const name = req.body.name || 'API Key';
      const raw = `${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
      const masked = `${raw.slice(0, 4)}...${raw.slice(-4)}`;
      const key = await settingsRepo.createApiKey(req.user!.tenantId, name, masked);
      res.status(201).json({
        ...key,
        rawKey: raw,
      });
    } catch (error) {
      logger.error('Failed to create api key', { error });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create api key' });
    }
  });

  router.delete('/api-keys/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await settingsRepo.revokeApiKey(req.params['id'] as string, req.user!.tenantId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'API key not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to revoke api key', { error, keyId: req.params['id'] });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to revoke api key' });
    }
  });

  router.get('/mfa/status', async (req: Request, res: Response) => {
    try {
      const user = await userRepo.findById(req.user!.userId);
      if (!user || user.tenantId !== req.user!.tenantId) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }
      res.status(200).json({
        enabled: !!user.mfaEnabled,
        hasSecret: !!user.mfaSecret,
      });
    } catch (error) {
      logger.error('Failed to get MFA status', { error, userId: req.user!.userId });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to get MFA status' });
    }
  });

  router.post('/mfa/setup', async (req: Request, res: Response) => {
    try {
      const user = await userRepo.findById(req.user!.userId);
      if (!user || user.tenantId !== req.user!.tenantId) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }

      const secret = generateTotpSecret();
      const accountName = user.email;
      const otpauthUrl = buildOtpAuthUrl('Pingra', accountName, secret);
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        width: 220,
        margin: 1,
      });

      await userRepo.update(user.id, user.tenantId, {
        mfaSecret: secret,
        mfaEnabled: false,
      });

      res.status(200).json({
        secret,
        otpauthUrl,
        qrDataUrl,
      });
    } catch (error) {
      logger.error('Failed to setup MFA', { error, userId: req.user!.userId });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to setup MFA' });
    }
  });

  router.post('/mfa/enable', async (req: Request, res: Response) => {
    try {
      const code = String(req.body.code || '').trim();
      if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ error: 'Validation error', message: 'A valid 6-digit code is required' });
        return;
      }

      const user = await userRepo.findById(req.user!.userId);
      if (!user || user.tenantId !== req.user!.tenantId) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }
      if (!user.mfaSecret) {
        res.status(400).json({ error: 'Validation error', message: 'Run MFA setup first' });
        return;
      }
      if (!verifyTotp(user.mfaSecret, code)) {
        res.status(400).json({ error: 'Validation error', message: 'Invalid verification code' });
        return;
      }

      await userRepo.update(user.id, user.tenantId, { mfaEnabled: true });
      res.status(200).json({ enabled: true });
    } catch (error) {
      logger.error('Failed to enable MFA', { error, userId: req.user!.userId });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to enable MFA' });
    }
  });

  router.post('/mfa/disable', async (req: Request, res: Response) => {
    try {
      const code = String(req.body.code || '').trim();
      if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ error: 'Validation error', message: 'A valid 6-digit code is required' });
        return;
      }

      const user = await userRepo.findById(req.user!.userId);
      if (!user || user.tenantId !== req.user!.tenantId) {
        res.status(404).json({ error: 'Not found', message: 'User not found' });
        return;
      }
      if (!user.mfaEnabled || !user.mfaSecret) {
        res.status(400).json({ error: 'Validation error', message: 'MFA is not enabled' });
        return;
      }
      if (!verifyTotp(user.mfaSecret, code)) {
        res.status(400).json({ error: 'Validation error', message: 'Invalid verification code' });
        return;
      }

      await userRepo.update(user.id, user.tenantId, {
        mfaEnabled: false,
        mfaSecret: null,
      });

      res.status(200).json({ enabled: false });
    } catch (error) {
      logger.error('Failed to disable MFA', { error, userId: req.user!.userId });
      res.status(500).json({ error: 'Internal server error', message: 'Failed to disable MFA' });
    }
  });

  return router;
}
