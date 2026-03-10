/**
 * Pipeline Event Handlers
 * Handlers para eventos do Conversation Pipeline
 * 
 * Responsabilidade: Enviar respostas geradas via WhatsApp
 * NÃO contém lógica de negócio
 * Apenas conecta eventos do pipeline com WhatsApp Adapter
 */
import { eventBus } from '../events';
import type { ResponseGeneratedEvent } from '../conversation-pipeline';
import type { WhatsAppAdapter } from '../whatsapp';
import { MessageService } from '../messages';
import type { NotificationService } from '../notifications/service';
import type { ConversationTaskService } from '../conversation-tasks/service';
import type { StoreService } from '../stores';
import { PostgresInternalContactRepository } from '../internal-contacts/repository-postgres';
import { logger } from '../utils/logger';

type PipelineHandlersDependencies = {
  whatsAppAdapter: WhatsAppAdapter;
  messageService: MessageService;
  notificationService?: NotificationService;
  taskService?: ConversationTaskService;
  storeService?: StoreService;
  humanizer?: any; // Agente Boca para humanizar respostas de gerente
};

export const wirePipelineHandlers = (deps: PipelineHandlersDependencies): void => {
  const { whatsAppAdapter } = deps;

  // Handler para evento de reputação em risco
  eventBus.on('conversation.reputation.at.risk', async (event: any) => {
    logger.warning('⚠️ Reputação em risco detectada', {
      prefix: '[PipelineHandlers]',
      emoji: '⚠️',
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      intent: event.intent,
      sentiment: event.sentiment,
    });

    // Aqui pode ser adicionada lógica adicional:
    // - Notificar equipe de gestão
    // - Criar alerta prioritário
    // - Atualizar dashboard em tempo real
  });

  // Guard de idempotência: rastrear mensagens já enviadas
  // Chave: `${traceId}:${conversationId}:${messageId}`
  // Limpar entradas antigas periodicamente (manter últimas 1000)
  const sentMessages = new Set<string>();

  /**
   * Handler para resposta gerada pelo pipeline
   * Envia a resposta via WhatsApp Adapter
   * IDEMPOTÊNCIA: Evita enviar a mesma resposta múltiplas vezes
   */
  eventBus.on<ResponseGeneratedEvent>('conversation.response.generated', async (event) => {
    // Construir chave de idempotência usando traceId + conversationId + messageId
    const traceId = event.traceId || `no-trace-${Date.now()}`;
    const idempotencyKey = `${traceId}:${event.conversationId}:${event.messageId}`;
    
    // Verificar se já foi enviado
    if (sentMessages.has(idempotencyKey)) {
      logger.warning('⚠️ Resposta já enviada (idempotência) - ignorando duplicata', {
        prefix: '[PipelineHandlers]',
        emoji: '⚠️',
        traceId,
        messageId: event.messageId,
        conversationId: event.conversationId,
        idempotencyKey,
      });
      return;
    }

    logger.section('Resposta Gerada pela IA', '🤖');
    logger.ai('Resposta gerada pelo pipeline', {
      messageId: event.messageId,
      conversationId: event.conversationId,
      traceId,
      responsePreview: event.response.text.substring(0, 100),
      brainDecision: event.brainDecision,
    });
    
    try {
      const status = whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        logger.warning('WhatsApp não conectado - resposta não enviada', { status: status.status });
        return;
      }

      let phoneNumber = event.conversationId;
      if (phoneNumber.includes('@')) {
        phoneNumber = phoneNumber.split('@')[0];
      }

      logger.whatsapp('Enviando resposta via WhatsApp', {
        to: phoneNumber,
        traceId,
        preview: event.response.text.substring(0, 50),
      });

      const messageId = await whatsAppAdapter.sendMessage(phoneNumber, event.response.text);
      
      // Marcar como enviado APÓS sucesso
      sentMessages.add(idempotencyKey);
      
      // Limpar entradas antigas (manter últimas 1000)
      if (sentMessages.size > 1000) {
        const entries = Array.from(sentMessages);
        sentMessages.clear();
        entries.slice(-500).forEach(key => sentMessages.add(key));
      }
      
      logger.success('Resposta enviada com sucesso', { 
        messageId,
        conversationId: event.conversationId,
        traceId,
        idempotencyKey,
      });
    } catch (error) {
      logger.error('Erro ao enviar resposta', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        traceId,
        idempotencyKey,
      });
      // NÃO marcar como enviado se houve erro (permite retry)
    }
  });

  /**
   * Handler para decisão tomada pelo pipeline (sem resposta)
   * Apenas loga a decisão (futuras fases podem criar tickets, etc)
   */
  eventBus.on('conversation.decision.made', async (event: {
    messageId: string;
    conversationId: string;
    decision: string;
    brainAnalysis?: any;
    timestamp: number;
    traceId: string;
  }) => {
    logger.debug('Decisão tomada pelo pipeline', {
      decision: event.decision,
      conversationId: event.conversationId,
      messageId: event.messageId,
    });
  });

  /**
   * Handler para resposta bloqueada
   * Envia fallback curto quando resposta automática é bloqueada
   */
  eventBus.on('conversation.response.blocked', async (event: {
    messageId: string;
    conversationId: string;
    reason: string;
    decision: string;
    brainAnalysis?: any;
    timestamp: number;
    traceId: string;
  }) => {
    logger.warning('Resposta bloqueada pelo Safety Gate', {
      reason: event.reason,
      conversationId: event.conversationId,
      messageId: event.messageId,
      decision: event.decision,
    });
  });

  /**
   * Handler para handoff solicitado (IA desativada)
   * Persiste notificação para alertar operadores
   */
  eventBus.on('conversation.handoff.requested', async (event: {
    tenantId: string;
    conversationId: string;
    storeId?: string | null;
    reason: string;
    timestamp: number;
    lastMessagePreview?: string | null;
    storeName?: string | null;
    traceId: string;
  }) => {
    logger.pipeline('📢 Handoff solicitado - criando notificação', {
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      reason: event.reason,
      traceId: event.traceId,
      hasNotificationService: !!deps.notificationService,
    });

    if (!deps.notificationService) {
      logger.error('❌ NotificationService não configurado - notificação não será criada', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        conversationId: event.conversationId,
      });
      return;
    }

    if (!event.tenantId) {
      logger.error('❌ tenantId não fornecido no evento - notificação não será criada', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        conversationId: event.conversationId,
      });
      return;
    }

    try {
      const notification = await deps.notificationService.createNotification({
        tenantId: event.tenantId,
        type: 'handoff_requested',
        conversationId: event.conversationId,
        metadata: {
          reason: event.reason,
          severity: (event as any).severity || 'warning', // 'warning' (amarelo) ou 'error' (vermelho)
          storeId: event.storeId || undefined,
          storeName: event.storeName || undefined,
          lastMessagePreview: event.lastMessagePreview || undefined,
        },
      });
      
      logger.success('✅ Notificação de handoff criada com sucesso', {
        prefix: '[PipelineHandlers]',
        emoji: '✅',
        conversationId: event.conversationId,
        notificationId: notification.id,
        tenantId: event.tenantId,
      });
    } catch (error) {
      logger.error('❌ Erro ao criar notificação de handoff', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        conversationId: event.conversationId,
        tenantId: event.tenantId,
      });
    }
  });

  /**
   * Handler para task criada (verificação com gerente)
   * Envia mensagem ao gerente com o request_code
   */
  eventBus.on('conversation.task.created', async (event: {
    taskId: string;
    conversationId: string;
    tenantId: string;
    requestCode: string;
    type: string;
  }) => {
    logger.pipeline('📋 Task criada - enviando mensagem ao gerente', {
      taskId: event.taskId,
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      requestCode: event.requestCode,
      hasTaskService: !!deps.taskService,
      hasStoreService: !!deps.storeService,
    });

    if (!deps.taskService || !deps.storeService) {
      logger.error('❌ TaskService ou StoreService não disponível', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        taskId: event.taskId,
      });
      return;
    }

    try {
      // Buscar task para obter dados completos
      const task = await deps.taskService.findByRequestCode(event.requestCode, event.tenantId);
      if (!task) {
        logger.error('❌ Task não encontrada', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          requestCode: event.requestCode,
        });
        return;
      }

      // Buscar loja para obter número do gerente
      if (!task.storeId) {
        logger.error('❌ Task sem storeId', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          taskId: task.id,
        });
        return;
      }

      const store = await deps.storeService.getStoreById(task.storeId, event.tenantId);
      if (!store || !store.managerWhatsappNumber) {
        logger.error('❌ Loja não encontrada ou sem número de gerente', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          storeId: task.storeId,
        });
        return;
      }

      // Garantir que o gerente está cadastrado como internal_contact
      const internalContactRepo = new PostgresInternalContactRepository();
      
      // Normalizar número do gerente (mesma lógica usada para enviar mensagem)
      let managerPhone = store.managerWhatsappNumber.trim();
      
      logger.pipeline('📞 Normalizando número do gerente', {
        originalNumber: store.managerWhatsappNumber,
        beforeNormalization: managerPhone,
      });
      
      if (managerPhone.includes('@')) {
        managerPhone = managerPhone.split('@')[0];
      }
      managerPhone = managerPhone.replace(/[\s\(\)\-\.]/g, '');
      if (managerPhone.startsWith('+')) {
        managerPhone = managerPhone.substring(1);
      }
      
      // Garantir que o número tenha código do país (55 para Brasil)
      // Se o número começar com 0, remover o 0
      if (managerPhone.startsWith('0')) {
        managerPhone = managerPhone.substring(1);
      }
      
      // Se não começar com 55 (código do Brasil), adicionar
      // Mas só se o número tiver pelo menos 10 dígitos (número brasileiro válido)
      if (!managerPhone.startsWith('55') && managerPhone.length >= 10) {
        // Verificar se já não tem código de outro país (começa com dígitos diferentes de 55)
        // Números brasileiros têm 10 ou 11 dígitos (com DDD)
        // Se tiver 10-11 dígitos e não começar com 55, provavelmente é brasileiro sem código
        if (managerPhone.length <= 11) {
          managerPhone = `55${managerPhone}`;
        }
      }
      
      logger.pipeline('📞 Número normalizado', {
        originalNumber: store.managerWhatsappNumber,
        normalizedNumber: managerPhone,
        length: managerPhone.length,
      });
      
      // Verificar se já existe como internal_contact
      let internalContact = await internalContactRepo.findByPhoneNumber(managerPhone, event.tenantId);
      
      if (!internalContact) {
        // Criar automaticamente se não existir
        logger.pipeline('📝 Criando internal_contact para gerente', {
          phoneNumber: managerPhone,
          storeId: task.storeId,
        });
        
        try {
          internalContact = await internalContactRepo.create({
            tenantId: event.tenantId,
            phoneNumber: managerPhone,
            contactType: 'manager',
            storeId: task.storeId,
          });
          
          logger.success('✅ Internal contact criado automaticamente', {
            prefix: '[PipelineHandlers]',
            emoji: '✅',
            contactId: internalContact.id,
            phoneNumber: managerPhone,
          });
        } catch (error) {
          logger.error('❌ Erro ao criar internal_contact', {
            prefix: '[PipelineHandlers]',
            emoji: '❌',
            error: error instanceof Error ? error.message : String(error),
            phoneNumber: managerPhone,
          });
          // Continuar mesmo se falhar (pode já existir)
        }
      }

      // Buscar conversa para obter userName
      const conversation = await deps.messageService.getConversationById(event.conversationId, event.tenantId);
      const userName = conversation?.participantName || conversation?.sender?.pushName || 'cliente';
      
      const storeName = task.payload.storeName || 'loja';
      const productName = task.payload.item || 'produto';
      
      // Importar formatação de data
      const { formatBrazilianDateTime } = await import('../utils/date-formatter');
      
      // Verificar tipo da task
      const taskType = task.type;
      
      let message: string;
      if (taskType === 'reservation_confirm') {
        // Template para confirmação de reserva
        const quantity = task.payload.quantity || '1';
        const pickupTimeRaw = task.payload.pickup_time || '';
        const pickupTimeFormatted = pickupTimeRaw ? formatBrazilianDateTime(pickupTimeRaw) : 'horário combinado';
        message = `Olá! 👋 O cliente ${userName} quer reservar ${quantity} de ${productName} na unidade ${storeName}. Ele passa para buscar ${pickupTimeFormatted}. Pode confirmar a separação?`;
      } else {
        // Template para verificação de preço/disponibilidade (price_check)
        const isPromotion = task.payload.intent === 'promotion';
        const intentText = isPromotion ? 'promoção' 
          : task.payload.intent === 'availability' ? 'disponibilidade'
          : 'preço';
        
        message = `Olá! 👋 O cliente ${userName} está perguntando sobre ${intentText} de ${productName} na unidade ${storeName}.\n\nVocê poderia confirmar se ainda temos em estoque e, se possível, qual o preço atual? Assim eu já respondo para ele agora mesmo. 😊`;
      }

      // Enviar mensagem ao gerente
      const status = whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        logger.warning('⚠️ WhatsApp não conectado - mensagem ao gerente não enviada', {
          prefix: '[PipelineHandlers]',
          emoji: '⚠️',
          status: status.status,
        });
        return;
      }

      // Validar que é apenas números (já foi normalizado acima)
      if (!/^\d+$/.test(managerPhone)) {
        logger.error('❌ Número do gerente inválido (contém caracteres não numéricos)', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          originalNumber: store.managerWhatsappNumber,
          normalizedNumber: managerPhone,
          taskId: task.id,
        });
        return;
      }
      
      // Validar comprimento mínimo (deve ter pelo menos 10 dígitos)
      if (managerPhone.length < 10) {
        logger.error('❌ Número do gerente muito curto', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          originalNumber: store.managerWhatsappNumber,
          normalizedNumber: managerPhone,
          length: managerPhone.length,
          taskId: task.id,
        });
        return;
      }

      // Validação final do número antes de enviar
      const expectedJid = `${managerPhone}@s.whatsapp.net`;
      
      logger.whatsapp('📤 Preparando envio de mensagem ao gerente', {
        originalNumber: store.managerWhatsappNumber,
        normalizedNumber: managerPhone,
        expectedJid,
        requestCode: event.requestCode,
        taskId: task.id,
        messageLength: message.length,
        messagePreview: message.substring(0, 100),
        hasWhatsAppAdapter: !!whatsAppAdapter,
      });

      // Verificar status do WhatsApp antes de enviar
      const whatsappStatus = whatsAppAdapter.getConnectionStatus();
      logger.pipeline('📱 Status do WhatsApp antes do envio', {
        status: whatsappStatus.status,
        hasSocket: !!whatsAppAdapter,
      });

      if (whatsappStatus.status !== 'connected') {
        logger.error('❌ WhatsApp não está conectado - não é possível enviar mensagem', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          status: whatsappStatus.status,
          taskId: task.id,
        });
        return;
      }

      try {
        logger.pipeline('📤 Chamando whatsAppAdapter.sendMessage', {
          to: managerPhone,
          expectedJid,
          messageLength: message.length,
        });

        const messageId = await whatsAppAdapter.sendMessage(managerPhone, message);
        
        logger.success('✅ Mensagem enviada ao gerente com sucesso', {
          prefix: '[PipelineHandlers]',
          emoji: '✅',
          taskId: task.id,
          requestCode: event.requestCode,
          managerPhone,
          expectedJid,
          messageId,
          whatsappStatus: whatsappStatus.status,
        });
      } catch (sendError) {
        // Log detalhado do erro
        logger.error('❌ Erro ao enviar mensagem ao gerente', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          error: sendError instanceof Error ? sendError.message : String(sendError),
          errorStack: sendError instanceof Error ? sendError.stack : undefined,
          managerPhone,
          originalNumber: store.managerWhatsappNumber,
          taskId: task.id,
          requestCode: event.requestCode,
        });
        
        // Não re-throw - apenas logar o erro para não quebrar o fluxo
        // A task já foi criada, então o sistema pode tentar novamente depois
      }
    } catch (error) {
      logger.error('❌ Erro ao processar task criada', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        taskId: event.taskId,
      });
    }
  });

  /**
   * Handler para task completada (gerente respondeu)
   * Processa resposta do gerente através do Agente Boca antes de enviar ao cliente
   */
  eventBus.on('conversation.task.completed', async (event: {
    taskId: string;
    conversationId: string;
    tenantId: string;
    resultText: string;
  }) => {
    logger.pipeline('✅ Task completada - processando resposta do gerente', {
      taskId: event.taskId,
      conversationId: event.conversationId,
      tenantId: event.tenantId,
      resultPreview: event.resultText.substring(0, 50),
    });

    try {
      if (!deps.taskService || !deps.storeService || !deps.humanizer) {
        logger.error('❌ Serviços necessários não disponíveis', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          hasTaskService: !!deps.taskService,
          hasStoreService: !!deps.storeService,
          hasHumanizer: !!deps.humanizer,
        });
        return;
      }

      // Buscar task para obter dados completos
      const task = await deps.taskService.findById(event.taskId, event.tenantId);
      if (!task || !task.storeId) {
        logger.error('❌ Task não encontrada ou sem storeId', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          taskId: event.taskId,
        });
        return;
      }

      // TRAVA DE IDEMPOTÊNCIA: Verificar se task já foi processada
      if (task.status !== 'completed') {
        logger.warning('⚠️ Task não está marcada como completed - pode ser processamento duplicado', {
          prefix: '[PipelineHandlers]',
          emoji: '⚠️',
          taskId: event.taskId,
          currentStatus: task.status,
        });
        // Continuar mesmo assim, mas logar o aviso
      }

      // Buscar loja para obter nome
      const store = await deps.storeService.getStoreById(task.storeId, event.tenantId);
      if (!store) {
        logger.error('❌ Loja não encontrada', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          storeId: task.storeId,
        });
        return;
      }

      // Buscar conversa para obter userName
      const conversation = await deps.messageService.getConversationById(event.conversationId, event.tenantId);
      const userName = conversation?.participantName || conversation?.sender?.pushName || undefined;

      // Importar formatação de data
      const { formatBrazilianDateTime } = await import('../utils/date-formatter');

      // DIFERENCIAR TIPOS DE TASK
      const taskType = task.type; // 'price_check' ou 'reservation_confirm'
      const isReservation = taskType === 'reservation_confirm';
      
      // Formatar pickup_time se existir
      const pickupTimeFormatted = task.payload.pickup_time 
        ? formatBrazilianDateTime(task.payload.pickup_time)
        : undefined;
      
      // Processar resposta do gerente através do Agente Boca
      const humanizedResponse = await deps.humanizer.humanize({
        executorData: {
          type: 'manager_response',
          store: {
            id: store.id,
            name: store.name,
          },
          product: task.payload.item || 'produto',
          managerResponse: event.resultText,
          taskType: task.payload.intent || 'price',
          isReservation,
          quantity: task.payload.quantity,
          pickupTime: task.payload.pickup_time,
          pickupTimeFormatted, // Adicionar versão formatada
          taskTypeCategory: taskType, // Passar o tipo da task (price_check ou reservation_confirm)
        },
        userName,
        userMessage: event.resultText, // Mensagem do gerente como contexto
      });

      const status = whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        logger.warning('⚠️ WhatsApp não conectado - resposta ao cliente não enviada', {
          prefix: '[PipelineHandlers]',
          emoji: '⚠️',
          status: status.status,
        });
        return;
      }

      // Normalizar número do cliente
      let clientPhone = event.conversationId;
      if (clientPhone.includes('@')) {
        clientPhone = clientPhone.split('@')[0];
      }

      logger.whatsapp('Enviando resposta humanizada ao cliente', {
        to: clientPhone,
        taskId: event.taskId,
        preview: humanizedResponse.substring(0, 50),
      });

      await whatsAppAdapter.sendMessage(clientPhone, humanizedResponse);

      logger.success('✅ Resposta humanizada enviada ao cliente com sucesso', {
        prefix: '[PipelineHandlers]',
        emoji: '✅',
        taskId: event.taskId,
        conversationId: event.conversationId,
      });
    } catch (error) {
      logger.error('❌ Erro ao processar resposta do gerente', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        taskId: event.taskId,
      });
    }
  });

  /**
   * Handler para task expirada (timeout de 20 minutos)
   * Envia mensagem ao cliente com telefone da loja
   */
  eventBus.on('conversation.task.expired', async (event: {
    taskId: string;
    conversationId: string;
    tenantId: string;
  }) => {
    logger.pipeline('⏰ Task expirada - enviando mensagem de fallback ao cliente', {
      taskId: event.taskId,
      conversationId: event.conversationId,
      tenantId: event.tenantId,
    });

    try {
      if (!deps.taskService || !deps.storeService) {
        logger.error('❌ TaskService ou StoreService não disponível', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          taskId: event.taskId,
        });
        return;
      }

      // Buscar task para obter storeId
      const task = await deps.taskService.findById(event.taskId, event.tenantId);
      if (!task || !task.storeId) {
        logger.error('❌ Task não encontrada ou sem storeId', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          taskId: event.taskId,
        });
        return;
      }

      // Buscar loja para obter telefone
      const store = await deps.storeService.getStoreById(task.storeId, event.tenantId);
      if (!store || !store.phone) {
        logger.error('❌ Loja não encontrada ou sem telefone', {
          prefix: '[PipelineHandlers]',
          emoji: '❌',
          storeId: task.storeId,
        });
        return;
      }

      const status = whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        logger.warning('⚠️ WhatsApp não conectado - mensagem de expiração não enviada', {
          prefix: '[PipelineHandlers]',
          emoji: '⚠️',
          status: status.status,
        });
        return;
      }

      // Mensagem conforme especificação
      const message = `Ainda não consegui confirmação da unidade 😕 Para não te fazer esperar, você pode ligar direto no ${store.phone}.`;

      // Normalizar número do cliente
      let clientPhone = event.conversationId;
      if (clientPhone.includes('@')) {
        clientPhone = clientPhone.split('@')[0];
      }

      logger.whatsapp('Enviando mensagem de expiração ao cliente', {
        to: clientPhone,
        taskId: event.taskId,
        storePhone: store.phone,
      });

      await whatsAppAdapter.sendMessage(clientPhone, message);

      logger.success('✅ Mensagem de expiração enviada ao cliente', {
        prefix: '[PipelineHandlers]',
        emoji: '✅',
        taskId: event.taskId,
        conversationId: event.conversationId,
        storePhone: store.phone,
      });
    } catch (error) {
      logger.error('❌ Erro ao processar task expirada', {
        prefix: '[PipelineHandlers]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        taskId: event.taskId,
      });
    }
  });
};

