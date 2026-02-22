/**
 * Tenant Repository
 * Handles CRUD operations for tenants in PostgreSQL
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';
import { Tenant } from '../../types/index';
import { logger } from '../../utils/logger';
import { encryptObject, decryptObject } from '../../services/encryption-service';

export interface TenantFilters {
  name?: string;
}

export interface TenantListOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'created_at';
  direction?: 'ASC' | 'DESC';
}

export class TenantRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  /**
   * Create a new tenant
   */
  async create(tenant: Omit<Tenant, 'id' | 'createdAt'>): Promise<Tenant> {
    this.validateRequiredFields(tenant, ['name']);

    const id = this.generateId();
    const now = new Date();

    // Encrypt sensitive configuration data
    const encryptedConfig = tenant.encryptedConfig && Object.keys(tenant.encryptedConfig).length > 0
      ? encryptObject(tenant.encryptedConfig)
      : null;

    const query = `
      INSERT INTO tenants (id, name, encrypted_config, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const params = [
      id,
      tenant.name,
      encryptedConfig,
      now,
    ];

    try {
      const rows = await this.executeQuery(query, params);
      const createdTenant = this.mapRowToEntity(rows[0]);
      
      logger.info('Tenant created:', { id, name: tenant.name });
      return createdTenant;
    } catch (error) {
      logger.error('Failed to create tenant:', { error, name: tenant.name });
      throw error;
    }
  }

  /**
   * Find tenant by ID
   */
  async findById(id: string): Promise<Tenant | null> {
    const query = 'SELECT * FROM tenants WHERE id = $1';

    try {
      const row = await this.executeQuerySingle(query, [id]);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find tenant by ID:', { error, id });
      throw error;
    }
  }

  /**
   * Find tenant by name
   */
  async findByName(name: string): Promise<Tenant | null> {
    const query = 'SELECT * FROM tenants WHERE name = $1';

    try {
      const row = await this.executeQuerySingle(query, [name]);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find tenant by name:', { error, name });
      throw error;
    }
  }

  /**
   * Find tenants with filters and pagination
   */
  async findMany(
    filters: TenantFilters = {},
    options: TenantListOptions = {}
  ): Promise<{ tenants: Tenant[]; total: number }> {
    try {
      // Build WHERE clause
      const dbFilters: any = {};
      if (filters.name) dbFilters.name = filters.name;

      const { clause: whereClause, params: whereParams } = this.buildWhereClause(dbFilters);

      // Build ORDER BY clause
      const orderByClause = this.buildOrderByClause(
        options.orderBy || 'created_at',
        options.direction || 'DESC'
      );

      // Build LIMIT/OFFSET clause
      const { clause: limitClause, params: limitParams } = this.buildLimitClause(
        options.limit,
        options.offset,
        whereParams.length + 1
      );

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM tenants ${whereClause}`;
      const countResult = await this.executeQuerySingle<{ total: string }>(countQuery, whereParams);
      const total = parseInt(countResult?.total || '0', 10);

      // Get tenants
      const query = `
        SELECT * FROM tenants 
        ${whereClause} 
        ${orderByClause} 
        ${limitClause}
      `;
      const allParams = [...whereParams, ...limitParams];
      const rows = await this.executeQuery(query, allParams);

      const tenants = rows.map(row => this.mapRowToEntity(row));

      return { tenants, total };
    } catch (error) {
      logger.error('Failed to find tenants:', { error, filters });
      throw error;
    }
  }

  /**
   * Update tenant
   */
  async update(id: string, updates: Partial<Tenant>): Promise<Tenant | null> {
    const allowedUpdates = ['name', 'encrypted_config'];

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build SET clause
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedUpdates.includes(dbKey) && value !== undefined) {
        if (dbKey === 'encrypted_config') {
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
      UPDATE tenants 
      SET ${updateFields.join(', ')} 
      ${whereClause}
      RETURNING *
    `;

    try {
      const row = await this.executeQuerySingle(query, params);
      if (row) {
        logger.info('Tenant updated:', { id, updates: Object.keys(updates) });
        return this.mapRowToEntity(row);
      }
      return null;
    } catch (error) {
      logger.error('Failed to update tenant:', { error, id, updates });
      throw error;
    }
  }

  /**
   * Delete tenant
   */
  async delete(id: string): Promise<boolean> {
    // Note: This should cascade delete all related monitors, alerts, etc.
    // Make sure foreign key constraints are set up properly
    const query = 'DELETE FROM tenants WHERE id = $1';

    try {
      const result = await this.pool.query(query, [id]);
      const deleted = (result.rowCount || 0) > 0;
      
      if (deleted) {
        logger.info('Tenant deleted:', { id });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Failed to delete tenant:', { error, id });
      throw error;
    }
  }

  /**
   * Check if tenant exists
   */
  async exists(id: string): Promise<boolean> {
    const query = 'SELECT 1 FROM tenants WHERE id = $1';

    try {
      const row = await this.executeQuerySingle(query, [id]);
      return row !== null;
    } catch (error) {
      logger.error('Failed to check tenant existence:', { error, id });
      throw error;
    }
  }

  /**
   * Check if tenant name is available
   */
  async isNameAvailable(name: string, excludeId?: string): Promise<boolean> {
    let query = 'SELECT 1 FROM tenants WHERE name = $1';
    const params = [name];

    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }

    try {
      const row = await this.executeQuerySingle(query, params);
      return row === null;
    } catch (error) {
      logger.error('Failed to check tenant name availability:', { error, name });
      throw error;
    }
  }

  /**
   * Get tenant statistics
   */
  async getStats(id: string): Promise<{
    monitorCount: number;
    alertCount: number;
    activeAlertCount: number;
    notificationChannelCount: number;
  }> {
    try {
      // Get monitor count
      const monitorQuery = 'SELECT COUNT(*) as count FROM monitors WHERE tenant_id = $1';
      const monitorResult = await this.executeQuerySingle<{ count: string }>(monitorQuery, [id]);
      const monitorCount = parseInt(monitorResult?.count || '0', 10);

      // Get alert count
      const alertQuery = `
        SELECT COUNT(*) as count 
        FROM alerts a 
        JOIN monitors m ON a.monitor_id = m.id 
        WHERE m.tenant_id = $1
      `;
      const alertResult = await this.executeQuerySingle<{ count: string }>(alertQuery, [id]);
      const alertCount = parseInt(alertResult?.count || '0', 10);

      // Get active alert count
      const activeAlertQuery = `
        SELECT COUNT(*) as count 
        FROM alerts a 
        JOIN monitors m ON a.monitor_id = m.id 
        WHERE m.tenant_id = $1 AND a.resolved_at IS NULL
      `;
      const activeAlertResult = await this.executeQuerySingle<{ count: string }>(activeAlertQuery, [id]);
      const activeAlertCount = parseInt(activeAlertResult?.count || '0', 10);

      // Get notification channel count
      const channelQuery = 'SELECT COUNT(*) as count FROM notification_channels WHERE tenant_id = $1';
      const channelResult = await this.executeQuerySingle<{ count: string }>(channelQuery, [id]);
      const notificationChannelCount = parseInt(channelResult?.count || '0', 10);

      return {
        monitorCount,
        alertCount,
        activeAlertCount,
        notificationChannelCount,
      };
    } catch (error) {
      logger.error('Failed to get tenant stats:', { error, id });
      throw error;
    }
  }

  /**
   * Get all tenants (for admin purposes)
   */
  async findAll(): Promise<Tenant[]> {
    const { tenants } = await this.findMany({}, { orderBy: 'name', direction: 'ASC' });
    return tenants;
  }

  /**
   * Update tenant configuration
   */
  async updateConfig(id: string, config: Record<string, any>): Promise<Tenant | null> {
    return this.update(id, { encryptedConfig: config });
  }

  /**
   * Get tenant configuration
   */
  async getConfig(id: string): Promise<Record<string, any> | null> {
    const tenant = await this.findById(id);
    return tenant ? tenant.encryptedConfig : null;
  }

  /**
   * Map database row to Tenant entity
   */
  protected mapRowToEntity(row: any): Tenant {
    // Decrypt configuration if present
    let encryptedConfig = {};
    if (row.encrypted_config) {
      try {
        encryptedConfig = decryptObject(row.encrypted_config);
      } catch (error) {
        logger.warn('Failed to decrypt tenant config, using empty object', { id: row.id });
        encryptedConfig = {};
      }
    }

    return {
      id: row.id,
      name: row.name,
      encryptedConfig,
      createdAt: row.created_at,
    };
  }

  /**
   * Map Tenant entity to database row
   */
  protected mapEntityToRow(tenant: Tenant): any {
    return {
      id: tenant.id,
      name: tenant.name,
      encrypted_config: encryptObject(tenant.encryptedConfig),
      created_at: tenant.createdAt,
    };
  }
}
