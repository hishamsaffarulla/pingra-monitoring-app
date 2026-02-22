/**
 * Monitor Repository
 * Handles CRUD operations for monitors in PostgreSQL
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';
import { Monitor, CheckInterval, ProbeLocation } from '../../types/index';
import { logger } from '../../utils/logger';

export interface MonitorFilters {
  tenantId?: string;
  name?: string;
  url?: string;
  checkInterval?: CheckInterval;
  probeLocations?: ProbeLocation[];
  enabled?: boolean;
}

export interface MonitorListOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'created_at' | 'updated_at';
  direction?: 'ASC' | 'DESC';
}

export class MonitorRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  /**
   * Create a new monitor
   */
  async create(monitor: Omit<Monitor, 'id' | 'createdAt' | 'updatedAt'>): Promise<Monitor> {
    this.validateRequiredFields(monitor, ['tenantId', 'name', 'url', 'checkInterval', 'timeoutSeconds']);

    const id = this.generateId();
    const now = new Date();

    const query = `
      INSERT INTO monitors (
        id, tenant_id, name, url, check_interval, timeout_seconds,
        expected_status_codes, probe_locations, failure_threshold,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const params = [
      id,
      monitor.tenantId,
      monitor.name,
      monitor.url,
      monitor.checkInterval,
      monitor.timeoutSeconds,
      monitor.expectedStatusCodes || [200],
      monitor.probeLocations || [ProbeLocation.US_EAST],
      monitor.failureThreshold || 3,
      now,
      now,
    ];

    try {
      const rows = await this.executeQuery(query, params);
      const createdMonitor = this.mapRowToEntity(rows[0]);
      
      logger.info('Monitor created:', { id, name: monitor.name, tenantId: monitor.tenantId });
      return createdMonitor;
    } catch (error) {
      logger.error('Failed to create monitor:', { error, monitor: monitor.name });
      throw error;
    }
  }

  /**
   * Find monitor by ID
   */
  async findById(id: string, tenantId?: string): Promise<Monitor | null> {
    const filters: any = { id };
    if (tenantId) {
      filters.tenant_id = tenantId;
    }

    const { clause, params } = this.buildWhereClause(filters);
    const query = `SELECT * FROM monitors ${clause}`;

    try {
      const row = await this.executeQuerySingle(query, params);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find monitor by ID:', { error, id });
      throw error;
    }
  }

  /**
   * Find monitors with filters and pagination
   */
  async findMany(
    filters: MonitorFilters = {},
    options: MonitorListOptions = {}
  ): Promise<{ monitors: Monitor[]; total: number }> {
    try {
      // Build WHERE clause
      const dbFilters: any = {};
      if (filters.tenantId) dbFilters.tenant_id = filters.tenantId;
      if (filters.name) dbFilters.name = filters.name;
      if (filters.url) dbFilters.url = filters.url;
      if (filters.checkInterval) dbFilters.check_interval = filters.checkInterval;

      const { clause: whereClause, params: whereParams } = this.buildWhereClause(dbFilters);

      // Build ORDER BY clause
      const orderByClause = this.buildOrderByClause(
        options.orderBy ? options.orderBy.replace(/([A-Z])/g, '_$1').toLowerCase() : 'created_at',
        options.direction || 'DESC'
      );

      // Build LIMIT/OFFSET clause
      const { clause: limitClause, params: limitParams } = this.buildLimitClause(
        options.limit,
        options.offset,
        whereParams.length + 1
      );

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM monitors ${whereClause}`;
      const countResult = await this.executeQuerySingle<{ total: string }>(countQuery, whereParams);
      const total = parseInt(countResult?.total || '0', 10);

      // Get monitors
      const query = `
        SELECT * FROM monitors 
        ${whereClause} 
        ${orderByClause} 
        ${limitClause}
      `;
      const allParams = [...whereParams, ...limitParams];
      const rows = await this.executeQuery(query, allParams);

      const monitors = rows.map(row => this.mapRowToEntity(row));

      return { monitors, total };
    } catch (error) {
      logger.error('Failed to find monitors:', { error, filters });
      throw error;
    }
  }

  /**
   * Update monitor
   */
  async update(id: string, updates: Partial<Monitor>, tenantId?: string): Promise<Monitor | null> {
    const allowedUpdates = [
      'name', 'url', 'check_interval', 'timeout_seconds',
      'expected_status_codes', 'probe_locations', 'failure_threshold'
    ];

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build SET clause
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedUpdates.includes(dbKey) && value !== undefined) {
        updateFields.push(`${dbKey} = $${paramIndex++}`);
        params.push(value);
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Add updated_at
    updateFields.push(`updated_at = $${paramIndex++}`);
    params.push(new Date());

    // Add WHERE conditions
    params.push(id);
    let whereClause = `WHERE id = $${paramIndex++}`;
    
    if (tenantId) {
      params.push(tenantId);
      whereClause += ` AND tenant_id = $${paramIndex++}`;
    }

    const query = `
      UPDATE monitors 
      SET ${updateFields.join(', ')} 
      ${whereClause}
      RETURNING *
    `;

    try {
      const row = await this.executeQuerySingle(query, params);
      if (row) {
        logger.info('Monitor updated:', { id, updates: Object.keys(updates) });
        return this.mapRowToEntity(row);
      }
      return null;
    } catch (error) {
      logger.error('Failed to update monitor:', { error, id, updates });
      throw error;
    }
  }

  /**
   * Delete monitor
   */
  async delete(id: string, tenantId?: string): Promise<boolean> {
    const params = [id];
    let whereClause = 'WHERE id = $1';
    
    if (tenantId) {
      params.push(tenantId);
      whereClause += ' AND tenant_id = $2';
    }

    const query = `DELETE FROM monitors ${whereClause}`;

    try {
      const result = await this.pool.query(query, params);
      const deleted = (result.rowCount || 0) > 0;
      
      if (deleted) {
        logger.info('Monitor deleted:', { id });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Failed to delete monitor:', { error, id });
      throw error;
    }
  }

  /**
   * Find monitors by tenant
   */
  async findByTenant(tenantId: string, options: MonitorListOptions = {}): Promise<Monitor[]> {
    const { monitors } = await this.findMany({ tenantId }, options);
    return monitors;
  }

  /**
   * Find monitors that need to be checked
   */
  async findDueForCheck(): Promise<Monitor[]> {
    // This would typically involve checking against a schedule table or Redis
    // For now, return all active monitors
    const { monitors } = await this.findMany({});
    return monitors;
  }

  /**
   * Bulk update monitors
   */
  async bulkUpdate(
    updateList: Array<{ id: string; updates: Partial<Monitor> }>,
    tenantId?: string
  ): Promise<Monitor[]> {
    return this.executeTransaction(async (client) => {
      const updatedMonitors: Monitor[] = [];

      for (const { id, updates } of updateList) {
        const allowedUpdates = [
          'name', 'url', 'check_interval', 'timeout_seconds',
          'expected_status_codes', 'probe_locations', 'failure_threshold'
        ];

        const updateFields: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        // Build SET clause
        for (const [key, value] of Object.entries(updates)) {
          const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          if (allowedUpdates.includes(dbKey) && value !== undefined) {
            updateFields.push(`${dbKey} = $${paramIndex++}`);
            params.push(value);
          }
        }

        if (updateFields.length === 0) continue;

        // Add updated_at
        updateFields.push(`updated_at = $${paramIndex++}`);
        params.push(new Date());

        // Add WHERE conditions
        params.push(id);
        let whereClause = `WHERE id = $${paramIndex++}`;
        
        if (tenantId) {
          params.push(tenantId);
          whereClause += ` AND tenant_id = $${paramIndex++}`;
        }

        const query = `
          UPDATE monitors 
          SET ${updateFields.join(', ')} 
          ${whereClause}
          RETURNING *
        `;

        const row = await this.executeQuerySingle(query, params, client);
        if (row) {
          updatedMonitors.push(this.mapRowToEntity(row));
        }
      }

      logger.info('Bulk monitor update completed:', { count: updatedMonitors.length });
      return updatedMonitors;
    });
  }

  /**
   * Get monitor statistics
   */
  async getStats(tenantId?: string): Promise<{
    total: number;
    byInterval: Record<string, number>;
    byLocation: Record<string, number>;
  }> {
    try {
      const filters = tenantId ? { tenant_id: tenantId } : {};
      const { clause, params } = this.buildWhereClause(filters);

      // Get total count
      const totalQuery = `SELECT COUNT(*) as total FROM monitors ${clause}`;
      const totalResult = await this.executeQuerySingle<{ total: string }>(totalQuery, params);
      const total = parseInt(totalResult?.total || '0', 10);

      // Get count by interval
      const intervalQuery = `
        SELECT check_interval, COUNT(*) as count 
        FROM monitors ${clause}
        GROUP BY check_interval
      `;
      const intervalRows = await this.executeQuery<{ check_interval: number; count: string }>(
        intervalQuery, 
        params
      );
      const byInterval: Record<string, number> = {};
      intervalRows.forEach(row => {
        byInterval[row.check_interval.toString()] = parseInt(row.count, 10);
      });

      // Get count by location (this is more complex due to array field)
      const locationQuery = `
        SELECT unnest(probe_locations) as location, COUNT(*) as count
        FROM monitors ${clause}
        GROUP BY location
      `;
      const locationRows = await this.executeQuery<{ location: string; count: string }>(
        locationQuery,
        params
      );
      const byLocation: Record<string, number> = {};
      locationRows.forEach(row => {
        byLocation[row.location] = parseInt(row.count, 10);
      });

      return { total, byInterval, byLocation };
    } catch (error) {
      logger.error('Failed to get monitor stats:', { error, tenantId });
      throw error;
    }
  }

  /**
   * Map database row to Monitor entity
   */
  protected mapRowToEntity(row: any): Monitor {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      url: row.url,
      checkInterval: row.check_interval,
      timeoutSeconds: row.timeout_seconds,
      expectedStatusCodes: row.expected_status_codes || [200],
      probeLocations: row.probe_locations || [ProbeLocation.US_EAST],
      failureThreshold: row.failure_threshold || 3,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map Monitor entity to database row
   */
  protected mapEntityToRow(monitor: Monitor): any {
    return {
      id: monitor.id,
      tenant_id: monitor.tenantId,
      name: monitor.name,
      url: monitor.url,
      check_interval: monitor.checkInterval,
      timeout_seconds: monitor.timeoutSeconds,
      expected_status_codes: monitor.expectedStatusCodes,
      probe_locations: monitor.probeLocations,
      failure_threshold: monitor.failureThreshold,
      created_at: monitor.createdAt,
      updated_at: monitor.updatedAt,
    };
  }
}
