-- Migration: Add store selection state to conversations
-- Adiciona campos para rastrear quando estamos aguardando seleção de loja

DO $$
BEGIN
  -- Add awaiting_store_selection column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'awaiting_store_selection') THEN
    ALTER TABLE conversations ADD COLUMN awaiting_store_selection BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add pending_question_text column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'pending_question_text') THEN
    ALTER TABLE conversations ADD COLUMN pending_question_text TEXT;
  END IF;

  -- Add store_candidates column if it doesn't exist (JSON array of store IDs)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'store_candidates') THEN
    ALTER TABLE conversations ADD COLUMN store_candidates JSONB;
  END IF;

  -- Create index for awaiting_store_selection for faster queries
  CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_store_selection ON conversations(awaiting_store_selection) WHERE awaiting_store_selection = TRUE;

END $$;

