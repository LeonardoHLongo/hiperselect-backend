-- Migration: Message Ordering Guarantees
-- Garante ordenação cronológica correta e idempotência de mensagens
-- Data: 2026-01-29

-- ============================================
-- 1. GARANTIR IDEMPOTÊNCIA
-- ============================================
-- O campo 'id' já é PRIMARY KEY, garantindo unicidade
-- Mas vamos adicionar um índice único explícito para performance
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_unique ON messages(id);

-- ============================================
-- 2. ÍNDICE COMPOSTO PARA ORDENAÇÃO EFICIENTE
-- ============================================
-- Índice composto para ordenação por (timestamp, created_at, id)
-- Isso garante:
-- - Ordenação rápida mesmo com milhões de mensagens
-- - Ordem determinística mesmo com timestamps iguais
-- - Suporte a queries filtradas por conversation_id
CREATE INDEX IF NOT EXISTS messages_conversation_order_idx 
ON messages(conversation_id, timestamp ASC, created_at ASC, id ASC);

-- ============================================
-- 3. VALIDAÇÃO DE TIMESTAMP
-- ============================================
-- Garantir que timestamp seja sempre positivo e em milissegundos
-- Timestamps válidos: > 0 (Unix epoch em ms)
ALTER TABLE messages 
ADD CONSTRAINT messages_timestamp_positive 
CHECK (timestamp > 0);

-- ============================================
-- 4. ÍNDICE ADICIONAL PARA PERFORMANCE
-- ============================================
-- Índice para buscar mensagens por conversation_id rapidamente
-- (já existe implicitamente pela FK, mas vamos criar explícito para garantir)
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx 
ON messages(conversation_id);

-- ============================================
-- 5. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================
COMMENT ON COLUMN messages.timestamp IS 
'Unix timestamp em milissegundos (BIGINT). Sempre > 0. Usado como primeiro critério de ordenação.';

COMMENT ON COLUMN messages.created_at IS 
'Timestamp de inserção no banco (TIMESTAMP). Usado como segundo critério de ordenação (tie-breaker).';

COMMENT ON COLUMN messages.id IS 
'ID único da mensagem (TEXT). Usado como terceiro critério de ordenação (tie-breaker final). PRIMARY KEY garante idempotência.';

-- ============================================
-- NOTAS DE IMPLEMENTAÇÃO
-- ============================================
-- Ordenação garantida pela query:
-- ORDER BY timestamp ASC, created_at ASC, id ASC
--
-- Regras:
-- 1. Timestamp sempre em milissegundos (BIGINT)
-- 2. Se timestamp igual, usar created_at
-- 3. Se created_at igual, usar id (sempre único)
-- 4. Idempotência: mesma messageId não duplica (PRIMARY KEY)
-- 5. Mensagens fora de ordem são armazenadas corretamente e exibidas na ordem correta

