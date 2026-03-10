/**
 * Notification Repository Interface
 */

import type { Notification, CreateNotificationInput } from './types';

export interface INotificationRepository {
  create(input: CreateNotificationInput): Promise<Notification>;
  findByConversationId(conversationId: string, tenantId: string): Promise<Notification[]>;
  findUnreadByTenant(tenantId: string): Promise<Notification[]>;
  markAsRead(notificationId: string, tenantId: string): Promise<void>;
  markConversationAsRead(conversationId: string, tenantId: string): Promise<void>;
  delete(notificationId: string, tenantId: string): Promise<void>;
}
