-- Notification deliveries migration
-- Migration: 003_notification_deliveries
-- Description: Create notification_deliveries table for tracking notification delivery status and retry history

-- Notification deliveries table for audit and retry tracking
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'webhook', 'sms', 'voice')),
  success BOOLEAN NOT NULL,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for notification deliveries
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_alert_id 
  ON notification_deliveries(alert_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_id 
  ON notification_deliveries(channel_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_delivered_at 
  ON notification_deliveries(delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_failed_retry 
  ON notification_deliveries(success, retry_count, delivered_at) 
  WHERE success = false;

-- Insert this migration record
INSERT INTO schema_migrations (version, description) 
VALUES ('003_notification_deliveries', 'Create notification_deliveries table for tracking notification delivery status and retry history')
ON CONFLICT (version) DO NOTHING;
