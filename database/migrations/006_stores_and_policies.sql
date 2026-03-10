-- Migration: Stores and Policies
-- Tabelas para gerenciamento de lojas e políticas da empresa
-- Data: 2026-01-29

-- ============================================
-- 1. STORES TABLE
-- ============================================
-- Armazena informações de todas as lojas
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  opening_hours TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para busca eficiente
CREATE INDEX IF NOT EXISTS stores_city_idx ON stores(city);
CREATE INDEX IF NOT EXISTS stores_is_active_idx ON stores(is_active);
CREATE INDEX IF NOT EXISTS stores_name_idx ON stores(name);

-- ============================================
-- 2. POLICIES TABLE
-- ============================================
-- Armazena políticas da empresa (entrega, pagamento, devolução, etc)
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  applicable_stores UUID[] DEFAULT ARRAY[]::UUID[], -- Array de IDs de lojas (vazio = todas)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índice para busca por título
CREATE INDEX IF NOT EXISTS policies_title_idx ON policies(title);

-- ============================================
-- 3. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================
COMMENT ON TABLE stores IS 
'Cadastro de todas as lojas da empresa. Central de verdade para informações de lojas.';

COMMENT ON TABLE policies IS 
'Políticas da empresa (entrega, pagamento, devolução, etc). Pode ser aplicável a lojas específicas ou todas.';

COMMENT ON COLUMN stores.is_active IS 
'Se a loja está ativa (true) ou inativa (false). Lojas inativas não aparecem em listagens públicas.';

COMMENT ON COLUMN policies.applicable_stores IS 
'Array de UUIDs das lojas onde a política se aplica. Array vazio significa que se aplica a todas as lojas.';

