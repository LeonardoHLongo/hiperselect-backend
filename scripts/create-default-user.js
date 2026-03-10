/**
 * Script para criar tenant e usuário padrão
 * Execute: node backend/scripts/create-default-user.js
 */

const bcrypt = require('bcryptjs');

async function generatePasswordHash() {
  const password = '45682';
  const hash = await bcrypt.hash(password, 10);
  console.log('\n========================================');
  console.log('Hash da senha gerado:');
  console.log(hash);
  console.log('========================================\n');
  
  console.log('Execute este SQL no Supabase para criar o usuário:');
  console.log('\n-- Primeiro, criar o tenant (se não existir)');
  console.log(`INSERT INTO tenants (id, name, slug, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Hiperselect',
  'hiperselect',
  true
)
ON CONFLICT (id) DO NOTHING;`);

  console.log('\n-- Depois, criar o usuário');
  console.log(`INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'hiperselect@gmail.com',
  '${hash}',
  'Admin Hiperselect',
  'admin',
  true
)
ON CONFLICT (tenant_id, email) DO UPDATE SET
  password_hash = '${hash}',
  name = 'Admin Hiperselect',
  role = 'admin',
  is_active = true;`);
  console.log('\n');
}

generatePasswordHash().catch(console.error);

