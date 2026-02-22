-- Partitions and indexes migration for URL Monitoring Application
-- Migration: 002_partitions_and_indexes
-- Description: Create table partitions and performance indexes

-- Create initial partitions for check_results (current and next month)
DO $$
DECLARE
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  -- Current month partition
  start_date := date_trunc('month', CURRENT_DATE);
  end_date := start_date + interval '1 month';
  partition_name := 'check_results_' || to_char(start_date, 'YYYY_MM');
  
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF check_results FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date);
  
  -- Next month partition
  start_date := date_trunc('month', CURRENT_DATE + interval '1 month');
  end_date := start_date + interval '1 month';
  partition_name := 'check_results_' || to_char(start_date, 'YYYY_MM');
  
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF check_results FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date);
END $$;

-- Performance indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time 
ON check_results (monitor_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_check_results_location_time 
ON check_results (location, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_check_results_success_time 
ON check_results (success, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_check_results_timestamp 
ON check_results (timestamp DESC);

-- Indexes for alerts table
CREATE INDEX IF NOT EXISTS idx_alerts_monitor_triggered 
ON alerts (monitor_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_type_triggered 
ON alerts (alert_type, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved 
ON alerts (resolved_at) WHERE resolved_at IS NULL;

-- Indexes for monitors table
CREATE INDEX IF NOT EXISTS idx_monitors_tenant 
ON monitors (tenant_id);

CREATE INDEX IF NOT EXISTS idx_monitors_enabled 
ON monitors (enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_monitors_interval 
ON monitors (check_interval);

-- Indexes for notification_channels table
CREATE INDEX IF NOT EXISTS idx_notification_channels_tenant 
ON notification_channels (tenant_id);

CREATE INDEX IF NOT EXISTS idx_notification_channels_type 
ON notification_channels (type);

CREATE INDEX IF NOT EXISTS idx_notification_channels_enabled 
ON notification_channels (enabled) WHERE enabled = true;

-- Function to automatically create monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  start_date := date_trunc('month', CURRENT_DATE + interval '1 month');
  end_date := start_date + interval '1 month';
  partition_name := 'check_results_' || to_char(start_date, 'YYYY_MM');
  
  -- Check if partition already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = partition_name
  ) THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF check_results FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_date, end_date);
    
    RAISE NOTICE 'Created partition: %', partition_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions (older than 90 days)
CREATE OR REPLACE FUNCTION drop_old_partitions()
RETURNS void AS $$
DECLARE
  partition_record RECORD;
  cutoff_date DATE;
BEGIN
  cutoff_date := CURRENT_DATE - interval '90 days';
  
  FOR partition_record IN
    SELECT schemaname, tablename 
    FROM pg_tables 
    WHERE tablename LIKE 'check_results_%'
    AND tablename ~ '^check_results_\d{4}_\d{2}$'
  LOOP
    -- Extract date from partition name and check if it's old enough
    DECLARE
      partition_date DATE;
      year_month TEXT;
    BEGIN
      year_month := substring(partition_record.tablename from 'check_results_(\d{4}_\d{2})');
      partition_date := to_date(year_month, 'YYYY_MM');
      
      IF partition_date < cutoff_date THEN
        EXECUTE format('DROP TABLE IF EXISTS %I.%I', 
          partition_record.schemaname, partition_record.tablename);
        RAISE NOTICE 'Dropped old partition: %', partition_record.tablename;
      END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Insert migration record
INSERT INTO schema_migrations (version, description) 
VALUES ('002_partitions_and_indexes', 'Create table partitions and performance indexes')
ON CONFLICT (version) DO NOTHING;