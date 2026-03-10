/**
 * Função central para decidir quando desligar IA após HANDOFF
 * 
 * Regra: 100% determinística e congelável
 * - NÃO usa LLM para decidir
 * - Baseada apenas no motivo do handoff
 * 
 * Motivos:
 * - "sensitive_or_policy_blocked": Desliga IA (questões sensíveis/bloqueadas)
 * - "unknown_or_missing_data": Mantém IA ligada (apenas falta informação)
 */

export type HandoffReason =
  | 'unknown_or_missing_data'
  | 'sensitive_or_policy_blocked'
  | 'user_requested_human'; // Para compatibilidade com AIHandoffTool existente

/**
 * Decide se a IA deve ser desligada baseado no motivo do handoff
 * 
 * @param reason Motivo do handoff
 * @returns true se IA deve ser desligada, false caso contrário
 */
export function shouldDisableAI(reason: HandoffReason): boolean {
  switch (reason) {
    case 'sensitive_or_policy_blocked':
      // Questões sensíveis ou bloqueadas por política: desliga IA
      return true;
    
    case 'user_requested_human':
      // Usuário explicitamente pediu humano: desliga IA
      return true;
    
    case 'unknown_or_missing_data':
    default:
      // Apenas falta informação: mantém IA ligada
      return false;
  }
}

/**
 * Mapeia handoffReason para notificationType
 */
export function getNotificationType(reason: HandoffReason): string {
  switch (reason) {
    case 'unknown_or_missing_data':
      return 'handoff_missing_data';
    case 'sensitive_or_policy_blocked':
      return 'handoff_sensitive';
    case 'user_requested_human':
      return 'handoff_user_requested';
    default:
      return 'handoff_unknown';
  }
}

/**
 * Retorna severidade visual da notificação baseada no motivo do handoff
 * - "warning" (amarelo): menos crítica (unknown_or_missing_data)
 * - "error" (vermelho): mais crítica (sensitive_or_policy_blocked, user_requested_human)
 */
export function getSeverity(reason: HandoffReason): 'warning' | 'error' {
  switch (reason) {
    case 'unknown_or_missing_data':
      return 'warning'; // Amarelo - menos crítica
    case 'sensitive_or_policy_blocked':
    case 'user_requested_human':
      return 'error'; // Vermelho - mais crítica
    default:
      return 'warning';
  }
}

/**
 * Retorna mensagem padrão para o cliente baseado no motivo do handoff
 */
export function getHandoffMessage(reason: HandoffReason, disableAI: boolean): string {
  if (disableAI) {
    // IA será desligada - mensagem mais direta
    switch (reason) {
      case 'sensitive_or_policy_blocked':
        return 'Entendi. Vou te colocar com um atendente humano agora.';
      case 'user_requested_human':
        return 'Entendi. Vou te colocar com um atendente humano agora.';
      default:
        return 'Entendi. Vou te colocar com um atendente humano agora.';
    }
  } else {
    // IA continua ligada - mensagem mais calorosa
    switch (reason) {
      case 'unknown_or_missing_data':
        return 'Entendi 😊 Não tenho essa informação cadastrada aqui. Um atendente confirma pra você.';
      default:
        return 'Entendi 😊 Não tenho essa informação cadastrada aqui. Um atendente confirma pra você.';
    }
  }
}
