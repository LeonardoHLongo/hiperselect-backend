/**
 * Intent Router - Camada de Classificação e Triagem
 * 
 * Responsabilidade:
 * - Classificar mensagens em Intents usando Vercel AI SDK
 * - Analisar sentimento do cliente
 * - Extrair entidades (loja, produto, etc.)
 * - Identificar riscos à reputação
 * 
 * NÃO contém lógica de negócio - apenas classificação
 */
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import type { RouterInput, RouterOutput, ContextSnapshot } from './types';
import { RouterResultSchema, IntentSchema, SentimentSchema } from './schemas';

type RouterDependencies = {
  openaiApiKey: string;
};

export class IntentRouter {
  private model: any;
  private fallbackModel: any;
  private openai: any;

  constructor(private deps: RouterDependencies) {
    // Validar chave API
    if (!deps.openaiApiKey || deps.openaiApiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for IntentRouter');
    }

    // Usar modelo OpenAI via Vercel AI SDK
    // Usar GPT-4o-mini como principal (otimizado para Structured Outputs JSON)
    // Este modelo é nativamente otimizado para retornar JSON estruturado, eliminando retries do Zod
    this.openai = createOpenAI({ apiKey: deps.openaiApiKey });
    this.model = this.openai('gpt-4o-mini');
    // Fallback para gpt-4o caso gpt-4o-mini não esteja disponível
    this.fallbackModel = this.openai('gpt-4o');
    
    logger.pipeline('✅ IntentRouter inicializado', {
      primaryModel: 'gpt-4o-mini',
      fallbackModel: 'gpt-4o',
      hasApiKey: !!deps.openaiApiKey,
      apiKeyLength: deps.openaiApiKey.length,
      apiKeyPrefix: deps.openaiApiKey.substring(0, 7) + '...',
      note: 'Modelo otimizado para Structured Outputs (latência ~1s)',
    });
  }

  /**
   * Classifica uma mensagem em um Intent e analisa sentimento
   */
  async classify(input: RouterInput): Promise<RouterOutput> {
    const traceId = input.traceId || `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    logger.section('Intent Router - Classificação', '🧠');
    logger.pipeline('Iniciando classificação', {
      messageId: input.messageId,
      conversationId: input.conversationId,
      traceId,
      messagePreview: input.messageText.substring(0, 50),
    });
    
    const startTime = Date.now();
    
    try {
      // Preparar contexto para o LLM
      const contextInfo = this.buildContextInfo(input.contextSnapshot);
      
      // Construir contexto da última ação do sistema (Context-Aware)
      const lastSystemActionContext = this.buildLastSystemActionContext(input.lastSystemAction);
      
      // Construir histórico de mensagens para resolver ambiguidades e identificar lojas
      let historyContext = '';
      let storeFromHistory: string | null = null;
      
      if (input.messageHistory && input.messageHistory.length > 0) {
        // Procurar menções de loja no histórico (últimas 5 mensagens)
        const historyText = input.messageHistory.map(msg => msg.content).join(' ').toLowerCase();
        
        // Padrões comuns de menção de loja
        const storePatterns = [
          /(?:da|de|na|em|unidade|loja)\s+([a-záàâãéèêíìîóòôõúùûç\s]+?)(?:\s|$|,|\.|!|\?)/gi,
          /(?:armação|centro|vila|bairro|são\s+[a-z]+)/gi,
        ];
        
        for (const pattern of storePatterns) {
          const matches = historyText.match(pattern);
          if (matches && matches.length > 0) {
            // Pegar a última menção (mais recente)
            const lastMatch = matches[matches.length - 1];
            // Limpar e normalizar
            storeFromHistory = lastMatch.replace(/(?:da|de|na|em|unidade|loja)\s+/gi, '').trim();
            if (storeFromHistory.length > 2 && storeFromHistory.length < 50) {
              break;
            }
          }
        }
        
        historyContext = `\n\nHISTÓRICO DE CONVERSA (últimas ${input.messageHistory.length} mensagens):\n${input.messageHistory.map((msg, idx) => `${msg.role === 'user' ? 'Cliente' : 'Atendente'}: ${msg.content}`).join('\n')}\n\nIMPORTANTE: 
1. Use este histórico para resolver ambiguidades. Se a última pergunta do atendente foi sobre reserva e o cliente respondeu "sim", "claro", "por favor" ou similar, a intenção DEVE ser RESERVATION_REQUEST e não HUMAN_REQUEST.
2. Se o cliente mencionou uma loja no histórico (ex: "da Armação", "na unidade Centro"), extraia o store_name dessa menção.${storeFromHistory ? `\n3. LOJA IDENTIFICADA NO HISTÓRICO: "${storeFromHistory}" - use este valor para store_name se a mensagem atual não mencionar loja explicitamente.` : ''}`;
      }
      
      // storesListContext removido - extração de lojas será feita pelo EntityExtractorAgent
      const storesListContext = '';
      
      // Variável para armazenar storeFromHistory para uso posterior (será usado após validação)
      const storeFromHistoryValue = storeFromHistory;
      
      logger.pipeline('Chamando OpenAI para classificação', {
        traceId,
        hasContext: !!input.contextSnapshot,
        hasHistory: !!(input.messageHistory && input.messageHistory.length > 0),
        historyLength: input.messageHistory?.length || 0,
      });

      let rawResult: any;
      let usedFallback = false;
      
      // Bloquear intents de cliente se for gerente
      const isManager = input.isManager === true;
      const managerBlockNote = isManager ? `\n\n⚠️ ATENÇÃO: Esta mensagem é de um GERENTE (funcionário interno). NUNCA classifique como PRICE_INQUIRY ou RESERVATION_REQUEST. Gerentes não fazem pedidos de cliente. Se a mensagem não se encaixar em nenhuma intenção, use HUMAN_REQUEST ou UNKNOWN.` : '';
      
      try {
        const result = await generateObject({
          model: this.model,
          schema: RouterResultSchema,
          // Temperature padrão para gpt-4o-mini (otimizado para structured outputs)
          prompt: `Você é um classificador de intenções para um sistema de atendimento ao cliente de SUPERMERCADO (Hiper Select).

IMPORTANTE: A Hiper Select é uma REDE DE SUPERMERCADOS, não uma ótica. O contexto é sempre sobre produtos alimentícios, ofertas, setores (padaria, açougue, hortifruti), não sobre óculos ou produtos de visão.

⚠️ REGRA CRÍTICA DE CONFIANÇA:
Se a mensagem do cliente fugir TOTALMENTE do contexto de um supermercado (ex: assuntos bizarros, pedidos impossíveis, gírias incompreensíveis, temas aleatórios como drones/patinação/viagens, ou qualquer coisa que não tenha relação com supermercado), você DEVE classificar como UNKNOWN com CONFIDENCE 0.1 para forçar o atendimento humano. NÃO tente classificar mensagens absurdas ou fora de contexto - use intent UNKNOWN com confidence 0.1.

⚠️ REGRA DE INCOERÊNCIA:
Se o cliente pedir para usar um produto de forma não convencional ou absurda (ex: "pão para colar azulejo", "leite para limpar vidro", "arroz para fazer tinta"), isso é uma INCOERÊNCIA. Classifique como UNKNOWN com confiança 0.1. NÃO use SALUTATION como fallback para mensagens complexas ou absurdas - se você está em dúvida (confidence < 0.80), aceite que está em dúvida e classifique como UNKNOWN com confidence 0.1.

${managerBlockNote}

### EXAMPLES OF COMPLEX ROUTING (FEW-SHOT LEARNING) ###

Estes exemplos demonstram como classificar mensagens que dependem de contexto histórico:

Scenario 1: User gives a short positive answer after a feedback check-in.
- System asked: "Deu tudo certo com a retirada? Foi bem atendido pela nossa equipe?"
- User says: "Sim, excelente!"
- Correct Output: { 
  "reasoning": "User is confirming a positive experience from a previous system question about feedback check-in. The system asked about pickup experience, and user responded positively with 'Sim, excelente!'. This is a feedback submission, not a new inquiry. Sentiment is clearly PROMOTER.", 
  "intent": "SALUTATION", 
  "sentiment": "PROMOTER",
  "confidence": 0.95
}

Scenario 2: User answers a question about store location.
- System asked: "Em qual unidade você está?"
- User says: "Tô na armação"
- Correct Output: { 
  "reasoning": "User is providing the store location requested in the previous turn. The system asked 'Em qual unidade você está?' and user responded with 'Tô na armação'. This is completing the previous PRICE_INQUIRY flow by providing the missing information. Intent remains PRICE_INQUIRY.", 
  "intent": "PRICE_INQUIRY", 
  "sentiment": "NEUTRAL",
  "confidence": 0.9
}

Scenario 3: User asks about a product casually.
- User says: "Moro no rio tavares, tem picanha?"
- Correct Output: { 
  "reasoning": "User is asking about product availability ('tem picanha?') while mentioning their location. The primary intent is PRICE_INQUIRY (asking about product). Sentiment is neutral.", 
  "intent": "PRICE_INQUIRY", 
  "sentiment": "NEUTRAL",
  "confidence": 0.9
}

Scenario 4: User confirms a reservation offer with a short answer.
- System asked: "Quer que eu peça para separarem 2 ovos na unidade Armação?"
- User says: "Sim, por favor"
- Correct Output: { 
  "reasoning": "User is confirming a reservation offer from the previous system message. The system offered to reserve 2 eggs at Armação store, and user confirmed with 'Sim, por favor'. This is a RESERVATION_REQUEST confirmation, not a new inquiry.", 
  "intent": "RESERVATION_REQUEST", 
  "sentiment": "NEUTRAL",
  "confidence": 0.95
}

Scenario 5: User gives negative feedback after check-in.
- System asked: "Deu tudo certo com a retirada? Foi bem atendido?"
- User says: "Não, não gostei"
- Correct Output: { 
  "reasoning": "User is providing negative feedback in response to the system's check-in question. The system asked about pickup experience, and user responded negatively with 'Não, não gostei'. This is a feedback submission with negative sentiment DISSATISFIED.", 
  "intent": "SALUTATION", 
  "sentiment": "DISSATISFIED",
  "confidence": 0.9
}

### END OF EXAMPLES ###

Analise a mensagem do cliente e classifique em uma das seguintes intenções:

1. URGENT_COMPLAINT: Reclamações graves, problemas de saúde, falhas operacionais críticas, produtos estragados, problemas de segurança
2. PRICE_INQUIRY: Perguntas sobre preços, disponibilidade, promoções, ofertas${isManager ? ' (BLOQUEADO para gerentes)' : ''}
3. STORE_INFO: Horários, endereços, contatos das unidades, localização
4. SALUTATION: Cumprimentos iniciais (oi, olá, bom dia, boa tarde, boa noite) - APENAS para saudações claras e simples
5. HUMAN_REQUEST: Cliente pede explicitamente para falar com um humano, atendente ou pessoa
6. RESERVATION_REQUEST: Cliente quer fazer reserva de produtos, agendar retirada, ou confirmar horário de pickup${isManager ? ' (BLOQUEADO para gerentes)' : ''}
7. ACKNOWLEDGMENT: Se o usuário responder com concordâncias curtas, agradecimentos ou confirmações passivas (ex: 'ok', 'beleza', 'tá bom', 'obrigado', 'no aguardo', '👍', 'perfeito', 'entendi') em resposta a uma ação do sistema (ex: após o sistema dizer que vai chamar o gerente, ou após confirmar uma informação), classifique como ACKNOWLEDGMENT. Esta intenção permite que o sistema fique calado e não responda desnecessariamente.
8. UNKNOWN: Use APENAS quando a mensagem for incoerente, absurda, fora de contexto de supermercado, ou quando você estiver em dúvida (confidence < 0.80). NÃO use SALUTATION como fallback para mensagens complexas.

Além disso, analise o SENTIMENTO do cliente:
- PROMOTER: Cliente satisfeito, elogios, feedback positivo (ex: "excelente", "ótimo", "adorei")
- NEUTRAL: Cliente neutro, apenas fazendo perguntas sem carga emocional
- DISSATISFIED: Cliente insatisfeito, reclamando, frustrado (ex: "ruim", "péssimo", "não gostei")

⚠️ IMPORTANTE: Você NÃO deve extrair entidades (produtos, lojas, horários, quantidades). 
Sua única responsabilidade é classificar a INTENÇÃO e o SENTIMENTO.
A extração de entidades será feita por outro agente especializado, se necessário.

${lastSystemActionContext}${contextInfo}${historyContext}

Mensagem do cliente: "${input.messageText}"

### INSTRUÇÕES DE CLASSIFICAÇÃO (CHAIN OF THOUGHT) ###

IMPORTANTE: Você DEVE seguir esta ordem de raciocínio:

1. **PRIMEIRO**: Escreva o campo "reasoning" explicando passo-a-passo:
   - O que o usuário disse na mensagem atual
   - O contexto da conversa anterior (última ação do sistema, histórico)
   - Por que escolheu este intent específico
   - Como o contexto histórico influenciou a classificação
   - NÃO mencione extração de entidades - isso não é sua responsabilidade

2. **DEPOIS**: Preencha os demais campos baseado no seu raciocínio:
   - intent: baseado na análise do reasoning
   - sentiment: baseado na carga emocional detectada
   - confidence: baseado na clareza da mensagem e contexto disponível
   - isReputationAtRisk: calculado automaticamente

### REGRAS DE CLASSIFICAÇÃO ###

- Se houver dúvida entre URGENT_COMPLAINT e outro intent, priorize URGENT_COMPLAINT para garantir que reclamações graves sejam tratadas imediatamente.
- Se a última pergunta da IA foi sobre reserva e o cliente respondeu 'sim', 'claro' ou 'por favor', a intenção DEVE ser RESERVATION_REQUEST e não HUMAN_REQUEST.
- Se a mensagem é uma resposta curta a uma pergunta anterior do sistema, mantenha o contexto do fluxo anterior.
- NUNCA use UNKNOWN se puder inferir pelo histórico ou contexto. Use UNKNOWN apenas para mensagens totalmente incoerentes ou fora do contexto de supermercado.
- Lembre-se: contexto é SUPERMERCADO (alimentos, ofertas, setores), nunca ótica ou óculos.

Classifique a mensagem com precisão máxima, seguindo o Chain of Thought (reasoning primeiro).`,
        });
        
        rawResult = result.object;
        
        logger.pipeline('Resposta recebida do OpenAI (gpt-4o-mini)', {
          traceId,
          hasResult: !!rawResult,
          resultKeys: rawResult ? Object.keys(rawResult) : [],
          resultType: typeof rawResult,
        });
      } catch (openaiError) {
        // Tentar fallback (mesmo modelo)
        const errorMessage = openaiError instanceof Error ? openaiError.message : String(openaiError);
        const errorStack = openaiError instanceof Error ? openaiError.stack : undefined;
        const errorName = openaiError instanceof Error ? openaiError.name : 'Unknown';
        
        // Detectar tipo de erro
        const isAuthError = errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid API key') || errorMessage.includes('authentication');
        const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Rate limit');
        const isModelError = errorMessage.includes('model') || errorMessage.includes('Model') || errorMessage.includes('not found');
        const isNetworkError = errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT');
        
        logger.error('❌ Erro ao chamar OpenAI (primeira tentativa)', {
          traceId,
        });
        console.error('📋 Detalhes do erro:', {
          traceId,
          error: errorMessage,
          errorName,
          errorType: isAuthError ? 'AUTHENTICATION' : isRateLimit ? 'RATE_LIMIT' : isModelError ? 'MODEL_ERROR' : isNetworkError ? 'NETWORK_ERROR' : 'UNKNOWN',
          stack: errorStack,
          model: 'gpt-4o-mini',
          hasApiKey: !!this.deps.openaiApiKey,
          apiKeyLength: this.deps.openaiApiKey ? this.deps.openaiApiKey.length : 0,
          apiKeyPrefix: this.deps.openaiApiKey ? this.deps.openaiApiKey.substring(0, 10) + '...' : 'N/A',
          apiKeySuffix: this.deps.openaiApiKey && this.deps.openaiApiKey.length > 10 ? '...' + this.deps.openaiApiKey.substring(this.deps.openaiApiKey.length - 4) : 'N/A',
          messageLength: input.messageText.length,
          contextLength: contextInfo.length,
        });
        
        if (isAuthError) {
          logger.error('🔐 ERRO DE AUTENTICAÇÃO: Verifique se OPENAI_API_KEY está correta no .env', {
            traceId,
            apiKeyFormat: this.deps.openaiApiKey ? (this.deps.openaiApiKey.startsWith('sk-') ? '✅ Começa com sk-' : '❌ NÃO começa com sk-') : 'N/A',
          });
        }
        
        if (isModelError) {
          logger.error('🤖 ERRO DE MODELO: O modelo pode não estar disponível ou o nome está incorreto', {
            traceId,
            modelAttempted: 'gpt-4o-mini',
          });
        }
        
        if (isRateLimit) {
          logger.error('⏱️ RATE LIMIT: Muitas requisições. Aguarde antes de tentar novamente', {
            traceId,
          });
        }
        
        if (isNetworkError) {
          logger.error('🌐 ERRO DE REDE: Problema de conexão com a API da OpenAI', {
            traceId,
          });
        }
        
        logger.warning('⚠️ Tentando novamente com fallback...', {
          traceId,
        });
        
        try {
          const fallbackResult = await generateObject({
            model: this.fallbackModel,
            schema: RouterResultSchema,
            // Temperature padrão para gpt-4o-mini (otimizado para structured outputs)
            prompt: `Você é um classificador de intenções para um sistema de atendimento ao cliente de SUPERMERCADO (Hiper Select).

IMPORTANTE: A Hiper Select é uma REDE DE SUPERMERCADOS, não uma ótica. O contexto é sempre sobre produtos alimentícios, ofertas, setores (padaria, açougue, hortifruti), não sobre óculos ou produtos de visão.

Analise a mensagem do cliente e classifique em uma das seguintes intenções:

1. URGENT_COMPLAINT: Reclamações graves, problemas de saúde, falhas operacionais críticas, produtos estragados, problemas de segurança
2. PRICE_INQUIRY: Perguntas sobre preços, disponibilidade, promoções, ofertas
3. STORE_INFO: Horários, endereços, contatos das unidades, localização
4. SALUTATION: Cumprimentos iniciais (oi, olá, bom dia, boa tarde, boa noite)
5. HUMAN_REQUEST: Cliente pede explicitamente para falar com um humano, atendente ou pessoa
6. RESERVATION_REQUEST: Cliente quer fazer reserva de produtos, agendar retirada, ou confirmar horário de pickup
7. ACKNOWLEDGMENT: Se o usuário responder com concordâncias curtas, agradecimentos ou confirmações passivas (ex: 'ok', 'beleza', 'tá bom', 'obrigado', 'no aguardo', '👍', 'perfeito', 'entendi') em resposta a uma ação do sistema, classifique como ACKNOWLEDGMENT

Além disso, analise o SENTIMENTO do cliente:
- PROMOTER: Cliente satisfeito, elogios, feedback positivo (ex: "excelente", "ótimo", "adorei")
- NEUTRAL: Cliente neutro, apenas fazendo perguntas sem carga emocional
- DISSATISFIED: Cliente insatisfeito, reclamando, frustrado (ex: "ruim", "péssimo", "não gostei")

⚠️ IMPORTANTE: Você NÃO deve extrair entidades (produtos, lojas, horários, quantidades). 
Sua única responsabilidade é classificar a INTENÇÃO e o SENTIMENTO.
A extração de entidades será feita por outro agente especializado, se necessário.

${lastSystemActionContext}${contextInfo}${historyContext}

Mensagem do cliente: "${input.messageText}"

Classifique a mensagem com precisão. Se houver dúvida entre URGENT_COMPLAINT e outro intent, priorize URGENT_COMPLAINT para garantir que reclamações graves sejam tratadas imediatamente.
Se a última pergunta da IA foi sobre reserva e o cliente respondeu 'sim', 'claro' ou 'por favor', a intenção DEVE ser RESERVATION_REQUEST e não HUMAN_REQUEST.

Lembre-se: contexto é SUPERMERCADO (alimentos, ofertas, setores), nunca ótica ou óculos.`,
          });
          
          rawResult = fallbackResult.object;
          usedFallback = true;
          
          logger.pipeline('✅ Resposta recebida do OpenAI (tentativa 2)', {
            traceId,
            hasResult: !!rawResult,
            resultKeys: rawResult ? Object.keys(rawResult) : [],
          });
        } catch (fallbackError) {
          // Se fallback também falhar, lançar erro
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          const fallbackErrorStack = fallbackError instanceof Error ? fallbackError.stack : undefined;
          const fallbackErrorName = fallbackError instanceof Error ? fallbackError.name : 'Unknown';
          
          const primaryErrorMessage = openaiError instanceof Error ? openaiError.message : String(openaiError);
          const primaryErrorStack = openaiError instanceof Error ? openaiError.stack : undefined;
          const primaryErrorName = openaiError instanceof Error ? openaiError.name : 'Unknown';
          
          // Detectar tipo de erro (fallback)
          const isAuthError = fallbackErrorMessage.includes('401') || fallbackErrorMessage.includes('Unauthorized') || fallbackErrorMessage.includes('Invalid API key') || fallbackErrorMessage.includes('authentication') ||
                             primaryErrorMessage.includes('401') || primaryErrorMessage.includes('Unauthorized') || primaryErrorMessage.includes('Invalid API key') || primaryErrorMessage.includes('authentication');
          const isRateLimit = fallbackErrorMessage.includes('429') || fallbackErrorMessage.includes('rate limit') || fallbackErrorMessage.includes('Rate limit') ||
                             primaryErrorMessage.includes('429') || primaryErrorMessage.includes('rate limit') || primaryErrorMessage.includes('Rate limit');
          const isModelError = fallbackErrorMessage.includes('model') || fallbackErrorMessage.includes('Model') || fallbackErrorMessage.includes('not found') ||
                              primaryErrorMessage.includes('model') || primaryErrorMessage.includes('Model') || primaryErrorMessage.includes('not found');
          const isNetworkError = fallbackErrorMessage.includes('network') || fallbackErrorMessage.includes('timeout') || fallbackErrorMessage.includes('ECONNREFUSED') || fallbackErrorMessage.includes('ETIMEDOUT') ||
                                primaryErrorMessage.includes('network') || primaryErrorMessage.includes('timeout') || primaryErrorMessage.includes('ECONNREFUSED') || primaryErrorMessage.includes('ETIMEDOUT');
          
          logger.error('❌ Erro ao chamar OpenAI (ambas tentativas falharam)', {
            traceId,
          });
          console.error('\n═══════════════════════════════════════════════════════════');
          console.error('📋 DETALHES COMPLETOS DO ERRO');
          console.error('═══════════════════════════════════════════════════════════\n');
          console.error('=== PRIMEIRA TENTATIVA ===');
          console.error(JSON.stringify({
            error: primaryErrorMessage,
            errorName: primaryErrorName,
            errorType: isAuthError ? 'AUTHENTICATION' : isRateLimit ? 'RATE_LIMIT' : isModelError ? 'MODEL_ERROR' : isNetworkError ? 'NETWORK_ERROR' : 'UNKNOWN',
            stack: primaryErrorStack,
          }, null, 2));
          console.error('\n=== SEGUNDA TENTATIVA (FALLBACK) ===');
          console.error(JSON.stringify({
            error: fallbackErrorMessage,
            errorName: fallbackErrorName,
            errorType: isAuthError ? 'AUTHENTICATION' : isRateLimit ? 'RATE_LIMIT' : isModelError ? 'MODEL_ERROR' : isNetworkError ? 'NETWORK_ERROR' : 'UNKNOWN',
            stack: fallbackErrorStack,
          }, null, 2));
          console.error('\n=== CONFIGURAÇÃO ===');
          console.error(JSON.stringify({
            model: 'gpt-4o-mini',
            hasApiKey: !!this.deps.openaiApiKey,
            apiKeyLength: this.deps.openaiApiKey ? this.deps.openaiApiKey.length : 0,
            apiKeyPrefix: this.deps.openaiApiKey ? this.deps.openaiApiKey.substring(0, 10) + '...' : 'N/A',
            apiKeySuffix: this.deps.openaiApiKey && this.deps.openaiApiKey.length > 10 ? '...' + this.deps.openaiApiKey.substring(this.deps.openaiApiKey.length - 4) : 'N/A',
            apiKeyFormat: this.deps.openaiApiKey ? (this.deps.openaiApiKey.startsWith('sk-') ? '✅ Começa com sk-' : '❌ NÃO começa com sk-') : 'N/A',
            messageLength: input.messageText.length,
            contextLength: contextInfo.length,
          }, null, 2));
          console.error('\n=== DIAGNÓSTICO ===');
          console.error(JSON.stringify({
            isAuthError,
            isRateLimit,
            isModelError,
            isNetworkError,
          }, null, 2));
          console.error('\n═══════════════════════════════════════════════════════════\n');
          
          if (isAuthError) {
            logger.error('🔐 ERRO DE AUTENTICAÇÃO CRÍTICO', {
              traceId,
              message: 'A chave API da OpenAI está incorreta ou inválida',
              action: 'Verifique o arquivo .env e certifique-se de que OPENAI_API_KEY está configurada corretamente',
              apiKeyCheck: this.deps.openaiApiKey ? {
                hasKey: true,
                length: this.deps.openaiApiKey.length,
                startsWithSk: this.deps.openaiApiKey.startsWith('sk-'),
                prefix: this.deps.openaiApiKey.substring(0, 10),
                suffix: this.deps.openaiApiKey.substring(this.deps.openaiApiKey.length - 4),
              } : { hasKey: false },
            });
          }
          
          if (isModelError) {
            logger.error('🤖 ERRO DE MODELO CRÍTICO', {
              traceId,
              message: 'O modelo gpt-4o-mini pode não estar disponível ou o nome está incorreto',
              action: 'Verifique se o modelo está disponível na sua conta OpenAI',
              modelAttempted: 'gpt-4o-mini',
            });
          }
          
          if (isRateLimit) {
            logger.error('⏱️ RATE LIMIT CRÍTICO', {
              traceId,
              message: 'Muitas requisições foram feitas. Aguarde antes de tentar novamente',
              action: 'Aguarde alguns minutos antes de fazer novas requisições',
            });
          }
          
          if (isNetworkError) {
            logger.error('🌐 ERRO DE REDE CRÍTICO', {
              traceId,
              message: 'Problema de conexão com a API da OpenAI',
              action: 'Verifique sua conexão com a internet e tente novamente',
            });
          }
          
          throw openaiError; // Re-throw para ser capturado pelo catch externo
        }
      }

      // Validação explícita com Zod para garantir estrutura correta
      let validatedResult: RouterResult;
      try {
        validatedResult = RouterResultSchema.parse(rawResult);
        
        // BLOQUEIO FORÇADO: Se for gerente, nunca permitir PRICE_INQUIRY ou RESERVATION_REQUEST
        if (isManager && (validatedResult.intent === 'PRICE_INQUIRY' || validatedResult.intent === 'RESERVATION_REQUEST')) {
          logger.pipeline('🚫 Intent de cliente bloqueado para gerente - reclassificando para SALUTATION', {
            originalIntent: validatedResult.intent,
            isManager: true,
          });
          validatedResult.intent = 'SALUTATION';
          validatedResult.confidence = 0.95; // Alta confiança na reclassificação
          validatedResult.reasoning = `Reclassificado de ${validatedResult.intent} para SALUTATION porque a mensagem é de um gerente (funcionário interno). Gerentes não fazem pedidos de cliente.`;
        }
        
        // REGRA: Se confiança < 0.80, NÃO reclassificar para SALUTATION - aceitar dúvida e usar UNKNOWN
        if (validatedResult.confidence < 0.80 && validatedResult.intent !== 'SALUTATION') {
          logger.warning('⚠️ Confiança baixa detectada - classificando como UNKNOWN para acionar humano', {
            traceId,
            originalIntent: validatedResult.intent,
            confidence: validatedResult.confidence,
            messagePreview: input.messageText.substring(0, 50),
          });
          
          validatedResult = {
            ...validatedResult,
            intent: 'UNKNOWN',
            confidence: 0.1,
            reasoning: `Confiança baixa (${validatedResult.confidence}) - mensagem complexa ou fora de contexto. Acionando atendimento humano.`,
          };
        }
        
        // Handoff Seguro: Se HUMAN_REQUEST com confiança baixa, verificar termos explícitos
        // Mas apenas se confiança >= 0.80 (caso contrário já foi tratado acima)
        if (validatedResult.intent === 'HUMAN_REQUEST' && validatedResult.confidence >= 0.70 && validatedResult.confidence < 0.80) {
          const messageLower = input.messageText.toLowerCase();
          const explicitTerms = ['atendente', 'falar com humano', 'pessoa', 'não quero mais falar com a ia', 'humano', 'atendimento humano'];
          const hasExplicitTerm = explicitTerms.some(term => messageLower.includes(term));
          
          if (!hasExplicitTerm) {
            logger.warning('⚠️ HUMAN_REQUEST com confiança baixa e sem termos explícitos - classificando como UNKNOWN', {
              traceId,
              confidence: validatedResult.confidence,
              messagePreview: input.messageText.substring(0, 50),
            });
            
            // Reclassificar baseado no contexto apenas se houver contexto de reserva
            const hasReservationContext = input.messageHistory?.some(msg => 
              msg.role === 'assistant' && 
              (msg.content.toLowerCase().includes('reserva') || msg.content.toLowerCase().includes('retirada'))
            );
            
            if (hasReservationContext) {
              validatedResult = {
                ...validatedResult,
                intent: 'RESERVATION_REQUEST',
                confidence: 0.65,
                reasoning: 'Reclassificado de HUMAN_REQUEST para RESERVATION_REQUEST devido ao contexto de reserva e ausência de termos explícitos',
              };
            } else {
              // NÃO usar SALUTATION como fallback - usar UNKNOWN
              validatedResult = {
                ...validatedResult,
                intent: 'UNKNOWN',
                confidence: 0.1,
                reasoning: 'HUMAN_REQUEST com confiança baixa e sem termos explícitos - acionando atendimento humano',
              };
            }
          }
        }
        
        logger.pipeline('✅ Validação Zod bem-sucedida', {
          traceId,
          intent: validatedResult.intent,
          sentiment: validatedResult.sentiment,
          confidence: validatedResult.confidence,
        });
      } catch (validationError) {
        logger.error('❌ Erro na validação Zod do resultado', {
          traceId,
          error: validationError instanceof Error ? validationError.message : String(validationError),
          rawResult: JSON.stringify(rawResult, null, 2),
          stack: validationError instanceof Error ? validationError.stack : undefined,
        });
        
        // Tentar construir resultado parcial se possível
        if (rawResult && typeof rawResult === 'object') {
          validatedResult = {
            intent: (rawResult as any).intent || 'UNKNOWN',
            sentiment: (rawResult as any).sentiment || 'NEUTRAL',
            confidence: typeof (rawResult as any).confidence === 'number' ? (rawResult as any).confidence : 0.5,
            reasoning: (rawResult as any).reasoning ? 
              (rawResult as any).reasoning.replace(/ótica|óculos|visão/gi, 'supermercado') + ' (contexto: supermercado)' :
              'Validação parcial devido a erro. Contexto: supermercado Hiper Select.',
            isReputationAtRisk: false, // Será calculado abaixo
          };
          logger.warning('⚠️ Usando resultado parcial após erro de validação (contexto: supermercado)', {
            traceId,
            validatedResult,
          });
        } else {
          throw new Error(`Resultado inválido do OpenAI: ${JSON.stringify(rawResult)}`);
        }
      }

      // Calcular isReputationAtRisk
      const isReputationAtRisk = 
        validatedResult.sentiment === 'DISSATISFIED' || 
        validatedResult.intent === 'URGENT_COMPLAINT';

      const routerResult: RouterOutput = {
        ...validatedResult,
        isReputationAtRisk,
      };

      const duration = Date.now() - startTime;
      
      logger.pipeline('✅ Classificação concluída', {
        traceId,
        intent: routerResult.intent,
        sentiment: routerResult.sentiment,
        isReputationAtRisk: routerResult.isReputationAtRisk,
        confidence: routerResult.confidence,
        duration: `${duration}ms`,
        usedFallback,
      });

      return routerResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : 'Unknown';
      
      // Detectar tipo de erro
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid API key') || errorMessage.includes('authentication');
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('Rate limit');
      const isModelError = errorMessage.includes('model') || errorMessage.includes('Model') || errorMessage.includes('not found');
      const isNetworkError = errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT');
      
      logger.error('❌ Erro ao classificar mensagem (catch final)', {
        traceId,
      });
      console.error('\n═══════════════════════════════════════════════════════════');
      console.error('📋 ERRO FINAL - DETALHES COMPLETOS');
      console.error('═══════════════════════════════════════════════════════════\n');
      console.error('=== CONTEXTO ===');
      console.error(JSON.stringify({
        traceId,
        messageId: input.messageId,
        conversationId: input.conversationId,
        messagePreview: input.messageText.substring(0, 100),
        hasContext: !!input.contextSnapshot,
        duration: `${duration}ms`,
      }, null, 2));
      console.error('\n=== ERRO ===');
      console.error(JSON.stringify({
        error: errorMessage,
        errorName,
        errorType: isAuthError ? 'AUTHENTICATION' : isRateLimit ? 'RATE_LIMIT' : isModelError ? 'MODEL_ERROR' : isNetworkError ? 'NETWORK_ERROR' : 'UNKNOWN',
        stack: errorStack,
      }, null, 2));
      console.error('\n=== DETALHES DO ERRO ===');
      console.error(JSON.stringify(error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: (error as any).cause,
      } : { rawError: String(error) }, null, 2));
      console.error('\n=== CONFIGURAÇÃO ===');
      console.error(JSON.stringify({
        hasApiKey: !!this.deps.openaiApiKey,
        apiKeyLength: this.deps.openaiApiKey ? this.deps.openaiApiKey.length : 0,
        apiKeyPrefix: this.deps.openaiApiKey ? this.deps.openaiApiKey.substring(0, 10) + '...' : 'N/A',
        apiKeySuffix: this.deps.openaiApiKey && this.deps.openaiApiKey.length > 10 ? '...' + this.deps.openaiApiKey.substring(this.deps.openaiApiKey.length - 4) : 'N/A',
        apiKeyFormat: this.deps.openaiApiKey ? (this.deps.openaiApiKey.startsWith('sk-') ? '✅ Começa com sk-' : '❌ NÃO começa com sk-') : 'N/A',
      }, null, 2));
      console.error('\n=== DIAGNÓSTICO ===');
      console.error(JSON.stringify({
        isAuthError,
        isRateLimit,
        isModelError,
        isNetworkError,
      }, null, 2));
      console.error('\n═══════════════════════════════════════════════════════════\n');
      
      if (isAuthError) {
        logger.error('🔐 ERRO DE AUTENTICAÇÃO DETECTADO NO CATCH FINAL', {
          traceId,
          message: 'A chave API da OpenAI está incorreta ou inválida',
          action: 'Verifique o arquivo .env e certifique-se de que OPENAI_API_KEY está configurada corretamente',
        });
      }
      
      if (isModelError) {
        logger.error('🤖 ERRO DE MODELO DETECTADO NO CATCH FINAL', {
          traceId,
          message: 'O modelo pode não estar disponível ou o nome está incorreto',
          action: 'Verifique se o modelo está disponível na sua conta OpenAI',
        });
      }
      
      if (isRateLimit) {
        logger.error('⏱️ RATE LIMIT DETECTADO NO CATCH FINAL', {
          traceId,
          message: 'Muitas requisições foram feitas. Aguarde antes de tentar novamente',
          action: 'Aguarde alguns minutos antes de fazer novas requisições',
        });
      }
      
      if (isNetworkError) {
        logger.error('🌐 ERRO DE REDE DETECTADO NO CATCH FINAL - Problema de conexão com a API da OpenAI');
      }
      
      // Fallback seguro: classificar como UNKNOWN se erro (para acionar humano)
      // IMPORTANTE: Não inventar contexto de ótica - sempre contexto de supermercado
      const fallbackResult: RouterOutput = {
        intent: 'UNKNOWN',
        sentiment: 'NEUTRAL',
        confidence: 0.1, // Confidence baixa para forçar waiting_human
        reasoning: `Erro na classificação (${error instanceof Error ? error.message : String(error)}) - usando fallback seguro. Contexto: supermercado Hiper Select (rede de supermercados, não ótica).`,
        isReputationAtRisk: false,
      };
      
      logger.warning('⚠️ Usando fallback seguro (contexto: supermercado) - classificando como UNKNOWN');
      
      return fallbackResult;
    }
  }

  /**
   * Constrói contexto da última ação do sistema para desambiguar mensagens curtas
   */
  private buildLastSystemActionContext(lastSystemAction?: string): string {
    if (!lastSystemAction) {
      return '';
    }

    // Mapear ações para descrições e regras de raciocínio
    const actionContexts: Record<string, { description: string; reasoningRules: string }> = {
      'feedback_checkin': {
        description: 'O sistema acabou de enviar uma mensagem de check-in perguntando sobre a retirada e o atendimento',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente é positiva ('sim', 'sim adorei', 'deu tudo certo', 'foi ótimo', 'excelente', 'perfeito', 'muito bem') → Classificar como resposta ao feedback_checkin com sentiment PROMOTER
- IF a mensagem do cliente é negativa ('não', 'não gostei', 'ruim', 'péssimo', 'não deu certo') → Classificar como resposta ao feedback_checkin com sentiment DISSATISFIED
- IF a mensagem do cliente é neutra mas menciona retirada/atendimento → Classificar como resposta ao feedback_checkin com sentiment NEUTRAL
- NÃO classificar como SALUTATION, PRICE_INQUIRY ou RESERVATION_REQUEST se for claramente uma resposta ao check-in`,
      },
      'asking_store': {
        description: 'O sistema acabou de perguntar em qual unidade/loja o cliente está',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente menciona nome de loja/bairro (ex: 'Armação', 'Centro', 'Lagoa') → Classificar como resposta fornecendo store_name, intent pode ser PRICE_INQUIRY ou RESERVATION_REQUEST dependendo do contexto
- IF a mensagem do cliente é curta e menciona apenas loja (ex: 'Armação', 'na Armação') → Extrair store_name e classificar baseado no histórico (se havia pergunta sobre produto/preço antes, manter PRICE_INQUIRY)
- IF a mensagem do cliente é 'não sei' ou 'não lembro' → Classificar como need_input, não como UNKNOWN`,
      },
      'asking_product': {
        description: 'O sistema acabou de perguntar qual produto o cliente quer consultar',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente menciona nome de produto (ex: 'ovo', 'leite', 'pão') → Classificar como PRICE_INQUIRY com product_name extraído
- IF a mensagem do cliente é curta e menciona apenas produto → Extrair product_name e classificar como PRICE_INQUIRY
- IF a mensagem do cliente é 'não sei' ou 'qualquer um' → Classificar como need_input, não como UNKNOWN`,
      },
      'confirming_order': {
        description: 'O sistema acabou de confirmar uma reserva ou pedido',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente é positiva ('obrigado', 'valeu', 'perfeito', 'ótimo') → Classificar como SALUTATION ou resposta de agradecimento, sentiment PROMOTER
- IF a mensagem do cliente é negativa ou questiona a confirmação → Classificar como URGENT_COMPLAINT ou HUMAN_REQUEST dependendo da gravidade
- NÃO classificar como nova RESERVATION_REQUEST se for apenas agradecimento`,
      },
      'asking_pickup_time': {
        description: 'O sistema acabou de perguntar o horário de retirada',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente menciona horário (ex: '16h', 'às 16', '16 horas', '4 da tarde') → Classificar como RESERVATION_REQUEST com pickup_time extraído
- IF a mensagem do cliente menciona tempo relativo (ex: 'agora', 'mais tarde', 'amanhã') → Classificar como RESERVATION_REQUEST, tentar extrair pickup_time
- IF a mensagem do cliente é 'não sei' ou 'qualquer hora' → Classificar como RESERVATION_REQUEST com pickup_time vazio`,
      },
      'asking_quantity': {
        description: 'O sistema acabou de perguntar a quantidade de produtos',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente menciona número ou quantidade (ex: '2', 'três', 'alguns', 'um') → Classificar como RESERVATION_REQUEST com quantity extraído
- IF a mensagem do cliente é curta e menciona apenas número → Extrair quantity e classificar como RESERVATION_REQUEST
- IF a mensagem do cliente é 'não sei' ou 'o que tiver' → Classificar como RESERVATION_REQUEST com quantity vazio ou padrão`,
      },
      'offering_reservation': {
        description: 'O sistema acabou de oferecer fazer uma reserva',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente é positiva ('sim', 'claro', 'por favor', 'quero', 'pode ser') → Classificar como RESERVATION_REQUEST (confirmação)
- IF a mensagem do cliente é negativa ('não', 'não quero', 'não precisa') → Classificar como resposta negativa, sentiment NEUTRAL, intent pode ser PRICE_INQUIRY ou SALUTATION
- NÃO classificar como HUMAN_REQUEST se for apenas confirmação de reserva`,
      },
      'greeting': {
        description: 'O sistema acabou de enviar uma saudação inicial',
        reasoningRules: `REGRAS DE RACIOCÍNIO (CHAIN OF THOUGHT):
- IF a mensagem do cliente é saudação de volta ('oi', 'olá', 'bom dia') → Classificar como SALUTATION
- IF a mensagem do cliente já faz uma pergunta direta → Classificar baseado na pergunta (PRICE_INQUIRY, STORE_INFO, etc), não como SALUTATION
- NÃO classificar como SALUTATION se o cliente já está fazendo uma solicitação`,
      },
    };

    const context = actionContexts[lastSystemAction];
    if (!context) {
      return '';
    }

    return `\n\n═══════════════════════════════════════════════════════════
🎯 CONTEXTO DA ÚLTIMA AÇÃO DO SISTEMA (CONTEXT-AWARE)
═══════════════════════════════════════════════════════════

PREVIOUS SYSTEM ACTION: ${lastSystemAction}
DESCRIÇÃO: ${context.description}

${context.reasoningRules}

IMPORTANTE: A mensagem do cliente pode ser uma resposta direta a esta ação. Use este contexto para desambiguar mensagens curtas como "sim", "não", "excelente", "16h", etc.

═══════════════════════════════════════════════════════════\n\n`;
  }

  /**
   * Constrói string de contexto para o prompt
   */
  private buildContextInfo(snapshot?: ContextSnapshot): string {
    if (!snapshot) {
      return 'Nenhum contexto anterior disponível.';
    }

    const parts: string[] = [];
    
    if (snapshot.currentIntent) {
      parts.push(`Intenção anterior: ${snapshot.currentIntent}`);
    }
    
    if (snapshot.selectedStoreName) {
      parts.push(`Loja selecionada: ${snapshot.selectedStoreName}`);
    }
    
    if (snapshot.isReputationAtRisk) {
      parts.push('⚠️ ATENÇÃO: Reputação em risco detectada anteriormente');
    }
    
    if (snapshot.pendingFields && snapshot.pendingFields.length > 0) {
      parts.push(`Campos pendentes: ${snapshot.pendingFields.join(', ')}`);
    }
    
    if (snapshot.sentimentHistory && snapshot.sentimentHistory.length > 0) {
      const lastSentiment = snapshot.sentimentHistory[snapshot.sentimentHistory.length - 1];
      parts.push(`Último sentimento: ${lastSentiment}`);
    }

    return parts.length > 0 
      ? `Contexto da conversa:\n${parts.join('\n')}`
      : 'Nenhum contexto relevante disponível.';
  }
}
