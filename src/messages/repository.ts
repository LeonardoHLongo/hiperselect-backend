import type { Message, Conversation } from './types';

import type { ConversationState } from './types';

export interface IMessageRepository {
  findByConversationId(conversationId: string, tenantId: string): Message[] | Promise<Message[]>;
  findById(messageId: string, tenantId: string): Message | null | Promise<Message | null>;
  create(message: Message, tenantId: string): void | Promise<void>;
  getAllConversations(tenantId: string): Conversation[] | Promise<Conversation[]>;
  getConversationTenantId(conversationId: string): string | null | Promise<string | null>; // Buscar tenantId da conversa
  updateConversationSender(conversationId: string, sender: { phoneNumber: string; jid: string; pushName?: string }, tenantId: string): void | Promise<void>;
  markConversationAsRead(conversationId: string, tenantId: string): void | Promise<void>;
  updateConversationState(conversationId: string, state: ConversationState, tenantId: string): void | Promise<void>;
  clearWaitingHuman(conversationId: string, tenantId: string): void | Promise<void>;
  updateSelectedStore(conversationId: string, storeId: string | null, storeName: string | null, tenantId: string): void | Promise<void>;
  updateStoreSelectionState(
    conversationId: string,
    state: {
      awaitingStoreSelection?: boolean;
      pendingQuestionText?: string | null;
      storeCandidates?: string[] | null;
    },
    tenantId: string
  ): void | Promise<void>;
  updatePendingToolState(
    conversationId: string,
    state: {
      pendingToolName?: string | null;
      pendingFields?: string[] | null;
      pendingContext?: Record<string, unknown> | null;
      pendingAttempts?: number;
    },
    tenantId: string
  ): void | Promise<void>;
  updateAIControl(
    conversationId: string,
    state: {
      aiEnabled: boolean;
      aiDisabledBy: 'human' | 'system' | 'tool';
      aiDisabledReason?: string | null;
    },
    tenantId: string
  ): void | Promise<void>;
  updateConversation(
    conversationId: string,
    updates: {
      isReputationAtRisk?: boolean;
      [key: string]: any;
    },
    tenantId: string
  ): void | Promise<void>;
  updateMessageText(messageId: string, text: string, tenantId: string): void | Promise<void>;
}

class InMemoryMessageRepository implements IMessageRepository {
  private messages: Map<string, Message> = new Map();
  private conversations: Map<string, Conversation> = new Map();

  /**
   * Busca mensagens de uma conversa
   * 
   * CONTRATO DE ORDENAÇÃO (GARANTIDO):
   * - Ordenação por: timestamp ASC, messageId ASC (como tie-breaker)
   * - Timestamp sempre em milissegundos
   * - Ordem determinística mesmo com timestamps iguais
   * - API sempre retorna já ordenado (frontend não deve fazer sort)
   */
  findByConversationId(conversationId: string, tenantId: string): Message[] {
    const messages = Array.from(this.messages.values())
      .filter((msg) => msg.conversationId === conversationId);
    
    // Ordenação robusta: (timestamp, messageId) como tie-breaker
    // messageId é único, então garante ordem determinística
    return messages.sort((a, b) => {
      // Primeiro critério: timestamp
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      // Segundo critério: messageId (sempre único, garante ordem determinística)
      return a.messageId.localeCompare(b.messageId);
    });
  }

  findById(messageId: string, tenantId: string): Message | null {
    return this.messages.get(messageId) || null;
  }

  create(message: Message, tenantId: string): void {
    this.messages.set(message.messageId, { ...message });

    const existing = this.conversations.get(message.conversationId);
    
    // Verificar se a mensagem é do sistema (não atualizar sender da conversa)
    const isSystemMessage = message.sender.phoneNumber === 'system' || 
                            message.sender.jid === 'system@s.whatsapp.net';
    const fromMe = message.baileysKey?.fromMe ?? false;
    
    // Determinar fromMe: true se for mensagem do sistema OU se baileysKey.fromMe for true
    const fromMeValue = isSystemMessage || fromMe;
    
    // Construir objeto lastMessage
    const lastMessage: Conversation['lastMessage'] = {
      id: message.messageId,
      text: message.text || undefined,
      type: message.messageType === 'other' ? 'text' : message.messageType,
      fromMe: fromMeValue, // true se for mensagem do sistema ou se baileysKey.fromMe for true
      timestamp: message.timestamp,
    };
    
    if (existing) {
      // Atualizar conversa existente
      // IMPORTANTE: NÃO atualizar sender se a mensagem for do sistema
      // Manter o sender original da conversa (do contato real)
      const updatedSender = isSystemMessage 
        ? existing.sender // Mensagem do sistema - manter sender original
        : message.sender.pushName 
          ? { ...message.sender } // Novo tem nome - usar
          : existing.sender.pushName 
            ? existing.sender // Existente tem nome, novo não - manter existente
            : { ...message.sender }; // Nenhum tem nome - usar novo (pode ter foto)
      
      // REGRA: Incrementar unreadCount apenas se NÃO for do sistema E NÃO for de mim
      const newUnreadCount = (!isSystemMessage && !fromMe) 
        ? (existing.unreadCount ?? 0) + 1 
        : existing.unreadCount ?? 0;
      
      this.conversations.set(message.conversationId, {
        ...existing,
        id: message.conversationId,
        participantId: message.conversationId,
        participantName: updatedSender.pushName,
        participantAvatarUrl: updatedSender.profilePictureUrl,
        state: existing.state || 'open', // Manter estado existente ou usar 'open' como padrão
        lastMessage,
        unreadCount: newUnreadCount,
        updatedAt: message.timestamp,
        lastMessageAt: message.timestamp,
        messageCount: existing.messageCount + 1,
        sender: updatedSender, // Nome vem do cache de contatos (contacts.upsert)
      });
    } else {
      // Nova conversa - usar sender da mensagem (mas não se for sistema)
      if (isSystemMessage) {
        // Não criar conversa com sender "system" - isso não deveria acontecer
        // Mas se acontecer, criar com sender vazio
        console.warn(`[Repository] ⚠️  Tentativa de criar conversa com mensagem do sistema: ${message.conversationId}`);
        this.conversations.set(message.conversationId, {
          id: message.conversationId,
          conversationId: message.conversationId,
          participantId: message.conversationId,
          participantName: undefined,
          participantAvatarUrl: undefined,
          sender: {
            phoneNumber: message.conversationId,
            jid: `${message.conversationId}@s.whatsapp.net`,
          },
          state: 'open', // Estado padrão para novas conversas
          lastMessage,
          unreadCount: 0, // Mensagem do sistema não incrementa
          updatedAt: message.timestamp,
          lastMessageAt: message.timestamp,
          messageCount: 1,
          createdAt: message.timestamp,
        });
      } else {
        const initialUnreadCount = !fromMe ? 1 : 0;
        this.conversations.set(message.conversationId, {
          id: message.conversationId,
          conversationId: message.conversationId,
          participantId: message.conversationId,
          participantName: message.sender.pushName,
          participantAvatarUrl: message.sender.profilePictureUrl,
          sender: message.sender, // Nome vem do cache de contatos
          state: 'open', // Estado padrão para novas conversas
          lastMessage,
          unreadCount: initialUnreadCount,
          updatedAt: message.timestamp,
          lastMessageAt: message.timestamp,
          messageCount: 1,
          createdAt: message.timestamp,
        });
      }
    }
  }

  /**
   * Atualiza o nome do remetente na conversa (chamado quando contacts.upsert fornece nome)
   */
  updateConversationSender(conversationId: string, sender: { phoneNumber: string; jid: string; pushName?: string }, tenantId: string): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        sender: {
          ...existing.sender,
          pushName: sender.pushName || existing.sender.pushName, // Atualizar nome se fornecido
        },
      });
    }
  }

  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt // Ordenar por updatedAt (mais recente primeiro)
    );
  }

  markConversationAsRead(conversationId: string, tenantId: string): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        unreadCount: 0,
        updatedAt: Date.now(),
      });
    }
  }

  updateConversationState(conversationId: string, state: ConversationState, tenantId: string): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      const updateData: Partial<Conversation> = {
        state,
        updatedAt: Date.now(),
      };
      
      // Se mudando para waiting_human, setar waitingHumanAt
      if (state === 'waiting_human') {
        updateData.waitingHumanAt = Date.now();
      } else if (state !== 'waiting_human') {
        // Se mudando para outro estado, limpar waitingHumanAt
        updateData.waitingHumanAt = null;
      }
      
      this.conversations.set(conversationId, {
        ...existing,
        ...updateData,
      });
    }
  }

  clearWaitingHuman(conversationId: string, tenantId: string): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        state: 'open',
        waitingHumanAt: null,
        updatedAt: Date.now(),
      });
    }
  }

  updateSelectedStore(conversationId: string, storeId: string | null, storeName: string | null, tenantId: string): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        selectedStoreId: storeId || undefined,
        selectedStoreName: storeName || undefined,
        updatedAt: Date.now(),
      });
    }
  }

  updateStoreSelectionState(
    conversationId: string,
    state: {
      awaitingStoreSelection?: boolean;
      pendingQuestionText?: string | null;
      storeCandidates?: string[] | null;
    },
    tenantId: string
  ): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        awaitingStoreSelection: state.awaitingStoreSelection ?? existing.awaitingStoreSelection,
        pendingQuestionText: state.pendingQuestionText !== undefined ? (state.pendingQuestionText || undefined) : existing.pendingQuestionText,
        storeCandidates: state.storeCandidates !== undefined ? (state.storeCandidates || undefined) : existing.storeCandidates,
        updatedAt: Date.now(),
      });
    }
  }

  updatePendingToolState(
    conversationId: string,
    state: {
      pendingToolName?: string | null;
      pendingFields?: string[] | null;
      pendingContext?: Record<string, unknown> | null;
      pendingAttempts?: number;
    },
    tenantId: string
  ): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        pendingToolName: state.pendingToolName !== undefined ? (state.pendingToolName || undefined) : existing.pendingToolName,
        pendingFields: state.pendingFields !== undefined ? (state.pendingFields || undefined) : existing.pendingFields,
        pendingContext: state.pendingContext !== undefined ? (state.pendingContext || undefined) : existing.pendingContext,
        pendingAttempts: state.pendingAttempts !== undefined ? state.pendingAttempts : (existing.pendingAttempts ?? 0),
        updatedAt: Date.now(),
      });
    }
  }

  updateAIControl(
    conversationId: string,
    state: {
      aiEnabled: boolean;
      aiDisabledBy: 'human' | 'system' | 'tool';
      aiDisabledReason?: string | null;
    },
    tenantId: string
  ): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        aiEnabled: state.aiEnabled,
        aiDisabledAt: state.aiEnabled ? null : Date.now(),
        aiDisabledBy: state.aiEnabled ? null : state.aiDisabledBy,
        aiDisabledReason: state.aiEnabled ? null : (state.aiDisabledReason || null),
        updatedAt: Date.now(),
      });
    }
  }

  getConversationTenantId(conversationId: string): string | null {
    // In-memory não tem tenantId - retornar null (não usado em produção)
    return null;
  }

  updateConversation(
    conversationId: string,
    updates: {
      isReputationAtRisk?: boolean;
      [key: string]: any;
    },
    tenantId: string
  ): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      });
    }
  }

  updateMessageText(messageId: string, text: string, tenantId: string): void {
    const message = this.messages.get(messageId);
    if (message) {
      this.messages.set(messageId, {
        ...message,
        text,
      });
    }
  }
}

export const createMessageRepository = (): IMessageRepository => {
  return new InMemoryMessageRepository();
};

