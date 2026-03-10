-- Migration: Adicionar campos assigned_to_user_id e resolved_at na tabela tickets
-- Data: 2026-02-01

-- Adicionar campo assigned_to_user_id (nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'assigned_to_user_id'
  ) THEN
    ALTER TABLE tickets ADD COLUMN assigned_to_user_id UUID;
    COMMENT ON COLUMN tickets.assigned_to_user_id IS 'ID do usuário responsável pelo ticket (nullable)';
  END IF;
END $$;

-- Adicionar campo resolved_at (nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'resolved_at'
  ) THEN
    ALTER TABLE tickets ADD COLUMN resolved_at TIMESTAMPTZ;
    COMMENT ON COLUMN tickets.resolved_at IS 'Data/hora em que o ticket foi resolvido (nullable)';
  END IF;
END $$;

-- Atualizar resolved_at quando status mudar para 'closed' (se ainda não estiver definido)
-- Nota: Isso será feito via trigger ou no código da aplicação
