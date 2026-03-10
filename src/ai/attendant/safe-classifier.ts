/**
 * Safe Classifier
 * Classifica se uma mensagem é "SAFE" para resposta automática
 * 
 * Regras SAFE:
 * - Informação simples: endereço, horário, entrega, formas de pagamento, promoções genéricas, localização, contato
 * 
 * Regras NOT SAFE:
 * - Reclamações, urgências, ameaças, chargeback, jurídico, erro operacional, devolução complexa, denúncia, xingamento, sentimento negativo forte
 */

export type SafeClassificationResult = {
  isSafe: boolean;
  reason: string;
  intent: string;
};

/**
 * Palavras-chave que indicam mensagens NOT SAFE
 */
const UNSAFE_KEYWORDS = [
  // Reclamações
  'reclamação', 'reclamar', 'reclamando', 'reclamou', 'problema', 'problemas',
  'erro', 'errado', 'falhou', 'falha', 'não funcionou', 'não funciona',
  'ruim', 'péssimo', 'horrível', 'terrível', 'lixo', 'merda',
  
  // Urgências
  'urgente', 'urgência', 'emergência', 'emergente', 'agora', 'imediato',
  'preciso agora', 'preciso urgente',
  
  // Ameaças (devolução/reembolso removido - será tratado pelo PolicyEngine)
  'processo', 'processar', 'advogado', 'jurídico', 'justiça', 'juiz',
  'chargeback', 'estorno',
  'denúncia', 'denunciar', 'procon', 'consumidor',
  
  // Sentimento negativo
  'raiva', 'bravo', 'irritado', 'frustrado', 'decepcionado',
  'nunca mais', 'não compro mais', 'cancelar', 'cancelamento',
  
  // Xingamentos comuns
  'caralho', 'porra', 'merda', 'puta', 'foda', 'fodido',
];

/**
 * Palavras-chave que indicam mensagens SAFE
 */
const SAFE_KEYWORDS = [
  // Informações básicas
  'endereço', 'localização', 'onde fica', 'onde está', 'rua', 'avenida',
  'horário', 'horários', 'abre', 'fecha', 'funciona', 'atende',
  'telefone', 'contato', 'whatsapp', 'ligar',
  
  // Entrega
  'entrega', 'delivery', 'entregam', 'frete', 'valor do frete',
  'tempo de entrega', 'prazo de entrega',
  
  // Pagamento
  'pagamento', 'pagar', 'formas de pagamento', 'aceita', 'cartão',
  'débito', 'crédito', 'pix', 'dinheiro',
  
  // Produtos e promoções
  'tem', 'têm', 'produto', 'produtos', 'preço', 'preços',
  'promoção', 'promoções', 'desconto', 'ofertas',
  
  // Horários e funcionamento
  'aberto', 'fechado', 'funciona hoje', 'atende hoje',
];

/**
 * Classifica uma mensagem como SAFE ou NOT SAFE usando heurísticas
 * 
 * @param messageText - Texto da mensagem do cliente
 * @returns Classificação com isSafe, reason e intent
 */
export function classifyMessage(messageText: string): SafeClassificationResult {
  const text = messageText.toLowerCase().trim();
  
  // Mensagem vazia ou muito curta
  if (text.length < 3) {
    return {
      isSafe: false,
      reason: 'Mensagem muito curta ou vazia',
      intent: 'unknown',
    };
  }

  // Verificar palavras NOT SAFE primeiro (prioridade)
  const hasUnsafeKeyword = UNSAFE_KEYWORDS.some(keyword => 
    text.includes(keyword)
  );

  if (hasUnsafeKeyword) {
    // Identificar tipo de intenção
    let intent = 'complaint';
    if (text.includes('urgente') || text.includes('emergência')) {
      intent = 'urgency';
    } else if (text.includes('processo') || text.includes('advogado') || text.includes('jurídico')) {
      intent = 'legal';
    } else if (text.includes('chargeback') || text.includes('estorno') || text.includes('devolução')) {
      intent = 'refund';
    } else if (text.includes('denúncia') || text.includes('procon')) {
      intent = 'complaint_legal';
    }

    return {
      isSafe: false,
      reason: `Mensagem contém palavras-chave de risco: ${intent}`,
      intent,
    };
  }

  // Verificar palavras SAFE
  const hasSafeKeyword = SAFE_KEYWORDS.some(keyword => 
    text.includes(keyword)
  );

  // Verificar se menciona devolução/reembolso (será tratado pelo PolicyEngine)
  const mentionsRefund = text.includes('devolução') || text.includes('devolver') || 
                         text.includes('reembolso') || text.includes('troca') ||
                         text.includes('devolver produto') || text.includes('quero devolver');

  if (mentionsRefund) {
    // Devolução não bloqueia por padrão - PolicyEngine decidirá
    return {
      isSafe: true, // Permitir que PolicyEngine avalie
      reason: 'Mensagem menciona devolução/reembolso - será avaliada pelo PolicyEngine',
      intent: 'refund',
    };
  }

  if (hasSafeKeyword) {
    // Identificar tipo de intenção
    let intent = 'information';
    if (text.includes('endereço') || text.includes('localização') || text.includes('onde')) {
      intent = 'address';
    } else if (text.includes('horário') || text.includes('abre') || text.includes('fecha')) {
      intent = 'hours';
    } else if (text.includes('entrega') || text.includes('delivery') || text.includes('frete')) {
      intent = 'delivery';
    } else if (text.includes('pagamento') || text.includes('pagar') || text.includes('aceita')) {
      intent = 'payment';
    } else if (text.includes('telefone') || text.includes('contato') || text.includes('ligar')) {
      intent = 'contact';
    } else if (text.includes('produto') || text.includes('preço') || text.includes('promoção')) {
      intent = 'product';
    }

    return {
      isSafe: true,
      reason: `Mensagem parece ser solicitação de informação simples: ${intent}`,
      intent,
    };
  }

  // Se não encontrou palavras-chave claras, ser conservador (NOT SAFE)
  return {
    isSafe: false,
    reason: 'Mensagem não contém palavras-chave claras de informação simples',
    intent: 'unknown',
  };
}

