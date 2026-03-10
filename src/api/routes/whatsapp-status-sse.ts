/**
 * Server-Sent Events (SSE) endpoint para status do WhatsApp em tempo real
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WhatsAppAdapter } from '../../whatsapp/adapter';

type SSERoutesDependencies = {
  whatsAppAdapter: WhatsAppAdapter;
};

// Armazenar clientes conectados
const connectedClients = new Set<FastifyReply>();

/**
 * Broadcast status para todos os clientes conectados
 */
export function broadcastWhatsAppStatus(status: {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  reason?: string;
  error?: string;
}): void {
  const message = JSON.stringify({
    status: status.status === 'connected' ? 'online' : 'offline',
    reason: status.reason || status.error || 'unknown',
    timestamp: new Date().toISOString(),
  });

  // Enviar para todos os clientes conectados
  connectedClients.forEach((client) => {
    try {
      client.raw.write(`data: ${message}\n\n`);
    } catch (error) {
      // Cliente desconectado, remover da lista
      connectedClients.delete(client);
      console.error('[SSE] Erro ao enviar para cliente:', error);
    }
  });
}

export const registerWhatsAppStatusSSERoutes = (
  fastify: FastifyInstance,
  deps: SSERoutesDependencies
): void => {
  console.log('[Routes] Registering WhatsApp Status SSE routes...');

  // Handler OPTIONS para preflight CORS
  fastify.options('/api/whatsapp/status/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    reply.code(204).send();
  });

  // Endpoint SSE para status do WhatsApp
  fastify.get('/api/whatsapp/status/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('[SSE] Cliente conectado ao stream de status do WhatsApp');

    // Configurar CORS headers para SSE (importante para EventSource)
    reply.raw.setHeader('Access-Control-Allow-Origin', '*'); // Permitir todas as origens
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    
    // Configurar headers para SSE
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // Desabilitar buffering do nginx

    // Adicionar cliente à lista
    connectedClients.add(reply);

    // Enviar status inicial imediatamente
    const initialStatus = deps.whatsAppAdapter.getConnectionStatus();
    const initialStatusValue = initialStatus.status === 'connected' ? 'online' : 'offline';
    const initialMessage = JSON.stringify({
      status: initialStatusValue,
      reason: initialStatus.status === 'connected' ? 'connected' : (initialStatus.error || 'disconnected'),
      timestamp: new Date().toISOString(),
    });
    
    console.log('[SSE] Enviando status inicial:', {
      status: initialStatusValue,
      adapterStatus: initialStatus.status,
      error: initialStatus.error,
    });
    
    reply.raw.write(`data: ${initialMessage}\n\n`);

    // Enviar heartbeat a cada 30 segundos para manter conexão viva
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
        connectedClients.delete(reply);
      }
    }, 30000);

    // Limpar quando cliente desconectar
    request.raw.on('close', () => {
      console.log('[SSE] Cliente desconectado do stream de status do WhatsApp');
      clearInterval(heartbeatInterval);
      connectedClients.delete(reply);
    });

    // Manter conexão aberta
    return reply;
  });

  console.log('[Routes] WhatsApp Status SSE routes registered');
  console.log('[Routes] Available route: GET /api/whatsapp/status/stream');
};
