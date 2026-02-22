/**
 * Scheduled Report Repository
 * Handles CRUD operations for scheduled reports
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface ScheduledReportRecord {
  id: string;
  tenantId: string;
  name: string;
  frequency: string;
  recipients: string;
  format: string;
  createdAt: Date;
}

export class ScheduledReportRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findMany(tenantId: string): Promise<ScheduledReportRecord[]> {
    const query = `
      SELECT * FROM scheduled_reports
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToEntity(row));
  }

  async create(payload: Omit<ScheduledReportRecord, 'id' | 'createdAt'>): Promise<ScheduledReportRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO scheduled_reports (id, tenant_id, name, frequency, recipients, format, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, [
      id,
      payload.tenantId,
      payload.name,
      payload.frequency,
      payload.recipients,
      payload.format,
      now,
    ]);
    return this.mapRowToEntity(row!);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM scheduled_reports
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return !!row;
  }

  protected mapRowToEntity(row: any): ScheduledReportRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      frequency: row.frequency,
      recipients: row.recipients,
      format: row.format,
      createdAt: row.created_at,
    };
  }

  protected mapEntityToRow(entity: ScheduledReportRecord): any {
    return {
      id: entity.id,
      tenant_id: entity.tenantId,
      name: entity.name,
      frequency: entity.frequency,
      recipients: entity.recipients,
      format: entity.format,
      created_at: entity.createdAt,
    };
  }
}
