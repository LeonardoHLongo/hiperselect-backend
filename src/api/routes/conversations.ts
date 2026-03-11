import type { FastifyInstance } from 'fastify';
import type { MessageService } from '../../messages';
import type { WhatsAppAdapter } from '../../whatsapp';
import type { NotificationService } from '../../notifications/service';
import type { ConversationState } from '../../messages/types';
import { z } from 'zod';

type ConversationRoutesDependencies = {
  messageService: MessageService;
  whatsAppAdapter: WhatsAppAdapter;
  notificationService?: NotificationService;
};

export const registerConversationRoutes = (
  fastify: FastifyInstance,
  messageService: MessageService,
  whatsAppAdapter: WhatsAppAdapter,
  notificationService?: NotificationService
): void => {
  console.log('[Routes] Registering conversation routes...');
  
  const deps: ConversationRoutesDependencies = {
    messageService,
    whatsAppAdapter,
    notificationService,
  };
  
  fastify.get('/api/v1/conversations', async (request, reply) => {
    // Log removido - request não essencial
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      let conversations = await messageService.getConversations(tenantId);
      
      // Garantir que sempre retorne um array
      let conversationsArray = Array.isArray(conversations) ? conversations : [];
      
      // Buscar fotos de perfil sob demanda para conversas que não têm foto
      // Agrupar por JID para evitar múltiplas buscas do mesmo contato
      const jidsToFetch = new Set<string>();
      conversationsArray.forEach(conv => {
        if (!conv.sender.profilePictureUrl && conv.sender.jid && 
            conv.sender.phoneNumber !== 'system' && 
            !conv.sender.jid.includes('system')) {
          jidsToFetch.add(conv.sender.jid);
        }
      });
      
      // Buscar fotos em paralelo
      const profilePics = new Map<string, string | undefined>();
      await Promise.all(
        Array.from(jidsToFetch).map(async (jid) => {
          try {
            const pic = await deps.whatsAppAdapter.getProfilePictureUrl(jid);
            profilePics.set(jid, pic);
          } catch (error) {
            // Foto não disponível - ignorar (é normal não ter foto)
            profilePics.set(jid, undefined);
          }
        })
      );
      
      // Atualizar conversas com fotos encontradas
      conversationsArray = conversationsArray.map(conv => {
        if (!conv.sender.profilePictureUrl && conv.sender.jid) {
          const pic = profilePics.get(conv.sender.jid);
          if (pic) {
            return {
              ...conv,
              sender: {
                ...conv.sender,
                profilePictureUrl: pic,
              },
            };
          }
        }
        return conv;
      });
      
      // Logs removidos - request não essencial
      
      reply.type('application/json');
      return {
        success: true,
        data: conversationsArray,
      };
    } catch (error) {
      console.error('[API] Error fetching conversations:', error);
      reply.type('application/json');
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch conversations',
        errorCode: 'INTERNAL_ERROR',
        data: [], // Garantir que data seja sempre um array
      });
    }
  });

  // GET /api/v1/conversations/batch - Buscar múltiplas conversas por IDs (otimização para evitar N+1)
  fastify.post('/api/v1/conversations/batch', async (request, reply) => {
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      const body = request.body as { ids?: string[] };
      if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'ids array is required',
          errorCode: 'INVALID_INPUT',
        });
      }

      // Limitar a 100 conversas por request para evitar queries muito grandes
      const conversationIds = body.ids.slice(0, 100);
      const conversations = await messageService.getConversationsByIds(conversationIds, tenantId);

      // Não buscar fotos de perfil aqui - deixar o frontend fazer sob demanda se necessário
      // Isso acelera muito a resposta

      return {
        success: true,
        data: conversations,
      };
    } catch (error) {
      console.error('[API] Error fetching conversations batch:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch conversations',
        errorCode: 'INTERNAL_ERROR',
        data: [],
      });
    }
  });

  fastify.get('/api/v1/conversations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      let conversation = await messageService.getConversationById(id, tenantId);

      if (!conversation) {
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      // Buscar foto sob demanda se não tiver (apenas para JIDs válidos, não para "system")
      if (!conversation.sender.profilePictureUrl && conversation.sender.jid) {
        // Não tentar buscar foto para JIDs especiais como "system"
        const isSpecialJid = conversation.sender.jid.includes('system') || 
                             conversation.sender.phoneNumber === 'system';
        
        if (!isSpecialJid) {
          try {
            const profilePic = await deps.whatsAppAdapter.getProfilePictureUrl(conversation.sender.jid);
            if (profilePic) {
              // Atualizar conversa com foto
              conversation = {
                ...conversation,
                sender: {
                  ...conversation.sender,
                  profilePictureUrl: profilePic,
                },
              };
            }
          } catch (error) {
            // Foto não disponível - ignorar (é normal não ter foto)
            // Log removido - não é erro, é operação normal
          }
        }
      }

      return {
        success: true,
        data: conversation,
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch conversation',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  fastify.get('/api/v1/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId;
    if (!tenantId) {
      return reply.code(401).send({
        success: false,
        message: 'TenantId is required',
        errorCode: 'UNAUTHORIZED',
      });
    }
    // Log removido - request não essencial
    reply.type('application/json');
    try {
      // Buscar mensagens
      let messages = await messageService.getMessagesByConversationId(id, tenantId);
      // Log removido - request não essencial
      
      // Buscar foto de perfil sob demanda para mensagens que não têm foto
      // Agrupar por JID para evitar múltiplas buscas do mesmo contato
      const jidsToFetch = new Set<string>();
      messages.forEach(msg => {
        if (!msg.sender.profilePictureUrl && msg.sender.jid && 
            msg.sender.phoneNumber !== 'system' && 
            !msg.sender.jid.includes('system')) {
          jidsToFetch.add(msg.sender.jid);
        }
      });
      
      // Buscar fotos em paralelo
      const profilePics = new Map<string, string | undefined>();
      await Promise.all(
        Array.from(jidsToFetch).map(async (jid) => {
          try {
            const pic = await deps.whatsAppAdapter.getProfilePictureUrl(jid);
            profilePics.set(jid, pic);
          } catch (error) {
            // Foto não disponível - ignorar (é normal não ter foto)
            profilePics.set(jid, undefined);
          }
        })
      );
      
      // Atualizar mensagens com fotos encontradas e garantir formato correto para frontend
      messages = messages.map(msg => {
        const updatedMsg: any = {
          ...msg,
          // Garantir que agent_id e agent_name estejam no formato snake_case para o frontend
          agent_id: msg.agentId || null,
          agent_name: msg.agentName || null,
        };
        
        // Remover campos camelCase se existirem (para evitar duplicação)
        delete updatedMsg.agentId;
        delete updatedMsg.agentName;
        
        if (!msg.sender.profilePictureUrl && msg.sender.jid) {
          const pic = profilePics.get(msg.sender.jid);
          if (pic) {
            updatedMsg.sender = {
              ...msg.sender,
              profilePictureUrl: pic,
            };
          }
        }
        return updatedMsg;
      });
      
      // REGRA: Ao abrir conversa, marcar como lida (zerar unread_count)
      await messageService.markConversationAsRead(id, tenantId);
      // Log removido - request não essencial
      
      return {
        success: true,
        data: messages,
      };
    } catch (error) {
      console.error(`[API] Error fetching messages for conversation ${id}:`, error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch messages',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Endpoint para baixar mídia de mensagem sob demanda
  fastify.get('/api/v1/conversations/:id/messages/:messageId/media', async (request, reply) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    // Log removido - request não essencial
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const message = await messageService.getMessageById(messageId, tenantId);
      
      if (!message || message.conversationId !== id) {
        return reply.code(404).send({
          success: false,
          message: 'Message not found',
          errorCode: 'NOT_FOUND',
        });
      }

      if (!message.media) {
        return reply.code(404).send({
          success: false,
          message: 'Message has no media',
          errorCode: 'NO_MEDIA',
        });
      }

      if (!message.baileysMessage) {
        return reply.code(400).send({
          success: false,
          message: 'Message reference not available for media download',
          errorCode: 'NO_REFERENCE',
        });
      }

      // Baixar mídia usando Baileys
      console.log(`[API] Downloading media for message ${messageId}...`);
      const mediaBuffer = await deps.whatsAppAdapter.downloadMessageMedia(message.baileysMessage);

      if (!mediaBuffer) {
        return reply.code(500).send({
          success: false,
          message: 'Failed to download media',
          errorCode: 'DOWNLOAD_FAILED',
        });
      }

      // Determinar content-type baseado no tipo de mídia
      const contentType = message.media.mimetype || 
        (message.media.type === 'audio' ? 'audio/ogg; codecs=opus' :
         message.media.type === 'image' ? 'image/jpeg' :
         message.media.type === 'video' ? 'video/mp4' :
         'application/octet-stream');

      console.log(`[API] ✅ Media downloaded: ${mediaBuffer.length} bytes, type: ${contentType}`);

      // Retornar mídia como resposta binária
      reply.type(contentType);
      reply.header('Content-Length', mediaBuffer.length.toString());
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(mediaBuffer);
    } catch (error) {
      console.error(`[API] Error downloading media for message ${messageId}:`, error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to download media',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Endpoint para enviar mensagem
  fastify.post('/api/v1/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    console.log(`[API] POST /api/v1/conversations/${id}/messages - Request received`);
    
    try {
      const body = request.body as { text?: string; agent_id?: string; agent_name?: string };
      
      console.log(`[API] 📥 Request body recebido:`, JSON.stringify(body, null, 2));
      console.log(`[API] 📥 Request userId (middleware):`, request.userId);
      console.log(`[API] 📥 Request userRole (middleware):`, request.userRole);
      
      if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'Message text is required',
          errorCode: 'INVALID_INPUT',
        });
      }

      // Obter informações do agente que está enviando a mensagem
      const agentId = request.userId || body.agent_id || null;
      const agentName = body.agent_name || null;
      
      console.log(`[API] 🔍 Agent info extraído:`, {
        agentId,
        agentName,
        source: {
          fromBody: body.agent_id || body.agent_name ? 'body' : null,
          fromRequest: request.userId ? 'request.userId' : null,
        },
      });

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se a conversa existe
      console.log(`[API] Fetching conversation: ${id}`);
      const conversation = await messageService.getConversationById(id, tenantId);
      
      if (!conversation) {
        console.error(`[API] ❌ Conversation not found: ${id}`);
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      console.log(`[API] Conversation found:`, JSON.stringify({
        conversationId: conversation.conversationId,
        hasSender: !!conversation.sender,
        senderJid: conversation.sender?.jid,
        senderPhone: conversation.sender?.phoneNumber,
      }, null, 2));

      // Verificar se a conversa tem sender válido
      if (!conversation.sender) {
        console.error(`[API] ❌ Conversation ${id} has no sender data`);
        console.error(`[API] Conversation object:`, JSON.stringify(conversation, null, 2));
        return reply.code(500).send({
          success: false,
          message: 'Conversation data is incomplete (missing sender)',
          errorCode: 'INVALID_CONVERSATION',
        });
      }

      // Verificar se o sender tem JID
      if (!conversation.sender.jid) {
        console.error(`[API] ❌ Conversation ${id} sender has no JID`);
        console.error(`[API] Sender object:`, JSON.stringify(conversation.sender, null, 2));
        return reply.code(500).send({
          success: false,
          message: 'Conversation sender JID is missing',
          errorCode: 'INVALID_CONVERSATION',
        });
      }

      // Verificar se WhatsApp está conectado
      const status = deps.whatsAppAdapter.getConnectionStatus();
      if (status.status !== 'connected') {
        return reply.code(400).send({
          success: false,
          message: 'WhatsApp is not connected',
          errorCode: 'NOT_CONNECTED',
        });
      }

      // Enviar mensagem usando o JID da conversa
      const jid = conversation.sender.jid;
      if (!jid) {
        return reply.code(400).send({
          success: false,
          message: 'Conversation JID not available',
          errorCode: 'JID_NOT_AVAILABLE',
        });
      }

      console.log(`[API] 📤 Sending message to ${jid}: ${body.text.substring(0, 50)}...`);
      console.log(`[API] 📤 Agent info antes do envio:`, { agentId, agentName });
      
      const messageId = await deps.whatsAppAdapter.sendMessage(jid, body.text.trim());
      
      console.log(`[API] ✅ Message sent successfully: ${messageId}`);
      console.log(`[API] 🔄 Preparando para atualizar mensagem com agent info...`);

      // Atualizar mensagem com agent_id e agent_name após envio
      // Aguardar um pouco para garantir que o evento whatsapp.message.sent já salvou a mensagem
      if (agentId || agentName) {
        console.log(`[API] ⏳ Agendando atualização de agent info em 500ms...`);
        setTimeout(async () => {
          console.log(`[API] 🔄 Iniciando atualização de agent info para messageId: ${messageId}`);
          try {
            // Buscar o perfil do agente para obter o nome se não foi fornecido
            let finalAgentName = agentName;
            if (agentId && !agentName) {
              console.log(`[API] 🔍 Buscando nome do agente no perfil...`);
              const { createClient } = require('@supabase/supabase-js');
              const supabaseUrl = process.env.SUPABASE_URL;
              const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
              if (supabaseUrl && supabaseKey) {
                const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
                const { data: profile, error: profileError } = await supabaseAdmin
                  .from('profiles')
                  .select('name')
                  .eq('id', agentId)
                  .maybeSingle();
                
                if (profileError) {
                  console.error(`[API] ❌ Erro ao buscar perfil:`, profileError);
                } else if (profile) {
                  finalAgentName = profile.name;
                  console.log(`[API] ✅ Nome do agente encontrado: ${finalAgentName}`);
                } else {
                  console.log(`[API] ⚠️ Perfil não encontrado para agentId: ${agentId}`);
                }
              }
            }

            console.log(`[API] 📝 Valores finais para atualização:`, {
              messageId,
              agentId,
              agentName: finalAgentName,
              tenantId,
            });

            // Atualizar mensagem existente com agent_id e agent_name
            const { createClient } = require('@supabase/supabase-js');
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supabaseUrl && supabaseKey) {
              const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
              
              console.log(`[API] 🔄 Executando UPDATE na tabela messages...`);
              const { data: updateData, error: updateError } = await supabaseAdmin
                .from('messages')
                .update({
                  agent_id: agentId || null,
                  agent_name: finalAgentName || null,
                })
                .eq('id', messageId)
                .eq('tenant_id', tenantId)
                .select();

              if (updateError) {
                console.error(`[API] ❌ Erro ao atualizar mensagem com agent info:`, updateError);
                console.error(`[API] ❌ Detalhes do erro:`, JSON.stringify(updateError, null, 2));
              } else {
                console.log(`[API] ✅ Message updated with agent info:`, {
                  messageId,
                  agentId,
                  agentName: finalAgentName,
                  rowsAffected: updateData?.length || 0,
                  updatedData: updateData,
                });
                
                // Verificar se realmente foi atualizado
                const { data: verifyData } = await supabaseAdmin
                  .from('messages')
                  .select('agent_id, agent_name')
                  .eq('id', messageId)
                  .maybeSingle();
                
                console.log(`[API] 🔍 Verificação pós-update:`, verifyData);
              }
            } else {
              console.error(`[API] ❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados`);
            }
          } catch (error) {
            console.error(`[API] ❌ Erro ao atualizar mensagem com agent info:`, error);
            console.error(`[API] ❌ Stack trace:`, error instanceof Error ? error.stack : 'No stack');
            // Não falhar o envio se houver erro ao atualizar
          }
        }, 500); // Aguardar 500ms para garantir que o evento já salvou
      } else {
        console.log(`[API] ⚠️ Agent info não disponível (agentId: ${agentId}, agentName: ${agentName}) - pulando atualização`);
      }

      // Limpar waiting_human quando funcionário enviar mensagem manual
      if (conversation && (conversation.state === 'waiting_human' || conversation.waitingHumanAt)) {
        try {
          await messageService.clearWaitingHuman(id, tenantId);
          
          // Marcar notificações como lidas
          if (deps.notificationService) {
            await deps.notificationService.markConversationAsRead(id, tenantId);
          }
          
          console.log(`[API] ✅ Waiting_human limpo - funcionário enviou mensagem manual`);
        } catch (error) {
          console.error(`[API] ⚠️ Erro ao limpar waiting_human:`, error);
          // Não falhar o envio da mensagem se houver erro ao limpar waiting_human
        }
      }

      return {
        success: true,
        data: {
          messageId,
          conversationId: id,
          text: body.text.trim(),
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      console.error(`[API] Error sending message:`, error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Verificar se é erro de conexão
      if (errorMessage.includes('not connected') || errorMessage.includes('not authenticated')) {
        return reply.code(400).send({
          success: false,
          message: 'WhatsApp is not connected',
          errorCode: 'NOT_CONNECTED',
        });
      }

      return reply.code(500).send({
        success: false,
        message: 'Failed to send message',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Endpoint para buscar foto de perfil sob demanda
  fastify.get('/api/v1/conversations/:id/profile-picture', async (request, reply) => {
    const { id } = request.params as { id: string };
    // Log removido - request não essencial
    try {
      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }
      const conversation = await messageService.getConversationById(id, tenantId);
      
      if (!conversation) {
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      // Buscar foto sob demanda
      if (conversation.sender.jid) {
        try {
          const profilePic = await deps.whatsAppAdapter.getProfilePictureUrl(conversation.sender.jid);
          if (profilePic) {
            return {
              success: true,
              data: {
                profilePictureUrl: profilePic,
              },
            };
          }
        } catch (error) {
          // Foto não disponível - ignorar (é normal não ter foto)
          // Log removido - não é erro, é operação normal
        }
      }

      return {
        success: true,
        data: {
          profilePictureUrl: null,
        },
      };
    } catch (error) {
      console.error(`[API] Error fetching profile picture for conversation ${id}:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch profile picture',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Schema para validação do estado da conversa
  const updateStateSchema = z.object({
    state: z.enum(['open', 'waiting', 'archived'], {
      errorMap: () => ({ message: 'State must be one of: open, waiting, archived' }),
    }),
  });

  // Endpoint para atualizar estado da conversa
  fastify.patch('/api/v1/conversations/:id/state', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    console.log(`[API] PATCH /api/v1/conversations/${id}/state - Request received`);

    try {
      const body = request.body as { state?: string };

      // Validar input
      if (!body.state || typeof body.state !== 'string') {
        return reply.code(400).send({
          success: false,
          message: 'State is required and must be a string',
          errorCode: 'INVALID_INPUT',
        });
      }

      const state = body.state as ConversationState;

      // Validar que o state é um dos valores permitidos
      if (state !== 'open' && state !== 'waiting' && state !== 'archived') {
        return reply.code(400).send({
          success: false,
          message: 'State must be one of: open, waiting, archived',
          errorCode: 'INVALID_STATE',
        });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se a conversa existe
      const conversation = await messageService.getConversationById(id, tenantId);
      if (!conversation) {
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      // Atualizar estado
      await messageService.updateConversationState(id, state, tenantId);
      console.log(`[API] ✅ Conversation ${id} state updated to: ${state}`);

      // Buscar conversa atualizada para retornar
      const updatedConversation = await messageService.getConversationById(id);

      return {
        success: true,
        data: updatedConversation,
      };
    } catch (error) {
      console.error(`[API] Error updating conversation state:`, error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      return reply.code(500).send({
        success: false,
        message: 'Failed to update conversation state',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Schema para validação do controle de IA
  const aiControlSchema = z.object({
    reason: z.string().optional(),
  });

  // Endpoint para desabilitar IA
  fastify.patch('/api/v1/conversations/:id/ai/disable', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    console.log(`[API] PATCH /api/v1/conversations/${id}/ai/disable - Request received`);

    try {
      const body = request.body as { reason?: string };
      const tenantId = request.tenantId;
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se a conversa existe
      const conversation = await messageService.getConversationById(id, tenantId);
      if (!conversation) {
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      // Desabilitar IA
      await messageService.updateAIControl(id, {
        aiEnabled: false,
        aiDisabledBy: 'human',
        aiDisabledReason: body.reason || null,
      }, tenantId);

      console.log(`[API] ✅ Conversation ${id} AI disabled`);

      // Buscar conversa atualizada para retornar
      const updatedConversation = await messageService.getConversationById(id, tenantId);

      return {
        success: true,
        data: updatedConversation,
      };
    } catch (error) {
      console.error(`[API] Error disabling AI:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to disable AI',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });

  // Endpoint para habilitar IA
  fastify.patch('/api/v1/conversations/:id/ai/enable', async (request, reply) => {
    reply.type('application/json');
    const { id } = request.params as { id: string };
    console.log(`[API] PATCH /api/v1/conversations/${id}/ai/enable - Request received`);

    try {
      const tenantId = request.tenantId;
      
      if (!tenantId) {
        return reply.code(401).send({
          success: false,
          message: 'TenantId is required',
          errorCode: 'UNAUTHORIZED',
        });
      }

      // Verificar se a conversa existe
      const conversation = await messageService.getConversationById(id, tenantId);
      if (!conversation) {
        return reply.code(404).send({
          success: false,
          message: 'Conversation not found',
          errorCode: 'NOT_FOUND',
        });
      }

      // Limpar waiting_human quando IA for reativada (antes de habilitar IA)
      if (conversation && (conversation.state === 'waiting_human' || conversation.waitingHumanAt)) {
        await messageService.clearWaitingHuman(id, tenantId);
        
        // Marcar notificações como lidas
        if (deps.notificationService) {
          await deps.notificationService.markConversationAsRead(id, tenantId);
        }
        
        console.log(`[API] ✅ Waiting_human limpo - IA reativada`);
      }

      // Habilitar IA
      await messageService.updateAIControl(id, {
        aiEnabled: true,
        aiDisabledBy: 'human', // Será ignorado quando enabled=true
        aiDisabledReason: null,
      }, tenantId);

      console.log(`[API] ✅ Conversation ${id} AI enabled`);

      // Buscar conversa atualizada para retornar
      const updatedConversation = await messageService.getConversationById(id, tenantId);

      return {
        success: true,
        data: updatedConversation,
      };
    } catch (error) {
      console.error(`[API] Error enabling AI:`, error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to enable AI',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
  
  console.log('[Routes] Conversation routes registered successfully');
};

