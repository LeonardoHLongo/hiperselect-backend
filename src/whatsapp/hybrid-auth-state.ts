/**
 * Hybrid Auth State for WhatsApp
 * 
 * Cache híbrido em 3 níveis:
 * 1. Memória RAM (Map) - mais rápido
 * 2. Redis (Upstash) - cache intermediário com TTL
 * 3. Supabase - persistência final
 * 
 * Usa BufferJSON do Baileys para serialização binária
 */

import { BufferJSON, type SignalKeyStore, type SignalCredentialType, type AuthenticationState, initAuthCreds } from '@whiskeysockets/baileys';
import Redis from 'ioredis';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RedisConnection = string | { host: string; port: number; password?: string; username?: string };

interface HybridAuthStateConfig {
  sessionId: string;
  redisConnection: RedisConnection;
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * Cache em memória (RAM)
 */
class MemoryCache {
  private credsCache: Map<string, any> = new Map();
  private keysCache: Map<string, any> = new Map();

  getCreds(sessionId: string): any {
    return this.credsCache.get(`creds:${sessionId}`);
  }

  setCreds(sessionId: string, creds: any): void {
    this.credsCache.set(`creds:${sessionId}`, creds);
  }

  getKey(sessionId: string, dataId: string): any {
    return this.keysCache.get(`key:${sessionId}:${dataId}`);
  }

  setKey(sessionId: string, dataId: string, key: any): void {
    this.keysCache.set(`key:${sessionId}:${dataId}`, key);
  }

  deleteKey(sessionId: string, dataId: string): void {
    this.keysCache.delete(`key:${sessionId}:${dataId}`);
  }

  getAllKeys(sessionId: string): Array<{ id: string; value: any }> {
    const prefix = `key:${sessionId}:`;
    const keys: Array<{ id: string; value: any }> = [];
    
    for (const [cacheKey, value] of this.keysCache.entries()) {
      if (cacheKey.startsWith(prefix)) {
        const dataId = cacheKey.substring(prefix.length);
        keys.push({ id: dataId, value });
      }
    }
    
    return keys;
  }

  clear(): void {
    this.credsCache.clear();
    this.keysCache.clear();
  }
}

/**
 * SignalKeyStore implementado com cache híbrido
 */
class HybridSignalKeyStore implements SignalKeyStore {
  private memoryCache: MemoryCache;
  private redis: Redis;
  private supabase: SupabaseClient;
  private sessionId: string;
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  private redisEnabled: boolean = true;

  constructor(config: HybridAuthStateConfig) {
    this.sessionId = config.sessionId;
    this.memoryCache = new MemoryCache();

    // Modo Ultra-Leve: Desativar Redis completamente em desenvolvimento
    const isDevelopment = process.env.NODE_ENV === 'development';
    const forceDisableRedis = process.env.DISABLE_REDIS_FOR_AUTH === 'true' || isDevelopment;

    if (forceDisableRedis) {
      console.log('[HybridAuth] ⚡ Modo Ultra-Leve: Redis completamente desativado (NODE_ENV=development)');
      console.log('[HybridAuth] 💡 Usando apenas Memória RAM + Supabase (sem tentativas de conexão Redis)');
      console.log('[HybridAuth] ✅ Redis pulado completamente - zero latência de conexão');
      this.redisEnabled = false;
      // Criar instância dummy do Redis para evitar erros
      this.redis = null as any;
      // NÃO tentar conectar - pular completamente (elimina timeout de 5s)
      // Inicializar Supabase e sair (sem tentar conectar Redis)
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      return; // Sair do construtor imediatamente, sem tentar conectar Redis
    } else {
      // Inicializar Redis
      if (typeof config.redisConnection === 'string') {
        this.redis = new Redis(config.redisConnection, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
          connectTimeout: 3000, // Timeout de 3s para conexão
          retryStrategy: (times) => {
            if (times > 3) {
              console.error('[HybridAuth] ❌ Redis: Muitas tentativas de reconexão, desativando Redis');
              this.redisEnabled = false;
              return null;
            }
            const delay = Math.min(times * 100, 2000);
            return delay;
          },
        });
      } else {
        this.redis = new Redis({
          host: config.redisConnection.host,
          port: config.redisConnection.port,
          password: config.redisConnection.password,
          username: config.redisConnection.username,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
          connectTimeout: 3000, // Timeout de 3s para conexão
          retryStrategy: (times) => {
            if (times > 3) {
              console.error('[HybridAuth] ❌ Redis: Muitas tentativas de reconexão, desativando Redis');
              this.redisEnabled = false;
              return null;
            }
            const delay = Math.min(times * 100, 2000);
            return delay;
          },
        });
      }

      // Tentar conectar Redis com timeout
      Promise.race([
        this.redis.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 3000))
      ]).then(() => {
        console.log('[HybridAuth] ✅ Redis conectado com sucesso');
      }).catch((err) => {
        console.error('[HybridAuth] ❌ Erro ao conectar Redis (timeout ou falha):', err.message);
        console.error('[HybridAuth] ⚠️  Modo Fallback: Desativando Redis - usando apenas memória e Supabase');
        this.redisEnabled = false;
        // Tentar desconectar para evitar tentativas contínuas
        this.redis.disconnect().catch(() => {});
      });
    }

    // Inicializar Supabase
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Read-through: Memória -> Redis -> Supabase
   */
  private async readData<T>(
    redisKey: string,
    supabaseTable: string,
    supabaseKeyColumn: string,
    supabaseValueColumn: string,
    deserialize: (data: string) => T
  ): Promise<T | null> {
    try {
      // 1. Tentar memória primeiro
      if (redisKey.startsWith('auth:creds:')) {
        const cached = this.memoryCache.getCreds(this.sessionId);
        if (cached) {
          return cached;
        }
      } else if (redisKey.startsWith('auth:keys:')) {
        // Extrair dataId corretamente (pode ter múltiplos ':')
        const parts = redisKey.split(':');
        const dataId = parts.slice(3).join(':'); // Pega tudo após 'auth:keys:sessionId:'
        const cached = this.memoryCache.getKey(this.sessionId, dataId);
        if (cached) {
          return cached;
        }
      }

      // 2. Tentar Redis (apenas se estiver habilitado e pronto)
      if (this.redisEnabled && this.redis) {
        // Aguardar Redis estar pronto (com timeout curto)
        if (this.redis.status !== 'ready') {
          try {
            await Promise.race([
              new Promise<void>((resolve) => {
                if (this.redis.status === 'ready') {
                  resolve();
                } else {
                  this.redis.once('ready', () => resolve());
                }
              }),
              new Promise<void>((resolve) => setTimeout(resolve, 500))
            ]);
          } catch (e) {
            // Ignorar timeout - continuar sem Redis
          }
        }

        if (this.redis.status === 'ready') {
          try {
            const redisData = await this.redis.get(redisKey);
            if (redisData) {
              const deserialized = deserialize(redisData);
              
              // Popular memória
              if (redisKey.startsWith('auth:creds:')) {
                this.memoryCache.setCreds(this.sessionId, deserialized);
              } else if (redisKey.startsWith('auth:keys:')) {
                const parts = redisKey.split(':');
                const dataId = parts.slice(3).join(':');
                this.memoryCache.setKey(this.sessionId, dataId, deserialized);
              }
              
              return deserialized;
            }
          } catch (redisError: any) {
            // Se erro Bad MAC durante leitura do Redis, deletar chave e continuar
            if (redisError?.message?.includes('Bad MAC') || redisError?.message?.includes('bad mac')) {
              console.log(`[HybridAuth] ⚠️ Bad MAC detectado no Redis para ${redisKey}. Deletando chave corrompida...`);
              await this.redis.del(redisKey).catch(() => {});
            } else {
              console.error(`[HybridAuth] ⚠️ Erro ao ler do Redis (${redisKey}):`, redisError);
            }
          }
        }
      }

      // 3. Tentar Supabase
      try {
        const supabaseKey = redisKey.replace('auth:creds:', '').replace('auth:keys:', '');
        const { data, error } = await this.supabase
          .from('whatsapp_auth_state')
          .select(`${supabaseKeyColumn}, ${supabaseValueColumn}`)
          .eq(supabaseKeyColumn, supabaseKey)
          .eq('session_id', this.sessionId)
          .single();

        if (error || !data) {
          return null;
        }

        const deserialized = deserialize(data[supabaseValueColumn]);

        // Popular Redis e memória
        await this.writeToRedis(redisKey, data[supabaseValueColumn], false);
        if (redisKey.startsWith('auth:creds:')) {
          this.memoryCache.setCreds(this.sessionId, deserialized);
        } else if (redisKey.startsWith('auth:keys:')) {
          const parts = redisKey.split(':');
          const dataId = parts.slice(3).join(':');
          this.memoryCache.setKey(this.sessionId, dataId, deserialized);
        }

        return deserialized;
      } catch (supabaseError: any) {
        // Se erro Bad MAC durante leitura do Supabase, deletar e retornar null
        if (supabaseError?.message?.includes('Bad MAC') || supabaseError?.message?.includes('bad mac')) {
          console.log(`[HybridAuth] ⚠️ Bad MAC detectado no Supabase para ${redisKey}. Deletando registro corrompido...`);
          const supabaseKey = redisKey.replace('auth:creds:', '').replace('auth:keys:', '');
          await this.supabase
            .from('whatsapp_auth_state')
            .delete()
            .eq('key', supabaseKey)
            .eq('session_id', this.sessionId)
            .catch(() => {});
        } else {
          console.error(`[HybridAuth] ⚠️ Erro ao ler do Supabase (${redisKey}):`, supabaseError);
        }
        return null;
      }
    } catch (error) {
      console.error(`[HybridAuth] ❌ Erro geral ao ler dados (${redisKey}):`, error);
      return null;
    }
  }

  /**
   * Write-behind: Memória/Redis síncrono, Supabase assíncrono
   */
  private async writeData(
    redisKey: string,
    value: any,
    serialize: (data: any) => string,
    supabaseTable: string,
    supabaseKeyColumn: string,
    supabaseValueColumn: string
  ): Promise<void> {
    const serialized = serialize(value);

    // 1. Atualizar memória imediatamente
    if (redisKey.startsWith('auth:creds:')) {
      this.memoryCache.setCreds(this.sessionId, value);
    } else if (redisKey.startsWith('auth:keys:')) {
      const parts = redisKey.split(':');
      const dataId = parts.slice(3).join(':');
      this.memoryCache.setKey(this.sessionId, dataId, value);
    }

    // 2. Atualizar Redis imediatamente (síncrono)
    await this.writeToRedis(redisKey, serialized, true);

    // 3. Atualizar Supabase assíncrono (não bloqueante)
    this.queueSupabaseWrite(redisKey, serialized, supabaseTable, supabaseKeyColumn, supabaseValueColumn);
  }

  private async writeToRedis(redisKey: string, serialized: string, setTTL: boolean): Promise<void> {
    try {
      // Verificar se Redis está habilitado e pronto antes de escrever
      if (!this.redisEnabled || !this.redis || (this.redis.status !== 'ready' && this.redis.status !== 'connect')) {
        // Não logar se Redis estiver desabilitado intencionalmente (modo fallback)
        if (this.redisEnabled) {
          console.log(`[HybridAuth] ⚠️ Redis não está pronto para escrever ${redisKey} - pulando Redis`);
        }
        return;
      }

      if (setTTL && redisKey.startsWith('auth:keys:')) {
        // TTL de 24 horas para chaves
        await this.redis.setex(redisKey, 86400, serialized);
      } else {
        await this.redis.set(redisKey, serialized);
      }
    } catch (error) {
      console.error(`[HybridAuth] ⚠️ Erro ao escrever no Redis (${redisKey}):`, error);
    }
  }

  private queueSupabaseWrite(
    redisKey: string,
    serialized: string,
    table: string,
    keyColumn: string,
    valueColumn: string
  ): void {
    const key = redisKey.replace('auth:creds:', '').replace('auth:keys:', '');
    
    console.log(`[HybridAuth] 📝 Adicionando escrita na fila para Supabase:`, {
      redisKey,
      key,
      sessionId: this.sessionId,
      table,
      valueLength: serialized.length,
    });

    this.writeQueue.push(async () => {
      try {
        console.log(`[HybridAuth] 🔄 Processando escrita no Supabase:`, {
          redisKey,
          key,
          sessionId: this.sessionId,
        });
        
        const payload: any = {
          session_id: this.sessionId,
          [keyColumn]: key,
          [valueColumn]: serialized,
        };
        
        // Adicionar updated_at apenas se não for criação (upsert gerencia isso)
        const { data, error } = await this.supabase
          .from(table)
          .upsert(payload, {
            onConflict: 'session_id,key',
          });

        if (error) {
          console.error(`[HybridAuth] ❌ Erro ao escrever no Supabase (${redisKey}):`, error);
          console.error(`[HybridAuth] Detalhes do erro:`, JSON.stringify(error, null, 2));
        } else {
          console.log(`[HybridAuth] ✅ Dados salvos no Supabase com sucesso:`, {
            redisKey,
            key,
            sessionId: this.sessionId,
            data,
          });
        }
      } catch (error) {
        console.error(`[HybridAuth] ❌ Erro ao processar escrita no Supabase (${redisKey}):`, error);
        if (error instanceof Error) {
          console.error(`[HybridAuth] Stack trace:`, error.stack);
        }
      }
    });

    // Processar fila se não estiver processando
    if (!this.isProcessingQueue) {
      this.processWriteQueue();
    }
  }

  private async processWriteQueue(): Promise<void> {
    if (this.isProcessingQueue || this.writeQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    console.log(`[HybridAuth] 🔄 Iniciando processamento da fila de escrita. Itens na fila: ${this.writeQueue.length}`);

    while (this.writeQueue.length > 0) {
      const writeFn = this.writeQueue.shift();
      if (writeFn) {
        try {
          await writeFn();
        } catch (error) {
          console.error(`[HybridAuth] ❌ Erro ao processar item da fila:`, error);
        }
      }
    }

    this.isProcessingQueue = false;
    console.log(`[HybridAuth] ✅ Fila de escrita processada completamente`);
  }

  // Implementação de SignalKeyStore
  async get<T extends keyof SignalCredentialType>(type: T, ids: string[]): Promise<{ [id: string]: SignalCredentialType[T] }> {
    const result: { [id: string]: SignalCredentialType[T] } = {};

    try {
      // Verificar se Redis está habilitado e pronto
      if (!this.redisEnabled || !this.redis || this.redis.status !== 'ready') {
        // Não logar se Redis estiver desabilitado intencionalmente (modo fallback)
        if (this.redisEnabled) {
          console.log(`[HybridAuth] ⚠️  Redis não está pronto para get(${String(type)}) - retornando vazio`);
        }
        return result;
      }

      for (const id of ids) {
        try {
          const redisKey = `auth:keys:${this.sessionId}:${type}:${id}`;
          const data = await this.readData<SignalCredentialType[T]>(
            redisKey,
            'whatsapp_auth_state',
            'key',
            'value',
            (data) => {
              try {
                return JSON.parse(data, BufferJSON.reviver);
              } catch (error: any) {
                // Se erro Bad MAC durante deserialização, deletar e retornar null
                if (error?.message?.includes('Bad MAC') || error?.message?.includes('bad mac')) {
                  console.log(`[HybridAuth] ⚠️ Bad MAC durante deserialização de ${redisKey}. Deletando...`);
                  if (this.redis) {
                    this.redis.del(redisKey).catch(() => {});
                  }
                  return null;
                }
                throw error;
              }
            }
          );

          if (data) {
            result[id] = data;
          }
        } catch (error) {
          console.error(`[HybridAuth] ⚠️ Erro ao buscar chave ${id} do tipo ${String(type)}:`, error);
        }
      }
    } catch (error) {
      console.error(`[HybridAuth] ⚠️ Erro em get(${String(type)}):`, error);
    }

    return result;
  }

  async set(data: any): Promise<void> {
    for (const category in data) {
      for (const id in data[category]) {
        const value = data[category][id];
        const redisKey = `auth:keys:${this.sessionId}:${category}:${id}`;
        
        await this.writeData(
          redisKey,
          value,
          (val) => JSON.stringify(val, BufferJSON.replacer),
          'whatsapp_auth_state',
          'key',
          'value'
        );
      }
    }
  }

  async getAll<T extends keyof SignalCredentialType>(type: T): Promise<{ [id: string]: SignalCredentialType[T] }> {
    const result: { [id: string]: SignalCredentialType[T] } = {};

    try {
      // Verificar se Redis está habilitado e pronto
      if (!this.redisEnabled || !this.redis || this.redis.status !== 'ready') {
        // Não logar se Redis estiver desabilitado intencionalmente (modo fallback)
        if (this.redisEnabled) {
          console.log(`[HybridAuth] ⚠️  Redis não está pronto para getAll(${String(type)}) - retornando vazio`);
        }
        return result;
      }

      // Buscar todas as chaves do tipo no Redis
      const pattern = `auth:keys:${this.sessionId}:${type}:*`;
      const keys = await this.redis.keys(pattern).catch(() => []);

      for (const redisKey of keys) {
        try {
          const id = redisKey.split(':').pop() || '';
          const data = await this.readData<SignalCredentialType[T]>(
            redisKey,
            'whatsapp_auth_state',
            'key',
            'value',
            (data) => {
              try {
                return JSON.parse(data, BufferJSON.reviver);
              } catch (error: any) {
                if (error?.message?.includes('Bad MAC') || error?.message?.includes('bad mac')) {
                  console.log(`[HybridAuth] ⚠️ Bad MAC durante deserialização de ${redisKey}. Deletando...`);
                  this.redis.del(redisKey).catch(() => {});
                  return null;
                }
                throw error;
              }
            }
          );

          if (data) {
            result[id] = data;
          }
        } catch (error) {
          console.error(`[HybridAuth] ⚠️ Erro ao processar chave ${redisKey}:`, error);
        }
      }
    } catch (error) {
      console.error(`[HybridAuth] ⚠️ Erro em getAll(${String(type)}):`, error);
    }

    return result;
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    
    // Limpar Redis
    const pattern = `auth:${this.sessionId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    // Limpar Supabase (assíncrono)
    this.queueSupabaseWrite('', '', 'whatsapp_auth_state', 'key', 'value');
    this.supabase
      .from('whatsapp_auth_state')
      .delete()
      .eq('session_id', this.sessionId)
      .catch(() => {});
  }
}

  /**
   * Cria estado de autenticação híbrido
   */
export async function useHybridAuthState(
  config: HybridAuthStateConfig
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  console.log('[HybridAuth] 🔧 Inicializando cache híbrido...');
  const keyStore = new HybridSignalKeyStore(config);
  const memoryCache = new MemoryCache();

  // Aguardar Redis estar pronto (com timeout)
  try {
    const redis = (keyStore as any).redis;
    if (redis && redis.status !== 'ready') {
      console.log('[HybridAuth] ⏳ Aguardando Redis conectar...');
      await Promise.race([
        new Promise<void>((resolve) => {
          if (redis.status === 'ready') {
            resolve();
          } else {
            redis.once('ready', () => resolve());
          }
        }),
        new Promise<void>((resolve) => setTimeout(() => {
          console.log('[HybridAuth] ⚠️  Timeout aguardando Redis - continuando sem Redis');
          resolve();
        }, 3000))
      ]);
    }
  } catch (error) {
    console.error('[HybridAuth] ⚠️  Erro ao aguardar Redis:', error);
  }

  // Carregar creds usando readData privado
  const credsRedisKey = `auth:creds:${config.sessionId}`;
  let creds: any = null;

  try {
    // 1. Tentar memória
    creds = memoryCache.getCreds(config.sessionId);
    
    if (!creds) {
      // 2. Tentar Redis
      try {
        const redis = (keyStore as any).redis;
        if (redis) {
          // Tentar conectar se não estiver conectado
          if (redis.status !== 'ready' && redis.status !== 'connecting') {
            await redis.connect().catch(() => {});
          }
          
          // Aguardar até 2 segundos para Redis estar pronto
          if (redis.status !== 'ready') {
            await Promise.race([
              new Promise<void>((resolve) => {
                if (redis.status === 'ready') {
                  resolve();
                } else {
                  redis.once('ready', () => resolve());
                }
              }),
              new Promise<void>((resolve) => setTimeout(resolve, 2000))
            ]);
          }
          
          if (redis.status === 'ready') {
            const redisData = await redis.get(credsRedisKey);
            if (redisData) {
              creds = JSON.parse(redisData, BufferJSON.reviver);
              memoryCache.setCreds(config.sessionId, creds);
              console.log('[HybridAuth] ✅ Creds carregadas do Redis');
            }
          } else {
            console.log('[HybridAuth] ⚠️  Redis não está pronto após timeout, pulando leitura do Redis');
          }
        }
      } catch (redisError: any) {
        if (redisError?.message?.includes('Bad MAC') || redisError?.message?.includes('bad mac')) {
          console.log(`[HybridAuth] ⚠️ Bad MAC no Redis para creds. Deletando e buscando no Supabase...`);
          const redis = (keyStore as any).redis;
          if (redis) {
            await redis.del(credsRedisKey).catch(() => {});
          }
        } else {
          console.error('[HybridAuth] ⚠️ Erro ao ler do Redis:', redisError);
        }
      }

      // 3. Tentar Supabase se ainda não encontrou
      if (!creds) {
        try {
          const supabase = (keyStore as any).supabase;
          const { data, error } = await supabase
            .from('whatsapp_auth_state')
            .select('value')
            .eq('key', 'creds')
            .eq('session_id', config.sessionId)
            .single();

          if (!error && data?.value) {
            try {
              creds = JSON.parse(data.value, BufferJSON.reviver);
              memoryCache.setCreds(config.sessionId, creds);
              console.log('[HybridAuth] ✅ Creds carregadas do Supabase');
              // Popular Redis (se estiver pronto)
              const redis = (keyStore as any).redis;
              if (redis && redis.status === 'ready') {
                await (keyStore as any).writeToRedis(credsRedisKey, data.value, false);
              }
            } catch (parseError: any) {
              if (parseError?.message?.includes('Bad MAC') || parseError?.message?.includes('bad mac')) {
                console.log(`[HybridAuth] ⚠️ Bad MAC no Supabase para creds. Deletando registro corrompido...`);
                await supabase
                  .from('whatsapp_auth_state')
                  .delete()
                  .eq('key', 'creds')
                  .eq('session_id', config.sessionId)
                  .catch(() => {});
              } else {
                console.error('[HybridAuth] ⚠️ Erro ao parsear creds do Supabase:', parseError);
              }
            }
          } else if (error) {
            console.log('[HybridAuth] ℹ️  Nenhuma cred encontrada no Supabase (primeira conexão)');
          }
        } catch (supabaseError) {
          console.error('[HybridAuth] ⚠️ Erro ao ler creds do Supabase:', supabaseError);
        }
      }
    } else {
      console.log('[HybridAuth] ✅ Creds encontradas na memória');
    }
  } catch (error) {
    console.error('[HybridAuth] ❌ Erro ao carregar creds:', error);
  }

  // Se não encontrou creds, inicializar com initAuthCreds (primeira conexão)
  if (!creds || Object.keys(creds).length === 0) {
    console.log('[HybridAuth] ℹ️  Nenhuma cred encontrada - inicializando credenciais com initAuthCreds() (primeira conexão)');
    try {
      creds = initAuthCreds();
      console.log('[HybridAuth] ✅ Credenciais geradas via initAuthCreds');
      console.log('[HybridAuth] Credenciais geradas:', {
        hasMe: !!creds.me,
        hasRegistered: !!creds.registered,
        hasAccount: !!creds.account,
        keys: Object.keys(creds),
      });
      
      // Salvar credenciais iniciais imediatamente
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      memoryCache.setCreds(config.sessionId, creds);
      
      // Salvar no Redis (se estiver pronto)
      const redis = (keyStore as any).redis;
      if (redis && redis.status === 'ready') {
        await (keyStore as any).writeToRedis(credsRedisKey, serialized, false);
        console.log('[HybridAuth] ✅ Credenciais iniciais salvas no Redis');
      }
      
      // Salvar no Supabase (assíncrono)
      (keyStore as any).queueSupabaseWrite(
        credsRedisKey,
        serialized,
        'whatsapp_auth_state',
        'key',
        'value'
      );
      console.log('[HybridAuth] ✅ Credenciais iniciais enfileiradas para Supabase');
    } catch (initError) {
      console.error('[HybridAuth] ❌ Erro ao inicializar credenciais com initAuthCreds:', initError);
      throw new Error(`Falha ao inicializar credenciais: ${initError instanceof Error ? initError.message : String(initError)}`);
    }
  }

  // Validar estrutura do state antes de retornar
  if (!creds || typeof creds !== 'object' || Object.keys(creds).length === 0) {
    console.error('[HybridAuth] ❌ Creds inválidas ou vazias após inicialização');
    throw new Error('Credenciais inválidas - não foi possível inicializar ou carregar credenciais');
  }

  // Criar estado
  const state: AuthenticationState = {
    creds,
    keys: keyStore,
  };

  console.log('[HybridAuth] ✅ Estado de autenticação criado:', {
    hasCreds: !!state.creds,
    credsKeys: Object.keys(state.creds || {}),
    credsKeysCount: Object.keys(state.creds || {}).length,
    hasKeys: !!state.keys,
    keysType: typeof state.keys,
    isFirstConnection: !state.creds.me && !state.creds.registered,
  });

  // Função saveCreds
  const saveCreds = async (): Promise<void> => {
    if (!state.creds) {
      console.log('[HybridAuth] ⚠️ saveCreds chamado mas state.creds está vazio');
      return;
    }

    try {
      console.log('[HybridAuth] 💾 saveCreds chamado - salvando credenciais...');
      const serialized = JSON.stringify(state.creds, BufferJSON.replacer);
      console.log(`[HybridAuth] Credenciais serializadas: ${serialized.length} bytes`);
      
      // Atualizar memória
      memoryCache.setCreds(config.sessionId, state.creds);
      console.log('[HybridAuth] ✅ Memória atualizada');

      // Atualizar Redis (síncrono)
      await (keyStore as any).writeToRedis(credsRedisKey, serialized, false);
      console.log('[HybridAuth] ✅ Redis atualizado');

      // Atualizar Supabase (assíncrono)
      (keyStore as any).queueSupabaseWrite(
        credsRedisKey,
        serialized,
        'whatsapp_auth_state',
        'key',
        'value'
      );
      console.log('[HybridAuth] ✅ Escrita no Supabase enfileirada');
    } catch (error) {
      console.error('[HybridAuth] ❌ Erro ao salvar creds:', error);
      if (error instanceof Error) {
        console.error('[HybridAuth] Stack trace:', error.stack);
      }
    }
  };

  return { state, saveCreds };
}
