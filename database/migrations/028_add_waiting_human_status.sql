-- Migration: Add waiting_human_at field to conversations
-- Campo para rastrear quando a conversa entrou em estado de espera por atendente humano

DO $$
BEGIN
  -- Add waiting_human_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'waiting_human_at') THEN
    ALTER TABLE conversations ADD COLUMN waiting_human_at TIMESTAMPTZ;
    
    -- Create index for faster queries
    CREATE INDEX IF NOT EXISTS idx_conversations_waiting_human ON conversations(waiting_human_at) WHERE waiting_human_at IS NOT NULL;
    
    -- Update state constraint to include 'waiting_human'
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_state_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_state_check CHECK (state IN ('open', 'waiting', 'waiting_human', 'archived'));
  END IF;
END $$;

COMMENT ON COLUMN conversations.waiting_human_at IS 'Timestamp de quando a conversa entrou em estado de espera por atendente humano (WAITING_HUMAN)';
