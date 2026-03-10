-- Migration: Criar tabela para rastrear quando usuários visualizaram tickets
-- Similar ao unread_count, mas para tickets
-- Data: 2026-01-31

-- ============================================
-- 1. CRIAR TABELA user_ticket_views
-- ============================================
CREATE TABLE IF NOT EXISTS user_ticket_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Garantir que cada usuário tem apenas um registro por tenant
  UNIQUE(user_id, tenant_id)
);

-- ============================================
-- 2. ÍNDICES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_ticket_views_user_tenant ON user_ticket_views(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_ticket_views_tenant ON user_ticket_views(tenant_id);

-- ============================================
-- 3. TRIGGER PARA ATUALIZAR updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_user_ticket_views_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remover trigger se já existir antes de criar
DROP TRIGGER IF EXISTS trigger_update_user_ticket_views_updated_at ON user_ticket_views;

CREATE TRIGGER trigger_update_user_ticket_views_updated_at
  BEFORE UPDATE ON user_ticket_views
  FOR EACH ROW
  EXECUTE FUNCTION update_user_ticket_views_updated_at();

-- ============================================
-- 4. COMENTÁRIOS
-- ============================================
COMMENT ON TABLE user_ticket_views IS 'Rastreia quando cada usuário visualizou a página de tickets pela última vez';
COMMENT ON COLUMN user_ticket_views.last_viewed_at IS 'Timestamp da última vez que o usuário visualizou a página de tickets';
COMMENT ON COLUMN user_ticket_views.user_id IS 'ID do usuário';
COMMENT ON COLUMN user_ticket_views.tenant_id IS 'ID do tenant (multi-tenancy)';
