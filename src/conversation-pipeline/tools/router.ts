/**
 * Tool Router
 * Roteia mensagens para tools apropriadas antes de chamar AttendantAI
 * 
 * Fluxo:
 * 1. Se há pending_tool_name -> tentar preencher campos e retomar tool
 * 2. Se não há pending -> escolher primeira tool que canHandle() retornar true
 * 3. Se nenhuma tool -> retornar null (cai no AttendantAI normal)
 */

import type { Tool, ToolInput, ToolResult } from './types';
import type { Conversation } from '../../messages/types';
import type { StoreService } from '../../stores/service';
import { resolveStore } from '../../stores/store-resolver';
import { logger } from '../../utils/logger';

export type ToolRouterResult = ToolResult | null;

export class ToolRouter {
  private tools: Tool[];

  constructor(tools: Tool[]) {
    this.tools = tools;
  }

  /**
   * Roteia mensagem para tool apropriada
   */
  async handle(
    conversation: Conversation,
    messageText: string,
    tenantId: string,
    storeService: StoreService,
    storesSummary: ToolInput['storesSummary'],
    policiesSummary?: ToolInput['policiesSummary'],
    lastMessages?: ToolInput['lastMessages']
  ): Promise<ToolRouterResult> {
    logger.group('🔧 ToolRouter - Início', [
      { label: 'Conversation ID', value: conversation.conversationId },
      { label: 'Mensagem', value: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '') },
      { label: 'Tenant ID', value: tenantId },
      { label: 'Loja selecionada', value: conversation.selectedStoreId || 'Nenhuma' },
      { label: 'Tool pendente', value: conversation.pendingToolName || 'Nenhuma' },
      { label: 'Campos pendentes', value: conversation.pendingFields?.join(', ') || 'Nenhum' },
      { label: 'Tentativas', value: (conversation.pendingAttempts || 0).toString() },
    ]);

    // Se há tool pendente, tentar retomar
    if (conversation.pendingToolName) {
      logger.pipeline('🔄 Tool pendente detectada - tentando retomar', {
        toolName: conversation.pendingToolName,
        pendingFields: conversation.pendingFields,
        attempts: conversation.pendingAttempts,
      });

      const result = await this.resumePendingTool(
        conversation,
        messageText,
        tenantId,
        storeService,
        storesSummary,
        policiesSummary,
        lastMessages
      );

      logger.group('🔧 ToolRouter - Resultado (Tool Pendente)', [
        { label: 'Status', value: result ? result.status : 'null (cai no AttendantAI)' },
        { label: 'Tool', value: conversation.pendingToolName },
      ]);
      logger.groupEnd();

      return result;
    }

    // Caso contrário, escolher primeira tool que canHandle() retornar true
    logger.pipeline('🔍 Verificando tools disponíveis...', {
      totalTools: this.tools.length,
      toolNames: this.tools.map(t => t.name),
    });

    const toolInput: ToolInput = {
      tenantId,
      conversationId: conversation.conversationId,
      messageText,
      selectedStoreId: conversation.selectedStoreId || null,
      storesSummary,
      policiesSummary,
      lastMessages,
    };

    logger.pipeline('📥 ToolInput preparado', {
      storesCount: storesSummary.length,
      policiesCount: policiesSummary?.length || 0,
      lastMessagesCount: lastMessages?.length || 0,
    });

    for (const tool of this.tools) {
      logger.pipeline(`🔎 Testando tool: ${tool.name}`);
      const canHandle = tool.canHandle(toolInput);
      logger.pipeline(`   → canHandle: ${canHandle ? '✅ SIM' : '❌ NÃO'}`);

      if (canHandle) {
        logger.pipeline(`✅ Tool selecionada: ${tool.name}`);
        logger.group('🔧 ToolRouter - Executando Tool', [
          { label: 'Tool', value: tool.name },
          { label: 'Mensagem', value: messageText.substring(0, 50) + '...' },
        ]);

        const result = await this.executeTool(tool, toolInput);

        logger.group('🔧 ToolRouter - Resultado', [
          { label: 'Status', value: result.status },
          { label: 'Tool', value: tool.name },
        ]);
        logger.groupEnd();

        return result;
      }
    }

    // Nenhuma tool pode lidar -> retornar null (cai no AttendantAI)
    logger.pipeline('❌ Nenhuma tool pode lidar com a mensagem - caindo no AttendantAI');
    logger.groupEnd();
    return null;
  }

  /**
   * Retoma tool pendente tentando preencher campos faltantes
   */
  private async resumePendingTool(
    conversation: Conversation,
    messageText: string,
    tenantId: string,
    storeService: StoreService,
    storesSummary: ToolInput['storesSummary'],
    policiesSummary?: ToolInput['policiesSummary'],
    lastMessages?: ToolInput['lastMessages']
  ): Promise<ToolRouterResult> {
    const toolName = conversation.pendingToolName!;
    const pendingFields = conversation.pendingFields || [];
    const pendingAttempts = conversation.pendingAttempts || 0;

    logger.group('🔄 Retomando Tool Pendente', [
      { label: 'Tool', value: toolName },
      { label: 'Campos pendentes', value: pendingFields.join(', ') },
      { label: 'Tentativas anteriores', value: pendingAttempts.toString() },
      { label: 'Mensagem atual', value: messageText.substring(0, 50) + '...' },
    ]);

    // Encontrar tool pendente
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      logger.warning(`❌ Tool pendente não encontrada: ${toolName}`, { prefix: '[ToolRouter]', emoji: '⚠️' });
      logger.groupEnd();
      // Limpar estado pendente e retornar null (cai no AttendantAI)
      return null;
    }

    logger.pipeline(`✅ Tool encontrada: ${tool.name}`);

    // Tentar preencher campos pendentes
    const resolvedFields: Record<string, string> = {};
    
    if (pendingFields.includes('store_id') && !conversation.selectedStoreId) {
      logger.pipeline('🔍 Tentando resolver loja pelo texto da mensagem...');
      const storeResult = await resolveStore(storeService, tenantId, messageText);
      
      logger.pipeline('📊 Resultado da resolução de loja', {
        resolved: storeResult.resolved,
        storeId: storeResult.storeId,
        storeName: storeResult.storeName,
        reason: storeResult.reason,
        candidates: storeResult.candidates?.length || 0,
      });
      
      if (storeResult.resolved && storeResult.storeId) {
        resolvedFields.store_id = storeResult.storeId;
        logger.success(`✅ Loja resolvida: ${storeResult.storeName}`, { prefix: '[ToolRouter]', emoji: '✅' });
      } else {
        logger.warning('❌ Não foi possível resolver loja', { prefix: '[ToolRouter]', emoji: '⚠️' });
      }
    } else if (conversation.selectedStoreId) {
      logger.pipeline('✅ Loja já selecionada na conversa', { storeId: conversation.selectedStoreId });
    }

    // Se todos os campos foram preenchidos, executar tool
    const allFieldsResolved = pendingFields.every(field => {
      if (field === 'store_id') {
        return resolvedFields.store_id !== undefined || conversation.selectedStoreId !== undefined;
      }
      return false; // Por enquanto só suportamos store_id
    });

    logger.pipeline('📋 Verificação de campos', {
      allFieldsResolved,
      resolvedFields,
      selectedStoreId: conversation.selectedStoreId,
    });

    if (allFieldsResolved) {
      logger.success('✅ Todos os campos resolvidos - executando tool pendente', { prefix: '[ToolRouter]', emoji: '✅' });
      
      const toolInput: ToolInput = {
        tenantId,
        conversationId: conversation.conversationId,
        messageText: conversation.pendingQuestionText || messageText, // Usar pergunta original se disponível
        selectedStoreId: resolvedFields.store_id || conversation.selectedStoreId || null,
        storesSummary,
        policiesSummary,
        lastMessages,
      };

      logger.pipeline('📥 ToolInput preparado para tool pendente', {
        messageText: toolInput.messageText.substring(0, 50) + '...',
        selectedStoreId: toolInput.selectedStoreId,
      });

      const result = await this.executeTool(tool, toolInput, true);
      
      // Adicionar informação sobre store resolvida no resultado (para pipeline atualizar)
      if (resolvedFields.store_id && result.status === 'done') {
        (result as any).resolvedStoreId = resolvedFields.store_id;
        logger.pipeline('📝 Store ID resolvida adicionada ao resultado', { storeId: resolvedFields.store_id });
      }
      
      logger.groupEnd();
      return result;
    }

    // Campos não resolvidos -> repetir pergunta ou escalar
    if (pendingAttempts >= 2) {
      logger.warning('⚠️ Muitas tentativas (>=2) - escalando para humano', { prefix: '[ToolRouter]', emoji: '⚠️' });
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

    // Repetir pergunta (o estado será atualizado no pipeline com pendingAttempts++)
    const askUser = conversation.pendingContext?.askUser as string || 'Por favor, informe a loja (bairro/cidade).';
    logger.pipeline('🔄 Repetindo pergunta (tentativa ' + (pendingAttempts + 1) + ')', { askUser });
    logger.groupEnd();
    
    return {
      status: 'need_input',
      askUser,
      needFields: pendingFields,
      pendingContext: conversation.pendingContext || {},
    };
  }

  /**
   * Executa uma tool e retorna resultado
   */
  private async executeTool(
    tool: Tool,
    input: ToolInput,
    clearPendingState = false
  ): Promise<ToolResult> {
    logger.group('⚙️ Executando Tool', [
      { label: 'Tool', value: tool.name },
      { label: 'Conversation ID', value: input.conversationId },
      { label: 'Mensagem', value: input.messageText.substring(0, 50) + '...' },
      { label: 'Loja selecionada', value: input.selectedStoreId || 'Nenhuma' },
      { label: 'Stores disponíveis', value: input.storesSummary.length.toString() },
      { label: 'Policies disponíveis', value: (input.policiesSummary?.length || 0).toString() },
    ]);

    logger.pipeline('▶️ Chamando tool.run()...');
    const startTime = Date.now();
    
    const result = await tool.run(input);
    
    const duration = Date.now() - startTime;
    logger.pipeline(`⏱️ Tool executada em ${duration}ms`);
    
    logger.group('📤 Resultado da Tool', [
      { label: 'Status', value: result.status },
      { label: 'Tool', value: tool.name },
    ]);

    if (result.status === 'done') {
      logger.success('✅ Tool retornou DONE', { prefix: '[ToolRouter]', emoji: '✅' });
      logger.pipeline('📝 Resposta gerada', {
        preview: result.responseText.substring(0, 100) + (result.responseText.length > 100 ? '...' : ''),
        length: result.responseText.length,
      });
    } else if (result.status === 'need_input') {
      logger.pipeline('❓ Tool precisa de mais informações', {
        askUser: result.askUser,
        needFields: result.needFields,
      });
    } else if (result.status === 'handoff') {
      logger.pipeline('👤 Tool escalou para humano', {
        responseText: result.responseText.substring(0, 100) + '...',
      });
    }
    
    // Adicionar nome da tool ao resultado se for need_input (para salvar no pipeline)
    if (result.status === 'need_input' && !result.pendingContext) {
      result.pendingContext = { tool: tool.name };
    } else if (result.status === 'need_input' && result.pendingContext) {
      result.pendingContext.tool = tool.name;
    }

    logger.groupEnd();
    return result;
  }
}
