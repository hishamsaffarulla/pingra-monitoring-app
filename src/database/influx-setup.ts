/**
 * InfluxDB Setup and Configuration
 * Handles bucket creation, retention policies, and schema setup
 */

import { InfluxDB } from '@influxdata/influxdb-client';
import { OrgsAPI, BucketsAPI, DeleteAPI } from '@influxdata/influxdb-client-apis';
import { getDatabaseManager } from './connection';
import { logger } from '../utils/logger';

export interface InfluxDBSetupConfig {
  org: string;
  bucket: string;
  retentionPeriod: number; // in seconds (default: 90 days)
  description?: string;
}

export class InfluxDBSetup {
  private influxDB: InfluxDB;
  private config: InfluxDBSetupConfig;

  constructor(influxDB: InfluxDB, config: InfluxDBSetupConfig) {
    this.influxDB = influxDB;
    this.config = config;
  }

  /**
   * Initialize InfluxDB setup - create organization and bucket if needed
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureOrganization();
      await this.ensureBucket();
      await this.setupRetentionPolicy();
      
      logger.info('InfluxDB setup completed successfully');
    } catch (error) {
      logger.error('Failed to initialize InfluxDB setup:', error);
      throw error;
    }
  }

  /**
   * Ensure organization exists
   */
  private async ensureOrganization(): Promise<void> {
    const orgsAPI = new OrgsAPI(this.influxDB);
    
    try {
      const orgs = await orgsAPI.getOrgs({ org: this.config.org });
      
      if (orgs.orgs && orgs.orgs.length > 0) {
        logger.info(`Organization '${this.config.org}' already exists`);
        return;
      }
      
      // Create organization if it doesn't exist
      await orgsAPI.postOrgs({
        body: {
          name: this.config.org,
          description: 'URL Monitoring Application Organization',
        },
      });
      
      logger.info(`Created organization: ${this.config.org}`);
    } catch (error) {
      // Organization might already exist, log and continue
      logger.warn(`Could not verify/create organization '${this.config.org}':`, error);
    }
  }

  /**
   * Ensure bucket exists with proper retention policy
   */
  private async ensureBucket(): Promise<void> {
    const bucketsAPI = new BucketsAPI(this.influxDB);
    
    try {
      const buckets = await bucketsAPI.getBuckets({ 
        org: this.config.org,
        name: this.config.bucket,
      });
      
      if (buckets.buckets && buckets.buckets.length > 0) {
        logger.info(`Bucket '${this.config.bucket}' already exists`);
        return;
      }
      
      // Create bucket with retention policy
      await bucketsAPI.postBuckets({
        body: {
          name: this.config.bucket,
          orgID: await this.getOrgId(),
          description: this.config.description || 'URL monitoring check results and metrics',
          retentionRules: [
            {
              type: 'expire',
              everySeconds: this.config.retentionPeriod,
            },
          ],
        },
      });
      
      logger.info(`Created bucket: ${this.config.bucket} with ${this.config.retentionPeriod}s retention`);
    } catch (error) {
      logger.error(`Failed to create bucket '${this.config.bucket}':`, error);
      throw error;
    }
  }

  /**
   * Setup retention policy for existing bucket
   */
  private async setupRetentionPolicy(): Promise<void> {
    const bucketsAPI = new BucketsAPI(this.influxDB);
    
    try {
      const buckets = await bucketsAPI.getBuckets({ 
        org: this.config.org,
        name: this.config.bucket,
      });
      
      if (!buckets.buckets || buckets.buckets.length === 0) {
        throw new Error(`Bucket '${this.config.bucket}' not found`);
      }
      
      const bucket = buckets.buckets[0];
      
      // Update retention policy if needed
      if (bucket?.id) {
        await bucketsAPI.patchBucketsID({
          bucketID: bucket.id,
          body: {
            retentionRules: [
              {
                type: 'expire',
                everySeconds: this.config.retentionPeriod,
              },
            ],
          },
        });
        
        logger.info(`Updated retention policy for bucket: ${this.config.bucket}`);
      }
    } catch (error) {
      logger.error('Failed to setup retention policy:', error);
      throw error;
    }
  }

  /**
   * Get organization ID
   */
  private async getOrgId(): Promise<string> {
    const orgsAPI = new OrgsAPI(this.influxDB);
    const orgs = await orgsAPI.getOrgs({ org: this.config.org });
    
    if (!orgs.orgs || orgs.orgs.length === 0) {
      throw new Error(`Organization '${this.config.org}' not found`);
    }
    
    const orgId = orgs.orgs[0]?.id;
    if (!orgId) {
      throw new Error(`Organization '${this.config.org}' has no ID`);
    }
    
    return orgId;
  }

  /**
   * Clean up old data beyond retention period
   */
  async cleanupOldData(): Promise<void> {
    const deleteAPI = new DeleteAPI(this.influxDB);
    
    const cutoffTime = new Date();
    cutoffTime.setSeconds(cutoffTime.getSeconds() - this.config.retentionPeriod);
    
    try {
      await deleteAPI.postDelete({
        body: {
          start: '1970-01-01T00:00:00Z',
          stop: cutoffTime.toISOString(),
          predicate: '_measurement="check_results"',
        },
        org: this.config.org,
        bucket: this.config.bucket,
      });
      
      logger.info(`Cleaned up data older than ${cutoffTime.toISOString()}`);
    } catch (error) {
      logger.error('Failed to cleanup old data:', error);
      throw error;
    }
  }

  /**
   * Get bucket statistics
   */
  async getBucketStats(): Promise<{
    name: string;
    retentionPeriod: number;
    dataPoints: number;
    oldestRecord?: Date;
    newestRecord?: Date;
  }> {
    const dbManager = getDatabaseManager();
    const queryApi = dbManager.getInfluxQueryApi();
    
    try {
      // Get data point count
      const countQuery = `
        from(bucket: "${this.config.bucket}")
          |> range(start: -90d)
          |> count()
          |> group()
          |> sum()
      `;
      
      const countResult = await queryApi.collectRows(countQuery);
      const dataPoints = countResult.length > 0 ? (countResult[0] as any)._value || 0 : 0;
      
      // Get oldest and newest records
      const rangeQuery = `
        from(bucket: "${this.config.bucket}")
          |> range(start: -90d)
          |> group()
          |> min(column: "_time")
      `;
      
      const rangeResult = await queryApi.collectRows(rangeQuery);
      const oldestRecord = rangeResult.length > 0 ? new Date((rangeResult[0] as any)._time) : undefined;
      
      const newestQuery = `
        from(bucket: "${this.config.bucket}")
          |> range(start: -90d)
          |> group()
          |> max(column: "_time")
      `;
      
      const newestResult = await queryApi.collectRows(newestQuery);
      const newestRecord = newestResult.length > 0 ? new Date((newestResult[0] as any)._time) : undefined;
      
      const result: {
        name: string;
        retentionPeriod: number;
        dataPoints: number;
        oldestRecord?: Date;
        newestRecord?: Date;
      } = {
        name: this.config.bucket,
        retentionPeriod: this.config.retentionPeriod,
        dataPoints,
      };

      if (oldestRecord) {
        result.oldestRecord = oldestRecord;
      }

      if (newestRecord) {
        result.newestRecord = newestRecord;
      }

      return result;
    } catch (error) {
      logger.error('Failed to get bucket statistics:', error);
      throw error;
    }
  }
}

/**
 * Create and initialize InfluxDB setup
 */
export async function setupInfluxDB(config: InfluxDBSetupConfig): Promise<InfluxDBSetup> {
  const influxDB = new InfluxDB({
    url: process.env['INFLUXDB_URL'] || 'http://localhost:8086',
    token: process.env['INFLUXDB_TOKEN'] || '',
  });
  
  const setup = new InfluxDBSetup(influxDB, config);
  await setup.initialize();
  
  return setup;
}