/**
 * BrainAI Interface
 * Interface para IA cerebral (decisão estratégica)
 * 
 * Responsabilidade: Analisar e decidir como processar mensagens
 * NÃO gera respostas - apenas decide se deve responder e como
 */
import type { MessageAnalysisInput, BrainAnalysisResult } from '../types';

export interface IBrainAI {
  /**
   * Analisa a mensagem e decide como processá-la
   * 
   * @param input - Mensagem e contexto da conversa
   * @returns Decisão sobre como processar a mensagem
   */
  analyze(input: MessageAnalysisInput): BrainAnalysisResult | Promise<BrainAnalysisResult>;
}

