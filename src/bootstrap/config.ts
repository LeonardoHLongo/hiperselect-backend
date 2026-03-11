export type Config = {
  port: number;
  whatsappSessionPath: string;
  usePostgres: boolean;
  openaiApiKey?: string;
  memoryCacheEnabled: boolean;
  memoryCacheTtlSeconds: number;
};

export const loadConfig = (): Config => {
  // SEMPRE usar porta 3001 para backend (3000 é do Next.js)
  // Ignorar variável de ambiente PORT se for 3000
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  const port = envPort === 3000 ? 3001 : (envPort || 3001);
  
  if (envPort === 3000) {
    console.warn('[Config] ⚠️  PORT=3000 detected. Backend must use 3001 (3000 is for Next.js).');
  }

  // Debug: mostrar todas as variáveis de ambiente relacionadas ao Supabase
  console.log('[Config] 🔍 Checking environment variables...');
  console.log('[Config] SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Found' : '❌ Not found');
  console.log('[Config] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Found' : '❌ Not found');
  console.log('[Config] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Found' : '❌ Not found');
  
  // Debug: Redis configuration
  console.log('[Config] 🔍 Checking Redis configuration...');
  console.log('[Config] USE_BULLMQ:', process.env.USE_BULLMQ || 'false');
  
  const redisPublicUrl = process.env.REDIS_PUBLIC_URL;
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;
  const redisPassword = process.env.REDIS_PASSWORD;
  const redisUser = process.env.REDIS_USER || process.env.REDIS_USERNAME;
  
  console.log('[Config] REDIS_PUBLIC_URL:', redisPublicUrl ? `✅ Found (${redisPublicUrl.substring(0, 30)}...)` : '❌ Not found');
  console.log('[Config] REDIS_URL:', redisUrl ? `✅ Found (${redisUrl.substring(0, 30)}...)` : '❌ Not found');
  console.log('[Config] REDIS_HOST:', redisHost || '❌ Not found');
  console.log('[Config] REDIS_PORT:', redisPort || '❌ Not found');
  console.log('[Config] REDIS_PASSWORD:', redisPassword ? '✅ Found' : '❌ Not found');
  console.log('[Config] REDIS_USER:', redisUser || '❌ Not found');
  
  // Validar se há configuração suficiente
  if (process.env.USE_BULLMQ === 'true' || process.env.USE_BULLMQ === '1') {
    const hasConfig = !!(redisPublicUrl || redisUrl || (redisHost && redisPort));
    if (!hasConfig) {
      console.warn('[Config] ⚠️  USE_BULLMQ=true mas nenhuma variável de Redis configurada!');
      console.warn('[Config] ⚠️  Configure pelo menos uma: REDIS_PUBLIC_URL, REDIS_URL ou REDIS_HOST+REDIS_PORT');
    } else {
      console.log('[Config] ✅ Configuração do Redis detectada');
    }
  }
  
  // Validar OPENAI_API_KEY
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey || openaiApiKey.trim().length === 0) {
    console.error('[Config] ❌ OPENAI_API_KEY is required but not found in environment variables');
    console.error('[Config] ❌ Please add OPENAI_API_KEY to your .env file');
  } else if (!openaiApiKey.startsWith('sk-')) {
    console.warn('[Config] ⚠️  OPENAI_API_KEY does not start with "sk-" - this may be incorrect');
  } else {
    console.log('[Config] ✅ OPENAI_API_KEY format looks correct');
  }
  
  // Usar PostgreSQL se SUPABASE_URL estiver configurado
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const usePostgres = !!(supabaseUrl && supabaseKey);

  if (usePostgres) {
    console.log('[Config] ✅ SUPABASE_URL detected:', supabaseUrl);
    console.log('[Config] ✅ SUPABASE_SERVICE_ROLE_KEY detected');
    console.log('[Config] ✅ PostgreSQL (Supabase) will be used for persistence');
  } else {
    console.log('[Config] ⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in environment variables');
    console.log('[Config] ⚠️  Using in-memory storage (data will be lost on restart)');
    console.log('[Config] 💡 To enable Supabase, add both variables to your .env file:');
    console.log('[Config] 💡   SUPABASE_URL=https://ooancmvihrxzgtegvmwn.supabase.co');
    console.log('[Config] 💡   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
    console.log('[Config] 💡 Make sure to restart the backend after adding these variables!');
  }

  // Configuração de cache de memória
  const memoryCacheEnabled = process.env.MEMORY_CACHE_ENABLED !== 'false'; // Default: true
  const memoryCacheTtlSeconds = parseInt(process.env.MEMORY_CACHE_TTL_SECONDS || '60', 10);

  if (memoryCacheEnabled) {
    console.log(`[Config] ✅ Memory cache enabled (TTL: ${memoryCacheTtlSeconds}s)`);
  } else {
    console.log('[Config] ⚠️  Memory cache disabled');
  }

  const finalOpenaiApiKey = openaiApiKey && openaiApiKey.trim().length > 0 ? openaiApiKey.trim() : undefined;

  // No Railway/Docker, usar caminho absoluto dentro do container
  // Em desenvolvimento local, pode usar caminho relativo
  const defaultSessionPath = process.env.NODE_ENV === 'production' 
    ? '/app/sessions'  // Caminho absoluto no container
    : './sessions';     // Caminho relativo em desenvolvimento
  
  return {
    port,
    whatsappSessionPath: process.env.WHATSAPP_SESSION_PATH || defaultSessionPath,
    usePostgres,
    openaiApiKey: finalOpenaiApiKey,
    memoryCacheEnabled,
    memoryCacheTtlSeconds,
  };
};

