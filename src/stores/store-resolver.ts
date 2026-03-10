/**
 * Store Resolver
 * Identifica qual loja o usuário está se referindo pelo texto da mensagem
 * 
 * Responsabilidade:
 * - Buscar lojas do tenant
 * - Normalizar texto (lowercase, remover acentos)
 * - Fazer match por nome, bairro ou aliases
 * - Retornar storeId único ou candidatos
 */

import type { StoreService } from './service';
import type { Store } from './types';

export type StoreResolverResult = {
  resolved: boolean;
  storeId?: string;
  storeName?: string;
  candidates?: Array<{ id: string; name: string; matchReason: string }>;
  reason: string;
};

/**
 * Normaliza texto removendo acentos e convertendo para lowercase
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .trim();
}

/**
 * Verifica se o texto menciona a loja (por nome, bairro ou aliases)
 */
function matchesStore(text: string, store: Store): boolean {
  const normalizedText = normalizeText(text);
  const storeName = normalizeText(store.name);
  const neighborhood = normalizeText(store.neighborhood);
  const city = normalizeText(store.city);
  
  // Match por nome completo
  if (normalizedText.includes(storeName) || storeName.includes(normalizedText)) {
    return true;
  }
  
  // Match por bairro
  if (neighborhood && (normalizedText.includes(neighborhood) || neighborhood.includes(normalizedText))) {
    return true;
  }
  
  // Match por cidade (menos específico, mas pode ajudar)
  if (city && normalizedText.includes(city)) {
    return true;
  }
  
  // Aliases comuns (ex: "da armação" => "armação")
  const nameWords = storeName.split(/\s+/);
  for (const word of nameWords) {
    if (word.length > 3 && normalizedText.includes(word)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Identifica qual loja o usuário está se referindo
 * 
 * @param storeService - Serviço para buscar lojas
 * @param tenantId - ID do tenant
 * @param messageText - Texto da mensagem do usuário
 * @returns Resultado com storeId resolvido ou candidatos
 */
export async function resolveStore(
  storeService: StoreService,
  tenantId: string,
  messageText: string
): Promise<StoreResolverResult> {
  if (!messageText || messageText.trim().length === 0) {
    return {
      resolved: false,
      reason: 'Mensagem vazia',
    };
  }

  try {
    // Buscar todas as lojas ativas do tenant
    const stores = await storeService.getAllStores(tenantId);
    const activeStores = stores.filter(store => store.isActive);

    if (activeStores.length === 0) {
      return {
        resolved: false,
        reason: 'Nenhuma loja ativa cadastrada',
      };
    }

    // Se há apenas uma loja, retornar ela diretamente
    if (activeStores.length === 1) {
      return {
        resolved: true,
        storeId: activeStores[0].id,
        storeName: activeStores[0].name,
        reason: 'Apenas uma loja cadastrada',
      };
    }

    // Buscar matches
    const matches: Array<{ store: Store; matchReason: string }> = [];

    for (const store of activeStores) {
      if (matchesStore(messageText, store)) {
        const normalizedText = normalizeText(messageText);
        const storeName = normalizeText(store.name);
        const neighborhood = normalizeText(store.neighborhood);
        
        let matchReason = 'nome';
        if (normalizedText.includes(storeName)) {
          matchReason = 'nome';
        } else if (neighborhood && normalizedText.includes(neighborhood)) {
          matchReason = 'bairro';
        } else {
          matchReason = 'palavra-chave';
        }
        
        matches.push({ store, matchReason });
      }
    }

    // Se nenhum match, retornar null
    if (matches.length === 0) {
      return {
        resolved: false,
        reason: 'Nenhuma loja encontrada que corresponda ao texto',
      };
    }

    // Se match único, retornar storeId
    if (matches.length === 1) {
      return {
        resolved: true,
        storeId: matches[0].store.id,
        storeName: matches[0].store.name,
        reason: `Loja identificada por ${matches[0].matchReason}`,
      };
    }

    // Se múltiplos matches, retornar candidatos
    return {
      resolved: false,
      candidates: matches.map(m => ({
        id: m.store.id,
        name: m.store.name,
        matchReason: m.matchReason,
      })),
      reason: `Múltiplas lojas encontradas (${matches.length} candidatos)`,
    };
  } catch (error) {
    console.error('[StoreResolver] Error resolving store:', error);
    return {
      resolved: false,
      reason: `Erro ao buscar lojas: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

