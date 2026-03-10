/**
 * Entity Extractor Agent - Agente Especializado em Extração de Entidades
 * 
 * Responsabilidade:
 * - Extrair entidades (produtos, lojas, horários, quantidades) da mensagem atual
 * - Considerar histórico da conversa para não perder contexto
 * - Focar APENAS em extração, não em classificação de intenção
 * 
 * NÃO contém lógica de negócio - apenas extração de dados
 */
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { logger } from '../../utils/logger';
import { EntityExtractorSchema, EntityExtractorResult } from './schemas';
import { isValidStoreName } from '../../utils/store-matcher';

type EntityExtractorInput = {
  messageText: string;
  messageHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; // Últimas 5 mensagens
  availableStores?: Array<{ id: string; name: string; neighborhood: string }>; // Lista de lojas disponíveis para matching
  traceId?: string; // Para rastreabilidade
  intent?: string; // Intent já classificado pelo Router (para contexto)
};

type EntityExtractorDependencies = {
  openaiApiKey: string;
};

export class EntityExtractorAgent {
  private model: any;
  private fallbackModel: any;
  private openai: any;

  constructor(private deps: EntityExtractorDependencies) {
    // Validar chave API
    if (!deps.openaiApiKey || deps.openaiApiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for EntityExtractorAgent');
    }

    // Usar modelo OpenAI via Vercel AI SDK
    // Usar GPT-4o-mini como principal (otimizado para Structured Outputs JSON)
    this.openai = createOpenAI({ apiKey: deps.openaiApiKey });
    this.model = this.openai('gpt-4o-mini');
    // Fallback para gpt-4o caso gpt-4o-mini não esteja disponível
    this.fallbackModel = this.openai('gpt-4o');
    
    logger.pipeline('✅ EntityExtractorAgent inicializado', {
      primaryModel: 'gpt-4o-mini',
      fallbackModel: 'gpt-4o',
      hasApiKey: !!deps.openaiApiKey,
      apiKeyLength: deps.openaiApiKey.length,
      apiKeyPrefix: deps.openaiApiKey.substring(0, 7) + '...',
      note: 'Agente especializado em extração de entidades',
    });
  }

  /**
   * Extrai entidades da mensagem atual considerando o histórico
   */
  async extract(input: EntityExtractorInput): Promise<EntityExtractorResult> {
    const traceId = input.traceId || `extract-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Construir histórico formatado
      let historyContext = '';
      if (input.messageHistory && input.messageHistory.length > 0) {
        const historyLines = input.messageHistory
          .slice(-5) // Últimas 5 mensagens
          .map(msg => {
            const roleLabel = msg.role === 'user' ? 'Cliente' : msg.role === 'assistant' ? 'Sistema' : 'Sistema';
            return `${roleLabel}: ${msg.content}`;
          })
          .join('\n');
        
        historyContext = `\n\nHISTÓRICO RECENTE DA CONVERSA:\n${historyLines}\n\nIMPORTANTE: Se a mensagem atual omitir um produto, loja ou informação que foi claramente estabelecida no histórico recente, extraia essa informação do histórico. Por exemplo, se o histórico mencionou "ovos" e a mensagem atual diz apenas "armação", extraia product_name: "ovos" do histórico.`;
      }

      // Construir lista de lojas para matching preciso
      let storesListContext = '';
      if (input.availableStores && input.availableStores.length > 0) {
        const storesList = input.availableStores.map(s => `- ${s.name} (bairro: ${s.neighborhood})`).join('\n');
        storesListContext = `\n\nLOJAS DISPONÍVEIS (use esta lista para fazer matching preciso):\n${storesList}\n\nIMPORTANTE: Se a mensagem mencionar qualquer parte do nome ou bairro de uma loja desta lista, você DEVE extrair o store_name. Exemplos:
- "Hiperselect da Armação" ou "da Armação" → store_name: "Armação"
- "unidade Centro" → store_name: "Centro"
- "na loja do Campeche" → store_name: "Campeche"
- "moro no Rio Tavares" → store_name: "Rio Tavares" (se corresponder a uma loja da lista)

Seja EXTREMAMENTE MINUCIOSO. Não ignore menções de loja.`;
      }

      // Construir contexto do intent (se fornecido)
      let intentContext = '';
      if (input.intent) {
        intentContext = `\n\nINTENT CLASSIFICADO: ${input.intent}\nUse este contexto para focar na extração relevante. Por exemplo, se o intent é RESERVATION_REQUEST, priorize extrair pickup_time e quantity.`;
      }

      const prompt = `Você é um extrator de dados especializado em conversas de supermercado (Hiper Select).

Sua ÚNICA tarefa é extrair entidades (produtos, lojas, horários, quantidades) da mensagem atual e do histórico recente.

⚠️ REGRA CRÍTICA DE EXTRAÇÃO DE PRODUTOS:

Para product_name, extraia APENAS o nome do produto, seguindo estas regras:

1. **Ignore palavras iniciais**: Palavras como "viu", "olha", "sabe", "opa" no início da frase NÃO são parte do produto. Exemplo:
   - "viu ainda tem a promoção de ovos ai?" → product_name: "ovos" (ou "ovo"), is_promotion_query: true
   - "olha, quanto custa o leite?" → product_name: "leite"

2. **Plural/Singular**: Extraia o produto MESMO se estiver no plural. Você pode normalizar para singular se preferir, mas o importante é capturar:
   - "ovos" → product_name: "ovos" (ou "ovo")
   - "leites" → product_name: "leite"
   - "pães" → product_name: "pão"

3. **Produto + Promoção**: Se a mensagem mencionar produto E promoção, extraia AMBOS:
   - "ainda tem ovos em promoção?" → product_name: "ovos", is_promotion_query: true
   - "viu ainda tem a promoção de ovos ai?" → product_name: "ovos", is_promotion_query: true
   - "tem leite em promoção?" → product_name: "leite", is_promotion_query: true

4. **Contexto do Histórico**: Se a mensagem atual omitir o produto mas ele foi claramente estabelecido no histórico recente, extraia-o do histórico. Exemplo:
   - Histórico: "viu ainda tem a promoção de ovos ai?" (product_name: "ovos")
   - Mensagem atual: "armação"
   - Resultado: product_name: "ovos" (do histórico), store_name: "Armação" (da mensagem atual)

5. **Exemplos de extração correta**:
   - "quanto custa o leite" → product_name: "leite"
   - "tem pão integral aí?" → product_name: "pão integral"
   - "preço do arroz" → product_name: "arroz"
   - "ainda tá na promoção o ovo?" → product_name: "ovo", is_promotion_query: true
   - "quanto custa os ovos?" → product_name: "ovos" (ou "ovo")
   - "viu ainda tem a promoção de ovos ai?" → product_name: "ovos", is_promotion_query: true

${intentContext}${historyContext}${storesListContext}

Mensagem atual do cliente: "${input.messageText}"

### INSTRUÇÕES DE EXTRAÇÃO (CHAIN OF THOUGHT) ###

IMPORTANTE: Você DEVE seguir esta ordem de raciocínio:

1. **PRIMEIRO**: Escreva o campo "reasoning" explicando passo-a-passo:
   - O que foi mencionado na mensagem atual
   - O que foi mencionado no histórico recente (se houver)
   - Como extraiu cada entidade (produto, loja, horário, quantidade)
   - Se extraiu algo do histórico, explique claramente

2. **DEPOIS**: Preencha os campos de extração baseado no seu raciocínio:
   - store_name: Nome da loja mencionada (ou do histórico)
   - product_name: Nome do produto mencionado (ou do histórico)
   - department: Setor mencionado (se houver)
   - is_promotion_query: true se mencionar promoção
   - pickup_time: Horário de retirada (apenas para RESERVATION_REQUEST)
   - quantity: Quantidade (apenas para RESERVATION_REQUEST)
   - price: Valor mencionado (se houver)
   - location: Localização que não corresponde a uma loja (se houver)

Extraia as entidades com precisão máxima, considerando tanto a mensagem atual quanto o histórico recente.`;

      logger.pipeline('Chamando OpenAI para extração de entidades', {
        traceId,
        hasHistory: !!input.messageHistory && input.messageHistory.length > 0,
        historyLength: input.messageHistory?.length || 0,
        hasStores: !!input.availableStores && input.availableStores.length > 0,
        intent: input.intent,
      });

      let rawResult: EntityExtractorResult;
      let usedFallback = false;

      try {
        const result = await generateObject({
          model: this.model,
          schema: EntityExtractorSchema,
          prompt,
        });
        
        rawResult = result.object;
        
        logger.pipeline('Resposta recebida do OpenAI (gpt-4o-mini)', {
          traceId,
          hasResult: !!rawResult,
        });
      } catch (openaiError) {
        logger.warning('⚠️ Erro na primeira tentativa, usando fallback...', {
          traceId,
          error: openaiError instanceof Error ? openaiError.message : String(openaiError),
        });

        try {
          const fallbackResult = await generateObject({
            model: this.fallbackModel,
            schema: EntityExtractorSchema,
            prompt,
          });
          
          rawResult = fallbackResult.object;
          usedFallback = true;
          
          logger.pipeline('✅ Resposta recebida do OpenAI (tentativa 2)', {
            traceId,
            hasResult: !!rawResult,
          });
        } catch (fallbackError) {
          logger.error('❌ Erro ao chamar OpenAI (ambas tentativas falharam)', {
            traceId,
            primaryError: openaiError instanceof Error ? openaiError.message : String(openaiError),
            fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          
          throw fallbackError;
        }
      }

      // Validação explícita com Zod
      let validatedResult: EntityExtractorResult;
      try {
        validatedResult = EntityExtractorSchema.parse(rawResult);
        
        // Validação de store_name: filtrar stopwords e termos muito curtos
        if (validatedResult.store_name) {
          const isValid = isValidStoreName(
            validatedResult.store_name,
            input.availableStores?.map(s => ({ name: s.name, neighborhood: s.neighborhood }))
          );
          
          if (!isValid) {
            logger.pipeline('⚠️ store_name rejeitado (stopword ou muito curto)', {
              store_name: validatedResult.store_name,
              length: validatedResult.store_name.length,
            });
            validatedResult.store_name = null;
          }
        }
        
        // Mesma validação para store (compatibilidade)
        if (validatedResult.store) {
          const isValid = isValidStoreName(
            validatedResult.store,
            input.availableStores?.map(s => ({ name: s.name, neighborhood: s.neighborhood }))
          );
          
          if (!isValid) {
            logger.pipeline('⚠️ store rejeitado (stopword ou muito curto)', {
              store: validatedResult.store,
              length: validatedResult.store.length,
            });
            validatedResult.store = null;
          }
        }
        
        logger.pipeline('✅ Validação Zod bem-sucedida', {
          traceId,
          hasProductName: !!validatedResult.product_name,
          hasStoreName: !!validatedResult.store_name,
          hasPickupTime: !!validatedResult.pickup_time,
          hasQuantity: !!validatedResult.quantity,
        });
      } catch (validationError) {
        logger.error('❌ Erro na validação Zod do resultado', {
          traceId,
          error: validationError instanceof Error ? validationError.message : String(validationError),
          rawResult: JSON.stringify(rawResult, null, 2),
        });
        
        // Fallback seguro: retornar todas as entidades como null
        validatedResult = {
          reasoning: 'Erro na validação - usando fallback seguro',
          store_name: null,
          store: null,
          product_name: null,
          product: null,
          department: null,
          price: null,
          location: null,
          is_promotion_query: null,
          pickup_time: null,
          quantity: null,
        };
        
        logger.warning('⚠️ Usando resultado parcial após erro de validação', {
          traceId,
        });
      }

      const duration = Date.now() - startTime;
      
      logger.pipeline('✅ Extração concluída', {
        traceId,
        product_name: validatedResult.product_name,
        store_name: validatedResult.store_name,
        is_promotion_query: validatedResult.is_promotion_query,
        duration: `${duration}ms`,
        usedFallback,
      });

      return validatedResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('❌ Erro na extração de entidades', {
        traceId,
        error: errorMessage,
        duration: `${duration}ms`,
      });
      
      // Fallback seguro: retornar todas as entidades como null
      const fallbackResult: EntityExtractorResult = {
        reasoning: `Erro na extração (${errorMessage}) - usando fallback seguro`,
        store_name: null,
        store: null,
        product_name: null,
        product: null,
        department: null,
        price: null,
        location: null,
        is_promotion_query: null,
        pickup_time: null,
        quantity: null,
      };
      
      logger.warning('⚠️ Usando fallback seguro - todas as entidades como null');
      
      return fallbackResult;
    }
  }
}
