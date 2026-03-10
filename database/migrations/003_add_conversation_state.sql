-- Migration: Add state column to conversations table
-- This migration adds conversation state management (open, waiting, archived)

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

