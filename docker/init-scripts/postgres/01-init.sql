-- PostgreSQL Initialization Script for URL Monitoring Application
-- This script runs automatically when the PostgreSQL container starts for the first time

-- Create database if it doesn't exist (handled by POSTGRES_DB env var)
-- This file is for any additional initialization needed

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create a read-only user for reporting (optional)
-- Uncomment if needed
-- CREATE USER url_monitor_readonly WITH PASSWORD 'readonly_password';
-- GRANT CONNECT ON DATABASE url_monitoring TO url_monitor_readonly;
-- GRANT USAGE ON SCHEMA public TO url_monitor_readonly;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO url_monitor_readonly;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO url_monitor_readonly;

-- Log initialization
DO $$
BEGIN
  RAISE NOTICE 'PostgreSQL initialization completed for URL Monitoring Application';
END $$;
