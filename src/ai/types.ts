export type Intent = 'informational' | 'complaint' | 'question' | 'request' | 'unknown';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'angry';

export type Urgency = 'low' | 'medium' | 'high' | 'critical';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export type AIAnalysis = {
  intent: Intent;
  sentiment: Sentiment;
  urgency: Urgency;
  riskLevel: RiskLevel;
  confidence: number;
  reasoning: string;
  aiVersion: string;
};

export type AIDecision = {
  action: 'AUTO_RESPOND' | 'CREATE_TICKET';
  reason: string;
  analysis: AIAnalysis;
};

export type AIAnalysisCompletedEvent = {
  messageId: string;
  conversationId: string;
  analysis: AIAnalysis;
  traceId: string;
};

export type AIDecisionMadeEvent = {
  messageId: string;
  conversationId: string;
  decision: AIDecision;
  traceId: string;
};

export type AIResponseGeneratedEvent = {
  messageId: string;
  conversationId: string;
  response: string;
  traceId: string;
};

export type AIResponseSuggestedEvent = {
  ticketId: string;
  conversationId: string;
  suggestion: string;
  traceId: string;
};

