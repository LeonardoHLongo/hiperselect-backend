/**
 * Intent Executor - Camada de Ações Estratégicas
 * 
 * Responsabilidade:
 * - Executar ações baseadas no Intent classificado
 * - Gerenciar crise para URGENT_COMPLAINT
 * - Processar consultas de preços com verificação de gerente
 * - Fornecer informações de loja
 * - Tratar saudações
 * 
 * NÃO classifica - apenas executa ações
 */
import { logger } from '../../utils/logger';
import type { ExecutorInput, ExecutorOutput, ExecutorData, HandoffData, NeedInputData, SalutationData, StoreInfoData, PriceInquiryData, TaskCreatedData, ReservationRequestData, FeedbackPromoterData, FeedbackDissatisfiedData } from './types';
import type { StoreService } from '../../stores';
import type { TicketService } from '../../tickets';
import type { NotificationService } from '../../notifications/service';
import type { MessageService } from '../../messages';
import type { FeedbackQueue } from '../queue/feedback-queue';
import type { ConversationTaskService } from '../../conversation-tasks/service';
import type { Entities } from '../intent-router/schemas';
import { findBestStoreMatch } from '../../utils/store-matcher';

type ExecutorDependencies = {
  storeService: StoreService;
  ticketService?: TicketService;
  notificationService?: NotificationService;
  messageService: MessageService; // Tornar obrigatório para salvar loja
  feedbackQueue?: FeedbackQueue;
  taskService?: ConversationTaskService; // Para verificar tasks pendentes
};

export class IntentExecutor {
  constructor(private deps: ExecutorDependencies) {}

  /**
   * Faz merge de entidades: valor atual sobrescreve, mas se for null, herda do contexto
   */
  private mergeEntities(currentEntities: Entities, contextEntities?: Entities | null): Entities {
    if (!contextEntities) {
      return currentEntities;
    }

    return {
      store_name: currentEntities.store_name || contextEntities.store_name || null,
      store: currentEntities.store || contextEntities.store || null,
      product_name: currentEntities.product_name || contextEntities.product_name || null,
      product: currentEntities.product || contextEntities.product || null,
      department: currentEntities.department || contextEntities.department || null,
      price: currentEntities.price || contextEntities.price || null,
      location: currentEntities.location || contextEntities.location || null,
      is_promotion_query: currentEntities.is_promotion_query !== null 
        ? currentEntities.is_promotion_query 
        : (contextEntities.is_promotion_query !== null ? contextEntities.is_promotion_query : null),
      pickup_time: currentEntities.pickup_time || contextEntities.pickup_time || null,
      quantity: currentEntities.quantity || contextEntities.quantity || null,
    };
  }

  /**
   * Verifica se o sistema está entrando em loop (perguntando a mesma coisa repetidamente)
   * Retorna true se deve fazer handoff, false se pode continuar
   */
  private checkAntiLoop(
    nextAction: string,
    contextSnapshot: ExecutorInput['contextSnapshot'],
    retryCount?: Record<string, number>
  ): { shouldHandoff: boolean; reason?: string; updatedRetryCount: Record<string, number> } {
    const currentRetryCount = retryCount || contextSnapshot.retryCount || {};
    const lastAction = contextSnapshot.lastSystemAction;

    // Se a próxima ação é a mesma da última, incrementar contador
    if (lastAction === nextAction) {
      const count = (currentRetryCount[nextAction] || 0) + 1;
      const updatedRetryCount = { ...currentRetryCount, [nextAction]: count };

      logger.pipeline('⚠️ Anti-Loop: Ação repetida detectada', {
        action: nextAction,
        count,
        lastAction,
      });

      // Se perguntou a mesma coisa 3 vezes, fazer handoff
      if (count >= 3) {
        logger.warning('🚨 Anti-Loop: Handoff forçado após 3 tentativas', {
          action: nextAction,
          count,
        });
        return {
          shouldHandoff: true,
          reason: 'repeated_failures',
          updatedRetryCount,
        };
      }

      return {
        shouldHandoff: false,
        updatedRetryCount,
      };
    }

    // Se mudou de ação, resetar contador dessa ação específica
    const updatedRetryCount = { ...currentRetryCount };
    if (lastAction && lastAction !== nextAction) {
      // Manter contadores de outras ações, mas resetar a atual se mudou
      delete updatedRetryCount[nextAction];
    }

    return {
      shouldHandoff: false,
      updatedRetryCount,
    };
  }

  /**
   * Executa ação baseada no Intent classificado
   */
  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.section('Intent Executor - Executando Ação', '⚙️');
    
    const { routerResult, contextSnapshot, tenantId } = input;
    
    logger.pipeline('Processando intent', {
      intent: routerResult.intent,
      sentiment: routerResult.sentiment,
      isReputationAtRisk: routerResult.isReputationAtRisk,
    });

    try {
      // Verificar se é resposta a feedback check-in (antes de rotear por intent)
      // IMPORTANTE: Só tratar como feedback se NÃO for RESERVATION_REQUEST (nova reserva)
      // Se a última mensagem do sistema foi um check-in e o sentiment é PROMOTER ou DISSATISFIED
      if (routerResult.intent !== 'RESERVATION_REQUEST' && 
          this.deps.messageService && 
          (routerResult.sentiment === 'PROMOTER' || routerResult.sentiment === 'DISSATISFIED')) {
        const isFeedbackResponse = await this.isFeedbackResponse(input);
        if (isFeedbackResponse) {
          logger.pipeline('📞 Detectado feedback pós-check-in', {
            sentiment: routerResult.sentiment,
            intent: routerResult.intent,
          });
          
          if (routerResult.sentiment === 'PROMOTER') {
            return await this.handleFeedbackPromoter(input);
          } else if (routerResult.sentiment === 'DISSATISFIED') {
            return await this.handleFeedbackDissatisfied(input);
          }
        }
      }

    // Roteamento por Intent
      let result: ExecutorOutput;
      
    switch (routerResult.intent) {
      case 'URGENT_COMPLAINT':
          logger.pipeline('🚨 Roteando para handleUrgentComplaint', {});
          result = await this.handleUrgentComplaint(input);
          break;
      
      case 'PRICE_INQUIRY':
          logger.pipeline('💰 Roteando para handlePriceInquiry', {});
          result = await this.handlePriceInquiry(input);
          break;
      
      case 'STORE_INFO':
          logger.pipeline('🏪 Roteando para handleStoreInfo', {});
          result = await this.handleStoreInfo(input);
          break;
      
      case 'SALUTATION':
          logger.pipeline('👋 Roteando para handleSalutation', {});
          result = await this.handleSalutation(input);
          break;
        
        case 'HUMAN_REQUEST':
          logger.pipeline('👤 Roteando para handleHumanRequest', {});
          result = await this.handleHumanRequest(input);
          break;
        
        case 'RESERVATION_REQUEST':
          logger.pipeline('📅 Roteando para handleReservationRequest', {});
          result = await this.handleReservationRequest(input);
          break;
        
        case 'ACKNOWLEDGMENT':
          logger.pipeline('✅ Roteando para handleAcknowledgment (Silent Drop)', {});
          result = await this.handleAcknowledgment(input);
          break;
      
      default:
        logger.warning('⚠️ Intent desconhecido - usando fallback', {
          intent: routerResult.intent,
        });
          result = {
          status: 'done',
            data: {
              type: 'salutation',
            } as SalutationData,
          };
      }
      
      logger.pipeline('✅ Executor concluído com sucesso', {
        status: result.status,
        dataType: result.data.type,
        hasTaskRequest: !!result.taskRequest,
      });
      
      return result;
    } catch (error) {
      logger.error('❌ Erro no Executor.execute', {
        intent: routerResult.intent,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error; // Re-throw para ser capturado pelo orchestrator
    }
  }

  /**
   * Gestão de Crise - URGENT_COMPLAINT
   */
  private async handleUrgentComplaint(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('🚨 Processando reclamação urgente', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { ticketService, notificationService, messageService } = this.deps;
    const { routerResult, contextSnapshot, tenantId } = input;

    // Criar ticket URGENTE imediatamente
    let ticketCreated = false;
    if (ticketService) {
      try {
        const store = contextSnapshot.selectedStoreId 
          ? await this.deps.storeService.getStoreById(contextSnapshot.selectedStoreId, tenantId)
          : null;

        await ticketService.createTicketFromHandoff({
          tenantId,
          conversationId: input.conversationId,
          storeId: contextSnapshot.selectedStoreId || null,
          priority: 'urgent',
          title: 'Reclamação Urgente - Atendimento Imediato Necessário',
          summary: input.messageText.substring(0, 500),
          reason: 'urgent_complaint',
          source: 'system',
          category: 'complaint',
        });

        ticketCreated = true;
        logger.success('✅ Ticket URGENTE criado', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao criar ticket urgente', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Criar notificação URGENTE com alerta
    let notificationCreated = false;
    if (notificationService) {
      try {
        const store = contextSnapshot.selectedStoreId 
          ? await this.deps.storeService.getStoreById(contextSnapshot.selectedStoreId, tenantId)
          : null;

        await notificationService.createNotification({
          tenantId,
          type: 'urgent_alert',
          conversationId: input.conversationId,
          metadata: {
            reason: 'urgent_complaint',
            storeId: contextSnapshot.selectedStoreId || undefined,
            storeName: store?.name || contextSnapshot.selectedStoreName || undefined,
            lastMessagePreview: input.messageText.substring(0, 100),
            priority: 'urgent',
          },
        });

        notificationCreated = true;
        logger.success('✅ Notificação URGENTE criada', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao criar notificação urgente', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Retornar dados estruturados para o Agente Boca
    return {
      status: 'handoff',
      handoffReason: 'urgent_complaint',
      data: {
        type: 'handoff',
        reason: 'urgent_complaint',
        ticketCreated,
      } as HandoffData,
      ticketCreated,
      notificationCreated,
    };
  }

  /**
   * Consulta de Preços - PRICE_INQUIRY
   * 
   * Protocolo:
   * 1. Verifica se tem loja (contexto ou entidades)
   * 2. Verifica se tem product_name extraído pelo Router
   * 3. Se managerWhatsappEnabled: cria task e retorna task_created
   * 4. Se não: retorna contato da loja
   */
  private async handlePriceInquiry(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('💰 Processando consulta de preço', {
      messageId: input.messageId,
      conversationId: input.conversationId,
      tenantId: input.tenantId,
    });

    try {
    const { routerResult, contextSnapshot, tenantId } = input;
      const { entities: currentEntities } = routerResult;

      // ENTITY MERGING: Fundir entidades atuais com entidades do contexto
      const mergedEntities = this.mergeEntities(currentEntities, contextSnapshot.entities);
      
      logger.pipeline('🔀 Entity Merging aplicado', {
        currentProduct: currentEntities.product_name,
        contextProduct: contextSnapshot.entities?.product_name,
        mergedProduct: mergedEntities.product_name,
        currentStore: currentEntities.store_name,
        contextStore: contextSnapshot.entities?.store_name,
        mergedStore: mergedEntities.store_name,
      });

      // A partir daqui, usar APENAS mergedEntities
      const entities = mergedEntities;

      logger.pipeline('🔍 Verificando loja', {
        hasSelectedStore: !!contextSnapshot.selectedStoreId,
        hasStoreInEntities: !!entities.store,
        selectedStoreId: contextSnapshot.selectedStoreId,
        selectedStoreName: contextSnapshot.selectedStoreName,
      });

      // PRIORIZAR selectedStoreId DO BANCO (Context Locking)
      // Só buscar nova loja se selectedStoreId estiver nulo E houver menção no histórico
    let storeId = contextSnapshot.selectedStoreId;
    let storeName = contextSnapshot.selectedStoreName;

      // Usar store_name das entities (prioritário) ou store (compatibilidade)
      let storeMentioned = entities.store_name || entities.store;
      
      // FILTRO DE STOPWORD: Ignorar "ta" ou "tá" como nome de loja
      if (storeMentioned && (storeMentioned.toLowerCase().trim() === 'ta' || storeMentioned.toLowerCase().trim() === 'tá')) {
        logger.pipeline('⚠️ Stopword "ta" detectado como store_name - ignorando', {
          storeMentioned,
        });
        storeMentioned = null; // Ignorar esta entidade
      }

      // Se já tem loja no contexto, verificar se a nova menção é diferente
      if (storeId && storeMentioned) {
        // CONFIRMAÇÃO DE HERANÇA: Verificar se a loja mencionada é diferente da salva
        try {
      const stores = await this.deps.storeService.getAllStores(tenantId);
          const matchedStore = findBestStoreMatch(storeMentioned, stores);
          
          if (matchedStore && matchedStore.id !== storeId) {
            // Loja diferente foi extraída - pedir confirmação
            logger.pipeline('⚠️ Loja diferente extraída - pedindo confirmação', {
              oldStoreId: storeId,
              oldStoreName: storeName,
              newStoreId: matchedStore.id,
              newStoreName: matchedStore.name,
              confidence: matchedStore.confidence,
            });
            
            return {
              status: 'need_input',
              data: {
                type: 'need_input',
                missingFields: ['store_confirmation'],
                context: `Cliente mencionou loja diferente (${matchedStore.name}) da já selecionada (${storeName})`,
                selectedStoreId: storeId,
                selectedStoreName: storeName,
                storeConfirmationNeeded: true,
                newStoreName: matchedStore.name,
                oldStoreName: storeName,
              } as NeedInputData,
            };
          }
        } catch (error) {
          logger.error('❌ Erro ao verificar mudança de loja', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Continuar com a loja do contexto se houver erro
        }
        
        // Se não mudou, usar a loja do contexto
        logger.pipeline('✅ Usando loja do contexto persistido', {
          storeId,
          storeName,
          source: 'contextSnapshot',
        });
      } else if (storeMentioned) {
        // Nova loja mencionada - resolver usando match restritivo
        logger.pipeline('🔍 Tentando resolver loja pelo nome mencionado', {
          storeMentioned,
        });
        
        try {
          const stores = await this.deps.storeService.getAllStores(tenantId);
          logger.pipeline('📋 Lojas disponíveis', {
            storesCount: stores.length,
          });
          
          // Usar match restritivo
          const matchedStore = findBestStoreMatch(storeMentioned, stores);
          
          if (matchedStore && matchedStore.confidence >= 0.4) { // Threshold mínimo de confiança
            storeId = matchedStore.id;
            storeName = matchedStore.name;
            logger.pipeline('✅ Loja resolvida com match restritivo', {
              storeId,
              storeName,
              matchType: matchedStore.matchType,
              confidence: matchedStore.confidence,
            });
            
            // PERSISTIR LOJA NO BANCO (Context Locking)
            try {
              await this.deps.messageService.updateSelectedStore(
                input.conversationId,
                storeId,
                storeName,
                tenantId
              );
              logger.success('💾 Loja salva no banco de dados', {
                conversationId: input.conversationId,
                storeId,
                storeName,
              });
            } catch (error) {
              logger.error('❌ Erro ao salvar loja no banco', {
                error: error instanceof Error ? error.message : String(error),
                storeId,
                storeName,
              });
              // Continuar mesmo se falhar ao salvar
            }
          } else {
            logger.pipeline('⚠️ Loja não encontrada ou confiança muito baixa', {
              storeMentioned,
              confidence: matchedStore?.confidence || 0,
            });
          }
        } catch (error) {
          logger.error('❌ Erro ao buscar lojas', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          throw error;
        }
      } else if (storeId) {
        // Apenas usar loja do contexto se não houver menção nova
        logger.pipeline('✅ Usando loja do contexto persistido', {
          storeId,
          storeName,
          source: 'contextSnapshot',
        });
      }

      // TRAVA DE CONTEXTO: Verificar múltiplas fontes antes de pedir loja
      if (!storeId) {
        // 1. Verificar se loja foi mencionada nas últimas 5 mensagens
        let storeFromHistory: string | null = null;
        if (input.messageHistory && input.messageHistory.length > 0) {
          const historyText = input.messageHistory.map(msg => msg.content).join(' ').toLowerCase();
          const storePatterns = [
            /(?:da|de|na|em|unidade|loja|hiperselect)\s+([a-záàâãéèêíìîóòôõúùûç\s]+?)(?:\s|$|,|\.|!|\?)/gi,
          ];
          
          for (const pattern of storePatterns) {
            const matches = historyText.match(pattern);
            if (matches && matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              storeFromHistory = lastMatch.replace(/(?:da|de|na|em|unidade|loja|hiperselect)\s+/gi, '').trim();
              if (storeFromHistory.length > 2 && storeFromHistory.length < 50) {
                break;
              }
            }
          }
          
          // Tentar buscar loja pelo nome do histórico
          if (storeFromHistory) {
            try {
              const stores = await this.deps.storeService.getAllStores(tenantId);
              // Usar match restritivo para histórico também
              const matchedStore = findBestStoreMatch(storeFromHistory!, stores);
              
              if (matchedStore && matchedStore.confidence >= 0.4) {
        storeId = matchedStore.id;
        storeName = matchedStore.name;
                logger.pipeline('✅ Loja encontrada no histórico - TRAVA DE CONTEXTO (match restritivo)', {
                  storeId,
                  storeName,
                  source: 'messageHistory',
                  matchType: matchedStore.matchType,
                  confidence: matchedStore.confidence,
                });
                
                // Salvar no banco
                try {
                  await this.deps.messageService.updateSelectedStore(
                    input.conversationId,
                    storeId,
                    storeName,
                    tenantId
                  );
                  logger.success('💾 Loja do histórico salva no banco', {
                    conversationId: input.conversationId,
                    storeId,
                    storeName,
                  });
                } catch (error) {
                  logger.error('❌ Erro ao salvar loja do histórico', {
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              }
            } catch (error) {
              logger.error('❌ Erro ao buscar loja do histórico', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
        
        // 2. Verificar se existe selectedStoreId salvo na conversa (já verificado acima, mas garantir)
        if (!storeId && contextSnapshot.selectedStoreId) {
          storeId = contextSnapshot.selectedStoreId;
          storeName = contextSnapshot.selectedStoreName || undefined;
          logger.pipeline('✅ Loja encontrada no contexto persistido - TRAVA DE CONTEXTO', {
            storeId,
            storeName,
            source: 'contextSnapshot',
          });
        }
        
        // 3. Só pedir loja se NENHUMA das fontes tiver loja
    if (!storeId) {
          logger.pipeline('❌ Loja não encontrada em nenhuma fonte - pedindo ao usuário', {
            hasStoreInEntities: !!storeMentioned,
            hasStoreInHistory: !!storeFromHistory,
            hasStoreInContext: !!contextSnapshot.selectedStoreId,
          });
          
          // ANTI-LOOP: Verificar se já perguntou loja 3 vezes
          const nextAction = 'asking_store';
          const antiLoopCheck = this.checkAntiLoop(nextAction, contextSnapshot);
          
          if (antiLoopCheck.shouldHandoff) {
            logger.warning('🚨 Anti-Loop: Handoff forçado após 3 tentativas de pedir loja', {
              action: nextAction,
              reason: antiLoopCheck.reason,
            });
            
            return {
              status: 'handoff',
              handoffReason: antiLoopCheck.reason || 'repeated_failures',
              data: {
                type: 'handoff',
                reason: 'repeated_failures',
                ticketCreated: false,
              } as HandoffData,
              mergedEntities, // Retornar merged entities para persistência
              nextSystemAction: nextAction,
            };
          }
          
          // Construir contexto mais rico para o Humanizer
          const productName = entities.product_name || entities.product;
          let contextMessage = 'Consulta de preço requer identificação da loja';
          if (productName) {
            const isPromotion = entities.is_promotion_query === true;
            contextMessage = isPromotion 
              ? `Consulta sobre promoção de ${productName} requer identificação da loja`
              : `Consulta sobre ${productName} requer identificação da loja`;
          }
          
      return {
        status: 'need_input',
            data: {
              type: 'need_input',
              missingFields: ['store'],
              context: contextMessage,
              selectedStoreId: contextSnapshot.selectedStoreId, // Passar loja já identificada (se houver)
              selectedStoreName: contextSnapshot.selectedStoreName,
            } as NeedInputData,
            mergedEntities, // Retornar merged entities para persistência
            nextSystemAction: nextAction,
            retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
          };
        }
    }

    // Verificar se tem product_name extraído pelo Router
    // IMPORTANTE: Não usar fallback de mensagem inteira - a IA deve extrair o produto
    const productName = entities.product_name || entities.product; // product_name é preferencial, product é fallback para compatibilidade
      
      logger.pipeline('🔍 Verificando produto', {
        productName,
        hasProductName: !!entities.product_name,
        hasProduct: !!entities.product,
        entities: JSON.stringify(entities),
      });
    
    if (!productName || productName.trim().length < 2) {
      logger.pipeline('❌ Product name não extraído pelo Router', {
        entities,
        messageText: input.messageText,
      });
        
        // ANTI-LOOP: Verificar se já perguntou produto 3 vezes
        const nextAction = 'asking_product';
        const antiLoopCheck = this.checkAntiLoop(nextAction, contextSnapshot);
        
        if (antiLoopCheck.shouldHandoff) {
          logger.warning('🚨 Anti-Loop: Handoff forçado após 3 tentativas de pedir produto', {
            action: nextAction,
            reason: antiLoopCheck.reason,
          });
          
          return {
            status: 'handoff',
            handoffReason: antiLoopCheck.reason || 'repeated_failures',
            data: {
              type: 'handoff',
              reason: 'repeated_failures',
              ticketCreated: false,
            } as HandoffData,
            mergedEntities, // Retornar merged entities para persistência
            nextSystemAction: nextAction,
            retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
          };
        }
        
      return {
        status: 'need_input',
          data: {
            type: 'need_input',
            missingFields: ['product_name'],
            context: 'Consulta de preço requer identificação do produto',
          } as NeedInputData,
          mergedEntities, // Retornar merged entities para persistência
          nextSystemAction: nextAction,
          retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
      };
    }

    // Buscar loja completa
      logger.pipeline('🔍 Buscando informações completas da loja', {
        storeId,
      });
      
      let store;
      try {
        store = await this.deps.storeService.getStoreById(storeId, tenantId);
    if (!store) {
          logger.pipeline('❌ Loja não encontrada no banco', { storeId });
      return {
        status: 'done',
            data: {
              type: 'price_inquiry',
              store: {
                name: 'Loja não encontrada',
                phone: '',
                openingHours: null,
              },
              hasManager: false,
            } as PriceInquiryData,
          };
        }
        logger.pipeline('✅ Loja encontrada', {
          storeId: store.id,
          storeName: store.name,
          hasManager: !!store.managerWhatsappNumber,
          managerEnabled: store.managerWhatsappEnabled,
        });
      } catch (error) {
        logger.error('❌ Erro ao buscar loja', {
          storeId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
    }

    // Verificar se tem gerente configurado
    if (store.managerWhatsappEnabled && store.managerWhatsappNumber) {
      // Determinar intent baseado em is_promotion_query do Router
      const isPromotion = entities.is_promotion_query === true;
      const intent: 'promotion' | 'availability' | 'price' = isPromotion 
        ? 'promotion' 
        : (input.messageText.toLowerCase().includes('tem') || input.messageText.toLowerCase().includes('disponível') ? 'availability' : 'price');

      // Verificar se já existe task pendente sobre o mesmo produto (Conversas Paralelas)
      if (this.deps.taskService) {
        try {
          const pendingTask = await this.deps.taskService.findPendingByConversationId(
            input.conversationId,
            tenantId
          );

          if (pendingTask) {
            // Normalizar nomes de produtos para comparação (case-insensitive, sem acentos)
            const normalizeProduct = (name: string) => 
              name.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            const currentProduct = normalizeProduct(productName.trim());
            const pendingProduct = normalizeProduct(pendingTask.payload.item || '');

            // Se for sobre o mesmo produto, retornar already_pending
            if (currentProduct === pendingProduct || currentProduct.includes(pendingProduct) || pendingProduct.includes(currentProduct)) {
              logger.pipeline('⏳ Task já pendente sobre o mesmo produto - retornando already_pending', {
                conversationId: input.conversationId,
                currentProduct: productName.trim(),
                pendingProduct: pendingTask.payload.item,
                taskId: pendingTask.id,
              });

              return {
                status: 'already_pending',
                data: {
                  type: 'already_pending',
                  product: pendingTask.payload.item,
                  store: {
                    id: store.id,
                    name: store.name,
                  },
                } as import('./types').AlreadyPendingData,
                mergedEntities,
              };
            } else {
              logger.pipeline('✅ Task pendente existe mas é sobre produto diferente - permitindo conversa paralela', {
                conversationId: input.conversationId,
                currentProduct: productName.trim(),
                pendingProduct: pendingTask.payload.item,
                taskId: pendingTask.id,
              });
            }
          }
        } catch (error) {
          logger.warning('⚠️ Erro ao verificar task pendente - continuando com criação de nova task', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Continuar com criação de task mesmo se houver erro
        }
      }

      logger.pipeline('📞 Gerente configurado - criando task', {
        storeId: store.id,
        storeName: store.name,
        productName,
        intent,
        isPromotion,
        managerPhone: store.managerWhatsappNumber,
      });

      return {
        status: 'task_created',
          data: {
            type: 'task_created',
            store: {
              id: store.id,
              name: store.name,
            },
            product: productName.trim(),
            taskType: intent,
          } as TaskCreatedData,
        taskRequest: {
            type: 'price_check',
          storeId: store.id,
          payload: {
            item: productName.trim(),
            intent,
            storeId: store.id,
            storeName: store.name,
          },
          managerPhoneNumber: store.managerWhatsappNumber,
        },
          mergedEntities, // Retornar merged entities para persistência
      };
    }

      // Fallback: fornecer dados da loja (sem gerente)
      logger.pipeline('📞 Gerente não configurado - retornando dados da loja', {
      storeName: store.name,
    });

    return {
      status: 'done',
        data: {
          type: 'price_inquiry',
          store: {
            name: store.name,
            phone: store.phone,
            openingHours: store.openingHours || null,
          },
          hasManager: false,
        } as PriceInquiryData,
        mergedEntities, // Retornar merged entities para persistência
      };
    } catch (error) {
      logger.error('❌ Erro em handlePriceInquiry', {
        messageId: input.messageId,
        conversationId: input.conversationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error; // Re-throw para ser capturado pelo orchestrator
    }
  }

  /**
   * Informações de Loja - STORE_INFO
   */
  private async handleStoreInfo(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('🏪 Processando informação de loja', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { contextSnapshot, tenantId } = input;
    const { entities } = input.routerResult;

    // Resolver loja
    let storeId = contextSnapshot.selectedStoreId;
    
    // Usar store_name das entities (prioritário) ou store (compatibilidade)
    const storeMentioned = entities.store_name || entities.store;
    
    if (!storeId && storeMentioned) {
      const stores = await this.deps.storeService.getAllStores(tenantId);
      // Usar match restritivo
      const matchedStore = findBestStoreMatch(storeMentioned, stores);
      
      if (matchedStore && matchedStore.confidence >= 0.4) {
        storeId = matchedStore.id;
        logger.pipeline('✅ Loja resolvida para informações (match restritivo)', {
          storeId,
          storeName: matchedStore.name,
          matchType: matchedStore.matchType,
          confidence: matchedStore.confidence,
        });
      } else {
        logger.pipeline('⚠️ Loja não encontrada ou confiança muito baixa para informações', {
          storeMentioned,
          confidence: matchedStore?.confidence || 0,
        });
      }
    }

    if (!storeId) {
      return {
        status: 'need_input',
        data: {
          type: 'need_input',
          missingFields: ['store'],
          context: 'Consulta de informações de loja requer identificação da unidade',
        } as NeedInputData,
      };
    }

    const store = await this.deps.storeService.getStoreById(storeId, tenantId);
    if (!store) {
      return {
        status: 'done',
        data: {
          type: 'store_info',
          store: {
            name: 'Loja não encontrada',
            address: '',
            phone: '',
            openingHours: null,
          },
        } as StoreInfoData,
      };
    }

    // Retornar dados estruturados da loja
    return {
      status: 'done',
      data: {
        type: 'store_info',
        store: {
          name: store.name,
          address: store.address,
          phone: store.phone,
          openingHours: store.openingHours || null,
          neighborhood: store.neighborhood,
          city: store.city,
        },
      } as StoreInfoData,
    };
  }

  /**
   * Saudação - SALUTATION
   */
  private async handleSalutation(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('👋 Processando saudação', {
      messageId: input.messageId,
    });

    // Retornar dados estruturados para saudação
    return {
      status: 'done',
      data: {
        type: 'salutation',
      } as SalutationData,
    };
  }

  /**
   * Pedido de Humano - HUMAN_REQUEST
   */
  private async handleHumanRequest(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('👤 Processando pedido de humano', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { notificationService, messageService } = this.deps;
    const { contextSnapshot, tenantId } = input;

    // NÃO criar ticket - apenas notificação informativa
    // Criar notificação WAITING_HUMAN
    let notificationCreated = false;
    if (notificationService) {
      try {
        const store = contextSnapshot.selectedStoreId 
          ? await this.deps.storeService.getStoreById(contextSnapshot.selectedStoreId, tenantId)
          : null;

        await notificationService.createNotification({
          tenantId,
          type: 'waiting_human',
          conversationId: input.conversationId,
          metadata: {
            reason: 'human_request',
            storeId: contextSnapshot.selectedStoreId || undefined,
            storeName: store?.name || contextSnapshot.selectedStoreName || undefined,
            lastMessagePreview: input.messageText.substring(0, 100),
            priority: 'normal',
          },
        });

        notificationCreated = true;
        logger.success('✅ Notificação WAITING_HUMAN criada', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao criar notificação waiting_human', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Alterar status da conversa para WAITING_HUMAN
    if (messageService) {
      try {
        await messageService.updateConversationState(input.conversationId, 'waiting_human', tenantId);
        logger.success('✅ Status da conversa alterado para WAITING_HUMAN', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao alterar status da conversa', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Desativar IA automaticamente
    if (messageService) {
      try {
        await messageService.updateAIControl(input.conversationId, {
          aiEnabled: false,
          aiDisabledBy: 'system',
          aiDisabledReason: 'Cliente solicitou atendimento humano',
        }, tenantId);
        logger.success('✅ IA desativada automaticamente', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao desativar IA', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      status: 'handoff',
      handoffReason: 'human_request',
      data: {
        type: 'handoff',
        reason: 'human_request',
        ticketCreated: false, // NÃO criar ticket para HUMAN_REQUEST
      } as HandoffData,
      ticketCreated: false,
      notificationCreated,
    };
  }

  /**
   * Verifica se a mensagem é uma resposta a um check-in de feedback
   */
  private async isFeedbackResponse(input: ExecutorInput): Promise<boolean> {
    if (!this.deps.messageService) return false;

    try {
      // Buscar últimas mensagens da conversa
      const messages = await this.deps.messageService.getMessagesByConversationId(
        input.conversationId,
        input.tenantId,
        5
      );

      // Verificar se há uma mensagem de check-in recente (últimas 5 mensagens)
      // Mensagem de check-in contém palavras-chave como "passaria", "retirada", "atendido"
      const checkinKeywords = ['passaria', 'retirada', 'atendido', 'deu tudo certo', 'foi bem atendido'];
      
      for (const msg of messages.reverse()) { // Do mais antigo para o mais recente
        if (msg.sender.phoneNumber === 'system' || msg.baileysKey?.fromMe) {
          const text = msg.text?.toLowerCase() || '';
          if (checkinKeywords.some(keyword => text.includes(keyword))) {
            logger.pipeline('✅ Check-in detectado nas mensagens recentes', {
              messageId: msg.messageId,
              textPreview: msg.text?.substring(0, 50),
            });
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.error('❌ Erro ao verificar se é feedback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Reserva - RESERVATION_REQUEST
   */
  private async handleReservationRequest(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('📅 Processando solicitação de reserva', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { routerResult, contextSnapshot, tenantId } = input;
    const { entities: currentEntities } = routerResult;

    // ENTITY MERGING: Fundir entidades atuais com entidades do contexto
    const mergedEntities = this.mergeEntities(currentEntities, contextSnapshot.entities);
    
    logger.pipeline('🔀 Entity Merging aplicado (Reservation)', {
      currentProduct: currentEntities.product_name,
      contextProduct: contextSnapshot.entities?.product_name,
      mergedProduct: mergedEntities.product_name,
      currentStore: currentEntities.store_name,
      contextStore: contextSnapshot.entities?.store_name,
      mergedStore: mergedEntities.store_name,
      currentQuantity: currentEntities.quantity,
      contextQuantity: contextSnapshot.entities?.quantity,
      mergedQuantity: mergedEntities.quantity,
      currentPickupTime: currentEntities.pickup_time,
      contextPickupTime: contextSnapshot.entities?.pickup_time,
      mergedPickupTime: mergedEntities.pickup_time,
    });

    // A partir daqui, usar APENAS mergedEntities
    const entities = mergedEntities;

    // Verificar se tem pickup_time confirmado
    const pickupTime = entities.pickup_time;
    if (!pickupTime) {
      logger.pipeline('⚠️ Reserva sem pickup_time - solicitando informação', {
        conversationId: input.conversationId,
      });
      
      // ANTI-LOOP: Verificar se já perguntou pickup_time 3 vezes
      const nextAction = 'asking_pickup_time';
      const antiLoopCheck = this.checkAntiLoop(nextAction, contextSnapshot);
      
      if (antiLoopCheck.shouldHandoff) {
        logger.warning('🚨 Anti-Loop: Handoff forçado após 3 tentativas de pedir pickup_time', {
          action: nextAction,
          reason: antiLoopCheck.reason,
        });
        
        return {
          status: 'handoff',
          handoffReason: antiLoopCheck.reason || 'repeated_failures',
          data: {
            type: 'handoff',
            reason: 'repeated_failures',
            ticketCreated: false,
          } as HandoffData,
          mergedEntities, // Retornar merged entities para persistência
          nextSystemAction: nextAction,
        };
      }
      
      return {
        status: 'need_input',
        data: {
          type: 'need_input',
          missingFields: ['pickup_time'],
          context: 'Cliente quer fazer reserva mas não informou o horário de retirada',
        } as NeedInputData,
        mergedEntities, // Retornar merged entities para persistência
        nextSystemAction: nextAction,
        retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
      };
    }

    // Resolver loja
    let storeId = contextSnapshot.selectedStoreId;
    let storeName = contextSnapshot.selectedStoreName;
    const storeMentioned = entities.store_name || entities.store;

    // Se já tem loja no contexto, verificar se a nova menção é diferente
    if (storeId && storeMentioned) {
      // CONFIRMAÇÃO DE HERANÇA: Verificar se a loja mencionada é diferente da salva
      try {
        const stores = await this.deps.storeService.getAllStores(tenantId);
        const matchedStore = findBestStoreMatch(storeMentioned, stores);
        
        if (matchedStore && matchedStore.id !== storeId) {
          // Loja diferente foi extraída - pedir confirmação
          logger.pipeline('⚠️ Loja diferente extraída na reserva - pedindo confirmação', {
            oldStoreId: storeId,
            oldStoreName: storeName,
            newStoreId: matchedStore.id,
            newStoreName: matchedStore.name,
            confidence: matchedStore.confidence,
          });
          
          return {
            status: 'need_input',
            data: {
              type: 'need_input',
              missingFields: ['store_confirmation'],
              context: `Cliente mencionou loja diferente (${matchedStore.name}) da já selecionada (${storeName}) na reserva`,
              selectedStoreId: storeId,
              selectedStoreName: storeName,
              storeConfirmationNeeded: true,
              newStoreName: matchedStore.name,
              oldStoreName: storeName,
            } as NeedInputData,
          };
        }
      } catch (error) {
        logger.error('❌ Erro ao verificar mudança de loja na reserva', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continuar com a loja do contexto se houver erro
      }
    }

    if (!storeId && storeMentioned) {
      try {
        const stores = await this.deps.storeService.getAllStores(tenantId);
        // Usar match restritivo
        const matchedStore = findBestStoreMatch(storeMentioned, stores);
        
        if (matchedStore && matchedStore.confidence >= 0.4) {
          storeId = matchedStore.id;
          storeName = matchedStore.name;
          logger.pipeline('✅ Loja resolvida pelo nome mencionado (match restritivo)', {
            storeId,
            storeName,
            matchType: matchedStore.matchType,
            confidence: matchedStore.confidence,
          });
          
          // PERSISTIR LOJA NO BANCO (Context Locking)
          try {
            await this.deps.messageService.updateSelectedStore(
              input.conversationId,
              storeId,
              storeName,
              tenantId
            );
            logger.success('💾 Loja salva no banco de dados', {
              conversationId: input.conversationId,
              storeId,
              storeName,
            });
          } catch (error) {
            logger.error('❌ Erro ao salvar loja no banco', {
              error: error instanceof Error ? error.message : String(error),
              storeId,
              storeName,
            });
            // Continuar mesmo se falhar ao salvar
          }
        } else {
          logger.pipeline('⚠️ Loja não encontrada ou confiança muito baixa na reserva', {
            storeMentioned,
            confidence: matchedStore?.confidence || 0,
          });
        }
      } catch (error) {
        logger.error('❌ Erro ao buscar loja', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // HERDAR CONTEXTO DE LOJA DE INTENTS ANTERIORES (ex: PRICE_INQUIRY)
    // Se não tiver loja na mensagem atual, usar do contexto persistido
    if (!storeId) {
      if (contextSnapshot.selectedStoreId) {
        storeId = contextSnapshot.selectedStoreId;
        storeName = contextSnapshot.selectedStoreName || undefined;
        logger.pipeline('✅ Herdando loja do contexto anterior', {
          storeId,
          storeName,
          source: 'contextSnapshot',
        });
      } else {
        logger.pipeline('⚠️ Reserva sem loja identificada - solicitando informação', {
          conversationId: input.conversationId,
        });
        
        // ANTI-LOOP: Verificar se já perguntou loja 3 vezes
        const nextAction = 'asking_store';
        const antiLoopCheck = this.checkAntiLoop(nextAction, contextSnapshot);
        
        if (antiLoopCheck.shouldHandoff) {
          logger.warning('🚨 Anti-Loop: Handoff forçado após 3 tentativas de pedir loja (Reservation)', {
            action: nextAction,
            reason: antiLoopCheck.reason,
          });
          
          return {
            status: 'handoff',
            handoffReason: antiLoopCheck.reason || 'repeated_failures',
            data: {
              type: 'handoff',
              reason: 'repeated_failures',
              ticketCreated: false,
            } as HandoffData,
            mergedEntities, // Retornar merged entities para persistência
            nextSystemAction: nextAction,
            retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
          };
        }
        
        return {
          status: 'need_input',
          data: {
            type: 'need_input',
            missingFields: ['store'],
            context: 'Cliente quer fazer reserva mas não especificou a loja',
          } as NeedInputData,
          mergedEntities, // Retornar merged entities para persistência
          nextSystemAction: nextAction,
          retryCount: antiLoopCheck.updatedRetryCount, // Retornar retryCount atualizado
        };
      }
    }

    // Obter produto e quantidade
    const productName = entities.product_name || entities.product || 'produtos';
    const quantity = entities.quantity || '1';

    // Converter pickup_time para timestamp
    let pickupTimestamp: number;
    try {
      const { parsePickupTime } = await import('../../utils/date-formatter');
      pickupTimestamp = parsePickupTime(pickupTime);
      
      logger.pipeline('✅ pickup_time convertido para timestamp', {
        pickupTime,
        pickupTimestamp,
        formattedDate: new Date(pickupTimestamp).toISOString(),
      });
    } catch (error) {
      logger.error('❌ Erro ao parsear pickup_time', {
        pickupTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'need_input',
        data: {
          type: 'need_input',
          missingFields: ['pickup_time'],
          context: 'Horário de retirada inválido',
        } as NeedInputData,
      };
    }

    // Criar task para gerente confirmar separação da reserva (se houver gerente)
    let taskRequest = undefined;
    try {
      const store = await this.deps.storeService.getStoreById(storeId, tenantId);
      if (store && store.managerWhatsappEnabled && store.managerWhatsappNumber) {
        taskRequest = {
          type: 'reservation_confirm' as const,
          storeId: store.id,
          payload: {
            item: productName,
            intent: 'availability' as const,
            storeId: store.id,
            storeName: store.name,
            quantity: quantity,
            pickup_time: pickupTime,
            isReservation: true, // Flag para identificar que é reserva
          },
          managerPhoneNumber: store.managerWhatsappNumber,
        };
        logger.pipeline('📋 Task de reserva criada para gerente', {
          storeId,
          productName,
          quantity,
          pickupTime,
        });
      }
    } catch (error) {
      logger.error('❌ Erro ao buscar loja para criar task de reserva', {
        error: error instanceof Error ? error.message : String(error),
        storeId,
      });
    }

    // Agendar feedback se FeedbackQueue estiver disponível
    if (this.deps.feedbackQueue) {
      logger.pipeline('📅 Agendando feedback check-in', {
        conversationId: input.conversationId,
        storeId,
        productName,
        pickupTime: pickupTime,
        pickupTimestamp,
        pickupTimestampISO: new Date(pickupTimestamp).toISOString(),
      });

      const scheduled = await this.deps.feedbackQueue.scheduleFeedbackCheckin(
        input.conversationId,
        tenantId,
        storeId,
        storeName || 'loja',
        productName,
        pickupTimestamp
      );

      if (scheduled) {
        logger.success('✅ Feedback agendado para após retirada', {
          conversationId: input.conversationId,
          pickupTime: pickupTime,
          pickupTimestamp,
          pickupTimestampISO: new Date(pickupTimestamp).toISOString(),
        });
      } else {
        logger.warning('⚠️ Feedback não foi agendado (pode ter falhado ou horário já passou)', {
          conversationId: input.conversationId,
          pickupTime: pickupTime,
          pickupTimestamp,
          pickupTimestampISO: new Date(pickupTimestamp).toISOString(),
        });
      }
    } else {
      logger.warning('⚠️ FeedbackQueue não disponível - feedback não será agendado', {
        conversationId: input.conversationId,
      });
    }

    return {
      status: taskRequest ? 'task_created' : 'reservation_confirmed',
      data: {
        type: 'reservation_request',
        store: {
          id: storeId,
          name: storeName || 'loja',
        },
        product: productName,
        pickupTime: pickupTime,
        quantity: quantity,
        isAwaitingConfirmation: !!taskRequest, // true quando está aguardando confirmação do gerente
      } as ReservationRequestData,
      taskRequest, // Incluir taskRequest se gerente estiver disponível
      feedbackScheduleRequest: {
        conversationId: input.conversationId,
        tenantId,
        storeId,
        storeName: storeName || 'loja',
        product: productName,
        pickupTime: pickupTimestamp,
      },
      mergedEntities, // Retornar merged entities para persistência
    };
  }

  /**
   * Feedback Promoter (Satisfeito)
   */
  private async handleFeedbackPromoter(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('😊 Processando feedback positivo', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { contextSnapshot, tenantId } = input;
    const storeId = contextSnapshot.selectedStoreId;

    if (!storeId) {
      logger.warning('⚠️ Feedback sem storeId - não é possível buscar link do Google', {
        conversationId: input.conversationId,
      });
      
      return {
        status: 'done',
        data: {
          type: 'feedback_promoter',
          store: {
            id: '',
            name: 'loja',
            googleReviewLink: null,
          },
        } as FeedbackPromoterData,
      };
    }

    try {
      const store = await this.deps.storeService.getStoreById(storeId, tenantId);
      
      return {
        status: 'done',
        data: {
          type: 'feedback_promoter',
          store: {
            id: store.id,
            name: store.name,
            googleReviewLink: store.googleReviewLink || null,
          },
        } as FeedbackPromoterData,
      };
    } catch (error) {
      logger.error('❌ Erro ao buscar loja para feedback', {
        error: error instanceof Error ? error.message : String(error),
        storeId,
      });
      
      return {
        status: 'done',
        data: {
          type: 'feedback_promoter',
          store: {
            id: storeId,
            name: 'loja',
            googleReviewLink: null,
          },
        } as FeedbackPromoterData,
      };
    }
  }

  /**
   * Feedback Dissatisfied (Insatisfeito)
   */
  private async handleFeedbackDissatisfied(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('😔 Processando feedback negativo', {
      messageId: input.messageId,
      conversationId: input.conversationId,
    });

    const { ticketService, notificationService } = this.deps;
    const { contextSnapshot, tenantId } = input;
    const storeId = contextSnapshot.selectedStoreId;

    // Criar ticket urgente
    let ticketCreated = false;
    if (ticketService) {
      try {
        await ticketService.createTicketFromHandoff({
          tenantId,
          conversationId: input.conversationId,
          storeId: storeId || null,
          priority: 'urgent',
          title: 'Feedback Negativo Pós-Reserva',
          summary: input.messageText.substring(0, 500),
          reason: 'feedback_dissatisfied',
          source: 'system',
          category: 'complaint',
        });

        ticketCreated = true;
        logger.success('✅ Ticket urgente criado para feedback negativo', {
          conversationId: input.conversationId,
        });
      } catch (error) {
        logger.error('❌ Erro ao criar ticket para feedback negativo', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Notificar gerente se houver loja
    if (storeId && ticketCreated) {
      try {
        const store = await this.deps.storeService.getStoreById(storeId, tenantId);
        if (store.managerWhatsappNumber && store.managerWhatsappEnabled && this.deps.notificationService) {
          // Notificar gerente via evento (será processado pelo handler)
          // O handler de conversation.handoff.requested já cuida disso
        }
      } catch (error) {
        logger.error('❌ Erro ao notificar gerente', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      status: 'handoff',
      handoffReason: 'feedback_dissatisfied',
      data: {
        type: 'feedback_dissatisfied',
        store: {
          id: storeId || '',
          name: contextSnapshot.selectedStoreName || 'loja',
        },
        ticketCreated,
      } as FeedbackDissatisfiedData,
      ticketCreated,
    };
  }

  /**
   * Handler para ACKNOWLEDGMENT (Silent Drop)
   * 
   * Se o usuário apenas confirmou/agradeceu e há uma task pendente ou não há pergunta ativa,
   * retorna silent_drop para evitar resposta desnecessária.
   */
  private async handleAcknowledgment(input: ExecutorInput): Promise<ExecutorOutput> {
    logger.pipeline('✅ Processando ACKNOWLEDGMENT (Silent Drop)', {
      messageId: input.messageId,
      conversationId: input.conversationId,
      lastSystemAction: input.contextSnapshot.lastSystemAction,
    });

    const { contextSnapshot, conversationId, tenantId } = input;

    // Verificar se há task pendente (se taskService estiver disponível)
    let hasPendingTask = false;
    if (this.deps.ticketService) {
      // Nota: O Executor não tem acesso direto ao taskService, mas podemos inferir
      // pela lastSystemAction se estamos aguardando algo
      const waitingActions = ['waiting_manager_response', 'task_created', 'awaiting_confirmation'];
      hasPendingTask = contextSnapshot.lastSystemAction 
        ? waitingActions.some(action => contextSnapshot.lastSystemAction?.includes(action))
        : false;
    }

    // Verificar se não há pergunta ativa pendente
    // Se lastSystemAction não indica uma pergunta ativa (ex: "asking_store", "asking_product"),
    // então não há pergunta pendente
    const askingActions = ['asking_store', 'asking_product', 'asking_pickup_time', 'asking_quantity'];
    const hasActiveQuestion = contextSnapshot.lastSystemAction 
      ? askingActions.some(action => contextSnapshot.lastSystemAction?.includes(action))
      : false;

    // Se há task pendente OU não há pergunta ativa, fazer silent drop
    if (hasPendingTask || !hasActiveQuestion) {
      const reason = hasPendingTask 
        ? 'acknowledgment_with_pending_task' 
        : 'acknowledgment_no_active_question';

      logger.pipeline('🔇 Silent Drop aplicado', {
        reason,
        hasPendingTask,
        hasActiveQuestion,
        lastSystemAction: contextSnapshot.lastSystemAction,
      });

      return {
        status: 'silent_drop',
        data: {
          type: 'silent_drop',
          reason,
        } as import('./types').SilentDropData,
      };
    }

    // Se há pergunta ativa, tratar como resposta normal (pode ser que o usuário esteja respondendo)
    // Mas como foi classificado como ACKNOWLEDGMENT, provavelmente é apenas confirmação
    // Vamos fazer silent drop mesmo assim para evitar "Politeness Loop"
    logger.pipeline('🔇 Silent Drop aplicado (mesmo com pergunta ativa - evita Politeness Loop)', {
      lastSystemAction: contextSnapshot.lastSystemAction,
    });

    return {
      status: 'silent_drop',
      data: {
        type: 'silent_drop',
        reason: 'acknowledgment_avoid_politeness_loop',
      } as import('./types').SilentDropData,
    };
  }
}
