-- Migration: Add unread_count and last_message_id to conversations table
-- This migration adds support for unread message counting and structured lastMessage object

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

