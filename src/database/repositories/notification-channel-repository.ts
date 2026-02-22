/**
 * Notification Channel Repository
 * Handles CRUD operations for notification channels
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface NotificationChannelRecord {
  id: string;
  tenantId: string;
  name: string;
  type: 'email' | 'webhook' | 'sms' | 'voice';
  configuration: Record<string, any>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationChannelRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findMany(tenantId: string): Promise<NotificationChannelRecord[]> {
    const query = `
      SELECT * FROM notification_channels
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToEntity(row));
  }

  async findById(id: string, tenantId: string): Promise<NotificationChannelRecord | null> {
    const query = `
      SELECT * FROM notification_channels
      WHERE id = $1 AND tenant_id = $2
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return row ? this.mapRowToEntity(row) : null;
  }

  async create(payload: Omit<NotificationChannelRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationChannelRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO notification_channels (id, tenant_id, name, type, configuration, enabled, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, [
      id,
      payload.tenantId,
      payload.name,
      payload.type,
      payload.configuration || {},
      payload.enabled ?? true,
      now,
      now,
    ]);
    return this.mapRowToEntity(row!);
  }

  async update(id: string, tenantId: string, updates: Partial<NotificationChannelRecord>): Promise<NotificationChannelRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const mapping: Record<string, any> = {
      name: updates.name,
      type: updates.type,
      configuration: updates.configuration,
      enabled: updates.enabled,
    };

    for (const [column, value] of Object.entries(mapping)) {
      if (value !== undefined) {
        fields.push(`${column} = $${idx++}`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      return this.findById(id, tenantId);
    }

    fields.push(`updated_at = $${idx++}`);
    params.push(new Date());
    params.push(id, tenantId);

    const query = `
      UPDATE notification_channels
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, params);
    return row ? this.mapRowToEntity(row) : null;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM notification_channels
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return !!row;
  }

  protected mapRowToEntity(row: any): NotificationChannelRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      type: row.type,
      configuration: row.configuration || {},
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected mapEntityToRow(entity: NotificationChannelRecord): any {
    return {
      id: entity.id,
      tenant_id: entity.tenantId,
      name: entity.name,
      type: entity.type,
      configuration: entity.configuration,
      enabled: entity.enabled,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }
}
