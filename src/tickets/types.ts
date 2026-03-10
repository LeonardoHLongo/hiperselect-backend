// Tipos antigos (mantidos para compatibilidade)
export type TicketState = 'DETECTED' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';

// Novos tipos para sistema de tickets simplificado
export type TicketStatus = 'open' | 'in_progress' | 'closed';
export type TicketPriority = 'urgent' | 'high' | 'normal';
export type TicketSource = 'system' | 'manual';

export type Ticket = {
  id: string;
  tenantId: string;
  conversationId: string;
  storeId?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  title: string;
  summary?: string | null;
  reason: string; // handoffReason (ex: 'sensitive_or_policy_blocked')
  source: TicketSource;
  category?: string | null; // Categoria do ticket (ex: 'food_safety', 'legal', 'safety')
  createdAt: number;
  updatedAt: number;
};

export type CreateTicketInput = {
  tenantId: string;
  conversationId: string;
  storeId?: string | null;
  priority: TicketPriority;
  title: string;
  summary?: string | null;
  reason: string;
  source?: TicketSource;
  category?: string | null; // Categoria do ticket (ex: 'food_safety', 'legal', 'safety')
  assignedToUserId?: string | null;
};

export type UpdateTicketInput = {
  status?: TicketStatus;
  assignedToUserId?: string | null;
  title?: string;
  summary?: string | null;
};

export type CreateTicketLogInput = {
  ticketId: string;
  authorType: 'system' | 'human';
  authorId?: string | null;
  actionType: 'created' | 'status_changed' | 'note_added' | 'assigned' | 'unassigned';
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
};

export type TicketLog = {
  id: string;
  ticketId: string;
  authorType: 'system' | 'human';
  authorId?: string | null;
  authorName?: string | null; // Nome do usuário (se authorType = 'human')
  actionType: 'created' | 'status_changed' | 'note_added' | 'assigned' | 'unassigned';
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  createdAt: number;
};

export type TicketCreatedEvent = {
  ticketId: string;
  conversationId: string;
  analysis: Ticket['analysis'];
  traceId: string;
};

export type TicketUpdatedEvent = {
  ticketId: string;
  previousState: TicketState;
  newState: TicketState;
  updatedAt: number;
  traceId: string;
};

