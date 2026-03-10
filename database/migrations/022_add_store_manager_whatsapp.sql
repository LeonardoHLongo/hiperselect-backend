-- Migration: Adicionar campos de WhatsApp do gerente na tabela stores
-- Data: 2026-02-01

-- ============================================
-- 1. ADICIONAR CAMPOS DE GERENTE
-- ============================================
DO $$
BEGIN
  -- Adicionar manager_whatsapp_number (nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'manager_whatsapp_number'
  ) THEN
    ALTER TABLE stores ADD COLUMN manager_whatsapp_number TEXT;
    COMMENT ON COLUMN stores.manager_whatsapp_number IS 'Número de WhatsApp do gerente da loja (interno, receberá mensagens automáticas)';
  END IF;

  -- Adicionar manager_whatsapp_enabled (default false)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'manager_whatsapp_enabled'
  ) THEN
    ALTER TABLE stores ADD COLUMN manager_whatsapp_enabled BOOLEAN NOT NULL DEFAULT false;
    COMMENT ON COLUMN stores.manager_whatsapp_enabled IS 'Se true, permite verificação automática com gerente via WhatsApp';
  END IF;
END $$;
