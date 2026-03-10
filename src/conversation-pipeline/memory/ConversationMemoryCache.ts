/**
 * Interface para cache de memória de conversas
 * Permite diferentes implementações (in-memory, Redis, etc.)
 */
export interface ConversationMemoryCache {
  /**
   * Busca últimas N mensagens do cache
   * @returns Array de mensagens ou null se não encontrado/expirado
   */
  getLastMessages(
    tenantId: string,
    conversationId: string,
    limit: number
  ): Promise<any[] | null>;

  /**
   * Armazena últimas N mensagens no cache
   * @param ttlSeconds Tempo de vida em segundos
   */
  setLastMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    messages: any[],
    ttlSeconds: number
  ): Promise<void>;

  /**
   * Invalida cache de uma conversa (remove todas as entradas para essa conversa)
   */
  invalidate(tenantId: string, conversationId: string): Promise<void>;

  /**
   * Limpa todo o cache (útil para testes ou reset)
   */
  clear(): Promise<void>;
}
