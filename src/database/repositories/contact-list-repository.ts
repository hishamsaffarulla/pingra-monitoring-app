/**
 * Contact List Repository
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';

export interface ContactListRecord {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactListMemberRecord {
  id: string;
  listId: string;
  label?: string | null;
  channelType: 'email' | 'phone';
  contact: string;
  enabled: boolean;
  createdAt: Date;
}

export class ContactListRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  async findLists(tenantId: string): Promise<ContactListRecord[]> {
    const query = `
      SELECT * FROM contact_lists
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToList(row));
  }

  async createList(payload: Omit<ContactListRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContactListRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO contact_lists (id, tenant_id, name, description, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `;
    const rows = await this.executeQuery(query, [
      id,
      payload.tenantId,
      payload.name,
      payload.description || null,
      now,
      now,
    ]);
    return this.mapRowToList(rows[0]);
  }

  async updateList(id: string, tenantId: string, updates: Partial<ContactListRecord>): Promise<ContactListRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const mapping: Record<string, any> = {
      name: updates.name,
      description: updates.description,
    };

    for (const [column, value] of Object.entries(mapping)) {
      if (value !== undefined) {
        fields.push(`${column} = $${idx++}`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      return this.findListById(id, tenantId);
    }

    fields.push(`updated_at = $${idx++}`);
    params.push(new Date());
    params.push(id, tenantId);

    const query = `
      UPDATE contact_lists
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, params);
    return row ? this.mapRowToList(row) : null;
  }

  async deleteList(id: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM contact_lists
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return !!row;
  }

  async findListById(id: string, tenantId: string): Promise<ContactListRecord | null> {
    const query = `
      SELECT * FROM contact_lists
      WHERE id = $1 AND tenant_id = $2
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return row ? this.mapRowToList(row) : null;
  }

  async findMembers(listId: string, tenantId: string): Promise<ContactListMemberRecord[]> {
    const query = `
      SELECT members.*
      FROM contact_list_members members
      JOIN contact_lists lists ON lists.id = members.list_id
      WHERE members.list_id = $1 AND lists.tenant_id = $2
      ORDER BY members.created_at DESC
    `;
    const rows = await this.executeQuery(query, [listId, tenantId]);
    return rows.map(row => this.mapRowToMember(row));
  }

  async findEnabledMembersByTenant(tenantId: string): Promise<ContactListMemberRecord[]> {
    const query = `
      SELECT members.*
      FROM contact_list_members members
      JOIN contact_lists lists ON lists.id = members.list_id
      WHERE lists.tenant_id = $1
        AND members.enabled = true
      ORDER BY members.created_at DESC
    `;
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToMember(row));
  }

  async createMember(payload: Omit<ContactListMemberRecord, 'id' | 'createdAt'>): Promise<ContactListMemberRecord> {
    const id = this.generateId();
    const now = new Date();
    const query = `
      INSERT INTO contact_list_members (id, list_id, label, channel_type, contact, enabled, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
    const rows = await this.executeQuery(query, [
      id,
      payload.listId,
      payload.label || null,
      payload.channelType,
      payload.contact,
      payload.enabled ?? true,
      now,
    ]);
    return this.mapRowToMember(rows[0]);
  }

  async deleteMember(id: string, listId: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM contact_list_members
      USING contact_lists
      WHERE contact_list_members.id = $1
        AND contact_list_members.list_id = $2
        AND contact_lists.id = contact_list_members.list_id
        AND contact_lists.tenant_id = $3
      RETURNING contact_list_members.id
    `;
    const row = await this.executeQuerySingle(query, [id, listId, tenantId]);
    return !!row;
  }

  protected mapRowToList(row: any): ContactListRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected mapRowToMember(row: any): ContactListMemberRecord {
    return {
      id: row.id,
      listId: row.list_id,
      label: row.label,
      channelType: row.channel_type,
      contact: row.contact,
      enabled: row.enabled,
      createdAt: row.created_at,
    };
  }

  protected mapRowToEntity(_row: any): any {
    return null;
  }

  protected mapEntityToRow(_entity: any): any {
    return null;
  }
}
