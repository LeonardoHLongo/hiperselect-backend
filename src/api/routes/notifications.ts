/**
 * Notification Routes
 * Endpoints para gerenciar notificações internas
 */

import type { FastifyInstance } from 'fastify';
import type { NotificationService } from '../../notifications/service';

type NotificationRoutesDependencies = {
  notificationService: NotificationService;
};

export const registerNotificationRoutes = (
  fastify: FastifyInstance,
  notificationService: NotificationService
): void => {
  console.log('[Routes] Registering notification routes...');
  console.log('[Routes] ✅ NotificationService available:', !!notificationService);

  // GET /api/v1/notifications/unread - Listar notificações não lidas
  fastify.get('/api/v1/notifications/unread', async (request, reply) => {
    reply.type('application/json');
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const notifications = await notificationService.getUnreadNotifications(tenantId);
      return {
        success: true,
        data: notifications,
      };
    } catch (error) {
      console.error('[API] Error fetching unread notifications:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch notifications',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /api/v1/conversations/:id/notifications - Notificações de uma conversa
  fastify.get('/api/v1/conversations/:id/notifications', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const notifications = await notificationService.getNotificationsByConversation(id, tenantId);
      return {
        success: true,
        data: notifications,
      };
    } catch (error) {
      console.error(`[API] Error fetching notifications for conversation ${id}:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch notifications',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // PATCH /api/v1/notifications/:id/read - Marcar notificação como lida
  fastify.patch('/api/v1/notifications/:id/read', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      await notificationService.markAsRead(id, tenantId);
      return {
        success: true,
        data: { id, isRead: true },
      };
    } catch (error) {
      console.error(`[API] Error marking notification ${id} as read:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to mark notification as read',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // PATCH /api/v1/conversations/:id/notifications/read - Marcar todas as notificações de uma conversa como lidas
  fastify.patch('/api/v1/conversations/:id/notifications/read', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      await notificationService.markConversationAsRead(id, tenantId);
      return {
        success: true,
        data: { conversationId: id },
      };
    } catch (error) {
      console.error(`[API] Error marking conversation ${id} notifications as read:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to mark notifications as read',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};
