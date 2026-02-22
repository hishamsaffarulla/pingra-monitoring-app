-- Migration: 007_mfa_support
-- Description: Add MFA (TOTP) fields to users table

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT;

CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled);

INSERT INTO schema_migrations (version, description)
VALUES ('007_mfa_support', 'Add MFA support columns to users')
ON CONFLICT (version) DO NOTHING;

