import type { IMessageRepository } from './repository';
import type { Message, Conversation, ConversationState } from './types';
import type { ConversationMemoryCache } from '../conversation-pipeline/memory/ConversationMemoryCache';

export class MessageService {
  constructor(
    private repository: IMessageRepository,
    private defaultTenantId?: string, // Tenant padrão para mensagens recebidas via WhatsApp
    private memoryCache?: ConversationMemoryCache, // Cache opcional de memória
    private cacheTtlSeconds: number = 60 // TTL padrão do cache
  ) {}

  async getConversations(tenantId?: string): Promise<Conversation[]> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.getAllConversations(finalTenantId);
    return result instanceof Promise ? await result : result;
  }

  /**
   * Busca o tenantId de uma conversa no banco
   * Retorna null se a conversa não existir
   * IMPORTANTE: Usar este método ao invés de defaultTenantId para garantir tenantId correto
   */
  async getConversationTenantId(conversationId: string): Promise<string | null> {
    const result = this.repository.getConversationTenantId(conversationId);
    return result instanceof Promise ? await result : result;
  }

  async getConversationById(conversationId: string, tenantId?: string): Promise<Conversation | null> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const conversations = await this.getConversations(finalTenantId);
    return conversations.find((c) => c.conversationId === conversationId) || null;
  }

  async getConversationsByIds(conversationIds: string[], tenantId?: string): Promise<Conversation[]> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.getConversationsByIds(conversationIds, finalTenantId);
    return result instanceof Promise ? await result : result;
  }

  async getMessagesByConversationId(conversationId: string, tenantId?: string, limit?: number): Promise<Message[]> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }

    // Se cache está habilitado e limit foi especificado, tentar buscar do cache primeiro
    if (this.memoryCache && limit) {
      try {
        const cachedMessages = await this.memoryCache.getLastMessages(finalTenantId, conversationId, limit);
        if (cachedMessages !== null) {
          console.log(`[MessageService] ✅ Cache hit for conversation ${conversationId} (limit: ${limit})`);
          return cachedMessages as Message[];
        }
        console.log(`[MessageService] ⚠️  Cache miss for conversation ${conversationId} (limit: ${limit})`);
      } catch (error) {
        // Se cache falhar, continuar com busca no DB (cache é opcional)
        console.error(`[MessageService] ❌ Cache error (falling back to DB):`, error);
      }
    }

    // Buscar do banco de dados
    const result = this.repository.findByConversationId(conversationId, finalTenantId);
    const messages = result instanceof Promise ? await result : result;

    // Se cache está habilitado e limit foi especificado, armazenar no cache
    if (this.memoryCache && limit) {
      try {
        // Pegar últimas N mensagens
        const lastMessages = messages.slice(-limit);
        await this.memoryCache.setLastMessages(
          finalTenantId,
          conversationId,
          limit,
          lastMessages,
          this.cacheTtlSeconds
        );
        console.log(`[MessageService] 💾 Cached ${lastMessages.length} messages for conversation ${conversationId} (TTL: ${this.cacheTtlSeconds}s)`);
      } catch (error) {
        // Se cache falhar ao salvar, ignorar (cache é opcional)
        console.error(`[MessageService] ❌ Cache error (ignoring):`, error);
      }
    }

    return messages;
  }

  async getMessageById(messageId: string, tenantId?: string): Promise<Message | null> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.findById(messageId, finalTenantId);
    return result instanceof Promise ? await result : result;
  }

  async storeMessage(message: Message, tenantId?: string): Promise<void> {
    // Se tenantId não for fornecido, usar o tenant padrão (para mensagens recebidas via WhatsApp)
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }

    console.log(`[MessageService] Storing message: ${message.messageId}`);
    console.log(`[MessageService] Conversation: ${message.conversationId}`);
    console.log(`[MessageService] TenantId: ${finalTenantId}`);
    console.log(`[MessageService] Message type: ${message.messageType}`);
    console.log(`[MessageService] Text: ${message.text || '(no text)'}`);
    console.log(`[MessageService] Has media: ${!!message.media}`);
    if (message.media) {
      console.log(`[MessageService] Media type: ${message.media.type}, mimetype: ${message.media.mimetype}`);
    }
    const result = this.repository.create(message, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
    console.log(`[MessageService] Message stored successfully`);

    // Invalidar cache após salvar nova mensagem
    if (this.memoryCache) {
      try {
        await this.memoryCache.invalidate(finalTenantId, message.conversationId);
        console.log(`[MessageService] 🗑️  Cache invalidated for conversation ${message.conversationId}`);
      } catch (error) {
        // Se cache falhar ao invalidar, ignorar (cache é opcional)
        console.error(`[MessageService] ❌ Cache invalidation error (ignoring):`, error);
      }
    }
  }

  /**
   * Atualiza o nome do remetente na conversa
   * Chamado quando contacts.upsert fornece nome do contato
   */
  async updateConversationSender(conversationId: string, sender: { phoneNumber: string; jid: string; pushName?: string }, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateConversationSender(conversationId, sender, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * Marca conversa como lida (zera unread_count)
   * Chamado quando o frontend abre a conversa (GET /api/v1/conversations/:id/messages)
   */
  async markConversationAsRead(conversationId: string, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.markConversationAsRead(conversationId, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * Atualiza o estado da conversa (open, waiting, archived)
   */
  async updateConversationState(conversationId: string, state: ConversationState, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateConversationState(conversationId, state, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateSelectedStore(conversationId: string, storeId: string | null, storeName: string | null, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateSelectedStore(conversationId, storeId, storeName, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateStoreSelectionState(
    conversationId: string,
    state: {
      awaitingStoreSelection?: boolean;
      pendingQuestionText?: string | null;
      storeCandidates?: string[] | null;
    },
    tenantId?: string
  ): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateStoreSelectionState(conversationId, state, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updatePendingToolState(
    conversationId: string,
    state: {
      pendingToolName?: string | null;
      pendingFields?: string[] | null;
      pendingContext?: Record<string, unknown> | null;
      pendingAttempts?: number;
    },
    tenantId?: string
  ): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updatePendingToolState(conversationId, state, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateAIControl(
    conversationId: string,
    state: {
      aiEnabled: boolean;
      aiDisabledBy: 'human' | 'system' | 'tool';
      aiDisabledReason?: string | null;
    },
    tenantId?: string
  ): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateAIControl(conversationId, state, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateConversation(
    conversationId: string,
    updates: {
      isReputationAtRisk?: boolean;
      [key: string]: any;
    },
    tenantId?: string
  ): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateConversation(conversationId, updates, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateConversationState(conversationId: string, state: ConversationState, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateConversationState(conversationId, state, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async clearWaitingHuman(conversationId: string, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.clearWaitingHuman(conversationId, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }

  async updateMessageText(messageId: string, text: string, tenantId?: string): Promise<void> {
    const finalTenantId = tenantId || this.defaultTenantId;
    if (!finalTenantId) {
      throw new Error('TenantId is required. Either provide it explicitly or set a default tenant.');
    }
    const result = this.repository.updateMessageText(messageId, text, finalTenantId);
    if (result instanceof Promise) {
      await result;
    }
  }
}

