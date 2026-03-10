-- Migration: Criar tabela conversation_tasks para rastrear atividades pendentes
-- Data: 2026-02-01

-- ============================================
-- 1. CRIAR TABELA conversation_tasks
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL, -- ID da conversa (string, não UUID)
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('manager_check')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  request_code TEXT NOT NULL UNIQUE, -- Código único para correlacionar resposta do gerente
  payload JSONB NOT NULL DEFAULT '{}', -- { item: string, intent: 'promotion'|'availability'|'price' }
  result_text TEXT, -- Resposta do gerente (preenchido quando completed)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '20 minutes')
);

-- ============================================
-- 2. ÍNDICES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_tenant_id ON conversation_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_conversation_id ON conversation_tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_status ON conversation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_request_code ON conversation_tasks(request_code);
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_expires_at ON conversation_tasks(expires_at);

-- Índice composto para verificar tasks pendentes por conversa
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_pending ON conversation_tasks(conversation_id, status) WHERE status = 'pending';

-- ============================================
-- 3. TRIGGER PARA ATUALIZAR updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_conversation_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_conversation_tasks_updated_at ON conversation_tasks;

CREATE TRIGGER trigger_update_conversation_tasks_updated_at
  BEFORE UPDATE ON conversation_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_tasks_updated_at();

-- ============================================
-- 4. COMENTÁRIOS
-- ============================================
COMMENT ON TABLE conversation_tasks IS 'Rastreia atividades pendentes por conversa (ex: verificação com gerente)';
COMMENT ON COLUMN conversation_tasks.type IS 'Tipo de task: manager_check (verificação com gerente)';
COMMENT ON COLUMN conversation_tasks.status IS 'Status: pending (aguardando), completed (concluída), expired (expirada)';
COMMENT ON COLUMN conversation_tasks.request_code IS 'Código único para correlacionar resposta do gerente (ex: REQ:ABC123)';
COMMENT ON COLUMN conversation_tasks.payload IS 'Dados da task em JSON: { item: string, intent: string }';
COMMENT ON COLUMN conversation_tasks.result_text IS 'Resposta do gerente (preenchido quando status = completed)';
COMMENT ON COLUMN conversation_tasks.expires_at IS 'Data/hora de expiração da task (padrão: 20 minutos após criação)';
