import type { Message, Conversation, ConversationState } from './types';
import type { IMessageRepository } from './repository';
import { supabase } from '../database/config';
import type { SenderInfo } from '../whatsapp/types';

/**
 * PostgreSQL implementation of IMessageRepository using Supabase
 * Maintains the same interface as InMemoryMessageRepository for seamless migration
 */
class PostgresMessageRepository implements IMessageRepository {
  constructor() {
    console.log('[PostgresMessageRepository] 🗄️  PostgreSQL repository instance created');
    console.log('[PostgresMessageRepository] 📍 Will save to Supabase tables: conversations, messages');
  }
  /**
   * Busca mensagens de uma conversa
   * 
   * CONTRATO DE ORDENAÇÃO (GARANTIDO):
   * - Ordenação por: timestamp ASC, created_at ASC, id ASC
   * - Timestamp sempre em milissegundos (BIGINT)
   * - Ordem determinística mesmo com timestamps iguais
   * - API sempre retorna já ordenado (frontend não deve fazer sort)
   * 
   * Idempotência: PRIMARY KEY em 'id' garante que mesma messageId não duplica
   */
  async findByConversationId(conversationId: string, tenantId: string): Promise<Message[]> {
    try {
      // ORDENAÇÃO ROBUSTA: (timestamp, created_at, id) como tie-breaker
      // Isso garante ordem cronológica correta mesmo com:
      // - Timestamps iguais
      // - Mensagens chegando fora de ordem
      // - Reprocessamento de mensagens
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('tenant_id', tenantId)
        .order('timestamp', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      if (error) {
        console.error('[PostgresMessageRepository] Error fetching messages:', error);
        return [];
      }

      const messages = (data || []).map(this.mapRowToMessage);
      
      // Validação adicional: garantir que timestamp está em milissegundos
      // Se algum timestamp estiver em segundos (< 10000000000), converter
      const normalizedMessages = messages.map(msg => {
        // Timestamps Unix em segundos são < 10000000000 (ano 2286)
        // Timestamps em ms são > 1000000000000 (ano 2001)
        if (msg.timestamp < 10000000000) {
          console.warn(`[PostgresMessageRepository] ⚠️  Timestamp em segundos detectado: ${msg.timestamp}, convertendo para ms`);
          return { ...msg, timestamp: msg.timestamp * 1000 };
        }
        return msg;
      });

      // Log removido - operação rotineira, não precisa aparecer no debug

      return normalizedMessages;
    } catch (error) {
      console.error('[PostgresMessageRepository] Error in findByConversationId:', error);
      return [];
    }
  }

  async findById(messageId: string, tenantId: string): Promise<Message | null> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapRowToMessage(data);
    } catch (error) {
      console.error('[PostgresMessageRepository] Error in findById:', error);
      return null;
    }
  }

  async create(message: Message, tenantId: string): Promise<void> {
    try {
      console.log(`[PostgresMessageRepository] 💾 Saving message to Supabase: ${message.messageId}`);
      console.log(`[PostgresMessageRepository] Conversation: ${message.conversationId}`);
      console.log(`[PostgresMessageRepository] Type: ${message.messageType}, From: ${message.sender.phoneNumber}`);
      
      // Primeiro, garantir que a conversa existe (mesmo para mensagens do sistema)
      await this.ensureConversationExists(message, tenantId);

      // Normalizar timestamp: garantir que está em milissegundos
      // Timestamps Unix em segundos são < 10000000000 (ano 2286)
      // Timestamps em ms são > 1000000000000 (ano 2001)
      let normalizedTimestamp = message.timestamp;
      if (normalizedTimestamp < 10000000000) {
        console.warn(`[PostgresMessageRepository] ⚠️  Timestamp em segundos detectado: ${normalizedTimestamp}, convertendo para ms`);
        normalizedTimestamp = normalizedTimestamp * 1000;
      }
      
      // Garantir que timestamp seja positivo (constraint do banco)
      if (normalizedTimestamp <= 0) {
        console.error(`[PostgresMessageRepository] ❌ Invalid timestamp: ${normalizedTimestamp}, using Date.now() as fallback`);
        normalizedTimestamp = Date.now();
      }

      // Preparar dados da mensagem para inserção
      const messageRow = {
        id: message.messageId,
        conversation_id: message.conversationId,
        tenant_id: tenantId,
        text: message.text,
        timestamp: normalizedTimestamp,
        sender_phone_number: message.sender.phoneNumber,
        sender_jid: message.sender.jid,
        sender_push_name: message.sender.pushName || null,
        sender_profile_picture_url: message.sender.profilePictureUrl || null,
        media_type: message.media?.type || null,
        media_mimetype: message.media?.mimetype || null,
        media_caption: message.media?.caption || null,
        media_url: message.media?.url || null,
        media_media_id: message.media?.mediaId || null,
        message_type: message.messageType,
        baileys_key_id: message.baileysKey?.id || null,
        baileys_key_remote_jid: message.baileysKey?.remoteJid || null,
        baileys_key_from_me: message.baileysKey?.fromMe || null,
        baileys_message: message.baileysMessage || null,
        agent_id: message.agentId || null,
        agent_name: message.agentName || null,
      };

      console.log(`[PostgresMessageRepository] 📝 Inserting message row into Supabase...`);
      console.log(`[PostgresMessageRepository] 📝 Message row data:`, JSON.stringify(messageRow, null, 2));
      console.log(`[PostgresMessageRepository] 🔍 Agent info no message object:`, {
        agentId: message.agentId,
        agentName: message.agentName,
        hasAgentId: !!message.agentId,
        hasAgentName: !!message.agentName,
      });
      
      const { data: insertedData, error: insertError } = await supabase
        .from('messages')
        .insert(messageRow)
        .select();

      if (insertError) {
        // Tratar duplicatas (idempotência): se a mensagem já existe, tratar como sucesso
        if (insertError.code === '23505') {
          console.log(`[PostgresMessageRepository] ℹ️  Message already exists (idempotent): ${message.messageId}`);
          console.log(`[PostgresMessageRepository] ✅ Skipping duplicate insert - message already in database`);
          
          // Mesmo que seja duplicata, atualizar conversa (pode ter mudado last_message, etc)
          await this.updateConversationFromMessage(message, tenantId);
          return; // Sucesso silencioso
        }
        
        console.error('[PostgresMessageRepository] ❌ Error inserting message:', insertError);
        console.error('[PostgresMessageRepository] Error code:', insertError.code);
        console.error('[PostgresMessageRepository] Error message:', insertError.message);
        console.error('[PostgresMessageRepository] Error details:', JSON.stringify(insertError, null, 2));
        console.error('[PostgresMessageRepository] Message row that failed:', JSON.stringify(messageRow, null, 2));
        
        if (insertError.code === '42P01') {
          console.error('[PostgresMessageRepository] ❌ ERROR: Table "messages" does not exist!');
          console.error('[PostgresMessageRepository] 💡 Please run the SQL schema in Supabase SQL Editor');
        } else if (insertError.code === '23503') {
          console.error('[PostgresMessageRepository] ❌ ERROR: Foreign key violation - conversation does not exist');
          console.error('[PostgresMessageRepository] 💡 This should not happen - ensureConversationExists should have created it');
        }
        
        throw insertError;
      }

      console.log(`[PostgresMessageRepository] ✅ Message saved successfully to Supabase: ${message.messageId}`);
      if (insertedData && insertedData.length > 0) {
        console.log(`[PostgresMessageRepository] Confirmed: Message ID ${insertedData[0].id} in database`);
        console.log(`[PostgresMessageRepository] Database record:`, JSON.stringify(insertedData[0], null, 2));
      } else {
        console.warn('[PostgresMessageRepository] ⚠️  No data returned from insert (but no error)');
      }

      // Atualizar conversa (last_message, last_message_at)
      await this.updateConversationFromMessage(message, tenantId);
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in create:', error);
      console.error('[PostgresMessageRepository] Stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
  }

  async getAllConversations(tenantId: string): Promise<Conversation[]> {
    try {
      // Log removido - request não essencial (fetch frequente)
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) {
        console.error('[PostgresMessageRepository] Error fetching conversations:', error);
        return [];
      }

      // Garantir que sempre retorne um array
      if (!Array.isArray(data)) {
        console.warn('[PostgresMessageRepository] Data is not an array:', data);
        return [];
      }

      // Log removido - request não essencial
      // mapRowToConversation agora é async, então precisamos usar Promise.all
      const conversations = await Promise.all(
        data.map((row) => this.mapRowToConversation(row, tenantId))
      );
      return conversations;
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in getAllConversations:', error);
      console.error('[PostgresMessageRepository] Stack:', error instanceof Error ? error.stack : 'No stack');
      return [];
    }
  }

  async getConversationsByIds(conversationIds: string[], tenantId: string): Promise<Conversation[]> {
    try {
      if (conversationIds.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('id', conversationIds);

      if (error) {
        console.error('[PostgresMessageRepository] Error fetching conversations by IDs:', error);
        return [];
      }

      if (!Array.isArray(data)) {
        console.warn('[PostgresMessageRepository] Data is not an array:', data);
        return [];
      }

      // Mapear conversas e manter ordem dos IDs solicitados
      const conversationsMap = new Map<string, Conversation>();
      const conversations = await Promise.all(
        data.map((row) => this.mapRowToConversation(row, tenantId))
      );
      
      conversations.forEach(conv => {
        conversationsMap.set(conv.conversationId, conv);
      });

      // Retornar na ordem dos IDs solicitados
      return conversationIds
        .map(id => conversationsMap.get(id))
        .filter((conv): conv is Conversation => conv !== undefined);
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in getConversationsByIds:', error);
      return [];
    }
  }

  async updateConversationSender(
    conversationId: string,
    sender: { phoneNumber: string; jid: string; pushName?: string },
    tenantId: string
  ): Promise<void> {
    try {
      // Não atualizar se for mensagem do sistema
      if (sender.phoneNumber === 'system' || sender.jid === 'system@s.whatsapp.net') {
        console.log(`[PostgresMessageRepository] Skipping sender update for system message: ${conversationId}`);
        return;
      }

      console.log(`[PostgresMessageRepository] 💾 Updating conversation sender in Supabase: ${conversationId}`);
      console.log(`[PostgresMessageRepository] New sender name: ${sender.pushName || 'no name'}`);

      const { data: updatedData, error } = await supabase
        .from('conversations')
        .update({
          display_name: sender.pushName || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('tenant_id', tenantId)
        .select();

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating conversation sender:', error);
        console.error('[PostgresMessageRepository] Error details:', JSON.stringify(error, null, 2));
        throw error;
      } else {
        console.log(`[PostgresMessageRepository] ✅ Conversation sender updated successfully in Supabase: ${conversationId}`);
        if (updatedData && updatedData.length > 0) {
          console.log(`[PostgresMessageRepository] Confirmed: Conversation ${updatedData[0].id} updated with display_name: ${updatedData[0].display_name}`);
        }
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateConversationSender:', error);
      console.error('[PostgresMessageRepository] Stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
  }

  /**
   * Garante que a conversa existe no banco
   * IMPORTANTE: Mesmo para mensagens do sistema, a conversa deve existir
   */
  private async ensureConversationExists(message: Message, tenantId: string): Promise<void> {
    const isSystemMessage = message.sender.phoneNumber === 'system' || message.sender.jid === 'system@s.whatsapp.net';
    
    console.log(`[PostgresMessageRepository] Checking if conversation exists: ${message.conversationId}`);
    console.log(`[PostgresMessageRepository] Is system message: ${isSystemMessage}`);

    // Primeiro, verificar se a conversa existe com o tenant_id correto
    let { data: existing, error: selectError } = await supabase
      .from('conversations')
      .select('id, jid, phone_number, tenant_id')
      .eq('id', message.conversationId)
      .eq('tenant_id', tenantId)
      .single();

    // Se não encontrou com tenant_id, verificar se existe sem tenant_id (conversas antigas)
    if (selectError && selectError.code === 'PGRST116') {
      console.log(`[PostgresMessageRepository] Conversation not found with tenant_id, checking without tenant_id...`);
      const { data: existingWithoutTenant, error: selectError2 } = await supabase
        .from('conversations')
        .select('id, jid, phone_number, tenant_id')
        .eq('id', message.conversationId)
        .is('tenant_id', null)
        .single();
      
      if (existingWithoutTenant) {
        console.log(`[PostgresMessageRepository] ⚠️  Found conversation without tenant_id, updating...`);
        // Atualizar o tenant_id da conversa existente
        const { error: updateError } = await supabase
          .from('conversations')
          .update({ tenant_id: tenantId })
          .eq('id', message.conversationId)
          .is('tenant_id', null);
        
        if (updateError) {
          console.error('[PostgresMessageRepository] ❌ Error updating tenant_id:', updateError);
        } else {
          console.log(`[PostgresMessageRepository] ✅ Conversation tenant_id updated: ${message.conversationId}`);
          // Usar a conversa atualizada
          existing = { ...existingWithoutTenant, tenant_id: tenantId };
        }
      } else if (selectError2 && selectError2.code !== 'PGRST116') {
        console.error('[PostgresMessageRepository] Error checking conversation without tenant_id:', selectError2);
      }
    } else if (selectError && selectError.code !== 'PGRST116') {
      console.error('[PostgresMessageRepository] Error checking conversation:', selectError);
    }

    if (!existing) {
      // Para mensagens do sistema, precisamos buscar o JID real da conversa
      // O conversationId é o número do destinatário, mas precisamos do JID completo
      let jid = message.sender.jid;
      let phoneNumber = message.sender.phoneNumber;
      let displayName = message.sender.pushName;

      if (isSystemMessage) {
        // Para mensagens do sistema, o conversationId é o número do destinatário
        // Precisamos buscar a conversa original para pegar o JID correto
        // Mas se não existir, criar com o conversationId como phone_number
        phoneNumber = message.conversationId;
        jid = `${message.conversationId}@s.whatsapp.net`;
        displayName = undefined;
        
        // Tentar buscar conversa existente para pegar dados reais
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('jid, phone_number, display_name')
          .eq('phone_number', message.conversationId)
          .eq('tenant_id', tenantId)
          .limit(1)
          .single();
        
        if (existingConv) {
          jid = existingConv.jid;
          phoneNumber = existingConv.phone_number;
          displayName = existingConv.display_name;
          console.log(`[PostgresMessageRepository] Found existing conversation data for system message`);
        }
      }

      // Criar conversa
      const conversationRow = {
        id: message.conversationId,
        tenant_id: tenantId,
        jid: jid,
        phone_number: phoneNumber,
        display_name: displayName || null,
        profile_picture_url: isSystemMessage ? null : (message.sender.profilePictureUrl || null),
        ai_enabled: true,
        state: 'open', // Estado padrão para novas conversas
        last_message: message.text || null,
        last_message_at: new Date(message.timestamp).toISOString(),
      };

      console.log(`[PostgresMessageRepository] 💾 Creating conversation in Supabase: ${message.conversationId}`);
      const { data: insertedConv, error: insertError } = await supabase
        .from('conversations')
        .insert(conversationRow)
        .select();

      if (insertError) {
        // Pode ser race condition (duas mensagens criando ao mesmo tempo)
        if (insertError.code === '23505') { // Unique violation
          console.log(`[PostgresMessageRepository] Conversation already exists (race condition): ${message.conversationId}`);
          // Tentar atualizar o tenant_id se a conversa existir sem tenant_id
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('tenant_id')
            .eq('id', message.conversationId)
            .single();
          
          if (existingConv && !existingConv.tenant_id) {
            console.log(`[PostgresMessageRepository] ⚠️  Conversation exists but has no tenant_id, updating...`);
            const { error: updateError } = await supabase
              .from('conversations')
              .update({ tenant_id: tenantId })
              .eq('id', message.conversationId)
              .is('tenant_id', null);
            
            if (updateError) {
              console.error('[PostgresMessageRepository] ❌ Error updating tenant_id:', updateError);
            } else {
              console.log(`[PostgresMessageRepository] ✅ Conversation tenant_id updated: ${message.conversationId}`);
            }
          }
        } else {
          console.error('[PostgresMessageRepository] ❌ Error creating conversation:', insertError);
          console.error('[PostgresMessageRepository] Error details:', JSON.stringify(insertError, null, 2));
        }
      } else {
        console.log(`[PostgresMessageRepository] ✅ Conversation created successfully in Supabase: ${message.conversationId}`);
        if (insertedConv && insertedConv.length > 0) {
          console.log(`[PostgresMessageRepository] Confirmed: Conversation ID ${insertedConv[0].id} in database with tenant_id: ${insertedConv[0].tenant_id}`);
        }
      }
    } else {
      console.log(`[PostgresMessageRepository] ✅ Conversation already exists: ${message.conversationId}`);
    }
  }

  /**
   * Atualiza a conversa com informações da última mensagem
   * IMPORTANTE: Atualiza mesmo para mensagens do sistema (para atualizar last_message)
   * REGRA: Se fromMe === false → incrementa unread_count
   */
  private async updateConversationFromMessage(message: Message, tenantId: string): Promise<void> {
    const isSystemMessage = message.sender.phoneNumber === 'system' || message.sender.jid === 'system@s.whatsapp.net';
    const fromMe = message.baileysKey?.fromMe ?? false;
    
    try {
      console.log(`[PostgresMessageRepository] Updating conversation: ${message.conversationId}`);
      console.log(`[PostgresMessageRepository] Is system message: ${isSystemMessage}`);
      console.log(`[PostgresMessageRepository] From me: ${fromMe}`);

      // Buscar conversa existente para preservar dados e obter unread_count atual
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('display_name, profile_picture_url, unread_count')
        .eq('id', message.conversationId)
        .eq('tenant_id', tenantId)
        .single();

      const currentUnreadCount = existingConv?.unread_count ?? 0;

      // Atualizar conversa
      const updateData: any = {
        last_message: message.text || null, // Mantido para compatibilidade
        last_message_id: message.messageId, // ID da última mensagem (para construir objeto lastMessage)
        last_message_at: new Date(message.timestamp).toISOString(),
        updated_at: new Date().toISOString(),
      };

      // REGRA: Incrementar unread_count apenas se a mensagem NÃO for do sistema E NÃO for de mim
      if (!isSystemMessage && !fromMe) {
        updateData.unread_count = currentUnreadCount + 1;
        console.log(`[PostgresMessageRepository] 📬 Incrementing unread_count: ${currentUnreadCount} → ${updateData.unread_count}`);
      } else {
        // Manter unread_count atual se for mensagem do sistema ou se for de mim
        updateData.unread_count = currentUnreadCount;
        console.log(`[PostgresMessageRepository] ℹ️  Keeping unread_count: ${currentUnreadCount} (isSystem: ${isSystemMessage}, fromMe: ${fromMe})`);
      }

      // Para mensagens do sistema, NÃO atualizar sender info (manter dados do contato real)
      // Para mensagens recebidas, atualizar sender info se disponível
      if (!isSystemMessage) {
        // Atualizar sender apenas se não for sistema e tiver nome
        // Priorizar nome existente na conversa se a mensagem não tiver nome
        if (message.sender.pushName) {
          updateData.display_name = message.sender.pushName;
        } else if (existingConv?.display_name) {
          // Manter nome existente se mensagem não tiver nome
          updateData.display_name = existingConv.display_name;
        }

        if (message.sender.profilePictureUrl) {
          updateData.profile_picture_url = message.sender.profilePictureUrl;
        } else if (existingConv?.profile_picture_url) {
          // Manter foto existente se mensagem não tiver foto
          updateData.profile_picture_url = existingConv.profile_picture_url;
        }
      } else {
        // Para mensagens do sistema, manter dados existentes
        if (existingConv?.display_name) {
          updateData.display_name = existingConv.display_name;
        }
        if (existingConv?.profile_picture_url) {
          updateData.profile_picture_url = existingConv.profile_picture_url;
        }
      }

      console.log(`[PostgresMessageRepository] 💾 Updating conversation in Supabase...`);
      const { data: updatedData, error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', message.conversationId)
        .eq('tenant_id', tenantId)
        .select();

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating conversation:', error);
        console.error('[PostgresMessageRepository] Error details:', JSON.stringify(error, null, 2));
      } else {
        console.log(`[PostgresMessageRepository] ✅ Conversation updated successfully in Supabase: ${message.conversationId}`);
        if (updatedData && updatedData.length > 0) {
          console.log(`[PostgresMessageRepository] Confirmed: Conversation ${updatedData[0].id} updated with last_message_at and unread_count`);
        }
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateConversationFromMessage:', error);
      console.error('[PostgresMessageRepository] Stack:', error instanceof Error ? error.stack : 'No stack');
    }
  }

  /**
   * Mapeia uma linha do banco para Message
   */
  private mapRowToMessage(row: any): Message {
    const sender: SenderInfo = {
      phoneNumber: row.sender_phone_number,
      jid: row.sender_jid,
      pushName: row.sender_push_name || undefined,
      profilePictureUrl: row.sender_profile_picture_url || undefined,
    };

    const message: Message = {
      messageId: row.id,
      conversationId: row.conversation_id,
      text: row.text,
      timestamp: row.timestamp,
      sender,
      messageType: row.message_type || 'text',
      agentId: row.agent_id || undefined,
      agentName: row.agent_name || undefined,
    };

    // Adicionar mídia se houver
    if (row.media_type) {
      message.media = {
        type: row.media_type,
        mimetype: row.media_mimetype || undefined,
        caption: row.media_caption || undefined,
        url: row.media_url || undefined,
        mediaId: row.media_media_id || undefined,
      };
    }

    // Adicionar baileysKey se houver
    if (row.baileys_key_id) {
      message.baileysKey = {
        id: row.baileys_key_id,
        remoteJid: row.baileys_key_remote_jid,
        fromMe: row.baileys_key_from_me || false,
      };
    }

    // Adicionar baileysMessage se houver
    if (row.baileys_message) {
      message.baileysMessage = row.baileys_message;
    }

    return message;
  }

  /**
   * Marca conversa como lida (zera unread_count)
   */
  async markConversationAsRead(conversationId: string, tenantId: string): Promise<void> {
    try {
      // Log removido - operação rotineira, não precisa aparecer no debug
      const { data, error } = await supabase
        .from('conversations')
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('tenant_id', tenantId)
        .select();

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error marking conversation as read:', error);
        throw error;
      }
      // Log removido - operação rotineira, não precisa aparecer no debug
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in markConversationAsRead:', error);
      throw error;
    }
  }

  /**
   * Atualiza o estado da conversa (open, waiting, archived)
   */
  async updateSelectedStore(conversationId: string, storeId: string | null, storeName: string | null, tenantId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('conversations')
        .update({
          selected_store_id: storeId,
          selected_store_name: storeName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating selected store:', error);
        throw error;
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateSelectedStore:', error);
      throw error;
    }
  }

  async updateStoreSelectionState(
    conversationId: string,
    state: {
      awaitingStoreSelection?: boolean;
      pendingQuestionText?: string | null;
      storeCandidates?: string[] | null;
    },
    tenantId: string
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (state.awaitingStoreSelection !== undefined) {
        updateData.awaiting_store_selection = state.awaitingStoreSelection;
      }
      if (state.pendingQuestionText !== undefined) {
        updateData.pending_question_text = state.pendingQuestionText;
      }
      if (state.storeCandidates !== undefined) {
        updateData.store_candidates = state.storeCandidates ? JSON.stringify(state.storeCandidates) : null;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating store selection state:', error);
        throw error;
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateStoreSelectionState:', error);
      throw error;
    }
  }

  async updatePendingToolState(
    conversationId: string,
    state: {
      pendingToolName?: string | null;
      pendingFields?: string[] | null;
      pendingContext?: Record<string, unknown> | null;
      pendingAttempts?: number;
    },
    tenantId: string
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (state.pendingToolName !== undefined) {
        updateData.pending_tool_name = state.pendingToolName;
      }
      if (state.pendingFields !== undefined) {
        updateData.pending_fields = state.pendingFields ? JSON.stringify(state.pendingFields) : null;
      }
      if (state.pendingContext !== undefined) {
        updateData.pending_context = state.pendingContext ? JSON.stringify(state.pendingContext) : null;
      }
      if (state.pendingAttempts !== undefined) {
        updateData.pending_attempts = state.pendingAttempts;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating pending tool state:', error);
        throw error;
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updatePendingToolState:', error);
      throw error;
    }
  }

  async updateAIControl(
    conversationId: string,
    state: {
      aiEnabled: boolean;
      aiDisabledBy: 'human' | 'system' | 'tool';
      aiDisabledReason?: string | null;
    },
    tenantId: string
  ): Promise<void> {
    try {
      console.log(`[PostgresMessageRepository] Updating AI control: ${conversationId} → ${state.aiEnabled ? 'enabled' : 'disabled'} (by: ${state.aiDisabledBy})`);
      
      const updateData: Record<string, any> = {
        ai_enabled: state.aiEnabled,
        updated_at: new Date().toISOString(),
      };

      if (state.aiEnabled) {
        // Se habilitando, limpar campos de desativação
        updateData.ai_disabled_at = null;
        updateData.ai_disabled_by = null;
        updateData.ai_disabled_reason = null;
      } else {
        // Se desabilitando, preencher campos
        updateData.ai_disabled_at = new Date().toISOString();
        updateData.ai_disabled_by = state.aiDisabledBy;
        updateData.ai_disabled_reason = state.aiDisabledReason || null;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating AI control:', error);
        throw error;
      } else {
        console.log(`[PostgresMessageRepository] ✅ AI control updated: ${conversationId} → ${state.aiEnabled ? 'enabled' : 'disabled'}`);
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateAIControl:', error);
      throw error;
    }
  }

  async updateConversation(
    conversationId: string,
    updates: {
      isReputationAtRisk?: boolean;
      [key: string]: any;
    },
    tenantId: string
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.isReputationAtRisk !== undefined) {
        updateData.is_reputation_at_risk = updates.isReputationAtRisk;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating conversation:', error);
        throw error;
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateConversation:', error);
      throw error;
    }
  }

  async updateConversationState(conversationId: string, state: ConversationState, tenantId: string): Promise<void> {
    try {
      console.log(`[PostgresMessageRepository] Updating conversation state: ${conversationId} → ${state}`);
      
      // Validar state
      if (state !== 'open' && state !== 'waiting' && state !== 'waiting_human' && state !== 'archived') {
        throw new Error(`Invalid conversation state: ${state}. Must be 'open', 'waiting', 'waiting_human', or 'archived'`);
      }

      const updateData: Record<string, any> = {
        state,
        updated_at: new Date().toISOString(),
      };

      // Se mudando para waiting_human, setar waiting_human_at
      if (state === 'waiting_human') {
        updateData.waiting_human_at = new Date().toISOString();
      } else if (state !== 'waiting_human') {
        // Se mudando para outro estado, limpar waiting_human_at
        updateData.waiting_human_at = null;
      }

      const { data, error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId)
        .eq('tenant_id', tenantId)
        .select();

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating conversation state:', error);
        throw error;
      } else {
        console.log(`[PostgresMessageRepository] ✅ Conversation state updated: ${conversationId} → ${state}`);
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateConversationState:', error);
      throw error;
    }
  }

  async clearWaitingHuman(conversationId: string, tenantId: string): Promise<void> {
    try {
      console.log(`[PostgresMessageRepository] Clearing waiting_human state: ${conversationId}`);
      
      const { error } = await supabase
        .from('conversations')
        .update({ 
          waiting_human_at: null,
          state: 'open', // Voltar para open quando limpar waiting_human
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error clearing waiting_human:', error);
        throw error;
      } else {
        console.log(`[PostgresMessageRepository] ✅ Waiting_human cleared: ${conversationId}`);
      }
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in clearWaitingHuman:', error);
      throw error;
    }
  }

  /**
   * Busca a última mensagem da conversa para construir objeto lastMessage
   */
  private async getLastMessageForConversation(conversationId: string, lastMessageId: string | null, tenantId: string): Promise<Message | null> {
    if (!lastMessageId) {
      return null;
    }

    try {
      const message = await this.findById(lastMessageId, tenantId);
      return message;
    } catch (error) {
      console.error(`[PostgresMessageRepository] Error fetching last message ${lastMessageId}:`, error);
      return null;
    }
  }

  /**
   * Busca o tenantId de uma conversa
   * Retorna null se a conversa não existir
   */
  async getConversationTenantId(conversationId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('tenant_id')
        .eq('id', conversationId)
        .single();

      if (error || !data) {
        return null;
      }

      return data.tenant_id || null;
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in getConversationTenantId:', error);
      return null;
    }
  }

  /**
   * Mapeia uma linha do banco para Conversation
   * Constrói objeto lastMessage estruturado e inclui unreadCount
   */
  private async mapRowToConversation(row: any, tenantId: string): Promise<Conversation> {
    // Garantir que sempre retorne um sender válido
    if (!row) {
      throw new Error('Cannot map null row to Conversation');
    }

    // Verificar se os campos obrigatórios existem
    if (!row.id || !row.jid || !row.phone_number) {
      console.error('[PostgresMessageRepository] ❌ Invalid conversation row:', JSON.stringify(row, null, 2));
      throw new Error(`Invalid conversation row: missing required fields (id: ${row.id}, jid: ${row.jid}, phone_number: ${row.phone_number})`);
    }

    const sender: SenderInfo = {
      phoneNumber: row.phone_number,
      jid: row.jid,
      pushName: row.display_name || undefined,
      profilePictureUrl: row.profile_picture_url || undefined,
    };

    // Buscar última mensagem para construir objeto lastMessage
    const lastMessageData = await this.getLastMessageForConversation(row.id, row.last_message_id, tenantId);
    
    let lastMessage: Conversation['lastMessage'] = null;
    if (lastMessageData) {
      // Determinar fromMe: true se for mensagem do sistema OU se baileysKey.fromMe for true
      const isSystemMessage = lastMessageData.sender.phoneNumber === 'system' || 
                              lastMessageData.sender.jid === 'system@s.whatsapp.net';
      const fromMe = isSystemMessage || (lastMessageData.baileysKey?.fromMe ?? false);
      
      lastMessage = {
        id: lastMessageData.messageId,
        text: lastMessageData.text || undefined,
        type: lastMessageData.messageType === 'other' ? 'text' : lastMessageData.messageType,
        fromMe, // true se for mensagem do sistema ou se baileysKey.fromMe for true
        timestamp: lastMessageData.timestamp,
      };
    }

    // Buscar todos os agentes únicos que enviaram mensagens nesta conversa com suas cores
    let agentNames: string[] = [];
    let agentColors: Record<string, string> = {}; // Mapa de nome -> cor
    try {
      const { data: agentMessages, error: agentError } = await supabase
        .from('messages')
        .select('agent_name, agent_id')
        .eq('conversation_id', row.id)
        .eq('tenant_id', tenantId)
        .not('agent_name', 'is', null);

      if (!agentError && agentMessages && agentMessages.length > 0) {
        // Extrair nomes únicos (sem duplicatas)
        const uniqueAgents = new Map<string, string>(); // nome -> agent_id
        agentMessages.forEach(msg => {
          if (msg.agent_name && msg.agent_id) {
            uniqueAgents.set(msg.agent_name, msg.agent_id);
          }
        });
        
        agentNames = Array.from(uniqueAgents.keys());
        
        // Buscar cores dos agentes na tabela profiles
        if (uniqueAgents.size > 0) {
          const agentIds = Array.from(uniqueAgents.values());
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, color')
            .in('id', agentIds);
          
          if (profiles) {
            profiles.forEach(profile => {
              if (profile.name && profile.color) {
                agentColors[profile.name] = profile.color;
              }
            });
          }
        }
      }
    } catch (error) {
      // Ignorar erros ao buscar agentes (não é crítico)
      console.warn(`[PostgresMessageRepository] Erro ao buscar agentes para conversa ${row.id}:`, error);
    }

    const updatedAt = row.last_message_at ? new Date(row.last_message_at).getTime() : Date.now();
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();

    // Validar e normalizar state (garantir que seja um dos valores válidos)
    const state: Conversation['state'] = (row.state === 'open' || row.state === 'waiting' || row.state === 'waiting_human' || row.state === 'archived')
      ? row.state
      : 'open'; // Fallback para 'open' se state inválido ou ausente

    // Buscar nome da loja selecionada se houver selected_store_id
    let selectedStoreName: string | undefined = undefined;
    if (row.selected_store_id) {
      try {
        const { data: storeData } = await supabase
          .from('stores')
          .select('name')
          .eq('id', row.selected_store_id)
          .eq('tenant_id', tenantId)
          .single();
        if (storeData) {
          selectedStoreName = storeData.name;
        }
      } catch (error) {
        console.warn(`[PostgresMessageRepository] Could not fetch store name for ${row.selected_store_id}:`, error);
      }
    }

    // Parse store_candidates from JSONB if present
    let storeCandidates: string[] | undefined = undefined;
    if (row.store_candidates) {
      try {
        const parsed = typeof row.store_candidates === 'string' 
          ? JSON.parse(row.store_candidates) 
          : row.store_candidates;
        storeCandidates = Array.isArray(parsed) ? parsed : undefined;
      } catch (error) {
        // Ignore parse errors
      }
    }

    const conversation: Conversation = {
      id: row.id, // Alias para conversationId
      conversationId: row.id,
      participantId: row.id, // Alias para conversationId (padrão WhatsApp)
      participantName: row.display_name || undefined,
      participantAvatarUrl: row.profile_picture_url || undefined,
      sender, // Mantido para compatibilidade
      state, // Estado da conversa
      lastMessage, // Objeto estruturado
      unreadCount: row.unread_count ?? 0,
      updatedAt, // Timestamp da última atualização
      lastMessageAt: updatedAt, // Mantido para compatibilidade
      messageCount: 0, // Será calculado dinamicamente se necessário
      createdAt,
      selectedStoreId: row.selected_store_id ? String(row.selected_store_id) : undefined,
      selectedStoreName,
      // AI control fields
      aiEnabled: row.ai_enabled !== undefined ? row.ai_enabled : true, // Default true se não existir
      aiDisabledAt: row.ai_disabled_at ? new Date(row.ai_disabled_at).getTime() : null,
      aiDisabledBy: row.ai_disabled_by || null,
      aiDisabledReason: row.ai_disabled_reason || null,
      awaitingStoreSelection: row.awaiting_store_selection ?? false,
      pendingQuestionText: row.pending_question_text || undefined,
      storeCandidates,
      // Tool system state (Fase 1)
      pendingToolName: row.pending_tool_name || undefined,
      pendingFields: row.pending_fields ? (Array.isArray(row.pending_fields) ? row.pending_fields : JSON.parse(row.pending_fields)) : undefined,
      pendingContext: row.pending_context ? (typeof row.pending_context === 'object' ? row.pending_context : JSON.parse(row.pending_context)) : undefined,
      pendingAttempts: row.pending_attempts ?? 0,
      isReputationAtRisk: row.is_reputation_at_risk ?? false,
      // Human handoff state
      waitingHumanAt: row.waiting_human_at ? new Date(row.waiting_human_at).getTime() : null,
      // Agent tracking
      agentNames: agentNames.length > 0 ? agentNames : undefined,
      agentColors: Object.keys(agentColors).length > 0 ? agentColors : undefined,
    };

    // Log removido - request não essencial (fetch frequente)
    
    return conversation;
  }

  async updateMessageText(messageId: string, text: string, tenantId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ text })
        .eq('id', messageId)
        .eq('tenant_id', tenantId);

      if (error) {
        console.error('[PostgresMessageRepository] ❌ Error updating message text:', error);
        throw error;
      }

      console.log('[PostgresMessageRepository] ✅ Message text updated', {
        messageId,
        textLength: text.length,
      });
    } catch (error) {
      console.error('[PostgresMessageRepository] ❌ Error in updateMessageText:', error);
      throw error;
    }
  }
}

/**
 * Factory function para criar repositório PostgreSQL
 */
export const createPostgresMessageRepository = (): IMessageRepository => {
  return new PostgresMessageRepository();
};

