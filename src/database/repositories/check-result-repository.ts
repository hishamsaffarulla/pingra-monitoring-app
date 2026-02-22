/**
 * CheckResult Repository
 * Handles CRUD operations for check results in InfluxDB
 */

import { WriteApi, QueryApi, Point } from '@influxdata/influxdb-client';
import { CheckResult, ProbeLocation } from '../../types/index';
import { logger } from '../../utils/logger';

export interface CheckResultFilters {
  monitorId?: string;
  location?: ProbeLocation;
  success?: boolean;
  startTime?: Date;
  endTime?: Date;
}

export interface CheckResultQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp';
  direction?: 'ASC' | 'DESC';
}

export class CheckResultRepository {
  private writeApi: WriteApi;
  private queryApi: QueryApi;
  private bucket: string;
  private measurement = 'check_results';

  constructor(writeApi: WriteApi, queryApi: QueryApi, bucket: string) {
    this.writeApi = writeApi;
    this.queryApi = queryApi;
    this.bucket = bucket;
  }

  /**
   * Write a check result to InfluxDB
   */
  async create(checkResult: CheckResult): Promise<void> {
    try {
      const point = new Point(this.measurement)
        .tag('monitor_id', checkResult.monitorId)
        .tag('location', checkResult.location)
        .tag('success', checkResult.success.toString())
        .timestamp(checkResult.timestamp);

      // Add fields
      if (checkResult.responseTime !== undefined) {
        point.intField('response_time', checkResult.responseTime);
      }

      if (checkResult.statusCode !== undefined) {
        point.intField('status_code', checkResult.statusCode);
      }

      if (checkResult.errorMessage) {
        point.stringField('error_message', checkResult.errorMessage);
      }

      if (checkResult.sslExpiryDate) {
        point.stringField('ssl_expiry_date', checkResult.sslExpiryDate.toISOString());
      }

      // Add the check result ID as a field for reference
      point.stringField('id', checkResult.id);

      this.writeApi.writePoint(point);
      await this.writeApi.flush();

      logger.debug('Check result written to InfluxDB:', {
        id: checkResult.id,
        monitorId: checkResult.monitorId,
        location: checkResult.location,
        success: checkResult.success,
      });
    } catch (error) {
      logger.error('Failed to write check result to InfluxDB:', {
        error,
        checkResult: {
          id: checkResult.id,
          monitorId: checkResult.monitorId,
          location: checkResult.location,
        },
      });
      throw error;
    }
  }

  /**
   * Write multiple check results in batch
   */
  async createBatch(checkResults: CheckResult[]): Promise<void> {
    try {
      const points = checkResults.map(checkResult => {
        const point = new Point(this.measurement)
          .tag('monitor_id', checkResult.monitorId)
          .tag('location', checkResult.location)
          .tag('success', checkResult.success.toString())
          .timestamp(checkResult.timestamp);

        if (checkResult.responseTime !== undefined) {
          point.intField('response_time', checkResult.responseTime);
        }

        if (checkResult.statusCode !== undefined) {
          point.intField('status_code', checkResult.statusCode);
        }

        if (checkResult.errorMessage) {
          point.stringField('error_message', checkResult.errorMessage);
        }

        if (checkResult.sslExpiryDate) {
          point.stringField('ssl_expiry_date', checkResult.sslExpiryDate.toISOString());
        }

        point.stringField('id', checkResult.id);

        return point;
      });

      this.writeApi.writePoints(points);
      await this.writeApi.flush();

      logger.debug('Batch check results written to InfluxDB:', {
        count: checkResults.length,
      });
    } catch (error) {
      logger.error('Failed to write batch check results to InfluxDB:', {
        error,
        count: checkResults.length,
      });
      throw error;
    }
  }

  /**
   * Query check results with filters
   */
  async findMany(
    filters: CheckResultFilters = {},
    options: CheckResultQueryOptions = {}
  ): Promise<CheckResult[]> {
    try {
      let query = `from(bucket: "${this.bucket}")`;

      // Time range
      const startTime = filters.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
      const endTime = filters.endTime || new Date();
      
      query += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;

      // Filter by measurement
      query += `\n  |> filter(fn: (r) => r._measurement == "${this.measurement}")`;

      // Apply filters
      if (filters.monitorId) {
        query += `\n  |> filter(fn: (r) => r.monitor_id == "${filters.monitorId}")`;
      }

      if (filters.location) {
        query += `\n  |> filter(fn: (r) => r.location == "${filters.location}")`;
      }

      if (filters.success !== undefined) {
        query += `\n  |> filter(fn: (r) => r.success == "${filters.success}")`;
      }

      // Pivot fields into columns so each row represents a single check result
      query += `\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;

      // Sort
      const direction = options.direction === 'ASC' ? 'asc' : 'desc';
      query += `\n  |> sort(columns: ["_time"], desc: ${direction === 'desc'})`;

      // Limit
      if (options.limit) {
        query += `\n  |> limit(n: ${options.limit})`;
      }

      const rows = await this.queryApi.collectRows(query);
      const checkResults = this.groupRowsToCheckResults(rows);

      logger.debug('Check results queried from InfluxDB:', {
        count: checkResults.length,
        filters,
      });

      return checkResults;
    } catch (error) {
      logger.error('Failed to query check results from InfluxDB:', {
        error,
        filters,
      });
      throw error;
    }
  }

  /**
   * Find check results for a specific monitor
   */
  async findByMonitor(
    monitorId: string,
    options: CheckResultQueryOptions & { startTime?: Date; endTime?: Date } = {}
  ): Promise<CheckResult[]> {
    const filters: CheckResultFilters = { monitorId };
    if (options.startTime) {
      filters.startTime = options.startTime;
    }
    if (options.endTime) {
      filters.endTime = options.endTime;
    }

    return this.findMany(filters, options);
  }

  /**
   * Find latest check result for a monitor
   */
  async findLatestByMonitor(monitorId: string, location?: ProbeLocation): Promise<CheckResult | null> {
    const filters: CheckResultFilters = { monitorId };
    if (location) {
      filters.location = location;
    }

    const results = await this.findMany(filters, { limit: 1, direction: 'DESC' });
    return results.length > 0 ? results[0]! : null;
  }

  /**
   * Get uptime statistics for a monitor
   */
  async getUptimeStats(
    monitorId: string,
    startTime: Date,
    endTime: Date,
    location?: ProbeLocation
  ): Promise<{
    totalChecks: number;
    successfulChecks: number;
    uptimePercentage: number;
    averageResponseTime: number;
  }> {
    try {
      let query = `from(bucket: "${this.bucket}")`;
      query += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;
      query += `\n  |> filter(fn: (r) => r._measurement == "${this.measurement}")`;
      query += `\n  |> filter(fn: (r) => r.monitor_id == "${monitorId}")`;

      if (location) {
        query += `\n  |> filter(fn: (r) => r.location == "${location}")`;
      }

      // Get total checks
      const totalQuery = query + `\n  |> filter(fn: (r) => r._field == "id")\n  |> count()`;
      const totalRows = await this.queryApi.collectRows(totalQuery) as Array<{ _value?: number }>;
      const totalChecks = totalRows.reduce((sum, row) => sum + Number(row?._value || 0), 0);

      // Get successful checks
      const successQuery = query + 
        `\n  |> filter(fn: (r) => r._field == "id" and r.success == "true")\n  |> count()`;
      const successRows = await this.queryApi.collectRows(successQuery) as Array<{ _value?: number }>;
      const successfulChecks = successRows.reduce((sum, row) => sum + Number(row?._value || 0), 0);

      // Get average response time
      const responseTimeQuery = query + 
        `\n  |> filter(fn: (r) => r._field == "response_time")\n  |> mean()`;
      const responseTimeRows = await this.queryApi.collectRows(responseTimeQuery);
      const averageResponseTime = responseTimeRows.length > 0 ? (responseTimeRows[0] as any)._value || 0 : 0;

      const uptimePercentage = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0;

      return {
        totalChecks,
        successfulChecks,
        uptimePercentage: Math.round(uptimePercentage * 100) / 100,
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
      };
    } catch (error) {
      logger.error('Failed to get uptime stats from InfluxDB:', {
        error,
        monitorId,
        startTime,
        endTime,
      });
      throw error;
    }
  }

  /**
   * Get response time statistics
   */
  async getResponseTimeStats(
    monitorId: string,
    startTime: Date,
    endTime: Date,
    location?: ProbeLocation
  ): Promise<{
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
  }> {
    try {
      let baseQuery = `from(bucket: "${this.bucket}")`;
      baseQuery += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;
      baseQuery += `\n  |> filter(fn: (r) => r._measurement == "${this.measurement}")`;
      baseQuery += `\n  |> filter(fn: (r) => r.monitor_id == "${monitorId}")`;
      baseQuery += `\n  |> filter(fn: (r) => r._field == "response_time")`;

      if (location) {
        baseQuery += `\n  |> filter(fn: (r) => r.location == "${location}")`;
      }

      // Get min, max, mean
      const statsQuery = baseQuery + `
        |> group()
        |> aggregateWindow(every: inf, fn: min, createEmpty: false)
        |> yield(name: "min")
        
        ${baseQuery}
        |> group()
        |> aggregateWindow(every: inf, fn: max, createEmpty: false)
        |> yield(name: "max")
        
        ${baseQuery}
        |> group()
        |> aggregateWindow(every: inf, fn: mean, createEmpty: false)
        |> yield(name: "mean")
      `;

      const statsRows = await this.queryApi.collectRows(statsQuery);
      
      // Get percentiles
      const percentilesQuery = baseQuery + `
        |> group()
        |> quantile(q: 0.5, method: "estimate_tdigest")
        |> yield(name: "median")
        
        ${baseQuery}
        |> group()
        |> quantile(q: 0.95, method: "estimate_tdigest")
        |> yield(name: "p95")
        
        ${baseQuery}
        |> group()
        |> quantile(q: 0.99, method: "estimate_tdigest")
        |> yield(name: "p99")
      `;

      const percentileRows = await this.queryApi.collectRows(percentilesQuery);

      // Parse results
      const stats = {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p95: 0,
        p99: 0,
      };

      [...statsRows, ...percentileRows].forEach((row: any) => {
        const result = row.result || row._result;
        const value = row._value || 0;
        
        if (result === 'min') stats.min = value;
        else if (result === 'max') stats.max = value;
        else if (result === 'mean') stats.mean = value;
        else if (result === 'median') stats.median = value;
        else if (result === 'p95') stats.p95 = value;
        else if (result === 'p99') stats.p99 = value;
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get response time stats from InfluxDB:', {
        error,
        monitorId,
        startTime,
        endTime,
      });
      throw error;
    }
  }

  /**
   * Get daily status summary for a monitor
   */
  async getDailyStatus(
    monitorId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{
    date: string;
    total: number;
    success: number;
    failure: number;
    status: 'up' | 'down' | 'degraded' | 'unknown';
  }>> {
    try {
      const baseQuery = `from(bucket: "${this.bucket}")
  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})
  |> filter(fn: (r) => r._measurement == "${this.measurement}")
  |> filter(fn: (r) => r.monitor_id == "${monitorId}")
  |> filter(fn: (r) => r._field == "id")`;

      const totalQuery = `${baseQuery}
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false)`;

      const successQuery = `${baseQuery}
  |> filter(fn: (r) => r.success == "true")
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false)`;

      const [totalRows, successRows] = await Promise.all([
        this.queryApi.collectRows(totalQuery) as Promise<Array<{ _time?: string; _value?: number }>>,
        this.queryApi.collectRows(successQuery) as Promise<Array<{ _time?: string; _value?: number }>>,
      ]);

      const totals = new Map<string, number>();
      totalRows.forEach(row => {
        if (row._time) {
          const key = row._time.slice(0, 10);
          totals.set(key, Number(row._value || 0));
        }
      });

      const successes = new Map<string, number>();
      successRows.forEach(row => {
        if (row._time) {
          const key = row._time.slice(0, 10);
          successes.set(key, Number(row._value || 0));
        }
      });

      const dates = new Set<string>([...totals.keys(), ...successes.keys()]);
      const result = Array.from(dates)
        .sort()
        .map(date => {
          const total = totals.get(date) || 0;
          const success = successes.get(date) || 0;
          const failure = Math.max(total - success, 0);

          let status: 'up' | 'down' | 'degraded' | 'unknown' = 'unknown';
          if (total === 0) {
            status = 'unknown';
          } else if (success === 0) {
            status = 'down';
          } else if (success === total) {
            status = 'up';
          } else {
            status = 'degraded';
          }

          return {
            date,
            total,
            success,
            failure,
            status,
          };
        });

      return result;
    } catch (error) {
      logger.error('Failed to get daily status from InfluxDB:', {
        error,
        monitorId,
        startTime,
        endTime,
      });
      throw error;
    }
  }

  /**
   * Store SSL certificate information separately
   */
  async storeSSLInfo(monitorId: string, sslInfo: import('../../types').SSLCertificateInfo): Promise<void> {
    try {
      const point = new Point('ssl_certificates')
        .tag('monitor_id', monitorId)
        .stringField('issuer', sslInfo.issuer)
        .stringField('subject', sslInfo.subject)
        .intField('days_until_expiry', sslInfo.daysUntilExpiry)
        .stringField('expiry_date', sslInfo.expiryDate.toISOString())
        .timestamp(new Date());

      this.writeApi.writePoint(point);
      await this.writeApi.flush();

      logger.debug('SSL certificate info written to InfluxDB:', {
        monitorId,
        expiryDate: sslInfo.expiryDate,
        daysUntilExpiry: sslInfo.daysUntilExpiry,
      });
    } catch (error) {
      logger.error('Failed to write SSL certificate info to InfluxDB:', {
        error,
        monitorId,
      });
      throw error;
    }
  }

  /**
   * Delete check results for a monitor
   */
  async deleteByMonitor(monitorId: string, startTime?: Date, endTime?: Date): Promise<void> {
    try {
      // Note: InfluxDB deletion is typically handled by retention policies
      // This is a placeholder for explicit deletion if needed
      logger.warn('Check result deletion not implemented - use retention policies instead', {
        monitorId,
        startTime,
        endTime,
      });
    } catch (error) {
      logger.error('Failed to delete check results from InfluxDB:', {
        error,
        monitorId,
      });
      throw error;
    }
  }

  /**
   * Group InfluxDB rows into CheckResult objects
   */
  private groupRowsToCheckResults(rows: any[]): CheckResult[] {
    return rows
      .map(row => {
        if (!row.id) return null;

        const successValue = row.success;
        const success = successValue === true || successValue === 'true';

        return {
          id: row.id,
          monitorId: row.monitor_id,
          location: row.location as ProbeLocation,
          timestamp: new Date(row._time),
          success,
          responseTime: row.response_time !== undefined ? Number(row.response_time) : undefined,
          statusCode: row.status_code !== undefined ? Number(row.status_code) : undefined,
          errorMessage: row.error_message || undefined,
          sslExpiryDate: row.ssl_expiry_date ? new Date(row.ssl_expiry_date) : undefined,
        } as CheckResult;
      })
      .filter((row): row is CheckResult => row !== null);
  }

  /**
   * Health check for InfluxDB connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.queryApi.collectRows(`buckets() |> limit(1)`);
      return true;
    } catch (error) {
      logger.error('InfluxDB health check failed:', error);
      return false;
    }
  }
}
