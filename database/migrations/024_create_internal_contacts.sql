-- Migration: Criar tabela internal_contacts para registrar números de gerentes
-- Data: 2026-02-01

-- ============================================
-- 1. CRIAR TABELA internal_contacts
-- ============================================
CREATE TABLE IF NOT EXISTS internal_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL, -- Número de WhatsApp (formato: 5548999999999)
  contact_type TEXT NOT NULL DEFAULT 'manager' CHECK (contact_type IN ('manager', 'admin')),
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL, -- Loja associada (se aplicável)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Garantir que cada número é único por tenant
  UNIQUE(tenant_id, phone_number)
);

-- ============================================
-- 2. ÍNDICES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_internal_contacts_tenant_id ON internal_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_internal_contacts_phone_number ON internal_contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_internal_contacts_store_id ON internal_contacts(store_id);

-- ============================================
-- 3. TRIGGER PARA ATUALIZAR updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_internal_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_internal_contacts_updated_at ON internal_contacts;

CREATE TRIGGER trigger_update_internal_contacts_updated_at
  BEFORE UPDATE ON internal_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_internal_contacts_updated_at();

-- ============================================
-- 4. COMENTÁRIOS
-- ============================================
COMMENT ON TABLE internal_contacts IS 'Registra números de WhatsApp de contatos internos (gerentes, admins) que recebem mensagens automáticas';
COMMENT ON COLUMN internal_contacts.phone_number IS 'Número de WhatsApp no formato internacional (ex: 5548999999999)';
COMMENT ON COLUMN internal_contacts.contact_type IS 'Tipo de contato: manager (gerente de loja), admin (administrador)';
COMMENT ON COLUMN internal_contacts.store_id IS 'ID da loja associada (se contact_type = manager)';
