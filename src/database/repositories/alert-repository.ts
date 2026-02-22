/**
 * Alert Repository
 * Handles CRUD operations for alerts in PostgreSQL
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';
import { Alert, AlertType } from '../../types/index';
import { logger } from '../../utils/logger';

export interface AlertFilters {
  monitorId?: string;
  type?: AlertType;
  triggeredAfter?: Date;
  triggeredBefore?: Date;
  resolved?: boolean;
}

export interface AlertListOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'triggered_at' | 'resolved_at' | 'consecutive_failures';
  direction?: 'ASC' | 'DESC';
}

export class AlertRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  /**
   * Create a new alert
   */
  async create(alert: Omit<Alert, 'id'>): Promise<Alert> {
    this.validateRequiredFields(alert, ['monitorId', 'type', 'triggeredAt', 'consecutiveFailures', 'message']);

    const id = this.generateId();

    const query = `
      INSERT INTO alerts (
        id, monitor_id, alert_type, triggered_at, resolved_at,
        consecutive_failures, message, notification_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const params = [
      id,
      alert.monitorId,
      alert.type,
      alert.triggeredAt,
      alert.resolvedAt || null,
      alert.consecutiveFailures,
      alert.message,
      JSON.stringify(alert.notificationStatus || {}),
      new Date(),
    ];

    try {
      const rows = await this.executeQuery(query, params);
      const createdAlert = this.mapRowToEntity(rows[0]);
      
      logger.info('Alert created:', { 
        id, 
        monitorId: alert.monitorId, 
        type: alert.type,
        consecutiveFailures: alert.consecutiveFailures 
      });
      
      return createdAlert;
    } catch (error) {
      logger.error('Failed to create alert:', { error, monitorId: alert.monitorId, type: alert.type });
      throw error;
    }
  }

  /**
   * Find alert by ID
   */
  async findById(id: string): Promise<Alert | null> {
    const query = 'SELECT * FROM alerts WHERE id = $1';

    try {
      const row = await this.executeQuerySingle(query, [id]);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find alert by ID:', { error, id });
      throw error;
    }
  }

  /**
   * Find alerts with filters and pagination
   */
  async findMany(
    filters: AlertFilters = {},
    options: AlertListOptions = {}
  ): Promise<{ alerts: Alert[]; total: number }> {
    try {
      // Build WHERE clause
      const dbFilters: any = {};
      if (filters.monitorId) dbFilters.monitor_id = filters.monitorId;
      if (filters.type) dbFilters.alert_type = filters.type;

      const { clause: whereClause, params: whereParams, nextIndex } = this.buildWhereClause(dbFilters);

      // Add date range filters
      let additionalWhere = '';
      const additionalParams: any[] = [];
      let paramIndex = nextIndex;

      if (filters.triggeredAfter) {
        additionalWhere += (whereClause ? ' AND ' : 'WHERE ') + `triggered_at >= $${paramIndex++}`;
        additionalParams.push(filters.triggeredAfter);
      }

      if (filters.triggeredBefore) {
        additionalWhere += (whereClause || additionalWhere ? ' AND ' : 'WHERE ') + `triggered_at <= $${paramIndex++}`;
        additionalParams.push(filters.triggeredBefore);
      }

      if (filters.resolved !== undefined) {
        const resolvedCondition = filters.resolved ? 'resolved_at IS NOT NULL' : 'resolved_at IS NULL';
        additionalWhere += (whereClause || additionalWhere ? ' AND ' : 'WHERE ') + resolvedCondition;
      }

      const finalWhereClause = whereClause + additionalWhere;
      const allWhereParams = [...whereParams, ...additionalParams];

      // Build ORDER BY clause
      const orderByClause = this.buildOrderByClause(
        options.orderBy || 'triggered_at',
        options.direction || 'DESC'
      );

      // Build LIMIT/OFFSET clause
      const { clause: limitClause, params: limitParams } = this.buildLimitClause(
        options.limit,
        options.offset,
        whereParams.length + 1
      );

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM alerts ${finalWhereClause}`;
      const countResult = await this.executeQuerySingle<{ total: string }>(countQuery, allWhereParams);
      const total = parseInt(countResult?.total || '0', 10);

      // Get alerts
      const query = `
        SELECT * FROM alerts 
        ${finalWhereClause} 
        ${orderByClause} 
        ${limitClause}
      `;
      const allParams = [...allWhereParams, ...limitParams];
      const rows = await this.executeQuery(query, allParams);

      const alerts = rows.map(row => this.mapRowToEntity(row));

      return { alerts, total };
    } catch (error) {
      logger.error('Failed to find alerts:', { error, filters });
      throw error;
    }
  }

  /**
   * Find alerts by monitor
   */
  async findByMonitor(
    monitorId: string,
    options: AlertListOptions = {}
  ): Promise<Alert[]> {
    const { alerts } = await this.findMany({ monitorId }, options);
    return alerts;
  }

  /**
   * Find active (unresolved) alerts
   */
  async findActive(monitorId?: string): Promise<Alert[]> {
    const filters: AlertFilters = { resolved: false };
    if (monitorId) {
      filters.monitorId = monitorId;
    }

    const { alerts } = await this.findMany(filters);
    return alerts;
  }

  /**
   * Find latest alert for a monitor
   */
  async findLatestByMonitor(monitorId: string, type?: AlertType): Promise<Alert | null> {
    const filters: AlertFilters = { monitorId };
    if (type) {
      filters.type = type;
    }

    const { alerts } = await this.findMany(filters, { limit: 1, direction: 'DESC' });
    return alerts.length > 0 ? alerts[0]! : null;
  }

  /**
   * Update alert (typically to resolve it)
   */
  async update(id: string, updates: Partial<Alert>): Promise<Alert | null> {
    const allowedUpdates = ['resolved_at', 'notification_status'];

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build SET clause
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedUpdates.includes(dbKey) && value !== undefined) {
        if (dbKey === 'notification_status') {
          updateFields.push(`${dbKey} = $${paramIndex++}`);
          params.push(JSON.stringify(value));
        } else {
          updateFields.push(`${dbKey} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Add WHERE condition
    params.push(id);
    const whereClause = `WHERE id = $${paramIndex++}`;

    const query = `
      UPDATE alerts 
      SET ${updateFields.join(', ')} 
      ${whereClause}
      RETURNING *
    `;

    try {
      const row = await this.executeQuerySingle(query, params);
      if (row) {
        logger.info('Alert updated:', { id, updates: Object.keys(updates) });
        return this.mapRowToEntity(row);
      }
      return null;
    } catch (error) {
      logger.error('Failed to update alert:', { error, id, updates });
      throw error;
    }
  }

  /**
   * Resolve alert
   */
  async resolve(id: string, resolvedAt: Date = new Date()): Promise<Alert | null> {
    return this.update(id, { resolvedAt });
  }

  /**
   * Resolve all active alerts for a monitor
   */
  async resolveAllForMonitor(monitorId: string, resolvedAt: Date = new Date()): Promise<number> {
    const query = `
      UPDATE alerts 
      SET resolved_at = $1 
      WHERE monitor_id = $2 AND resolved_at IS NULL
    `;

    try {
      const result = await this.pool.query(query, [resolvedAt, monitorId]);
      const resolvedCount = result.rowCount || 0;
      
      if (resolvedCount > 0) {
        logger.info('Resolved alerts for monitor:', { monitorId, count: resolvedCount });
      }
      
      return resolvedCount;
    } catch (error) {
      logger.error('Failed to resolve alerts for monitor:', { error, monitorId });
      throw error;
    }
  }

  /**
   * Delete alert
   */
  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM alerts WHERE id = $1';

    try {
      const result = await this.pool.query(query, [id]);
      const deleted = (result.rowCount || 0) > 0;
      
      if (deleted) {
        logger.info('Alert deleted:', { id });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Failed to delete alert:', { error, id });
      throw error;
    }
  }

  /**
   * Get alert statistics
   */
  async getStats(monitorId?: string, startDate?: Date, endDate?: Date): Promise<{
    total: number;
    byType: Record<string, number>;
    resolved: number;
    unresolved: number;
    averageResolutionTime: number; // in minutes
  }> {
    try {
      const filters: any = {};
      if (monitorId) filters.monitor_id = monitorId;

      const { clause: whereClause, params: whereParams, nextIndex } = this.buildWhereClause(filters);

      // Add date range filters
      let additionalWhere = '';
      const additionalParams: any[] = [];
      let paramIndex = nextIndex;

      if (startDate) {
        additionalWhere += (whereClause ? ' AND ' : 'WHERE ') + `triggered_at >= $${paramIndex++}`;
        additionalParams.push(startDate);
      }

      if (endDate) {
        additionalWhere += (whereClause || additionalWhere ? ' AND ' : 'WHERE ') + `triggered_at <= $${paramIndex++}`;
        additionalParams.push(endDate);
      }

      const finalWhereClause = whereClause + additionalWhere;
      const allParams = [...whereParams, ...additionalParams];

      // Get total count
      const totalQuery = `SELECT COUNT(*) as total FROM alerts ${finalWhereClause}`;
      const totalResult = await this.executeQuerySingle<{ total: string }>(totalQuery, allParams);
      const total = parseInt(totalResult?.total || '0', 10);

      // Get count by type
      const typeQuery = `
        SELECT alert_type, COUNT(*) as count 
        FROM alerts ${finalWhereClause}
        GROUP BY alert_type
      `;
      const typeRows = await this.executeQuery<{ alert_type: string; count: string }>(typeQuery, allParams);
      const byType: Record<string, number> = {};
      typeRows.forEach(row => {
        byType[row.alert_type] = parseInt(row.count, 10);
      });

      // Get resolved/unresolved counts
      const resolvedQuery = `
        SELECT 
          COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved,
          COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as unresolved
        FROM alerts ${finalWhereClause}
      `;
      const resolvedResult = await this.executeQuerySingle<{ resolved: string; unresolved: string }>(
        resolvedQuery, 
        allParams
      );
      const resolved = parseInt(resolvedResult?.resolved || '0', 10);
      const unresolved = parseInt(resolvedResult?.unresolved || '0', 10);

      // Get average resolution time
      const resolutionQuery = `
        SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - triggered_at))/60) as avg_resolution_minutes
        FROM alerts 
        ${finalWhereClause} AND resolved_at IS NOT NULL
      `;
      const resolutionResult = await this.executeQuerySingle<{ avg_resolution_minutes: number }>(
        resolutionQuery, 
        allParams
      );
      const averageResolutionTime = Math.round(resolutionResult?.avg_resolution_minutes || 0);

      return {
        total,
        byType,
        resolved,
        unresolved,
        averageResolutionTime,
      };
    } catch (error) {
      logger.error('Failed to get alert stats:', { error, monitorId });
      throw error;
    }
  }

  /**
   * Clean up old resolved alerts
   */
  async cleanupOldAlerts(olderThan: Date): Promise<number> {
    const query = `
      DELETE FROM alerts 
      WHERE resolved_at IS NOT NULL AND resolved_at < $1
    `;

    try {
      const result = await this.pool.query(query, [olderThan]);
      const deletedCount = result.rowCount || 0;
      
      if (deletedCount > 0) {
        logger.info('Cleaned up old alerts:', { count: deletedCount, olderThan });
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old alerts:', { error, olderThan });
      throw error;
    }
  }

  /**
   * Map database row to Alert entity
   */
  protected mapRowToEntity(row: any): Alert {
    const notificationStatus =
      typeof row.notification_status === 'string'
        ? JSON.parse(row.notification_status)
        : (row.notification_status || {});

    return {
      id: row.id,
      monitorId: row.monitor_id,
      type: row.alert_type as AlertType,
      triggeredAt: row.triggered_at,
      resolvedAt: row.resolved_at || undefined,
      consecutiveFailures: row.consecutive_failures,
      message: row.message || '',
      notificationStatus,
    };
  }

  /**
   * Map Alert entity to database row
   */
  protected mapEntityToRow(alert: Alert): any {
    return {
      id: alert.id,
      monitor_id: alert.monitorId,
      alert_type: alert.type,
      triggered_at: alert.triggeredAt,
      resolved_at: alert.resolvedAt,
      consecutive_failures: alert.consecutiveFailures,
      message: alert.message,
      notification_status: JSON.stringify(alert.notificationStatus),
    };
  }
}
