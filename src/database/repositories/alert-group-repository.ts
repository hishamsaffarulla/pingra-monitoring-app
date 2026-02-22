/**
 * Alert Group Repository
 * Handles CRUD operations for alert groups and members
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface AlertGroupRecord {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  members: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class AlertGroupRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findMany(tenantId: string): Promise<AlertGroupRecord[]> {
    const query = `
      SELECT g.*, ARRAY_REMOVE(ARRAY_AGG(m.user_id), NULL) AS members
      FROM alert_groups g
      LEFT JOIN alert_group_members m ON g.id = m.group_id
      WHERE g.tenant_id = $1
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToEntity(row));
  }

  async create(tenantId: string, name: string, description: string | null, members: string[]): Promise<AlertGroupRecord> {
    const id = this.generateId();
    const now = new Date();

    return this.executeTransaction(async (client) => {
      const groupQuery = `
        INSERT INTO alert_groups (id, tenant_id, name, description, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
      `;
      const groupRow = await this.executeQuerySingle(groupQuery, [id, tenantId, name, description, now, now], client);

      if (members.length > 0) {
        const values = members.map((_, index) => `($1,$${index + 2})`).join(', ');
        const params = [id, ...members];
        await this.executeQuery(`INSERT INTO alert_group_members (group_id, user_id) VALUES ${values}`, params, client);
      }

      return this.mapRowToEntity({ ...groupRow, members });
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const query = `DELETE FROM alert_groups WHERE id = $1 AND tenant_id = $2 RETURNING id`;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return !!row;
  }

  protected mapRowToEntity(row: any): AlertGroupRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      members: row.members || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected mapEntityToRow(entity: AlertGroupRecord): any {
    return {
      id: entity.id,
      tenant_id: entity.tenantId,
      name: entity.name,
      description: entity.description,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }
}
