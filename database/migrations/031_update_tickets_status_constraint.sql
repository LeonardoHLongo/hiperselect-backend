-- Migration: Atualizar constraint de status para usar 'closed' em vez de 'resolved'
-- Data: 2026-02-20

-- Remover constraint antiga se existir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'tickets_status_check'
  ) THEN
    ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
  END IF;
END $$;

-- Criar nova constraint com 'closed' em vez de 'resolved'
ALTER TABLE tickets 
  ADD CONSTRAINT tickets_status_check CHECK (status IN ('open', 'in_progress', 'closed'));

-- Migrar tickets existentes de 'resolved' para 'closed'
UPDATE tickets 
SET status = 'closed' 
WHERE status = 'resolved';
