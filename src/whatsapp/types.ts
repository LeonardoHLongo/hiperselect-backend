export type SenderInfo = {
  phoneNumber: string;
  jid: string;
  pushName?: string;
  profilePictureUrl?: string;
};

export type WhatsAppMessage = {
  messageId: string;
  conversationId: string;
  text: string;
  timestamp: number;
  sender: SenderInfo;
};

export type MediaInfo = {
  type: 'image' | 'audio' | 'video' | 'document';
  mimetype?: string;
  caption?: string;
  url?: string; // URL para download sob demanda
  mediaId?: string; // ID da mídia no Baileys
};

export type WhatsAppMessageReceivedEvent = {
  messageId: string;
  conversationId: string;
  text: string | null; // Pode ser null se for apenas mídia
  timestamp: number;
  sender: SenderInfo;
  media?: MediaInfo; // Mídia se a mensagem contém áudio, imagem, etc
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'other';
  // Referência para baixar mídia do Baileys
  baileysKey?: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
  };
  // Mensagem completa do Baileys (apenas quando há mídia, para download)
  baileysMessage?: any; // WAMessage completo
};

export type WhatsAppMessageSentEvent = {
  messageId: string;
  to: string;
  content: string;
  timestamp: number;
  conversationId: string;
};

export type WhatsAppConnectionStatus = {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  error?: string;
};

export type WhatsAppContactUpdatedEvent = {
  conversationId: string;
  sender: {
    phoneNumber: string;
    jid: string;
    pushName?: string;
  };
};

