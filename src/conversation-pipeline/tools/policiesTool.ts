/**
 * Policies Tool
 * Lida com perguntas sobre políticas (troca, devolução, entrega, pagamento)
 * 
 * Responsabilidade:
 * - Identificar quando usuário pergunta sobre políticas
 * - Solicitar loja se políticas forem dependentes de loja
 * - Retornar política cadastrada filtrada por loja
 */

import type { Tool, ToolInput, ToolResult } from './types';
import { logger } from '../../utils/logger';

export class PoliciesTool implements Tool {
  name = 'policies';

  canHandle(input: ToolInput): boolean {
    const text = input.messageText.toLowerCase();
    const keywords = [
      'troca', 'devolução', 'devolver', 'reembolso', 'garantia',
      'entrega', 'frete', 'prazo',
      'pagamento', 'pix', 'cartão', 'cartao',
    ];
    const matched = keywords.some(keyword => text.includes(keyword));
    
    logger.debug(`[PoliciesTool] canHandle()`, {
      message: input.messageText.substring(0, 50) + '...',
      matched,
      matchedKeywords: keywords.filter(k => text.includes(k)),
    });
    
    return matched;
  }

  async run(input: ToolInput): Promise<ToolResult> {
    logger.group('📋 PoliciesTool - Executando', [
      { label: 'Conversation ID', value: input.conversationId },
      { label: 'Mensagem', value: input.messageText.substring(0, 50) + '...' },
      { label: 'Loja selecionada', value: input.selectedStoreId || 'Nenhuma' },
      { label: 'Policies disponíveis', value: (input.policiesSummary?.length || 0).toString() },
    ]);

    const policies = input.policiesSummary || [];
    logger.pipeline('📊 Policies recebidas', { count: policies.length });
    
    // Verificar se há políticas dependentes de loja
    const hasStoreDependentPolicies = policies.some(
      p => p.applicableStores && p.applicableStores.length > 0
    );

    logger.pipeline('🔍 Verificando dependência de loja', {
      hasStoreDependentPolicies,
      selectedStoreId: input.selectedStoreId || 'Nenhuma',
    });

    // Se há políticas dependentes de loja e não há loja selecionada, pedir loja
    if (hasStoreDependentPolicies && !input.selectedStoreId) {
      logger.pipeline('❓ Políticas dependem de loja e não há loja selecionada - pedindo ao usuário');
      logger.groupEnd();
      return {
        status: 'need_input',
        askUser: 'Para qual unidade (bairro/cidade) você quer saber essa política?',
        needFields: ['store_id'],
        pendingContext: { topic: 'policy_lookup' },
      };
    }

    // Filtrar políticas por loja se houver loja selecionada
    let applicablePolicies = policies;
    if (input.selectedStoreId) {
      logger.pipeline('🔍 Filtrando políticas por loja', { storeId: input.selectedStoreId });
      applicablePolicies = policies.filter(p => {
        // Se não tem applicableStores, é política geral (aplica a todas)
        if (!p.applicableStores || p.applicableStores.length === 0) {
          return true;
        }
        // Se tem applicableStores, verificar se inclui a loja selecionada
        return p.applicableStores.includes(input.selectedStoreId!);
      });
      logger.pipeline('📊 Políticas após filtro', {
        antes: policies.length,
        depois: applicablePolicies.length,
      });
    }

    // Se não encontrou políticas, escalar ou informar
    if (applicablePolicies.length === 0) {
      logger.warning('❌ Nenhuma política encontrada', { prefix: '[PoliciesTool]', emoji: '⚠️' });
      
      const store = input.selectedStoreId 
        ? input.storesSummary.find(s => s.id === input.selectedStoreId)
        : null;
      
      if (store && store.phone) {
        logger.pipeline('📞 Informando contato da loja', { storeName: store.name, phone: store.phone });
        logger.groupEnd();
        return {
          status: 'done',
          responseText: `Não encontrei essa política cadastrada no sistema. Entre em contato com a loja ${store.name} pelo telefone ${store.phone} para mais informações.`,
        };
      }
      
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

    // Encontrar política mais relevante (por título ou conteúdo)
    const messageText = input.messageText.toLowerCase();
    let bestPolicy = applicablePolicies[0];
    
    logger.pipeline('🔍 Buscando política mais relevante', {
      totalPolicies: applicablePolicies.length,
      messageText: messageText.substring(0, 50),
    });
    
    // Tentar encontrar política mais específica pelo título
    for (const policy of applicablePolicies) {
      const policyTitle = policy.title.toLowerCase();
      if (messageText.includes('troca') && policyTitle.includes('troca')) {
        bestPolicy = policy;
        logger.pipeline('✅ Política de troca encontrada', { title: policy.title });
        break;
      }
      if (messageText.includes('devolução') && policyTitle.includes('devolução')) {
        bestPolicy = policy;
        logger.pipeline('✅ Política de devolução encontrada', { title: policy.title });
        break;
      }
      if (messageText.includes('entrega') && policyTitle.includes('entrega')) {
        bestPolicy = policy;
        logger.pipeline('✅ Política de entrega encontrada', { title: policy.title });
        break;
      }
      if (messageText.includes('pagamento') && policyTitle.includes('pagamento')) {
        bestPolicy = policy;
        logger.pipeline('✅ Política de pagamento encontrada', { title: policy.title });
        break;
      }
    }

    logger.success('✅ Política selecionada', { prefix: '[PoliciesTool]', emoji: '✅' });
    logger.pipeline('📝 Política', {
      title: bestPolicy.title,
      contentLength: bestPolicy.content.length,
      preview: bestPolicy.content.substring(0, 100) + '...',
    });
    logger.groupEnd();

    return {
      status: 'done',
      responseText: `*${bestPolicy.title}*\n\n${bestPolicy.content}`,
    };
  }
}
