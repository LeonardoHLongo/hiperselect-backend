-- Migration: Add agent color to profiles
-- Permite que cada agente tenha uma cor personalizada para identificação visual
-- Data: 2026-02-20

-- Adicionar campo color na tabela profiles
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3B82F6'; -- Azul padrão (blue-600)

-- Comentário para documentação
COMMENT ON COLUMN profiles.color IS 
'Cor personalizada do agente em formato hexadecimal (ex: #3B82F6). Usada para identificação visual nos badges.';
