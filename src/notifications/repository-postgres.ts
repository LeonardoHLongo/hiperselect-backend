/**
 * PostgreSQL implementation of INotificationRepository using Supabase
 */

import type { INotificationRepository } from './repository';
import type { Notification, CreateNotificationInput } from './types';
import { supabase } from '../database/config';
import { randomUUID } from 'crypto';

class PostgresNotificationRepository implements INotificationRepository {
  async create(input: CreateNotificationInput): Promise<Notification> {
    // Verificar se já existe notificação não lida do mesmo tipo para esta conversa (idempotência)
    // Isso evita duplicação quando o mesmo evento é processado múltiplas vezes
    const { data: existing, error: checkError } = await supabase
      .from('notifications')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('conversation_id', input.conversationId)
      .eq('type', input.type)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Se já existe notificação não lida do mesmo tipo, retornar a existente (idempotência)
    if (existing && !checkError) {
      console.log(`[PostgresNotificationRepository] ℹ️  Notification already exists (idempotent): ${existing.id}`);
      console.log(`[PostgresNotificationRepository] ✅ Skipping duplicate notification creation`);
      return this.mapRowToNotification(existing);
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        id,
        tenant_id: input.tenantId,
        type: input.type,
        conversation_id: input.conversationId,
        is_read: false,
        created_at: now,
        metadata: input.metadata || null,
      })
      .select()
      .single();

    if (error) {
      // Se for erro de duplicata (pode acontecer em race condition), buscar a existente
      if (error.code === '23505') {
        console.log(`[PostgresNotificationRepository] ℹ️  Duplicate key detected (race condition), fetching existing notification`);
        const { data: existingData, error: fetchError } = await supabase
          .from('notifications')
          .select('*')
          .eq('tenant_id', input.tenantId)
          .eq('conversation_id', input.conversationId)
          .eq('type', input.type)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (existingData && !fetchError) {
          return this.mapRowToNotification(existingData);
        }
      }
      
      console.error('[PostgresNotificationRepository] ❌ Error creating notification:', error);
      throw error;
    }

    return this.mapRowToNotification(data);
  }

  async findByConversationId(conversationId: string, tenantId: string): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresNotificationRepository] ❌ Error fetching notifications:', error);
      return [];
    }

    return (data || []).map(this.mapRowToNotification);
  }

  async findUnreadByTenant(tenantId: string): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresNotificationRepository] ❌ Error fetching unread notifications:', error);
      return [];
    }

    return (data || []).map(this.mapRowToNotification);
  }

  async markAsRead(notificationId: string, tenantId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[PostgresNotificationRepository] ❌ Error marking notification as read:', error);
      throw error;
    }
  }

  async markConversationAsRead(conversationId: string, tenantId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('is_read', false);

    if (error) {
      console.error('[PostgresNotificationRepository] ❌ Error marking conversation notifications as read:', error);
      throw error;
    }
  }

  async delete(notificationId: string, tenantId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[PostgresNotificationRepository] ❌ Error deleting notification:', error);
      throw error;
    }
  }

  private mapRowToNotification(row: any): Notification {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type,
      conversationId: row.conversation_id,
      isRead: row.is_read,
      createdAt: new Date(row.created_at).getTime(),
      metadata: row.metadata || undefined,
    };
  }
}

export const createPostgresNotificationRepository = (): INotificationRepository => {
  return new PostgresNotificationRepository();
};
