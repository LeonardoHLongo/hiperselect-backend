/**
 * PostgreSQL Implementation for Conversation Tasks Repository
 */

import { createClient } from '@supabase/supabase-js';
import type { IConversationTaskRepository } from './repository';
import type { ConversationTask, CreateConversationTaskInput, UpdateConversationTaskInput } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export class PostgresConversationTaskRepository implements IConversationTaskRepository {
  async create(input: CreateConversationTaskInput): Promise<ConversationTask> {
    const expiresAt = input.expiresAt || Date.now() + 20 * 60 * 1000; // 20 minutos padrão

    console.log('[PostgresConversationTaskRepository] 📋 Criando task', {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      storeId: input.storeId,
      type: input.type,
      requestCode: input.requestCode,
      payload: input.payload,
    });

    const { data, error } = await supabase
      .from('conversation_tasks')
      .insert({
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        store_id: input.storeId || null,
        type: input.type,
        status: 'pending',
        request_code: input.requestCode,
        payload: input.payload,
        expires_at: new Date(expiresAt).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[PostgresConversationTaskRepository] ❌ Error creating task:', error);
      console.error('[PostgresConversationTaskRepository] Error details:', JSON.stringify(error, null, 2));
      throw error;
    }

    console.log('[PostgresConversationTaskRepository] ✅ Task criada com sucesso', {
      taskId: data.id,
      requestCode: data.request_code,
    });

    return this.mapRowToTask(data);
  }

  async findById(id: string, tenantId: string): Promise<ConversationTask | null> {
    const { data, error } = await supabase
      .from('conversation_tasks')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapRowToTask(data);
  }

  async findByRequestCode(requestCode: string, tenantId: string): Promise<ConversationTask | null> {
    const { data, error } = await supabase
      .from('conversation_tasks')
      .select('*')
      .eq('request_code', requestCode)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapRowToTask(data);
  }

  async findPendingByConversationId(conversationId: string, tenantId: string): Promise<ConversationTask | null> {
    const { data, error } = await supabase
      .from('conversation_tasks')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return this.mapRowToTask(data);
  }

  async findPendingByStoreId(storeId: string, tenantId: string): Promise<ConversationTask[]> {
    const { data, error } = await supabase
      .from('conversation_tasks')
      .select('*')
      .eq('store_id', storeId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresConversationTaskRepository] ❌ Error finding pending tasks by store:', error);
      return [];
    }

    return (data || []).map(this.mapRowToTask);
  }

  async update(id: string, input: UpdateConversationTaskInput, tenantId: string): Promise<ConversationTask> {
    const updateData: any = {};

    if (input.status !== undefined) {
      updateData.status = input.status;
    }

    if (input.resultText !== undefined) {
      updateData.result_text = input.resultText;
    }

    const { data, error } = await supabase
      .from('conversation_tasks')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('[PostgresConversationTaskRepository] ❌ Error updating task:', error);
      throw error;
    }

    return this.mapRowToTask(data);
  }

  async findExpiredTasks(tenantId: string): Promise<ConversationTask[]> {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('conversation_tasks')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .lt('expires_at', now);

    if (error) {
      console.error('[PostgresConversationTaskRepository] ❌ Error finding expired tasks:', error);
      return [];
    }

    return (data || []).map(this.mapRowToTask);
  }

  private mapRowToTask(row: any): ConversationTask {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      storeId: row.store_id || null,
      type: row.type,
      status: row.status,
      requestCode: row.request_code,
      payload: row.payload || {},
      resultText: row.result_text || null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    };
  }
}
