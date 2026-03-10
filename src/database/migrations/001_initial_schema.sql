-- Supabase PostgreSQL Schema for HiperSelect
-- RLS disabled for Phase 1

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  jid TEXT UNIQUE NOT NULL,
  phone_number TEXT NOT NULL,
  display_name TEXT,
  profile_picture_url TEXT,
  ai_enabled BOOLEAN DEFAULT true,
  last_message TEXT,
  last_message_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  text TEXT,
  timestamp BIGINT NOT NULL,
  sender_phone_number TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  sender_push_name TEXT,
  sender_profile_picture_url TEXT,
  media_type TEXT,
  media_mimetype TEXT,
  media_caption TEXT,
  media_url TEXT,
  media_media_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  baileys_key_id TEXT,
  baileys_key_remote_jid TEXT,
  baileys_key_from_me BOOLEAN,
  baileys_message JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  category TEXT,
  priority TEXT,
  risk BOOLEAN DEFAULT false,
  intent TEXT,
  sentiment TEXT,
  urgency TEXT,
  risk_level TEXT,
  confidence NUMERIC,
  reasoning TEXT,
  ai_version TEXT,
  suggested_response TEXT,
  human_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- AI Decisions table
CREATE TABLE IF NOT EXISTS ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  confidence NUMERIC,
  reasoning TEXT,
  model TEXT,
  intent TEXT,
  sentiment TEXT,
  urgency TEXT,
  risk_level TEXT,
  ai_version TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_state ON tickets(state);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_message_id ON ai_decisions(message_id);
CREATE INDEX IF NOT EXISTS idx_conversations_jid ON conversations(jid);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number ON conversations(phone_number);

