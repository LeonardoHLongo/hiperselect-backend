-- Migration: Add AI control fields to conversations
-- Adiciona campos para controlar se a IA está ligada/desligada por conversa

DO $$
BEGIN
  -- Add ai_enabled column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'ai_enabled'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT true;
  END IF;

  -- Add ai_disabled_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'ai_disabled_at'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN ai_disabled_at TIMESTAMPTZ;
  END IF;

  -- Add ai_disabled_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'ai_disabled_by'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN ai_disabled_by TEXT;
  END IF;

  -- Add ai_disabled_reason column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'ai_disabled_reason'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN ai_disabled_reason TEXT;
  END IF;

  -- Add index for performance
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_conversations_ai_enabled'
  ) THEN
    CREATE INDEX idx_conversations_ai_enabled ON conversations(tenant_id, ai_enabled) 
    WHERE ai_enabled = false;
  END IF;
END $$;

COMMENT ON COLUMN conversations.ai_enabled IS 'Controla se a IA está habilitada para esta conversa. Se false, mensagens não geram respostas automáticas.';
COMMENT ON COLUMN conversations.ai_disabled_at IS 'Timestamp de quando a IA foi desligada.';
COMMENT ON COLUMN conversations.ai_disabled_by IS 'Quem desligou a IA: "human", "system" ou "tool".';
COMMENT ON COLUMN conversations.ai_disabled_reason IS 'Motivo opcional para desligar a IA.';
