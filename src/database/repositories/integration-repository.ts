/**
 * Integration Repository
 * Handles CRUD operations for integrations
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface IntegrationRecord {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  endpoint: string;
  configuration: Record<string, any>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class IntegrationRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findMany(tenantId: string): Promise<IntegrationRecord[]> {
    const query = `
      SELECT * FROM integrations
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToEntity(row));
  }

  async findById(id: string, tenantId: string): Promise<IntegrationRecord | null> {
    const query = `
      SELECT * FROM integrations
      WHERE id = $1 AND tenant_id = $2
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return row ? this.mapRowToEntity(row) : null;
  }

  async create(payload: Omit<IntegrationRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<IntegrationRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO integrations (id, tenant_id, type, name, endpoint, configuration, enabled, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `;
    const params = [
      id,
      payload.tenantId,
      payload.type,
      payload.name,
      payload.endpoint,
      payload.configuration || {},
      payload.enabled ?? true,
      now,
      now,
    ];
    const rows = await this.executeQuery(query, params);
    return this.mapRowToEntity(rows[0]);
  }

  async update(id: string, tenantId: string, updates: Partial<IntegrationRecord>): Promise<IntegrationRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const mapping: Record<string, any> = {
      type: updates.type,
      name: updates.name,
      endpoint: updates.endpoint,
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
      UPDATE integrations
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, params);
    return row ? this.mapRowToEntity(row) : null;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM integrations
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const result = await this.executeQuery(query, [id, tenantId]);
    return result.length > 0;
  }

  protected mapRowToEntity(row: any): IntegrationRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type,
      name: row.name,
      endpoint: row.endpoint,
      configuration: row.configuration || {},
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected mapEntityToRow(entity: IntegrationRecord): any {
    return {
      id: entity.id,
      tenant_id: entity.tenantId,
      type: entity.type,
      name: entity.name,
      endpoint: entity.endpoint,
      configuration: entity.configuration,
      enabled: entity.enabled,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }
}
