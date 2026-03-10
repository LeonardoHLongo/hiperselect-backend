/**
 * Store Topics Tool
 * Lida com perguntas sobre currículo, parceria, fornecedor, gerente
 * 
 * Responsabilidade:
 * - Identificar quando usuário pergunta sobre contato da loja (vaga, parceria, etc)
 * - Solicitar loja se não houver selected_store_id
 * - Retornar telefone/horário/endereço da loja
 */

import type { Tool, ToolInput, ToolResult } from './types';
import { logger } from '../../utils/logger';

export class StoreTopicsTool implements Tool {
  name = 'store_topics';

  canHandle(input: ToolInput): boolean {
    const text = input.messageText.toLowerCase();
    const keywords = [
      'curriculo', 'currículo', 'vaga', 'emprego', 'trabalhar', 'contratando',
      'parceria', 'fornecedor', 'gerente', 'comprar em atacado', 'atacado',
    ];
    const matched = keywords.some(keyword => text.includes(keyword));
    
    logger.debug(`[StoreTopicsTool] canHandle()`, {
      message: input.messageText.substring(0, 50) + '...',
      matched,
      matchedKeywords: keywords.filter(k => text.includes(k)),
    });
    
    return matched;
  }

  async run(input: ToolInput): Promise<ToolResult> {
    logger.group('🏪 StoreTopicsTool - Executando', [
      { label: 'Conversation ID', value: input.conversationId },
      { label: 'Mensagem', value: input.messageText.substring(0, 50) + '...' },
      { label: 'Loja selecionada', value: input.selectedStoreId || 'Nenhuma' },
      { label: 'Stores disponíveis', value: input.storesSummary.length.toString() },
    ]);

    // Se não houver selected_store_id, pedir loja
    if (!input.selectedStoreId) {
      logger.pipeline('❓ Loja não selecionada - pedindo ao usuário');
      logger.groupEnd();
      return {
        status: 'need_input',
        askUser: 'Para qual unidade você quer saber? (bairro/cidade)',
        needFields: ['store_id'],
        pendingContext: { topic: 'store_contact' },
      };
    }

    logger.pipeline(`🔍 Buscando loja: ${input.selectedStoreId}`);
    
    // Buscar loja selecionada
    const store = input.storesSummary.find(s => s.id === input.selectedStoreId);
    
    if (!store) {
      logger.warning('❌ Loja não encontrada no summary', { prefix: '[StoreTopicsTool]', emoji: '⚠️' });
      logger.groupEnd();
      return {
        status: 'handoff',
        responseText: 'Entendi 😊 Não tenho essa informação cadastrada aqui. Um atendente confirma pra você.',
        handoffReason: 'unknown_or_missing_data',
        sideEffects: {
          createNotification: true,
          notificationType: 'handoff_missing_data',
        },
      };
    }

    logger.pipeline('✅ Loja encontrada', {
      name: store.name,
      phone: store.phone || 'N/A',
      openingHours: store.openingHours || 'N/A',
    });

    // Se não tiver telefone, escalar para humano
    if (!store.phone || store.phone.trim() === '') {
      logger.warning('⚠️ Loja sem telefone cadastrado - escalando', { prefix: '[StoreTopicsTool]', emoji: '⚠️' });
      logger.groupEnd();
      return {
        status: 'handoff',
        responseText: 'Entendi 😊 Não tenho essa informação cadastrada aqui. Um atendente confirma pra você.',
        handoffReason: 'unknown_or_missing_data',
        sideEffects: {
          createNotification: true,
          notificationType: 'handoff_missing_data',
        },
      };
    }

    // Construir resposta com telefone + horário + endereço (se disponível)
    let responseText = `📞 *${store.name}*\n\n`;
    responseText += `Telefone: ${store.phone}\n`;
    
    if (store.openingHours) {
      responseText += `Horário: ${store.openingHours}\n`;
    }
    
    if (store.neighborhood && store.city) {
      responseText += `Localização: ${store.neighborhood}, ${store.city}\n`;
    }
    
    responseText += `\n⚠️ *Importante*: A informação específica que você pediu (vaga, parceria, etc.) não está cadastrada no sistema. Entre em contato pelo telefone acima para confirmar.`;

    logger.success('✅ Resposta gerada com sucesso', { prefix: '[StoreTopicsTool]', emoji: '✅' });
    logger.pipeline('📝 Resposta', {
      preview: responseText.substring(0, 100) + '...',
      length: responseText.length,
    });
    logger.groupEnd();

    return {
      status: 'done',
      responseText,
    };
  }
}
