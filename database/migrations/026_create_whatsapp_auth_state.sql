-- Migration 026: Create whatsapp_auth_state table for hybrid cache
-- This table stores WhatsApp authentication state (creds and keys) for persistence

CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  key TEXT NOT NULL, -- 'creds' or key identifier like 'pre-key-123' or 'session-456'
  value TEXT NOT NULL, -- JSON serialized data using BufferJSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, key)
);

-- Index for fast lookups by session_id
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_state_session_id ON whatsapp_auth_state(session_id);

-- Index for fast lookups by key
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_state_key ON whatsapp_auth_state(key);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_state_updated_at ON whatsapp_auth_state(updated_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whatsapp_auth_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_whatsapp_auth_state_updated_at
  BEFORE UPDATE ON whatsapp_auth_state
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_auth_state_updated_at();

COMMENT ON TABLE whatsapp_auth_state IS 'Stores WhatsApp authentication state (creds and keys) for hybrid cache system (RAM -> Redis -> Supabase)';
COMMENT ON COLUMN whatsapp_auth_state.session_id IS 'WhatsApp session identifier';
COMMENT ON COLUMN whatsapp_auth_state.key IS 'Key identifier: "creds" for credentials or key type:id for session keys';
COMMENT ON COLUMN whatsapp_auth_state.value IS 'JSON serialized data using BufferJSON from Baileys';
