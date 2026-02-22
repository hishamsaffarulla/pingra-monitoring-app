-- Migration: 006_contact_lists
-- Description: Add contact lists and members for notifications

CREATE TABLE IF NOT EXISTS contact_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT contact_lists_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS contact_list_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  label VARCHAR(255),
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'phone')),
  contact TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_lists_tenant_id ON contact_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_members_list_id ON contact_list_members(list_id);

INSERT INTO schema_migrations (version, description)
VALUES ('006_contact_lists', 'Add contact lists and members')
ON CONFLICT (version) DO NOTHING;
