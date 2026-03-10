export type ConversationState = {
  conversationId: string;
  aiEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  messageCount: number;
};

export type ConversationCreatedEvent = {
  conversationId: string;
  from: string;
  createdAt: number;
};

export type ConversationUpdatedEvent = {
  conversationId: string;
  updatedAt: number;
};

export type ConversationAiDisabledEvent = {
  conversationId: string;
  reason: string;
  timestamp: number;
};

export type ConversationAiEnabledEvent = {
  conversationId: string;
  enabledBy: string;
  timestamp: number;
};

