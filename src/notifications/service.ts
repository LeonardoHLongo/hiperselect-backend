/**
 * Notification Service
 * Camada de serviço para notificações
 */

import type { INotificationRepository } from './repository';
import type { Notification, CreateNotificationInput } from './types';

export class NotificationService {
  constructor(private repository: INotificationRepository) {}

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    return await this.repository.create(input);
  }

  async getNotificationsByConversation(conversationId: string, tenantId: string): Promise<Notification[]> {
    return await this.repository.findByConversationId(conversationId, tenantId);
  }

  async getUnreadNotifications(tenantId: string): Promise<Notification[]> {
    return await this.repository.findUnreadByTenant(tenantId);
  }

  async markAsRead(notificationId: string, tenantId: string): Promise<void> {
    return await this.repository.markAsRead(notificationId, tenantId);
  }

  async markConversationAsRead(conversationId: string, tenantId: string): Promise<void> {
    return await this.repository.markConversationAsRead(conversationId, tenantId);
  }

  async deleteNotification(notificationId: string, tenantId: string): Promise<void> {
    return await this.repository.delete(notificationId, tenantId);
  }
}
