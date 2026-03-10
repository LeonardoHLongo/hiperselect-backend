-- Migration: Fix Company Context Table
-- Garante que a tabela company_context existe com tenant_id
-- Data: 2026-01-30

-- ============================================
-- 1. CRIAR TABELA COMPANY_CONTEXT (se não existir)
-- ===========================================
CREATE TABLE IF NOT EXISTS company_context (
  id TEXT PRIMARY KEY DEFAULT 'default',
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  opening_hours TEXT NOT NULL,
  delivery_policy TEXT NOT NULL,
  payment_methods TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  internal_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Adicionar tenant_id se não existir (multi-tenancy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'company_context' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE company_context ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS company_context_tenant_id_unique ON company_context(tenant_id);
  END IF;
END $$;

-- Índice para busca rápida
CREATE UNIQUE INDEX IF NOT EXISTS company_context_id_unique ON company_context(id);

-- Comentário para documentação
COMMENT ON TABLE company_context IS 
'Armazena contexto da empresa para IA de atendimento. Um registro por tenant.';

