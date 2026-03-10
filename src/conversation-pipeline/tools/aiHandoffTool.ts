/**
 * AI Handoff Tool
 * Detecta quando o usuário pede para falar com um atendente humano
 * e desliga a IA de forma determinística
 */

import type { Tool, ToolInput, ToolResult } from './types';
import { logger } from '../../utils/logger';

export class AIHandoffTool implements Tool {
  name = 'ai_handoff';

  canHandle(input: ToolInput): boolean {
    const text = input.messageText.toLowerCase().trim();
    
    // 1. Pedidos explícitos de humano
    const explicitKeywords = [
      'quero um atendente',
      'quero falar com humano',
      'pode me atender',
      'atendente humano',
      'falar com pessoa',
      'falar com alguém',
      'quero pessoa',
      'atendente',
      'humano',
      'pessoa real',
      'falar com gente',
      'não quero bot',
      'não quero robô',
      'quero gente',
    ];
    
    const hasExplicitRequest = explicitKeywords.some(keyword => text.includes(keyword));
    
    // 2. Keywords jurídicas (ameaças legais)
    // NOTA: Reclamações de saúde/segurança são tratadas pelo IntentRouter como URGENT_COMPLAINT
    const legalKeywords = [
      'vou processar',
      'processar',
      'advogado',
      'jurídico',
      'justiça',
      'juiz',
      'procon',
      'denúncia',
      'denunciar',
      'consumidor',
      'polícia',
      'policia',
      'delegacia',
    ];
    
    const hasLegalThreat = legalKeywords.some(keyword => text.includes(keyword));
    
    const matched = hasExplicitRequest || hasLegalThreat;
    
    logger.debug(`[AIHandoffTool] canHandle()`, {
      message: input.messageText.substring(0, 50) + '...',
      matched,
      hasExplicitRequest,
      hasLegalThreat,
      matchedKeywords: [
        ...explicitKeywords.filter(k => text.includes(k)),
        ...legalKeywords.filter(k => text.includes(k)),
      ],
    });
    
    return matched;
  }

  async run(input: ToolInput): Promise<ToolResult> {
    logger.group('👤 AIHandoffTool - Executando', [
      { label: 'Conversation ID', value: input.conversationId },
      { label: 'Mensagem', value: input.messageText.substring(0, 50) + '...' },
    ]);

    const text = input.messageText.toLowerCase().trim();
    
    // Detectar se é pedido explícito ou ameaça jurídica
    const explicitKeywords = [
      'quero um atendente', 'quero falar com humano', 'pode me atender',
      'atendente humano', 'falar com pessoa', 'falar com alguém',
      'quero pessoa', 'atendente', 'humano', 'pessoa real',
      'falar com gente', 'não quero bot', 'não quero robô', 'quero gente',
    ];
    
    // Keywords jurídicas (ameaças legais)
    // NOTA: Reclamações de saúde/segurança são tratadas pelo IntentRouter como URGENT_COMPLAINT
    const legalKeywords = [
      'vou processar',
      'processar',
      'advogado',
      'jurídico',
      'justiça',
      'juiz',
      'procon',
      'denúncia',
      'denunciar',
      'consumidor',
      'polícia',
      'policia',
      'delegacia',
    ];
    
    const isExplicitRequest = explicitKeywords.some(k => text.includes(k));
    const isLegalThreat = legalKeywords.some(k => text.includes(k));
    
    // Determinar motivo e resposta apropriada
    let handoffReason: 'user_requested_human' | 'sensitive_or_policy_blocked';
    let responseText: string;
    let ticketRequest: { priority: 'urgent' | 'high' | 'normal'; category?: string; title?: string; summary?: string } | undefined;
    
    if (isLegalThreat) {
      // Ameaça jurídica - criar ticket urgente
      handoffReason = 'sensitive_or_policy_blocked';
      responseText = 'Entendi sua preocupação. Vou te colocar com um atendente humano imediatamente para resolver isso.';
      ticketRequest = {
        priority: 'urgent',
        category: 'legal',
        title: 'Ameaça legal detectada',
        summary: input.messageText.substring(0, 200),
      };
    } else {
      // Pedido explícito de humano
      handoffReason = 'user_requested_human';
      responseText = 'Entendi. Vou te colocar com um atendente humano agora.';
    }

    logger.pipeline('📝 Resposta gerada', {
      preview: responseText,
      length: responseText.length,
      handoffReason,
      hasTicketRequest: !!ticketRequest,
    });
    logger.groupEnd();

    // Retornar HANDOFF com motivo padronizado
    // O pipeline vai decidir se desliga IA usando shouldDisableAI()
    return {
      status: 'handoff',
      responseText,
      handoffReason,
      sideEffects: {
        createNotification: true,
        notificationType: handoffReason === 'sensitive_or_policy_blocked' ? 'handoff_sensitive' : 'handoff_user_requested',
        ticketRequest, // Incluir ticketRequest para ameaças jurídicas
      },
    };
  }
}
