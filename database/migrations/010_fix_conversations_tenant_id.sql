-- Migration: Fix Conversations Tenant ID
-- Atualiza conversas existentes que não têm tenant_id
-- Data: 2026-01-30

-- ============================================
-- 1. ATUALIZAR CONVERSAS SEM TENANT_ID
-- ============================================
-- Atribuir conversas sem tenant_id ao tenant padrão
UPDATE conversations
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

-- ============================================
-- 2. ATUALIZAR MENSAGENS SEM TENANT_ID
-- ============================================
-- Atribuir mensagens sem tenant_id ao tenant da conversa correspondente
UPDATE messages m
SET tenant_id = c.tenant_id
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.tenant_id IS NULL
  AND c.tenant_id IS NOT NULL;

-- ============================================
-- 3. GARANTIR CONSTRAINT NOT NULL
-- ============================================
-- Adicionar constraint NOT NULL se ainda não existir
DO $$
BEGIN
  -- Verificar se já existe constraint NOT NULL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu 
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'conversations'
      AND tc.constraint_type = 'CHECK'
      AND ccu.column_name = 'tenant_id'
  ) THEN
    -- Adicionar constraint NOT NULL
    ALTER TABLE conversations 
    ALTER COLUMN tenant_id SET NOT NULL;
    
    ALTER TABLE messages 
    ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- ============================================
-- 4. VERIFICAR RESULTADO
-- ============================================
-- Contar conversas por tenant
SELECT 
  COALESCE(tenant_id::text, 'NULL') as tenant_id,
  COUNT(*) as conversation_count
FROM conversations
GROUP BY tenant_id
ORDER BY tenant_id;

-- Contar mensagens por tenant
SELECT 
  COALESCE(tenant_id::text, 'NULL') as tenant_id,
  COUNT(*) as message_count
FROM messages
GROUP BY tenant_id
ORDER BY tenant_id;

