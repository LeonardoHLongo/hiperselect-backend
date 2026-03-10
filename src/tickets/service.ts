import { eventBus } from '../events';
import type { ITicketRepository } from './repository';
import type { Ticket, TicketState, CreateTicketInput, TicketLog, CreateTicketLogInput, UpdateTicketInput } from './types';

export class TicketService {
  constructor(private repository: ITicketRepository) {}

  /**
   * Cria um ticket a partir de um handoff (novo formato)
   * Usado pelo pipeline quando ocorre handoff sensível
   */
  async createTicketFromHandoff(input: CreateTicketInput): Promise<Ticket> {
    // Verificar se repository suporta createTicket (PostgreSQL)
    const hasCreateTicket = typeof (this.repository as any).createTicket === 'function';
    
    console.log('[TicketService] 🔍 Verificando suporte a createTicket', {
      hasCreateTicket,
      repositoryType: this.repository.constructor.name,
      repositoryMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.repository)),
    });
    
    if (hasCreateTicket) {
      console.log('[TicketService] ✅ Repository suporta createTicket - criando ticket', {
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        priority: input.priority,
      });
      
      const ticket = await (this.repository as any).createTicket(input);
      
      console.log('[TicketService] ✅ Ticket criado com sucesso', {
        ticketId: ticket.id,
        conversationId: ticket.conversationId,
        priority: ticket.priority,
        category: ticket.category || 'N/A',
      });
      
      // Criar log de criação automaticamente
      const categoryInfo = input.category ? `, categoria: ${input.category}` : '';
      await this.createLog({
        ticketId: ticket.id,
        authorType: 'system',
        authorId: null,
        actionType: 'created',
        fromStatus: null,
        toStatus: 'open',
        note: `Ticket criado automaticamente pelo sistema (motivo: ${input.reason}${categoryInfo})`,
      });
      
      // Emitir evento de ticket criado
      const traceId = this.generateTraceId();
      eventBus.emit(
        'ticket.created',
        {
          ticketId: ticket.id,
          conversationId: ticket.conversationId,
          tenantId: ticket.tenantId,
          priority: ticket.priority,
          reason: ticket.reason,
          traceId,
        },
        traceId
      );
      
      return ticket;
    } else {
      // Fallback para repository antigo (não suportado para novo formato)
      console.error('[TicketService] ❌ Repository não suporta createTicket', {
        repositoryType: this.repository.constructor.name,
        availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.repository)),
      });
      throw new Error('Repository does not support createTicketFromHandoff');
    }
  }

  create(
    conversationId: string,
    analysis: Ticket['analysis'],
    suggestedResponse?: string
  ): Ticket {
    const now = Date.now();
    const ticketId = this.generateTicketId();

    const ticket: Ticket = {
      ticketId,
      conversationId,
      state: 'DETECTED',
      createdAt: now,
      updatedAt: now,
      analysis,
      suggestedResponse,
    };

    this.repository.create(ticket);

    const traceId = this.generateTraceId();
    eventBus.emit(
      'ticket.created',
      {
        ticketId,
        conversationId,
        analysis,
        traceId,
      },
      traceId
    );

    return ticket;
  }

  updateState(ticketId: string, newState: TicketState): Ticket | null {
    const existing = this.repository.findById(ticketId);
    if (!existing) {
      return null;
    }

    const previousState = existing.state;
    this.repository.update(ticketId, { state: newState });

    const traceId = this.generateTraceId();
    eventBus.emit(
      'ticket.state.changed',
      {
        ticketId,
        previousState,
        newState,
        updatedAt: Date.now(),
        traceId,
      },
      traceId
    );

    eventBus.emit(
      'ticket.updated',
      {
        ticketId,
        previousState,
        newState,
        updatedAt: Date.now(),
        traceId,
      },
      traceId
    );

    return this.repository.findById(ticketId);
  }

  update(ticketId: string, updates: Partial<Ticket>): Ticket | null {
    const existing = this.repository.findById(ticketId);
    if (!existing) {
      return null;
    }

    this.repository.update(ticketId, updates);

    const traceId = this.generateTraceId();
    eventBus.emit(
      'ticket.updated',
      {
        ticketId,
        previousState: existing.state,
        newState: updates.state || existing.state,
        updatedAt: Date.now(),
        traceId,
      },
      traceId
    );

    return this.repository.findById(ticketId);
  }

  getAll(): Ticket[] {
    return this.repository.findAll();
  }

  getById(ticketId: string): Ticket | null {
    return this.repository.findById(ticketId);
  }

  async getByConversationId(conversationId: string, tenantId: string): Promise<Ticket[]> {
    const result = this.repository.findByConversationId(conversationId, tenantId);
    return result instanceof Promise ? await result : result;
  }

  private generateTicketId(): string {
    return `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Atualiza um ticket e cria log automaticamente
   */
  async updateTicket(
    ticketId: string,
    updates: UpdateTicketInput,
    tenantId: string,
    authorId?: string | null
  ): Promise<Ticket> {
    const repository = this.repository as any;
    
    // Verificar se repository suporta updateTicket
    if (typeof repository.updateTicket !== 'function') {
      throw new Error('Repository does not support updateTicket');
    }

    // Buscar ticket atual para obter status anterior
    const currentTicket = await repository.findById(ticketId, tenantId);
    
    if (!currentTicket) {
      throw new Error('Ticket not found');
    }

    const previousStatus = currentTicket.status;
    
    // Atualizar ticket
    const updatedTicket = await repository.updateTicket(ticketId, updates, tenantId);
    
    // Criar logs para mudanças
    if (updates.status && updates.status !== previousStatus) {
      try {
        await this.createLog({
          ticketId,
          authorType: authorId ? 'human' : 'system',
          authorId: authorId || null,
          actionType: 'status_changed',
          fromStatus: previousStatus,
          toStatus: updates.status,
          note: updates.summary || null, // Nota opcional junto com mudança de status
        });
      } catch (logError) {
        console.error('[TicketService] Erro ao criar log de mudança de status:', logError);
        // Não falhar a atualização do ticket se o log falhar
        // Mas logar o erro para debug
      }
    }
    
    if (updates.assignedToUserId !== undefined && updates.assignedToUserId !== currentTicket.assignedToUserId) {
      // Tentar buscar o nome do usuário para melhorar a mensagem do log
      let userName = null;
      if (updates.assignedToUserId) {
        try {
          const { createClient } = require('@supabase/supabase-js');
          const supabaseUrl = process.env.SUPABASE_URL;
          const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          
          if (supabaseUrl && supabaseServiceKey) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
              auth: { autoRefreshToken: false, persistSession: false },
            });
            
            // Tentar buscar na tabela profiles primeiro (novo sistema)
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('name')
              .eq('id', updates.assignedToUserId)
              .maybeSingle();
            
            if (profile?.name) {
              userName = profile.name;
            } else {
              // Fallback para tabela users (sistema antigo)
              const { data: user } = await supabaseAdmin
                .from('users')
                .select('name')
                .eq('id', updates.assignedToUserId)
                .maybeSingle();
              
              if (user?.name) {
                userName = user.name;
              }
            }
          }
        } catch (error) {
          console.warn('[TicketService] Erro ao buscar nome do usuário para log:', error);
          // Continuar sem o nome
        }
      }
      
      await this.createLog({
        ticketId,
        authorType: 'human',
        authorId: authorId || null,
        actionType: updates.assignedToUserId ? 'assigned' : 'unassigned',
        fromStatus: null,
        toStatus: null,
        note: updates.assignedToUserId 
          ? userName 
            ? `O atendente ${userName} assumiu este ticket.`
            : `Ticket atribuído ao usuário ${updates.assignedToUserId}`
          : 'Ticket desatribuído',
      });
    }
    
    return updatedTicket;
  }

  /**
   * Adiciona uma nota ao ticket (cria log)
   */
  async addNote(
    ticketId: string,
    note: string,
    tenantId: string,
    authorId?: string | null
  ): Promise<TicketLog> {
    // Verificar se ticket existe
    const repository = this.repository as any;
    const ticket = await repository.findById(ticketId, tenantId);
    
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    return await this.createLog({
      ticketId,
      authorType: authorId ? 'human' : 'system',
      authorId: authorId || null,
      actionType: 'note_added',
      fromStatus: null,
      toStatus: null,
      note,
    });
  }

  /**
   * Busca logs de um ticket
   */
  async getTicketLogs(ticketId: string, tenantId: string): Promise<TicketLog[]> {
    const repository = this.repository as any;
    
    if (typeof repository.getTicketLogs === 'function') {
      return await repository.getTicketLogs(ticketId, tenantId);
    }
    
    return [];
  }

  /**
   * Cria um log de ticket
   */
  private async createLog(input: CreateTicketLogInput): Promise<TicketLog> {
    const repository = this.repository as any;
    
    if (typeof repository.createTicketLog === 'function') {
      return await repository.createTicketLog(input);
    }
    
    // Fallback: apenas logar (não persistir se repository não suporta)
    console.warn('[TicketService] Repository não suporta createTicketLog - log não será persistido', {
      ticketId: input.ticketId,
      actionType: input.actionType,
    });
    
    // Retornar log simulado (não persistido)
    return {
      id: `log_${Date.now()}`,
      ticketId: input.ticketId,
      authorType: input.authorType,
      authorId: input.authorId || null,
      actionType: input.actionType,
      fromStatus: input.fromStatus || null,
      toStatus: input.toStatus || null,
      note: input.note || null,
      createdAt: Date.now(),
    };
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

