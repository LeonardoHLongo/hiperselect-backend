import OpenAI from 'openai';
import { AI_CONFIG } from './config';
import type { AIAnalysis, Intent, RiskLevel, Sentiment, Urgency } from './types';

type AnalyzeInput = {
  message: string;
  companyContext: string | null;
};

export class AIAnalyzer {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async analyze(input: AnalyzeInput): Promise<AIAnalysis> {
    const systemPrompt = this.buildSystemPrompt(input.companyContext);
    const userPrompt = `Analyze the following customer message and provide a structured analysis:\n\n"${input.message}"`;

    try {
      const response = await this.client.chat.completions.create({
        model: AI_CONFIG.model,
        temperature: AI_CONFIG.temperature,
        max_tokens: AI_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('AI response is empty');
      }

      const parsed = JSON.parse(content) as {
        intent: string;
        sentiment: string;
        urgency: string;
        riskLevel: string;
        confidence: number;
        reasoning: string;
      };

      return {
        intent: this.parseIntent(parsed.intent),
        sentiment: this.parseSentiment(parsed.sentiment),
        urgency: this.parseUrgency(parsed.urgency),
        riskLevel: this.parseRiskLevel(parsed.riskLevel),
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || 'Analysis completed',
        aiVersion: AI_CONFIG.providerName,
      };
    } catch (error) {
      console.error('[AIAnalyzer] Analysis failed:', error);
      return this.getDefaultAnalysis(input.message);
    }
  }

  private buildSystemPrompt(companyContext: string | null): string {
    const contextSection = companyContext
      ? `\n\nCompany Context:\n${companyContext}`
      : '\n\nNote: No company context available.';

    return `You are an AI customer support analyzer. Analyze customer messages and return a JSON object with:
- intent: one of "informational", "complaint", "question", "request", "unknown"
- sentiment: one of "positive", "neutral", "negative", "angry"
- urgency: one of "low", "medium", "high", "critical"
- riskLevel: one of "none", "low", "medium", "high"
- confidence: number between 0 and 1
- reasoning: brief explanation of your analysis

${contextSection}

Return only valid JSON.`;
  }

  private parseIntent(value: string): Intent {
    const normalized = value.toLowerCase();
    if (normalized.includes('informational') || normalized.includes('info')) return 'informational';
    if (normalized.includes('complaint')) return 'complaint';
    if (normalized.includes('question')) return 'question';
    if (normalized.includes('request')) return 'request';
    return 'unknown';
  }

  private parseSentiment(value: string): Sentiment {
    const normalized = value.toLowerCase();
    if (normalized.includes('angry') || normalized.includes('rage')) return 'angry';
    if (normalized.includes('negative')) return 'negative';
    if (normalized.includes('positive')) return 'positive';
    return 'neutral';
  }

  private parseUrgency(value: string): Urgency {
    const normalized = value.toLowerCase();
    if (normalized.includes('critical')) return 'critical';
    if (normalized.includes('high')) return 'high';
    if (normalized.includes('medium')) return 'medium';
    return 'low';
  }

  private parseRiskLevel(value: string): RiskLevel {
    const normalized = value.toLowerCase();
    if (normalized.includes('high')) return 'high';
    if (normalized.includes('medium')) return 'medium';
    if (normalized.includes('low')) return 'low';
    return 'none';
  }

  private getDefaultAnalysis(message: string): AIAnalysis {
    return {
      intent: 'unknown',
      sentiment: 'neutral',
      urgency: 'low',
      riskLevel: 'none',
      confidence: 0.3,
      reasoning: 'Analysis failed, using default values',
      aiVersion: AI_CONFIG.providerName,
    };
  }
}

