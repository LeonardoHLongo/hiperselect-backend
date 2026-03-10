-- Migration: Company Context and AI Attendant Decisions
-- Cria tabelas para contexto da empresa e auditoria de decisões de IA
-- Data: 2026-01-29

-- ============================================
-- 1. COMPANY_CONTEXT TABLE
-- ============================================
-- Armazena contexto da empresa para IA de atendimento
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

-- Índice para busca rápida (sempre será 'default' por enquanto)
CREATE UNIQUE INDEX IF NOT EXISTS company_context_id_unique ON company_context(id);

-- ============================================
-- 2. AI_ATTENDANT_DECISIONS TABLE
-- ============================================
-- Auditoria de decisões da IA de atendimento
CREATE TABLE IF NOT EXISTS ai_attendant_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  is_safe BOOLEAN NOT NULL,
  blocked_reason TEXT,
  reply_preview TEXT,
  classification_reason TEXT,
  safety_gate_approved BOOLEAN,
  safety_gate_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para queries eficientes
CREATE INDEX IF NOT EXISTS ai_attendant_decisions_conversation_idx 
ON ai_attendant_decisions(conversation_id);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_message_idx 
ON ai_attendant_decisions(message_id);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_created_at_idx 
ON ai_attendant_decisions(created_at DESC);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_is_safe_idx 
ON ai_attendant_decisions(is_safe);

-- ============================================
-- 3. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================
COMMENT ON TABLE company_context IS 
'Contexto da empresa usado pela IA de atendimento. Sempre baseado em dados reais, nunca inventado.';

COMMENT ON TABLE ai_attendant_decisions IS 
'Auditoria de todas as decisões da IA de atendimento: classificação SAFE/NOT SAFE, bloqueios do Safety Gate, e respostas geradas.';

COMMENT ON COLUMN ai_attendant_decisions.intent IS 
'Tipo de intenção detectada: address, hours, delivery, payment, contact, product, complaint, urgency, legal, refund, etc.';

COMMENT ON COLUMN ai_attendant_decisions.is_safe IS 
'Se a mensagem foi classificada como SAFE (true) ou NOT SAFE (false) para resposta automática.';

COMMENT ON COLUMN ai_attendant_decisions.blocked_reason IS 
'Motivo do bloqueio se is_safe=false ou se Safety Gate bloqueou a resposta.';

COMMENT ON COLUMN ai_attendant_decisions.reply_preview IS 
'Preview da resposta gerada (primeiros 200 caracteres) para auditoria.';

