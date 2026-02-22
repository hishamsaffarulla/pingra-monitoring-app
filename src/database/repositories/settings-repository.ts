/**
 * Settings Repository
 * Handles tenant settings and API keys
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface TenantSettings {
  tenantId: string;
  config: Record<string, any>;
  updatedAt: Date;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  masked: string;
  createdAt: Date;
  revokedAt?: Date | null;
}

export class SettingsRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async getSettings(tenantId: string): Promise<TenantSettings> {
    const query = `
      SELECT tenant_id, config, updated_at
      FROM tenant_settings
      WHERE tenant_id = $1
    `;
    const row = await this.executeQuerySingle(query, [tenantId]);
    if (!row) {
      return {
        tenantId,
        config: {},
        updatedAt: new Date(),
      };
    }

    return {
      tenantId: row.tenant_id,
      config: row.config || {},
      updatedAt: row.updated_at,
    };
  }

  async upsertSettings(tenantId: string, config: Record<string, any>): Promise<TenantSettings> {
    const query = `
      INSERT INTO tenant_settings (tenant_id, config, updated_at)
      VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id)
      DO UPDATE SET config = $2, updated_at = $3
      RETURNING tenant_id, config, updated_at
    `;
    const now = new Date();
    const row = await this.executeQuerySingle(query, [tenantId, config, now]);
    return {
      tenantId: row!.tenant_id,
      config: row!.config || {},
      updatedAt: row!.updated_at,
    };
  }

  async listApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
    const query = `
      SELECT * FROM api_keys
      WHERE tenant_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapApiKey(row));
  }

  async createApiKey(tenantId: string, name: string, masked: string): Promise<ApiKeyRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO api_keys (id, tenant_id, name, masked, created_at)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId, name, masked, now]);
    return this.mapApiKey(row!);
  }

  async revokeApiKey(id: string, tenantId: string): Promise<boolean> {
    const query = `
      UPDATE api_keys
      SET revoked_at = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id
    `;
    const row = await this.executeQuerySingle(query, [new Date(), id, tenantId]);
    return !!row;
  }

  protected mapRowToEntity(_row: any): any {
    return _row;
  }

  protected mapEntityToRow(_entity: any): any {
    return _entity;
  }

  private mapApiKey(row: any): ApiKeyRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      masked: row.masked,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }
}
