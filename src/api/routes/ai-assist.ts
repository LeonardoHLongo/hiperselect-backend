import type { FastifyInstance } from 'fastify';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export const registerAIAssistRoutes = (fastify: FastifyInstance): void => {
  // POST /api/v1/ai/fix-grammar - Corrigir gramática de um texto
  fastify.post('/api/v1/ai/fix-grammar', async (request, reply) => {
    try {
      const body = request.body as { text?: string };
      
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return reply.code(400).send({
          success: false,
          message: 'Texto é obrigatório',
          errorCode: 'INVALID_INPUT',
        });
      }

      // Obter API key do OpenAI das variáveis de ambiente
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return reply.code(500).send({
          success: false,
          message: 'OpenAI API key não configurada',
          errorCode: 'CONFIGURATION_ERROR',
        });
      }

      const openai = createOpenAI({ apiKey: openaiApiKey });

      const systemPrompt = `Você é um assistente de correção ortográfica para um supermercado. Sua única função é corrigir erros gramaticais, de digitação e de pontuação do texto fornecido. Mantenha o tom de voz original (seja informal ou formal) e NUNCA adicione informações novas ou responda à mensagem. 

REGRA CRÍTICA: Retorne APENAS o texto corrigido, SEM aspas duplas ou simples no início ou fim. O texto deve ser retornado diretamente, sem formatação adicional.`;

      console.log('[AI Assist] Corrigindo gramática:', {
        originalLength: body.text.length,
        preview: body.text.substring(0, 50) + '...',
      });

      const result = await generateText({
        model: openai('gpt-4o-mini'),
        system: systemPrompt,
        prompt: `Corrija os erros gramaticais, de digitação e de pontuação do seguinte texto, mantendo o tom original. Retorne APENAS o texto corrigido, sem aspas:\n\n${body.text}`,
        temperature: 0.3, // Baixa temperatura para correções mais consistentes
        maxTokens: 500 as any, // Type assertion para compatibilidade com versão do SDK
      });

      const correctedText = result.text.trim();

      console.log('[AI Assist] ✅ Gramática corrigida:', {
        originalLength: body.text.length,
        correctedLength: correctedText.length,
        preview: correctedText.substring(0, 50) + '...',
      });

      return {
        success: true,
        data: {
          original: body.text,
          corrected: correctedText,
        },
      };
    } catch (error: any) {
      console.error('[AI Assist] ❌ Erro ao corrigir gramática:', error);
      return reply.code(500).send({
        success: false,
        message: error?.message || 'Erro ao corrigir gramática',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  });
};
