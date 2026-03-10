/**
 * BullMQ Queue para Gerenciar Timeout de Verificações com Gerentes
 * 
 * Responsabilidade:
 * - Gerenciar timeout de 20 minutos para verificações com gerentes
 * - Expirar tasks automaticamente se não houver resposta
 * - Notificar cliente quando task expirar
 */
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../../utils/logger';
import type { ConversationTaskService } from '../../conversation-tasks/service';
import type { WhatsAppAdapter } from '../../whatsapp';
import type { StoreService } from '../../stores';

type QueueDependencies = {
  taskService: ConversationTaskService;
  whatsAppAdapter: WhatsAppAdapter;
  storeService: StoreService;
  redisConnection: string | {
    host: string;
    port: number;
    password?: string;
    username?: string;
  };
};

export class ManagerVerificationQueue {
  private queue: Queue;
  private worker: Worker;
  private queueEvents: QueueEvents;
  private redisClient: Redis;

  constructor(private deps: QueueDependencies) {
    // Validar conexão do Redis
    if (!deps.redisConnection) {
      throw new Error('Redis connection is required for ManagerVerificationQueue');
    }

    // Criar instância do Redis (ioredis) explicitamente
    // IMPORTANTE: lazyConnect: true para não conectar imediatamente
    // A conexão será feita quando necessário
    if (typeof deps.redisConnection === 'string') {
      // Usar URL do Redis
      const maskedUrl = deps.redisConnection.replace(/:[^:@]+@/, ':****@');
      logger.pipeline('🔗 Criando cliente Redis com URL', {
        url: maskedUrl,
      });
      
      // Parsear a URL para garantir que está correta
      try {
        this.redisClient = new Redis(deps.redisConnection, {
          maxRetriesPerRequest: null, // BullMQ requer null (obrigatório)
          enableReadyCheck: false, // Desabilitar para evitar timeouts em conexões remotas
          enableOfflineQueue: false, // Não enfileirar comandos quando offline
          lazyConnect: false, // Conectar automaticamente
          showFriendlyErrorStack: true,
          connectTimeout: 30000, // 30 segundos (aumentado para conexões remotas)
          commandTimeout: 30000, // 30 segundos (aumentado para comandos bloqueantes do BullMQ)
          retryStrategy: (times) => {
            if (times > 10) {
              logger.error('❌ Redis: Muitas tentativas de reconexão, parando retry', { times });
              return null; // Parar retry após 10 tentativas
            }
            const delay = Math.min(times * 100, 5000); // Backoff exponencial até 5s
            logger.warning(`⚠️ Redis retry attempt ${times}`, { delay, nextRetryIn: `${delay}ms` });
            return delay;
          },
          // Configurações adicionais para estabilidade
          keepAlive: 30000, // Keep-alive a cada 30s
          family: 4, // Forçar IPv4 (mais estável)
        });
      } catch (error) {
        logger.error('❌ Erro ao criar cliente Redis com URL', {
          error: error instanceof Error ? error.message : String(error),
          url: maskedUrl,
        });
        throw error;
      }
    } else {
      // Usar host/port/password
      logger.pipeline('🔗 Criando cliente Redis com host/port', {
        host: deps.redisConnection.host,
        port: deps.redisConnection.port,
        hasPassword: !!deps.redisConnection.password,
        hasUsername: !!deps.redisConnection.username,
      });
      
      try {
        this.redisClient = new Redis({
          host: deps.redisConnection.host,
          port: deps.redisConnection.port,
          password: deps.redisConnection.password,
          username: deps.redisConnection.username,
          maxRetriesPerRequest: null, // BullMQ requer null (obrigatório)
          enableReadyCheck: false, // Desabilitar para evitar timeouts em conexões remotas
          enableOfflineQueue: false, // Não enfileirar comandos quando offline
          lazyConnect: false, // Conectar automaticamente
          showFriendlyErrorStack: true,
          connectTimeout: 30000, // 30 segundos (aumentado para conexões remotas)
          commandTimeout: 30000, // 30 segundos (aumentado para comandos bloqueantes do BullMQ)
          retryStrategy: (times) => {
            if (times > 10) {
              logger.error('❌ Redis: Muitas tentativas de reconexão, parando retry', { times });
              return null; // Parar retry após 10 tentativas
            }
            const delay = Math.min(times * 100, 5000); // Backoff exponencial até 5s
            logger.warning(`⚠️ Redis retry attempt ${times}`, { delay, nextRetryIn: `${delay}ms` });
            return delay;
          },
          // Configurações adicionais para estabilidade
          keepAlive: 30000, // Keep-alive a cada 30s
          family: 4, // Forçar IPv4 (mais estável)
        });
      } catch (error) {
        logger.error('❌ Erro ao criar cliente Redis com host/port', {
          error: error instanceof Error ? error.message : String(error),
          host: deps.redisConnection.host,
          port: deps.redisConnection.port,
        });
        throw error;
      }
    }

    // Configurar handlers de eventos do Redis
    this.redisClient.on('connect', () => {
      logger.success('✅ Redis conectado');
    });

    this.redisClient.on('ready', () => {
      logger.success('✅ Redis pronto para uso');
    });

    this.redisClient.on('error', (error) => {
      // Não logar erros de timeout repetidamente para evitar spam
      const isTimeout = error.message.includes('timeout') || error.message.includes('timed out');
      if (isTimeout) {
        logger.warning('⚠️ Redis timeout (pode ser temporário)', {
          error: error.message,
          hint: 'Verifique conectividade de rede ou aumente timeouts se persistir',
        });
      } else {
        logger.error('❌ Erro na conexão Redis', {
          error: error.message,
          stack: error.stack,
        });
      }
    });

    this.redisClient.on('close', () => {
      logger.warning('⚠️ Conexão Redis fechada - tentando reconectar...');
    });

    this.redisClient.on('reconnecting', (delay) => {
      logger.warning('🔄 Redis reconectando', { delay: `${delay}ms` });
    });

    // Criar fila usando a instância do Redis
    // Configurações otimizadas para evitar timeouts
    this.queue = new Queue('manager-verification', {
      connection: this.redisClient,
      defaultJobOptions: {
        attempts: 3, // Tentar 3 vezes antes de falhar
        backoff: {
          type: 'exponential',
          delay: 2000, // Começar com 2s, dobrar a cada tentativa
        },
        removeOnComplete: {
          age: 3600, // Remover jobs completos após 1 hora
          count: 1000, // Manter no máximo 1000 jobs completos
        },
        removeOnFail: {
          age: 24 * 3600, // Remover jobs falhos após 24 horas
        },
      },
    });

    // Criar worker para processar jobs expirados
    // Configurações para evitar timeouts e melhorar resiliência
    this.worker = new Worker(
      'manager-verification',
      async (job) => {
        await this.handleExpiredTask(job.data);
      },
      {
        connection: this.redisClient,
        concurrency: 1, // Processar 1 job por vez (evita sobrecarga)
        limiter: {
          max: 10, // Máximo 10 jobs por período
          duration: 1000, // Por segundo
        },
        // Configurações de timeout do worker
        settings: {
          stalledInterval: 30000, // Verificar jobs travados a cada 30s
          maxStalledCount: 1, // Marcar como falho após 1 verificação de travamento
        },
      }
    );

    // Eventos da fila - configurado para evitar timeouts
    this.queueEvents = new QueueEvents('manager-verification', {
      connection: this.redisClient,
      maxEvents: 100, // Limitar eventos em memória
    });

    this.setupEventHandlers();
    
    logger.success('✅ BullMQ Queue inicializada com sucesso');
    
    // Testar conexão após um pequeno delay (para dar tempo do Redis conectar)
    setTimeout(async () => {
      try {
        const pong = await this.redisClient.ping();
        if (pong === 'PONG') {
          logger.success('✅ Redis conectado e respondendo (PONG)');
        } else {
          logger.warning('⚠️ Redis conectado mas resposta inesperada', { pong });
        }
      } catch (error) {
        logger.error('❌ Erro ao testar conexão Redis', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 1000);
  }

  /**
   * Adiciona uma task à fila com timeout de 20 minutos
   * Retorna true se agendada com sucesso, false se houve erro (mas não lança exceção)
   */
  async scheduleTaskExpiration(taskId: string, conversationId: string, tenantId: string): Promise<boolean> {
    const jobId = `task-${taskId}`;
    
    try {
      await Promise.race([
        this.queue.add(
          'expire-task',
          {
            taskId,
            conversationId,
            tenantId,
          },
          {
            jobId,
            delay: 20 * 60 * 1000, // 20 minutos
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3, // Tentar 3 vezes se falhar
            backoff: {
              type: 'exponential',
              delay: 5000, // 5 segundos inicial
            },
          }
        ),
        // Timeout de segurança: se demorar mais de 10s, considerar falha
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao agendar task')), 10000)
        ),
      ]);

      logger.pipeline('⏰ Task agendada para expiração', {
        taskId,
        conversationId,
        expiresIn: '20 minutos',
      });
      
      return true;
    } catch (error) {
      const isTimeout = error instanceof Error && (
        error.message.includes('timeout') || 
        error.message.includes('timed out') ||
        error.message.includes('Timeout ao agendar')
      );
      
      if (isTimeout) {
        logger.error('❌ Timeout ao agendar task no BullMQ', {
          taskId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Redis pode estar lento. Task será criada no banco, mas expiração automática pode não funcionar.',
        });
      } else {
        logger.error('❌ Erro ao agendar task no BullMQ', {
          taskId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      
      // Retornar false mas não lançar exceção - sistema continua funcionando
      // A task será criada no banco mesmo se o agendamento falhar
      return false;
    }
  }

  /**
   * Cancela expiração de uma task (quando gerente responde)
   * Retorna true se cancelada com sucesso, false se houve erro (mas não lança exceção)
   */
  async cancelTaskExpiration(taskId: string): Promise<boolean> {
    const jobId = `task-${taskId}`;
    
    try {
      const job = await Promise.race([
        this.queue.getJob(jobId),
        // Timeout de segurança: 5 segundos
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao buscar job')), 5000)
        ),
      ]);
      
      if (job) {
        await Promise.race([
          job.remove(),
          // Timeout de segurança: 5 segundos
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout ao remover job')), 5000)
          ),
        ]);
        
        logger.pipeline('✅ Expiração cancelada', {
          taskId,
        });
        return true;
      }
      
      return false;
    } catch (error) {
      const isTimeout = error instanceof Error && (
        error.message.includes('timeout') || 
        error.message.includes('timed out') ||
        error.message.includes('Timeout')
      );
      
      if (isTimeout) {
        logger.warning('⚠️ Timeout ao cancelar expiração (não crítico)', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        logger.warning('⚠️ Erro ao cancelar expiração (não crítico)', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
      // Retornar false mas não lançar exceção - não é crítico
      return false;
    }
  }

  /**
   * Processa task expirada
   */
  private async handleExpiredTask(data: { taskId: string; conversationId: string; tenantId: string }): Promise<void> {
    const { taskId, conversationId, tenantId } = data;
    
    logger.section('Task Expirada', '⏰');
    logger.pipeline('Processando task expirada', {
      taskId,
      conversationId,
    });

    try {
      // Buscar task
      const task = await this.deps.taskService.findById(taskId, tenantId);
      
      if (!task) {
        logger.warning('⚠️ Task não encontrada', { taskId });
        return;
      }

      // Verificar se já foi completada
      if (task.status !== 'pending') {
        logger.debug('ℹ️ Task já foi processada', {
          taskId,
          status: task.status,
        });
        return;
      }

      // Marcar como expirada (isso emitirá o evento conversation.task.expired)
      // O handler de conversation.task.expired no pipeline-handlers.ts
      // será responsável por enviar a mensagem ao cliente
      await this.deps.taskService.expireTask(taskId, tenantId);

      logger.success('✅ Task expirada processada', {
        taskId,
        conversationId,
      });
    } catch (error) {
      logger.error('❌ Erro ao processar task expirada', {
        error: error instanceof Error ? error.message : String(error),
        taskId,
      });
    }
  }

  /**
   * Configura handlers de eventos
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.success('✅ Job completado', {
        jobId: job.id,
        taskId: job.data.taskId,
      });
    });

    this.worker.on('failed', (job, err) => {
      const isTimeout = err.message.includes('timeout') || err.message.includes('timed out');
      if (isTimeout) {
        logger.error('❌ Job falhou por timeout', {
          jobId: job?.id,
          taskId: job?.data?.taskId,
          error: err.message,
          hint: 'Redis pode estar lento ou indisponível. Job será retentado automaticamente.',
        });
      } else {
        logger.error('❌ Job falhou', {
          jobId: job?.id,
          taskId: job?.data?.taskId,
          error: err.message,
          stack: err.stack,
        });
      }
    });

    this.worker.on('stalled', (jobId) => {
      logger.warning('⚠️ Job travado detectado', {
        jobId,
        hint: 'Job pode estar sendo processado ou Redis está lento',
      });
    });

    this.worker.on('error', (error) => {
      logger.error('❌ Erro no Worker', {
        error: error.message,
        stack: error.stack,
      });
    });

    // Handlers para QueueEvents
    this.queueEvents.on('error', (error) => {
      const isTimeout = error.message.includes('timeout') || error.message.includes('timed out');
      if (!isTimeout) {
        logger.error('❌ Erro no QueueEvents', {
          error: error.message,
          stack: error.stack,
        });
      }
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
