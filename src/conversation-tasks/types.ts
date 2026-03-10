/**
 * Conversation Tasks Types
 * Sistema de atividades pendentes por conversa (ex: verificação com gerente)
 */

export type ConversationTaskType = 'manager_check' | 'price_check' | 'reservation_confirm';

export type ConversationTaskStatus = 'pending' | 'completed' | 'expired';

export type ConversationTaskIntent = 'promotion' | 'availability' | 'price';

export type ConversationTaskPayload = {
  item: string; // Nome do produto/promoção
  intent: ConversationTaskIntent; // Tipo de consulta
  storeId?: string; // ID da loja (opcional, para contexto)
  storeName?: string; // Nome da loja (opcional, para contexto)
  quantity?: string; // Quantidade para reserva (opcional)
  pickup_time?: string; // Horário de retirada para reserva (opcional)
  isReservation?: boolean; // Flag para identificar se é reserva (opcional)
};

export type ConversationTask = {
  id: string;
  tenantId: string;
  conversationId: string;
  storeId?: string | null;
  type: ConversationTaskType;
  status: ConversationTaskStatus;
  requestCode: string; // Código único para correlacionar resposta (ex: REQ:ABC123)
  payload: ConversationTaskPayload;
  resultText?: string | null; // Resposta do gerente (quando completed)
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type CreateConversationTaskInput = {
  tenantId: string;
  conversationId: string;
  storeId?: string | null;
  type: ConversationTaskType;
  payload: ConversationTaskPayload;
  requestCode: string;
  expiresAt?: number; // Opcional, padrão: 20 minutos
};

export type UpdateConversationTaskInput = {
  status?: ConversationTaskStatus;
  resultText?: string | null;
};
