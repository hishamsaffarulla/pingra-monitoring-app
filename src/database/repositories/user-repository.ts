/**
 * User Repository
 * Handles CRUD operations for users in PostgreSQL
 */

import { Pool } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';
import { logger } from '../../utils/logger';
import { User } from '../../services/auth-service';

export interface CreateUserData {
  tenantId: string;
  email: string;
  passwordHash: string;
  name?: string;
  role?: string;
  phone?: string;
  alertPreferences?: string[];
  status?: string;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
  role?: string;
  phone?: string;
  alertPreferences?: string[];
  status?: string;
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
}

export class UserRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  /**
   * Create a new user
   */
  async create(userData: CreateUserData): Promise<User> {
    this.validateRequiredFields(userData, ['tenantId', 'email', 'passwordHash']);

    const id = this.generateId();
    const now = new Date();

    const query = `
      INSERT INTO users (id, tenant_id, email, password_hash, name, role, phone, alert_preferences, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const params = [
      id,
      userData.tenantId,
      userData.email.toLowerCase(),
      userData.passwordHash,
      userData.name || null,
      userData.role || 'member',
      userData.phone || null,
      userData.alertPreferences || [],
      userData.status || 'active',
      now,
      now,
    ];

    try {
      const rows = await this.executeQuery(query, params);
      const user = this.mapRowToEntity(rows[0]);
      
      logger.info('User created:', { id, email: userData.email });
      return user;
    } catch (error) {
      logger.error('Failed to create user:', { error, email: userData.email });
      throw error;
    }
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';

    try {
      const row = await this.executeQuerySingle(query, [email.toLowerCase()]);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find user by email:', { error, email });
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';

    try {
      const row = await this.executeQuerySingle(query, [id]);
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Failed to find user by ID:', { error, id });
      throw error;
    }
  }

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const query = 'SELECT 1 FROM users WHERE email = $1';

    try {
      const row = await this.executeQuerySingle(query, [email.toLowerCase()]);
      return row !== null;
    } catch (error) {
      logger.error('Failed to check email existence:', { error, email });
      throw error;
    }
  }

  /**
   * Map database row to User entity
   */
  protected mapRowToEntity(row: any): User {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      role: row.role,
      phone: row.phone,
      alertPreferences: Array.isArray(row.alert_preferences)
        ? row.alert_preferences
        : typeof row.alert_preferences === 'string'
          ? JSON.parse(row.alert_preferences)
          : (row.alert_preferences || []),
      status: row.status,
      mfaEnabled: row.mfa_enabled,
      mfaSecret: row.mfa_secret,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map User entity to database row
   */
  protected mapEntityToRow(user: User): any {
    return {
      id: user.id,
      tenant_id: user.tenantId,
      email: user.email,
      password_hash: user.passwordHash,
      name: user.name,
      role: user.role,
      phone: user.phone,
      alert_preferences: user.alertPreferences || [],
      status: user.status,
      mfa_enabled: user.mfaEnabled,
      mfa_secret: user.mfaSecret,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }
  /**
   * List users for a tenant
   */
  async findManyByTenant(tenantId: string): Promise<User[]> {
    const query = 'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC';
    const rows = await this.executeQuery(query, [tenantId]);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Update user details
   */
  async update(id: string, tenantId: string, updates: UpdateUserData): Promise<User | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const mapping: Record<string, any> = {
      name: updates.name,
      email: updates.email ? updates.email.toLowerCase() : undefined,
      role: updates.role,
      phone: updates.phone,
      alert_preferences: updates.alertPreferences,
      status: updates.status,
      mfa_enabled: updates.mfaEnabled,
      mfa_secret: updates.mfaSecret,
    };

    for (const [column, value] of Object.entries(mapping)) {
      if (value !== undefined) {
        fields.push(`${column} = $${idx++}`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = $${idx++}`);
    params.push(new Date());
    params.push(id, tenantId);

    const query = `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;
    const row = await this.executeQuerySingle(query, params);
    return row ? this.mapRowToEntity(row) : null;
  }

  /**
   * Delete user
   */
  async delete(id: string, tenantId: string): Promise<boolean> {
    const query = `
      DELETE FROM users
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const row = await this.executeQuerySingle(query, [id, tenantId]);
    return !!row;
  }
}
