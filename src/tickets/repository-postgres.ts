/**
 * PostgreSQL implementation of ITicketRepository using Supabase
 */

import type { ITicketRepository } from './repository';
import type { Ticket, CreateTicketInput, TicketLog, CreateTicketLogInput } from './types';
import { supabase } from '../database/config';
import { randomUUID } from 'crypto';

class PostgresTicketRepository implements ITicketRepository {
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        id,
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        store_id: input.storeId || null,
        status: 'open',
        priority: input.priority,
        title: input.title,
        summary: input.summary || null,
        reason: input.reason,
        source: input.source || 'system',
        category: input.category || null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error creating ticket:', error);
      throw error;
    }

    return this.mapRowToTicket(data);
  }

  async findById(ticketId: string, tenantId: string): Promise<Ticket | null> {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapRowToTicket(data);
  }

  async findAll(tenantId: string): Promise<Ticket[]> {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error fetching tickets:', error);
      return [];
    }

    return (data || []).map(this.mapRowToTicket);
  }

  /**
   * Conta tickets não resolvidos (open ou in_progress) para um tenant
   * Se userId for fornecido, só conta tickets criados/modificados DEPOIS da última visualização
   */
  async countUnresolvedTickets(tenantId: string, userId?: string): Promise<number> {
    // Buscar todos os tickets não resolvidos
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('id, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'in_progress']);

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error counting unresolved tickets:', error);
      return 0;
    }

    if (!tickets || tickets.length === 0) {
      // Silenciado: log repetitivo de polling
      return 0;
    }

    // Se userId fornecido, filtrar por última visualização
    if (userId) {
      try {
        const { data: viewData, error: viewError } = await supabase
          .from('user_ticket_views')
          .select('last_viewed_at')
          .eq('user_id', userId)
          .eq('tenant_id', tenantId)
          .single();

        // Se a tabela não existe (migration não aplicada), retornar 0 para não mostrar badge
        if (viewError && viewError.code === '42P01') {
          console.warn('[PostgresTicketRepository] ⚠️ Table user_ticket_views does not exist. Please apply migration 021_create_user_ticket_views.sql');
          // Retornar 0 para não mostrar badge até a migration ser aplicada
          return 0;
        }

        if (!viewError && viewData?.last_viewed_at) {
          const lastViewedAt = new Date(viewData.last_viewed_at).getTime();
          
          // Filtrar tickets criados ou atualizados DEPOIS da última visualização
          const filteredTickets = tickets.filter((ticket: any) => {
            const createdAt = new Date(ticket.created_at).getTime();
            const updatedAt = new Date(ticket.updated_at).getTime();
            return createdAt > lastViewedAt || updatedAt > lastViewedAt;
          });

          console.debug('[PostgresTicketRepository] Filtered tickets count', {
            total: tickets.length,
            filtered: filteredTickets.length,
            lastViewedAt: new Date(lastViewedAt).toISOString(),
            userId,
          });

          return filteredTickets.length;
        } else {
          // Se não houver registro de visualização, retornar todos (primeira vez)
          // Log removido para evitar poluição do console
          return tickets.length;
        }
      } catch (error: any) {
        console.error('[PostgresTicketRepository] ⚠️ Error fetching last_viewed_at:', error);
        // Se a tabela não existe, retornar 0
        if (error?.code === '42P01') {
          return 0;
        }
        // Se houver outro erro, contar todos (fallback)
        return tickets.length;
      }
    }

    // Retornar contagem total se não houver filtro de visualização
    return tickets.length;
  }

  /**
   * Marca que o usuário visualizou a página de tickets
   * Atualiza ou cria registro em user_ticket_views
   */
  async markTicketsAsViewed(userId: string, tenantId: string): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      // Usar upsert para criar ou atualizar
      const { error } = await supabase
        .from('user_ticket_views')
        .upsert({
          user_id: userId,
          tenant_id: tenantId,
          last_viewed_at: now,
          updated_at: now,
        }, {
          onConflict: 'user_id,tenant_id',
        });

      if (error) {
        // Se a tabela não existe, logar aviso mas não quebrar
        if (error.code === '42P01') {
          console.warn('[PostgresTicketRepository] ⚠️ Table user_ticket_views does not exist. Please apply migration 021_create_user_ticket_views.sql');
          return; // Retornar silenciosamente para não quebrar o fluxo
        }
        console.error('[PostgresTicketRepository] ❌ Error marking tickets as viewed:', error);
        throw error;
      }

      console.log('[PostgresTicketRepository] ✅ Tickets marked as viewed', { userId, tenantId, lastViewedAt: now });
    } catch (error: any) {
      // Se a tabela não existe, não quebrar o fluxo
      if (error?.code === '42P01') {
        console.warn('[PostgresTicketRepository] ⚠️ Table user_ticket_views does not exist. Please apply migration 021_create_user_ticket_views.sql');
        return;
      }
      console.error('[PostgresTicketRepository] ❌ Error in markTicketsAsViewed:', error);
      throw error;
    }
  }

  async findByConversationId(conversationId: string, tenantId: string): Promise<Ticket[]> {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error fetching tickets by conversation:', error);
      return [];
    }

    return (data || []).map(this.mapRowToTicket);
  }

  async updateStatus(
    ticketId: string,
    status: Ticket['status'],
    tenantId: string,
    previousStatus?: Ticket['status']
  ): Promise<Ticket> {
    const updates: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    
    // Se mudando para 'closed', definir resolved_at
    if (status === 'closed') {
      updates.resolved_at = new Date().toISOString();
    } else if (previousStatus === 'closed' && status !== 'closed') {
      // Se estava fechado e mudou para outro status, limpar resolved_at
      updates.resolved_at = null;
    }

    const { data, error } = await supabase
      .from('tickets')
      .update(updates)
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error updating ticket status:', error);
      throw error;
    }

    return this.mapRowToTicket(data);
  }

  async updateTicket(
    ticketId: string,
    updates: Partial<{
      status: Ticket['status'];
      assignedToUserId: string | null;
      title: string;
      summary: string | null;
    }>,
    tenantId: string
  ): Promise<Ticket> {
    console.log('[PostgresTicketRepository] 🔄 Updating ticket:', {
      ticketId,
      tenantId,
      updates,
    });

    const dbUpdates: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.status !== undefined) {
      // Validar status antes de atualizar
      const validStatuses: Ticket['status'][] = ['open', 'in_progress', 'closed'];
      if (!validStatuses.includes(updates.status as Ticket['status'])) {
        throw new Error(`Status inválido: ${updates.status}. Valores permitidos: ${validStatuses.join(', ')}`);
      }
      
      dbUpdates.status = updates.status;
      if (updates.status === 'closed') {
        dbUpdates.resolved_at = new Date().toISOString();
        console.log('[PostgresTicketRepository] ✅ Setting resolved_at for closed status');
      }
      // Não limpar resolved_at automaticamente - deixar como está se não for 'closed'
      // Isso permite que tickets resolvidos mantenham a data mesmo se o status mudar temporariamente
    }
    if (updates.assignedToUserId !== undefined) {
      dbUpdates.assigned_to_user_id = updates.assignedToUserId;
    }
    if (updates.title !== undefined) {
      dbUpdates.title = updates.title;
    }
    if (updates.summary !== undefined) {
      dbUpdates.summary = updates.summary;
    }

    console.log('[PostgresTicketRepository] 📝 DB Updates to apply:', dbUpdates);

    const { data, error } = await supabase
      .from('tickets')
      .update(dbUpdates)
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error updating ticket:', {
        error,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        ticketId,
        tenantId,
        dbUpdates,
      });
      throw error;
    }

    console.log('[PostgresTicketRepository] ✅ Ticket updated successfully:', {
      ticketId: data?.id,
      newStatus: data?.status,
      resolvedAt: data?.resolved_at,
    });

    return this.mapRowToTicket(data);
  }

  async createTicketLog(input: CreateTicketLogInput): Promise<TicketLog> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('ticket_logs')
      .insert({
        id,
        ticket_id: input.ticketId,
        author_type: input.authorType,
        author_id: input.authorId || null,
        action_type: input.actionType,
        from_status: input.fromStatus || null,
        to_status: input.toStatus || null,
        note: input.note || null,
        created_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error creating ticket log:', error);
      throw error;
    }

    return this.mapRowToTicketLog(data);
  }

  async getTicketLogs(ticketId: string, tenantId: string): Promise<TicketLog[]> {
    // Verificar se o ticket pertence ao tenant
    const ticket = await this.findById(ticketId, tenantId);
    if (!ticket) {
      return [];
    }

    const { data, error } = await supabase
      .from('ticket_logs')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostgresTicketRepository] ❌ Error fetching ticket logs:', error);
      return [];
    }

    // Buscar nomes dos usuários para logs com authorType = 'human'
    const logs = (data || []).map(this.mapRowToTicketLog);
    const userIds = logs
      .filter(log => log.authorType === 'human' && log.authorId)
      .map(log => log.authorId!)
      .filter((id, index, self) => self.indexOf(id) === index); // Remover duplicatas

    if (userIds.length > 0) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          
          // Buscar nomes na tabela profiles (novo sistema)
          const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, name')
            .in('id', userIds);
          
          // Buscar nomes na tabela users (sistema antigo) para IDs não encontrados
          const foundProfileIds = new Set(profiles?.map((p: any) => p.id) || []);
          const missingIds = userIds.filter(id => !foundProfileIds.has(id));
          
          let users: any[] = [];
          if (missingIds.length > 0) {
            const { data: usersData } = await supabaseAdmin
              .from('users')
              .select('id, name')
              .in('id', missingIds);
            users = usersData || [];
          }
          
          // Criar mapa de userId -> name
          const userNamesMap = new Map<string, string>();
          profiles?.forEach((p: any) => {
            if (p.name) userNamesMap.set(p.id, p.name);
          });
          users.forEach((u: any) => {
            if (u.name && !userNamesMap.has(u.id)) userNamesMap.set(u.id, u.name);
          });
          
          // Adicionar authorName aos logs
          logs.forEach(log => {
            if (log.authorType === 'human' && log.authorId && userNamesMap.has(log.authorId)) {
              (log as any).authorName = userNamesMap.get(log.authorId);
            }
          });
        }
      } catch (error) {
        console.warn('[PostgresTicketRepository] Erro ao buscar nomes de usuários para logs:', error);
        // Continuar sem os nomes
      }
    }

    return logs;
  }

  private mapRowToTicketLog(row: any): TicketLog {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      authorType: row.author_type,
      authorId: row.author_id || null,
      actionType: row.action_type,
      fromStatus: row.from_status || null,
      toStatus: row.to_status || null,
      note: row.note || null,
      createdAt: new Date(row.created_at).getTime(),
    };
  }

  // Métodos de compatibilidade com interface antiga (para não quebrar código existente)
  // REMOVIDO: findById() sem parâmetros conflita com findById(ticketId, tenantId)
  // O código novo deve usar findById(ticketId, tenantId) diretamente
  // findById(ticketId: string): Ticket | null {
  //   console.warn('[PostgresTicketRepository] ⚠️  findById() without tenantId is not supported');
  //   return null;
  // }

  // REMOVIDO: findAll() sem parâmetros conflita com findAll(tenantId)
  // O código novo deve usar findAll(tenantId) diretamente
  // Se código antigo tentar chamar este método, vai dar erro (o que é esperado)
  // findAll(): Ticket[] {
  //   console.warn('[PostgresTicketRepository] ⚠️  findAll() without tenantId is not supported');
  //   return [];
  // }

  // Método antigo removido - usar findByConversationId(conversationId, tenantId) em vez disso
  // Se código antigo tentar chamar este método, vai dar erro (o que é esperado)

  create(ticket: Ticket): void {
    // Método antigo - usar createTicket() em vez disso
    console.warn('[PostgresTicketRepository] ⚠️  create() is deprecated, use createTicket() instead');
  }

  update(ticketId: string, updates: Partial<Ticket>): void {
    // Método antigo - usar updateStatus() em vez disso
    console.warn('[PostgresTicketRepository] ⚠️  update() is deprecated, use updateStatus() instead');
  }

  private mapRowToTicket(row: any): Ticket {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      conversationId: row.conversation_id,
      storeId: row.store_id || null,
      status: row.status,
      priority: row.priority,
      title: row.title,
      summary: row.summary || null,
      reason: row.reason,
      source: row.source || 'system',
      category: row.category || null,
      assignedToUserId: row.assigned_to_user_id || null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null,
    };
  }
}

export const createPostgresTicketRepository = (): ITicketRepository => {
  return new PostgresTicketRepository();
};
