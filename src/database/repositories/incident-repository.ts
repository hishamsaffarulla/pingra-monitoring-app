/**
 * Incident Repository
 * Handles CRUD operations for incidents and updates
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface IncidentRecord {
  id: string;
  tenantId: string;
  monitorId?: string | null;
  title: string;
  description?: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'investigating' | 'identified' | 'monitoring' | 'resolved';
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  monitorName?: string | null;
  monitorUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date | null;
}

export interface IncidentUpdateRecord {
  id: string;
  incidentId: string;
  status: string;
  message: string;
  createdAt: Date;
}

export interface IncidentFilters {
  tenantId: string;
  status?: string;
  severity?: string;
  search?: string;
}

export class IncidentRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findMany(filters: IncidentFilters): Promise<IncidentRecord[]> {
    const params: any[] = [filters.tenantId];
    const conditions = ['incidents.tenant_id = $1'];
    let idx = 2;

    if (filters.status) {
      if (filters.status === 'active') {
        conditions.push(`incidents.status <> 'resolved'`);
      } else {
        conditions.push(`incidents.status = $${idx++}`);
        params.push(filters.status);
      }
    }

    if (filters.severity) {
      conditions.push(`incidents.severity = $${idx++}`);
      params.push(filters.severity);
    }

    if (filters.search) {
      conditions.push(`(incidents.title ILIKE $${idx} OR incidents.description ILIKE $${idx} OR monitors.name ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const query = `
      SELECT incidents.*,
             monitors.name AS monitor_name,
             monitors.url AS monitor_url,
             users.name AS assignee_name,
             users.email AS assignee_email
      FROM incidents
      LEFT JOIN monitors ON incidents.monitor_id = monitors.id
      LEFT JOIN users ON incidents.assignee_user_id = users.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY incidents.created_at DESC
    `;

    const rows = await this.executeQuery(query, params);
    return rows.map(row => this.mapRowToEntity(row));
  }

  async findById(id: string, tenantId: string): Promise<IncidentRecord | null> {
    const query = `
      SELECT incidents.*,
             monitors.name AS monitor_name,
             monitors.url AS monitor_url,
             users.name AS assignee_name,
             users.email AS assignee_email
      FROM incidents
      LEFT JOIN monitors ON incidents.monitor_id = monitors.id
      LEFT JOIN users ON incidents.assignee_user_id = users.id
      WHERE incidents.id = $1 AND incidents.tenant_id = $2
    `;

    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return row ? this.mapRowToEntity(row) : null;
  }

  async create(payload: Omit<IncidentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<IncidentRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO incidents (
        id, tenant_id, monitor_id, title, description, severity, status, assignee_user_id, created_at, updated_at, resolved_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `;

    const params = [
      id,
      payload.tenantId,
      payload.monitorId || null,
      payload.title,
      payload.description || null,
      payload.severity,
      payload.status,
      payload.assigneeUserId || null,
      now,
      now,
      payload.resolvedAt || null,
    ];

    const rows = await this.executeQuery(query, params);
    return this.mapRowToEntity(rows[0]);
  }

  async update(id: string, tenantId: string, updates: Partial<IncidentRecord>): Promise<IncidentRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const mapping: Record<string, any> = {
      monitor_id: updates.monitorId,
      title: updates.title,
      description: updates.description,
      severity: updates.severity,
      status: updates.status,
      assignee_user_id: updates.assigneeUserId,
      resolved_at: updates.resolvedAt,
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
      UPDATE incidents
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;

    const row = await this.executeQuerySingle(query, params);
    return row ? this.mapRowToEntity(row) : null;
  }

  async addUpdate(incidentId: string, status: string, message: string): Promise<IncidentUpdateRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO incident_updates (id, incident_id, status, message, created_at)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `;

    const rows = await this.executeQuery(query, [id, incidentId, status, message, now]);
    return this.mapUpdateRow(rows[0]);
  }

  async findUpdates(incidentId: string): Promise<IncidentUpdateRecord[]> {
    const query = `
      SELECT * FROM incident_updates
      WHERE incident_id = $1
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [incidentId]);
    return rows.map(row => this.mapUpdateRow(row));
  }

  protected mapRowToEntity(row: any): IncidentRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      monitorId: row.monitor_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      assigneeUserId: row.assignee_user_id,
      assigneeName: row.assignee_name,
      assigneeEmail: row.assignee_email,
      monitorName: row.monitor_name,
      monitorUrl: row.monitor_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }

  protected mapEntityToRow(entity: IncidentRecord): any {
    return {
      id: entity.id,
      tenant_id: entity.tenantId,
      monitor_id: entity.monitorId,
      title: entity.title,
      description: entity.description,
      severity: entity.severity,
      status: entity.status,
      assignee_user_id: entity.assigneeUserId,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
      resolved_at: entity.resolvedAt,
    };
  }

  private mapUpdateRow(row: any): IncidentUpdateRecord {
    return {
      id: row.id,
      incidentId: row.incident_id,
      status: row.status,
      message: row.message,
      createdAt: row.created_at,
    };
  }
}
