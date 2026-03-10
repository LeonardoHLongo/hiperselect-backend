import type { Ticket } from './types';

export interface ITicketRepository {
  findById(ticketId: string, tenantId: string): Ticket | null | Promise<Ticket | null>;
  findAll(tenantId: string): Ticket[] | Promise<Ticket[]>;
  findByConversationId(conversationId: string, tenantId: string): Ticket[] | Promise<Ticket[]>;
  // Métodos antigos (deprecated) - mantidos para compatibilidade
  create(ticket: Ticket): void;
  update(ticketId: string, updates: Partial<Ticket>): void;
}

class InMemoryTicketRepository implements ITicketRepository {
  private tickets: Map<string, Ticket> = new Map();

  findById(ticketId: string): Ticket | null {
    return this.tickets.get(ticketId) || null;
  }

  findAll(): Ticket[] {
    return Array.from(this.tickets.values());
  }

  findByConversationId(conversationId: string): Ticket[] {
    return Array.from(this.tickets.values()).filter(
      (ticket) => ticket.conversationId === conversationId
    );
  }

  create(ticket: Ticket): void {
    this.tickets.set(ticket.ticketId, { ...ticket });
  }

  update(ticketId: string, updates: Partial<Ticket>): void {
    const existing = this.tickets.get(ticketId);
    if (existing) {
      this.tickets.set(ticketId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      });
    }
  }
}

export const createTicketRepository = (): ITicketRepository => {
  return new InMemoryTicketRepository();
};

