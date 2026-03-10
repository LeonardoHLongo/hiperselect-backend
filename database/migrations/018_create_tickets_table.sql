-- Migration: Create/Update tickets table for handoff tracking
-- Tickets são criados automaticamente pelo sistema quando ocorre handoff sensível
-- Esta migration migra da estrutura antiga (state) para a nova (status)

-- Primeiro, garantir que tenant_id existe (já deve existir pela migration 007)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE tickets ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Adicionar colunas novas se não existirem
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system';

-- Migrar de 'state' para 'status' se necessário
DO $$
BEGIN
  -- Se existe coluna 'state' mas não existe 'status', renomear
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'state'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'status'
  ) THEN
    ALTER TABLE tickets RENAME COLUMN state TO status;
  END IF;
  
  -- Se não existe nem 'state' nem 'status', criar 'status'
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tickets' AND column_name = 'status'
  ) THEN
    ALTER TABLE tickets ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
  END IF;
END $$;

-- Garantir que status tem valores válidos e default
ALTER TABLE tickets 
  ALTER COLUMN status SET DEFAULT 'open';
  
-- Remover constraint antiga se existir e criar nova com 'resolved'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'tickets_status_check'
  ) THEN
    ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
  END IF;
END $$;

ALTER TABLE tickets 
  ADD CONSTRAINT tickets_status_check CHECK (status IN ('open', 'in_progress', 'resolved'));

-- Garantir que priority tem valores válidos e default
ALTER TABLE tickets 
  ALTER COLUMN priority SET DEFAULT 'normal',
  ADD CONSTRAINT tickets_priority_check CHECK (priority IN ('urgent', 'high', 'normal'));

-- Garantir que created_at e updated_at são TIMESTAMPTZ
ALTER TABLE tickets 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ;

-- Garantir que title e reason são NOT NULL (após popular dados padrão se necessário)
DO $$
BEGIN
  -- Popular title padrão se NULL
  UPDATE tickets SET title = 'Ticket criado automaticamente' WHERE title IS NULL;
  -- Popular reason padrão se NULL
  UPDATE tickets SET reason = 'unknown' WHERE reason IS NULL;
END $$;

ALTER TABLE tickets 
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN reason SET NOT NULL;

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_id ON tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_tickets_updated_at();
