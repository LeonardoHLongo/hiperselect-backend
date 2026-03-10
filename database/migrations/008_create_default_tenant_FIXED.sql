-- Migration: Create Default Tenant and User (FIXED)
-- Cria tenant padrão e usuário inicial para desenvolvimento
-- Execute este SQL no Supabase SQL Editor

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
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  is_active = EXCLUDED.is_active;

-- ============================================
-- 2. CRIAR/ATUALIZAR USUÁRIO ADMIN PADRÃO
-- ============================================
-- Senha: 45682
-- Hash gerado: $2b$10$mSvNvJRSo6BoBFEPUXacIOuMPGmX1H2um3ycCGOLRGHKYGj1P9RE6
INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'hiperselect@gmail.com',
  '$2b$10$mSvNvJRSo6BoBFEPUXacIOuMPGmX1H2um3ycCGOLRGHKYGj1P9RE6',
  'Admin Hiperselect',
  'admin',
  true
)
ON CONFLICT (tenant_id, email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- ============================================
-- 3. VERIFICAR SE FOI CRIADO
-- ============================================
SELECT 
  u.id,
  u.email,
  u.name,
  u.role,
  u.is_active,
  t.name as tenant_name
FROM users u
JOIN tenants t ON u.tenant_id = t.id
WHERE u.email = 'hiperselect@gmail.com';

