export { createWhatsAppAdapter, type WhatsAppAdapter } from './adapter';
export type { WhatsAppAdapter as IWhatsAppAdapter } from './adapter';
export { emitConnectionStatus, emitMessageReceived, emitMessageSent, emitContactUpdated } from './events';
export type {
  SenderInfo,
  WhatsAppConnectionStatus,
  WhatsAppMessage,
  WhatsAppMessageReceivedEvent,
  WhatsAppMessageSentEvent,
  WhatsAppContactUpdatedEvent,
} from './types';

