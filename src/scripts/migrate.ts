#!/usr/bin/env ts-node

/**
 * Database Migration CLI Tool
 * Command-line interface for running database migrations
 */

import { program } from 'commander';
import { getConfig } from '../config';
import { createDatabaseManager, DatabaseMigrator } from '../database';
import { logger } from '../utils/logger';

async function runMigrations(): Promise<void> {
  const config = getConfig();
  const dbManager = createDatabaseManager(config.database);
  
  try {
    await dbManager.initialize();
    logger.info('Database connections initialized');
    
    const migrator = new DatabaseMigrator();
    const results = await migrator.migrate();
    
    console.log('\n=== Migration Results ===');
    for (const result of results) {
      const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
      console.log(`${status} ${result.version} (${result.executionTime}ms)`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
    
    if (results.every(r => r.success)) {
      console.log('\n🎉 All migrations completed successfully!');
    } else {
      console.log('\n⚠️  Some migrations failed. Check the logs for details.');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Migration failed:', error);
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await dbManager.close();
  }
}

async function showStatus(): Promise<void> {
  const config = getConfig();
  const dbManager = createDatabaseManager(config.database);
  
  try {
    await dbManager.initialize();
    
    const migrator = new DatabaseMigrator();
    const status = await migrator.getStatus();
    
    console.log('\n=== Migration Status ===');
    console.log(`Total migrations: ${status.totalMigrations}`);
    console.log(`Applied: ${status.appliedMigrations.length}`);
    console.log(`Pending: ${status.pendingMigrations.length}`);
    
    if (status.appliedMigrations.length > 0) {
      console.log('\nApplied migrations:');
      status.appliedMigrations.forEach(version => {
        console.log(`  ✅ ${version}`);
      });
    }
    
    if (status.pendingMigrations.length > 0) {
      console.log('\nPending migrations:');
      status.pendingMigrations.forEach(version => {
        console.log(`  ⏳ ${version}`);
      });
    }
  } catch (error) {
    logger.error('Failed to get migration status:', error);
    console.error('❌ Failed to get migration status:', error);
    process.exit(1);
  } finally {
    await dbManager.close();
  }
}

async function createMigration(name: string, description: string): Promise<void> {
  try {
    const migrator = new DatabaseMigrator();
    const filePath = await migrator.createMigration(name, description);
    
    console.log(`✅ Created migration file: ${filePath}`);
    console.log('Edit the file to add your SQL statements.');
  } catch (error) {
    logger.error('Failed to create migration:', error);
    console.error('❌ Failed to create migration:', error);
    process.exit(1);
  }
}

async function healthCheck(): Promise<void> {
  const config = getConfig();
  const dbManager = createDatabaseManager(config.database);
  
  try {
    await dbManager.initialize();
    const health = await dbManager.healthCheck();
    
    console.log('\n=== Database Health Check ===');
    console.log(`PostgreSQL: ${health.postgresql ? '✅ Connected' : '❌ Failed'}`);
    console.log(`InfluxDB: ${health.influxdb ? '✅ Connected' : '❌ Failed'}`);
    console.log(`Redis: ${health.redis ? '✅ Connected' : '❌ Failed'}`);
    
    const allHealthy = health.postgresql && health.influxdb && health.redis;
    if (allHealthy) {
      console.log('\n🎉 All databases are healthy!');
    } else {
      console.log('\n⚠️  Some databases are not responding.');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Health check failed:', error);
    console.error('❌ Health check failed:', error);
    process.exit(1);
  } finally {
    await dbManager.close();
  }
}

// CLI Program setup
program
  .name('migrate')
  .description('Database migration tool for URL Monitoring Application')
  .version('1.0.0');

program
  .command('up')
  .description('Run all pending migrations')
  .action(runMigrations);

program
  .command('status')
  .description('Show migration status')
  .action(showStatus);

program
  .command('create')
  .description('Create a new migration file')
  .argument('<name>', 'Migration name (e.g., add_user_table)')
  .argument('<description>', 'Migration description')
  .action(createMigration);

program
  .command('health')
  .description('Check database connectivity')
  .action(healthCheck);

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}