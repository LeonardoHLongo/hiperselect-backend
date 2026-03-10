/**
 * Tool System Types
 * Sistema de tools por domínio - Fase 1
 * 
 * Regras:
 * - Tools são stateless (não guardam memória)
 * - Tools NÃO escrevem no banco diretamente
 * - Tools NÃO enviam WhatsApp diretamente
 * - Somente o sistema decide qual tool chamar (router)
 */

/**
 * Input padrão para todas as tools
 */
export type ToolInput = {
  tenantId: string;
  conversationId: string;
  messageText: string;
  selectedStoreId?: string | null; // Do estado da conversa
  storesSummary: Array<{
    id: string;
    name: string;
    neighborhood: string;
    city: string;
    phone: string;
    openingHours: string;
    isActive: boolean;
    managerWhatsappNumber?: string | null;
    managerWhatsappEnabled?: boolean;
  }>;
  policiesSummary?: Array<{
    id: string;
    title: string;
    content: string;
    applicableStores: string[];
  }>;
  lastMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
};

/**
 * Motivos de handoff padronizados
 */
export type HandoffReason =
  | 'unknown_or_missing_data'
  | 'sensitive_or_policy_blocked'
  | 'user_requested_human';

/**
 * Request para criação de ticket (pedido, não execução)
 * Tools podem sugerir criação de ticket, mas o pipeline decide e executa
 */
export type TicketRequest = {
  priority: 'urgent' | 'high' | 'normal';
  category?: string; // ex: "complaint", "legal", "safety"
  title?: string; // curto
  summary?: string; // curto (1-2 linhas)
};

/**
 * Request para criação de task (pedido, não execução)
 * Tools podem sugerir criação de task, mas o pipeline decide e executa
 */
export type TaskRequest = {
  type: 'price_check' | 'reservation_confirm';
  storeId: string;
  payload: {
    item: string; // Nome do produto/promoção
    intent: 'promotion' | 'availability' | 'price';
  };
  managerPhoneNumber: string; // Número do gerente para enviar mensagem
};

/**
 * Side effects opcionais que podem ser aplicados pelo pipeline
 */
export type ToolSideEffects = {
  disableAI?: boolean;
  createNotification?: boolean;
  notificationType?: string;
  ticketRequest?: TicketRequest; // Pedido de criação de ticket
  taskRequest?: TaskRequest; // Pedido de criação de task (ex: verificação com gerente)
};

/**
 * Resultado de uma tool (sempre um dos 3 estados)
 */
export type ToolResult =
  | {
      status: 'done';
      responseText: string;
      sideEffects?: ToolSideEffects;
    }
  | {
      status: 'need_input';
      askUser: string;
      needFields: string[]; // ex: ["store_id"]
      pendingContext?: Record<string, unknown>; // ex: { tool: "policies", topic: "return_policy" }
      sideEffects?: ToolSideEffects;
    }
  | {
      status: 'handoff';
      responseText: string; // Explica que vai encaminhar para humano
      handoffReason: HandoffReason; // Motivo padronizado do handoff
      sideEffects?: ToolSideEffects; // Opcional: pode especificar se deve criar notificação
    };

/**
 * Interface padrão de Tool (congelável)
 */
export interface Tool {
  /**
   * Nome único da tool (ex: "store_topics", "policies")
   */
  name: string;

  /**
   * Verifica se esta tool pode lidar com o input
   * Heurística simples por palavras-chave ou contexto
   */
  canHandle(input: ToolInput): boolean;

  /**
   * Executa a tool e retorna resultado
   */
  run(input: ToolInput): Promise<ToolResult> | ToolResult;
}
