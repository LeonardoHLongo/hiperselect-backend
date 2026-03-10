import { eventBus } from '../events';
import type {
  WhatsAppConnectionStatus,
  WhatsAppMessageReceivedEvent,
  WhatsAppMessageSentEvent,
  WhatsAppContactUpdatedEvent,
} from './types';

export const emitMessageReceived = (
  payload: WhatsAppMessageReceivedEvent,
  traceId: string
): void => {
  eventBus.emit('whatsapp.message.received', payload, traceId);
};

export const emitMessageSent = (
  payload: WhatsAppMessageSentEvent,
  traceId: string
): void => {
  eventBus.emit('whatsapp.message.sent', payload, traceId);
};

export const emitConnectionStatus = (
  payload: WhatsAppConnectionStatus,
  traceId: string
): void => {
  eventBus.emit('whatsapp.connection.status', payload, traceId);
};

export const emitContactUpdated = (
  payload: WhatsAppContactUpdatedEvent,
  traceId: string
): void => {
  eventBus.emit('whatsapp.contact.updated', payload, traceId);
};

