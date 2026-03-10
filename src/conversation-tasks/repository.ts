/**
 * Conversation Tasks Repository Interface
 */

import type { ConversationTask, CreateConversationTaskInput, UpdateConversationTaskInput } from './types';

export interface IConversationTaskRepository {
  create(input: CreateConversationTaskInput): Promise<ConversationTask>;
  findById(id: string, tenantId: string): Promise<ConversationTask | null>;
  findByRequestCode(requestCode: string, tenantId: string): Promise<ConversationTask | null>;
  findPendingByConversationId(conversationId: string, tenantId: string): Promise<ConversationTask | null>;
  findPendingByStoreId(storeId: string, tenantId: string): Promise<ConversationTask[]>; // Buscar todas tasks pendentes de uma loja
  update(id: string, input: UpdateConversationTaskInput, tenantId: string): Promise<ConversationTask>;
  findExpiredTasks(tenantId: string): Promise<ConversationTask[]>;
}
