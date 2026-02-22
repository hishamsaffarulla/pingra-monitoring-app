/**
 * Authentication Routes
 * Handles login, logout, and token refresh endpoints
 */

import { Router, Request, Response } from 'express';
import { login, logout, refreshAccessToken, hashPassword } from '../services/auth-service';
import { authenticate } from '../middleware/auth-middleware';
import { LoginRequest } from '../types';
import { TenantRepository, UserRepository } from '../database/repositories';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

export function createAuthRouter(dbPool: Pool): Router {
  const router = Router();
  const tenantRepo = new TenantRepository(dbPool);
  const userRepo = new UserRepository(dbPool);

  /**
   * POST /api/auth/signup
   * Register a new user and tenant
   */
  router.post('/signup', async (req: Request, res: Response) => {
    try {
      const { email, password, name, tenantName } = req.body;

      // Validate request body
      if (!email || !password || !tenantName) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Email, password, and tenant name are required',
        });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid email format',
        });
        return;
      }

      // Validate password strength
      if (password.length < 8) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Password must be at least 8 characters long',
        });
        return;
      }

      // Check if user already exists
      const existingUser = await userRepo.findByEmail(email);
      if (existingUser) {
        res.status(409).json({
          error: 'Conflict',
          message: 'User with this email already exists',
        });
        return;
      }

      // Check if tenant name is available
      const existingTenant = await tenantRepo.findByName(tenantName);
      if (existingTenant) {
        res.status(409).json({
          error: 'Conflict',
          message: 'Tenant name already taken',
        });
        return;
      }

      // Create tenant first
      const tenant = await tenantRepo.create({
        name: tenantName,
        encryptedConfig: {},
      });

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      const user = await userRepo.create({
        tenantId: tenant.id,
        email,
        passwordHash,
        name: name || undefined,
        role: 'admin',
      });

      logger.info('User signed up successfully', { userId: user.id, tenantId: tenant.id });

      res.status(201).json({
        message: 'User created successfully',
        user: {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId,
        },
      });
    } catch (error) {
      logger.error('Signup error', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Signup failed',
      });
    }
  });

  /**
   * POST /api/auth/login
   * Authenticate user and return JWT tokens
   */
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const credentials: LoginRequest = req.body;

      // Validate request body
      if (!credentials.email || !credentials.password) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Email and password are required',
        });
        return;
      }

      // Mock user lookup function (replace with actual user repository)
      const getUserByEmail = async (email: string) => {
        return await userRepo.findByEmail(email);
      };

      const getTenantById = async (tenantId: string) => {
        return await tenantRepo.findById(tenantId);
      };

      const result = await login(credentials, getUserByEmail, getTenantById);

      // Ensure the first user in a tenant is promoted to admin
      const loggedInUser = await userRepo.findByEmail(credentials.email);
      if (loggedInUser && loggedInUser.tenantId) {
        if (!loggedInUser.role || loggedInUser.role === 'member') {
          const tenantUsers = await userRepo.findManyByTenant(loggedInUser.tenantId);
          if (tenantUsers.length === 1) {
            await userRepo.update(loggedInUser.id, loggedInUser.tenantId, { role: 'admin' });
          }
        }
      }

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Invalid credentials') {
          res.status(401).json({
            error: 'Authentication failed',
            message: 'Invalid email or password',
          });
          return;
        }
        if (error.message === 'MFA code required') {
          res.status(401).json({
            error: 'Authentication failed',
            message: 'MFA code required',
            requiresMfa: true,
          });
          return;
        }
        if (error.message === 'Invalid MFA code') {
          res.status(401).json({
            error: 'Authentication failed',
            message: 'Invalid MFA code',
            requiresMfa: true,
          });
          return;
        }
        if (error.message === 'MFA not configured') {
          res.status(400).json({
            error: 'Validation error',
            message: 'MFA is enabled but not configured. Disable and reconfigure MFA in Settings.',
          });
          return;
        }
      }

      logger.error('Login error', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Login failed',
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Logout user and invalidate tokens
   */
  router.post('/logout', authenticate, async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const userId = req.user?.userId;

      if (!token || !userId) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Invalid request',
        });
        return;
      }

      await logout(token, userId);

      res.status(200).json({
        message: 'Logged out successfully',
      });
    } catch (error) {
      logger.error('Logout error', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Logout failed',
      });
    }
  });

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Refresh token is required',
        });
        return;
      }

      const result = await refreshAccessToken(refreshToken);

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Invalid refresh token' || error.message === 'Token expired') {
          res.status(401).json({
            error: 'Authentication failed',
            message: error.message,
          });
          return;
        }
      }

      logger.error('Token refresh error', { error });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Token refresh failed',
      });
    }
  });

  return router;
}
