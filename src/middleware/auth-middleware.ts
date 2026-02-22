/**
 * Authentication Middleware
 * Protects API endpoints with JWT authentication
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, isTokenBlacklisted } from '../services/auth-service';
import { JWTPayload } from '../types';
import { logger } from '../utils/logger';

// Extend Express Request to include authenticated user info
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Extract JWT token from Authorization header
 */
function extractToken(req: Request): string | null | undefined {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  // Expected format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from header
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No token provided',
      });
      return;
    }

    // Check if token is blacklisted
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Token has been revoked',
      });
      return;
    }

    // Verify and decode token
    const decoded = verifyToken(token);

    // Attach user info to request
    req.user = decoded;

    logger.debug('Request authenticated', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      path: req.path,
    });

    next();
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Token expired') {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Token expired',
        });
        return;
      } else if (error.message === 'Invalid token') {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid token',
        });
        return;
      }
    }

    logger.error('Authentication error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if token is present, but doesn't require it
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    
    if (token) {
      const blacklisted = await isTokenBlacklisted(token);
      if (!blacklisted) {
        const decoded = verifyToken(token);
        req.user = decoded;
      }
    }

    next();
  } catch (error) {
    // Silently fail for optional authentication
    next();
  }
}
