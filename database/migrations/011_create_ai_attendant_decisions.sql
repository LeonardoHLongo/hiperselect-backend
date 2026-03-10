-- Migration: Create AI Attendant Decisions Table
-- Cria tabela para auditoria de decisões da IA de atendimento
-- Data: 2026-01-30

-- ============================================
-- AI_ATTENDANT_DECISIONS TABLE
-- ============================================
-- Auditoria de decisões da IA de atendimento
CREATE TABLE IF NOT EXISTS ai_attendant_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  is_safe BOOLEAN NOT NULL,
  blocked_reason TEXT,
  reply_preview TEXT,
  classification_reason TEXT,
  safety_gate_approved BOOLEAN,
  safety_gate_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Adicionar foreign keys se as tabelas existirem
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'ai_attendant_decisions_conversation_id_fkey'
    ) THEN
      ALTER TABLE ai_attendant_decisions 
      ADD CONSTRAINT ai_attendant_decisions_conversation_id_fkey 
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'ai_attendant_decisions_message_id_fkey'
    ) THEN
      ALTER TABLE ai_attendant_decisions 
      ADD CONSTRAINT ai_attendant_decisions_message_id_fkey 
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Índices para queries eficientes
CREATE INDEX IF NOT EXISTS ai_attendant_decisions_conversation_idx 
ON ai_attendant_decisions(conversation_id);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_message_idx 
ON ai_attendant_decisions(message_id);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_created_at_idx 
ON ai_attendant_decisions(created_at DESC);

CREATE INDEX IF NOT EXISTS ai_attendant_decisions_is_safe_idx 
ON ai_attendant_decisions(is_safe);

-- Adicionar tenant_id se a tabela tenants existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'ai_attendant_decisions' AND column_name = 'tenant_id'
    ) THEN
      ALTER TABLE ai_attendant_decisions 
      ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS ai_attendant_decisions_tenant_id_idx 
      ON ai_attendant_decisions(tenant_id);
    END IF;
  END IF;
END $$;

-- Comentários para documentação
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

