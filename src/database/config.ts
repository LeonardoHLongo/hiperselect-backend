import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://ooancmvihrxzgtegvmwn.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYW5jbXZpaHJ4emd0ZWd2bXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY5OTk1MywiZXhwIjoyMDg1Mjc1OTUzfQ.jJ58G3rKuyiwB2ktw_QQE_4aojc2csOqVtSmLzowGbQ';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

console.log('[Database] Initializing Supabase client...');
console.log('[Database] URL:', supabaseUrl);
console.log('[Database] Service Key:', supabaseServiceKey.substring(0, 20) + '...');

// Criar cliente Supabase com service role key (bypass RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Testar conexão ao inicializar
(async () => {
  try {
    console.log('[Database] Testing Supabase connection...');
    const { data, error } = await supabase.from('conversations').select('count').limit(1);
    
    if (error) {
      console.error('[Database] ❌ Connection test failed:', error.message);
      console.error('[Database] Error code:', error.code);
      console.error('[Database] Error details:', JSON.stringify(error, null, 2));
      
      if (error.code === '42P01') {
        console.error('[Database] ❌ ERROR: Table "conversations" does not exist!');
        console.error('[Database] 💡 Please run the SQL schema in Supabase SQL Editor');
        console.error('[Database] 💡 Schema file: backend/database/schema.sql');
      }
    } else {
      console.log('[Database] ✅ Supabase connection successful');
      console.log('[Database] ✅ Tables are accessible');
    }
  } catch (error) {
    console.error('[Database] ❌ Failed to test connection:', error);
  }
})();

console.log('[Database] ✅ Supabase client initialized');

