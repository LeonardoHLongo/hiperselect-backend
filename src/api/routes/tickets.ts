import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TicketService } from '../../tickets';
import type { TicketState } from '../../tickets/types';

export const registerTicketRoutes = (
  fastify: FastifyInstance,
  ticketService: TicketService
): void => {
  // GET /api/v1/tickets/count - Contar tickets não resolvidos
  // Se userId disponível, só conta tickets criados/modificados DEPOIS da última visualização
  fastify.get('/api/v1/tickets/count', async (request, reply) => {
    try {
      const tenantId = (request as any).tenantId;
      const userId = (request as any).userId; // Do middleware de autenticação
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const repository = (ticketService as any).repository;
      
      if (repository && typeof repository.countUnresolvedTickets === 'function') {
        // Passar userId se disponível (para filtrar por última visualização)
        const count = await repository.countUnresolvedTickets(tenantId, userId);
        return { success: true, data: { count } };
      } else {
        // Fallback: buscar todos e contar
        const tickets = await repository.findAll(tenantId);
        const unresolvedCount = tickets.filter((t: any) => t.status !== 'closed').length;
        return { success: true, data: { count: unresolvedCount } };
      }
    } catch (error) {
      console.error('[Tickets API] Error counting tickets:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to count tickets',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // POST /api/v1/tickets/viewed - Marcar tickets como visualizados
  // Chamado quando o usuário acessa a página de tickets
  fastify.post('/api/v1/tickets/viewed', async (request, reply) => {
    try {
      const tenantId = (request as any).tenantId;
      const userId = (request as any).userId;
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      if (!userId) {
        return reply.code(401).send({
          success: false,
          message: 'UserId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const repository = (ticketService as any).repository;
      
      if (repository && typeof repository.markTicketsAsViewed === 'function') {
        await repository.markTicketsAsViewed(userId, tenantId);
        return { success: true, message: 'Tickets marked as viewed' };
      } else {
        // Se não suportar, retornar sucesso silencioso (não quebrar)
        console.warn('[Tickets API] Repository does not support markTicketsAsViewed');
        return { success: true, message: 'Tickets marked as viewed (fallback)' };
      }
    } catch (error) {
      console.error('[Tickets API] Error marking tickets as viewed:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to mark tickets as viewed',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /api/v1/tickets - Listar todos os tickets
  fastify.get('/api/v1/tickets', async (request, reply) => {
    try {
      const tenantId = (request as any).tenantId;
      
      console.log('[Tickets API] GET /api/v1/tickets', {
        tenantId,
        hasTenantId: !!tenantId,
        repositoryType: (ticketService as any).repository?.constructor?.name,
        hasFindAll: typeof (ticketService as any).repository?.findAll === 'function',
      });
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se repository suporta findAll com tenantId (PostgreSQL)
      // O método async findAll(tenantId) existe no PostgresTicketRepository
      const repository = (ticketService as any).repository;
      
      // Verificar se é PostgresTicketRepository e tem o método async findAll
      if (repository && repository.constructor?.name === 'PostgresTicketRepository') {
        // Chamar diretamente o método async findAll(tenantId)
        // Usar bind para garantir que o contexto está correto
        const findAllAsync = repository.findAll.bind(repository);
        const tickets = await findAllAsync(tenantId);
        
        console.log('[Tickets API] Tickets encontrados (PostgreSQL):', {
          count: tickets.length,
          tenantId,
          tickets: tickets.map((t: any) => ({
            id: t.id,
            title: t.title,
            priority: t.priority,
            status: t.status,
            conversationId: t.conversationId,
          })),
        });
        
        return {
          success: true,
          data: tickets,
        };
      } else if (repository && typeof repository.findAll === 'function') {
        // Tentar chamar o método (pode ser o antigo ou novo)
        try {
          const result = repository.findAll(tenantId);
          
          // Se retornar Promise, é o método async
          if (result && typeof result.then === 'function') {
            const tickets = await result;
            console.log('[Tickets API] Tickets encontrados (async):', {
              count: tickets.length,
              tickets: tickets.map((t: any) => ({
                id: t.id,
                title: t.title,
                priority: t.priority,
                status: t.status,
                conversationId: t.conversationId,
              })),
            });
            return {
              success: true,
              data: tickets,
            };
          } else {
            // Método antigo (síncrono, sem tenantId) - não suportado
            console.warn('[Tickets API] Repository retornou método síncrono - não suportado');
            return {
              success: true,
              data: [],
            };
          }
        } catch (error) {
          console.error('[Tickets API] Erro ao chamar repository.findAll:', error);
          throw error;
        }
      } else {
        console.warn('[Tickets API] Repository não suporta findAll, usando método antigo do service');
        // Fallback para método antigo (não recomendado)
        const tickets = ticketService.getAll();
        return {
          success: true,
          data: tickets,
        };
      }
    } catch (error) {
      console.error('[Tickets API] Error fetching tickets:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch tickets',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.get('/api/v1/tickets/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = (request as any).tenantId;
      
      console.log('[Tickets API] GET /api/v1/tickets/:id', {
        ticketId: id,
        tenantId,
        hasTenantId: !!tenantId,
        repositoryType: (ticketService as any).repository?.constructor?.name,
      });
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const repository = (ticketService as any).repository;
      
      // Verificar se é PostgresTicketRepository
      if (repository && repository.constructor?.name === 'PostgresTicketRepository') {
        // Chamar diretamente o método async findById(ticketId, tenantId)
        const findByIdMethod = (repository as any).findById;
        
        if (typeof findByIdMethod === 'function') {
          try {
            const result = findByIdMethod.call(repository, id, tenantId);
            
            // Se retornar Promise, é o método async
            if (result && typeof result.then === 'function') {
              const ticket = await result;
              
              console.log('[Tickets API] Ticket encontrado:', {
                ticketId: id,
                found: !!ticket,
                ticket: ticket ? {
                  id: ticket.id,
                  title: ticket.title,
                  priority: ticket.priority,
                  status: ticket.status,
                } : null,
              });
              
              if (!ticket) {
                return reply.code(404).send({
                  success: false,
                  message: 'Ticket not found',
                  errorCode: 'NOT_FOUND',
                });
              }

              return {
                success: true,
                data: ticket,
              };
            } else {
              console.warn('[Tickets API] Método findById não retornou Promise');
              return reply.code(404).send({
                success: false,
                message: 'Ticket not found',
                errorCode: 'NOT_FOUND',
              });
            }
          } catch (error) {
            console.error('[Tickets API] Erro ao chamar findById:', error);
            return reply.code(500).send({
              success: false,
              message: 'Failed to fetch ticket',
              errorCode: 'INTERNAL_ERROR',
            });
          }
        } else {
          return reply.code(404).send({
            success: false,
            message: 'Ticket not found',
            errorCode: 'NOT_FOUND',
          });
        }
      } else if (repository && typeof repository.findById === 'function') {
        // Tentar método antigo (não recomendado)
        const ticket = ticketService.getById(id);
        
        if (!ticket) {
          return reply.code(404).send({
            success: false,
            message: 'Ticket not found',
            errorCode: 'NOT_FOUND',
          });
        }

        return {
          success: true,
          data: ticket,
        };
      } else {
        return reply.code(404).send({
          success: false,
          message: 'Ticket not found',
          errorCode: 'NOT_FOUND',
        });
      }
    } catch (error) {
      console.error('[Tickets API] Error fetching ticket:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch ticket',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.get('/api/v1/conversations/:conversationId/tickets', async (request, reply) => {
    try {
      const { conversationId } = request.params as { conversationId: string };
      const tenantId = (request as any).tenantId;
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se repository suporta findByConversationId com tenantId (PostgreSQL)
      if (typeof (ticketService as any).repository?.findByConversationId === 'function') {
        const tickets = await (ticketService as any).repository.findByConversationId(conversationId, tenantId);
        return {
          success: true,
          data: tickets,
        };
      } else {
        // Fallback para método antigo
        const tickets = await ticketService.getByConversationId(conversationId, tenantId);
        return {
          success: true,
          data: tickets,
        };
      }
    } catch (error) {
      console.error('[Tickets API] Error fetching tickets by conversation:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch tickets',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.patch('/api/v1/tickets/:id/state', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { state } = request.body as { state: TicketState };

      const ticket = ticketService.updateState(id, state);

      if (!ticket) {
        return reply.code(404).send({
          success: false,
          message: 'Ticket not found',
          errorCode: 'NOT_FOUND',
        });
      }

      return {
        success: true,
        data: ticket,
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        message: 'Failed to update ticket state',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.patch('/api/v1/tickets/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = (request as any).tenantId;
      const userId = (request as any).userId;
      const body = request.body as any;
      
      // Validar e normalizar o status
      const validStatuses = ['open', 'in_progress', 'closed'];
      const updates: Partial<{ 
        status: string; 
        assignedToUserId?: string | null;
        title?: string; 
        summary?: string | null;
      }> = { ...body };
      
      // Validar status se fornecido
      if (updates.status !== undefined) {
        if (!validStatuses.includes(updates.status)) {
          return reply.code(400).send({
            success: false,
            message: `Status inválido: ${updates.status}. Valores permitidos: ${validStatuses.join(', ')}`,
            errorCode: 'INVALID_STATUS',
          });
        }
      }
      
      console.log('[Tickets API] PATCH /api/v1/tickets/:id', {
        ticketId: id,
        tenantId,
        userId,
        updates,
        rawBody: body,
      });
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Usar TicketService.updateTicket que cria logs automaticamente
      // Garantir que status seja do tipo correto
      const typedUpdates = {
        ...updates,
        status: updates.status as 'open' | 'in_progress' | 'closed' | undefined,
      };
      const updatedTicket = await ticketService.updateTicket(id, typedUpdates, tenantId, userId);
      
      return {
        success: true,
        data: updatedTicket,
      };
    } catch (error: any) {
      console.error('[Tickets API] Error updating ticket:', error);
      console.error('[Tickets API] Error details:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        stack: error?.stack,
      });
      return reply.code(500).send({
        success: false,
        message: error?.message || 'Failed to update ticket',
        errorCode: 'INTERNAL_ERROR',
        details: process.env.NODE_ENV === 'development' ? error?.details : undefined,
      });
    }
  });

  // POST /api/v1/tickets/:id/notes - Adicionar nota ao ticket
  fastify.post('/api/v1/tickets/:id/notes', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = (request as any).tenantId;
      const userId = (request as any).userId;
      const { note } = request.body as { note: string };
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      if (!note || note.trim().length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'Note is required',
          errorCode: 'INVALID_INPUT',
        });
      }

      const log = await ticketService.addNote(id, note.trim(), tenantId, userId);
      
      return {
        success: true,
        data: log,
      };
    } catch (error) {
      console.error('[Tickets API] Error adding note:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to add note',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /api/v1/tickets/:id/logs - Buscar logs do ticket
  fastify.get('/api/v1/tickets/:id/logs', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = (request as any).tenantId;
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const logs = await ticketService.getTicketLogs(id, tenantId);
      
      return {
        success: true,
        data: logs,
      };
    } catch (error) {
      console.error('[Tickets API] Error fetching logs:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch logs',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};

