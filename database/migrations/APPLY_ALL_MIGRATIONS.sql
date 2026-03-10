-- ============================================================
-- APPLY ALL MIGRATIONS - Execute this in Supabase SQL Editor
-- ============================================================
-- This script applies all pending migrations:
-- 1. Adds unread_count and last_message_id (Migration 002)
-- 2. Adds state column (Migration 003)
-- ============================================================

-- Migration 002: Add unread_count and last_message_id
-- ============================================================
-- Add unread_count column (default 0 for existing conversations)
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- Add last_message_id column (to reference the last message for building lastMessage object)
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS last_message_id TEXT;

-- Update existing conversations: set unread_count to 0 (all existing conversations are considered read)
UPDATE conversations SET unread_count = 0 WHERE unread_count IS NULL;

-- Create index on unread_count for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_unread_count ON conversations(unread_count);

-- Create index on last_message_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_id ON conversations(last_message_id);

-- Migration 003: Add conversation state
-- ============================================================
-- Add state column with default 'open'
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'open';

-- Add constraint to ensure only valid states
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS conversations_state_check;

ALTER TABLE conversations 
ADD CONSTRAINT conversations_state_check CHECK (state IN ('open', 'waiting', 'archived'));

-- Update existing conversations to 'open' if state is NULL (shouldn't happen, but safety)
UPDATE conversations SET state = 'open' WHERE state IS NULL;

-- Create index on state for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state);

-- ============================================================
-- ✅ All migrations applied successfully!
-- ============================================================

