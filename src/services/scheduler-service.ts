/**
 * Scheduler Service Implementation
 * Manages check scheduling with in-memory schedule management and Redis persistence
 */

import * as cron from 'node-cron';
import { CheckInterval, ScheduledCheck } from '../types';
import { RedisSetup } from '../database/redis-setup';
import { logger } from '../utils/logger';

export interface SchedulerServiceConfig {
  enablePersistence: boolean;
  maxConcurrentChecks: number;
  checkOverlapTimeoutMs: number;
}

export interface SchedulerService {
  scheduleCheck(monitorId: string, interval: CheckInterval): void;
  cancelCheck(monitorId: string): void;
  getScheduledChecks(): ScheduledCheck[];
  updateSchedule(monitorId: string, interval: CheckInterval): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  restoreSchedules(): Promise<void>;
}

export class SchedulerServiceImpl implements SchedulerService {
  private schedules: Map<string, {
    task: cron.ScheduledTask;
    scheduledCheck: ScheduledCheck;
    isRunning: boolean;
  }> = new Map();
  
  private redisSetup: RedisSetup | null = null;
  private config: SchedulerServiceConfig;
  private onCheckTrigger: (monitorId: string) => Promise<void>;
  private isStarted: boolean = false;
  private runningChecks: Set<string> = new Set();

  constructor(
    config: SchedulerServiceConfig,
    onCheckTrigger: (monitorId: string) => Promise<void>,
    redisSetup?: RedisSetup
  ) {
    this.config = config;
    this.onCheckTrigger = onCheckTrigger;
    this.redisSetup = redisSetup || null;
  }

  /**
   * Start the scheduler service
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      logger.warn('Scheduler service is already started');
      return;
    }

    try {
      this.isStarted = true;

      // Restore schedules from Redis if persistence is enabled
      if (this.config.enablePersistence && this.redisSetup) {
        await this.restoreSchedules();
      }

      logger.info('Scheduler service started successfully');
    } catch (error) {
      this.isStarted = false;
      logger.error('Failed to start scheduler service:', error);
      throw error;
    }
  }

  /**
   * Stop the scheduler service
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      // Cancel all scheduled tasks
      for (const [monitorId] of this.schedules) {
        this.cancelCheck(monitorId);
      }

      // Wait for running checks to complete (with timeout)
      const timeout = this.config.checkOverlapTimeoutMs;
      const startTime = Date.now();
      
      while (this.runningChecks.size > 0 && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.runningChecks.size > 0) {
        logger.warn(`Scheduler stopped with ${this.runningChecks.size} checks still running`);
      }

      this.isStarted = false;
      logger.info('Scheduler service stopped successfully');
    } catch (error) {
      logger.error('Error stopping scheduler service:', error);
      throw error;
    }
  }

  /**
   * Schedule a check for a monitor
   */
  scheduleCheck(monitorId: string, interval: CheckInterval): void {
    if (!this.isStarted) {
      throw new Error('Scheduler service is not started');
    }

    // Cancel existing schedule if it exists
    this.cancelCheck(monitorId);

    const cronExpression = this.intervalToCronExpression(interval);
    const nextRunTime = this.calculateNextRunTime(interval);

    const task = cron.schedule(cronExpression, async () => {
      await this.executeCheck(monitorId);
    }, {
      scheduled: false, // Don't start immediately
      timezone: 'UTC'
    });

    const scheduledCheck: ScheduledCheck = {
      monitorId,
      nextRunTime,
      interval
    };

    this.schedules.set(monitorId, {
      task,
      scheduledCheck,
      isRunning: false
    });

    // Start the task
    task.start();

    // Persist to Redis if enabled
    if (this.config.enablePersistence && this.redisSetup) {
      this.persistSchedule(monitorId, scheduledCheck).catch(error => {
        logger.error(`Failed to persist schedule for monitor ${monitorId}:`, error);
      });
    }

    logger.info(`Scheduled check for monitor ${monitorId} with ${interval}s interval`);
  }

  /**
   * Cancel a scheduled check
   */
  cancelCheck(monitorId: string): void {
    const schedule = this.schedules.get(monitorId);
    if (schedule) {
      schedule.task.stop();
      this.schedules.delete(monitorId);

      // Remove from Redis if persistence is enabled
      if (this.config.enablePersistence && this.redisSetup) {
        this.redisSetup.deleteSchedule(monitorId).catch(error => {
          logger.error(`Failed to delete schedule from Redis for monitor ${monitorId}:`, error);
        });
      }

      logger.info(`Cancelled check schedule for monitor ${monitorId}`);
    }
  }

  /**
   * Update an existing schedule
   */
  updateSchedule(monitorId: string, interval: CheckInterval): void {
    const existingSchedule = this.schedules.get(monitorId);
    if (existingSchedule && existingSchedule.scheduledCheck.interval === interval) {
      // No change needed
      return;
    }

    // Reschedule with new interval
    this.scheduleCheck(monitorId, interval);
    logger.info(`Updated schedule for monitor ${monitorId} to ${interval}s interval`);
  }

  /**
   * Get all currently scheduled checks
   */
  getScheduledChecks(): ScheduledCheck[] {
    return Array.from(this.schedules.values()).map(schedule => ({
      ...schedule.scheduledCheck,
      nextRunTime: this.calculateNextRunTime(schedule.scheduledCheck.interval)
    }));
  }

  /**
   * Restore schedules from Redis
   */
  async restoreSchedules(): Promise<void> {
    if (!this.redisSetup) {
      logger.warn('Cannot restore schedules: Redis setup not available');
      return;
    }

    try {
      const schedules = await this.redisSetup.getAllSchedules();
      let restoredCount = 0;

      for (const [monitorId, scheduleData] of Object.entries(schedules)) {
        try {
          const interval = scheduleData.interval as CheckInterval;
          if (this.isValidInterval(interval)) {
            this.scheduleCheck(monitorId, interval);
            restoredCount++;
          } else {
            logger.warn(`Invalid interval for monitor ${monitorId}: ${interval}`);
          }
        } catch (error) {
          logger.error(`Failed to restore schedule for monitor ${monitorId}:`, error);
        }
      }

      logger.info(`Restored ${restoredCount} schedules from Redis`);
    } catch (error) {
      logger.error('Failed to restore schedules from Redis:', error);
      throw error;
    }
  }

  /**
   * Execute a check for a monitor
   */
  private async executeCheck(monitorId: string): Promise<void> {
    const schedule = this.schedules.get(monitorId);
    if (!schedule) {
      logger.warn(`No schedule found for monitor ${monitorId}`);
      return;
    }

    // Check for overlapping executions
    if (this.runningChecks.has(monitorId)) {
      logger.warn(`Check for monitor ${monitorId} is already running, skipping`);
      return;
    }

    // Check concurrent check limit
    if (this.runningChecks.size >= this.config.maxConcurrentChecks) {
      logger.warn(`Maximum concurrent checks (${this.config.maxConcurrentChecks}) reached, skipping check for monitor ${monitorId}`);
      return;
    }

    this.runningChecks.add(monitorId);
    schedule.isRunning = true;

    try {
      logger.debug(`Executing check for monitor ${monitorId}`);
      await this.onCheckTrigger(monitorId);
      
      // Update next run time
      schedule.scheduledCheck.nextRunTime = this.calculateNextRunTime(schedule.scheduledCheck.interval);
      
      logger.debug(`Check completed for monitor ${monitorId}`);
    } catch (error) {
      logger.error(`Check execution failed for monitor ${monitorId}:`, error);
    } finally {
      this.runningChecks.delete(monitorId);
      schedule.isRunning = false;
    }
  }

  /**
   * Persist schedule to Redis
   */
  private async persistSchedule(monitorId: string, scheduledCheck: ScheduledCheck): Promise<void> {
    if (!this.redisSetup) {
      return;
    }

    try {
      await this.redisSetup.setSchedule(monitorId, {
        interval: scheduledCheck.interval,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Failed to persist schedule for monitor ${monitorId}:`, error);
    }
  }

  /**
   * Convert CheckInterval to cron expression
   */
  private intervalToCronExpression(interval: CheckInterval): string {
    switch (interval) {
      case CheckInterval.ONE_MINUTE:
        return '* * * * *'; // Every minute
      case CheckInterval.FIVE_MINUTES:
        return '*/5 * * * *'; // Every 5 minutes
      default:
        throw new Error(`Unsupported check interval: ${interval}`);
    }
  }

  /**
   * Calculate next run time based on interval
   */
  private calculateNextRunTime(interval: CheckInterval): Date {
    const now = new Date();
    const nextRun = new Date(now);

    switch (interval) {
      case CheckInterval.ONE_MINUTE:
        nextRun.setMinutes(now.getMinutes() + 1, 0, 0);
        break;
      case CheckInterval.FIVE_MINUTES:
        const currentMinute = now.getMinutes();
        const nextFiveMinuteSlot = Math.ceil((currentMinute + 1) / 5) * 5;
        nextRun.setMinutes(nextFiveMinuteSlot, 0, 0);
        break;
      default:
        throw new Error(`Unsupported check interval: ${interval}`);
    }

    return nextRun;
  }

  /**
   * Validate if interval is supported
   */
  private isValidInterval(interval: CheckInterval): boolean {
    return interval === CheckInterval.ONE_MINUTE || interval === CheckInterval.FIVE_MINUTES;
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    totalScheduled: number;
    runningChecks: number;
    isStarted: boolean;
  } {
    return {
      totalScheduled: this.schedules.size,
      runningChecks: this.runningChecks.size,
      isStarted: this.isStarted
    };
  }
}

/**
 * Factory function to create scheduler service
 */
export function createSchedulerService(
  config: SchedulerServiceConfig,
  onCheckTrigger: (monitorId: string) => Promise<void>,
  redisSetup?: RedisSetup
): SchedulerService {
  return new SchedulerServiceImpl(config, onCheckTrigger, redisSetup);
}
