import { eventBus } from '../events';
import type { IConversationRepository } from './repository';
import type { ConversationState } from './types';

export class ConversationService {
  constructor(private repository: IConversationRepository) {}

  getOrCreate(conversationId: string, from: string): ConversationState {
    const existing = this.repository.findById(conversationId);

    if (existing) {
      return existing;
    }

    const now = Date.now();
    const newState: ConversationState = {
      conversationId,
      aiEnabled: true,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
    };

    this.repository.create(newState);

    eventBus.emit(
      'conversation.created',
      {
        conversationId,
        from,
        createdAt: now,
      },
      this.generateTraceId()
    );

    return newState;
  }

  updateMessageCount(conversationId: string): void {
    const existing = this.repository.findById(conversationId);
    if (existing) {
      this.repository.update(conversationId, {
        messageCount: existing.messageCount + 1,
        lastMessageAt: Date.now(),
      });

      eventBus.emit(
        'conversation.updated',
        {
          conversationId,
          updatedAt: Date.now(),
        },
        this.generateTraceId()
      );
    }
  }

  disableAI(conversationId: string, reason: string): void {
    const existing = this.repository.findById(conversationId);
    if (existing && existing.aiEnabled) {
      this.repository.update(conversationId, { aiEnabled: false });

      eventBus.emit(
        'conversation.ai.disabled',
        {
          conversationId,
          reason,
          timestamp: Date.now(),
        },
        this.generateTraceId()
      );
    }
  }

  enableAI(conversationId: string, enabledBy: string): void {
    const existing = this.repository.findById(conversationId);
    if (existing && !existing.aiEnabled) {
      this.repository.update(conversationId, { aiEnabled: true });

      eventBus.emit(
        'conversation.ai.enabled',
        {
          conversationId,
          enabledBy,
          timestamp: Date.now(),
        },
        this.generateTraceId()
      );
    }
  }

  isAiEnabled(conversationId: string): boolean {
    const state = this.repository.findById(conversationId);
    return state?.aiEnabled ?? true;
  }

  getAll(): ConversationState[] {
    return this.repository.findAll();
  }

  getById(conversationId: string): ConversationState | null {
    return this.repository.findById(conversationId);
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

