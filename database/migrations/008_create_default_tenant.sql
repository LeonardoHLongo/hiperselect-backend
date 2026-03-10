-- Migration: Create Default Tenant and User
-- Cria tenant padrão e usuário inicial para desenvolvimento
-- Data: 2026-01-29

-- ============================================
-- 1. CRIAR TENANT PADRÃO
-- ============================================
INSERT INTO tenants (id, name, slug, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Hiperselect',
  'hiperselect',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. CRIAR USUÁRIO ADMIN PADRÃO
-- ============================================
-- Senha: 45682 (hash bcrypt)
-- Hash gerado com: bcrypt.hash('45682', 10)
-- Para gerar novo hash, use: node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('45682', 10).then(console.log)"
INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'hiperselect@gmail.com',
  '$2b$10$mSvNvJRSo6BoBFEPUXacIOuMPGmX1H2um3ycCGOLRGHKYGj1P9RE6', -- Hash para senha '45682'
  'Admin Hiperselect',
  'admin',
  true
)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- ============================================
-- NOTA: O hash da senha acima é um placeholder
-- Execute o seguinte comando Node.js para gerar o hash correto:
-- node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('45682', 10).then(h => console.log('Hash:', h))"
-- Depois atualize o password_hash na tabela users
-- ============================================

