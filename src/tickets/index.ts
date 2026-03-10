export { TicketService } from './service';
export { createTicketRepository, type ITicketRepository } from './repository';
export { createPostgresTicketRepository } from './repository-postgres';
export type { Ticket, TicketCreatedEvent, TicketState, TicketUpdatedEvent, CreateTicketInput, TicketStatus, TicketPriority, TicketSource } from './types';

