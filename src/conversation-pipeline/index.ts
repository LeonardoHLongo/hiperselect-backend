/**
 * Conversation Pipeline Module
 * Exporta todos os componentes do pipeline
 */

export { ConversationPipeline } from './pipeline';
export { ConversationOrchestrator } from './orchestrator/orchestrator';
export { DecisionEngine } from './decision';
export type { IAttendantAI } from './interfaces/AttendantAI';
export type { IBrainAI } from './interfaces/BrainAI';
export { FakeAttendantAI } from './attendants/fake-attendant';
export type {
  ConversationContext,
  MessageAnalysisInput,
  BrainDecision,
  BrainAnalysisResult,
  ResponseGenerationInput,
  GeneratedResponse,
  ResponseGeneratedEvent,
} from './types';

