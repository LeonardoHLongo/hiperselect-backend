/**
 * Conversation Pipeline
 * Orquestrador central de conversas
 * 
 * Responsabilidade:
 * - Recebe mensagens já persistidas (via eventos)
 * - Orquestra decisões entre BrainAI e AttendantAI
 * - Emite eventos de resposta gerada
 * 
 * NÃO conhece:
 * - WhatsApp
 * - UI
 * - Banco de dados
 * - Lógica de negócio específica
 */
import { eventBus } from '../events';
import { DecisionEngine } from './decision';
import type { IBrainAI } from './interfaces/BrainAI';
import type { IAttendantAI } from './interfaces/AttendantAI';
import type { ConversationContext, MessageAnalysisInput, ResponseGeneratedEvent } from './types';
import { logger } from '../utils/logger';
import type { MessageService } from '../messages';
import type { CompanyService } from '../company';
import type { StoreService } from '../stores';
import type { TicketService } from '../tickets';
import type { ConversationTaskService } from '../conversation-tasks/service';
import { resolveStore } from '../stores/store-resolver';
import { ToolRouter } from './tools/router';
import { StoreTopicsTool } from './tools/storeTopicsTool';
import { PoliciesTool } from './tools/policiesTool';
import { GreetingsTool } from './tools/greetingsTool';
import { AIHandoffTool } from './tools/aiHandoffTool';
import { LanguageAgent } from './language/agent';
import type { LanguageContext } from './language/types';
import { shouldDisableAI, getNotificationType, getHandoffMessage, getSeverity } from './ai/shouldDisableAI';

type PipelineDependencies = {
  messageService: MessageService;
  companyService?: CompanyService;
  storeService?: StoreService;
  ticketService?: TicketService; // Para criar tickets de handoff sensível
  taskService?: ConversationTaskService; // Para criar tasks de verificação com gerente
  brainAI?: IBrainAI;
  attendantAI?: IAttendantAI;
  languageAgent?: LanguageAgent; // Agente Boca - opcional
};

export class ConversationPipeline {
  private decisionEngine: DecisionEngine;
  private toolRouter: ToolRouter;
  private processedMessages: Set<string> = new Set(); // Guard para evitar processamento duplicado

  constructor(private deps: PipelineDependencies) {
    this.decisionEngine = new DecisionEngine({
      brainAI: deps.brainAI,
      attendantAI: deps.attendantAI,
    });
    
    // Inicializar ToolRouter com tools disponíveis
    // Ordem importa: AIHandoffTool PRIMEIRO (captura mensagens sensíveis e pedidos de humano)
    // Depois GreetingsTool (saudações simples)
    // Por último, tools de informação (StoreTopics, Policies)
    // NOTA: PriceInquiryTool foi removida - PRICE_INQUIRY é tratado pelo IntentRouter/IntentExecutor
    this.toolRouter = new ToolRouter([
      new AIHandoffTool(), // PRIMEIRO: captura mensagens sensíveis e pedidos de humano
      new GreetingsTool(), // Saudações simples (não deve capturar mensagens sensíveis)
      new StoreTopicsTool(),
      new PoliciesTool(),
    ]);
  }

  /**
   * Humaniza uma resposta usando o Agente Boca (se disponível)
   * Se não houver LanguageAgent, retorna texto original
   */
  private async humanizeResponse(
    text: string,
    responseType: LanguageContext['responseType'],
    structuredData?: LanguageContext['structuredData']
  ): Promise<string> {
    if (!this.deps.languageAgent) {
      logger.warning('⚠️ LanguageAgent não disponível - retornando texto original', { prefix: '[Pipeline]', emoji: '⚠️' });
      return text; // Sem Agente Boca, retornar texto original
    }

    logger.pipeline('🗣️ Chamando LanguageAgent.humanize()', {
      responseType,
      textLength: text.length,
      hasStructuredData: !!structuredData,
    });

    try {
      const result = await this.deps.languageAgent.humanize({
        originalText: text,
        responseType,
        structuredData,
      });
      
      logger.pipeline('✅ Texto humanizado retornado', {
        originalLength: text.length,
        humanizedLength: result.text.length,
      });
      
      return result.text;
    } catch (error) {
      logger.error('❌ Erro ao humanizar resposta - usando original', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return text; // Em caso de erro, retornar original
    }
  }

  /**
   * Processa uma mensagem recebida através do pipeline
   * 
   * Fluxo:
   * 1. Busca contexto da conversa
   * 2. Busca contexto da empresa (se disponível)
   * 3. Chama DecisionEngine
   * 4. Se resposta gerada, emite evento
   */
  async processMessage(messageId: string, conversationId: string): Promise<void> {
    // Guard: evitar processamento duplicado da mesma mensagem
    const processKey = `${messageId}:${conversationId}`;
    if (this.processedMessages.has(processKey)) {
      logger.warning('⚠️ Mensagem já processada - ignorando duplicata', {
        prefix: '[Pipeline]',
        emoji: '⚠️',
        messageId,
        conversationId,
      });
      return;
    }
    this.processedMessages.add(processKey);
    
    // Limpar mensagens antigas do guard (manter apenas últimas 1000)
    if (this.processedMessages.size > 1000) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages.clear();
      entries.slice(-500).forEach(key => this.processedMessages.add(key));
    }
    
    const traceId = this.generateTraceId();
    logger.section('Pipeline de Conversação', '⚙️');
    logger.pipeline('Processando mensagem', {
      messageId,
      conversationId,
      traceId,
    });

    try {
      // Passo 1: Buscar mensagem
      let message = await this.deps.messageService.getMessageById(messageId);
      if (!message) {
        logger.warning('Mensagem não encontrada - pulando processamento', { prefix: '[Pipeline]', emoji: '⚠️' });
        logger.debug(`Message ID: ${messageId}`);
        return;
      }

      // Passo 2: Buscar tenantId da conversa (ROBUSTEZ: buscar do banco, não usar defaultTenantId)
      const tenantId = await this.deps.messageService.getConversationTenantId(conversationId);
      if (!tenantId) {
        logger.error('❌ tenantId não encontrado para conversa - abortando processamento (modo humano)', {
          prefix: '[Pipeline]',
          emoji: '❌',
          conversationId,
        });
        // Falhar seguro: modo humano (não processar automaticamente)
        return;
      }
      logger.pipeline('✅ tenantId resolvido da conversa', { tenantId, conversationId });

      // Passo 3: Buscar contexto da conversa
      const conversation = await this.deps.messageService.getConversationById(conversationId, tenantId);
      if (!conversation) {
        logger.warning('Conversa não encontrada - pulando processamento', { prefix: '[Pipeline]', emoji: '⚠️' });
        logger.debug(`Conversation ID: ${conversationId}`);
        return;
      }

      // GATE: Verificar se IA está habilitada para esta conversa
      // Default é true se não estiver definido (compatibilidade com conversas antigas)
      if (conversation.aiEnabled === false) {
        logger.pipeline('🚫 IA desabilitada para esta conversa - pulando processamento automático', {
          conversationId,
          aiDisabledBy: conversation.aiDisabledBy,
          aiDisabledReason: conversation.aiDisabledReason,
        });
        // Emitir evento indicando que a IA foi suprimida (para UI/notificações)
        eventBus.emit('conversation.ai.disabled', {
          conversationId,
          messageId,
          reason: conversation.aiDisabledReason || 'IA desabilitada manualmente',
          timestamp: Date.now(),
        }, traceId);
        return; // Não processa mensagem - modo humano puro
      }

      // GATE: Verificar se há ticket não resolvido para esta conversa
      // Se houver ticket com status != 'closed', manter IA desligada
      if (this.deps.ticketService) {
        try {
          const repository = (this.deps.ticketService as any).repository;
          if (repository && typeof repository.findByConversationId === 'function') {
            // tenantId já foi resolvido acima
            const tickets = await repository.findByConversationId(conversationId, tenantId);
            
            // Verificar se há ticket não resolvido
            const unresolvedTicket = tickets.find((t: any) => t.status !== 'closed');
            if (unresolvedTicket) {
              logger.pipeline('🚫 Ticket não resolvido encontrado - mantendo IA desligada', {
                conversationId,
                ticketId: unresolvedTicket.id,
                ticketStatus: unresolvedTicket.status,
                ticketPriority: unresolvedTicket.priority,
              });
              // Não processa mensagem - modo humano puro enquanto ticket não resolvido
              return;
            }
          }
        } catch (error) {
          // Se houver erro ao verificar tickets, continuar processamento (não bloquear)
          logger.warning('⚠️ Erro ao verificar tickets - continuando processamento', {
            prefix: '[Pipeline]',
            emoji: '⚠️',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Passo 4: Buscar contexto da empresa (se disponível)
      let companyContext: ConversationContext['companyContext'] = undefined;
      if (this.deps.companyService) {
        try {
          const company = await this.deps.companyService.getContext();
          if (company) {
            companyContext = {
              businessName: company.businessName,
              address: company.address,
              openingHours: company.openingHours,
              deliveryPolicy: company.deliveryPolicy,
              paymentMethods: company.paymentMethods,
              internalNotes: company.internalNotes,
            };
            logger.debug('Contexto da empresa carregado');
          } else {
            logger.debug('Contexto da empresa não disponível');
          }
        } catch (error) {
          logger.warning('Erro ao carregar contexto da empresa', { 
            prefix: '[Pipeline]',
            emoji: '⚠️',
          });
          logger.debug(String(error));
        }
      }

      // Passo 5: Buscar stores e policies (se disponível)
      let stores: ConversationContext['stores'] = undefined;
      let policies: ConversationContext['policies'] = undefined;
      if (this.deps.storeService) {
        try {
          // tenantId já foi resolvido acima
          const [storesList, policiesList] = await Promise.all([
            this.deps.storeService.getAllStores(tenantId),
            this.deps.storeService.getAllPolicies(tenantId),
          ]);
            
            stores = storesList.map(store => ({
              id: store.id,
              name: store.name,
              address: store.address,
              neighborhood: store.neighborhood,
              city: store.city,
              openingHours: store.openingHours,
              phone: store.phone,
              isActive: store.isActive,
              managerWhatsappNumber: store.managerWhatsappNumber || null,
              managerWhatsappEnabled: store.managerWhatsappEnabled || false,
            }));
            
            policies = policiesList.map(policy => ({
              id: policy.id,
              title: policy.title,
              content: policy.content,
              applicableStores: policy.applicableStores,
              createdAt: policy.createdAt,
              updatedAt: policy.updatedAt,
            }));
            
            console.log(`[Pipeline] ✅ Loaded ${stores.length} stores and ${policies.length} policies`);
        } catch (error) {
          logger.error('❌ Erro ao carregar stores/policies', {
            prefix: '[Pipeline]',
            emoji: '❌',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Passo 6: Verificar se estamos aguardando seleção de loja
      // tenantId já foi resolvido acima
      
      if (conversation.awaitingStoreSelection && conversation.storeCandidates && conversation.storeCandidates.length > 0) {
        logger.section('Resolvendo Seleção de Loja', '🏪');
        logger.group('Estado Antes', [
          { label: 'Aguardando seleção', value: conversation.awaitingStoreSelection ? 'Sim' : 'Não' },
          { label: 'Pergunta pendente', value: conversation.pendingQuestionText || 'Nenhuma' },
          { label: 'Candidatos', value: conversation.storeCandidates.length.toString() },
        ]);

        // Tentar resolver loja por índice, nome parcial ou storeId
        let resolvedStoreId: string | undefined = undefined;
        let resolvedStoreName: string | undefined = undefined;
        
        if (message.text) {
          const normalizedText = message.text.trim().toLowerCase();
          
          // Tentar resolver por índice (1, 2, 3...)
          const indexMatch = normalizedText.match(/^(\d+)$/);
          if (indexMatch) {
            const index = parseInt(indexMatch[1], 10) - 1; // Converter para índice 0-based
            if (index >= 0 && index < conversation.storeCandidates.length) {
              const candidateId = conversation.storeCandidates[index];
              const candidateStore = stores?.find(s => s.id === candidateId);
              if (candidateStore) {
                resolvedStoreId = candidateStore.id;
                resolvedStoreName = candidateStore.name;
                logger.success(`Loja resolvida por índice: ${index + 1} -> ${resolvedStoreName}`);
              }
            }
          }
          
          // Se não resolveu por índice, tentar por nome parcial
          if (!resolvedStoreId && stores) {
            for (const candidateId of conversation.storeCandidates) {
              const candidateStore = stores.find(s => s.id === candidateId);
              if (candidateStore) {
                const storeNameNormalized = candidateStore.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const neighborhoodNormalized = candidateStore.neighborhood.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const textNormalized = normalizedText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                
                if (storeNameNormalized.includes(textNormalized) || 
                    textNormalized.includes(storeNameNormalized) ||
                    neighborhoodNormalized.includes(textNormalized) ||
                    textNormalized.includes(neighborhoodNormalized)) {
                  resolvedStoreId = candidateStore.id;
                  resolvedStoreName = candidateStore.name;
                  logger.success(`Loja resolvida por nome: "${message.text}" -> ${resolvedStoreName}`);
                  break;
                }
              }
            }
          }
        }
        
        if (resolvedStoreId && resolvedStoreName && tenantId) {
          // Loja resolvida! Atualizar estado e processar pergunta original
          await this.deps.messageService.updateSelectedStore(conversationId, resolvedStoreId, resolvedStoreName, tenantId);
          await this.deps.messageService.updateStoreSelectionState(conversationId, {
            awaitingStoreSelection: false,
            pendingQuestionText: null,
            storeCandidates: null,
          }, tenantId);
          
          logger.group('Estado Depois', [
            { label: 'Loja selecionada', value: resolvedStoreName },
            { label: 'Aguardando seleção', value: 'Não' },
            { label: 'Pergunta pendente', value: conversation.pendingQuestionText || 'Nenhuma' },
          ]);
          
          // Usar a pergunta original em vez da mensagem atual
          const originalQuestion = conversation.pendingQuestionText || message.text || '';
          logger.pipeline('Processando pergunta original', { originalQuestion });
          
          // Atualizar objeto conversation
          conversation.selectedStoreId = resolvedStoreId;
          conversation.selectedStoreName = resolvedStoreName;
          conversation.awaitingStoreSelection = false;
          
          // Criar nova mensagem com a pergunta original para processamento
          const messageToProcess = {
            ...message,
            text: originalQuestion,
          };
          
          // Substituir referência para usar a mensagem com pergunta original
          message = messageToProcess;
        } else {
          // Não conseguiu resolver - pedir novamente
          logger.warning('Não foi possível resolver a loja - pedindo novamente', { prefix: '[Pipeline]', emoji: '⚠️' });
          
          const candidateStores = stores?.filter(s => conversation.storeCandidates?.includes(s.id)) || [];
          const candidatesText = candidateStores.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
          const responseText = `Para te ajudar melhor, preciso que você escolha uma das lojas abaixo:\n\n${candidatesText}\n\nResponda com o número (1, 2, etc.) ou o nome da loja.`;
          
          // Humanizar resposta de seleção de loja
          const humanizedText = await this.humanizeResponse(responseText, 'tool_need_input');
          
          eventBus.emit('conversation.response.generated', {
            messageId: message.messageId,
            conversationId: conversationId,
            response: { text: humanizedText },
            brainDecision: 'ALLOW_AUTO_RESPONSE',
            timestamp: Date.now(),
            traceId,
          }, traceId);
          
          return; // Parar processamento
        }
      }
      
      // Passo 7: Resolver loja se necessário (Store Slot Filling) - apenas se não estiver aguardando seleção
      let resolvedStoreId: string | undefined = conversation.selectedStoreId;
      let resolvedStoreName: string | undefined = conversation.selectedStoreName;
      
      // Se não há loja selecionada e não estamos aguardando seleção, tentar resolver pelo texto da mensagem
      if (!resolvedStoreId && !conversation.awaitingStoreSelection && this.deps.storeService && stores && stores.length > 1 && message.text) {
        if (tenantId) {
          logger.debug('Nenhuma loja selecionada - tentando resolver pelo texto da mensagem...');
          const storeResult = await resolveStore(this.deps.storeService, tenantId, message.text);
          
          if (storeResult.resolved && storeResult.storeId) {
            resolvedStoreId = storeResult.storeId;
            resolvedStoreName = storeResult.storeName;
            logger.success(`Loja resolvida: ${resolvedStoreName}`, { prefix: '[Pipeline]', emoji: '✅' });
            
            // Salvar loja selecionada na conversa
            await this.deps.messageService.updateSelectedStore(
              conversationId,
              resolvedStoreId,
              resolvedStoreName || '',
              tenantId
            );
            
            // Atualizar objeto conversation para refletir a mudança
            conversation.selectedStoreId = resolvedStoreId;
            conversation.selectedStoreName = resolvedStoreName;
          } else if (storeResult.candidates && storeResult.candidates.length > 0) {
            // Múltiplos candidatos - salvar estado e responder com opções
            logger.info(`Múltiplas lojas candidatas encontradas (${storeResult.candidates.length})`, { prefix: '[Pipeline]', emoji: '⚠️' });
            
            const candidatesText = storeResult.candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
            const responseText = `Encontrei ${storeResult.candidates.length} lojas. Qual delas você está se referindo?\n\n${candidatesText}\n\nResponda com o número (1, 2, etc.) ou o nome da loja.`;
            
            // Salvar estado de seleção e pergunta original
            await this.deps.messageService.updateStoreSelectionState(conversationId, {
              awaitingStoreSelection: true,
              pendingQuestionText: message.text, // Salvar pergunta original
              storeCandidates: storeResult.candidates.map(c => c.id),
            }, tenantId);
            
            logger.group('Estado Salvo', [
              { label: 'Aguardando seleção', value: 'Sim' },
              { label: 'Pergunta pendente', value: message.text },
              { label: 'Candidatos', value: storeResult.candidates.length.toString() },
            ]);
            
            // Humanizar resposta de seleção de loja
            const humanizedText = await this.humanizeResponse(responseText, 'tool_need_input');
            
            // Emitir resposta com opções
            eventBus.emit('conversation.response.generated', {
              messageId: message.messageId,
              conversationId: conversationId,
              response: { text: humanizedText },
              brainDecision: 'ALLOW_AUTO_RESPONSE',
              timestamp: Date.now(),
              traceId,
            }, traceId);
            
            logger.success('Resposta com opções de lojas emitida', { prefix: '[Pipeline]', emoji: '✅' });
            return; // Parar processamento
          } else {
            // Nenhum match - perguntar loja e parar
            logger.warning('Nenhuma loja encontrada - perguntando ao usuário', { prefix: '[Pipeline]', emoji: '⚠️' });
            const storeNames = stores.filter(s => s.isActive).map(s => s.name).join(', ');
            const responseText = `Para te ajudar melhor, preciso saber em qual loja você fez a compra. Nossas lojas são: ${storeNames}. Qual delas?`;
            
            // Humanizar resposta perguntando loja
            const humanizedText = await this.humanizeResponse(responseText, 'tool_need_input');
            
            // Emitir resposta perguntando loja
            eventBus.emit('conversation.response.generated', {
              messageId: message.messageId,
              conversationId: conversationId,
              response: { text: humanizedText },
              brainDecision: 'ALLOW_AUTO_RESPONSE',
              timestamp: Date.now(),
              traceId,
            }, traceId);
            
            logger.success('Resposta perguntando loja emitida', { prefix: '[Pipeline]', emoji: '✅' });
            return; // Parar processamento
          }
        }
      }

      // Passo 7: Filtrar políticas pela loja selecionada (se houver)
      let filteredPolicies = policies;
      if (resolvedStoreId && policies) {
        filteredPolicies = policies.filter(policy => 
          policy.applicableStores.length === 0 || // Política aplica a todas
          policy.applicableStores.includes(resolvedStoreId) // Política aplica à loja selecionada
        );
        console.log(`[Pipeline] Filtered policies for store ${resolvedStoreName}: ${filteredPolicies.length} of ${policies.length}`);
      }

      // Passo 8: Construir contexto da conversa
      const conversationContext: ConversationContext = {
        conversationId: conversation.conversationId,
        participantId: conversation.participantId,
        participantName: conversation.participantName,
        aiEnabled: true, // TODO: Buscar de conversation.aiEnabled quando implementado
        state: conversation.state,
        unreadCount: conversation.unreadCount,
        lastMessageAt: conversation.lastMessageAt,
        messageCount: conversation.messageCount,
        companyContext,
        stores,
        policies: filteredPolicies,
        selectedStoreId: resolvedStoreId,
        selectedStoreName: resolvedStoreName,
      };

      // Passo 9: Tentar rotear para tools antes do DecisionEngine
      logger.section('🔧 ToolRouter - Verificando Tools', '🔧');
      
      if (this.deps.storeService && tenantId && message.text) {
        logger.pipeline('📦 Preparando dados para ToolRouter', {
          storesCount: stores?.length || 0,
          policiesCount: filteredPolicies?.length || 0,
        });
        
        const storesSummary = stores?.map(s => ({
          id: s.id,
          name: s.name,
          neighborhood: s.neighborhood,
          city: s.city,
          phone: s.phone,
          openingHours: s.openingHours,
          isActive: s.isActive,
          managerWhatsappNumber: s.managerWhatsappNumber || null,
          managerWhatsappEnabled: s.managerWhatsappEnabled || false,
        })) || [];
        
        const policiesSummary = filteredPolicies?.map(p => ({
          id: p.id,
          title: p.title,
          content: p.content,
          applicableStores: p.applicableStores,
        })) || [];
        
        // Buscar últimas mensagens para contexto (com cache se habilitado)
        // tenantId já foi resolvido acima
        const historyMessages = await this.deps.messageService.getMessagesByConversationId(conversationId, tenantId, 5);
        const lastMessages = historyMessages
          .slice(-5)
          .map(msg => ({
            role: msg.sender.phoneNumber === 'system' || msg.baileysKey?.fromMe ? 'assistant' : 'user',
            content: msg.text || '',
          }));
        
        logger.pipeline('📥 Dados preparados', {
          storesSummary: storesSummary.length,
          policiesSummary: policiesSummary.length,
          lastMessages: lastMessages.length,
        });
        
        logger.pipeline('🚀 Chamando ToolRouter.handle()...');
        const toolStartTime = Date.now();
        
        const toolResult = await this.toolRouter.handle(
          conversation,
          message.text,
          tenantId,
          this.deps.storeService,
          storesSummary,
          policiesSummary,
          lastMessages
        );
        
        const toolDuration = Date.now() - toolStartTime;
        logger.pipeline(`⏱️ ToolRouter executado em ${toolDuration}ms`);
        
        if (toolResult) {
          // Tool retornou resultado - processar
          logger.group('🔧 Pipeline - Processando Resultado da Tool', [
            { label: 'Status', value: toolResult.status },
            { label: 'Tempo de execução', value: `${toolDuration}ms` },
          ]);
          
          if (toolResult.status === 'done') {
            logger.success('✅ Tool retornou DONE - processando resposta', { prefix: '[Pipeline]', emoji: '✅' });
            // Resposta pronta - emitir evento e limpar estado pendente
            // IMPORTANTE: Detectar tipo de resposta ANTES de limpar pendingToolName
            const toolName = conversation.pendingToolName || (toolResult as any).toolName;
            const isPolicyResponse = toolName === 'policies' || (toolResult.responseText.includes('*') && toolResult.responseText.includes('\n\n') && !toolResult.responseText.includes('📞'));
            const isStoreInfoResponse = toolName === 'store_topics' || (toolResult.responseText.includes('📞') && !toolResult.responseText.includes('*'));
            
            logger.pipeline('🔍 Detectando tipo de resposta', {
              toolName,
              isPolicyResponse,
              isStoreInfoResponse,
              hasPendingToolName: !!conversation.pendingToolName,
            });
            
            // Se tool resolveu uma loja, atualizar selectedStoreId
            const resolvedStoreId = (toolResult as any).resolvedStoreId || conversation.selectedStoreId;
            if (resolvedStoreId && this.deps.storeService) {
              const store = stores?.find(s => s.id === resolvedStoreId);
              if (store) {
                await this.deps.messageService.updateSelectedStore(
                  conversationId,
                  resolvedStoreId,
                  store.name,
                  tenantId
                );
                logger.pipeline(`Loja atualizada pela tool: ${store.name}`);
              }
            }
            
            // Processar sideEffects antes de limpar estado pendente
            const sideEffects = (toolResult as any).sideEffects;
            if (sideEffects?.disableAI) {
              logger.pipeline('🚫 Tool solicitou desligar IA - aplicando sideEffect', {
                reason: sideEffects.reason || 'user_requested_human',
              });
              
            // tenantId já foi resolvido acima
            await this.deps.messageService.updateAIControl(conversationId, {
              aiEnabled: false,
              aiDisabledBy: 'tool',
              aiDisabledReason: sideEffects.reason || 'user_requested_human',
            }, tenantId);
            logger.success('✅ IA desligada pela tool', { prefix: '[Pipeline]', emoji: '✅' });
            
            // Emitir evento de handoff solicitado
            const store = resolvedStoreId ? stores?.find(s => s.id === resolvedStoreId) : null;
            const handoffEvent = {
              tenantId,
              conversationId,
              storeId: resolvedStoreId || null,
              reason: sideEffects.reason || 'user_requested_human',
              timestamp: Date.now(),
              lastMessagePreview: message.text ? message.text.substring(0, 100) : null,
              storeName: store?.name || null,
            };
            
            logger.pipeline('📢 Emitindo evento handoff.requested', {
              conversationId,
              tenantId,
              reason: sideEffects.reason || 'user_requested_human',
              hasStore: !!store,
              eventPayload: handoffEvent,
            });
            
            eventBus.emit('conversation.handoff.requested', handoffEvent, traceId);
            logger.success('✅ Evento handoff.requested emitido', {
              prefix: '[Pipeline]',
              emoji: '✅',
              conversationId,
            });
          }
            
            logger.pipeline('🧹 Limpando estado pendente da tool');
            await this.deps.messageService.updatePendingToolState(conversationId, {
              pendingToolName: null,
              pendingFields: null,
              pendingContext: null,
              pendingAttempts: 0,
            }, tenantId);
            
            // Extrair título da política se for resposta de policy
            let policyTitle: string | undefined = undefined;
            if (isPolicyResponse) {
              const titleMatch = toolResult.responseText.match(/\*([^*]+)\*/);
              if (titleMatch) {
                policyTitle = titleMatch[1];
              }
            }
            
            // Determinar responseType e structuredData
            let responseType: LanguageContext['responseType'] = 'tool_done';
            let structuredData: LanguageContext['structuredData'] | undefined = undefined;
            
            if (isPolicyResponse) {
              responseType = 'policy_info';
              structuredData = {
                policyTitle,
                toolName: 'policies',
              };
            } else if (isStoreInfoResponse) {
              responseType = 'store_info';
              const store = resolvedStoreId ? stores?.find(s => s.id === resolvedStoreId) : null;
              if (store) {
                // Construir endereço completo (neighborhood, city) se disponível
                let fullAddress = store.address || '';
                if (store.neighborhood && store.city) {
                  const location = `${store.neighborhood}, ${store.city}`;
                  if (fullAddress && !fullAddress.includes(location)) {
                    fullAddress = `${fullAddress}, ${location}`;
                  } else if (!fullAddress) {
                    fullAddress = location;
                  }
                }
                
                structuredData = {
                  storeName: store.name,
                  storePhone: store.phone,
                  storeAddress: fullAddress,
                  storeHours: store.openingHours,
                  toolName: 'store_topics',
                };
              }
            } else {
              // Fallback para tool_done genérico
              const store = resolvedStoreId ? stores?.find(s => s.id === resolvedStoreId) : null;
              structuredData = store ? {
                storeName: store.name,
                storePhone: store.phone,
                storeAddress: store.address,
                storeHours: store.openingHours,
              } : undefined;
            }
            
            // Humanizar resposta antes de emitir
            logger.pipeline(`🗣️ Humanizando resposta da tool (${responseType})...`);
            const humanizedText = await this.humanizeResponse(
              toolResult.responseText,
              responseType,
              structuredData
            );
            
            logger.pipeline('📤 Emitindo evento de resposta gerada (TOOL)');
            logger.pipeline('🔍 Debug: Antes de emitir evento', {
              messageId: message.messageId,
              conversationId,
              humanizedTextLength: humanizedText.length,
              humanizedTextPreview: humanizedText.substring(0, 50),
            });
            eventBus.emit('conversation.response.generated', {
              messageId: message.messageId,
              conversationId: conversationId,
              response: { text: humanizedText },
              brainDecision: 'ALLOW_AUTO_RESPONSE',
              timestamp: Date.now(),
              traceId,
            }, traceId);
            
            logger.success('✅ Resposta da tool emitida com sucesso', { prefix: '[Pipeline]', emoji: '✅' });
            
            // Processar taskRequest (verificação com gerente) - APÓS emitir resposta
            logger.pipeline('🔍 Verificando sideEffects.taskRequest', {
              hasSideEffects: !!toolResult.sideEffects,
              hasTaskRequest: !!toolResult.sideEffects?.taskRequest,
              sideEffectsKeys: toolResult.sideEffects ? Object.keys(toolResult.sideEffects) : [],
            });
            
            if (toolResult.sideEffects?.taskRequest) {
              const taskRequest = toolResult.sideEffects.taskRequest;
              logger.pipeline('📋 Processando taskRequest', {
                conversationId,
                hasTaskService: !!this.deps.taskService,
                tenantId,
                type: taskRequest.type,
                storeId: taskRequest.storeId,
              });

              if (this.deps.taskService) {
                try {
                  // Gerar request_code único (ex: REQ:ABC123)
                  const requestCode = `REQ:${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                  
                  // Buscar nome da loja para incluir no payload
                  const store = stores?.find(s => s.id === taskRequest.storeId);
                  const storeName = store?.name || 'Loja';

                  const task = await this.deps.taskService.createTask({
                    tenantId,
                    conversationId,
                    storeId: taskRequest.storeId,
                    type: taskRequest.type,
                    payload: {
                      item: taskRequest.payload.item,
                      intent: taskRequest.payload.intent,
                      storeId: taskRequest.storeId,
                      storeName,
                    },
                    requestCode,
                    expiresAt: Date.now() + 20 * 60 * 1000, // 20 minutos
                  });

                  logger.success('📋 Task criada com sucesso', {
                    prefix: '[Pipeline]',
                    emoji: '📋',
                    taskId: task.id,
                    requestCode: task.requestCode,
                    conversationId,
                    tenantId,
                  });

                  // O evento conversation.task.created será emitido pelo service
                  // Um handler externo processará o envio da mensagem ao gerente
                } catch (error) {
                  logger.error('❌ Erro ao criar task', {
                    prefix: '[Pipeline]',
                    emoji: '❌',
                    error: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack : undefined,
                    conversationId,
                    tenantId,
                  });
                  // Não interromper o fluxo se task falhar
                }
              } else {
                logger.warning('⚠️ TaskService não disponível - task não será criada', {
                  prefix: '[Pipeline]',
                  emoji: '⚠️',
                  conversationId,
                });
              }
            }
            
            logger.groupEnd();
            logger.pipeline('🛑 RETORNANDO - não deve continuar para AttendantAI');
            return;
          } else if (toolResult.status === 'need_input') {
            logger.pipeline('❓ Tool precisa de mais informações - salvando estado pendente');
            
            // Tool precisa de mais informações - salvar estado pendente
            const currentAttempts = conversation.pendingAttempts || 0;
            const toolName = (toolResult.pendingContext?.tool as string) || conversation.pendingToolName || 'unknown';
            
            logger.pipeline('💾 Salvando estado pendente', {
              toolName,
              needFields: toolResult.needFields,
              attempts: currentAttempts + 1,
            });
            
            await this.deps.messageService.updatePendingToolState(conversationId, {
              pendingToolName: toolName,
              pendingFields: toolResult.needFields,
              pendingContext: { ...toolResult.pendingContext, askUser: toolResult.askUser },
              pendingAttempts: currentAttempts + 1,
            }, tenantId);
            
            // Se houver pendingQuestionText, salvar também
            if (!conversation.pendingQuestionText) {
              await this.deps.messageService.updateStoreSelectionState(conversationId, {
                pendingQuestionText: message.text,
              }, tenantId);
            }
            
            // Humanizar pergunta antes de emitir
            logger.pipeline('🗣️ Humanizando pergunta da tool (need_input)...');
            const humanizedAskUser = await this.humanizeResponse(
              toolResult.askUser,
              'tool_need_input'
            );
            
            logger.pipeline('📤 Emitindo pergunta ao usuário');
            eventBus.emit('conversation.response.generated', {
              messageId: message.messageId,
              conversationId: conversationId,
              response: { text: humanizedAskUser },
              brainDecision: 'ALLOW_AUTO_RESPONSE',
              timestamp: Date.now(),
              traceId,
            }, traceId);
            
            logger.success('✅ Pergunta da tool emitida', { prefix: '[Pipeline]', emoji: '✅' });
            logger.groupEnd();
            return;
          } else if (toolResult.status === 'handoff') {
            logger.pipeline('👤 Tool escalou para humano', {
              handoffReason: toolResult.handoffReason,
            });
            
            // Decisão central: deve desligar IA? (100% determinística)
            const disableAI = shouldDisableAI(toolResult.handoffReason);
            
            logger.pipeline('🔍 Decisão de desligar IA', {
              reason: toolResult.handoffReason,
              shouldDisable: disableAI,
              decisionFunction: 'shouldDisableAI()',
            });
            
            // tenantId já foi resolvido acima
            // Desligar IA se necessário
            if (disableAI) {
              await this.deps.messageService.updateAIControl(conversationId, {
                aiEnabled: false,
                aiDisabledBy: 'system',
                aiDisabledReason: toolResult.handoffReason,
              }, tenantId);
              
              logger.success('✅ IA desligada pelo handoff', {
                prefix: '[Pipeline]',
                emoji: '✅',
                reason: toolResult.handoffReason,
              });
              
              // Emitir evento de IA desligada
              eventBus.emit('conversation.ai.disabled', {
                tenantId,
                conversationId,
                reason: toolResult.handoffReason,
                disabledBy: 'system',
                timestamp: Date.now(),
              }, traceId);
            }
            
            // Criar notificação (sempre criar, conforme sideEffects ou padrão)
            const shouldCreateNotification = toolResult.sideEffects?.createNotification !== false; // Default: true
            const notificationType = toolResult.sideEffects?.notificationType || getNotificationType(toolResult.handoffReason);
            
            if (shouldCreateNotification) {
              const store = resolvedStoreId ? stores?.find(s => s.id === resolvedStoreId) : null;
              const severity = getSeverity(toolResult.handoffReason);
              const handoffEvent = {
                tenantId,
                conversationId,
                storeId: resolvedStoreId || null,
                reason: toolResult.handoffReason,
                severity, // Adicionar severidade para diferenciação visual
                timestamp: Date.now(),
                lastMessagePreview: message.text ? message.text.substring(0, 100) : null,
                storeName: store?.name || null,
              };
              
              logger.pipeline('📢 Emitindo evento handoff.requested', {
                conversationId,
                tenantId,
                reason: toolResult.handoffReason,
                notificationType,
                hasStore: !!store,
              });
              
              eventBus.emit('conversation.handoff.requested', handoffEvent, traceId);
              logger.success('✅ Evento handoff.requested emitido', {
                prefix: '[Pipeline]',
                emoji: '✅',
              });
            }

            // Criar ticket URGENTE se handoffReason for sensitive_or_policy_blocked
            if (toolResult.handoffReason === 'sensitive_or_policy_blocked') {
              logger.pipeline('🎫 Verificando criação de ticket urgente', {
                conversationId,
                hasTicketService: !!this.deps.ticketService,
                tenantId,
                handoffReason: toolResult.handoffReason,
              });
              
              if (this.deps.ticketService) {
                try {
                  const store = resolvedStoreId ? stores?.find(s => s.id === resolvedStoreId) : null;
                  const ticketRequest = toolResult.sideEffects?.ticketRequest;
                  
                  logger.pipeline('🎫 Criando ticket urgente', {
                    conversationId,
                    tenantId,
                    priority: ticketRequest?.priority || 'urgent',
                    category: ticketRequest?.category,
                    hasTicketRequest: !!ticketRequest,
                  });
                  
                  const ticket = await this.deps.ticketService.createTicketFromHandoff({
                    tenantId,
                    conversationId,
                    storeId: resolvedStoreId || null,
                    priority: ticketRequest?.priority || 'urgent',
                    title: ticketRequest?.title || 'Atendimento humano imediato necessário',
                    summary: ticketRequest?.summary || `${message.text ? message.text.substring(0, 200) : 'Mensagem do cliente'} (motivo: ${toolResult.handoffReason})`,
                    reason: toolResult.handoffReason,
                    source: 'system',
                    category: ticketRequest?.category || null,
                  });
                  
                  logger.success('🎫 Ticket URGENTE criado automaticamente', {
                    prefix: '[Pipeline]',
                    emoji: '🎫',
                    ticketId: ticket.id,
                    conversationId,
                    priority: ticket.priority,
                    category: ticketRequest?.category || 'unknown',
                  });
                } catch (error) {
                  logger.error('❌ Erro ao criar ticket de handoff sensível', {
                    prefix: '[Pipeline]',
                    emoji: '❌',
                    error: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack : undefined,
                    conversationId,
                    tenantId,
                  });
                  // Não interromper o fluxo se ticket falhar
                }
            } else {
              logger.warning('⚠️ TicketService não disponível - ticket não será criado', {
                prefix: '[Pipeline]',
                emoji: '⚠️',
                conversationId,
              });
            }
          } else {
            logger.pipeline('ℹ️ HandoffReason não é sensitive_or_policy_blocked - ticket não será criado', {
              conversationId,
              handoffReason: toolResult.handoffReason,
            });
          }
          
          // Limpar estado pendente da tool
            await this.deps.messageService.updatePendingToolState(conversationId, {
              pendingToolName: null,
              pendingFields: null,
              pendingContext: null,
              pendingAttempts: 0,
            }, tenantId);
            
            // Usar mensagem da tool ou mensagem padrão baseada no motivo
            const defaultMessage = getHandoffMessage(toolResult.handoffReason, disableAI);
            const finalMessage = toolResult.responseText || defaultMessage;
            
            // Humanizar handoff antes de emitir
            logger.pipeline('🗣️ Humanizando handoff da tool...');
            const humanizedHandoff = await this.humanizeResponse(
              finalMessage,
              'tool_handoff'
            );
            
            logger.pipeline('📤 Emitindo handoff', {
              disableAI,
              messagePreview: humanizedHandoff.substring(0, 50),
            });
            
            eventBus.emit('conversation.response.generated', {
              messageId: message.messageId,
              conversationId: conversationId,
              response: { text: humanizedHandoff },
              brainDecision: disableAI ? 'WAIT_FOR_HUMAN' : 'ALLOW_AUTO_RESPONSE',
              timestamp: Date.now(),
              traceId,
            }, traceId);
            
            logger.success('✅ Handoff da tool emitido', { prefix: '[Pipeline]', emoji: '✅' });
            logger.groupEnd();
            return;
          }
        } else {
          logger.pipeline('ℹ️ ToolRouter retornou null - nenhuma tool pode lidar, caindo no AttendantAI');
        }
      } else {
        logger.pipeline('⚠️ ToolRouter não disponível (storeService ou tenantId ausente) - caindo no AttendantAI');
      }
      
      logger.section('🤖 AttendantAI - Fallback', '🤖');

      // Passo 10: Preparar input para análise (se tool não lidou)
      const analysisInput: MessageAnalysisInput = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        text: message.text,
        timestamp: message.timestamp,
        messageType: message.messageType,
        conversationContext,
      };

      // Passo 11: Processar através do DecisionEngine (fallback se tool não lidou)
      const result = await this.decisionEngine.processMessage(analysisInput);

      // Passo 7: Se resposta foi gerada, humanizar e emitir evento
      if (result.response) {
        logger.pipeline('✅ Resposta gerada pelo AttendantAI - humanizando...');
        
        // Humanizar resposta do AttendantAI
        const humanizedText = await this.humanizeResponse(
          result.response.text,
          'ai_response',
          resolvedStoreId && stores ? {
            storeName: stores.find(s => s.id === resolvedStoreId)?.name,
          } : undefined
        );
        
        logger.pipeline('📤 Emitindo evento de resposta gerada (ATTENDANT AI)');
        logger.pipeline('🔍 Debug: Antes de emitir evento', {
          messageId: message.messageId,
          conversationId,
          humanizedTextLength: humanizedText.length,
          humanizedTextPreview: humanizedText.substring(0, 50),
          decision: result.decision,
        });
        const responseEvent: ResponseGeneratedEvent = {
          messageId: message.messageId,
          conversationId: conversationId,
          response: { text: humanizedText },
          brainDecision: result.decision,
          timestamp: Date.now(),
          traceId,
        };

        eventBus.emit('conversation.response.generated', responseEvent, traceId);
        logger.success('✅ Response event emitted (ATTENDANT AI)', { prefix: '[Pipeline]', emoji: '✅' });
      } else {
        console.log(`[Pipeline] ℹ️  No response generated - decision: ${result.decision}`);
        
        // Emitir evento de decisão mesmo sem resposta (para futuras fases)
        eventBus.emit('conversation.decision.made', {
          messageId: message.messageId,
          conversationId: conversationId,
          decision: result.decision,
          brainAnalysis: result.brainAnalysis,
          timestamp: Date.now(),
          traceId,
        }, traceId);
      }

      console.log('==================================\n');
    } catch (error) {
      console.error('[Pipeline] ❌ Error processing message:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      console.log('==================================\n');
    }
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

