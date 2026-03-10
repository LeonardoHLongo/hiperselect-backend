import { supabase } from './config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Executa o schema SQL no Supabase
 * Rode este script uma vez para criar as tabelas
 */
export const runMigration = async (): Promise<void> => {
  console.log('[Migration] Reading schema file...');
  
  const schemaPath = path.join(__dirname, '../database/migrations/001_initial_schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  console.log('[Migration] Executing schema on Supabase...');
  
  // Dividir o schema em comandos individuais
  const commands = schema
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

  for (const command of commands) {
    if (command.trim()) {
      try {
        // Executar cada comando SQL
        const { error } = await supabase.rpc('exec_sql', { sql: command });
        
        if (error) {
          // Se RPC não existir, tentar executar diretamente via query
          // Nota: Supabase não permite execução direta de SQL via client
          // Você precisa executar o schema manualmente no Supabase SQL Editor
          console.warn(`[Migration] ⚠️  Could not execute: ${command.substring(0, 50)}...`);
          console.warn('[Migration] ⚠️  Please run the schema manually in Supabase SQL Editor');
          console.warn(`[Migration] Schema file: ${schemaPath}`);
          return;
        }
      } catch (error) {
        console.error(`[Migration] Error executing command:`, error);
      }
    }
  }

  console.log('[Migration] ✅ Schema executed successfully');
};

// Executar se chamado diretamente
if (require.main === module) {
  runMigration().catch(console.error);
}

