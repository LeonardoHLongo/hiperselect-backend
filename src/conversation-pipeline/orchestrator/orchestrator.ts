/**
 * Conversation Orchestrator - Orquestrador Principal
 * 
 * Nova arquitetura Router-Executor-Humanizer
 * 
 * Fluxo:
 * 1. Router: Classifica intent e analisa sentimento
 * 2. Executor: Executa ação baseada no intent
 * 3. Humanizer: Humaniza resposta final
 * 
 * Responsabilidade:
 * - Orquestrar as 3 camadas
 * - Gerenciar ContextSnapshot
 * - Emitir eventos apropriados
 * - Garantir rastreabilidade com traceId
 */
import { eventBus } from '../../events';
import { logger } from '../../utils/logger';
import type { MessageService } from '../../messages';
import type { StoreService } from '../../stores';
import type { TicketService } from '../../tickets';
import type { ConversationTaskService } from '../../conversation-tasks/service';
import type { NotificationService } from '../../notifications/service';
import { IntentRouter } from '../intent-router/router';
import { EntityExtractorAgent } from '../intent-router/entity-extractor';
import { IntentExecutor } from '../intent-executor/executor';
import { Humanizer } from '../humanizer/humanizer';
import { MediaProcessor } from '../media-processor/media-processor';
import type { ContextSnapshot } from '../intent-router/types';
import type { RouterResult, ConsolidatedRouterResult, Entities } from '../intent-router/schemas';
import type { FeedbackQueue } from '../queue/feedback-queue';
import type { WhatsAppAdapter } from '../../whatsapp/adapter';

type OrchestratorDependencies = {
  messageService: MessageService;
  storeService: StoreService;
  ticketService?: TicketService;
  taskService?: ConversationTaskService;
  notificationService?: NotificationService;
  feedbackQueue?: FeedbackQueue;
  whatsAppAdapter: WhatsAppAdapter;
  openaiApiKey: string;
};

export class ConversationOrchestrator {
  private router: IntentRouter;
  private entityExtractor: EntityExtractorAgent;
  private executor: IntentExecutor;
  public readonly humanizer: Humanizer; // Expor para uso em pipeline handlers
  private mediaProcessor: MediaProcessor;
  private processedMessages: Set<string> = new Set();

  constructor(private deps: OrchestratorDependencies) {
    this.router = new IntentRouter({
      openaiApiKey: deps.openaiApiKey,
    });
    
    this.entityExtractor = new EntityExtractorAgent({
      openaiApiKey: deps.openaiApiKey,
    });
    
    this.executor = new IntentExecutor({
      storeService: deps.storeService,
      ticketService: deps.ticketService,
      notificationService: deps.notificationService,
      messageService: deps.messageService, // Obrigatório
      feedbackQueue: deps.feedbackQueue,
      taskService: deps.taskService, // Para verificar tasks pendentes (conversas paralelas)
    });
    
    this.humanizer = new Humanizer({
      openaiApiKey: deps.openaiApiKey,
    });

    this.mediaProcessor = new MediaProcessor({
      openaiApiKey: deps.openaiApiKey,
      whatsAppAdapter: deps.whatsAppAdapter,
    });
  }

  /**
   * Processa uma mensagem através do novo pipeline
   */
  async processMessage(messageId: string, conversationId: string): Promise<void> {
    const processKey = `${messageId}:${conversationId}`;
    if (this.processedMessages.has(processKey)) {
      logger.warning('⚠️ Mensagem já processada - ignorando duplicata', {
        prefix: '[Orchestrator]',
        emoji: '⚠️',
        messageId,
        conversationId,
      });
      return;
    }
    this.processedMessages.add(processKey);

    // Limpar mensagens antigas do guard
    if (this.processedMessages.size > 1000) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages.clear();
      entries.slice(-500).forEach(key => this.processedMessages.add(key));
    }

    const traceId = this.generateTraceId();
    logger.section('Conversation Orchestrator', '🎯');
    logger.pipeline('Processando mensagem', {
      messageId,
      conversationId,
      traceId,
    });

    try {
      // Passo 1: Buscar mensagem e conversa (mensagem pode ter sido agrupada)
      const message = await this.deps.messageService.getMessageById(messageId);
      if (!message) {
        logger.warning('Mensagem não encontrada', {
          prefix: '[Orchestrator]',
          emoji: '⚠️',
        });
        return;
      }

      const tenantId = await this.deps.messageService.getConversationTenantId(conversationId);
      if (!tenantId) {
        logger.error('❌ tenantId não encontrado', {
          prefix: '[Orchestrator]',
          emoji: '❌',
          conversationId,
        });
        return;
      }

      // Buscar conversa ANTES de qualquer uso (para evitar ReferenceError)
      const conversation = await this.deps.messageService.getConversationById(conversationId, tenantId);
      if (!conversation) {
        logger.warning('Conversa não encontrada', {
          prefix: '[Orchestrator]',
          emoji: '⚠️',
        });
        return;
      }

      // Passo 1.5: Processar mídia (áudio ou imagem) se necessário
      // Isso deve acontecer ANTES de verificar se há texto
      let processedText = message.text;
      if (!processedText && message.media && message.baileysMessage) {
        logger.pipeline('📦 Processando mídia para gerar texto...', {
          mediaType: message.media.type,
          traceId,
        });

        const mediaText = await this.mediaProcessor.processMedia(
          message.media,
          message.baileysMessage,
          message.text
        );

        if (mediaText) {
          processedText = mediaText;
          
          // Atualizar mensagem no banco com texto processado
          try {
            await this.deps.messageService.updateMessageText(messageId, processedText, tenantId);
            logger.success('✅ Texto processado da mídia atualizado na mensagem', {
              prefix: '[Orchestrator]',
              emoji: '✅',
              messageId,
              textLength: processedText.length,
            });
          } catch (updateError) {
            logger.warning('⚠️ Erro ao atualizar texto da mensagem (continuando processamento)', {
              prefix: '[Orchestrator]',
              emoji: '⚠️',
              error: updateError instanceof Error ? updateError.message : String(updateError),
            });
          }
        } else {
          logger.warning('⚠️ Não foi possível processar mídia - mensagem sem texto processável', {
            prefix: '[Orchestrator]',
            emoji: '⚠️',
            mediaType: message.media.type,
          });
          // Continuar processamento mesmo sem texto - pode ser uma mensagem apenas de mídia
        }
      }

      // Se ainda não houver texto após processar mídia, verificar se podemos continuar
      if (!processedText || processedText.trim().length === 0) {
        logger.warning('⚠️ Mensagem sem texto processável - pulando processamento de IA', {
          prefix: '[Orchestrator]',
          emoji: '⚠️',
          hasMedia: !!message.media,
          mediaType: message.media?.type,
        });
        // Não retornar - continuar para processar outras partes se necessário
        // Mas não processar pelo pipeline de IA sem texto
        return;
      }

      // Passo 1.5: Verificar se é mensagem de gerente ANTES de processar pelo pipeline
      // Isso garante que mensagens de gerente sejam tratadas corretamente após o agrupamento
      const senderPhone = message.sender.phoneNumber || '';
      const normalizedPhone = senderPhone.includes('@') ? senderPhone.split('@')[0] : senderPhone;
      let isManager = false;
      let managerStoreId: string | null = null;
      
      if (normalizedPhone) {
        const { PostgresInternalContactRepository } = await import('../../internal-contacts/repository-postgres');
        const internalContactRepo = new PostgresInternalContactRepository();
        const internalContact = await internalContactRepo.findByPhoneNumber(normalizedPhone, tenantId);
        
        if (internalContact && internalContact.storeId && this.deps.taskService) {
          isManager = true;
          managerStoreId = internalContact.storeId;
          
          logger.pipeline('📞 Mensagem de gerente detectada - verificando tasks pendentes', {
            phoneNumber: normalizedPhone,
            contactType: internalContact.contactType,
            storeId: internalContact.storeId,
            traceId,
          });
          
          // Buscar tasks pendentes da loja deste gerente
          const pendingTasks = await this.deps.taskService.findPendingByStoreId(internalContact.storeId, tenantId);
          
          if (pendingTasks.length > 0) {
            // Usar texto processado (pode ser de mídia ou agrupado)
            const groupedText = processedText || '';
            
            if (groupedText) {
              let matchedTask = null;
              
              if (pendingTasks.length === 1) {
                matchedTask = pendingTasks[0];
                logger.pipeline('✅ Task pendente encontrada - correlacionando resposta agrupada', {
                  taskId: matchedTask.id,
                  item: matchedTask.payload.item,
                  conversationId: matchedTask.conversationId,
                  textLength: groupedText.length,
                  traceId,
                });
              } else {
                // Múltiplas tasks - tentar correlacionar pelo conteúdo
                logger.pipeline('⚠️ Múltiplas tasks pendentes - tentando correlacionar pelo conteúdo agrupado', {
                  tasksCount: pendingTasks.length,
                  textLength: groupedText.length,
                  traceId,
                });
                
                const responseLower = groupedText.toLowerCase();
                for (const task of pendingTasks) {
                  const itemLower = task.payload.item?.toLowerCase() || '';
                  if (itemLower && (responseLower.includes(itemLower) || itemLower.includes(responseLower))) {
                    matchedTask = task;
                    break;
                  }
                }
                
                if (!matchedTask) {
                  matchedTask = pendingTasks[0]; // Mais recente
                  logger.pipeline('ℹ️ Usando task mais recente (não foi possível correlacionar por conteúdo)', {
                    taskId: matchedTask.id,
                    traceId,
                  });
                }
              }
              
              if (matchedTask) {
                // Completar task com o texto agrupado (texto completo de todas as mensagens)
                await this.deps.taskService.completeTask(matchedTask.id, groupedText.trim(), tenantId);
                
                logger.success('✅ Task completada pelo gerente com texto agrupado', {
                  taskId: matchedTask.id,
                  conversationId: matchedTask.conversationId,
                  textLength: groupedText.length,
                  traceId,
                });
                
                // Limpar waiting_human quando gerente completar task
                if (conversation.state === 'waiting_human' || conversation.waitingHumanAt) {
                  try {
                    await this.deps.messageService.clearWaitingHuman(conversationId, tenantId);
                    
                    // Marcar notificações como lidas
                    if (this.deps.notificationService) {
                      await this.deps.notificationService.markConversationAsRead(conversationId, tenantId);
                    }
                    
                    logger.success('✅ Waiting_human limpo - gerente completou task', {
                      conversationId,
                      traceId,
                    });
                  } catch (error) {
                    logger.error('❌ Erro ao limpar waiting_human', {
                      error: error instanceof Error ? error.message : String(error),
                    });
                  }
                }
                
                // NÃO processar pelo pipeline (é mensagem interna)
                return;
              }
            }
          } else {
            logger.debug('ℹ️ Nenhuma task pendente encontrada para este gerente', {
              phoneNumber: normalizedPhone,
              storeId: internalContact.storeId,
              traceId,
            });
            
            // Limpar waiting_human quando gerente enviar mensagem (mesmo sem task pendente)
            if (conversation.state === 'waiting_human' || conversation.waitingHumanAt) {
              try {
                await this.deps.messageService.clearWaitingHuman(conversationId, tenantId);
                
                // Marcar notificações como lidas
                if (this.deps.notificationService) {
                  await this.deps.notificationService.markConversationAsRead(conversationId, tenantId);
                }
                
                logger.success('✅ Waiting_human limpo - gerente enviou mensagem (sem task)', {
                  conversationId,
                  traceId,
                });
              } catch (error) {
                logger.error('❌ Erro ao limpar waiting_human', {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
            
            // Continuar processamento normal - gerente sem task pendente
            // Mas vamos bloquear intents de cliente no Router
          }
        }
      }

      // Verificar se IA está habilitada
      if (conversation.aiEnabled === false) {
        logger.pipeline('🚫 IA desabilitada para esta conversa', {
          conversationId,
          traceId,
        });
        return;
      }

      // GATE: Verificar se há ticket não resolvido para esta conversa
      // Se houver ticket com status != 'closed', manter IA desligada
      if (this.deps.ticketService) {
        try {
          logger.pipeline('🔍 Verificando tickets pendentes', {
            conversationId,
            tenantId,
            traceId,
          });
          
          // Usar método do service que já valida tenantId
          const tickets = await this.deps.ticketService.getByConversationId(conversationId, tenantId);
            
          // Validação: garantir que tickets é um array (mesmo que vazio)
          const ticketsArray = Array.isArray(tickets) ? tickets : [];
          
          logger.pipeline('📋 Tickets encontrados', {
            traceId,
            tenantId,
            count: ticketsArray.length,
            hasTickets: ticketsArray.length > 0,
          });
          
          // Verificar se há ticket não resolvido
          const unresolvedTicket = ticketsArray.find((t: any) => {
            // Validação: garantir que t é um objeto com status
            if (!t || typeof t !== 'object') return false;
            return t.status && t.status !== 'closed';
          });
          
          if (unresolvedTicket) {
            logger.pipeline('🚫 Ticket não resolvido encontrado - mantendo IA desligada', {
              conversationId,
              tenantId,
              traceId,
              ticketId: unresolvedTicket.id,
              ticketStatus: unresolvedTicket.status,
              ticketPriority: unresolvedTicket.priority,
            });
            // Não processa mensagem - modo humano puro enquanto ticket não resolvido
            return;
          }
        } catch (error) {
          // Se houver erro ao verificar tickets, continuar processamento (não bloquear)
          logger.warning('⚠️ Erro ao verificar tickets - continuando processamento', {
            prefix: '[Orchestrator]',
            emoji: '⚠️',
            traceId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      // Passo 2: Construir ContextSnapshot
      const contextSnapshot = await this.buildContextSnapshot(conversation, tenantId, traceId);

      // Passo 2.5: Buscar últimas 5 mensagens para memória de janela
      const recentMessages = await this.deps.messageService.getMessagesByConversationId(
        conversationId,
        tenantId,
        5
      );
      
      // Construir histórico formatado para o Router
      const messageHistory = recentMessages
        .slice(-5) // Garantir apenas 5 mensagens
        .map(msg => ({
          role: msg.sender.phoneNumber === 'system' || msg.baileysKey?.fromMe ? 'assistant' : 'user',
          content: msg.text || '',
        }))
        .filter(msg => msg.content.trim().length > 0); // Remover mensagens vazias

      // Detectar última ação do sistema (Context-Aware)
      const lastSystemAction = this.detectLastSystemAction(messageHistory);

      logger.pipeline('📚 Histórico de mensagens preparado', {
        traceId,
        messagesCount: messageHistory.length,
        lastMessageRole: messageHistory[messageHistory.length - 1]?.role,
        lastSystemAction,
      });

      // Passo 2.6: Buscar lista de lojas para o Router fazer matching preciso
      let availableStores: Array<{ id: string; name: string; neighborhood: string }> = [];
      try {
        const stores = await this.deps.storeService.getAllStores(tenantId);
        availableStores = stores.map(s => ({
          id: s.id,
          name: s.name,
          neighborhood: s.neighborhood,
        }));
        logger.pipeline('🏪 Lista de lojas preparada para Router', {
          traceId,
          storesCount: availableStores.length,
        });
      } catch (error) {
        logger.warning('⚠️ Erro ao buscar lojas para Router - continuando sem lista', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Passo 3: Router - Classificar Intent e Sentimento
      logger.section('Router - Classificação', '🧠');
      logger.pipeline('🔍 Iniciando classificação no Router', {
        traceId,
        messageText: (processedText || message.text || '').substring(0, 100),
        hasHistory: messageHistory.length > 0,
      });
      
      let routerResult: RouterResult;
      try {
        routerResult = await this.router.classify({
          messageId,
          conversationId,
          messageText: processedText || message.text || '',
          contextSnapshot,
          messageHistory, // Enviar histórico para resolver ambiguidades
          availableStores, // Enviar lista de lojas para matching preciso
          isManager, // Informar se o remetente é um gerente
          lastSystemAction, // Última ação do sistema para contexto
          traceId, // Passar traceId para rastreabilidade
        });
        
        logger.pipeline('✅ Router concluído com sucesso', {
          traceId,
          intent: routerResult.intent,
          sentiment: routerResult.sentiment,
          confidence: routerResult.confidence,
        });
      } catch (error) {
        logger.error('❌ Erro no Router', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error; // Re-throw para ser capturado pelo catch externo
      }

      // Passo 3.5: Entity Extraction (se necessário)
      // Chamar EntityExtractorAgent apenas para intents que dependem de dados concretos
      const intentsRequiringExtraction = ['PRICE_INQUIRY', 'RESERVATION_REQUEST'];
      let entities: Entities | null = null;
      
      if (intentsRequiringExtraction.includes(routerResult.intent)) {
        logger.section('Entity Extractor - Extração', '🔍');
        logger.pipeline('🔍 Iniciando extração de entidades', {
          traceId,
          intent: routerResult.intent,
        });
        
        try {
          const extractionResult = await this.entityExtractor.extract({
            messageText: processedText || message.text || '',
            messageHistory,
            availableStores,
            traceId,
            intent: routerResult.intent,
          });
          
          // Converter EntityExtractorResult para Entities (compatibilidade)
          entities = {
            store_name: extractionResult.store_name,
            store: extractionResult.store,
            product_name: extractionResult.product_name,
            product: extractionResult.product,
            department: extractionResult.department,
            price: extractionResult.price,
            location: extractionResult.location,
            is_promotion_query: extractionResult.is_promotion_query,
            pickup_time: extractionResult.pickup_time,
            quantity: extractionResult.quantity,
          };
          
          logger.pipeline('✅ Extração de entidades concluída', {
            traceId,
            product_name: entities.product_name,
            store_name: entities.store_name,
            is_promotion_query: entities.is_promotion_query,
          });
        } catch (error) {
          logger.error('❌ Erro no Entity Extractor', {
            traceId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          // Continuar com entities = null (fallback seguro)
          logger.warning('⚠️ Continuando sem entidades extraídas (fallback)', { traceId });
        }
      } else {
        logger.pipeline('⏭️ Pulando extração de entidades (intent não requer)', {
          traceId,
          intent: routerResult.intent,
        });
      }

      // Consolidar RouterResult + Entities para passar ao Executor
      const consolidatedResult: ConsolidatedRouterResult = {
        ...routerResult,
        entities: entities || {
          store_name: null,
          store: null,
          product_name: null,
          product: null,
          department: null,
          price: null,
          location: null,
          is_promotion_query: null,
          pickup_time: null,
          quantity: null,
        },
      };

      // Passo 4: CORTE CEDO DO PIPELINE - Se confiança < 0.8, parar ANTES de chamar Executor ou Agente Boca
      // Se confiança < 0.8 OU intent for UNKNOWN, criar notificação waiting_human e PARAR o processamento
      const isLowConfidence = consolidatedResult.confidence < 0.8 || consolidatedResult.intent === 'UNKNOWN';
      
      if (isLowConfidence && this.deps.notificationService && this.deps.messageService) {
        logger.warning('⚠️ Confiança baixa ou intent UNKNOWN detectado - CORTANDO PIPELINE CEDO e acionando humano', {
          conversationId,
          intent: consolidatedResult.intent,
          confidence: consolidatedResult.confidence,
        });

        try {
          const store = contextSnapshot.selectedStoreId 
            ? await this.deps.storeService.getStoreById(contextSnapshot.selectedStoreId, tenantId)
            : null;

          await this.deps.notificationService.createNotification({
            tenantId,
            type: 'waiting_human',
            conversationId,
            metadata: {
              reason: consolidatedResult.intent === 'UNKNOWN' ? 'incoherent_message' : 'ai_uncertainty',
              confidence: consolidatedResult.confidence,
              intent: consolidatedResult.intent,
              storeId: contextSnapshot.selectedStoreId || undefined,
              storeName: store?.name || contextSnapshot.selectedStoreName || undefined,
              lastMessagePreview: (processedText || message.text || '').substring(0, 100),
              priority: 'normal',
            },
          });

          // Alterar status da conversa para WAITING_HUMAN
          await this.deps.messageService.updateConversationState(conversationId, 'waiting_human', tenantId);

          // Desativar IA automaticamente
          await this.deps.messageService.updateAIControl(conversationId, {
            aiEnabled: false,
            aiDisabledBy: 'system',
            aiDisabledReason: consolidatedResult.intent === 'UNKNOWN' 
              ? 'Mensagem incoerente ou fora de contexto' 
              : 'Incerteza da IA - confiança muito baixa',
          }, tenantId);

          // Gerar mensagem de transição usando Humanizer
          const userName = message.sender.pushName || conversation.participantName || undefined;
          let humanizedText: string;
          
          try {
            humanizedText = await this.humanizer.humanize({
              executorData: {
                type: 'handoff',
                reason: consolidatedResult.intent === 'UNKNOWN' ? 'ai_uncertainty' : 'ai_uncertainty',
                ticketCreated: false,
              },
              intent: consolidatedResult.intent,
              sentiment: consolidatedResult.sentiment,
              isReputationAtRisk: consolidatedResult.isReputationAtRisk,
              userName,
              userMessage: processedText || message.text || '',
            });
          } catch (error) {
            logger.error('❌ Erro no Agente Boca para mensagem de transição', {
              error: error instanceof Error ? error.message : String(error),
            });
            // Fallback simples
            humanizedText = userName 
              ? `${userName}, para não te dar nenhuma informação errada, vou passar sua dúvida para um atendente humano que já te responde por aqui, ok?`
              : 'Para não te dar nenhuma informação errada, vou passar sua dúvida para um atendente humano que já te responde por aqui, ok?';
          }

          // Emitir evento de handoff
          eventBus.emit('conversation.handoff.requested', {
            tenantId,
            conversationId,
            storeId: contextSnapshot.selectedStoreId || null,
            reason: consolidatedResult.intent === 'UNKNOWN' ? 'incoherent_message' : 'ai_uncertainty',
            severity: 'normal',
            timestamp: Date.now(),
            lastMessagePreview: (processedText || message.text || '').substring(0, 100),
          }, traceId);

          // Enviar resposta de transição
          eventBus.emit('conversation.response.generated', {
            messageId,
            conversationId,
            response: { text: humanizedText },
            brainDecision: 'WAIT_FOR_HUMAN',
            timestamp: Date.now(),
            traceId,
          }, traceId);

          logger.success('✅ Pipeline cortado cedo - waiting_human acionado e mensagem de transição enviada', {
            conversationId,
            confidence: consolidatedResult.confidence,
            intent: consolidatedResult.intent,
          });
          
          // PARAR O PROCESSAMENTO AQUI - não chamar Executor nem continuar o pipeline
          return;
        } catch (error) {
          logger.error('❌ Erro ao criar notificação waiting_human por incerteza', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Mesmo em caso de erro, tentar parar o pipeline para não gerar resposta absurda
          return;
        }
      }

      // Passo 4.5: Atualizar is_reputation_at_risk se necessário
      if (consolidatedResult.isReputationAtRisk && !conversation.isReputationAtRisk) {
        await this.deps.messageService.updateConversation(conversationId, {
          isReputationAtRisk: true,
        }, tenantId);
        
        logger.warning('⚠️ Reputação em risco detectada', {
          conversationId,
          intent: consolidatedResult.intent,
          sentiment: consolidatedResult.sentiment,
        });

        // Emitir evento de reputação em risco
        eventBus.emit('conversation.reputation.at.risk', {
          conversationId,
          tenantId,
          intent: consolidatedResult.intent,
          sentiment: consolidatedResult.sentiment,
          timestamp: Date.now(),
        }, traceId);
      }

      // Passo 4.5: CURTO-CIRCUITO ABSOLUTO - ACKNOWLEDGMENT (Silent Drop)
      // Esta verificação DEVE vir ANTES de qualquer outra lógica (tasks, executor, etc.)
      // Se o usuário apenas confirmou/agradeceu, encerrar imediatamente sem processar mais nada
      if (consolidatedResult.intent === 'ACKNOWLEDGMENT') {
        logger.pipeline('🔇 Intent ACKNOWLEDGMENT detectado. Realizando Silent Drop.', {
          traceId,
          conversationId,
          messageId,
          intent: consolidatedResult.intent,
          sentiment: consolidatedResult.sentiment,
        });
        
        logger.info('✅ Mensagem ignorada (Silent Drop): Usuário apenas confirmou/agradeceu', {
          traceId,
          conversationId,
          messageId,
          messageText: processedText || message.text || '',
        });
        
        // Encerrar processamento imediatamente - NÃO chamar Executor, NÃO verificar tasks, NÃO chamar Humanizer
        return;
      }

      // Passo 5: Removido bloqueio global de tasks pendentes
      // A verificação de tasks pendentes agora é feita apenas no Executor,
      // e apenas para intents específicos (PRICE_INQUIRY) sobre o mesmo produto.
      // Isso permite conversas paralelas (ex: perguntar horário enquanto aguarda preço).

      // Passo 5.5: Filtro de Sentido Comum - Validar se o intent faz sentido com as entidades
      // Se for STORE_INFO mas as entidades não baterem com (horário, endereço, telefone, preço), forçar confidence baixa
      if (consolidatedResult.intent === 'STORE_INFO' && consolidatedResult.confidence >= 0.8) {
        const messageLower = (processedText || message.text || '').toLowerCase();
        const hasStoreInfoKeywords = 
          messageLower.includes('horário') || messageLower.includes('horario') || messageLower.includes('abre') || messageLower.includes('fecha') ||
          messageLower.includes('endereço') || messageLower.includes('endereco') || messageLower.includes('onde') || messageLower.includes('local') ||
          messageLower.includes('telefone') || messageLower.includes('contato') || messageLower.includes('fone') ||
          messageLower.includes('preço') || messageLower.includes('preco') || messageLower.includes('valor') || messageLower.includes('custa');
        
        if (!hasStoreInfoKeywords) {
          logger.warning('⚠️ STORE_INFO sem palavras-chave relevantes - forçando confidence baixa', {
            traceId,
            messagePreview: (processedText || message.text || '').substring(0, 100),
            confidence: consolidatedResult.confidence,
          });
          
          // Forçar confidence baixa para acionar corte cedo
          routerResult.confidence = 0.25;
          // O corte cedo (Passo 4) vai pegar isso e parar o pipeline
        }
      }

      // Passo 6: Executor - Executar ação baseada no Intent
      // NOTA: Se confidence < 0.8 ou intent UNKNOWN, o pipeline já foi cortado no Passo 4
      // Se chegou aqui, significa que a confiança é >= 0.8 e o intent não é UNKNOWN
      logger.section('Executor - Executando Ação', '⚙️');
      logger.pipeline('🔍 Iniciando Executor', {
        traceId,
        intent: routerResult.intent,
        sentiment: routerResult.sentiment,
      });
      
      let executorResult: any;
      try {
        executorResult = await this.executor.execute({
          messageId,
          conversationId,
          messageText: processedText || message.text || '',
          routerResult: consolidatedResult, // Passar resultado consolidado (RouterResult + Entities)
          contextSnapshot,
          messageHistory, // Passar histórico para Trava de Contexto
          tenantId,
          traceId,
        });
        
        logger.pipeline('✅ Executor concluído', {
          traceId,
          status: executorResult.status,
          dataType: executorResult.data.type,
          hasTaskRequest: !!executorResult.taskRequest,
          hasHandoffReason: !!executorResult.handoffReason,
          hasMergedEntities: !!executorResult.mergedEntities,
          nextSystemAction: executorResult.nextSystemAction,
        });
      } catch (error) {
        logger.error('❌ Erro no Executor', {
          traceId,
          intent: routerResult.intent,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error; // Re-throw para ser capturado pelo catch externo
      }

      // Passo 6.5: Persistir merged entities, nextSystemAction e retryCount (State Persistence)
      if (executorResult.mergedEntities || executorResult.nextSystemAction) {
        try {
          const contextUpdate: any = {};
          
          // Persistir merged entities se disponível
          if (executorResult.mergedEntities) {
            contextUpdate.context_entities = executorResult.mergedEntities;
            logger.pipeline('💾 Persistindo merged entities', {
              traceId,
              product_name: executorResult.mergedEntities.product_name,
              store_name: executorResult.mergedEntities.store_name,
            });
          }
          
          // Persistir nextSystemAction e retryCount se disponível
          if (executorResult.nextSystemAction) {
            contextUpdate.lastSystemAction = executorResult.nextSystemAction;
            
            // Usar retryCount do Executor (já calculado pelo checkAntiLoop)
            if (executorResult.retryCount) {
              contextUpdate.retryCount = executorResult.retryCount;
            }
            
            logger.pipeline('💾 Persistindo nextSystemAction e retryCount', {
              traceId,
              nextSystemAction: executorResult.nextSystemAction,
              retryCount: executorResult.retryCount,
            });
          }
          
          if (Object.keys(contextUpdate).length > 0) {
            await this.deps.messageService.updateConversation(conversationId, contextUpdate, tenantId);
            logger.success('✅ Contexto atualizado no banco de dados', {
              traceId,
              updates: Object.keys(contextUpdate),
            });
          }
        } catch (error) {
          logger.error('❌ Erro ao persistir contexto (merged entities/nextSystemAction)', {
            traceId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Não bloquear o fluxo se falhar ao persistir
        }
      }

      // Passo 7: Processar resultado do Executor e gerar resposta com Agente Boca
      logger.pipeline('🔍 Processando resultado do Executor', {
        traceId,
        status: executorResult.status,
        dataType: executorResult.data.type,
      });

      // Verificar se é Silent Drop (ACKNOWLEDGMENT)
      if (executorResult.status === 'silent_drop') {
        logger.pipeline('🔇 Silent Drop detectado - encerrando processamento sem resposta', {
          traceId,
          reason: executorResult.data.type === 'silent_drop' ? (executorResult.data as any).reason : 'unknown',
        });
        
        // Registrar no log e encerrar sem chamar Humanizer
        logger.info('✅ Mensagem ignorada (Silent Drop): Usuário apenas confirmou/agradeceu', {
          traceId,
          conversationId,
          messageId,
          reason: executorResult.data.type === 'silent_drop' ? (executorResult.data as any).reason : 'unknown',
        });
        
        // Encerrar processamento sem enviar mensagem
        return;
      }
      
      // Gerar resposta usando Agente Boca com dados estruturados do Executor
      // O Agente Boca gera a resposta do zero usando as variáveis do Executor
      let humanizedText: string;
      try {
        logger.pipeline('🎨 Chamando Agente Boca', {
          traceId,
          dataType: executorResult.data.type,
        });
        
        // Extrair userName (pushName) da mensagem para personalização
        const userName = message.sender.pushName || conversation.participantName || undefined;
        
        humanizedText = await this.humanizer.humanize({
          executorData: executorResult.data,
          intent: routerResult.intent,
          sentiment: routerResult.sentiment,
          isReputationAtRisk: routerResult.isReputationAtRisk,
          userName, // Nome do cliente para personalização
          userMessage: message.text, // Mensagem original para espelhamento
        });
        
        logger.pipeline('✅ Agente Boca concluído', {
          traceId,
          humanizedTextPreview: humanizedText.substring(0, 100),
        });
      } catch (error) {
        logger.error('❌ Erro no Agente Boca', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Fallback será tratado pelo Humanizer internamente
        throw error;
      }

      // Processar baseado no status do Executor
      if (executorResult.status === 'already_pending') {
        // Task já pendente sobre o mesmo produto - avisar que ainda está aguardando
        logger.pipeline('⏳ Task já pendente detectada - avisando que ainda está aguardando', {
          traceId,
          dataType: executorResult.data.type,
        });

        // Gerar mensagem de aviso usando Agente Boca
        let humanizedWaitMessage: string;
        try {
          humanizedWaitMessage = await this.humanizer.humanize({
            executorData: executorResult.data,
            intent: consolidatedResult.intent,
            sentiment: consolidatedResult.sentiment,
            userName: message.sender.pushName || conversation.participantName || undefined,
            userMessage: message.text,
          });
        } catch (error) {
          logger.error('❌ Erro no Agente Boca (already_pending)', {
            traceId,
            error: error instanceof Error ? error.message : String(error),
          });
          humanizedWaitMessage = 'Ainda estou aguardando a resposta do gerente sobre isso. Assim que eu tiver a confirmação, te aviso por aqui! 😊';
        }

        eventBus.emit('conversation.response.generated', {
          messageId,
          conversationId,
          response: { text: humanizedWaitMessage },
          brainDecision: 'ALLOW_AUTO_RESPONSE',
          timestamp: Date.now(),
          traceId,
        }, traceId);

        logger.pipeline('✅ Mensagem de "já pendente" enviada', { traceId });
        return;
      } else if (executorResult.status === 'done' || executorResult.status === 'need_input' || executorResult.status === 'reservation_confirmed') {
        logger.pipeline('📤 Emitindo evento conversation.response.generated', {
          traceId,
          messageId,
          conversationId,
          status: executorResult.status,
        });
        
        eventBus.emit('conversation.response.generated', {
          messageId,
          conversationId,
          response: { text: humanizedText },
          brainDecision: 'ALLOW_AUTO_RESPONSE',
          timestamp: Date.now(),
          traceId,
        }, traceId);
        
        logger.pipeline('✅ Resposta enviada', { traceId });

        // Se for reserva confirmada, o feedback já foi agendado pelo Executor
        // (o FeedbackQueue foi chamado diretamente no Executor)
        if (executorResult.status === 'reservation_confirmed' && executorResult.feedbackScheduleRequest) {
          logger.success('✅ Reserva confirmada e feedback agendado', {
            traceId,
            conversationId,
            pickupTime: new Date(executorResult.feedbackScheduleRequest.pickupTime).toISOString(),
          });
        }

      } else if (executorResult.status === 'task_created' && executorResult.taskRequest) {
        // Task criada - criar conversation_task e enviar mensagem ao gerente
        logger.pipeline('📋 Task criada pelo Executor - processando', {
          traceId,
          taskType: executorResult.taskRequest.type,
          storeId: executorResult.taskRequest.storeId,
        });

        if (this.deps.taskService) {
          try {
            // Criar task com tenantId
            logger.pipeline('💾 Criando task no banco', {
              traceId,
              storeId: executorResult.taskRequest.storeId,
              type: executorResult.taskRequest.type,
            });
            
            const task = await this.deps.taskService.createTask({
              tenantId,
              conversationId,
              storeId: executorResult.taskRequest.storeId,
              type: executorResult.taskRequest.type,
              payload: executorResult.taskRequest.payload,
              requestCode: `REQ:${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
              expiresAt: Date.now() + 20 * 60 * 1000, // 20 minutos
            });

            logger.success('✅ Task criada', {
              traceId,
              taskId: task.id,
              conversationId,
              storeId: executorResult.taskRequest.storeId,
            });

          // Resposta já foi gerada pelo Agente Boca acima
          eventBus.emit('conversation.response.generated', {
            messageId,
            conversationId,
            response: { text: humanizedText },
            brainDecision: 'ALLOW_AUTO_RESPONSE',
            timestamp: Date.now(),
            traceId,
          }, traceId);
          
          logger.pipeline('✅ Resposta de task enviada', { traceId });
          } catch (error) {
            logger.error('❌ Erro ao criar task', {
              traceId,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
          }
        } else {
          logger.warning('⚠️ TaskService não disponível - não foi possível criar task', {
            traceId,
          });
        }

      } else if (executorResult.status === 'handoff') {
        logger.pipeline('📝 Status: handoff - processando handoff', {
          traceId,
          handoffReason: executorResult.handoffReason,
        });
        
        // Resposta já foi gerada pelo Agente Boca acima

        // Desligar IA se necessário (apenas para URGENT_COMPLAINT, pois HUMAN_REQUEST e ai_uncertainty já foram tratados)
        if (executorResult.handoffReason === 'urgent_complaint') {
          try {
            await this.deps.messageService.updateAIControl(conversationId, {
              aiEnabled: false,
              aiDisabledBy: 'system',
              aiDisabledReason: 'urgent_complaint',
            }, tenantId);
            logger.pipeline('✅ IA desligada para conversa urgente', { traceId });
          } catch (error) {
            logger.error('❌ Erro ao desligar IA', {
              traceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Emitir evento de handoff
        logger.pipeline('📤 Emitindo evento handoff.requested', { traceId });
        const severity = executorResult.handoffReason === 'urgent_complaint' ? 'high' : 'normal';
        eventBus.emit('conversation.handoff.requested', {
          tenantId,
          conversationId,
          storeId: contextSnapshot.selectedStoreId || null,
          reason: executorResult.handoffReason || 'urgent_complaint',
          severity,
          timestamp: Date.now(),
          lastMessagePreview: (processedText || message.text || '').substring(0, 100),
        }, traceId);

        eventBus.emit('conversation.response.generated', {
          messageId,
          conversationId,
          response: { text: humanizedText },
          brainDecision: 'WAIT_FOR_HUMAN',
          timestamp: Date.now(),
          traceId,
        }, traceId);
        
        logger.pipeline('✅ Handoff processado', { traceId });
      }

      logger.success('✅ Processamento concluído', {
        prefix: '[Orchestrator]',
        emoji: '✅',
        traceId,
      });

    } catch (error) {
      logger.error('❌ Erro ao processar mensagem', {
        prefix: '[Orchestrator]',
        emoji: '❌',
        traceId,
        messageId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
        // Adicionar contexto adicional
        errorString: String(error),
        errorJSON: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      
      // Log adicional para debug
      console.error('\n═══════════════════════════════════════════════════════════');
      console.error('❌ ERRO DETALHADO NO ORCHESTRATOR');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('TraceId:', traceId);
      console.error('MessageId:', messageId);
      console.error('ConversationId:', conversationId);
      console.error('Error Name:', error instanceof Error ? error.name : 'N/A');
      console.error('Error Message:', error instanceof Error ? error.message : String(error));
      console.error('Error Type:', error instanceof Error ? error.constructor.name : typeof error);
      if (error instanceof Error && error.stack) {
        console.error('\nStack Trace:');
        console.error(error.stack);
      }
      console.error('═══════════════════════════════════════════════════════════\n');
    }
  }

  /**
   * Detecta a última ação do sistema baseado nas mensagens do histórico
   * Retorna o tipo de ação para injeção de contexto no Router
   */
  private detectLastSystemAction(messageHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): string | undefined {
    if (!messageHistory || messageHistory.length === 0) {
      return undefined;
    }

    // Buscar última mensagem do sistema (assistant/system)
    for (let i = messageHistory.length - 1; i >= 0; i--) {
      const msg = messageHistory[i];
      if (msg.role === 'assistant' || msg.role === 'system') {
        const content = msg.content.toLowerCase();
        
        // Detectar feedback_checkin
        if (content.includes('passaria') || 
            content.includes('retirada') || 
            content.includes('atendido') || 
            content.includes('deu tudo certo') || 
            content.includes('foi bem atendido')) {
          return 'feedback_checkin';
        }
        
        // Detectar asking_store (perguntando loja)
        if (content.includes('qual unidade') || 
            content.includes('qual loja') || 
            content.includes('em qual unidade') ||
            content.includes('em qual loja') ||
            (content.includes('unidade') && (content.includes('você está') || content.includes('está'))) ||
            (content.includes('loja') && (content.includes('você está') || content.includes('está')))) {
          return 'asking_store';
        }
        
        // Detectar asking_product (perguntando produto)
        if (content.includes('qual produto') || 
            content.includes('que produto') ||
            content.includes('produto você') ||
            (content.includes('produto') && (content.includes('gostaria') || content.includes('quer')))) {
          return 'asking_product';
        }
        
        // Detectar confirming_order (confirmando reserva)
        if (content.includes('confirmada') || 
            (content.includes('reserva') && (content.includes('confirmada') || content.includes('separar'))) ||
            (content.includes('mandei') && content.includes('separar'))) {
          return 'confirming_order';
        }
        
        // Detectar asking_pickup_time (perguntando horário de retirada)
        if (content.includes('horário') || 
            content.includes('horario') ||
            content.includes('que horas') ||
            content.includes('que hora') ||
            (content.includes('retirar') && (content.includes('quando') || content.includes('que horas')))) {
          return 'asking_pickup_time';
        }
        
        // Detectar asking_quantity (perguntando quantidade)
        if (content.includes('quantidade') || 
            content.includes('quantos') ||
            content.includes('quantas') ||
            (content.includes('unidades') && content.includes('quer'))) {
          return 'asking_quantity';
        }
        
        // Detectar offering_reservation (oferecendo reserva)
        if (content.includes('quer que eu peça') || 
            content.includes('separarem') ||
            (content.includes('reservar') && (content.includes('quer') || content.includes('gostaria')))) {
          return 'offering_reservation';
        }
        
        // Detectar greeting (saudação inicial)
        if (content.includes('bem-vindo') || 
            content.includes('bem vindo') ||
            content.includes('como posso ajudar') ||
            ((content.includes('olá') || content.includes('oi')) && content.includes('bem-vindo'))) {
          return 'greeting';
        }
        
        // Se não detectar ação específica, retornar undefined
        return undefined;
      }
    }
    
    return undefined;
  }

  /**
   * Constrói ContextSnapshot a partir da conversa
   */
  private async buildContextSnapshot(conversation: any, tenantId: string, traceId: string): Promise<ContextSnapshot> {
    try {
      // Buscar histórico de sentimentos (últimas 3 mensagens)
      const recentMessages = await this.deps.messageService.getMessagesByConversationId(
        conversation.conversationId,
        tenantId,
        3
      );

      // Validação: garantir que recentMessages é um array
      const messagesArray = Array.isArray(recentMessages) ? recentMessages : [];

      // Por enquanto, usar sentimento neutro (será atualizado pelo Router)
      const sentimentHistory: any[] = [];

      // Carregar entities persistidas e lastSystemAction do banco
      const contextEntities = conversation.context_entities || undefined;
      const lastSystemAction = conversation.lastSystemAction || undefined;
      const retryCount = conversation.retryCount || undefined;

      logger.pipeline('📥 ContextSnapshot construído', {
        traceId,
        messagesCount: messagesArray.length,
        hasSelectedStore: !!conversation.selectedStoreId,
        isReputationAtRisk: conversation.isReputationAtRisk || false,
        hasContextEntities: !!contextEntities,
        lastSystemAction,
        retryCount,
      });

      return {
        currentIntent: undefined, // Será preenchido pelo Router
        selectedStoreId: conversation.selectedStoreId,
        selectedStoreName: conversation.selectedStoreName,
        isReputationAtRisk: conversation.isReputationAtRisk || false,
        lastInteractionAt: conversation.lastMessageAt || Date.now(),
        sentimentHistory,
        pendingFields: conversation.pendingFields || undefined,
        entities: contextEntities, // Entities persistidas para Entity Merging
        lastSystemAction, // Última ação do sistema para anti-loop
        retryCount, // Contador de tentativas para anti-loop
      };
    } catch (error) {
      logger.error('❌ Erro ao construir ContextSnapshot - usando snapshot mínimo', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Retornar snapshot mínimo em caso de erro
      return {
        currentIntent: undefined,
        selectedStoreId: conversation.selectedStoreId,
        selectedStoreName: conversation.selectedStoreName,
        isReputationAtRisk: conversation.isReputationAtRisk || false,
        lastInteractionAt: conversation.lastMessageAt || Date.now(),
        sentimentHistory: [],
        pendingFields: conversation.pendingFields || undefined,
        entities: conversation.context_entities || undefined,
        lastSystemAction: conversation.lastSystemAction || undefined,
        retryCount: conversation.retryCount || undefined,
      };
    }
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
