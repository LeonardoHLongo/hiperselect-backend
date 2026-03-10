-- Migration: Multi-Tenant Support
-- Adiciona suporte a múltiplos tenants (empresas clientes)
-- Data: 2026-01-29

-- ============================================
-- 1. TENANTS TABLE
-- ============================================
-- Armazena informações de cada tenant (empresa cliente)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, -- URL-friendly identifier
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índice para busca por slug
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique ON tenants(slug);
CREATE INDEX IF NOT EXISTS tenants_is_active_idx ON tenants(is_active);

-- ============================================
-- 2. USERS TABLE
-- ============================================
-- Usuários do sistema (pertencentes a um tenant)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt hash
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin', 'user', 'viewer'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, email) -- Email único por tenant
);

-- Índices
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_tenant_email_idx ON users(tenant_id, email);

-- ============================================
-- 3. ADICIONAR tenant_id EM TABELAS EXISTENTES
-- ============================================

-- Stores (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stores') THEN
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS stores_tenant_id_idx ON stores(tenant_id);
  END IF;
END $$;

-- Policies (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'policies') THEN
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS policies_tenant_id_idx ON policies(tenant_id);
  END IF;
END $$;

-- Conversations (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS conversations_tenant_id_idx ON conversations(tenant_id);
  END IF;
END $$;

-- Messages (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS messages_tenant_id_idx ON messages(tenant_id);
  END IF;
END $$;

-- Tickets (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tickets') THEN
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS tickets_tenant_id_idx ON tickets(tenant_id);
  END IF;
END $$;

-- AI Decisions (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_decisions') THEN
    ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS ai_decisions_tenant_id_idx ON ai_decisions(tenant_id);
  END IF;
END $$;

-- AI Attendant Decisions (se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_attendant_decisions') THEN
    ALTER TABLE ai_attendant_decisions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS ai_attendant_decisions_tenant_id_idx ON ai_attendant_decisions(tenant_id);
  END IF;
END $$;

-- Company Context (um por tenant, se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'company_context') THEN
    ALTER TABLE company_context ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS company_context_tenant_id_unique ON company_context(tenant_id);
  END IF;
END $$;

-- ============================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================
COMMENT ON TABLE tenants IS 
'Tenants (empresas clientes) do sistema. Cada tenant tem isolamento total de dados.';

COMMENT ON TABLE users IS 
'Usuários do sistema. Sempre pertencem a um tenant. Email é único por tenant.';

COMMENT ON COLUMN users.role IS 
'Role do usuário: admin (acesso total), user (acesso normal), viewer (somente leitura).';

COMMENT ON COLUMN tenants.slug IS 
'Identificador URL-friendly único para o tenant (ex: empresa-abc).';

-- ============================================
-- 5. NOTAS DE IMPLEMENTAÇÃO
-- ============================================
-- IMPORTANTE: Todos os repositories devem:
-- 1. Receber tenantId como parâmetro
-- 2. Filtrar todas as queries por tenantId
-- 3. Inserir tenantId em todas as inserções
--
-- Middleware de autenticação deve:
-- 1. Extrair tenantId do JWT
-- 2. Injetar tenantId no request
-- 3. Garantir que todas as operações usem o tenantId correto

