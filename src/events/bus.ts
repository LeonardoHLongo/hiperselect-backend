import type { Event, EventHandler, EventListener, EventName } from './types';

class EventBus {
  private listeners: Map<EventName, EventHandler[]> = new Map();
  private eventHistory: Event[] = [];

  on<T = unknown>(eventName: EventName, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(handler as EventHandler);
    this.listeners.set(eventName, handlers);
  }

  off(eventName: EventName, handler: EventHandler): void {
    const handlers = this.listeners.get(eventName) || [];
    const filtered = handlers.filter((h) => h !== handler);
    if (filtered.length === 0) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.set(eventName, filtered);
    }
  }

  emit<T = unknown>(eventName: EventName, payload: T, traceId: string): void {
    const event: Event<T> = {
      name: eventName,
      payload,
      timestamp: Date.now(),
      traceId,
    };

    // Silenciado: log de eventos emitidos (muito frequente)
    // console.log('\n=== EVENT EMITTED ===');
    // console.log(`[${new Date().toISOString()}] Event: ${eventName}`);
    // console.log(`TraceId: ${traceId}`);
    // console.log('Payload:', JSON.stringify(payload, null, 2));
    // console.log('====================\n');

    this.eventHistory.push(event as Event);

    const handlers = this.listeners.get(eventName) || [];
    
    // Log para eventos críticos (handoff, etc)
    if (eventName === 'conversation.handoff.requested') {
      console.log(`[EventBus] 📢 Emitindo evento handoff.requested - ${handlers.length} handler(s) registrado(s)`);
      if (handlers.length === 0) {
        console.warn('[EventBus] ⚠️  Nenhum handler registrado para conversation.handoff.requested!');
      }
    }
    
    // Log para conversation.response.generated para debug de duplicação
    if (eventName === 'conversation.response.generated') {
      console.log(`[EventBus] 📤 Emitindo evento conversation.response.generated - ${handlers.length} handler(s) registrado(s)`);
      if (handlers.length > 1) {
        console.warn(`[EventBus] ⚠️  MÚLTIPLOS HANDLERS DETECTADOS (${handlers.length}) - pode causar duplicação de mensagens!`);
      }
    }

    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result
            .catch((error) => {
              console.error(`[EventBus] Handler error for ${eventName}:`, error);
              console.error('Stack:', error.stack);
            });
          // Log de "Handler completed" removido - operação rotineira
        }
      } catch (error) {
        console.error(`[EventBus] Handler error for ${eventName}:`, error);
        console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      }
    }
  }

  getHistory(): readonly Event[] {
    return this.eventHistory;
  }

  clearHistory(): void {
    this.eventHistory = [];
  }
}

export const eventBus = new EventBus();

