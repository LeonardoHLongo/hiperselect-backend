-- Migration: Add selected_store_name to conversations
-- Adiciona coluna para armazenar o nome da loja selecionada (cache para evitar joins)
-- Data: 2026-01-30

DO $$
BEGIN
  -- Adicionar coluna selected_store_name se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'selected_store_name'
  ) THEN
    ALTER TABLE conversations 
    ADD COLUMN selected_store_name TEXT;
    
    COMMENT ON COLUMN conversations.selected_store_name IS 
      'Nome da loja selecionada (cache para evitar joins frequentes). Atualizado quando selected_store_id é definido.';
  END IF;

END $$;
