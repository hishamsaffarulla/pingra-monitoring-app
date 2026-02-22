/**
 * Tenant Isolation Middleware
 * Ensures data access is restricted to the authenticated user's tenant
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Tenant isolation middleware
 * Validates that requested resources belong to the authenticated user's tenant
 */
export function enforceTenantIsolation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated to access this resource',
      });
      return;
    }

    // Extract tenant ID from authenticated user
    const userTenantId = req.user.tenantId;

    // Check if tenant ID is provided in request (query, params, or body)
    const requestTenantId =
      req.query['tenantId'] ||
      req.params['tenantId'] ||
      req.body?.tenantId;

    // If tenant ID is specified in request, validate it matches user's tenant
    if (requestTenantId && requestTenantId !== userTenantId) {
      logger.warn('Tenant isolation violation attempt', {
        userId: req.user.userId,
        userTenantId,
        requestTenantId,
        path: req.path,
      });

      res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access resources from another tenant',
      });
      return;
    }

    // Attach tenant ID to request for downstream use
    req.body = req.body || {};
    req.body.tenantId = userTenantId;

    logger.debug('Tenant isolation enforced', {
      userId: req.user.userId,
      tenantId: userTenantId,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Tenant isolation middleware error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to enforce tenant isolation',
    });
  }
}

/**
 * Validate tenant ownership of a resource
 * Use this in route handlers to verify resource belongs to user's tenant
 */
export function validateTenantOwnership(
  resourceTenantId: string,
  userTenantId: string
): boolean {
  return resourceTenantId === userTenantId;
}

/**
 * Filter results by tenant
 * Helper function to filter query results to only include user's tenant data
 */
export function filterByTenant<T extends { tenantId: string }>(
  items: T[],
  tenantId: string
): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}
