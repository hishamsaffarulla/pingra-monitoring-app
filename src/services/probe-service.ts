/**
 * Probe Service Implementation
 * Executes HTTP/HTTPS checks from multiple geographic locations
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import * as https from 'https';
import * as tls from 'tls';
import { CheckResult, Monitor, ProbeLocation, SSLCertificateInfo } from '../types';
import { CheckResultRepository } from '../database/repositories/check-result-repository';
import { RedisSetup } from '../database/redis-setup';
import { logger } from '../utils/logger';

export interface ProbeServiceConfig {
  defaultTimeout: number;
  maxConcurrentChecks: number;
  userAgent: string;
  followRedirects: boolean;
  maxRedirects: number;
}

export interface ProbeService {
  executeCheck(monitor: Monitor, location: ProbeLocation): Promise<CheckResult>;
  executeMultiLocationCheck(monitor: Monitor): Promise<CheckResult[]>;
  getAggregatedStatus(monitor: Monitor): Promise<{ isHealthy: boolean; healthyLocations: ProbeLocation[]; failedLocations: ProbeLocation[] }>;
  validateSSLCertificate(url: string): Promise<SSLCertificateInfo>;
  getAvailableLocations(): ProbeLocation[];
}

export class ProbeServiceImpl implements ProbeService {
  private httpClient: AxiosInstance;
  private checkResultRepository: CheckResultRepository;
  private redisSetup: RedisSetup | null;

  constructor(
    config: ProbeServiceConfig,
    checkResultRepository: CheckResultRepository,
    redisSetup?: RedisSetup
  ) {
    this.checkResultRepository = checkResultRepository;
    this.redisSetup = redisSetup || null;
    
    // Configure HTTP client
    this.httpClient = axios.create({
      timeout: config.defaultTimeout * 1000, // Convert to milliseconds
      maxRedirects: config.followRedirects ? config.maxRedirects : 0,
      validateStatus: () => true, // Don't throw on any status code
      headers: {
        'User-Agent': config.userAgent
      },
      // Custom HTTPS agent to capture SSL certificate info
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, // We'll handle SSL validation ourselves
        checkServerIdentity: () => undefined // Disable hostname verification for monitoring
      })
    });
  }

  /**
   * Execute a check for a monitor from a specific location
   */
  async executeCheck(monitor: Monitor, location: ProbeLocation): Promise<CheckResult> {
    const startTime = Date.now();
    const timestamp = new Date();
    
    try {
      logger.debug(`Executing check for monitor ${monitor.id} from ${location}`);
      
      // Perform HTTP request with timeout
      const response = await this.performHttpRequest(monitor);
      const responseTime = Date.now() - startTime;
      
      // Validate response
      const success = this.validateResponse(response, monitor.expectedStatusCodes);
      
      // Extract SSL certificate info for HTTPS URLs
      let sslInfo: SSLCertificateInfo | undefined;
      if (monitor.url.startsWith('https://')) {
        try {
          sslInfo = await this.validateSSLCertificate(monitor.url);
        } catch (sslError) {
          logger.warn(`SSL validation failed for ${monitor.url}:`, sslError);
        }
      }

      const checkResult: CheckResult = {
        id: this.generateCheckId(),
        monitorId: monitor.id,
        location,
        timestamp,
        success,
        responseTime,
        statusCode: response.status,
        ...(success ? {} : { errorMessage: `Unexpected status code: ${response.status}` }),
        ...(sslInfo?.expiryDate ? { sslExpiryDate: sslInfo.expiryDate } : {})
      };

      // Store result in InfluxDB
      await this.storeCheckResult(checkResult, sslInfo);
      
      logger.debug(`Check completed for monitor ${monitor.id} from ${location}: ${success ? 'SUCCESS' : 'FAILURE'}`);
      return checkResult;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = this.extractErrorMessage(error);
      
      const checkResult: CheckResult = {
        id: this.generateCheckId(),
        monitorId: monitor.id,
        location,
        timestamp,
        success: false,
        responseTime,
        errorMessage,
        ...(this.extractStatusCode(error) ? { statusCode: this.extractStatusCode(error)! } : {})
      };

      // Store failed result
      await this.storeCheckResult(checkResult);
      
      logger.debug(`Check failed for monitor ${monitor.id} from ${location}: ${errorMessage}`);
      return checkResult;
    }
  }

  /**
   * Execute checks from all configured locations for a monitor
   */
  async executeMultiLocationCheck(monitor: Monitor): Promise<CheckResult[]> {
    const promises = monitor.probeLocations.map(location => 
      this.executeCheck(monitor, location)
    );

    try {
      const results = await Promise.all(promises);
      
      // Cache the aggregated status for quick access
      await this.cacheAggregatedStatus(monitor, results);
      
      logger.info(`Multi-location check completed for monitor ${monitor.id}: ${results.length} locations`);
      return results;
    } catch (error) {
      logger.error(`Multi-location check failed for monitor ${monitor.id}:`, error);
      throw error;
    }
  }

  /**
   * Get aggregated status across all locations for a monitor
   * Uses Redis caching for performance
   */
  async getAggregatedStatus(monitor: Monitor): Promise<{
    isHealthy: boolean;
    healthyLocations: ProbeLocation[];
    failedLocations: ProbeLocation[];
  }> {
    const cacheKey = `monitor-status:${monitor.id}`;
    
    // Try to get from cache first
    if (this.redisSetup) {
      try {
        const cachedStatus = await this.redisSetup.getCache(cacheKey);
        if (cachedStatus) {
          logger.debug(`Retrieved cached status for monitor ${monitor.id}`);
          return cachedStatus;
        }
      } catch (error) {
        logger.warn(`Failed to retrieve cached status for monitor ${monitor.id}:`, error);
      }
    }

    // If not in cache, execute checks and compute status
    const results = await this.executeMultiLocationCheck(monitor);
    return this.computeAggregatedStatus(results);
  }

  /**
   * Validate SSL certificate for HTTPS URLs
   */
  async validateSSLCertificate(url: string): Promise<SSLCertificateInfo> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const port = urlObj.port ? parseInt(urlObj.port) : 443;
      
      const socket = tls.connect({
        host: urlObj.hostname,
        port,
        servername: urlObj.hostname,
        rejectUnauthorized: false // We want to get cert info even for invalid certs
      }, () => {
        const cert = socket.getPeerCertificate();
        
        if (!cert || Object.keys(cert).length === 0) {
          socket.destroy();
          reject(new Error('No certificate found'));
          return;
        }

        const expiryDate = new Date(cert.valid_to);
        const now = new Date();
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        const sslInfo: SSLCertificateInfo = {
          expiryDate,
          issuer: cert.issuer?.CN || 'Unknown',
          subject: cert.subject?.CN || 'Unknown',
          daysUntilExpiry
        };

        socket.destroy();
        resolve(sslInfo);
      });

      socket.on('error', (error) => {
        socket.destroy();
        reject(error);
      });

      // Timeout after 10 seconds
      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error('SSL certificate validation timeout'));
      });
    });
  }

  /**
   * Get available probe locations
   */
  getAvailableLocations(): ProbeLocation[] {
    return [
      ProbeLocation.US_EAST,
      ProbeLocation.EU_WEST,
      ProbeLocation.ME_CENTRAL,
      ProbeLocation.IN_MUMBAI,
      ProbeLocation.IN_HYDERABAD
    ];
  }

  /**
   * Perform HTTP request with proper timeout handling
   */
  private async performHttpRequest(monitor: Monitor): Promise<AxiosResponse> {
    const requestConfig = {
      timeout: monitor.timeoutSeconds * 1000,
      method: 'GET' as const,
      url: monitor.url
    };

    return await this.httpClient.request(requestConfig);
  }

  /**
   * Validate HTTP response against expected status codes
   */
  private validateResponse(response: AxiosResponse, expectedStatusCodes: number[]): boolean {
    return expectedStatusCodes.includes(response.status);
  }

  /**
   * Store check result in InfluxDB
   */
  private async storeCheckResult(checkResult: CheckResult, sslInfo?: SSLCertificateInfo): Promise<void> {
    try {
      await this.checkResultRepository.create(checkResult);
      
      // Store SSL info separately if available
      if (sslInfo) {
        await this.checkResultRepository.storeSSLInfo(checkResult.monitorId, sslInfo);
      }

      if (this.redisSetup) {
        await this.redisSetup.publish('check-results', {
          monitorId: checkResult.monitorId,
          location: checkResult.location,
          success: checkResult.success,
          statusCode: checkResult.statusCode,
          errorMessage: checkResult.errorMessage,
          timestamp: checkResult.timestamp.toISOString(),
        });
      }
    } catch (error) {
      logger.error(`Failed to store check result for monitor ${checkResult.monitorId}:`, error);
      // Don't throw - we don't want storage failures to affect check execution
    }
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === 'ECONNABORTED') {
        return 'Request timeout';
      }
      
      if (axiosError.code === 'ENOTFOUND') {
        return 'DNS resolution failed';
      }
      
      if (axiosError.code === 'ECONNREFUSED') {
        return 'Connection refused';
      }
      
      if (axiosError.code === 'ECONNRESET') {
        return 'Connection reset';
      }
      
      if (axiosError.response) {
        return `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`;
      }
      
      return axiosError.message || 'Network error';
    }
    
    if (error instanceof Error) {
      return error.message;
    }
    
    return 'Unknown error';
  }

  /**
   * Extract status code from error if available
   */
  private extractStatusCode(error: any): number | undefined {
    if (axios.isAxiosError(error) && error.response) {
      return error.response.status;
    }
    return undefined;
  }

  /**
   * Generate unique check ID
   */
  private generateCheckId(): string {
    return `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cache aggregated status for a monitor
   */
  private async cacheAggregatedStatus(monitor: Monitor, results: CheckResult[]): Promise<void> {
    if (!this.redisSetup) {
      return;
    }

    try {
      const aggregatedStatus = this.computeAggregatedStatus(results);
      const cacheKey = `monitor-status:${monitor.id}`;
      
      // Cache for 5 minutes (300 seconds)
      await this.redisSetup.setCache(cacheKey, aggregatedStatus, 300);
      
      logger.debug(`Cached aggregated status for monitor ${monitor.id}`);
    } catch (error) {
      logger.warn(`Failed to cache aggregated status for monitor ${monitor.id}:`, error);
    }
  }

  /**
   * Compute aggregated status from check results
   * A monitor is healthy only when ALL configured locations report success
   */
  private computeAggregatedStatus(results: CheckResult[]): {
    isHealthy: boolean;
    healthyLocations: ProbeLocation[];
    failedLocations: ProbeLocation[];
  } {
    const healthyLocations: ProbeLocation[] = [];
    const failedLocations: ProbeLocation[] = [];

    results.forEach(result => {
      if (result.success) {
        healthyLocations.push(result.location);
      } else {
        failedLocations.push(result.location);
      }
    });

    // Strict mode: any failed location means monitor is down
    const isHealthy = failedLocations.length === 0 && healthyLocations.length > 0;

    return {
      isHealthy,
      healthyLocations,
      failedLocations
    };
  }
}

/**
 * Factory function to create probe service
 */
export function createProbeService(
  config: ProbeServiceConfig,
  checkResultRepository: CheckResultRepository,
  redisSetup?: RedisSetup
): ProbeService {
  return new ProbeServiceImpl(config, checkResultRepository, redisSetup);
}
