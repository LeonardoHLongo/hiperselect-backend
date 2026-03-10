/**
 * BullMQ Queue para Gerenciar Feedback Pós-Reserva
 * 
 * Responsabilidade:
 * - Agendar mensagens de check-in 3 minutos após horário de retirada
 * - Enviar mensagens proativas de feedback
 */
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../../utils/logger';
import type { MessageService } from '../../messages';
import type { WhatsAppAdapter } from '../../whatsapp';
import type { StoreService } from '../../stores';
import { Humanizer } from '../humanizer/humanizer';
import { eventBus } from '../../events';

type FeedbackQueueDependencies = {
  messageService: MessageService;
  whatsAppAdapter: WhatsAppAdapter;
  storeService: StoreService;
  humanizer: Humanizer;
  openaiApiKey: string;
  redisConnection: string | {
    host: string;
    port: number;
    password?: string;
    username?: string;
  };
};

export class FeedbackQueue {
  private queue: Queue;
  private worker: Worker;
  private queueEvents: QueueEvents;
  private redisClient: Redis;

  constructor(private deps: FeedbackQueueDependencies) {
    // Validar conexão do Redis
    if (!deps.redisConnection) {
      throw new Error('Redis connection is required for FeedbackQueue');
    }

    // Criar instância do Redis (mesma lógica do ManagerVerificationQueue)
    if (typeof deps.redisConnection === 'string') {
      const maskedUrl = deps.redisConnection.replace(/:[^:@]+@/, ':****@');
      logger.pipeline('🔗 Criando cliente Redis para FeedbackQueue', {
        url: maskedUrl,
      });
      
      this.redisClient = new Redis(deps.redisConnection, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        enableOfflineQueue: false,
        lazyConnect: false,
        showFriendlyErrorStack: true,
        connectTimeout: 30000,
        commandTimeout: 30000,
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error('❌ Redis: Muitas tentativas de reconexão, parando retry', { times });
            return null;
          }
          const delay = Math.min(times * 100, 5000);
          logger.warning(`⚠️ Redis retry attempt ${times}`, { delay, nextRetryIn: `${delay}ms` });
          return delay;
        },
        keepAlive: 30000,
        family: 4,
      });
    } else {
      this.redisClient = new Redis({
        host: deps.redisConnection.host,
        port: deps.redisConnection.port,
        password: deps.redisConnection.password,
        username: deps.redisConnection.username,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        enableOfflineQueue: false,
        lazyConnect: false,
        showFriendlyErrorStack: true,
        connectTimeout: 30000,
        commandTimeout: 30000,
        retryStrategy: (times) => {
          if (times > 10) {
            return null;
          }
          const delay = Math.min(times * 100, 5000);
          return delay;
        },
        keepAlive: 30000,
        family: 4,
      });
    }

    // Criar fila
    this.queue = new Queue('feedback-checkin', {
      connection: this.redisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 24 * 3600,
        },
      },
    });

    // Criar worker para processar jobs de feedback
    this.worker = new Worker(
      'feedback-checkin',
      async (job) => {
        try {
          await this.handleFeedbackCheckin(job.data);
        } catch (error) {
          // Se o erro for por WhatsApp offline, usar retry
          if (error instanceof Error && error.message.includes('WhatsApp offline')) {
            logger.warning('⚠️ Job de feedback falhou por WhatsApp offline - usando retry', {
              jobId: job.id,
              attemptsMade: job.attemptsMade,
              maxAttempts: job.opts.attempts || 3,
            });
            
            // Verificar se ainda há tentativas disponíveis
            const maxAttempts = job.opts.attempts || 3;
            if (job.attemptsMade < maxAttempts) {
              // Re-throw para que BullMQ faça retry automático
              throw error;
            } else {
              logger.error('❌ Job de feedback esgotou tentativas - marcando como falho', {
                jobId: job.id,
                attemptsMade: job.attemptsMade,
                maxAttempts,
              });
              throw error; // Marcar como falho após esgotar tentativas
            }
          }
          // Outros erros - re-throw normalmente
          throw error;
        }
      },
      {
        connection: this.redisClient,
        concurrency: 1,
        limiter: {
          max: 10,
          duration: 1000,
        },
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1,
        },
      }
    );

    // Eventos da fila
    this.queueEvents = new QueueEvents('feedback-checkin', {
      connection: this.redisClient,
      maxEvents: 100,
    });

    this.setupEventHandlers();
    
    logger.success('✅ FeedbackQueue inicializada com sucesso');
  }

  /**
   * Agenda um job de feedback para 3 minutos após o horário de retirada
   */
  async scheduleFeedbackCheckin(
    conversationId: string,
    tenantId: string,
    storeId: string,
    storeName: string,
    product: string,
    pickupTime: number
  ): Promise<boolean> {
    const jobId = `feedback-${conversationId}-${pickupTime}`;
    const now = Date.now();
    const delay = pickupTime + (3 * 60 * 1000) - now; // 3 minutos após pickup_time
    
    logger.pipeline('⏰ Calculando delay para feedback', {
      conversationId,
      pickupTime,
      pickupTimeISO: new Date(pickupTime).toISOString(),
      now,
      nowISO: new Date(now).toISOString(),
      delay,
      delayMinutes: Math.round(delay / 60000),
    });
    
    if (delay < 0) {
      logger.warning('⚠️ Horário de retirada já passou - não agendando feedback', {
        pickupTime: new Date(pickupTime).toISOString(),
        now: new Date(now).toISOString(),
        delayMinutes: Math.round(delay / 60000),
      });
      return false;
    }
    
    try {
      await Promise.race([
        this.queue.add(
          'checkin',
          {
            conversationId,
            tenantId,
            storeId,
            storeName,
            product,
            pickupTime,
          },
          {
            jobId,
            delay,
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          }
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao agendar feedback')), 10000)
        ),
      ]);

      logger.success('✅ Feedback agendado com sucesso', {
        conversationId,
        storeId,
        jobId,
        scheduledFor: new Date(Date.now() + delay).toISOString(),
        delayMinutes: Math.round(delay / 60000),
        pickupTime: new Date(pickupTime).toISOString(),
      });
      
      return true;
    } catch (error) {
      logger.error('❌ Erro ao agendar feedback', {
        conversationId,
        storeId,
        jobId,
        pickupTime: new Date(pickupTime).toISOString(),
        delay,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Processa job de feedback check-in
   */
  private async handleFeedbackCheckin(data: {
    conversationId: string;
    tenantId: string;
    storeId: string;
    storeName: string;
    product: string;
    pickupTime: number;
  }): Promise<void> {
    const { conversationId, tenantId, storeId, storeName, product } = data;
    
    logger.section('Feedback Check-in', '📞');
    logger.pipeline('Enviando mensagem proativa de feedback', {
      conversationId,
      storeId,
      storeName,
      product,
    });

    try {
      // Buscar conversa para obter userName
      const conversation = await this.deps.messageService.getConversationById(conversationId, tenantId);
      const userName = conversation?.participantName || conversation?.sender?.pushName || undefined;

      // Gerar mensagem de check-in usando Agente Boca
      const checkinMessage = await this.deps.humanizer.humanize({
        executorData: {
          type: 'feedback_checkin',
          store: {
            id: storeId,
            name: storeName,
          },
          product,
        },
        userName,
      });

      // Verificar se WhatsApp está conectado
      const status = this.deps.whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        logger.warning('⚠️ WhatsApp não conectado - mensagem de feedback será retentada', {
          status: status.status,
          conversationId,
        });
        // Lançar erro para que o BullMQ use retry ao invés de marcar como completo
        throw new Error(`WhatsApp offline (status: ${status.status}). Job será retentado automaticamente.`);
      }

      // Normalizar número do cliente
      let clientPhone = conversationId;
      if (clientPhone.includes('@')) {
        clientPhone = clientPhone.split('@')[0];
      }

      // Enviar mensagem
      await this.deps.whatsAppAdapter.sendMessage(clientPhone, checkinMessage);

      logger.success('✅ Mensagem de feedback enviada', {
        conversationId,
        storeName,
      });
    } catch (error) {
      logger.error('❌ Erro ao processar feedback check-in', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
      });
    }
  }

  /**
   * Configura handlers de eventos
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.success('✅ Job de feedback completado', {
        jobId: job.id,
        conversationId: job.data.conversationId,
      });
    });

    this.worker.on('failed', (job, err) => {
      logger.error('❌ Job de feedback falhou', {
        jobId: job?.id,
        conversationId: job?.data?.conversationId,
        error: err.message,
      });
    });

    this.worker.on('error', (error) => {
      logger.error('❌ Erro no Worker de feedback', {
        error: error.message,
        stack: error.stack,
      });
    });
  }

  /**
   * Fecha conexões
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
    await this.redisClient.quit();
  }
}
