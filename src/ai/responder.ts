import OpenAI from 'openai';
import { AI_CONFIG } from './config';

type GenerateResponseInput = {
  message: string;
  companyContext: string;
  analysisReasoning: string;
};

export class AIResponder {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generateResponse(input: GenerateResponseInput): Promise<string> {
    const systemPrompt = `You are a helpful customer support assistant. You must ONLY use information from the provided company context. If the question cannot be answered with the context, politely say you need to check with the team.

Company Context:
${input.companyContext}

Analysis: ${input.analysisReasoning}

Rules:
- Be concise and friendly
- Only use information from the context above
- If information is missing, say you'll check and get back to them
- Never make up information`;

    const userPrompt = `Customer message: "${input.message}"\n\nGenerate a helpful response:`;

    try {
      const response = await this.client.chat.completions.create({
        model: AI_CONFIG.model,
        temperature: AI_CONFIG.temperature,
        max_tokens: AI_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content || 'I apologize, but I need to check on that for you.';
    } catch (error) {
      console.error('[AIResponder] Response generation failed:', error);
      return 'I apologize, but I need to check on that for you. Someone will get back to you shortly.';
    }
  }

  async suggestResponse(input: GenerateResponseInput): Promise<string> {
    const systemPrompt = `You are a customer support assistant. Suggest a response for a customer message that requires human attention.

Company Context:
${input.companyContext}

Analysis: ${input.analysisReasoning}

Generate a professional, empathetic response suggestion.`;

    const userPrompt = `Customer message: "${input.message}"\n\nSuggest a response:`;

    try {
      const response = await this.client.chat.completions.create({
        model: AI_CONFIG.model,
        temperature: 0.5,
        max_tokens: AI_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content || 'Thank you for your message. We will look into this and get back to you.';
    } catch (error) {
      console.error('[AIResponder] Suggestion generation failed:', error);
      return 'Thank you for your message. We will look into this and get back to you.';
    }
  }
}

