-- Migration: Adicionar campo google_review_link na tabela stores
-- Data: 2026-02-13
-- Descrição: Adiciona campo para armazenar link do Google Meu Negócio para avaliações

-- ============================================
-- 1. ADICIONAR CAMPO google_review_link
-- ============================================
ALTER TABLE stores 
ADD COLUMN IF NOT EXISTS google_review_link TEXT;

-- ============================================
-- 2. COMENTÁRIO
-- ============================================
COMMENT ON COLUMN stores.google_review_link IS 'Link do Google Meu Negócio para avaliações da loja';
