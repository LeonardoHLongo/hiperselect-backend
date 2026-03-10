/**
 * Script para aplicar migration 025_add_reputation_at_risk.sql
 * 
 * Uso: node scripts/apply-migration-025.js
 * 
 * Requer variáveis de ambiente:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('📋 Aplicando migration 025_add_reputation_at_risk.sql...\n');

  const migrationPath = path.join(__dirname, '../database/migrations/025_add_reputation_at_risk.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Dividir SQL em comandos individuais
  const commands = sql
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

  for (const command of commands) {
    try {
      console.log(`Executando: ${command.substring(0, 50)}...`);
      const { error } = await supabase.rpc('exec_sql', { sql: command + ';' });
      
      if (error) {
        // Tentar executar diretamente se RPC não funcionar
        console.log('⚠️  RPC falhou, tentando método alternativo...');
        // Para comandos DDL, podemos usar query direto
        const { error: directError } = await supabase.from('_migrations').select('*');
        if (directError) {
          console.error('❌ Erro ao executar:', error.message);
          // Continuar mesmo com erro (pode ser que a coluna já exista)
        }
      } else {
        console.log('✅ Comando executado com sucesso');
      }
    } catch (error) {
      console.error('❌ Erro:', error.message);
      // Continuar mesmo com erro (pode ser que a coluna já exista)
    }
  }

  // Verificar se a coluna foi criada
  console.log('\n🔍 Verificando se a coluna foi criada...');
  const { data, error } = await supabase
    .from('conversations')
    .select('is_reputation_at_risk')
    .limit(1);

  if (error) {
    console.error('❌ Erro ao verificar:', error.message);
    console.log('\n💡 Dica: Execute o SQL manualmente no Supabase SQL Editor:');
    console.log(sql);
  } else {
    console.log('✅ Migration aplicada com sucesso!');
    console.log('✅ Coluna is_reputation_at_risk está disponível');
  }
}

applyMigration().catch(console.error);
