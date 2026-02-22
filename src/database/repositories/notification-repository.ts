/**
 * Notification Delivery Repository
 * Handles persistence of notification delivery status and history
 */

import { Pool, PoolClient } from 'pg';
import { BaseRepository, RepositoryOptions } from './base-repository';
import { NotificationResult } from '../../types';
import { logger } from '../../utils/logger';

export interface NotificationDelivery {
  id: string;
  alertId: string;
  channelId: string;
  channelType: string;
  success: boolean;
  errorMessage?: string;
  deliveredAt: Date;
  retryCount: number;
  createdAt: Date;
}

export interface NotificationFilters {
  alertId?: string;
  channelId?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface NotificationListOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'deliveredAt' | 'createdAt';
  orderDirection?: 'ASC' | 'DESC';
}

export class NotificationRepository extends BaseRepository {
  constructor(pool: Pool, options?: RepositoryOptions) {
    super(pool, options);
  }

  // Implement abstract methods from BaseRepository
  protected mapRowToEntity(row: any): NotificationDelivery {
    return row as NotificationDelivery;
  }

  protected mapEntityToRow(entity: NotificationDelivery): any {
    return entity;
  }

  /**
   * Create notification delivery record
   */
  async create(
    alertId: string,
    channelId: string,
    channelType: string,
    result: NotificationResult,
    retryCount: number = 0,
    client?: PoolClient
  ): Promise<NotificationDelivery> {
    const query = `
      INSERT INTO notification_deliveries (
        alert_id, channel_id, channel_type, success, error_message, 
        delivered_at, retry_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id, alert_id as "alertId", channel_id as "channelId", 
        channel_type as "channelType", success, error_message as "errorMessage",
        delivered_at as "deliveredAt", retry_count as "retryCount", 
        created_at as "createdAt"
    `;

    const values = [
      alertId,
      channelId,
      channelType,
      result.success,
      result.errorMessage || null,
      result.deliveredAt,
      retryCount
    ];

    try {
      const queryResult = await this.executeQuery<NotificationDelivery>(
        query,
        values,
        client
      );

      if (!queryResult || queryResult.length === 0) {
        throw new Error('Failed to create notification delivery record');
      }

      const delivery = queryResult[0];
      if (!delivery) {
        throw new Error('Failed to create notification delivery record');
      }

      logger.info('Notification delivery record created', {
        id: delivery.id,
        alertId,
        channelId,
        success: result.success
      });

      return delivery;
    } catch (error) {
      logger.error('Failed to create notification delivery record', {
        alertId,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Find notification deliveries by filters
   */
  async findMany(
    filters: NotificationFilters = {},
    options: NotificationListOptions = {}
  ): Promise<{ deliveries: NotificationDelivery[]; total: number }> {
    const {
      limit = 100,
      offset = 0,
      orderBy = 'deliveredAt',
      orderDirection = 'DESC'
    } = options;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.alertId) {
      conditions.push(`alert_id = $${paramIndex++}`);
      values.push(filters.alertId);
    }

    if (filters.channelId) {
      conditions.push(`channel_id = $${paramIndex++}`);
      values.push(filters.channelId);
    }

    if (filters.success !== undefined) {
      conditions.push(`success = $${paramIndex++}`);
      values.push(filters.success);
    }

    if (filters.startDate) {
      conditions.push(`delivered_at >= $${paramIndex++}`);
      values.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push(`delivered_at <= $${paramIndex++}`);
      values.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM notification_deliveries ${whereClause}`;
    const countResult = await this.executeQuery<{ count: string }>(countQuery, values);
    const total = parseInt(countResult[0]?.count || '0', 10);

    // Get deliveries
    const query = `
      SELECT 
        id, alert_id as "alertId", channel_id as "channelId",
        channel_type as "channelType", success, error_message as "errorMessage",
        delivered_at as "deliveredAt", retry_count as "retryCount",
        created_at as "createdAt"
      FROM notification_deliveries
      ${whereClause}
      ORDER BY ${orderBy === 'deliveredAt' ? 'delivered_at' : 'created_at'} ${orderDirection}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    values.push(limit, offset);

    const result = await this.executeQuery<NotificationDelivery>(query, values);

    return {
      deliveries: result,
      total
    };
  }

  /**
   * Find notification deliveries by alert ID
   */
  async findByAlertId(alertId: string): Promise<NotificationDelivery[]> {
    const { deliveries } = await this.findMany({ alertId });
    return deliveries;
  }

  /**
   * Find failed notification deliveries for retry
   */
  async findFailedForRetry(maxRetryCount: number = 3): Promise<NotificationDelivery[]> {
    const query = `
      SELECT 
        id, alert_id as "alertId", channel_id as "channelId",
        channel_type as "channelType", success, error_message as "errorMessage",
        delivered_at as "deliveredAt", retry_count as "retryCount",
        created_at as "createdAt"
      FROM notification_deliveries
      WHERE success = false 
        AND retry_count < $1
        AND delivered_at > NOW() - INTERVAL '24 hours'
      ORDER BY delivered_at ASC
      LIMIT 100
    `;

    const result = await this.executeQuery<NotificationDelivery>(query, [maxRetryCount]);
    return result;
  }

  /**
   * Get notification delivery statistics
   */
  async getStats(alertId?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  }> {
    const whereClause = alertId ? 'WHERE alert_id = $1' : '';
    const values = alertId ? [alertId] : [];

    const query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failed
      FROM notification_deliveries
      ${whereClause}
    `;

    const result = await this.executeQuery<{
      total: string;
      successful: string;
      failed: string;
    }>(query, values);

    const row = result[0];
    const total = parseInt(row?.total || '0', 10);
    const successful = parseInt(row?.successful || '0', 10);
    const failed = parseInt(row?.failed || '0', 10);
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    return {
      total,
      successful,
      failed,
      successRate
    };
  }

  /**
   * Delete old notification delivery records
   */
  async deleteOldRecords(daysToKeep: number = 90): Promise<number> {
    const query = `
      DELETE FROM notification_deliveries
      WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
    `;

    const result = await this.executeQuery(query);
    const deletedCount = Array.isArray(result) ? result.length : 0;

    logger.info('Deleted old notification delivery records', {
      deletedCount,
      daysToKeep
    });

    return deletedCount;
  }

  /**
   * Health check
   */
  override async healthCheck(): Promise<boolean> {
    try {
      const query = 'SELECT 1 FROM notification_deliveries LIMIT 1';
      await this.executeQuery(query);
      return true;
    } catch (error) {
      logger.error('Notification repository health check failed', { error });
      return false;
    }
  }
}
