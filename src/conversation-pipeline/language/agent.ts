/**
 * Language Agent (Agente Boca)
 * Camada exclusivamente de linguagem - transforma respostas do sistema em texto humano
 * 
 * Regras:
 * - NÃO decide nada
 * - NÃO altera significado
 * - NÃO inventa informação
 * - Apenas "fala bonito"
 */

import OpenAI from 'openai';
import type { LanguageContext, HumanizedResponse } from './types';
import { logger } from '../../utils/logger';

type LanguageAgentConfig = {
  apiKey: string;
  model?: string;
  enabled?: boolean; // Permite desabilitar para debug/testes
};

export class LanguageAgent {
  private config: Required<LanguageAgentConfig>;
  private openai: OpenAI;

  constructor(config: LanguageAgentConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gpt-5-nano',
      enabled: config.enabled !== false, // Default: enabled
    };

    this.openai = new OpenAI({ apiKey: this.config.apiKey });
  }

  /**
   * Extrai texto da resposta da Responses API
   * Tenta múltiplos caminhos: output_text direto ou output[].content[]
   */
  private extractResponseText(resp: any): string {
    logger.pipeline('🔍 extractResponseText - Iniciando extração', {
      hasOutputText: typeof resp.output_text === 'string',
      outputTextValue: resp.output_text,
      outputTextLength: resp.output_text?.length ?? 0,
      hasOutput: Array.isArray(resp.output),
      outputLength: resp.output?.length ?? 0,
    });

    // Tentar output_text direto primeiro
    const direct = (resp.output_text ?? '').trim();
    if (direct) {
      logger.pipeline('✅ Texto encontrado em output_text', { length: direct.length });
      return direct;
    }

    logger.pipeline('⚠️ output_text vazio - tentando output[].content[]');

    // Se não tiver output_text, varrer output[].content[]
    const parts: string[] = [];
    for (const item of resp.output ?? []) {
      logger.pipeline('📦 Processando item do output', {
        itemType: item.type,
        hasContent: Array.isArray(item.content),
        contentLength: item.content?.length ?? 0,
      });
      
      for (const c of item.content ?? []) {
        logger.pipeline('📄 Processando content', {
          contentType: c.type,
          hasText: typeof c.text === 'string',
          textLength: c.text?.length ?? 0,
        });
        
        if (c.type === 'output_text' && typeof c.text === 'string') {
          logger.pipeline('✅ Encontrado output_text em content', { text: c.text.substring(0, 50) + '...' });
          parts.push(c.text);
        }
      }
    }
    
    const extracted = parts.join('').trim();
    logger.pipeline('📊 Resultado da extração', {
      partsFound: parts.length,
      extractedLength: extracted.length,
      extractedPreview: extracted.substring(0, 100) + (extracted.length > 100 ? '...' : ''),
    });
    
    return extracted;
  }

  /**
   * Humaniza uma resposta do sistema mantendo o conteúdo exato
   */
  async humanize(context: LanguageContext): Promise<HumanizedResponse> {
    // Se desabilitado, retornar texto original
    if (!this.config.enabled) {
      logger.debug('[LanguageAgent] Desabilitado - retornando texto original');
      return {
        text: context.originalText,
        metadata: {
          originalLength: context.originalText.length,
          humanizedLength: context.originalText.length,
          responseType: context.responseType,
        },
      };
    }

    logger.group('🗣️ Agente Boca - Humanizando Resposta', [
      { label: 'Tipo', value: context.responseType },
      { label: 'Tamanho original', value: `${context.originalText.length} chars` },
    ]);

    // GPT-5 requer responses.create(), outros modelos usam chat.completions
    const isGPT5 = this.config.model.startsWith('gpt-5');

    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(context);

      logger.pipeline('📤 Enviando para OpenAI...', {
        model: this.config.model,
        isGPT5,
        originalTextPreview: context.originalText.substring(0, 100) + '...',
      });

      let humanizedText: string | null = null;

      if (isGPT5) {
        // Usar Responses API para GPT-5
        logger.pipeline('🔧 Usando Responses API (GPT-5)...');
        
        // Calcular tokens necessários: mínimo 1000 para garantir espaço suficiente
        // Adicionar margem generosa baseada no tamanho do texto original
        const estimatedTokens = Math.ceil(context.originalText.length / 4); // ~4 chars por token
        const maxOutputTokens = Math.max(1000, estimatedTokens + 500); // Mínimo 1000, margem de 500
        
        logger.pipeline('📊 Configuração de tokens', {
          originalTextLength: context.originalText.length,
          estimatedTokens,
          maxOutputTokens,
        });
        
        const resp = await this.openai.responses.create({
          model: this.config.model,
          reasoning: { effort: 'low' },
          max_output_tokens: maxOutputTokens,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        // ETAPA 1: Observabilidade - logar estrutura da resposta
        logger.pipeline('📊 OpenAI response shape', {
          hasOutputText: typeof resp.output_text === 'string',
          outputTextLength: resp.output_text?.length ?? 0,
          outputTextValue: resp.output_text,
          outputLength: Array.isArray(resp.output) ? resp.output.length : 0,
          outputTypes: Array.isArray(resp.output) ? resp.output.map((i: any) => i.type) : [],
          firstContentTypes: Array.isArray(resp.output?.[0]?.content) 
            ? resp.output[0].content.map((c: any) => c.type) 
            : [],
          outputTextPreview: String(resp.output_text ?? '').slice(0, 120),
          // Log estrutura completa (limitado para não explodir)
          responseKeys: Object.keys(resp),
          responseId: resp.id,
        });

        // ETAPA 2: Extrair texto usando helper que tenta múltiplos caminhos
        const extractedText = this.extractResponseText(resp);
        humanizedText = extractedText || null;
        
        logger.pipeline('📋 Resultado da extração', {
          extractedText: extractedText,
          extractedLength: extractedText?.length ?? 0,
          humanizedTextIsNull: humanizedText === null,
        });
        
        if (extractedText && extractedText !== (resp.output_text ?? '').trim()) {
          logger.pipeline('✅ Texto extraído de output[].content[] (não estava em output_text)', {
            extractedLength: extractedText.length,
          });
        }
      } else {
        // Usar chat.completions para outros modelos
        logger.pipeline('🔧 Usando chat.completions (modelo não-GPT-5)...');
        
        // Calcular tokens necessários: mínimo 1000 para garantir espaço suficiente
        const estimatedTokens = Math.ceil(context.originalText.length / 4); // ~4 chars por token
        const maxTokens = Math.max(1000, estimatedTokens + 500); // Mínimo 1000, margem de 500
        
        logger.pipeline('📊 Configuração de tokens', {
          originalTextLength: context.originalText.length,
          estimatedTokens,
          maxTokens,
        });
        
        const chatResponse = await this.openai.chat.completions.create({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.7, // Tom mais natural e humano
        });

        humanizedText = chatResponse.choices[0]?.message?.content?.trim() || null;
      }

      if (!humanizedText) {
        logger.error('❌ OpenAI retornou texto vazio - usando original', { prefix: '[LanguageAgent]', emoji: '❌' });
        logger.pipeline('📝 Debug info', {
          model: this.config.model,
          isGPT5,
          originalText: context.originalText.substring(0, 100) + '...',
          responseType: context.responseType,
        });
        logger.groupEnd();
        return {
          text: context.originalText,
          metadata: {
            originalLength: context.originalText.length,
            humanizedLength: context.originalText.length,
            responseType: context.responseType,
          },
        };
      }

      logger.success('✅ Texto humanizado com sucesso', { prefix: '[LanguageAgent]', emoji: '✅' });
      logger.pipeline('📝 Comparação', {
        original: context.originalText.substring(0, 100) + '...',
        humanized: humanizedText.substring(0, 100) + '...',
        originalLength: context.originalText.length,
        humanizedLength: humanizedText.length,
      });
      logger.groupEnd();

      return {
        text: humanizedText,
        metadata: {
          originalLength: context.originalText.length,
          humanizedLength: humanizedText.length,
          responseType: context.responseType,
        },
      };
    } catch (error: any) {
      logger.error('❌ Erro ao humanizar texto - usando original', {
        error: error instanceof Error ? error.message : String(error),
        errorStatus: error?.status,
        errorCode: error?.code,
        errorType: error?.type,
        errorResponseData: error?.response?.data,
        errorStack: error instanceof Error ? error.stack : undefined,
        model: this.config.model,
        isGPT5,
      });
      
      // Log completo do erro para debug
      logger.pipeline('🔍 Erro completo (debug)', {
        errorName: error?.name,
        errorMessage: error?.message,
        errorStatus: error?.status,
        errorCode: error?.code,
        errorType: error?.type,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2).substring(0, 1000),
      });
      
      logger.groupEnd();
      
      // Em caso de erro, retornar texto original (não quebrar o fluxo)
      return {
        text: context.originalText,
        metadata: {
          originalLength: context.originalText.length,
          humanizedLength: context.originalText.length,
          responseType: context.responseType,
        },
      };
    }
  }

  /**
   * Prompt do sistema (congelável)
   */
  private buildSystemPrompt(): string {
    return `Você é o Agente Boca, responsável apenas por transformar informações do sistema em respostas humanas, calorosas, educadas e profissionais.

Regras obrigatórias:

* Seja sempre CORDIAL, ACOLHEDOR, CALOROSO e RESPEITOSO.
* Use linguagem simples, natural, profissional e AMIGÁVEL.
* Use EMOJIS de forma moderada e natural para deixar a conversa mais humana e calorosa (😊, 👍, 💬, 📞, 🕒, 📍, ✅, etc).
* Evite respostas secas, telegráficas ou ríspidas - sempre adicione um toque humano.
* Nunca invente informações ou regras.
* Nunca altere o significado do conteúdo recebido.
* Você pode REFORMATAR completamente a mensagem para ficar natural, humana e calorosa.
* Você pode remover cabeçalhos/avisos artificiais (ex: "⚠️ Importante: ...", "📞 *nome*").
* Quando a informação pedida não estiver cadastrada, diga de forma calorosa e empática: "Não tenho essa informação cadastrada aqui, mas você consegue confirmar direto com a unidade 😊"
* Não use linguagem burocrática ("A informação específica que você solicitou...", "⚠️ Importante").
* Você pode corrigir ortografia, clareza e tom do texto fornecido, mantendo exatamente a mesma regra.
* Não use humor forçado, ironia ou gírias excessivas.
* Prefira aberturas CALOROSAS e SUAVES ("Claro! 😊", "Sem problema!", "Consigo te ajudar sim!", "Entendi! 😊", "Perfeito!") e encerramentos ABERTOS e ACOLHEDORES ("Se quiser, posso te ajudar com mais alguma coisa 😊", "Se precisar de mais alguma coisa, é só falar!", "Estou à disposição para ajudar! 😊").
* Evite frases de fechamento brusco como "Precisa de mais alguma coisa?" - prefira "Se quiser, posso ajudar com mais alguma coisa 😊" ou "Estou à disposição se precisar! 😊".
* Use emojis para expressar emoções positivas e deixar a conversa mais humana (mas sem exagerar - 1-2 emojis por mensagem geralmente é suficiente).
* Seja EMPÁTICO e mostre que você se importa com a situação do cliente.

Formato preferido para informações de loja:
1. Frase empática e calorosa curta explicando a situação (com emoji se apropriado)
2. Dados em 2-3 linhas limpas e organizadas (Telefone, Horário, Local) - pode usar emojis para organizar (📞, 🕒, 📍)
3. Encerramento aberto e caloroso com emoji ("Se quiser, posso ajudar com mais alguma coisa 😊" ou "Estou à disposição se precisar! 😊")

Exemplos de tom caloroso:
- "Entendi! 😊 Não tenho essa informação cadastrada aqui, mas você consegue confirmar direto com a unidade."
- "Claro! 😊 A unidade [nome] fica em [endereço]. O telefone é [telefone] e o horário é [horário]. Se quiser, posso ajudar com mais alguma coisa! 😊"
- "Perfeito! 👍 Vou te passar os dados da unidade [nome]..."

Seu papel é apenas apresentar a informação de forma HUMANA, CALOROSA e ACOLHEDORA.`;
  }

  /**
   * Prompt do usuário com contexto
   */
  private buildUserPrompt(context: LanguageContext): string {
    let prompt = `Humanize o seguinte texto do sistema, mantendo EXATAMENTE o mesmo significado e informações:\n\n`;
    prompt += `\`\`\`\n${context.originalText}\n\`\`\`\n\n`;

    // Adicionar contexto específico baseado no tipo
    if (context.responseType === 'store_info' && context.structuredData) {
      prompt += `Contexto: Esta é uma resposta sobre informações de contato de uma loja.\n`;
      prompt += `A informação específica que o usuário pediu (vaga, parceria, etc.) NÃO está cadastrada no sistema.\n`;
      prompt += `Você deve:\n`;
      prompt += `1. Explicar de forma humana que não tem a informação cadastrada, mas pode confirmar direto com a unidade\n`;
      prompt += `2. Listar os dados de contato de forma limpa e natural (Telefone, Horário, Local)\n`;
      prompt += `3. Remover qualquer aviso burocrático como "⚠️ Importante" ou "A informação específica que você pediu..."\n`;
      prompt += `4. Usar formato natural, sem emojis de cabeçalho (📞, 📍) a menos que melhore a legibilidade\n\n`;
      
      if (context.structuredData.storeName) {
        prompt += `Nome da loja: ${context.structuredData.storeName}\n`;
      }
      if (context.structuredData.storePhone) {
        prompt += `Telefone: ${context.structuredData.storePhone}\n`;
      }
      if (context.structuredData.storeHours) {
        prompt += `Horário: ${context.structuredData.storeHours}\n`;
      }
      if (context.structuredData.storeAddress) {
        prompt += `Endereço: ${context.structuredData.storeAddress}\n`;
      }
      
      prompt += `\nExemplo de formato desejado:\n`;
      prompt += `"Entendi 😊 Eu não tenho informações de vagas cadastradas aqui, mas você consegue confirmar direto com a unidade.\n`;
      prompt += `Telefone: (48) 99900-7070\n`;
      prompt += `Horário: seg-sex 8h às 18h\n`;
      prompt += `Armação, Florianópolis\n`;
      prompt += `Se quiser, me diga qual vaga você procura que eu deixo anotado por aqui."\n\n`;
    }

    if (context.responseType === 'policy_info') {
      prompt += `Contexto: Esta é uma resposta sobre uma política cadastrada.\n`;
      if (context.structuredData?.policyTitle) {
        prompt += `Título da política: ${context.structuredData.policyTitle}\n`;
      }
      prompt += `IMPORTANTE: O texto pode conter erros de ortografia ou linguagem informal. Corrija a ortografia e gramática, mas mantenha EXATAMENTE o mesmo significado e regras. Transforme em linguagem profissional e educada.\n`;
    }

    if (context.responseType === 'tool_handoff') {
      prompt += `Contexto: Esta resposta indica que o sistema vai escalar para um atendente humano.\n`;
      prompt += `Mantenha o tom respeitoso e explique que um atendente irá ajudar.\n`;
    }

    if (context.responseType === 'tool_need_input') {
      prompt += `Contexto: Esta é uma pergunta do sistema pedindo mais informações ao usuário.\n`;
      prompt += `Mantenha o tom educado e claro sobre o que está sendo solicitado.\n`;
    }

    prompt += `\nRetorne APENAS o texto humanizado, sem explicações adicionais.`;

    return prompt;
  }
}
