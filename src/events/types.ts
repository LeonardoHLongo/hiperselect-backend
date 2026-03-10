export type EventName =
  | 'whatsapp.message.received'
  | 'whatsapp.message.sent'
  | 'whatsapp.connection.status'
  | 'whatsapp.contact.updated'
  | 'ai.analysis.completed'
  | 'ai.decision.made'
  | 'ai.response.generated'
  | 'ai.response.suggested'
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.state.changed'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.ai.disabled'
  | 'conversation.ai.enabled'
  | 'conversation.response.generated'  // Resposta gerada pelo pipeline
  | 'conversation.response.blocked'     // Resposta bloqueada pelo Safety Gate ou SafeClassifier
  | 'conversation.decision.made'        // Decisão tomada pelo pipeline
  | 'conversation.handoff.requested';   // Handoff solicitado (IA desativada, precisa de humano)

export type EventHandler<T = unknown> = (payload: T) => Promise<void> | void;

export type EventListener = {
  eventName: EventName;
  handler: EventHandler;
};

export type Event<T = unknown> = {
  name: EventName;
  payload: T;
  timestamp: number;
  traceId: string;
};

