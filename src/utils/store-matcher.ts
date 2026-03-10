/**
 * Store Matcher - Função utilitária para matching restritivo de lojas
 * 
 * Evita falsos positivos como "ta" dando match com "Rio Tavares"
 */

export type StoreMatchResult = {
  matched: boolean;
  matchType?: 'exact' | 'name_contains' | 'neighborhood_contains' | 'name_starts_with';
  confidence: number; // 0-1, onde 1 é match exato
};

/**
 * Lista de stopwords comuns que não devem ser consideradas nomes de loja
 */
const STOPWORDS = new Set([
  'ta', 'tá', 'na', 'da', 'de', 'do', 'em', 'no', 'a', 'o', 'e', 'ou',
  'com', 'sem', 'por', 'para', 'que', 'qual', 'quando', 'onde', 'como',
  'tem', 'tem', 'têm', 'foi', 'são', 'está', 'estão', 'ser', 'ter',
  'vou', 'vai', 'vão', 'pode', 'pode', 'podem', 'quer', 'querem',
  'quero', 'quero', 'querem', 'preciso', 'precisa', 'precisam',
]);

/**
 * Valida se um termo pode ser considerado um nome de loja
 * 
 * @param term Termo extraído
 * @param availableStores Lista de lojas disponíveis para verificar match exato
 * @returns true se o termo é válido para ser considerado nome de loja
 */
export function isValidStoreName(
  term: string | null | undefined,
  availableStores?: Array<{ name: string; neighborhood?: string }>
): boolean {
  if (!term || term.trim().length === 0) {
    return false;
  }

  const normalizedTerm = term.trim().toLowerCase();

  // Se tem menos de 3 caracteres, só aceita se for match exato com apelido/nome cadastrado
  if (normalizedTerm.length < 3) {
    if (availableStores) {
      // Verificar se é match exato (case-insensitive) com nome ou bairro
      const isExactMatch = availableStores.some(store => {
        const storeName = store.name.toLowerCase().trim();
        const neighborhood = store.neighborhood?.toLowerCase().trim() || '';
        
        // Match exato com nome completo ou bairro
        return storeName === normalizedTerm || 
               neighborhood === normalizedTerm ||
               // Match exato com palavra do nome (ex: "ta" não deve dar match, mas "rio" pode se for "Rio Tavares")
               storeName.split(/\s+/).some(word => word === normalizedTerm && word.length >= 3) ||
               neighborhood.split(/\s+/).some(word => word === normalizedTerm && word.length >= 3);
      });
      
      return isExactMatch;
    }
    
    // Sem lista de lojas, rejeitar termos com menos de 3 caracteres
    return false;
  }

  // Rejeitar stopwords comuns
  if (STOPWORDS.has(normalizedTerm)) {
    return false;
  }

  return true;
}

/**
 * Faz match restritivo entre um termo e uma loja
 * 
 * Regras:
 * - Match exato: maior confiança
 * - Nome contém termo: média confiança (mas termo deve ter pelo menos 3 caracteres)
 * - Bairro contém termo: média confiança (mas termo deve ter pelo menos 3 caracteres)
 * - Nome começa com termo: baixa confiança (mas termo deve ter pelo menos 3 caracteres)
 * 
 * @param term Termo a ser comparado
 * @param store Loja a ser comparada
 * @returns Resultado do match com confiança
 */
export function matchStore(
  term: string,
  store: { name: string; neighborhood?: string }
): StoreMatchResult {
  const normalizedTerm = term.trim().toLowerCase();
  const storeName = store.name.toLowerCase().trim();
  const neighborhood = (store.neighborhood || '').toLowerCase().trim();

  // Match exato com nome completo
  if (storeName === normalizedTerm) {
    return { matched: true, matchType: 'exact', confidence: 1.0 };
  }

  // Match exato com bairro
  if (neighborhood && neighborhood === normalizedTerm) {
    return { matched: true, matchType: 'neighborhood_contains', confidence: 0.9 };
  }

  // Se o termo tem menos de 3 caracteres, não fazer match parcial
  if (normalizedTerm.length < 3) {
    return { matched: false, confidence: 0 };
  }

  // Match com palavra completa do nome (não substring)
  const storeNameWords = storeName.split(/\s+/);
  const termWords = normalizedTerm.split(/\s+/);
  
  // Verificar se todas as palavras do termo estão no nome (match de palavras completas)
  const allWordsMatch = termWords.every(termWord => 
    storeNameWords.some(storeWord => storeWord === termWord)
  );
  
  if (allWordsMatch && termWords.length > 0) {
    return { matched: true, matchType: 'name_contains', confidence: 0.8 };
  }

  // Match com palavra completa do bairro
  if (neighborhood) {
    const neighborhoodWords = neighborhood.split(/\s+/);
    const allNeighborhoodWordsMatch = termWords.every(termWord => 
      neighborhoodWords.some(neighborhoodWord => neighborhoodWord === termWord)
    );
    
    if (allNeighborhoodWordsMatch && termWords.length > 0) {
      return { matched: true, matchType: 'neighborhood_contains', confidence: 0.7 };
    }
  }

  // Match parcial restritivo: nome contém termo, mas termo deve ter pelo menos 3 caracteres
  // E o termo não deve ser apenas uma substring inicial muito curta
  if (normalizedTerm.length >= 3) {
    // Verificar se o nome contém o termo como palavra completa ou início de palavra
    // Mas evitar matches muito fracos como "ta" em "Tavares"
    if (storeName.includes(normalizedTerm)) {
      // Verificar se é início de palavra (mais confiável)
      const startsWithMatch = storeNameWords.some(word => word.startsWith(normalizedTerm));
      if (startsWithMatch) {
        return { matched: true, matchType: 'name_starts_with', confidence: 0.6 };
      }
      
      // Match parcial geral (menos confiável)
      return { matched: true, matchType: 'name_contains', confidence: 0.4 };
    }

    // Mesma lógica para bairro
    if (neighborhood && neighborhood.includes(normalizedTerm)) {
      const neighborhoodStartsWithMatch = neighborhood.split(/\s+/).some(word => word.startsWith(normalizedTerm));
      if (neighborhoodStartsWithMatch) {
        return { matched: true, matchType: 'neighborhood_contains', confidence: 0.5 };
      }
      return { matched: true, matchType: 'neighborhood_contains', confidence: 0.3 };
    }
  }

  return { matched: false, confidence: 0 };
}

/**
 * Encontra a melhor loja correspondente ao termo
 * Prioriza matches por bairro sobre matches por nome
 * 
 * @param term Termo a ser buscado
 * @param stores Lista de lojas disponíveis
 * @returns Loja correspondente ou null
 */
export function findBestStoreMatch(
  term: string,
  stores: Array<{ id: string; name: string; neighborhood?: string }>
): { id: string; name: string; matchType: string; confidence: number } | null {
  if (!term || term.trim().length === 0) {
    return null;
  }

  const matches: Array<{
    store: { id: string; name: string; neighborhood?: string };
    matchResult: StoreMatchResult;
  }> = [];

  for (const store of stores) {
    const matchResult = matchStore(term, store);
    if (matchResult.matched) {
      matches.push({ store, matchResult });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Ordenar por: 1) Tipo de match (bairro > nome), 2) Confiança
  matches.sort((a, b) => {
    // Priorizar matches por bairro
    const aIsNeighborhood = a.matchResult.matchType === 'neighborhood_contains';
    const bIsNeighborhood = b.matchResult.matchType === 'neighborhood_contains';
    
    if (aIsNeighborhood && !bIsNeighborhood) return -1;
    if (!aIsNeighborhood && bIsNeighborhood) return 1;
    
    // Se ambos são do mesmo tipo, ordenar por confiança
    return b.matchResult.confidence - a.matchResult.confidence;
  });

  // Retornar o match com maior prioridade (bairro primeiro, depois maior confiança)
  const bestMatch = matches[0];
  return {
    id: bestMatch.store.id,
    name: bestMatch.store.name,
    matchType: bestMatch.matchResult.matchType || 'name_contains',
    confidence: bestMatch.matchResult.confidence,
  };
}
