import type { SenderInfo } from '../whatsapp/types';

export type MediaInfo = {
  type: 'image' | 'audio' | 'video' | 'document';
  mimetype?: string;
  caption?: string;
  url?: string;
  mediaId?: string;
};

/**
 * Tipos de mensagem normalizados (congelado após Fase 1)
 * Todos os tipos do Baileys são mapeados para estes tipos internos
 */
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'other';

export type Message = {
  messageId: string;
  conversationId: string;
  text: string | null; // Pode ser null se for apenas mídia
  timestamp: number;
  sender: SenderInfo;
  media?: MediaInfo;
  messageType: MessageType; // Tipo normalizado e consistente
  // Referência para baixar mídia do Baileys
  baileysKey?: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
  };
  // Mensagem completa do Baileys serializada (apenas quando há mídia)
  baileysMessage?: any; // WAMessage serializado
  // Informações do agente que enviou a mensagem (quando enviada manualmente)
  agentId?: string | null;
  agentName?: string | null;
};

/**
 * Última mensagem da conversa (contrato definitivo - congelado após Fase 1)
 */
export type LastMessage = {
  id: string;
  text?: string;
  type: MessageType; // Tipo normalizado
  fromMe: boolean;
  timestamp: number;
};

/**
 * Estados de conversa (congelado após Fase 1)
 */
export type ConversationState = 'open' | 'waiting' | 'waiting_human' | 'archived';

/**
 * Modelo de Conversation (contrato definitivo - congelado após Fase 1)
 * Este contrato será usado nas Fases 2, 3 e 4 - evite mudanças futuras
 */
export type Conversation = {
  id: string; // Alias para conversationId (mantido para compatibilidade)
  conversationId: string; // ID da conversa (phone number sem @s.whatsapp.net)
  participantId: string; // Alias para conversationId (padrão WhatsApp)
  participantName?: string; // Alias para sender.pushName
  participantAvatarUrl?: string; // Alias para sender.profilePictureUrl
  sender: SenderInfo; // Mantido para compatibilidade
  state: ConversationState; // Estado da conversa: open, waiting, archived
  lastMessage: LastMessage | null; // Objeto estruturado da última mensagem
  unreadCount: number; // Contador de mensagens não lidas
  updatedAt: number; // Timestamp da última atualização (alias para lastMessageAt)
  lastMessageAt: number; // Mantido para compatibilidade
  messageCount: number; // Mantido para compatibilidade
  createdAt: number;
  selectedStoreId?: string; // ID da loja selecionada pelo usuário nesta conversa
  selectedStoreName?: string; // Nome da loja selecionada (para contexto)
  awaitingStoreSelection?: boolean; // Se estamos aguardando o usuário escolher uma loja
  pendingQuestionText?: string; // Pergunta original que ficou pendente enquanto escolhia loja
  storeCandidates?: string[]; // IDs das lojas candidatas (quando múltiplas opções)
  // Tool system state (Fase 1)
  pendingToolName?: string | null; // Nome da tool pendente (ex: "store_topics", "policies")
  pendingFields?: string[] | null; // Campos que faltam (ex: ["store_id"])
  pendingContext?: Record<string, unknown> | null; // Contexto da tool pendente (ex: { topic: "policy_lookup" })
  pendingAttempts?: number; // Número de tentativas de preencher campos pendentes (default 0)
  // AI control state
  aiEnabled?: boolean; // Se a IA está habilitada para esta conversa (default true)
  aiDisabledAt?: number | null; // Timestamp de quando a IA foi desligada
  aiDisabledBy?: string | null; // Quem desligou: "human", "system" ou "tool"
  aiDisabledReason?: string | null; // Motivo opcional para desligar a IA
  // Reputation management
  isReputationAtRisk?: boolean; // Se a reputação está em risco (cliente insatisfeito ou reclamação grave)
  // Human handoff state
  waitingHumanAt?: number | null; // Timestamp de quando a conversa entrou em estado de espera por atendente humano
  // Agent tracking
  agentNames?: string[]; // Lista de nomes de agentes que enviaram mensagens nesta conversa (únicos)
  agentColors?: Record<string, string>; // Mapa de nome do agente -> cor (hex)
};

