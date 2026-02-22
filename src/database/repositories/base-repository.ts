/**
 * Base Repository Class
 * Provides common database operations and error handling
 */

import { Pool, PoolClient } from 'pg';
import { logger } from '../../utils/logger';

export interface RepositoryOptions {
  retryAttempts?: number;
  retryDelay?: number;
}

export abstract class BaseRepository {
  protected pool: Pool;
  protected options: RepositoryOptions;

  constructor(pool: Pool, options: RepositoryOptions = {}) {
    this.pool = pool;
    this.options = {
      retryAttempts: 3,
      retryDelay: 1000,
      ...options,
    };
  }

  /**
   * Execute a query with retry logic and error handling
   */
  protected async executeQuery<T = any>(
    query: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<T[]> {
    const useClient = client || this.pool;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= (this.options.retryAttempts || 3); attempt++) {
      try {
        const result = await useClient.query(query, params);
        return result.rows;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Query attempt ${attempt} failed:`, {
          error: error instanceof Error ? error.message : error,
          query: query.substring(0, 100),
          attempt,
        });

        if (attempt < (this.options.retryAttempts || 3)) {
          await this.delay(this.options.retryDelay || 1000);
        }
      }
    }

    logger.error('Query failed after all retry attempts:', {
      error: lastError?.message,
      query: query.substring(0, 100),
      params: params.length,
    });

    throw lastError || new Error('Query failed after all retry attempts');
  }

  /**
   * Execute a single query and return first row or null
   */
  protected async executeQuerySingle<T = any>(
    query: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<T | null> {
    const rows = await this.executeQuery<T>(query, params, client);
    return rows.length > 0 ? rows[0]! : null;
  }

  /**
   * Execute a transaction with retry logic
   */
  protected async executeTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= (this.options.retryAttempts || 3); attempt++) {
      const client = await this.pool.connect();
      
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        lastError = error as Error;
        
        logger.warn(`Transaction attempt ${attempt} failed:`, {
          error: error instanceof Error ? error.message : error,
          attempt,
        });

        if (attempt < (this.options.retryAttempts || 3)) {
          await this.delay(this.options.retryDelay || 1000);
        }
      } finally {
        client.release();
      }
    }

    logger.error('Transaction failed after all retry attempts:', {
      error: lastError?.message,
    });

    throw lastError || new Error('Transaction failed after all retry attempts');
  }

  /**
   * Build WHERE clause from filters
   */
  protected buildWhereClause(
    filters: Record<string, any>,
    startIndex: number = 1
  ): { clause: string; params: any[]; nextIndex: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = startIndex;

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          conditions.push(`${key} IN (${placeholders})`);
          params.push(...value);
        } else {
          conditions.push(`${key} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { clause, params, nextIndex: paramIndex };
  }

  /**
   * Build ORDER BY clause
   */
  protected buildOrderByClause(
    orderBy?: string,
    direction: 'ASC' | 'DESC' = 'ASC'
  ): string {
    if (!orderBy) return '';
    return `ORDER BY ${orderBy} ${direction}`;
  }

  /**
   * Build LIMIT and OFFSET clause
   */
  protected buildLimitClause(
    limit?: number,
    offset?: number,
    startIndex: number = 1
  ): {
    clause: string;
    params: any[];
  } {
    const clauses: string[] = [];
    const params: any[] = [];

    if (limit !== undefined) {
      clauses.push(`LIMIT $${startIndex + params.length}`);
      params.push(limit);
    }

    if (offset !== undefined) {
      clauses.push(`OFFSET $${startIndex + params.length}`);
      params.push(offset);
    }

    return {
      clause: clauses.join(' '),
      params,
    };
  }

  /**
   * Convert database row to domain object
   */
  protected abstract mapRowToEntity(row: any): any;

  /**
   * Convert domain object to database row
   */
  protected abstract mapEntityToRow(entity: any): any;

  /**
   * Delay execution for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate required fields
   */
  protected validateRequiredFields(entity: any, requiredFields: string[]): void {
    for (const field of requiredFields) {
      if (entity[field] === undefined || entity[field] === null) {
        throw new Error(`Required field '${field}' is missing`);
      }
    }
  }

  /**
   * Generate UUID for new entities
   */
  protected generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Health check for repository
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.executeQuery('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Repository health check failed:', error);
      return false;
    }
  }
}
