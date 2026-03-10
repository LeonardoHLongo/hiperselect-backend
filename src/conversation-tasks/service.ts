/**
 * Conversation Tasks Service
 * Gerencia atividades pendentes por conversa (ex: verificação com gerente)
 */

import type { IConversationTaskRepository } from './repository';
import type { ConversationTask, CreateConversationTaskInput, UpdateConversationTaskInput } from './types';
import { eventBus } from '../events';
import type { ManagerVerificationQueue } from '../conversation-pipeline/queue/manager-verification-queue';

export class ConversationTaskService {
  private managerQueue?: ManagerVerificationQueue;

  constructor(
    private repository: IConversationTaskRepository,
    managerQueue?: ManagerVerificationQueue
  ) {
    this.managerQueue = managerQueue;
  }

  /**
   * Define a fila BullMQ para gerenciar timeouts
   */
  setManagerQueue(queue: ManagerVerificationQueue): void {
    this.managerQueue = queue;
  }

  async createTask(input: CreateConversationTaskInput): Promise<ConversationTask> {
    // Verificar se já existe task pending para esta conversa (evitar spam)
    const existingTask = await this.repository.findPendingByConversationId(
      input.conversationId,
      input.tenantId
    );

    if (existingTask) {
      console.log('[ConversationTaskService] ⚠️ Task pending already exists for conversation, skipping creation', {
        conversationId: input.conversationId,
        existingTaskId: existingTask.id,
      });
      return existingTask;
    }

    const task = await this.repository.create(input);

    // Agendar expiração via BullMQ (20 minutos)
    if (this.managerQueue) {
      const scheduled = await this.managerQueue.scheduleTaskExpiration(
        task.id,
        task.conversationId,
        task.tenantId
      );
      
      if (scheduled) {
        console.log('[ConversationTaskService] ✅ Task agendada para expiração via BullMQ', {
          taskId: task.id,
          expiresIn: '20 minutos',
        });
      } else {
        console.warn('[ConversationTaskService] ⚠️ Task criada no banco, mas agendamento BullMQ falhou', {
          taskId: task.id,
          hint: 'A task será criada, mas expiração automática pode não funcionar. Sistema continuará funcionando normalmente.',
        });
        // Continuar mesmo se BullMQ falhar - task está no banco
      }
    }

    // Emitir evento de task criada
    eventBus.emit('conversation.task.created', {
      taskId: task.id,
      conversationId: task.conversationId,
      tenantId: task.tenantId,
      requestCode: task.requestCode,
      type: task.type,
    });

    return task;
  }

  async completeTask(taskId: string, resultText: string, tenantId: string): Promise<ConversationTask> {
    const task = await this.repository.update(taskId, { status: 'completed', resultText }, tenantId);

    // Cancelar expiração via BullMQ (gerente respondeu a tempo)
    if (this.managerQueue) {
      const cancelled = await this.managerQueue.cancelTaskExpiration(taskId);
      if (!cancelled) {
        // Não crítico - task já foi completada no banco
        console.warn('[ConversationTaskService] ⚠️ Task completada, mas cancelamento de expiração falhou (não crítico)', {
          taskId,
        });
      }
    }

    // Emitir evento de task completada
    eventBus.emit('conversation.task.completed', {
      taskId: task.id,
      conversationId: task.conversationId,
      tenantId: task.tenantId,
      resultText: task.resultText,
    });

    return task;
  }

  async expireTask(taskId: string, tenantId: string): Promise<ConversationTask> {
    const task = await this.repository.update(taskId, { status: 'expired' }, tenantId);

    // Emitir evento de task expirada
    eventBus.emit('conversation.task.expired', {
      taskId: task.id,
      conversationId: task.conversationId,
      tenantId: task.tenantId,
    });

    return task;
  }

  async findPendingByConversationId(conversationId: string, tenantId: string): Promise<ConversationTask | null> {
    return this.repository.findPendingByConversationId(conversationId, tenantId);
  }

  async findPendingByStoreId(storeId: string, tenantId: string): Promise<ConversationTask[]> {
    return this.repository.findPendingByStoreId(storeId, tenantId);
  }

  async findByRequestCode(requestCode: string, tenantId: string): Promise<ConversationTask | null> {
    return this.repository.findByRequestCode(requestCode, tenantId);
  }

  async findById(taskId: string, tenantId: string): Promise<ConversationTask | null> {
    return this.repository.findById(taskId, tenantId);
  }

  async findExpiredTasks(tenantId: string): Promise<ConversationTask[]> {
    return this.repository.findExpiredTasks(tenantId);
  }
}
