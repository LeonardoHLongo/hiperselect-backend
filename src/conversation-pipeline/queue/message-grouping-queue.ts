/**
 * BullMQ Queue para Agrupamento de Mensagens (Debounce)
 * 
 * Responsabilidade:
 * - Agrupar mensagens fragmentadas do mesmo usuário
 * - Aguardar 10 segundos de silêncio antes de processar
 * - Evitar processamentos desnecessários de mensagens fragmentadas
 */
import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../../utils/logger';
import type { ConversationOrchestrator } from '../orchestrator/orchestrator';
import type { MessageService } from '../../messages';

type MessageGroupingQueueDependencies = {
  conversationOrchestrator: ConversationOrchestrator;
  messageService: MessageService;
  redisConnection: string | {
    host: string;
    port: number;
    password?: string;
    username?: string;
  };
};

type GroupedMessageData = {
  conversationId: string;
  messageIds: string[]; // IDs das mensagens que foram agrupadas
  accumulatedText: string; // Texto completo acumulado
  firstMessageId: string; // ID da primeira mensagem (usado para processar)
  lastMessageTimestamp: number; // Timestamp da última mensagem
};

const REDIS_KEY_PREFIX = 'msg_group:';
const GROUPING_DELAY_MS = 10000; // 10 segundos

/**
 * Normaliza o conversationId para uso como jobId no BullMQ
 * BullMQ não aceita:
 * - jobId como inteiro
 * - jobId contendo o caractere ':'
 * Então adiciona prefixo seguro se necessário
 */
function normalizeJobId(conversationId: string): string {
  const cleanId = conversationId.replace(/[^a-zA-Z0-9:@._-]/g, '_');
  // Se for apenas números, adicionar prefixo para evitar erro "Custom Id cannot be integers"
  // Usar '-' ao invés de ':' porque BullMQ não aceita ':' no jobId
  return /^\d+$/.test(cleanId) ? `msg_group-${cleanId}` : cleanId.replace(/:/g, '-');
}

export class MessageGroupingQueue {
  private queue: Queue;
  private worker: Worker;
  private queueEvents: QueueEvents;
  private redisClient: Redis;
  private isReady: boolean = false;
  private readyPromise: Promise<void>;
  private isReady: boolean = false;
  private readyPromise: Promise<void>;

  constructor(private deps: MessageGroupingQueueDependencies) {
    logger.section('Inicializando MessageGroupingQueue', '🔧');
    
    // Validar conexão do Redis
    if (!deps.redisConnection) {
      logger.error('❌ Redis connection is required for MessageGroupingQueue');
      throw new Error('Redis connection is required for MessageGroupingQueue');
    }

    logger.debug('📋 Dependências recebidas:', {
      hasOrchestrator: !!deps.conversationOrchestrator,
      hasMessageService: !!deps.messageService,
      hasRedisConnection: !!deps.redisConnection,
      redisConnectionType: typeof deps.redisConnection,
    });

    // Criar instância do Redis
    if (typeof deps.redisConnection === 'string') {
      const maskedUrl = deps.redisConnection.replace(/:[^:@]+@/, ':****@');
      logger.pipeline('🔗 Criando cliente Redis para MessageGroupingQueue (URL)', {
        url: maskedUrl,
        urlLength: deps.redisConnection.length,
      });
      
      this.redisClient = new Redis(deps.redisConnection, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error('❌ Redis: Muitas tentativas de reconexão, parando retry', { times });
            return null;
          }
          const delay = Math.min(times * 100, 5000);
          logger.warning(`⚠️ Redis retry attempt ${times}`, { delay });
          return delay;
        },
      });
    } else {
      logger.pipeline('🔗 Criando cliente Redis para MessageGroupingQueue (host/port)', {
        host: deps.redisConnection.host,
        port: deps.redisConnection.port,
        hasPassword: !!deps.redisConnection.password,
        hasUsername: !!deps.redisConnection.username,
      });
      
      this.redisClient = new Redis({
        host: deps.redisConnection.host,
        port: deps.redisConnection.port,
        password: deps.redisConnection.password,
        username: deps.redisConnection.username,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false, // Conectar imediatamente
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error('❌ Redis: Muitas tentativas de reconexão, parando retry', { times });
            return null;
          }
          const delay = Math.min(times * 100, 5000);
          logger.warning(`⚠️ Redis retry attempt ${times}`, { delay });
          return delay;
        },
      });
    }

    // Criar Promise para aguardar Redis estar pronto
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis não ficou pronto após 30 segundos'));
      }, 30000);

      const onReady = () => {
        clearTimeout(timeout);
        this.isReady = true;
        this.redisClient.removeListener('ready', onReady);
        this.redisClient.removeListener('error', onError);
        logger.success('✅ Redis pronto para MessageGroupingQueue', {
          status: this.redisClient.status,
        });
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        this.redisClient.removeListener('ready', onReady);
        this.redisClient.removeListener('error', onError);
        logger.error('❌ Erro na conexão Redis (MessageGroupingQueue)', {
          error: error.message,
          stack: error.stack,
          status: this.redisClient.status,
        });
        reject(error);
      };

      // Se já estiver pronto, resolver imediatamente
      if (this.redisClient.status === 'ready') {
        clearTimeout(timeout);
        this.isReady = true;
        resolve();
      } else {
        this.redisClient.once('ready', onReady);
        this.redisClient.once('error', onError);
      }
    });

    // Configurar handlers de conexão Redis
    this.redisClient.on('connect', () => {
      logger.debug('🔗 Redis conectado para MessageGroupingQueue', {
        status: this.redisClient.status,
      });
    });

    this.redisClient.on('error', (error) => {
      logger.error('❌ Erro na conexão Redis (MessageGroupingQueue)', {
        error: error.message,
        stack: error.stack,
        status: this.redisClient.status,
      });
    });

    this.redisClient.on('close', () => {
      logger.warning('⚠️ Conexão Redis fechada (MessageGroupingQueue)', {
        status: this.redisClient.status,
      });
      this.isReady = false;
    });

    this.redisClient.on('end', () => {
      logger.warning('⚠️ Conexão Redis encerrada (MessageGroupingQueue)', {
        status: this.redisClient.status,
      });
      this.isReady = false;
    });

    logger.debug('📊 Estado inicial do Redis:', {
      status: this.redisClient.status,
      isOpen: this.redisClient.status === 'ready' || this.redisClient.status === 'connect',
    });

    // Criar fila BullMQ (não precisa esperar Redis estar pronto, BullMQ gerencia isso)
    logger.debug('📦 Criando fila BullMQ "message-grouping"...');
    try {
          this.queue = new Queue('message-grouping', {
            connection: this.redisClient,
            defaultJobOptions: {
              removeOnComplete: true, // Remover imediatamente após completar (libera jobId)
              removeOnFail: true, // Remover imediatamente após falhar (libera jobId)
              attempts: 1, // Não retentar - se falhar, processar imediatamente
            },
          });
      logger.success('✅ Fila BullMQ criada com sucesso', {
        queueName: 'message-grouping',
        redisStatus: this.redisClient.status,
      });
    } catch (error) {
      logger.error('❌ Erro ao criar fila BullMQ', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        redisStatus: this.redisClient.status,
      });
      // Não lançar erro - permitir que o sistema continue sem agrupamento
      logger.warning('⚠️ MessageGroupingQueue será desabilitada - mensagens serão processadas imediatamente');
      this.queue = null as any; // Marcar como null para indicar que não está disponível
    }

    // Criar worker APENAS após Redis estar pronto
    this.readyPromise
      .then(() => {
        if (!this.queue) {
          logger.warning('⚠️ Fila não está disponível - worker não será criado');
          return;
        }
        
        logger.debug('👷 Criando worker BullMQ...', {
          redisStatus: this.redisClient.status,
          isReady: this.isReady,
        });
        
        try {
          this.worker = new Worker(
            'message-grouping',
            async (job: Job<GroupedMessageData>) => {
              return this.handleGroupedMessage(job.data);
            },
            {
              connection: this.redisClient,
              concurrency: 5, // Processar até 5 mensagens agrupadas simultaneamente
            }
          );
          
          logger.success('✅ Worker BullMQ criado com sucesso', {
            queueName: 'message-grouping',
            concurrency: 5,
            workerInstance: !!this.worker,
          });
        } catch (error) {
          logger.error('❌ Erro ao criar worker BullMQ', {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            stack: error instanceof Error ? error.stack : undefined,
            redisStatus: this.redisClient.status,
            isReady: this.isReady,
          });
          // Não lançar erro - permitir que o sistema continue sem agrupamento
          logger.warning('⚠️ Worker BullMQ não será criado - MessageGroupingQueue será desabilitada');
          this.worker = null as any; // Marcar como null
        }
      })
      .catch((error) => {
        logger.error('❌ Redis não ficou pronto - Worker não será criado', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.worker = null as any;
      });

    // Configurar eventos do worker (apenas se worker foi criado)
    this.readyPromise
      .then(() => {
        if (this.worker) {
          this.worker.on('completed', (job) => {
            logger.success('✅ Mensagem agrupada processada com sucesso', {
              conversationId: job.data.conversationId,
              messageCount: job.data.messageIds.length,
            });
          });

          this.worker.on('failed', (job, error) => {
            logger.error('❌ Erro ao processar mensagem agrupada', {
              conversationId: job?.data?.conversationId,
              error: error.message,
            });
          });
        }
      })
      .catch(() => {
        // Worker não foi criado, não configurar eventos
      });

    // Criar QueueEvents para monitoramento
    logger.debug('📡 Criando QueueEvents...');
    try {
      this.queueEvents = new QueueEvents('message-grouping', {
        connection: this.redisClient,
      });
      logger.success('✅ QueueEvents criado com sucesso');
    } catch (error) {
      logger.error('❌ Erro ao criar QueueEvents', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Não bloquear inicialização se QueueEvents falhar
    }

    // Verificar se inicialização foi bem-sucedida
    if (!this.queue) {
      logger.warning('⚠️ MessageGroupingQueue inicializada mas fila não está disponível', {
        redisStatus: this.redisClient.status,
        hasWorker: !!this.worker,
        hasQueueEvents: !!this.queueEvents,
      });
    } else {
      logger.success('✅ MessageGroupingQueue inicializada com sucesso', {
        redisStatus: this.redisClient.status,
        queueName: 'message-grouping',
        hasWorker: !!this.worker,
        hasQueueEvents: !!this.queueEvents,
      });
    }
  }

  /**
   * Aguarda Redis estar pronto (para uso no bootstrap)
   */
  async waitForReady(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Adiciona uma mensagem ao grupo de agrupamento
   * Se já existe um job ativo, adiciona o texto e reseta o delay
   * Se não existe, cria um novo job com delay de 10 segundos
   */
  async addMessage(
    conversationId: string,
    messageId: string,
    text: string | null,
    timestamp: number
  ): Promise<void> {
    // Verificar se a fila está disponível antes de tentar usar
    if (!this.queue) {
      logger.debug('ℹ️ MessageGroupingQueue não está disponível - mensagem será processada imediatamente', {
        messageId,
        conversationId,
      });
      return; // Retornar silenciosamente - o handler de eventos processará imediatamente
    }

    logger.section('Adicionando Mensagem ao Grupo', '📦');
    logger.debug('📥 Parâmetros recebidos:', {
      conversationId,
      messageId,
      textLength: text?.length || 0,
      hasText: !!text,
      timestamp,
      timestampDate: new Date(timestamp).toISOString(),
    });

    // Mensagens sem texto (mídia) também podem ser agrupadas
    // O texto será processado pelo Orchestrator antes do agrupamento
    // Por enquanto, usar string vazia como placeholder
    const textToGroup = text || '';

    const redisKey = `${REDIS_KEY_PREFIX}${conversationId}`;
    logger.debug('🔑 Redis key gerada:', { redisKey });
    
    // Verificar estado do Redis
    logger.debug('🔍 Verificando estado do Redis...', {
      status: this.redisClient.status,
      isReady: this.redisClient.status === 'ready',
    });

    // Verificar se Redis está conectado e pronto
    if (this.redisClient.status !== 'ready') {
      logger.warning('⚠️ Redis não está pronto, aguardando conexão...', {
        status: this.redisClient.status,
      });
      
      // Aguardar até 5 segundos para Redis ficar pronto
      const maxWait = 5000;
      const startTime = Date.now();
      
      while (this.redisClient.status !== 'ready' && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Aguardar 100ms
        logger.debug('⏳ Aguardando Redis ficar pronto...', {
          elapsed: Date.now() - startTime,
          status: this.redisClient.status,
        });
      }
      
      if (this.redisClient.status !== 'ready') {
        logger.error('❌ Redis não ficou pronto a tempo - retornando silenciosamente', {
          status: this.redisClient.status,
          elapsed: Date.now() - startTime,
        });
        return; // Retornar silenciosamente - o handler processará imediatamente
      }
      
      logger.success('✅ Redis ficou pronto após aguardar', {
        elapsed: Date.now() - startTime,
      });
    }

    // Verificar se a fila está disponível (já verificado no início, mas verificar novamente)
    logger.debug('🔍 Verificando se fila está disponível...', {
      hasQueue: !!this.queue,
      queueName: this.queue?.name,
    });

    if (!this.queue) {
      logger.warning('⚠️ Fila BullMQ não está inicializada - retornando silenciosamente', {
        hasQueue: false,
      });
      return; // Retornar silenciosamente - o handler processará imediatamente
    }
    
    try {
      // Verificar se já existe um job ativo para esta conversa
      // Normalizar jobId (BullMQ não aceita inteiros)
      const cleanConversationIdForLookup = conversationId.replace(/[^a-zA-Z0-9:@._-]/g, '_');
      const jobIdForLookup = String(normalizeJobId(cleanConversationIdForLookup)); // Garantir que seja string
      logger.debug('🔍 Buscando job existente...', { 
        conversationId,
        cleanConversationId: cleanConversationIdForLookup,
        jobId: jobIdForLookup,
      });
      let existingJob: Job<GroupedMessageData> | undefined;
      try {
        existingJob = await this.queue.getJob(jobIdForLookup);
        logger.debug('📋 Resultado da busca de job:', {
          found: !!existingJob,
          jobId: existingJob?.id,
          jobName: existingJob?.name,
        });
      } catch (jobError) {
        // Se getJob falhar, assumir que não há job existente
        logger.debug('ℹ️ Erro ao buscar job existente (assumindo que não existe)', {
          conversationId,
          error: jobError instanceof Error ? jobError.message : String(jobError),
          stack: jobError instanceof Error ? jobError.stack : undefined,
          errorName: jobError instanceof Error ? jobError.name : undefined,
        });
        existingJob = undefined;
      }
      
      if (existingJob) {
        // Job já existe - adicionar mensagem ao grupo e resetar delay
        logger.debug('🔄 Job existente encontrado - adicionando mensagem ao grupo', {
          conversationId,
          messageId,
          existingJobId: existingJob.id,
        });

        // Verificar estado do job
        try {
          const jobState = await existingJob.getState();
          logger.debug('📊 Estado do job existente:', {
            jobId: existingJob.id,
            state: jobState,
          });
        } catch (stateError) {
          logger.warning('⚠️ Erro ao verificar estado do job', {
            error: stateError instanceof Error ? stateError.message : String(stateError),
          });
        }

        // Buscar dados atuais do Redis
        logger.debug('🔍 Buscando dados existentes no Redis...', { redisKey });
        let existingData: string | null = null;
        try {
          existingData = await this.redisClient.get(redisKey);
          logger.debug('📦 Dados do Redis:', {
            found: !!existingData,
            dataLength: existingData?.length || 0,
          });
        } catch (redisError) {
          logger.error('❌ Erro ao buscar dados do Redis', {
            error: redisError instanceof Error ? redisError.message : String(redisError),
            stack: redisError instanceof Error ? redisError.stack : undefined,
          });
          throw redisError;
        }

        let groupedData: GroupedMessageData;

        if (existingData) {
          logger.debug('📝 Parseando dados existentes do Redis...');
          try {
            groupedData = JSON.parse(existingData);
            logger.debug('✅ Dados parseados:', {
              messageCount: groupedData.messageIds?.length || 0,
              textLength: groupedData.accumulatedText?.length || 0,
            });
            
            groupedData.messageIds.push(messageId);
            groupedData.accumulatedText += ` ${textToGroup}`;
            groupedData.lastMessageTimestamp = timestamp;
            
            logger.debug('📝 Dados atualizados:', {
              newMessageCount: groupedData.messageIds.length,
              newTextLength: groupedData.accumulatedText.length,
            });
          } catch (parseError) {
            logger.error('❌ Erro ao parsear dados do Redis', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              data: existingData.substring(0, 100),
            });
            // Criar novo se parse falhar
            groupedData = {
              conversationId,
              messageIds: [messageId],
              accumulatedText: textToGroup,
              firstMessageId: messageId,
              lastMessageTimestamp: timestamp,
            };
          }
        } else {
          // Dados não encontrados no Redis, criar novo
          logger.debug('📝 Criando novos dados (não encontrados no Redis)');
          groupedData = {
            conversationId,
            messageIds: [messageId],
            accumulatedText: textToGroup,
            firstMessageId: messageId,
            lastMessageTimestamp: timestamp,
          };
        }

        // Atualizar dados no Redis
        // TTL deve ser maior que o delay do BullMQ (10s) + margem de segurança
        // Usar 60 segundos (6x o delay) para garantir que os dados não expirem antes do job processar
        const redisTtl = 60; // 60 segundos (maior que GROUPING_DELAY_MS de 10s)
        logger.debug('💾 Salvando dados no Redis...', {
          redisKey,
          ttl: redisTtl,
          dataSize: JSON.stringify(groupedData).length,
          delayMs: GROUPING_DELAY_MS,
          note: 'TTL maior que delay para evitar perda de dados',
        });
        try {
          await this.redisClient.setex(
            redisKey,
            redisTtl, // Expirar em 60 segundos (maior que o delay de 10s)
            JSON.stringify(groupedData)
          );
          logger.debug('✅ Dados salvos no Redis com sucesso');
        } catch (redisError) {
          logger.error('❌ Erro ao salvar dados no Redis', {
            error: redisError instanceof Error ? redisError.message : String(redisError),
            stack: redisError instanceof Error ? redisError.stack : undefined,
          });
          throw redisError;
        }

        // REMOVER SEMPRE - independente do status (completed, failed, active, delayed)
        // Isso garante que o jobId fique livre para criar um novo job
        logger.debug('🗑️ Removendo job existente (forçado) para liberar jobId...', {
          jobId: existingJob.id,
        });
        try {
          const jobState = await existingJob.getState();
          logger.debug('📊 Estado do job antes de remover:', {
            jobId: existingJob.id,
            state: jobState,
          });
          await existingJob.remove();
          logger.debug('✅ Job existente removido com sucesso', {
            jobId: existingJob.id,
            previousState: jobState,
          });
        } catch (removeError) {
          logger.warning('⚠️ Erro ao remover job existente (continuando mesmo assim)', {
            error: removeError instanceof Error ? removeError.message : String(removeError),
            jobId: existingJob.id,
          });
        }
        
        // Criar novo job com delay resetado
        // Normalizar jobId (BullMQ não aceita inteiros)
        const cleanConversationIdForExisting = conversationId.replace(/[^a-zA-Z0-9:@._-]/g, '_');
        const jobIdForExisting = String(normalizeJobId(cleanConversationIdForExisting)); // Garantir que seja string
        logger.debug('➕ Criando novo job com delay resetado...', {
          conversationId,
          jobId: jobIdForExisting,
          delay: GROUPING_DELAY_MS,
          messageCount: groupedData.messageIds.length,
        });
        try {
          const newJob = await this.queue.add(
            cleanConversationIdForExisting, // Nome do job
            groupedData,
            {
              jobId: jobIdForExisting, // Usar jobId normalizado (não pode ser inteiro)
              delay: GROUPING_DELAY_MS,
              removeOnComplete: true, // Remover imediatamente após completar (libera jobId)
              removeOnFail: true, // Remover imediatamente após falhar (libera jobId)
            }
          );
          logger.debug('✅ Novo job criado com sucesso', {
            jobId: newJob.id,
            jobName: newJob.name,
          });
        } catch (addError) {
          logger.error('❌ Erro ao criar novo job', {
            error: addError instanceof Error ? addError.message : String(addError),
            stack: addError instanceof Error ? addError.stack : undefined,
          });
          throw addError;
        }

        logger.debug('✅ Mensagem adicionada ao grupo - delay resetado', {
          conversationId,
          messageCount: groupedData.messageIds.length,
          accumulatedLength: groupedData.accumulatedText.length,
        });
      } else {
        // Não existe job - criar novo
        logger.debug('🆕 Nenhum job existente encontrado - criando novo grupo');
        const groupedData: GroupedMessageData = {
          conversationId,
          messageIds: [messageId],
          accumulatedText: textToGroup,
          firstMessageId: messageId,
          lastMessageTimestamp: timestamp,
        };

        logger.debug('📝 Dados do novo grupo:', {
          conversationId,
          messageIds: groupedData.messageIds,
          textLength: groupedData.accumulatedText.length,
          firstMessageId: groupedData.firstMessageId,
        });

        // Salvar no Redis
        logger.debug('💾 Salvando novo grupo no Redis...', {
          redisKey,
          ttl: 300,
          dataSize: JSON.stringify(groupedData).length,
        });
        try {
          await this.redisClient.setex(
            redisKey,
            300, // Expirar em 5 minutos
            JSON.stringify(groupedData)
          );
          logger.debug('✅ Dados salvos no Redis com sucesso');
        } catch (redisError) {
          logger.error('❌ Erro ao salvar dados no Redis', {
            error: redisError instanceof Error ? redisError.message : String(redisError),
            stack: redisError instanceof Error ? redisError.stack : undefined,
          });
          throw redisError;
        }

        // Criar job com delay
        logger.debug('➕ Criando novo job com delay...', {
          conversationId,
          delay: GROUPING_DELAY_MS,
          queueName: this.queue.name,
          redisStatus: this.redisClient.status,
          groupedDataKeys: Object.keys(groupedData),
          groupedDataSize: JSON.stringify(groupedData).length,
        });
        
        // Validar dados antes de adicionar
        try {
          const testJson = JSON.stringify(groupedData); // Testar se é serializável
          logger.debug('✅ Dados validados como JSON serializável', {
            jsonLength: testJson.length,
          });
        } catch (jsonError) {
          logger.error('❌ Dados não são serializáveis em JSON', {
            error: jsonError instanceof Error ? jsonError.message : String(jsonError),
            groupedData,
          });
          throw new Error('Dados do grupo não são serializáveis em JSON');
        }
        
        try {
          // Limpar conversationId para evitar caracteres especiais que o Redis possa rejeitar
          const cleanConversationId = conversationId.replace(/[^a-zA-Z0-9:@._-]/g, '_');
          if (cleanConversationId !== conversationId) {
            logger.debug('🧹 ConversationId limpo para uso como chave Redis', {
              original: conversationId,
              cleaned: cleanConversationId,
            });
          }
          
          // Normalizar jobId (BullMQ não aceita inteiros)
          const jobId = String(normalizeJobId(cleanConversationId)); // Garantir que seja string
          if (jobId !== cleanConversationId) {
            logger.debug('🔧 JobId normalizado para evitar erro de inteiro no BullMQ', {
              original: cleanConversationId,
              normalized: jobId,
            });
          }
          
          // Verificar se já existe um job com esse ID e removê-lo (independente do status)
          try {
            const existingJobForNew = await this.queue.getJob(jobId);
            if (existingJobForNew) {
              const existingState = await existingJobForNew.getState();
              logger.debug('🗑️ Removendo job existente antes de criar novo...', {
                jobId: jobId,
                existingState: existingState,
              });
              try {
                await existingJobForNew.remove();
                logger.debug('✅ Job existente removido com sucesso');
              } catch (removeError) {
                logger.warning('⚠️ Erro ao remover job existente (continuando mesmo assim)', {
                  error: removeError instanceof Error ? removeError.message : String(removeError),
                });
              }
            }
          } catch (getJobError) {
            // Job não existe ou erro ao buscar - continuar normalmente
            logger.debug('ℹ️ Nenhum job existente encontrado (ou erro ao buscar)', {
              error: getJobError instanceof Error ? getJobError.message : String(getJobError),
            });
          }
          
          logger.debug('🔧 Chamando queue.add()...', {
            jobId: jobId,
            originalConversationId: conversationId,
            cleanConversationId: cleanConversationId,
            delay: GROUPING_DELAY_MS,
            dataType: typeof groupedData,
            dataKeys: Object.keys(groupedData),
            isQueueReady: this.queue ? 'yes' : 'no',
            queueConnection: this.queue ? 'exists' : 'null',
            redisStatus: this.redisClient.status,
            isRedisReady: this.isReady,
          });
          
          // Verificar se queue está realmente disponível
          if (!this.queue) {
            throw new Error('Queue não está disponível');
          }
          
          // Verificar se Redis está pronto antes de adicionar job
          if (!this.isReady || this.redisClient.status !== 'ready') {
            logger.warning('⚠️ Redis não está pronto ao criar job - aguardando...', {
              status: this.redisClient.status,
              isReady: this.isReady,
            });
            // Aguardar até 2 segundos para Redis ficar pronto
            try {
              await Promise.race([
                this.readyPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 2000)),
              ]);
            } catch (timeoutError) {
              logger.warning('⚠️ Timeout ao aguardar Redis - tentando mesmo assim', {
                error: timeoutError instanceof Error ? timeoutError.message : String(timeoutError),
              });
            }
          }
          
          // Tentar criar o job com tratamento de erro específico
          let newJob;
          try {
            logger.debug('🔧 Tentando criar job no BullMQ...', {
              jobName: cleanConversationId,
              jobId: jobId,
              delay: GROUPING_DELAY_MS,
              dataSize: JSON.stringify(groupedData).length,
            });
            
            newJob = await this.queue.add(
              cleanConversationId, // Nome do job (limpo)
              groupedData,   // Dados do job
              {
                jobId: jobId, // Usar jobId normalizado (não pode ser inteiro)
                delay: GROUPING_DELAY_MS,
                removeOnComplete: true, // Remover imediatamente após completar (libera jobId)
                removeOnFail: true, // Remover imediatamente após falhar (libera jobId)
              }
            );
            
            logger.debug('✅ Job criado com sucesso no BullMQ', {
              jobId: newJob.id,
              jobName: newJob.name,
            });
          } catch (queueAddError: any) {
            // Log EXTREMAMENTE detalhado do erro do BullMQ
            console.error('══════════════════════════════════════════════════════════════════════');
            console.error('❌ ERRO ESPECÍFICO DO queue.add() - DETALHES COMPLETOS');
            console.error('══════════════════════════════════════════════════════════════════════');
            console.error('Mensagem:', queueAddError instanceof Error ? queueAddError.message : String(queueAddError));
            console.error('Nome do Erro:', queueAddError instanceof Error ? queueAddError.name : typeof queueAddError);
            console.error('Tipo:', typeof queueAddError);
            console.error('Constructor:', queueAddError?.constructor?.name);
            
            if (queueAddError instanceof Error) {
              console.error('Stack Trace:');
              console.error(queueAddError.stack);
            }
            
            if (queueAddError && typeof queueAddError === 'object') {
              console.error('Propriedades do Erro:');
              try {
                const keys = Object.keys(queueAddError);
                console.error('Keys:', keys);
                for (const key of keys) {
                  try {
                    const value = queueAddError[key];
                    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                      console.error(`  ${key}:`, value);
                    } else if (value instanceof Error) {
                      console.error(`  ${key}:`, value.message);
                    } else {
                      console.error(`  ${key}:`, typeof value, Array.isArray(value) ? `[${value.length} items]` : '');
                    }
                  } catch (e) {
                    console.error(`  ${key}: [erro ao acessar]`);
                  }
                }
              } catch (e) {
                console.error('Erro ao extrair propriedades:', e);
              }
              
              // Propriedades específicas do Redis/BullMQ
              if ('command' in queueAddError) {
                console.error('Command:', queueAddError.command);
              }
              if ('code' in queueAddError) {
                console.error('Code:', queueAddError.code);
              }
              if ('args' in queueAddError) {
                console.error('Args:', queueAddError.args);
              }
              if ('lastError' in queueAddError) {
                console.error('LastError:', queueAddError.lastError);
              }
              if ('previousErrors' in queueAddError) {
                console.error('PreviousErrors:', queueAddError.previousErrors);
              }
              
              // Tentar serializar o erro completo
              try {
                const errorStr = JSON.stringify(queueAddError, Object.getOwnPropertyNames(queueAddError), 2);
                console.error('Erro Serializado Completo:');
                console.error(errorStr);
              } catch (e) {
                console.error('Não foi possível serializar o erro:', e);
              }
            }
            
            console.error('Contexto:');
            console.error('  jobId:', jobId);
            console.error('  cleanConversationId:', cleanConversationId);
            console.error('  originalConversationId:', conversationId);
            console.error('  queueName:', this.queue.name);
            console.error('  redisStatus:', this.redisClient.status);
            console.error('  isRedisReady:', this.isReady);
            console.error('══════════════════════════════════════════════════════════════════════');
            
            // Também logar usando o logger
            logger.error('❌ Erro específico do queue.add()', {
              error: queueAddError instanceof Error ? queueAddError.message : String(queueAddError),
              errorName: queueAddError instanceof Error ? queueAddError.name : undefined,
              errorType: typeof queueAddError,
              errorKeys: queueAddError && typeof queueAddError === 'object' ? Object.keys(queueAddError) : [],
              command: queueAddError?.command,
              code: queueAddError?.code,
              args: queueAddError?.args,
              lastError: queueAddError?.lastError,
              jobId: jobId,
              cleanConversationId: cleanConversationId,
              originalConversationId: conversationId,
              queueName: this.queue.name,
              redisStatus: this.redisClient.status,
            });
            
            throw queueAddError; // Re-lançar para ser capturado pelo catch externo
          }
          
          logger.debug('✅ Novo job criado com sucesso', {
            jobId: newJob.id,
            jobName: newJob.name,
            jobDataKeys: newJob.data ? Object.keys(newJob.data) : [],
          });
        } catch (addError: any) {
          // Extrair informações detalhadas do erro
          const errorDetails: any = {
            error: addError instanceof Error ? addError.message : String(addError),
            errorName: addError instanceof Error ? addError.name : undefined,
            stack: addError instanceof Error ? addError.stack : undefined,
            conversationId,
            cleanConversationId,
            delay: GROUPING_DELAY_MS,
            queueName: this.queue?.name,
            redisStatus: this.redisClient.status,
            isRedisReady: this.isReady,
            hasQueue: !!this.queue,
            groupedDataStringified: JSON.stringify(groupedData).substring(0, 200),
            errorToString: String(addError),
            errorType: typeof addError,
            errorConstructor: addError?.constructor?.name,
          };
          
          // Adicionar propriedades específicas do erro Redis/BullMQ
          if (addError && typeof addError === 'object') {
            // Tentar capturar todas as propriedades do erro
            try {
              const errorKeys = Object.keys(addError);
              errorDetails.errorKeys = errorKeys;
              
              for (const key of ['command', 'code', 'args', 'lastError', 'previousErrors', 'message', 'name', 'stack']) {
                if (key in addError) {
                  errorDetails[key] = addError[key];
                }
              }
              
              // Tentar serializar o erro completo
              try {
                errorDetails.errorFull = JSON.stringify(addError, Object.getOwnPropertyNames(addError));
              } catch (e) {
                errorDetails.errorFull = 'Não foi possível serializar o erro';
              }
            } catch (e) {
              errorDetails.errorExtractionError = String(e);
            }
          }
          
          logger.error('❌ Erro ao criar novo job - DETALHES COMPLETOS', errorDetails);
          
          // Não lançar o erro - permitir fallback para processamento imediato
          logger.warning('⚠️ Erro ao criar job de agrupamento - mensagem será processada imediatamente');
          return; // Retornar silenciosamente para permitir fallback
        }

        logger.debug('✅ Novo grupo de mensagens criado', {
          conversationId,
          messageId,
          delay: GROUPING_DELAY_MS,
        });
      }
    } catch (error) {
      logger.error('❌ Erro ao adicionar mensagem ao grupo', {
        conversationId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        redisStatus: this.redisClient.status,
        hasQueue: !!this.queue,
        queueName: this.queue?.name,
      });
      throw error;
    }
  }

  /**
   * Processa mensagem agrupada após o período de silêncio
   */
  private async handleGroupedMessage(data: GroupedMessageData): Promise<void> {
    logger.section('Processando Mensagem Agrupada', '📦');
    logger.pipeline('Processando grupo de mensagens', {
      conversationId: data.conversationId,
      messageCount: data.messageIds.length,
      textLength: data.accumulatedText.length,
      firstMessageId: data.firstMessageId,
    });

    try {
      // Limpar cache do Redis
      const redisKey = `${REDIS_KEY_PREFIX}${data.conversationId}`;
      await this.redisClient.del(redisKey);

      // Atualizar o texto da primeira mensagem no banco com o texto acumulado
      // Isso garante que o Orchestrator processe o texto completo
      const firstMessage = await this.deps.messageService.getMessageById(data.firstMessageId);
      if (firstMessage) {
        // Atualizar texto da mensagem no banco
        // Nota: Assumindo que MessageService tem um método para atualizar mensagem
        // Se não tiver, precisaremos criar ou usar outro método
        await this.deps.messageService.updateMessageText(
          data.firstMessageId,
          data.accumulatedText.trim()
        );

        logger.debug('✅ Texto da primeira mensagem atualizado com conteúdo agrupado', {
          messageId: data.firstMessageId,
          originalLength: firstMessage.text?.length || 0,
          newLength: data.accumulatedText.length,
        });
      } else {
        logger.warning('⚠️ Primeira mensagem não encontrada no banco', {
          messageId: data.firstMessageId,
        });
      }

      // Processar mensagem agrupada usando a primeira mensagem como referência
      // O Orchestrator vai processar usando o firstMessageId com o texto completo atualizado
      await this.deps.conversationOrchestrator.processMessage(
        data.firstMessageId,
        data.conversationId
      );

      logger.success('✅ Mensagem agrupada processada com sucesso', {
        conversationId: data.conversationId,
        messageCount: data.messageIds.length,
      });
    } catch (error) {
      logger.error('❌ Erro ao processar mensagem agrupada', {
        conversationId: data.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Verifica se existe um job ativo para uma conversa
   */
  async hasActiveJob(conversationId: string): Promise<boolean> {
    try {
      // BullMQ não aceita jobId como inteiro - usar prefixo se necessário
      const cleanConversationId = conversationId.replace(/[^a-zA-Z0-9:@._-]/g, '_');
      const jobId = /^\d+$/.test(cleanConversationId) 
        ? `msg_group:${cleanConversationId}` 
        : cleanConversationId;
      
      const job = await this.queue.getJob(jobId);
      return job !== null && (await job.getState()) !== 'completed';
    } catch (error) {
      logger.error('❌ Erro ao verificar job ativo', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Limpa recursos
   */
  async close(): Promise<void> {
    logger.pipeline('🔌 Fechando MessageGroupingQueue...');
    
    try {
      if (this.worker) {
        await this.worker.close();
      }
      if (this.queueEvents) {
        await this.queueEvents.close();
      }
      if (this.queue) {
        await this.queue.close();
      }
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      
      logger.success('✅ MessageGroupingQueue fechada');
    } catch (error) {
      logger.error('❌ Erro ao fechar MessageGroupingQueue', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
