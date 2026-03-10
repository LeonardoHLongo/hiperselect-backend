-- Migration: Add selected_store_id to conversations
-- Permite persistir qual loja foi selecionada pelo usuário na conversa
-- Data: 2026-01-30

-- Adicionar coluna selected_store_id se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'selected_store_id'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN selected_store_id UUID;
    
    -- Adicionar foreign key se a tabela stores existir
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stores') THEN
      ALTER TABLE conversations 
      ADD CONSTRAINT conversations_selected_store_id_fkey 
      FOREIGN KEY (selected_store_id) REFERENCES stores(id) ON DELETE SET NULL;
    END IF;
    
    -- Criar índice para queries eficientes
    CREATE INDEX IF NOT EXISTS idx_conversations_selected_store_id 
    ON conversations(selected_store_id);
  END IF;
END $$;

-- Comentário para documentação
COMMENT ON COLUMN conversations.selected_store_id IS 
'ID da loja selecionada pelo usuário nesta conversa. Usado para contexto de políticas e respostas automáticas.';

