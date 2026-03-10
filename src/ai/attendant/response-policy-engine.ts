/**
 * Response Policy Engine
 * Verifica políticas cadastradas e decide se pode responder automaticamente
 * 
 * Responsabilidade:
 * - Verificar se existe política para o tópico (ex: RETURN/REFUND)
 * - Gerar resposta automática segura baseada na política
 * - Decidir se pode responder automaticamente ou precisa de humano
 */

export type PolicyType = 'RETURN' | 'REFUND' | 'DELIVERY' | 'PAYMENT' | 'OTHER';

export type PolicyInput = {
  id: string;
  title: string;
  content: string;
  applicableStores: string[];
  createdAt?: number;
  updatedAt?: number;
};

export type PolicyEngineInput = {
  intent: string;
  topic: string; // 'refund', 'return', etc
  userMessage: string;
  policies: PolicyInput[];
  stores?: Array<{
    id: string;
    name: string;
    isActive: boolean;
  }>;
  conversationStoreId?: string; // ID da loja selecionada na conversa (se existir)
  conversationStoreName?: string; // Nome da loja selecionada
};

export type PolicyEngineResult = {
  canAutoReply: boolean;
  templateResponse?: string;
  reason: string;
  requiresHumanApproval?: boolean;
};

/**
 * Palavras-chave que indicam exigências que devem bloquear resposta automática
 */
const BLOCKING_KEYWORDS = {
  immediate: ['agora', 'hoje', 'imediato', 'urgente', 'já', 'devolve hoje', 'quero meu dinheiro agora'],
  exception: ['mesmo sem nota', 'sem nota fiscal', 'produto aberto', 'já usei', 'já abri', 'sem caixa'],
  threat: ['processo', 'advogado', 'jurídico', 'procon', 'denúncia', 'reclamação', 'chargeback'],
  specific: ['quanto tempo', 'qual o prazo', 'quanto custa', 'qual o valor', 'em quanto tempo'],
};

/**
 * Verifica se a mensagem contém palavras-chave que devem bloquear resposta automática
 */
function shouldBlockAutoReply(userMessage: string): { shouldBlock: boolean; reason: string } {
  const text = userMessage.toLowerCase();

  // Verificar exigências imediatas
  if (BLOCKING_KEYWORDS.immediate.some(keyword => text.includes(keyword))) {
    return {
      shouldBlock: true,
      reason: 'Usuário exige reembolso/devolução imediata',
    };
  }

  // Verificar pedidos de exceção
  if (BLOCKING_KEYWORDS.exception.some(keyword => text.includes(keyword))) {
    return {
      shouldBlock: true,
      reason: 'Usuário pede exceção (sem nota, produto aberto, etc)',
    };
  }

  // Verificar ameaças
  if (BLOCKING_KEYWORDS.threat.some(keyword => text.includes(keyword))) {
    return {
      shouldBlock: true,
      reason: 'Mensagem contém ameaça reputacional ou ação legal',
    };
  }

  // Verificar pedidos de valores/prazos específicos
  if (BLOCKING_KEYWORDS.specific.some(keyword => text.includes(keyword))) {
    return {
      shouldBlock: true,
      reason: 'Usuário pede valores ou prazos específicos',
    };
  }

  return { shouldBlock: false, reason: '' };
}

/**
 * Encontra políticas relevantes para o tópico
 */
function findRelevantPolicies(
  topic: string,
  policies: PolicyInput[],
  storeId?: string
): PolicyInput[] {
  const topicLower = topic.toLowerCase();
  
  // Filtrar políticas que mencionam o tópico no título ou conteúdo
  const relevant = policies.filter(policy => {
    const titleLower = policy.title.toLowerCase();
    const contentLower = policy.content.toLowerCase();
    
    const mentionsTopic = 
      titleLower.includes(topicLower) ||
      contentLower.includes(topicLower) ||
      titleLower.includes('devolução') ||
      titleLower.includes('reembolso') ||
      titleLower.includes('troca') ||
      contentLower.includes('devolução') ||
      contentLower.includes('reembolso') ||
      contentLower.includes('troca');
    
    if (!mentionsTopic) return false;
    
    // Se tem loja específica, verificar se a política se aplica
    if (storeId && policy.applicableStores.length > 0) {
      return policy.applicableStores.includes(storeId);
    }
    
    // Se não tem loja específica ou política se aplica a todas (array vazio)
    return true;
  });
  
  return relevant;
}

/**
 * Gera resposta automática segura baseada na política
 */
function generateSafeResponse(
  policies: PolicyInput[],
  stores?: Array<{ id: string; name: string; isActive: boolean }>,
  conversationStoreId?: string
): string {
  // Se há múltiplas lojas e não há loja vinculada à conversa, perguntar qual loja
  if (stores && stores.length > 1 && !conversationStoreId) {
    return 'Para te ajudar melhor com informações sobre devolução, preciso saber em qual loja você fez a compra. Pode me informar?';
  }

  // Se há política, usar o conteúdo (limitado e seguro)
  if (policies.length > 0) {
    const policy = policies[0]; // Usar a primeira política relevante
    const storeName = stores?.find(s => s.id === conversationStoreId)?.name;
    
    let response = 'Entendo sua dúvida sobre devolução. ';
    
    if (storeName) {
      response += `De acordo com nossa política${storeName ? ` da loja ${storeName}` : ''}, `;
    } else {
      response += 'De acordo com nossa política, ';
    }
    
    // Extrair informações relevantes da política (primeiros 200 caracteres)
    const policyPreview = policy.content.substring(0, 200);
    response += policyPreview;
    
    // Adicionar disclaimer
    response += ' As condições específicas podem variar dependendo do caso. Para mais detalhes, um atendente pode te ajudar melhor.';
    
    return response;
  }

  // Fallback se não há política
  return 'Recebemos sua mensagem sobre devolução. Nossas condições de devolução dependem de alguns fatores. Um atendente irá te ajudar com mais detalhes em breve.';
}

/**
 * Engine principal que decide se pode responder automaticamente
 */
export function evaluatePolicyResponse(input: PolicyEngineInput): PolicyEngineResult {
  const { topic, userMessage, policies, stores, conversationStoreId } = input;

  // 1. Verificar se deve bloquear por palavras-chave
  const blockCheck = shouldBlockAutoReply(userMessage);
  if (blockCheck.shouldBlock) {
    return {
      canAutoReply: false,
      reason: blockCheck.reason,
      requiresHumanApproval: true,
    };
  }

  // 2. Verificar se há políticas relevantes
  const relevantPolicies = findRelevantPolicies(topic, policies, conversationStoreId);

  if (relevantPolicies.length === 0) {
    // Se não há política e há múltiplas lojas, perguntar qual loja
    if (stores && stores.length > 1) {
      return {
        canAutoReply: true,
        templateResponse: 'Para te ajudar melhor com informações sobre devolução, preciso saber em qual loja você fez a compra. Pode me informar?',
        reason: 'Não há política cadastrada - perguntando qual loja',
      };
    }

    // Se não há política e não há múltiplas lojas, sugerir humano
    return {
      canAutoReply: false,
      reason: 'Não há política de devolução cadastrada para esta loja',
      requiresHumanApproval: true,
    };
  }

  // 3. Gerar resposta automática segura
  const templateResponse = generateSafeResponse(relevantPolicies, stores, conversationStoreId);

  return {
    canAutoReply: true,
    templateResponse,
    reason: `Política encontrada - resposta automática gerada`,
  };
}

