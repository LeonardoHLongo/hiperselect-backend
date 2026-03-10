import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import type { WhatsAppAdapter } from '../../whatsapp';

type WhatsAppRoutesDependencies = {
  whatsAppAdapter: WhatsAppAdapter;
};

export const registerWhatsAppRoutes = (
  fastify: FastifyInstance,
  deps: WhatsAppRoutesDependencies
): void => {
  console.log('[Routes] Registering WhatsApp routes...');
  
  fastify.get('/api/whatsapp/status', async (request, reply) => {
    console.log('[API] GET /api/whatsapp/status - Request received');
    try {
      const status = deps.whatsAppAdapter.getConnectionStatus();
      const qrCode = deps.whatsAppAdapter.getQRCode();
      console.log('[API] WhatsApp Status:', JSON.stringify(status, null, 2));
      console.log('[API] QR Code available:', !!qrCode);

      let qrCodeImage: string | null = null;
      if (qrCode) {
        try {
          console.log('[API] Generating QR code image...');
          qrCodeImage = await QRCode.toDataURL(qrCode);
          console.log('[API] QR code image generated successfully');
        } catch (error) {
          console.error('[API] Failed to generate QR code image:', error);
        }
      }

      const response = {
        success: true,
        data: {
          ...status,
          qrCode: qrCodeImage,
        },
      };
      console.log('[API] Returning status response');
      reply.type('application/json');
      return response;
    } catch (error) {
      console.error('[API] Error getting WhatsApp status:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to get WhatsApp status',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.get('/api/whatsapp/qr', async (request, reply) => {
    console.log('[API] GET /api/whatsapp/qr - Request received');
    try {
      const qrCode = deps.whatsAppAdapter.getQRCode();
      console.log('[API] QR Code available:', !!qrCode);

      let qrCodeImage: string | null = null;
      if (qrCode) {
        try {
          console.log('[API] Generating QR code image...');
          qrCodeImage = await QRCode.toDataURL(qrCode);
          console.log('[API] QR code image generated successfully');
        } catch (error) {
          console.error('[API] Failed to generate QR code image:', error);
        }
      }

      reply.type('application/json');
      return {
        success: true,
        data: {
          qrCode: qrCodeImage,
        },
      };
    } catch (error) {
      console.error('[API] Error getting QR code:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to get QR code',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.post('/api/whatsapp/connect', async (request, reply) => {
    console.log('[API] POST /api/whatsapp/connect - Request received');
    try {
      console.log('[API] Initiating WhatsApp connection...');
      await deps.whatsAppAdapter.connect();
      console.log('[API] WhatsApp connection initiated successfully');
      reply.type('application/json');
      return {
        success: true,
        message: 'WhatsApp connection initiated',
      };
    } catch (error) {
      console.error('[API] Error connecting WhatsApp:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to connect WhatsApp',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.post('/api/whatsapp/disconnect', async (request, reply) => {
    console.log('[API] POST /api/whatsapp/disconnect - Request received');
    try {
      console.log('[API] Disconnecting WhatsApp and clearing session...');
      // Desconectar e limpar sessão completamente
      deps.whatsAppAdapter.disconnectAndClearSession();
      console.log('[API] WhatsApp disconnected and session cleared successfully');
      reply.type('application/json');
      return {
        success: true,
        message: 'WhatsApp desconectado e sessão limpa. Próxima conexão exigirá novo QR code.',
      };
    } catch (error) {
      console.error('[API] Error disconnecting WhatsApp:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to disconnect WhatsApp',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.post('/api/whatsapp/reconnect', async (request, reply) => {
    console.log('[API] POST /api/whatsapp/reconnect - Request received');
    try {
      console.log('[API] Reconnecting WhatsApp...');
      await deps.whatsAppAdapter.reconnect();
      console.log('[API] WhatsApp reconnection initiated successfully');
      reply.type('application/json');
      return {
        success: true,
        message: 'WhatsApp reconnection initiated',
      };
    } catch (error) {
      console.error('[API] Error reconnecting WhatsApp:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to reconnect WhatsApp',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
  
  console.log('[Routes] WhatsApp routes registered successfully');
  console.log('[Routes] Available routes:');
  console.log('  - GET /api/whatsapp/status');
  console.log('  - GET /api/whatsapp/qr');
  console.log('  - POST /api/whatsapp/connect');
  console.log('  - POST /api/whatsapp/disconnect');
  console.log('  - POST /api/whatsapp/reconnect');
};
