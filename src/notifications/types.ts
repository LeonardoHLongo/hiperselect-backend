/**
 * Notification Types
 * Tipos para notificações internas do sistema
 */

export type NotificationType = 'handoff_requested' | 'ai_disabled' | 'urgent_alert' | 'waiting_human' | 'other';

export type Notification = {
  id: string;
  tenantId: string;
  type: NotificationType;
  conversationId: string;
  isRead: boolean;
  createdAt: number;
  metadata?: {
    reason?: string;
    storeId?: string;
    storeName?: string;
    lastMessagePreview?: string;
    [key: string]: unknown;
  };
};

export type CreateNotificationInput = {
  tenantId: string;
  type: NotificationType;
  conversationId: string;
  metadata?: Notification['metadata'];
};
