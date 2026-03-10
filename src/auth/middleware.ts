/**
 * Authentication Middleware
 * Extrai tenantId do JWT e injeta no request
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { extractTokenFromHeader, verifyToken } from './jwt';

/**
 * Estende o tipo FastifyRequest para incluir tenantId
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    userId?: string;
    userRole?: string;
  }
}

/**
 * Middleware de autenticação
 * Extrai token do header, valida e injeta tenantId no request
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Ignorar rotas públicas
  const publicRoutes = [
    '/health',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/whatsapp/status',
    '/api/whatsapp/qr',
    '/api/whatsapp/connect',
    '/api/whatsapp/disconnect',
    '/api/whatsapp/reconnect',
  ];
  if (publicRoutes.some((route) => request.url.startsWith(route))) {
    return;
  }

  // Extrair token do header
  const authHeader = request.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    reply.code(401).send({
      success: false,
      message: 'Authentication required',
      errorCode: 'UNAUTHORIZED',
    });
    return;
  }

  // Validar token
  const payload = verifyToken(token);

  if (!payload) {
    reply.code(401).send({
      success: false,
      message: 'Invalid or expired token',
      errorCode: 'UNAUTHORIZED',
    });
    return;
  }

  // Injetar dados no request
  request.tenantId = payload.tenantId;
  request.userId = payload.userId;
  request.userRole = payload.role;
}

