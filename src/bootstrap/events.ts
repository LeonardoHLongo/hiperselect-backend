import { eventBus } from '../events';
import { MessageService } from '../messages';
import type { WhatsAppMessageReceivedEvent, WhatsAppMessageSentEvent, WhatsAppContactUpdatedEvent } from '../whatsapp';
import type { ConversationOrchestrator } from '../conversation-pipeline/orchestrator/orchestrator';
import type { CompanyService } from '../company';
import type { ConversationTaskService } from '../conversation-tasks/service';
import { PostgresInternalContactRepository } from '../internal-contacts/repository-postgres';
import { logger } from '../utils/logger';

type EventHandlersDependencies = {
  messageService: MessageService;
  conversationOrchestrator?: ConversationOrchestrator;
  taskService?: ConversationTaskService;
  messageGroupingQueue?: import('../conversation-pipeline/queue/message-grouping-queue').MessageGroupingQueue;
};

export const wireEventHandlers = (deps: EventHandlersDependencies): void => {
  const { messageService } = deps;

  eventBus.on<WhatsAppMessageReceivedEvent>('whatsapp.message.received', async (event) => {
    logger.section('Mensagem Recebida', '📥');
    logger.message(`Nova mensagem recebida`, {
      messageId: event.messageId,
      conversationId: event.conversationId,
      sender: event.sender.pushName || event.sender.phoneNumber,
      text: event.text?.substring(0, 100) || '[mídia]',
      messageType: event.messageType,
    });
    
    try {
      // Passo 0: Persistir mensagem PRIMEIRO (sempre, mesmo se for de gerente)
      // Isso garante que todas as mensagens sejam salvas no histórico
      await messageService.storeMessage({
        messageId: event.messageId,
        conversationId: event.conversationId,
        text: event.text || null,
        timestamp: event.timestamp,
        sender: event.sender,
        media: event.media,
        messageType: event.messageType,
        baileysKey: event.baileysKey,
        baileysMessage: event.baileysMessage,
      });
      logger.success('Mensagem salva com sucesso', { messageId: event.messageId });

      // Passo 1: AGrupamento Universal - TODAS as mensagens (cliente ou gerente) passam pelo agrupamento
      // A verificação de gerente será feita APÓS o agrupamento no Orchestrator
      const isFromSystem = event.baileysKey?.fromMe === true;
      
      if (!isFromSystem && deps.conversationOrchestrator) {
        // Se messageGroupingQueue estiver disponível, usar agrupamento de mensagens
        // Agora também aceita mensagens de mídia (áudio/imagem) que serão processadas depois
        if (deps.messageGroupingQueue && (event.text || event.media)) {
          logger.pipeline('📦 Adicionando mensagem ao grupo de agrupamento...', {
            messageId: event.messageId,
            conversationId: event.conversationId,
            hasText: !!event.text,
            hasMedia: !!event.media,
            mediaType: event.media?.type,
          });
          
          try {
            await deps.messageGroupingQueue.addMessage(
              event.conversationId,
              event.messageId,
              event.text || null, // Pode ser null para mídia
              event.timestamp
            );
            
            logger.debug('✅ Mensagem adicionada ao grupo de agrupamento', {
              messageId: event.messageId,
              conversationId: event.conversationId,
            });
          } catch (groupingError) {
            logger.error('❌ Erro ao adicionar mensagem ao grupo de agrupamento', {
              messageId: event.messageId,
              conversationId: event.conversationId,
              error: groupingError instanceof Error ? groupingError.message : String(groupingError),
              stack: groupingError instanceof Error ? groupingError.stack : undefined,
            });
            
            // Fallback: processar imediatamente se o agrupamento falhar
            logger.pipeline('⚠️ Fallback: processando mensagem imediatamente devido a erro no agrupamento');
            deps.conversationOrchestrator.processMessage(event.messageId, event.conversationId).catch((error) => {
              logger.error('Erro no processamento do orchestrator (fallback)', { error: error.message });
            });
          }
        } else {
          // Processar imediatamente se não houver agrupamento ou se for mensagem sem texto/mídia
          logger.pipeline('Iniciando processamento no orchestrator...');
          deps.conversationOrchestrator.processMessage(event.messageId, event.conversationId).catch((error) => {
            logger.error('Erro no processamento do orchestrator', { error: error.message });
          });
        }
      } else {
        if (isFromSystem) {
          logger.debug('Orchestrator ignorado (mensagem do sistema)');
        }
        if (!deps.conversationOrchestrator) {
          logger.warning('Orchestrator não configurado');
        }
      }
    } catch (error) {
      logger.error('Erro ao processar mensagem recebida', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  // Handler para mensagens enviadas pelo sistema
  eventBus.on<WhatsAppMessageSentEvent>('whatsapp.message.sent', async (event) => {
    logger.section('Mensagem Enviada', '📤');
    logger.message(`Mensagem enviada pelo sistema`, {
      messageId: event.messageId,
      conversationId: event.conversationId,
      content: event.content.substring(0, 100),
    });
    
    try {
      const systemSender = {
        phoneNumber: 'system',
        jid: 'system@s.whatsapp.net',
        pushName: 'Sistema',
      };

      let finalTimestamp = event.timestamp;
      
      if (finalTimestamp <= 0) {
        logger.warning('Timestamp inválido, usando Date.now()', { timestamp: finalTimestamp });
        finalTimestamp = Date.now();
      }
      
      if (finalTimestamp < 10000000000) {
        logger.warning('Timestamp em segundos detectado, convertendo para ms', { timestamp: finalTimestamp });
        finalTimestamp = finalTimestamp * 1000;
      }

      await messageService.storeMessage({
        messageId: event.messageId,
        conversationId: event.conversationId,
        text: event.content,
        timestamp: finalTimestamp,
        sender: systemSender,
        messageType: 'text',
        baileysKey: {
          id: event.messageId,
          remoteJid: `${event.conversationId}@s.whatsapp.net`,
          fromMe: true,
        },
      });
      logger.success('Mensagem enviada salva com sucesso', { messageId: event.messageId });
    } catch (error) {
      logger.error('Erro ao salvar mensagem enviada', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  // Handler para atualizar nome do remetente na conversa quando contacts.upsert fornecer nome
  eventBus.on<WhatsAppContactUpdatedEvent>('whatsapp.contact.updated', async (event) => {
    logger.debug('Contato atualizado', {
      conversationId: event.conversationId,
      pushName: event.sender.pushName || 'sem nome',
      phoneNumber: event.sender.phoneNumber,
    });
    
    try {
      await messageService.updateConversationSender(event.conversationId, event.sender);
      logger.success('Remetente da conversa atualizado', {
        conversationId: event.conversationId,
        pushName: event.sender.pushName || 'sem nome',
      });
    } catch (error) {
      logger.error('Erro ao atualizar remetente', { 
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

