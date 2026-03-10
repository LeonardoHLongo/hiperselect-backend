/**
 * Implementação in-memory do cache de memória de conversas
 * Usa Map para armazenar mensagens com TTL
 * Preparado para ser substituído por Redis no futuro
 */

import type { ConversationMemoryCache } from './ConversationMemoryCache';

type CacheEntry = {
  messages: any[];
  expiresAt: number;
};

export class InMemoryConversationMemoryCache implements ConversationMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private defaultTtlSeconds: number = 60) {
    // Limpeza periódica de entradas expiradas (a cada 30 segundos)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 30000);
  }

  /**
   * Gera chave de cache: mem:v1:${tenantId}:${conversationId}:${limit}
   */
  private getCacheKey(tenantId: string, conversationId: string, limit: number): string {
    return `mem:v1:${tenantId}:${conversationId}:${limit}`;
  }

  /**
   * Gera prefixo de chave para invalidar todas as entradas de uma conversa
   */
  private getConversationPrefix(tenantId: string, conversationId: string): string {
    return `mem:v1:${tenantId}:${conversationId}:`;
  }

  async getLastMessages(
    tenantId: string,
    conversationId: string,
    limit: number
  ): Promise<any[] | null> {
    const key = this.getCacheKey(tenantId, conversationId, limit);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Verificar se expirou
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.messages;
  }

  async setLastMessages(
    tenantId: string,
    conversationId: string,
    limit: number,
    messages: any[],
    ttlSeconds: number
  ): Promise<void> {
    const key = this.getCacheKey(tenantId, conversationId, limit);
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.cache.set(key, {
      messages,
      expiresAt,
    });
  }

  async invalidate(tenantId: string, conversationId: string): Promise<void> {
    const prefix = this.getConversationPrefix(tenantId, conversationId);
    const keysToDelete: string[] = [];

    // Encontrar todas as chaves que começam com o prefixo
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    // Remover todas as entradas encontradas
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Remove entradas expiradas do cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Destrói o cache e limpa o intervalo de limpeza
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}
