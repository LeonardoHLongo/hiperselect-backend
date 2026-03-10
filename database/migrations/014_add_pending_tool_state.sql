-- Migration: Add pending tool state to conversations
-- Adiciona campos para rastrear estado de tools pendentes (Fase 1)
-- Data: 2026-01-30

DO $$
BEGIN
  -- Adicionar pending_tool_name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'pending_tool_name') THEN
    ALTER TABLE conversations ADD COLUMN pending_tool_name TEXT;
    COMMENT ON COLUMN conversations.pending_tool_name IS 'Nome da tool pendente (ex: "store_topics", "policies"). Null quando não há tool pendente.';
  END IF;

  -- Adicionar pending_fields (JSON array de strings)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'pending_fields') THEN
    ALTER TABLE conversations ADD COLUMN pending_fields JSONB;
    COMMENT ON COLUMN conversations.pending_fields IS 'Array de campos que faltam para completar a tool (ex: ["store_id"]). Null quando não há campos pendentes.';
  END IF;

  -- Adicionar pending_context (JSON object)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'pending_context') THEN
    ALTER TABLE conversations ADD COLUMN pending_context JSONB;
    COMMENT ON COLUMN conversations.pending_context IS 'Contexto da tool pendente (ex: { topic: "policy_lookup" }). Null quando não há contexto.';
  END IF;

  -- Adicionar pending_attempts (int default 0)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'pending_attempts') THEN
    ALTER TABLE conversations ADD COLUMN pending_attempts INTEGER DEFAULT 0;
    COMMENT ON COLUMN conversations.pending_attempts IS 'Número de tentativas de preencher campos pendentes. Usado para evitar loops infinitos.';
  END IF;

  -- Criar índice para queries rápidas de tools pendentes
  CREATE INDEX IF NOT EXISTS idx_conversations_pending_tool ON conversations(pending_tool_name) WHERE pending_tool_name IS NOT NULL;

END $$;
