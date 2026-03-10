-- Migration: Multi-User RBAC Support (Omnichannel SaaS)
-- Adiciona suporte a múltiplos usuários com controle de acesso (RBAC)
-- Data: 2026-02-20

-- ============================================
-- 1. PROFILES TABLE (Vinculada ao auth.users do Supabase)
-- ============================================
-- Armazena informações de perfil dos usuários autenticados via Supabase Auth
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON profiles(role);
CREATE INDEX IF NOT EXISTS profiles_tenant_role_idx ON profiles(tenant_id, role);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_profiles_updated_at();

-- ============================================
-- 2. ADICIONAR assigned_to EM CONVERSATIONS (Tickets)
-- ============================================
-- Campo para rastrear qual agente está responsável pelo ticket
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_assigned_to_idx ON conversations(assigned_to);
CREATE INDEX IF NOT EXISTS conversations_tenant_assigned_idx ON conversations(tenant_id, assigned_to);

-- ============================================
-- 3. ADICIONAR agent_id E agent_name EM MESSAGES
-- ============================================
-- Campos para rastrear qual agente humano enviou a mensagem
ALTER TABLE messages 
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

CREATE INDEX IF NOT EXISTS messages_agent_id_idx ON messages(agent_id);
CREATE INDEX IF NOT EXISTS messages_tenant_agent_idx ON messages(tenant_id, agent_id);

-- ============================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================
COMMENT ON TABLE profiles IS 
'Perfis de usuários autenticados via Supabase Auth. Vinculado a auth.users(id).';

COMMENT ON COLUMN profiles.role IS 
'Role do usuário: admin (acesso total), agent (atendente com acesso limitado).';

COMMENT ON COLUMN conversations.assigned_to IS 
'ID do usuário (agent) responsável pelo ticket. NULL = sem dono (fila geral).';

COMMENT ON COLUMN messages.agent_id IS 
'ID do usuário (agent) que enviou a mensagem manualmente. NULL = mensagem da IA ou do cliente.';

COMMENT ON COLUMN messages.agent_name IS 
'Nome do agente que enviou a mensagem (para exibição rápida sem JOIN).';
