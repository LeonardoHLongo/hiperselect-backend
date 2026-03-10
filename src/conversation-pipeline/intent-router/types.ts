/**
 * Tipos para o Intent Router
 */
import type { RouterResult, Intent, Sentiment, Entities } from './schemas';

export type RouterInput = {
  messageId: string;
  conversationId: string;
  messageText: string;
  contextSnapshot?: ContextSnapshot;
  messageHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; // Últimas 5 mensagens
  availableStores?: Array<{ id: string; name: string; neighborhood: string }>; // Lista de lojas disponíveis para matching
  traceId?: string; // Para rastreabilidade
  isManager?: boolean; // Se true, bloquear intents de cliente (PRICE_INQUIRY, RESERVATION_REQUEST)
  lastSystemAction?: string; // Última ação do sistema (ex: 'feedback_checkin', 'asking_store', 'confirming_order')
};

export type RouterOutput = RouterResult;

/**
 * ContextSnapshot - Substitui histórico longo
 * Contém apenas informações essenciais do estado atual
 */
export type ContextSnapshot = {
  currentIntent?: Intent;
  selectedStoreId?: string;
  selectedStoreName?: string;
  isReputationAtRisk: boolean;
  lastInteractionAt: number;
  sentimentHistory: Sentiment[]; // Últimos 3 sentimentos
  pendingFields?: string[]; // Campos pendentes (ex: ['store', 'product'])
  entities?: Entities; // Entidades persistidas da conversa (para Entity Merging)
  lastSystemAction?: string; // Última ação do sistema (ex: 'asking_store', 'asking_product')
  retryCount?: Record<string, number>; // Contador de tentativas por ação para anti-loop (ex: { 'asking_product': 2 })
};
