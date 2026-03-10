-- Migration: Atualizar constraint de type em conversation_tasks
-- Data: 2026-02-13
-- Descrição: Adiciona novos tipos de task: price_check e reservation_confirm

-- ============================================
-- 1. REMOVER CONSTRAINT ANTIGA
-- ============================================
ALTER TABLE conversation_tasks 
  DROP CONSTRAINT IF EXISTS conversation_tasks_type_check;

-- ============================================
-- 2. ADICIONAR NOVA CONSTRAINT COM NOVOS TIPOS
-- ============================================
ALTER TABLE conversation_tasks 
  ADD CONSTRAINT conversation_tasks_type_check 
  CHECK (type IN ('manager_check', 'price_check', 'reservation_confirm'));

-- ============================================
-- 3. ATUALIZAR COMENTÁRIO
-- ============================================
COMMENT ON COLUMN conversation_tasks.type IS 'Tipo de task: manager_check (verificação com gerente), price_check (verificação de preço/disponibilidade), reservation_confirm (confirmação de reserva)';
