/**
 * Tipos para o Intent Executor
 * Camada de Ações Estratégicas
 */
import type { Intent, RouterResult, ConsolidatedRouterResult } from '../intent-router/schemas';
import type { ContextSnapshot } from '../intent-router/types';

export type ExecutorInput = {
  messageId: string;
  conversationId: string;
  messageText: string;
  routerResult: ConsolidatedRouterResult; // Agora aceita RouterResult + Entities
  contextSnapshot: ContextSnapshot;
  messageHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; // Últimas 5 mensagens para Trava de Contexto
  tenantId: string;
  traceId?: string;
};

/**
 * Dados estruturados retornados pelo Executor
 * O Executor NÃO gera texto - apenas retorna variáveis para o Agente Boca
 */
export type ExecutorData = 
  | StoreInfoData
  | PriceInquiryData
  | TaskCreatedData
  | HandoffData
  | NeedInputData
  | SalutationData
  | ManagerResponseData
  | ReservationRequestData
  | FeedbackCheckinData
  | FeedbackPromoterData
  | FeedbackDissatisfiedData
  | SilentDropData
  | AlreadyPendingData;

export type StoreInfoData = {
  type: 'store_info';
  store: {
    name: string;
    address: string;
    phone: string;
    openingHours: string | null;
    neighborhood?: string;
    city?: string;
  };
};

export type PriceInquiryData = {
  type: 'price_inquiry';
  store: {
    name: string;
    phone: string;
    openingHours: string | null;
  };
  hasManager: boolean;
};

export type TaskCreatedData = {
  type: 'task_created';
  store: {
    id: string;
    name: string;
  };
  product: string;
  taskType: 'promotion' | 'availability' | 'price';
};

export type HandoffData = {
  type: 'handoff';
  reason: 'urgent_complaint' | 'human_request' | 'ai_uncertainty' | 'reputation_risk';
  ticketCreated: boolean;
};

export type NeedInputData = {
  type: 'need_input';
  missingFields: string[];
  context: string; // Contexto para o Agente Boca entender o que perguntar
  selectedStoreId?: string; // Loja já identificada (se houver)
  selectedStoreName?: string; // Nome da loja já identificada (se houver)
  storeConfirmationNeeded?: boolean; // true quando precisa confirmar mudança de loja
  newStoreName?: string; // Nome da nova loja extraída (para confirmação)
  oldStoreName?: string; // Nome da loja anterior (para confirmação)
};

export type SalutationData = {
  type: 'salutation';
  // Sem dados adicionais - apenas saudação
};

export type ManagerResponseData = {
  type: 'manager_response';
  store: {
    id: string;
    name: string;
  };
  product: string;
  managerResponse: string; // Resposta bruta do gerente
  taskType: 'promotion' | 'availability' | 'price';
  isReservation?: boolean; // Flag para identificar se é resposta de reserva
  quantity?: string; // Quantidade da reserva (se aplicável)
  pickupTime?: string; // Horário de retirada (se aplicável) - formato ISO ou timestamp
  pickupTimeFormatted?: string; // Horário de retirada formatado em português (ex: "hoje às 20:48")
  taskTypeCategory?: 'price_check' | 'reservation_confirm'; // Tipo da task para diferenciar fluxos
};

export type ReservationRequestData = {
  type: 'reservation_request';
  store: {
    id: string;
    name: string;
  };
  product: string;
  pickupTime: string; // Timestamp ou ISO string do horário de retirada
  quantity?: string; // Quantidade de produtos
  isAwaitingConfirmation?: boolean; // true quando status é 'task_created' (aguardando confirmação do gerente)
};

export type FeedbackCheckinData = {
  type: 'feedback_checkin';
  store: {
    id: string;
    name: string;
  };
  product: string;
};

export type FeedbackPromoterData = {
  type: 'feedback_promoter';
  store: {
    id: string;
    name: string;
    googleReviewLink: string | null;
  };
};

export type FeedbackDissatisfiedData = {
  type: 'feedback_dissatisfied';
  store: {
    id: string;
    name: string;
  };
  ticketCreated: boolean;
};

export type SilentDropData = {
  type: 'silent_drop';
  reason: string; // Razão do silent drop (ex: "acknowledgment_with_pending_task", "acknowledgment_no_active_question")
};

export type AlreadyPendingData = {
  type: 'already_pending';
  product: string; // Produto da task pendente
  store: {
    id: string;
    name: string;
  };
};

export type ExecutorOutput = {
  status: 'done' | 'need_input' | 'handoff' | 'task_created' | 'reservation_confirmed' | 'silent_drop' | 'already_pending';
  data: ExecutorData;
  taskRequest?: {
    type: 'price_check' | 'reservation_confirm';
    storeId: string;
    payload: {
      item: string;
      intent: 'promotion' | 'availability' | 'price';
      storeId: string;
      storeName: string;
    };
    managerPhoneNumber: string;
  };
  feedbackScheduleRequest?: {
    conversationId: string;
    tenantId: string;
    storeId: string;
    storeName: string;
    product: string;
    pickupTime: number; // Timestamp do horário de retirada
  };
  handoffReason?: string;
  ticketCreated?: boolean;
  notificationCreated?: boolean;
  mergedEntities?: import('../intent-router/schemas').Entities; // Entidades fundidas para persistência
  nextSystemAction?: string; // Próxima ação do sistema (para anti-loop)
  retryCount?: Record<string, number>; // Contador de tentativas atualizado (para anti-loop)
};
