/**
 * OpenAI AttendantAI
 * Implementação de IAttendantAI usando OpenAI GPT-5 nano
 * 
 * Responsabilidade: Gerar respostas conversacionais para clientes
 * - Usa memória curta (últimas 20 mensagens)
 * - Sempre tenta responder (não bloqueia por isSafe)
 * - Usa dados do sistema (lojas e políticas)
 * - Faz perguntas objetivas quando falta informação
 */

import OpenAI from 'openai';
import type { IAttendantAI } from '../../conversation-pipeline/interfaces/AttendantAI';
import type { ResponseGenerationInput, GeneratedResponse } from '../../conversation-pipeline/types';
import type { MessageService } from '../../messages/service';
import { classifyMessage } from './safe-classifier';
import { logAttendantDecision } from './decision-logger';
import { logger } from '../../utils/logger';

type OpenAIAttendantAIConfig = {
  apiKey: string;
  model?: string; // Default: 'gpt-5-nano'
  maxTokens?: number;
  temperature?: number;
  messageService?: MessageService; // Para buscar histórico de mensagens
};

export class OpenAIAttendantAI implements IAttendantAI {
  private config: Required<Omit<OpenAIAttendantAIConfig, 'messageService'>> & { messageService?: MessageService };
  private openai: OpenAI;

  constructor(config: OpenAIAttendantAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gpt-5-nano',
      maxTokens: config.maxTokens || 500,
      temperature: config.temperature || 0.7,
      messageService: config.messageService,
    };

    // Inicializar cliente OpenAI SDK
    this.openai = new OpenAI({ apiKey: this.config.apiKey });
  }

  /**
   * Verifica se pode lidar com o input
   * SEMPRE retorna true - a IA sempre tenta responder
   */
  async canHandle(_input: ResponseGenerationInput): Promise<boolean> {
    // Sempre retorna true - não bloqueia mais por isSafe
    return true;
  }

  /**
   * Gera uma resposta para a mensagem do cliente
   * SEMPRE retorna uma resposta (nunca null)
   */
  async generateResponse(input: ResponseGenerationInput): Promise<GeneratedResponse | null> {
    logger.ai('Gerando resposta para mensagem', { messageId: input.messageId });

    // 1. Classificar mensagem apenas para logs (não bloqueia)
    const classification = classifyMessage(input.userMessage);
    logger.debug('Classificação da mensagem', { prefix: '[IA]' });
    logger.group('Detalhes da classificação', [
      { label: 'Intent', value: classification.intent },
      { label: 'Motivo', value: classification.reason },
    ]);

    // 2. Buscar histórico de mensagens (memória curta)
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (this.config.messageService) {
      try {
        const tenantId = (this.config.messageService as any).defaultTenantId;
        if (tenantId) {
          // Buscar últimas 5 mensagens (com cache se habilitado)
          const messages = await this.config.messageService.getMessagesByConversationId(
            input.conversationId,
            tenantId,
            5 // limit para cache
          );
          
          // Pegar últimas 5 mensagens, ordenadas por timestamp
          const recentMessages = messages
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5);
          
          // Converter para formato de histórico (user/assistant)
          conversationHistory = recentMessages.map(msg => {
            const isFromSystem = msg.sender.phoneNumber === 'system' || 
                                msg.baileysKey?.fromMe === true;
            return {
              role: isFromSystem ? 'assistant' : 'user',
              content: msg.text || '[mídia]',
            };
          });
          
          logger.debug(`Histórico carregado: ${conversationHistory.length} mensagens`);
        }
      } catch (error) {
        logger.warning('Erro ao carregar histórico de mensagens', { 
          prefix: '[IA]',
          emoji: '⚠️',
        });
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(errorMsg);
      }
    }

    // 3. Construir prompt com contexto completo
    const systemPrompt = this.buildSystemPrompt(
      input.conversationContext?.companyContext,
      input.conversationContext?.stores,
      input.conversationContext?.policies,
      input.conversationContext?.selectedStoreId,
      input.conversationContext?.selectedStoreName
    );

    // 4. Chamar OpenAI com histórico
    let responseText: string;
    try {
      responseText = await this.callOpenAI(systemPrompt, input.userMessage, conversationHistory);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Erro ao chamar OpenAI', { prefix: '[IA]', emoji: '❌' });
      logger.debug(errorMsg);
      
      // Retornar resposta de fallback em vez de null
      return {
        text: 'Desculpe, não consegui processar sua mensagem no momento. Um atendente irá responder em breve.',
        metadata: {
          model: 'fallback',
          intent: classification.intent,
          error: errorMsg,
        },
      };
    }

    // 5. Logar decisão (async, não bloqueia)
    logAttendantDecision({
      conversationId: input.conversationId,
      messageId: input.messageId,
      classification,
      safetyGateResult: { approved: true, reason: 'Resposta gerada' },
      replyPreview: responseText.substring(0, 200),
    }).catch(error => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.debug(`Erro ao logar decisão (não crítico): ${errorMsg}`);
    });

    logger.success('Resposta gerada', { prefix: '[IA]', emoji: '✅' });
    logger.group('Detalhes da resposta', [
      { label: 'Model', value: this.config.model },
      { label: 'Intent', value: classification.intent },
      { label: 'Loja selecionada', value: input.conversationContext?.selectedStoreName || 'Nenhuma' },
      { label: 'Preview', value: responseText.substring(0, 50) + '...' },
    ]);

    return {
      text: responseText,
      metadata: {
        model: this.config.model,
        intent: classification.intent,
        classificationReason: classification.reason,
        usedStore: input.conversationContext?.selectedStoreId || undefined,
        historyLength: conversationHistory.length,
      },
    };
  }

  /**
   * Constrói o prompt do sistema com contexto da empresa, lojas e políticas
   */
  private buildSystemPrompt(
    companyContext?: {
      businessName?: string;
      address?: string;
      openingHours?: string;
      deliveryPolicy?: string;
      paymentMethods?: string;
      phone?: string;
    },
    stores?: Array<{
      id: string;
      name: string;
      address: string;
      neighborhood: string;
      city: string;
      openingHours: string;
      phone: string;
      isActive: boolean;
    }>,
    policies?: Array<{
      id: string;
      title: string;
      content: string;
      applicableStores: string[];
    }>,
    selectedStoreId?: string,
    selectedStoreName?: string
  ): string {
    const businessName = companyContext?.businessName || 'supermercado';
    
    let prompt = `Você é um atendente do ${businessName}. Seu papel é ajudar clientes de forma educada, breve e clara.

REGRAS IMPORTANTES:
1. SEMPRE use apenas informações fornecidas abaixo (lojas e políticas). NUNCA invente dados.
2. Se não tiver a informação cadastrada, diga claramente: "Não encontrei essa informação cadastrada no sistema. Um atendente humano irá confirmar para você."
3. Se o cliente mencionar apenas um nome de loja/bairro (ex: "armação"), trate como seleção de loja e confirme: "Perfeito, loja [Nome]. Sobre sua pergunta: ..."
4. Se já houver uma loja selecionada, use ela como contexto e não pergunte "qual loja?" novamente.
5. Seja breve (máximo 500 caracteres).
6. Faça perguntas objetivas quando faltar informação: "Qual loja?" / "Qual bairro?" / "Qual produto?"
7. Use linguagem amigável e profissional.

REGRAS PARA SAUDAÇÕES E ACKS:
- Se a mensagem for APENAS uma saudação/ack (ex: "bom dia", "oi", "tudo bem", "ok", "valeu"), responda com cumprimento + pergunta aberta curta.
- NÃO inclua endereço/telefone/horário automaticamente em saudações.
- Só forneça telefone/endereço/horário quando o usuário pedir EXPLICITAMENTE (keywords: endereço, localização, como chegar, telefone, contato, horário, funciona até, abre, fecha).
- Quando a intenção não for clara (intent == unknown), prefira "Como posso ajudar?" em vez de listar informações.
- Respostas curtas por padrão; alongar apenas quando perguntado.
- PROIBIDO em saudações: bullets, listas, "Você pode me perguntar sobre:", menus, formato de opções.
- Saudação deve ser natural: saudação + pergunta aberta + NO MÁXIMO 1 frase sugerindo tópicos (sem lista).

Exemplos de saudação (CORRETO):
Usuário: "bom dia!"
Resposta: "Bom dia! 😊 Tudo bem? Como posso te ajudar hoje?"
ou
Resposta: "Bom dia! 😊 O que você precisa hoje? Se for sobre troca/devolução, horário/endereço ou pagamento, me diz por aqui."

Exemplos PROIBIDOS (NÃO fazer):
- "Bom dia! Você pode me perguntar sobre:\n• Troca\n• Devolução\n• Horário"
- "Bom dia! Opções disponíveis: 1) Troca 2) Devolução..."

`;

    // Loja selecionada (se houver)
    if (selectedStoreId && selectedStoreName) {
      const selectedStore = stores?.find(s => s.id === selectedStoreId);
      if (selectedStore) {
        prompt += `LOJA SELECIONADA PELO CLIENTE:
- Nome: ${selectedStore.name}
- Endereço: ${selectedStore.address}, ${selectedStore.neighborhood}, ${selectedStore.city}
- Horário: ${selectedStore.openingHours}
${selectedStore.phone ? `- Telefone: ${selectedStore.phone}\n` : ''}

IMPORTANTE: O cliente já selecionou esta loja. Use ela como contexto e não pergunte "qual loja?" novamente.

`;
      }
    }

    // Contexto da empresa
    if (companyContext) {
      prompt += `INFORMAÇÕES GERAIS DA EMPRESA:\n`;
      if (companyContext.businessName) {
        prompt += `- Nome: ${companyContext.businessName}\n`;
      }
      if (companyContext.address) {
        prompt += `- Endereço: ${companyContext.address}\n`;
      }
      if (companyContext.openingHours) {
        prompt += `- Horário de funcionamento: ${companyContext.openingHours}\n`;
      }
      if (companyContext.deliveryPolicy) {
        prompt += `- Política de entrega: ${companyContext.deliveryPolicy}\n`;
      }
      if (companyContext.paymentMethods) {
        prompt += `- Formas de pagamento: ${companyContext.paymentMethods}\n`;
      }
      if (companyContext.phone) {
        prompt += `- Telefone: ${companyContext.phone}\n`;
      }
      prompt += `\n`;
    }

    // Todas as lojas (resumo)
    if (stores && stores.length > 0) {
      prompt += `LOJAS DISPONÍVEIS:\n`;
      stores.filter(store => store.isActive).forEach(store => {
        prompt += `- ${store.name} (${store.neighborhood}, ${store.city})\n`;
        prompt += `  Endereço: ${store.address}\n`;
        prompt += `  Horário: ${store.openingHours}\n`;
        if (store.phone) {
          prompt += `  Telefone: ${store.phone}\n`;
        }
        prompt += `\n`;
      });
    }

    // Políticas (filtradas pela loja selecionada se houver)
    if (policies && policies.length > 0) {
      let applicablePolicies = policies;
      if (selectedStoreId) {
        applicablePolicies = policies.filter(p => 
          p.applicableStores.length === 0 || p.applicableStores.includes(selectedStoreId)
        );
      }
      
      if (applicablePolicies.length > 0) {
        prompt += `POLÍTICAS CADASTRADAS:\n`;
        applicablePolicies.forEach(policy => {
          prompt += `- ${policy.title}:\n`;
          prompt += `  ${policy.content}\n\n`;
        });
      }
    }

    prompt += `
INSTRUÇÕES FINAIS:
- Se o cliente perguntar sobre algo que não está nas políticas acima, diga: "Não encontrei essa informação cadastrada. Um atendente humano irá confirmar para você."
- Se o cliente mencionar apenas um nome/bairro, trate como seleção de loja e confirme antes de responder.
- Seja sempre educado, breve e útil.
- Faça perguntas objetivas quando necessário (ex: "Qual loja?" / "Qual bairro?").`;

    return prompt;
  }

  /**
   * Chama a API da OpenAI com histórico de mensagens
   */
  private async callOpenAI(
    systemPrompt: string,
    userMessage: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    // Monta "input" no formato do Responses API
    // Mantemos: system + histórico + user atual
    const input: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    try {
      // Aumentar max_output_tokens para evitar respostas incompletas
      // Status "incomplete" geralmente indica que max_output_tokens foi muito baixo
      const maxOutputTokens = Math.max(1000, this.config.maxTokens || 1000);
      
      logger.pipeline('📤 Chamando OpenAI Responses API', {
        model: this.config.model,
        maxOutputTokens,
        inputLength: input.length,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
      });
      
      const response = await this.openai.responses.create({
        model: this.config.model || 'gpt-5-nano',

        // CRÍTICO: evita gastar tokens "pensando" e retornar nada
        reasoning: { effort: 'low' },

        // Aumentar para evitar status "incomplete"
        max_output_tokens: maxOutputTokens,

        input,
      });

      // DEBUG: Logar estrutura completa da resposta ANTES de verificar output_text
      // Usar múltiplos métodos de log para garantir que apareça
      console.log('══════════════════════════════════════════════════════════════════════');
      console.log('🔍 DEBUG: Estrutura completa da resposta OpenAI');
      console.log('══════════════════════════════════════════════════════════════════════');
      console.log('Model:', this.config.model);
      console.log('Response ID:', response.id);
      console.log('Status:', response.status);
      console.log('Has output_text:', typeof response.output_text === 'string');
      console.log('output_text value:', response.output_text);
      console.log('output_text length:', response.output_text?.length ?? 0);
      console.log('output_text type:', typeof response.output_text);
      console.log('Has output array:', Array.isArray(response.output));
      console.log('output length:', response.output?.length ?? 0);
      
      if (Array.isArray(response.output)) {
        console.log('Output types:', response.output.map((i: any) => i.type));
        response.output.forEach((item: any, index: number) => {
          console.log(`\n--- Output[${index}] ---`);
          console.log('Type:', item.type);
          console.log('Has content:', Array.isArray(item.content));
          console.log('Content length:', item.content?.length ?? 0);
          if (Array.isArray(item.content)) {
            console.log('Content types:', item.content.map((c: any) => c.type));
            item.content.forEach((c: any, cIndex: number) => {
              console.log(`  Content[${cIndex}]:`, {
                type: c.type,
                hasText: typeof c.text === 'string',
                textLength: c.text?.length ?? 0,
                textPreview: typeof c.text === 'string' ? c.text.substring(0, 200) : 'N/A',
              });
            });
          }
        });
      }
      
      console.log('Response keys:', Object.keys(response));
      console.log('Full response (first 3000 chars):', JSON.stringify(response, null, 2).substring(0, 3000));
      console.log('══════════════════════════════════════════════════════════════════════\n');
      
      // Também logar via logger para manter consistência
      logger.pipeline('🔍 DEBUG: Estrutura da resposta OpenAI', {
        model: this.config.model,
        responseId: response.id,
        status: response.status,
        hasOutputText: typeof response.output_text === 'string',
        outputTextValue: response.output_text,
        outputTextLength: response.output_text?.length ?? 0,
        outputLength: response.output?.length ?? 0,
        outputTypes: Array.isArray(response.output) ? response.output.map((i: any) => i.type) : [],
      });

      // Verificar se a resposta está incompleta
      if (response.status === 'incomplete') {
        console.log('⚠️ ATENÇÃO: Resposta com status "incomplete"');
        console.log('Isso geralmente significa que max_output_tokens foi muito baixo ou a resposta foi cortada.');
        logger.pipeline('⚠️ Resposta incompleta detectada', {
          status: response.status,
          maxOutputTokens,
          responseId: response.id,
        });
        
        // Tentar aumentar max_output_tokens e fazer uma nova chamada (fallback)
        // Mas primeiro, tentar extrair o que já foi gerado
      }
      
      // Tentar extrair texto de múltiplos caminhos (como no LanguageAgent)
      let text = response.output_text?.trim();
      
      // Se output_text estiver vazio, tentar extrair de output[].content[]
      if (!text && Array.isArray(response.output)) {
        console.log('⚠️ output_text vazio - tentando extrair de output[].content[]');
        console.log('Output length:', response.output.length);
        
        const parts: string[] = [];
        for (const item of response.output) {
          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c.type === 'output_text' && typeof c.text === 'string') {
                parts.push(c.text);
                console.log('✅ Encontrado texto em output[].content[]', {
                  itemType: item.type,
                  contentType: c.type,
                  textLength: c.text.length,
                  textPreview: c.text.substring(0, 100),
                });
              }
            }
          }
        }
        
        if (parts.length > 0) {
          text = parts.join('').trim();
          console.log('✅ Texto extraído de output[].content[]', {
            partsFound: parts.length,
            totalLength: text.length,
            textPreview: text.substring(0, 200),
          });
          logger.pipeline('✅ Texto extraído de output[].content[]', {
            partsFound: parts.length,
            totalLength: text.length,
          });
        } else {
          console.log('❌ Nenhum texto encontrado em output[].content[]');
        }
      }

      if (!text) {
        // Se status for incomplete e ainda não tiver texto, tentar retry com mais tokens
        if (response.status === 'incomplete' && maxOutputTokens < 2000) {
          console.log('🔄 Tentando retry com max_output_tokens aumentado...');
          logger.pipeline('🔄 Retry com mais tokens', {
            previousMaxTokens: maxOutputTokens,
            newMaxTokens: 2000,
          });
          
          try {
            const retryResponse = await this.openai.responses.create({
              model: this.config.model || 'gpt-5-nano',
              reasoning: { effort: 'low' },
              max_output_tokens: 2000, // Aumentar significativamente
              input,
            });
            
            text = retryResponse.output_text?.trim();
            
            if (!text && Array.isArray(retryResponse.output)) {
              const parts: string[] = [];
              for (const item of retryResponse.output) {
                if (Array.isArray(item.content)) {
                  for (const c of item.content) {
                    if (c.type === 'output_text' && typeof c.text === 'string') {
                      parts.push(c.text);
                    }
                  }
                }
              }
              if (parts.length > 0) {
                text = parts.join('').trim();
              }
            }
            
            if (text) {
              console.log('✅ Retry bem-sucedido!');
              logger.pipeline('✅ Retry bem-sucedido', { textLength: text.length });
              return text;
            }
          } catch (retryError) {
            console.log('❌ Retry falhou:', retryError);
            logger.pipeline('❌ Retry falhou', {
              error: retryError instanceof Error ? retryError.message : String(retryError),
            });
          }
        }
        
        console.log('══════════════════════════════════════════════════════════════════════');
        console.log('❌ ERRO: OpenAI retornou resposta vazia');
        console.log('══════════════════════════════════════════════════════════════════════');
        console.log('Model:', this.config.model);
        console.log('Response ID:', response.id);
        console.log('Status:', response.status);
        console.log('Has output_text:', typeof response.output_text === 'string');
        console.log('output_text value:', response.output_text);
        console.log('Output length:', response.output?.length ?? 0);
        console.log('Output types:', Array.isArray(response.output) ? response.output.map((i: any) => i.type) : []);
        console.log('Max output tokens usado:', maxOutputTokens);
        console.log('\n--- Input enviado ---');
        console.log('Input length:', input.length);
        console.log('System prompt length:', systemPrompt.length);
        console.log('User message length:', userMessage.length);
        console.log('History length:', history.length);
        console.log('User message preview:', userMessage.substring(0, 200));
        console.log('System prompt preview:', systemPrompt.substring(0, 300));
        console.log('══════════════════════════════════════════════════════════════════════\n');
        
        logger.ai('❌ OpenAI API returned empty response (responses.output_text vazio)', {
          model: this.config.model,
          responseId: response.id,
          status: response.status,
          hasOutputText: typeof response.output_text === 'string',
          outputTextValue: response.output_text,
          outputLength: response.output?.length ?? 0,
          outputTypes: Array.isArray(response.output) ? response.output.map((i: any) => i.type) : [],
          maxOutputTokens,
          inputLength: input.length,
          systemPromptLength: systemPrompt.length,
          userMessageLength: userMessage.length,
          historyLength: history.length,
        });
        
        throw new Error('OpenAI API returned empty response (responses.output_text vazio)');
      }

      return text;
    } catch (error) {
      logger.ai('❌ Erro ao chamar OpenAI Responses API', {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        errorStack: error instanceof Error ? error.stack : undefined,
        model: this.config.model,
        // Logar detalhes do erro se for um erro da OpenAI
        errorStatus: (error as any)?.status,
        errorCode: (error as any)?.code,
        errorType: (error as any)?.type,
        errorResponse: (error as any)?.response ? JSON.stringify((error as any).response).substring(0, 1000) : undefined,
        // Logar input que causou o erro
        inputLength: input.length,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        historyLength: history.length,
      });
      throw error;
    }
  }
}
