/**
 * Conversation Pipeline Types
 * Contratos definitivos - congelados após Fase 1
 */

/**
 * Contexto da conversa necessário para o pipeline tomar decisões
 */
export type ConversationContext = {
  conversationId: string;
  participantId: string;
  participantName?: string;
  aiEnabled: boolean;
  state: 'open' | 'waiting' | 'archived';
  unreadCount: number;
  lastMessageAt: number;
  messageCount: number;
  companyContext?: {
    businessName?: string;
    address?: string;
    openingHours?: string;
    deliveryPolicy?: string;
    paymentMethods?: string;
    internalNotes?: string;
  };
  stores?: Array<{
    id: string;
    name: string;
    address: string;
    neighborhood: string;
    city: string;
    openingHours: string;
    phone: string;
    isActive: boolean;
    managerWhatsappNumber?: string | null;
    managerWhatsappEnabled?: boolean;
  }>;
  policies?: Array<{
    id: string;
    title: string;
    content: string;
    applicableStores: string[];
    createdAt?: number;
    updatedAt?: number;
  }>;
  selectedStoreId?: string; // ID da loja selecionada pelo usuário
  selectedStoreName?: string; // Nome da loja selecionada
};

/**
 * Input para análise de mensagem
 */
export type MessageAnalysisInput = {
  messageId: string;
  conversationId: string;
  text: string | null;
  timestamp: number;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'other';
  conversationContext: ConversationContext;
};

/**
 * Decisão do BrainAI sobre como processar a mensagem
 */
export type BrainDecision = 
  | 'ALLOW_AUTO_RESPONSE'  // Permite resposta automática via AttendantAI
  | 'CREATE_TICKET'        // Deve criar ticket (não responde automaticamente)
  | 'WAIT_FOR_HUMAN'       // Aguarda intervenção humana
  | 'IGNORE';              // Ignora a mensagem (ex: spam, fora de horário)

/**
 * Resultado da análise do BrainAI
 */
export type BrainAnalysisResult = {
  decision: BrainDecision;
  reasoning: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Input para geração de resposta pelo AttendantAI
 */
export type ResponseGenerationInput = {
  messageId: string;
  conversationId: string;
  userMessage: string;
  conversationContext: ConversationContext;
  brainAnalysis?: BrainAnalysisResult; // Análise do BrainAI (se disponível)
};

/**
 * Resposta gerada pelo AttendantAI
 */
export type GeneratedResponse = {
  text: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Evento emitido quando uma resposta é gerada
 */
export type ResponseGeneratedEvent = {
  messageId: string;
  conversationId: string;
  response: GeneratedResponse;
  brainDecision: BrainDecision;
  timestamp: number;
  traceId: string;
};

/**
 * Evento emitido quando uma resposta é bloqueada
 */
export type ResponseBlockedEvent = {
  messageId: string;
  conversationId: string;
  reason: string;
  decision: BrainDecision;
  brainAnalysis?: BrainAnalysisResult;
  timestamp: number;
  traceId: string;
};
