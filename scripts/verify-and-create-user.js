/**
 * Script para verificar e criar usuário padrão no Supabase
 * Execute: node backend/scripts/verify-and-create-user.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyAndCreateUser() {
  console.log('\n========================================');
  console.log('Verificando e criando usuário padrão...');
  console.log('========================================\n');

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const email = 'hiperselect@gmail.com';
  const password = '45682';

  try {
    // 1. Verificar se o tenant existe
    console.log('1. Verificando tenant...');
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.log('   ⚠️  Tenant não encontrado. Criando...');
      const { data: newTenant, error: createTenantError } = await supabase
        .from('tenants')
        .insert({
          id: tenantId,
          name: 'Hiperselect',
          slug: 'hiperselect',
          is_active: true,
        })
        .select()
        .single();

      if (createTenantError) {
        console.error('   ❌ Erro ao criar tenant:', createTenantError);
        return;
      }
      console.log('   ✅ Tenant criado:', newTenant.name);
    } else {
      console.log('   ✅ Tenant encontrado:', tenant.name);
    }

    // 2. Verificar se o usuário existe
    console.log('\n2. Verificando usuário...');
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('   ❌ Erro ao buscar usuário:', userError);
      return;
    }

    // 3. Gerar hash da senha
    console.log('\n3. Gerando hash da senha...');
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('   ✅ Hash gerado');

    if (existingUser) {
      // Atualizar usuário existente
      console.log('\n4. Usuário já existe. Atualizando senha...');
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: passwordHash,
          name: 'Admin Hiperselect',
          role: 'admin',
          is_active: true,
        })
        .eq('id', existingUser.id)
        .select()
        .single();

      if (updateError) {
        console.error('   ❌ Erro ao atualizar usuário:', updateError);
        return;
      }
      console.log('   ✅ Usuário atualizado:', updatedUser.email);
    } else {
      // Criar novo usuário
      console.log('\n4. Usuário não encontrado. Criando...');
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          id: '00000000-0000-0000-0000-000000000001',
          tenant_id: tenantId,
          email: email,
          password_hash: passwordHash,
          name: 'Admin Hiperselect',
          role: 'admin',
          is_active: true,
        })
        .select()
        .single();

      if (createUserError) {
        console.error('   ❌ Erro ao criar usuário:', createUserError);
        return;
      }
      console.log('   ✅ Usuário criado:', newUser.email);
    }

    // 5. Verificar login
    console.log('\n5. Testando login...');
    const { data: testUser, error: testError } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .single();

    if (testError || !testUser) {
      console.error('   ❌ Erro ao buscar usuário para teste:', testError);
      return;
    }

    const isValidPassword = await bcrypt.compare(password, testUser.password_hash);
    if (isValidPassword) {
      console.log('   ✅ Senha válida! Login deve funcionar.');
    } else {
      console.error('   ❌ Senha inválida! Hash pode estar incorreto.');
    }

    console.log('\n========================================');
    console.log('✅ Processo concluído!');
    console.log('========================================\n');
    console.log('Credenciais:');
    console.log('  Email:', email);
    console.log('  Senha:', password);
    console.log('  Tenant ID:', tenantId);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Erro fatal:', error);
    process.exit(1);
  }
}

verifyAndCreateUser();

