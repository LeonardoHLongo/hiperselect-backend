// Carregar variáveis de ambiente PRIMEIRO
import 'dotenv/config';

// Verificar se dotenv carregou corretamente
console.log('[Bootstrap] 🔍 Environment check:');
console.log('[Bootstrap] SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Loaded' : '❌ Not loaded');
console.log('[Bootstrap] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Loaded' : '❌ Not loaded');
console.log('[Bootstrap] USE_BULLMQ:', process.env.USE_BULLMQ || '❌ Not set');
console.log('[Bootstrap] REDIS_PUBLIC_URL:', process.env.REDIS_PUBLIC_URL ? `✅ Loaded (${process.env.REDIS_PUBLIC_URL.substring(0, 40)}...)` : '❌ Not loaded');
console.log('[Bootstrap] REDIS_URL:', process.env.REDIS_URL ? `✅ Loaded (${process.env.REDIS_URL.substring(0, 40)}...)` : '❌ Not loaded');
console.log('[Bootstrap] REDIS_HOST:', process.env.REDIS_HOST || '❌ Not loaded');

import { createServer } from '../api';
import { createWhatsAppAdapter } from '../whatsapp';
import { MessageService, createMessageRepository, createPostgresMessageRepository } from '../messages';
import { CompanyService, createCompanyRepository, createPostgresCompanyRepository } from '../company';
import { StoreService, createStoreRepository, createPostgresStoreRepository } from '../stores';
import { AuthService, createAuthRepository, createPostgresAuthRepository } from '../auth';
import { ConversationOrchestrator } from '../conversation-pipeline/orchestrator/orchestrator';
import { FakeAttendantAI } from '../conversation-pipeline';
import type { IAttendantAI } from '../conversation-pipeline/interfaces/AttendantAI';
import { NotificationService } from '../notifications/service';
import { createPostgresNotificationRepository } from '../notifications/repository-postgres';
import { TicketService } from '../tickets';
import { createPostgresTicketRepository } from '../tickets/repository-postgres';
import { ConversationTaskService } from '../conversation-tasks/service';
import { PostgresConversationTaskRepository } from '../conversation-tasks/repository-postgres';
import { wireEventHandlers } from './events';
import { wirePipelineHandlers } from './pipeline-handlers';
import { loadConfig } from './config';
import { InMemoryConversationMemoryCache } from '../conversation-pipeline/memory/InMemoryConversationMemoryCache';

const bootstrap = async (): Promise<void> => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║           HIPERSELECT BACKEND - STARTING UP              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  const config = loadConfig();
  console.log('[Bootstrap] Configuration loaded:', {
    port: config.port,
    whatsappSessionPath: config.whatsappSessionPath,
    usePostgres: config.usePostgres,
  });

  console.log('[Bootstrap] Initializing repositories...');
  
  // Usar PostgreSQL se configurado, senão usar in-memory
  const messageRepository = config.usePostgres
    ? createPostgresMessageRepository()
    : createMessageRepository();
  
  if (config.usePostgres) {
    console.log('[Bootstrap] ✅ Using PostgreSQL repository (Supabase)');
    console.log('[Bootstrap] 📊 All conversations and messages will be saved to Supabase');
    console.log('[Bootstrap] 📝 This includes: received messages, sent messages, and conversation updates');
    
    // Verificar se é realmente o repositório PostgreSQL
    const repoType = messageRepository.constructor.name;
    console.log(`[Bootstrap] 🔍 Repository type: ${repoType}`);
    
    if (repoType !== 'PostgresMessageRepository') {
      console.error('[Bootstrap] ❌ ERROR: Expected PostgresMessageRepository but got:', repoType);
      console.error('[Bootstrap] ❌ This means PostgreSQL is NOT being used!');
    } else {
      console.log('[Bootstrap] ✅ Confirmed: PostgresMessageRepository is active');
    }
  } else {
    console.log('[Bootstrap] ⚠️  Using in-memory repository (SUPABASE_URL not set)');
    console.log('[Bootstrap] ⚠️  WARNING: Data will be lost on restart! Set SUPABASE_URL to persist data.');
    console.log('[Bootstrap] 💡 Add SUPABASE_URL=https://ooancmvihrxzgtegvmwn.supabase.co to your .env file');
  }

  // Inicializar AuthService ANTES de criar MessageService (para obter defaultTenantId)
  const authRepository = config.usePostgres
    ? createPostgresAuthRepository()
    : createAuthRepository();
  const authService = new AuthService(authRepository);
  console.log('[Bootstrap] Auth service initialized');

  // Obter tenant padrão (primeiro tenant ativo) para mensagens recebidas via WhatsApp
  // IMPORTANTE: Fazer isso ANTES de criar o MessageService
  let defaultTenantId: string | undefined;
  if (config.usePostgres) {
    try {
      // Buscar primeiro tenant ativo como padrão
      const defaultTenant = await authRepository.getTenantById('00000000-0000-0000-0000-000000000001');
      if (defaultTenant && defaultTenant.isActive) {
        defaultTenantId = defaultTenant.id;
        console.log(`[Bootstrap] ✅ Default tenant configured: ${defaultTenant.name} (${defaultTenantId})`);
      } else {
        console.warn('[Bootstrap] ⚠️  Default tenant not found or inactive');
      }
    } catch (error) {
      console.error('[Bootstrap] ❌ Error fetching default tenant:', error);
    }
  }
  
  // Inicializar cache de memória (opcional)
  let memoryCache: InMemoryConversationMemoryCache | undefined;
  if (config.memoryCacheEnabled) {
    memoryCache = new InMemoryConversationMemoryCache(config.memoryCacheTtlSeconds);
    console.log(`[Bootstrap] ✅ Memory cache initialized (TTL: ${config.memoryCacheTtlSeconds}s)`);
  } else {
    console.log('[Bootstrap] ⚠️  Memory cache disabled');
  }

  const messageService = new MessageService(
    messageRepository,
    defaultTenantId,
    memoryCache, // Cache opcional
    config.memoryCacheTtlSeconds
  );
  console.log('[Bootstrap] Repositories initialized');

  // Inicializar CompanyService (opcional - para contexto da empresa)
  const companyRepository = config.usePostgres
    ? createPostgresCompanyRepository()
    : createCompanyRepository();
  const companyService = new CompanyService(companyRepository);
  console.log('[Bootstrap] Company service initialized');

  // Inicializar StoreService (para gerenciamento de lojas e políticas)
  const storeRepository = config.usePostgres
    ? createPostgresStoreRepository()
    : createStoreRepository();
  const storeService = new StoreService(storeRepository);
  console.log('[Bootstrap] Store service initialized');

  // Inicializar NotificationService (para alertas de handoff)
  const notificationRepository = config.usePostgres
    ? createPostgresNotificationRepository()
    : null; // Por enquanto, só suporta PostgreSQL
  const notificationService = notificationRepository
    ? new NotificationService(notificationRepository)
    : undefined;
  if (notificationService) {
    console.log('[Bootstrap] ✅ Notification service initialized');
  } else {
    console.log('[Bootstrap] ⚠️  Notification service not available (requires PostgreSQL)');
  }

  // Inicializar TicketService (para tickets de handoff sensível)
  const ticketRepository = config.usePostgres
    ? createPostgresTicketRepository()
    : null; // Por enquanto, só suporta PostgreSQL
  const ticketService = ticketRepository
    ? new TicketService(ticketRepository)
    : undefined;
  if (ticketService) {
    console.log('[Bootstrap] ✅ Ticket service initialized');
  } else {
    console.log('[Bootstrap] ⚠️  Ticket service not available (requires PostgreSQL)');
  }

  // Inicializar ConversationTaskService (para tasks de verificação com gerente)
  const taskRepository = config.usePostgres
    ? new PostgresConversationTaskRepository()
    : null; // Por enquanto, só suporta PostgreSQL
  
  // BullMQ será inicializado depois que whatsAppAdapter e storeService estiverem prontos
  let managerQueue: any = undefined;
  
  const taskService = taskRepository
    ? new ConversationTaskService(taskRepository)
    : undefined;
  
  if (taskService) {
    console.log('[Bootstrap] ✅ ConversationTask service initialized');
  } else {
    console.log('[Bootstrap] ⚠️  ConversationTask service not available (requires PostgreSQL)');
  }

  // Inicializar Conversation Orchestrator (Nova Arquitetura Router-Executor-Humanizer)
  if (!config.openaiApiKey) {
    console.error('[Bootstrap] ❌ OPENAI_API_KEY is required for ConversationOrchestrator');
    console.error('[Bootstrap] ❌ Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  // Validar formato da chave API
  if (config.openaiApiKey.trim().length === 0) {
    console.error('[Bootstrap] ❌ OPENAI_API_KEY is empty');
    console.error('[Bootstrap] ❌ Please set a valid OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  if (!config.openaiApiKey.startsWith('sk-')) {
    console.warn('[Bootstrap] ⚠️  OPENAI_API_KEY does not start with "sk-" - this may be incorrect');
  }

  console.log('[Bootstrap] Initializing Conversation Orchestrator (Router-Executor-Humanizer)...');
  console.log('[Bootstrap] OpenAI API Key:', config.openaiApiKey.substring(0, 7) + '...' + config.openaiApiKey.substring(config.openaiApiKey.length - 4));
  console.log('[Bootstrap] Model: gpt-5-nano (Router e Humanizer)');
  
  console.log('[Bootstrap] Creating WhatsApp adapter...');
  // Sistema de autenticação simplificado: apenas arquivos locais
  console.log('[Bootstrap] 📁 Using file-based auth cache (100% local)');

  const whatsAppAdapter = createWhatsAppAdapter({
    sessionPath: config.whatsappSessionPath,
    messageService, // Injetar MessageService para buscar mensagens durante retry
  });
  console.log('[Bootstrap] WhatsApp adapter created');

  let conversationOrchestrator: ConversationOrchestrator;
  try {
    conversationOrchestrator = new ConversationOrchestrator({
      messageService,
      storeService,
      ticketService, // Para criar tickets de handoff sensível
      taskService, // Para criar tasks de verificação com gerente
      notificationService, // Para notificações de handoff
      whatsAppAdapter, // Para processar mídia (áudio/imagem)
      openaiApiKey: config.openaiApiKey,
    });
    console.log('[Bootstrap] ✅ Conversation Orchestrator initialized');
  } catch (error) {
    console.error('[Bootstrap] ❌ Failed to initialize Conversation Orchestrator:', error);
    console.error('[Bootstrap] ❌ Error details:', error instanceof Error ? error.message : String(error));
    console.error('[Bootstrap] ❌ Stack:', error instanceof Error ? error.stack : 'No stack');
    process.exit(1);
  }

  // Inicializar BullMQ para gerenciar timeouts (opcional - requer Redis)
  let feedbackQueue: any = undefined;
  let messageGroupingQueue: any = undefined;
  
  if (taskService && (process.env.USE_BULLMQ === 'true' || process.env.USE_BULLMQ === '1')) {
    // Verificar se há configuração do Redis
    const hasRedisPublicUrl = !!process.env.REDIS_PUBLIC_URL;
    const hasRedisUrl = !!process.env.REDIS_URL;
    const hasRedisHost = !!process.env.REDIS_HOST;
    
    if (!hasRedisPublicUrl && !hasRedisUrl && !hasRedisHost) {
      console.warn('[Bootstrap] ⚠️  USE_BULLMQ=true mas nenhuma variável de Redis configurada');
      console.warn('[Bootstrap] ⚠️  Configure REDIS_PUBLIC_URL, REDIS_URL ou REDIS_HOST/REDIS_PORT/REDIS_PASSWORD');
      console.warn('[Bootstrap] ⚠️  BullMQ não será inicializado. Tasks serão criadas, mas timeout não será gerenciado.');
    } else {
      try {
        const { ManagerVerificationQueue } = await import('../conversation-pipeline/queue/manager-verification-queue');
        
        // Prioridade: RedisPublicURL > RedisUrl > host/port/password
        let redisConnection: string | { host: string; port: number; password?: string; username?: string };
        let connectionSource = '';
        
        if (process.env.REDIS_PUBLIC_URL) {
          // Usar URL pública do Redis (Railway)
          redisConnection = process.env.REDIS_PUBLIC_URL.trim();
          connectionSource = 'REDIS_PUBLIC_URL';
          console.log('[Bootstrap] 🔗 Using REDIS_PUBLIC_URL for BullMQ connection');
        } else if (process.env.REDIS_URL) {
          // Usar URL do Redis (Railway internal)
          redisConnection = process.env.REDIS_URL.trim();
          connectionSource = 'REDIS_URL';
          console.log('[Bootstrap] 🔗 Using REDIS_URL for BullMQ connection');
        } else {
          // Usar host/port/password separados
          const redisHost = (process.env.REDIS_HOST || '').trim();
          const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
          const redisPassword = process.env.REDIS_PASSWORD?.trim();
          const redisUser = (process.env.REDIS_USER || process.env.REDIS_USERNAME || '').trim();
          
          if (!redisHost) {
            throw new Error('REDIS_HOST não configurado. Configure REDIS_HOST ou use REDIS_PUBLIC_URL/REDIS_URL');
          }
          
          redisConnection = {
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            username: redisUser || undefined,
          };
          connectionSource = 'REDIS_HOST/REDIS_PORT';
          console.log('[Bootstrap] 🔗 Using REDIS_HOST/REDIS_PORT for BullMQ connection', {
            host: redisHost,
            port: redisPort,
            hasPassword: !!redisPassword,
            hasUsername: !!redisUser,
          });
        }
        
        managerQueue = new ManagerVerificationQueue({
          taskService,
          whatsAppAdapter,
          storeService,
          redisConnection,
        });
        
        // Conectar queue ao taskService
        taskService.setManagerQueue(managerQueue);
        
        const connectionInfo = typeof redisConnection === 'string' 
          ? { 
              type: 'URL', 
              source: connectionSource,
              url: redisConnection.replace(/:[^:@]+@/, ':****@'), // Mascarar senha na URL
            }
          : { 
              type: 'host/port', 
              source: connectionSource,
              host: redisConnection.host, 
              port: redisConnection.port, 
              hasPassword: !!redisConnection.password,
              hasUsername: !!redisConnection.username,
            };
        
        console.log('[Bootstrap] ✅ BullMQ ManagerVerificationQueue initialized', connectionInfo);
        
        // Inicializar FeedbackQueue (mesma conexão Redis)
        try {
          const { FeedbackQueue } = await import('../conversation-pipeline/queue/feedback-queue');
          
          feedbackQueue = new FeedbackQueue({
            messageService,
            whatsAppAdapter,
            storeService,
            humanizer: conversationOrchestrator.humanizer,
            openaiApiKey: config.openaiApiKey,
            redisConnection,
          });
          
          console.log('[Bootstrap] ✅ BullMQ FeedbackQueue initialized');
          
          // Atualizar Orchestrator com FeedbackQueue
          (conversationOrchestrator as any).deps.feedbackQueue = feedbackQueue;
          // Atualizar Executor com FeedbackQueue e MessageService
          (conversationOrchestrator as any).executor.deps.feedbackQueue = feedbackQueue;
          (conversationOrchestrator as any).executor.deps.messageService = messageService;
          
          // Inicializar MessageGroupingQueue (mesma conexão Redis)
          try {
            console.log('[Bootstrap] 🔧 Inicializando MessageGroupingQueue...');
            console.log('[Bootstrap] 📋 Verificando dependências:', {
              hasOrchestrator: !!conversationOrchestrator,
              hasMessageService: !!messageService,
              hasRedisConnection: !!redisConnection,
              redisConnectionType: typeof redisConnection,
            });
            
            const { MessageGroupingQueue } = await import('../conversation-pipeline/queue/message-grouping-queue');
            console.log('[Bootstrap] ✅ Classe MessageGroupingQueue importada com sucesso');
            
            console.log('[Bootstrap] 🔨 Instanciando MessageGroupingQueue...');
            messageGroupingQueue = new MessageGroupingQueue({
              conversationOrchestrator,
              messageService,
              redisConnection,
            });
            
            // Aguardar Redis estar pronto antes de considerar inicializado
            console.log('[Bootstrap] ⏳ Aguardando Redis estar pronto para MessageGroupingQueue...');
            try {
              await messageGroupingQueue.waitForReady();
              console.log('[Bootstrap] ✅ BullMQ MessageGroupingQueue initialized e Redis pronto');
            } catch (error) {
              console.error('[Bootstrap] ❌ Erro ao aguardar Redis estar pronto:', error);
              console.warn('[Bootstrap] ⚠️ MessageGroupingQueue será desabilitada - mensagens serão processadas imediatamente');
              messageGroupingQueue = undefined;
            }
          } catch (error) {
            console.error('[Bootstrap] ❌ Erro ao inicializar BullMQ MessageGroupingQueue:', error);
            console.error('[Bootstrap] ❌ Error details:', error instanceof Error ? error.message : String(error));
            console.error('[Bootstrap] ❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
            console.error('[Bootstrap] ❌ Error name:', error instanceof Error ? error.name : 'Unknown');
            // Não bloquear startup se MessageGroupingQueue falhar
            messageGroupingQueue = undefined;
            console.warn('[Bootstrap] ⚠️ MessageGroupingQueue desabilitado - mensagens serão processadas imediatamente');
          }
        } catch (error) {
          console.error('[Bootstrap] ❌ Erro ao inicializar BullMQ FeedbackQueue:', error);
          console.error('[Bootstrap] ❌ Error details:', error instanceof Error ? error.message : String(error));
          // Não bloquear startup se FeedbackQueue falhar
        }
      } catch (error) {
        console.error('[Bootstrap] ❌ Failed to initialize BullMQ:', error instanceof Error ? error.message : String(error));
        console.error('[Bootstrap] ❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
        console.error('[Bootstrap] ❌ Verifique se:');
        console.error('[Bootstrap]   1. As variáveis de ambiente do Redis estão corretas');
        console.error('[Bootstrap]   2. O Redis está acessível e rodando');
        console.error('[Bootstrap]   3. As credenciais estão corretas');
        console.warn('[Bootstrap] ⚠️  Task expiration will not work. Tasks will still be created, but timeout of 20 minutes will not be enforced automatically.');
      }
    }
  } else {
    if (!taskService) {
      console.log('[Bootstrap] ⚠️  BullMQ disabled (taskService not available)');
    } else {
      console.log('[Bootstrap] ⚠️  BullMQ disabled (set USE_BULLMQ=true to enable)');
    }
  }

  console.log('[Bootstrap] Wiring event handlers...');
  wireEventHandlers({
    messageService,
    conversationOrchestrator,
    taskService,
    messageGroupingQueue,
  });
  console.log('[Bootstrap] Event handlers wired');

  console.log('[Bootstrap] Wiring pipeline handlers...');
  wirePipelineHandlers({
    whatsAppAdapter,
    messageService,
    notificationService,
    taskService,
    storeService,
    humanizer: conversationOrchestrator.humanizer, // Usar humanizer do orchestrator
  });
  console.log('[Bootstrap] Pipeline handlers wired');

  // Inicializar Watchdog de Conexão WhatsApp
  let watchdog: any = null;
  try {
    const { WhatsAppWatchdog } = await import('../whatsapp/watchdog');
    watchdog = new WhatsAppWatchdog(whatsAppAdapter, {
      alertPhoneNumber: process.env.WHATSAPP_ALERT_PHONE_NUMBER || undefined,
      webhookUrl: process.env.WHATSAPP_ALERT_WEBHOOK_URL || undefined,
      reconnectTimeoutMs: 60000, // 60 segundos (aumentado para autenticação híbrida)
      enableAlerts: process.env.WHATSAPP_ALERT_ENABLED !== 'false', // Default: true
    });
    whatsAppAdapter.setWatchdog(watchdog);
    console.log('[Bootstrap] ✅ WhatsApp Watchdog inicializado');
  } catch (error) {
    console.error('[Bootstrap] ⚠️  Erro ao inicializar WhatsApp Watchdog:', error);
    console.log('[Bootstrap] Sistema continuará funcionando sem watchdog');
  }

  console.log('[Bootstrap] Creating Fastify server...');
  const server = await createServer({
    messageService,
    whatsAppAdapter,
    companyService,
    storeService,
    authService,
    notificationService,
    ticketService,
  });
  console.log('[Bootstrap] Server created');

  // Tentar reconectar automaticamente se houver sessão válida
  console.log('[Bootstrap] Checking for existing WhatsApp session...');
  try {
    const hasSession = await whatsAppAdapter.hasValidSession();
    if (hasSession) {
      console.log('[Bootstrap] ✅ Valid session found - attempting automatic reconnection...');
      // Conectar em background (não bloquear bootstrap)
      whatsAppAdapter.connect().catch((error) => {
        console.error('[Bootstrap] ⚠️  Automatic reconnection failed:', error);
        console.log('[Bootstrap] User can connect manually via API');
      });
    } else {
      console.log('[Bootstrap] ℹ️  No valid session found - user must connect manually via API');
    }
  } catch (error) {
    console.error('[Bootstrap] ⚠️  Error checking session:', error);
    console.log('[Bootstrap] User can connect manually via API');
  }

  try {
    console.log(`[Bootstrap] Starting server on port ${config.port}...`);
    await server.listen({ port: config.port, host: '0.0.0.0' });
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log(`║  ✅ Server listening on http://0.0.0.0:${config.port}      ║`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('[Bootstrap] ❌ Failed to start server:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
    process.exit(1);
  }
};

bootstrap().catch((error) => {
  console.error('[Bootstrap] Fatal error:', error);
  process.exit(1);
});

