import type { ConversationState } from './types';

export interface IConversationRepository {
  findById(conversationId: string): ConversationState | null;
  findAll(): ConversationState[];
  create(state: ConversationState): void;
  update(conversationId: string, updates: Partial<ConversationState>): void;
}

class InMemoryConversationRepository implements IConversationRepository {
  private conversations: Map<string, ConversationState> = new Map();

  findById(conversationId: string): ConversationState | null {
    return this.conversations.get(conversationId) || null;
  }

  findAll(): ConversationState[] {
    return Array.from(this.conversations.values());
  }

  create(state: ConversationState): void {
    this.conversations.set(state.conversationId, { ...state });
  }

  update(conversationId: string, updates: Partial<ConversationState>): void {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      });
    }
  }
}

export const createConversationRepository = (): IConversationRepository => {
  return new InMemoryConversationRepository();
};

