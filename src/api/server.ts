import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerConversationRoutes } from './routes/conversations';
import { registerWhatsAppRoutes } from './routes/whatsapp';
import { registerWhatsAppStatusSSERoutes, broadcastWhatsAppStatus } from './routes/whatsapp-status-sse';
import { registerCompanyRoutes } from './routes/company';
import { registerStoreRoutes } from './routes/stores';
import { registerAuthRoutes } from './routes/auth';
import { registerNotificationRoutes } from './routes/notifications';
import { registerTicketRoutes } from './routes/tickets';
import { registerTeamRoutes } from './routes/team';
import { registerAIAssistRoutes } from './routes/ai-assist';
import { setStatusChangeCallback } from '../whatsapp/watchdog';
import { eventBus } from '../events';
import { authMiddleware } from '../auth';
import type { MessageService } from '../messages';
import type { WhatsAppAdapter } from '../whatsapp/adapter';
import type { CompanyService } from '../company';
import type { StoreService } from '../stores';
import type { AuthService } from '../auth';
import type { NotificationService } from '../notifications/service';
import type { TicketService } from '../tickets';

type ServerDependencies = {
  messageService: MessageService;
  whatsAppAdapter: WhatsAppAdapter;
  companyService?: CompanyService;
  storeService?: StoreService;
  authService?: AuthService;
  notificationService?: NotificationService;
  ticketService?: TicketService;
};

export const createServer = async (deps: ServerDependencies): Promise<Fastify.FastifyInstance> => {
  const fastify = Fastify({
    logger: false, // Desabilitar logger do Fastify completamente (fazemos logging manual apenas para requests essenciais)
  });

  // Registrar CORS
  await fastify.register(cors, {
    origin: true, // Permite todas as origens (em produção, especifique as origens permitidas)
    credentials: true,
  });
  console.log('[Server] CORS registered');

  // Registrar middleware de autenticação (exceto para /health e SSE)
  fastify.addHook('onRequest', async (request, reply) => {
    // Pular autenticação para rota de health check
    if (request.url === '/health') {
      return;
    }
    // Pular autenticação para SSE (usa token via query param)
    if (request.url.startsWith('/api/whatsapp/status/stream')) {
      return;
    }
    return authMiddleware(request, reply);
  });
  console.log('[Server] Auth middleware registered (except /health and /api/whatsapp/status/stream)');

  // Log apenas requisições essenciais (não GET de leitura)
  fastify.addHook('onRequest', async (request, reply) => {
    const startTime = Date.now();
    (request as any).startTime = startTime;
    
    // Filtrar requests não essenciais (GET de leitura e OPTIONS CORS)
    const nonEssentialPatterns = [
      /^\/api\/v1\/conversations$/, // GET /api/v1/conversations (listagem)
      /^\/api\/v1\/conversations\/[^/]+$/, // GET /api/v1/conversations/:id
      /^\/api\/v1\/conversations\/[^/]+\/messages$/, // GET /api/v1/conversations/:id/messages
      /^\/api\/whatsapp\/status$/, // GET /api/whatsapp/status (polling frequente)
      /^\/api\/v1\/notifications/, // Todas as rotas de notificações (polling frequente)
      /^\/api\/v1\/tickets\/count$/, // GET /api/v1/tickets/count (polling frequente)
    ];
    
    const isNonEssential = (request.method === 'GET' || request.method === 'OPTIONS') && 
      nonEssentialPatterns.some(pattern => pattern.test(request.url));
    
    if (isNonEssential) {
      // Não logar requests não essenciais
      return;
    }
    
    // Log apenas requests essenciais
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`[${new Date().toISOString()}] 🔵 REQUEST: ${request.method} ${request.url}`);
    console.log('───────────────────────────────────────────────────────────');
    if (Object.keys(request.headers).length > 0) {
      const headersToLog: Record<string, string> = {};
      Object.keys(request.headers).forEach((key) => {
        if (!key.toLowerCase().includes('authorization') && !key.toLowerCase().includes('cookie')) {
          headersToLog[key] = request.headers[key] as string;
        }
      });
      if (Object.keys(headersToLog).length > 0) {
        console.log('Headers:', JSON.stringify(headersToLog, null, 2));
      }
    }
    if (request.body && typeof request.body === 'object' && Object.keys(request.body as object).length > 0) {
      console.log('Body:', JSON.stringify(request.body, null, 2));
    }
    if (request.query && Object.keys(request.query).length > 0) {
      console.log('Query:', JSON.stringify(request.query, null, 2));
    }
    if (request.params && Object.keys(request.params).length > 0) {
      console.log('Params:', JSON.stringify(request.params, null, 2));
    }
    console.log('═══════════════════════════════════════════════════════════\n');
  });

  // Log apenas respostas de requisições essenciais
  fastify.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime || Date.now();
    const responseTime = Date.now() - startTime;
    
    // Filtrar requests não essenciais (mesmo padrão do onRequest)
    const nonEssentialPatterns = [
      /^\/api\/v1\/conversations$/, // GET /api/v1/conversations (listagem)
      /^\/api\/v1\/conversations\/[^/]+$/, // GET /api/v1/conversations/:id
      /^\/api\/v1\/conversations\/[^/]+\/messages$/, // GET /api/v1/conversations/:id/messages
      /^\/api\/whatsapp\/status$/, // GET /api/whatsapp/status (polling frequente)
      /^\/api\/v1\/notifications/, // Todas as rotas de notificações (polling frequente)
      /^\/api\/v1\/tickets\/count$/, // GET /api/v1/tickets/count (polling frequente)
    ];
    
    const isNonEssential = (request.method === 'GET' || request.method === 'OPTIONS') && 
      nonEssentialPatterns.some(pattern => pattern.test(request.url));
    
    if (isNonEssential) {
      // Não logar respostas de requests não essenciais
      return;
    }
    
    // Log apenas respostas essenciais
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`[${new Date().toISOString()}] 🟢 RESPONSE: ${request.method} ${request.url}`);
    console.log(`Status: ${reply.statusCode} | Time: ${responseTime}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');
  });

  // Log erros
  fastify.setErrorHandler((error, request, reply) => {
    console.error('\n=== ERROR ===');
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url}`);
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('=============\n');
    
    reply.code(error.statusCode || 500).send({
      success: false,
      message: error.message || 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
  });

  // Handler 404 customizado para debug
  fastify.setNotFoundHandler((request, reply) => {
    // Ignorar requisições do Next.js (webpack-hmr, etc)
    if (request.url.startsWith('/_next/') || request.url.startsWith('/favicon.ico')) {
      return reply.code(404).send({
        success: false,
        message: 'Not found (Next.js route)',
        errorCode: 'NOT_FOUND',
      });
    }
    
    console.error('\n=== 404 NOT FOUND ===');
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url}`);
    console.error('Available routes should include:');
    console.error('  - GET /api/v1/conversations');
    console.error('  - GET /api/v1/conversations/:id');
    console.error('  - GET /api/v1/conversations/:id/messages');
    console.error('  - GET /api/whatsapp/status');
    console.error('  - GET /api/whatsapp/qr');
    console.error('  - POST /api/whatsapp/connect');
    console.error('  - POST /api/whatsapp/disconnect');
    console.error('  - POST /api/whatsapp/reconnect');
    console.error('========================\n');
    
    reply.code(404).send({
      success: false,
      message: `Route ${request.method} ${request.url} not found`,
      errorCode: 'NOT_FOUND',
    });
  });

  // Health check endpoint (sem autenticação - deve ser pública)
  fastify.get('/health', async (request, reply) => {
    const whatsappStatus = deps.whatsAppAdapter.getConnectionStatus();
    const isHealthy = whatsappStatus.status === 'connected';
    
    const healthStatus = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'hiperselect-backend',
      services: {
        whatsapp: {
          status: whatsappStatus.status,
          error: whatsappStatus.error || null,
        },
        server: 'running',
      },
    };
    
    // Retornar 200 mesmo se WhatsApp estiver offline (servidor está funcionando)
    // Mas indicar status 'degraded' no body
    reply.type('application/json');
    return healthStatus;
  });

  // Registrar rotas diretamente no fastify
  console.log('[Server] Registering routes...');
      try {
        if (deps.authService) {
          registerAuthRoutes(fastify, deps.authService);
        }
        registerConversationRoutes(fastify, deps.messageService, deps.whatsAppAdapter, deps.notificationService);
        registerWhatsAppRoutes(fastify, { whatsAppAdapter: deps.whatsAppAdapter });
        registerWhatsAppStatusSSERoutes(fastify, { whatsAppAdapter: deps.whatsAppAdapter });
        
        if (deps.notificationService) {
          console.log('[Server] ✅ NotificationService available - registering routes');
          registerNotificationRoutes(fastify, deps.notificationService);
        } else {
          console.warn('[Server] ⚠️  NotificationService not available - notification routes will not be registered');
        }
        if (deps.ticketService) {
          console.log('[Server] ✅ TicketService available - registering routes');
          registerTicketRoutes(fastify, deps.ticketService);
        } else {
          console.warn('[Server] ⚠️  TicketService not available - ticket routes will not be registered');
        }
        if (deps.companyService) {
          registerCompanyRoutes(fastify, deps.companyService);
        }
        if (deps.storeService) {
          registerStoreRoutes(fastify, deps.storeService);
        }
        // Registrar rotas de gerenciamento de equipe (Multi-User RBAC)
        registerTeamRoutes(fastify);
        // Registrar rotas de AI Assist (Correção Gramatical)
        registerAIAssistRoutes(fastify);
    console.log('[Server] ✅ All routes registered successfully');
    
    // Configurar callback para broadcast de status via SSE (via watchdog)
    setStatusChangeCallback((status) => {
      broadcastWhatsAppStatus(status);
    });
    
    // Listener direto no eventBus para garantir propagação imediata de mudanças de status
    // Isso garante que mudanças de status (incluindo Bad MAC) sejam propagadas instantaneamente
    eventBus.on('whatsapp.connection.status', (payload: { status: 'connected' | 'disconnected' | 'connecting' | 'error'; error?: string }) => {
      console.log('[Server] 📡 Evento de status do WhatsApp recebido, propagando via SSE:', payload);
      broadcastWhatsAppStatus({
        status: payload.status,
        reason: payload.error || (payload.status === 'error' ? 'connection_error' : undefined),
        error: payload.error,
      });
    });
    
    // Listar rotas registradas após o servidor estar pronto
    fastify.ready().then(() => {
      console.log('\n[Server] 📋 Registered routes:');
      const routes = fastify.printRoutes();
      console.log(routes);
      console.log('\n[Server] ✅ Server ready and listening for requests');
    }).catch((err) => {
      console.error('[Server] Error listing routes:', err);
    });
  } catch (error) {
    console.error('[Server] ❌ Error registering routes:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
    throw error;
  }

  return fastify;
};

