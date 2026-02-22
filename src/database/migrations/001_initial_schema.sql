-- Initial schema migration for URL Monitoring Application
-- Migration: 001_initial_schema
-- Description: Create core tables for tenants, monitors, alerts, and notification channels

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenant isolation table
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  encrypted_config JSONB DEFAULT '{}'::jsonb
);

-- Monitor configurations table
CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  check_interval INTEGER NOT NULL CHECK (check_interval IN (60, 300)), -- 1 or 5 minutes
  timeout_seconds INTEGER NOT NULL DEFAULT 30 CHECK (timeout_seconds > 0),
  expected_status_codes INTEGER[] DEFAULT '{200}',
  probe_locations TEXT[] NOT NULL DEFAULT '{us-east}',
  failure_threshold INTEGER DEFAULT 3 CHECK (failure_threshold > 0),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT monitors_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Time-series check results table (partitioned by timestamp)
CREATE TABLE IF NOT EXISTS check_results (
  id UUID DEFAULT uuid_generate_v4(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  success BOOLEAN NOT NULL,
  response_time INTEGER, -- milliseconds
  status_code INTEGER,
  error_message TEXT,
  ssl_expiry_date TIMESTAMP WITH TIME ZONE,
  ssl_issuer TEXT,
  ssl_subject TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Alert history table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('failure', 'recovery', 'ssl_warning', 'ssl_critical')),
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  consecutive_failures INTEGER DEFAULT 0,
  affected_locations TEXT[] DEFAULT '{}',
  message TEXT NOT NULL,
  notification_status JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notification channels table
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'webhook', 'sms', 'voice')),
  configuration JSONB NOT NULL, -- encrypted sensitive data
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT notification_channels_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT
);

-- Insert this migration record
INSERT INTO schema_migrations (version, description) 
VALUES ('001_initial_schema', 'Create core tables for tenants, monitors, alerts, and notification channels')
ON CONFLICT (version) DO NOTHING;