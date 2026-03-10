/**
 * Language Agent Types
 * Agente Boca - Camada de linguagem pura
 * 
 * Responsabilidade única: Transformar texto do sistema em linguagem humana, educada e profissional
 * SEM alterar significado, regras ou decisões.
 */

/**
 * Contexto para humanização da resposta
 */
export type LanguageContext = {
  /**
   * Tipo de resposta (para ajustar tom)
   */
  responseType: 'tool_done' | 'tool_handoff' | 'tool_need_input' | 'ai_response' | 'store_info' | 'policy_info';
  
  /**
   * Dados estruturados disponíveis (opcional)
   */
  structuredData?: {
    storeName?: string;
    storeAddress?: string;
    storePhone?: string;
    storeHours?: string;
    policyTitle?: string;
    toolName?: string;
  };
  
  /**
   * Texto original do sistema (que será humanizado)
   */
  originalText: string;
};

/**
 * Resultado da humanização
 */
export type HumanizedResponse = {
  text: string;
  metadata?: {
    originalLength: number;
    humanizedLength: number;
    responseType: LanguageContext['responseType'];
  };
};
