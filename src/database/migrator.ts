/**
 * Database Migration System
 * Handles schema versioning and migration execution
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { PoolClient } from 'pg';
import { getDatabaseManager } from './connection';
import { logger } from '../utils/logger';

export interface Migration {
  version: string;
  description: string;
  sql: string;
  filePath: string;
}

export interface MigrationResult {
  version: string;
  success: boolean;
  error?: string;
  executionTime: number;
}

export class DatabaseMigrator {
  private migrationsPath: string;

  constructor(migrationsPath: string = join(__dirname, 'migrations')) {
    this.migrationsPath = migrationsPath;
  }

  /**
   * Run all pending migrations
   */
  async migrate(): Promise<MigrationResult[]> {
    const dbManager = getDatabaseManager();
    const client = await dbManager.getPostgreSQLClient();
    
    try {
      await this.ensureMigrationsTable(client);
      
      const pendingMigrations = await this.getPendingMigrations(client);
      const results: MigrationResult[] = [];

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      for (const migration of pendingMigrations) {
        const result = await this.executeMigration(client, migration);
        results.push(result);
        
        if (!result.success) {
          logger.error(`Migration ${migration.version} failed, stopping migration process`);
          break;
        }
      }

      return results;
    } finally {
      client.release();
    }
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<{
    appliedMigrations: string[];
    pendingMigrations: string[];
    totalMigrations: number;
  }> {
    const dbManager = getDatabaseManager();
    const client = await dbManager.getPostgreSQLClient();
    
    try {
      await this.ensureMigrationsTable(client);
      
      const appliedMigrations = await this.getAppliedMigrations(client);
      const allMigrations = await this.loadMigrations();
      const pendingMigrations = allMigrations
        .filter(m => !appliedMigrations.includes(m.version))
        .map(m => m.version);

      return {
        appliedMigrations,
        pendingMigrations,
        totalMigrations: allMigrations.length,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Rollback last migration (if supported)
   */
  async rollback(): Promise<void> {
    // Note: This is a basic implementation
    // In production, you might want to support rollback scripts
    throw new Error('Rollback not implemented - create manual rollback scripts if needed');
  }

  /**
   * Ensure migrations table exists
   */
  private async ensureMigrationsTable(client: PoolClient): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        description TEXT
      );
    `;
    
    await client.query(createTableSQL);
  }

  /**
   * Get list of applied migrations
   */
  private async getAppliedMigrations(client: PoolClient): Promise<string[]> {
    const result = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    
    return result.rows.map(row => row.version);
  }

  /**
   * Load all migration files
   */
  private async loadMigrations(): Promise<Migration[]> {
    try {
      const files = await readdir(this.migrationsPath);
      const migrationFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Ensure consistent ordering

      const migrations: Migration[] = [];

      for (const file of migrationFiles) {
        const filePath = join(this.migrationsPath, file);
        const sql = await readFile(filePath, 'utf-8');
        
        // Extract version from filename (e.g., "001_initial_schema.sql" -> "001_initial_schema")
        const version = file.replace('.sql', '');
        
        // Extract description from SQL comments or filename
        const description = this.extractDescription(sql, file);

        migrations.push({
          version,
          description,
          sql,
          filePath,
        });
      }

      return migrations;
    } catch (error) {
      logger.error('Failed to load migrations:', error);
      throw new Error(`Failed to load migrations from ${this.migrationsPath}`);
    }
  }

  /**
   * Get pending migrations
   */
  private async getPendingMigrations(client: PoolClient): Promise<Migration[]> {
    const appliedMigrations = await this.getAppliedMigrations(client);
    const allMigrations = await this.loadMigrations();
    
    return allMigrations.filter(migration => 
      !appliedMigrations.includes(migration.version)
    );
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(client: PoolClient, migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Executing migration: ${migration.version} - ${migration.description}`);
      
      await client.query('BEGIN');
      
      // Execute the migration SQL
      await client.query(migration.sql);
      
      // Record the migration as applied (if not already recorded in the SQL)
      await client.query(
        'INSERT INTO schema_migrations (version, description) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [migration.version, migration.description]
      );
      
      await client.query('COMMIT');
      
      const executionTime = Date.now() - startTime;
      logger.info(`Migration ${migration.version} completed successfully in ${executionTime}ms`);
      
      return {
        version: migration.version,
        success: true,
        executionTime,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error(`Migration ${migration.version} failed:`, error);
      
      return {
        version: migration.version,
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
   * Extract description from SQL file
   */
  private extractDescription(sql: string, filename: string): string {
    // Look for description comment in SQL
    const descriptionMatch = sql.match(/-- Description: (.+)/);
    if (descriptionMatch && descriptionMatch[1]) {
      return descriptionMatch[1].trim();
    }
    
    // Fallback to filename-based description
    const parts = filename.replace('.sql', '').split('_');
    if (parts.length > 1) {
      return parts.slice(1).join(' ').replace(/[_-]/g, ' ');
    }
    
    return filename.replace('.sql', '');
  }

  /**
   * Create a new migration file
   */
  async createMigration(name: string, description: string): Promise<string> {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const version = `${timestamp}_${name}`;
    const filename = `${version}.sql`;
    const filePath = join(this.migrationsPath, filename);
    
    const template = `-- Migration: ${version}
-- Description: ${description}

-- Add your SQL statements here

-- Insert migration record
INSERT INTO schema_migrations (version, description) 
VALUES ('${version}', '${description}')
ON CONFLICT (version) DO NOTHING;
`;

    await readFile(filePath, 'utf-8').catch(async () => {
      // File doesn't exist, create it
      const { writeFile } = await import('fs/promises');
      await writeFile(filePath, template);
    });

    return filePath;
  }
}

/**
 * Run migrations (convenience function)
 */
export async function runMigrations(direction: 'up' | 'down' = 'up'): Promise<MigrationResult[]> {
  const migrator = new DatabaseMigrator();
  
  if (direction === 'down') {
    await migrator.rollback();
    return [];
  }
  
  return await migrator.migrate();
}
