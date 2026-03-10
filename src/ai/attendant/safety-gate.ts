/**
 * Safety Gate
 * Valida respostas geradas pela IA antes de enviar
 * 
 * Regras:
 * - Não pode prometer ("vou resolver", "garantimos", "está a caminho") sem base
 * - Não pode inventar valores, horários, endereços
 * - Sem links suspeitos
 * - Tamanho máximo: 500 caracteres
 */

export type SafetyGateResult = {
  approved: boolean;
  reason?: string;
  blockedReason?: string;
};

/**
 * Palavras que indicam promessas sem base
 */
const PROMISE_KEYWORDS = [
  'vou resolver', 'vamos resolver', 'garantimos', 'garantido',
  'está a caminho', 'já está indo', 'já enviamos', 'já foi enviado',
  'resolvido', 'pronto', 'feito', 'já está',
];

/**
 * Padrões de links suspeitos
 */
const SUSPICIOUS_LINK_PATTERNS = [
  /https?:\/\/[^\s]+/gi, // Qualquer link HTTP/HTTPS
];

/**
 * Valida uma resposta gerada pela IA
 * 
 * @param responseText - Texto da resposta gerada
 * @param companyContext - Contexto da empresa (para verificar se informações são baseadas em dados reais)
 * @param stores - Lista de lojas cadastradas (para verificar endereços e horários)
 * @param policies - Lista de políticas cadastradas
 * @returns Resultado da validação
 */
export function validateResponse(
  responseText: string,
  companyContext?: {
    businessName?: string;
    address?: string;
    openingHours?: string;
    deliveryPolicy?: string;
    paymentMethods?: string;
  },
  stores?: Array<{
    id: string;
    name: string;
    address: string;
    neighborhood: string;
    city: string;
    openingHours: string;
    phone: string;
    isActive: boolean;
  }>,
  policies?: Array<{
    id: string;
    title: string;
    content: string;
    applicableStores: string[];
  }>
): SafetyGateResult {
  const text = responseText.trim();

  // 1. Verificar tamanho máximo
  if (text.length > 500) {
    return {
      approved: false,
      blockedReason: `Resposta muito longa (${text.length} caracteres, máximo: 500)`,
    };
  }

  // 2. Verificar promessas sem base
  const hasPromise = PROMISE_KEYWORDS.some(keyword => 
    text.toLowerCase().includes(keyword)
  );

  if (hasPromise) {
    return {
      approved: false,
      blockedReason: 'Resposta contém promessas sem base ("vou resolver", "garantimos", etc)',
    };
  }

  // 3. Verificar links suspeitos
  const hasSuspiciousLink = SUSPICIOUS_LINK_PATTERNS.some(pattern => 
    pattern.test(text)
  );

  if (hasSuspiciousLink) {
    return {
      approved: false,
      blockedReason: 'Resposta contém links (não permitido por segurança)',
    };
  }

  // 4. Verificar se inventou informações (heurística básica)
  // Se menciona endereço, verificar se existe em companyContext OU em stores
  if (text.toLowerCase().includes('endereço') || text.toLowerCase().includes('rua') || text.toLowerCase().includes('localização') || text.toLowerCase().includes('onde fica')) {
    const hasAddressInCompany = !!companyContext?.address;
    const hasAddressInStores = stores && stores.some(store => store.isActive && store.address);
    
    if (!hasAddressInCompany && !hasAddressInStores) {
      return {
        approved: false,
        blockedReason: 'Resposta menciona endereço mas não há endereço cadastrado (nem em contexto da empresa nem em lojas)',
      };
    }
  }

  // Se menciona horário, verificar se existe em companyContext OU em stores
  if (text.toLowerCase().includes('horário') || text.toLowerCase().includes('abre') || text.toLowerCase().includes('fecha') || text.toLowerCase().includes('funcionamento')) {
    const hasHoursInCompany = !!companyContext?.openingHours;
    const hasHoursInStores = stores && stores.some(store => store.isActive && store.openingHours);
    
    if (!hasHoursInCompany && !hasHoursInStores) {
      return {
        approved: false,
        blockedReason: 'Resposta menciona horário mas não há horário cadastrado (nem em contexto da empresa nem em lojas)',
      };
    }
  }

  // Se menciona formas de pagamento, verificar se existe em companyContext OU em policies
  if (text.toLowerCase().includes('pagamento') || text.toLowerCase().includes('aceita') || text.toLowerCase().includes('cartão') || text.toLowerCase().includes('pix') || text.toLowerCase().includes('dinheiro')) {
    const hasPaymentInCompany = !!companyContext?.paymentMethods;
    const hasPaymentInPolicies = policies && policies.some(policy => 
      policy.content.toLowerCase().includes('pagamento') || 
      policy.content.toLowerCase().includes('cartão') ||
      policy.content.toLowerCase().includes('pix')
    );
    
    if (!hasPaymentInCompany && !hasPaymentInPolicies) {
      return {
        approved: false,
        blockedReason: 'Resposta menciona formas de pagamento mas não há informações cadastradas (nem em contexto da empresa nem em políticas)',
      };
    }
  }

  // 5. Verificar se está muito genérica (pode indicar que não tem contexto)
  const genericPhrases = [
    'não tenho essa informação',
    'não sei',
    'não posso ajudar',
    'não consigo',
  ];

  const isTooGeneric = genericPhrases.some(phrase => 
    text.toLowerCase().includes(phrase)
  );

  if (isTooGeneric && text.length < 50) {
    // Se é muito genérica e curta, pode ser que não tenha contexto suficiente
    return {
      approved: false,
      blockedReason: 'Resposta muito genérica - pode indicar falta de contexto',
    };
  }

  // Tudo OK
  return {
    approved: true,
    reason: 'Resposta aprovada pelo Safety Gate',
  };
}

