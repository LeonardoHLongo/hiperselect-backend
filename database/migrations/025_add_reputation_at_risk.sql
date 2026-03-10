-- Adicionar campo is_reputation_at_risk na tabela conversations
-- Para monitoramento de reputação em tempo real

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS is_reputation_at_risk BOOLEAN DEFAULT false;

-- Criar índice para consultas rápidas de conversas em risco
CREATE INDEX IF NOT EXISTS idx_conversations_reputation_at_risk 
ON conversations(tenant_id, is_reputation_at_risk) 
WHERE is_reputation_at_risk = true;

-- Comentário
COMMENT ON COLUMN conversations.is_reputation_at_risk IS 'Indica se a reputação está em risco (cliente insatisfeito ou reclamação grave)';
