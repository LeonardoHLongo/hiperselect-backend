/**
 * Decision Engine
 * Lógica de decisão do pipeline (sem lógica de negócio pesada)
 * 
 * Responsabilidade: Orquestrar decisões entre BrainAI e AttendantAI
 * NÃO contém regras de negócio específicas
 */
import type { IBrainAI } from './interfaces/BrainAI';
import type { IAttendantAI } from './interfaces/AttendantAI';
import type { MessageAnalysisInput, ResponseGenerationInput, BrainAnalysisResult, GeneratedResponse } from './types';

type DecisionEngineDependencies = {
  brainAI?: IBrainAI;
  attendantAI?: IAttendantAI;
};

export class DecisionEngine {
  constructor(private deps: DecisionEngineDependencies) {}

  /**
   * Processa uma mensagem através do pipeline de decisão
   * 
   * Fluxo:
   * 1. Se BrainAI existe → analisa e decide
   * 2. Se decisão permitir → chama AttendantAI
   * 3. Retorna resultado (resposta ou decisão)
   */
  async processMessage(input: MessageAnalysisInput): Promise<{
    decision: BrainAnalysisResult['decision'];
    response?: GeneratedResponse;
    brainAnalysis?: BrainAnalysisResult;
    blockedReason?: string;
  }> {
    console.log('[DecisionEngine] Processing message:', input.messageId);
    console.log('[DecisionEngine] Conversation:', input.conversationId);

    // Passo 1: BrainAI analisa e decide (se disponível)
    let brainAnalysis: BrainAnalysisResult | null = null;
    
    if (this.deps.brainAI) {
      console.log('[DecisionEngine] BrainAI available - analyzing message...');
      brainAnalysis = await this.deps.brainAI.analyze(input);
      console.log('[DecisionEngine] BrainAI decision:', brainAnalysis.decision);
      console.log('[DecisionEngine] BrainAI reasoning:', brainAnalysis.reasoning);
    } else {
      // Fase 1: Sem BrainAI, permitir resposta automática se AttendantAI estiver disponível
      // Isso permite validar o pipeline com FakeAttendantAI
      // Futuras fases: BrainAI decidirá se permite ou não
      console.log('[DecisionEngine] No BrainAI configured - defaulting to ALLOW_AUTO_RESPONSE (for pipeline validation)');
      brainAnalysis = {
        decision: 'ALLOW_AUTO_RESPONSE',
        reasoning: 'No BrainAI configured - allowing auto-response for pipeline validation',
      };
    }

    // Passo 2: Se decisão permitir resposta automática, chamar AttendantAI
    // IMPORTANTE: Verificar se conversa tem aiEnabled === true
    let response: GeneratedResponse | null = null;
    let blockedReason: string | undefined = undefined;

    if (brainAnalysis.decision === 'ALLOW_AUTO_RESPONSE' && this.deps.attendantAI) {
      // Verificar se conversa tem IA habilitada
      if (!input.conversationContext.aiEnabled) {
        console.log('[DecisionEngine] ⚠️  AI not enabled for this conversation');
        blockedReason = 'AI not enabled for this conversation';
      } else {
        console.log('[DecisionEngine] Decision allows auto-response - generating response...');
        
        // Verificar se AttendantAI pode lidar com este input (SafeClassifier já é chamado internamente)
        const canHandle = await this.deps.attendantAI.canHandle({
          messageId: input.messageId,
          conversationId: input.conversationId,
          userMessage: input.text || '',
          conversationContext: input.conversationContext,
          brainAnalysis,
        });

        // AttendantAI sempre retorna true em canHandle agora (não bloqueia mais)
        // Mas ainda verificamos para manter compatibilidade
        if (canHandle) {
          console.log('[DecisionEngine] AttendantAI can handle - generating response...');
          response = await this.deps.attendantAI.generateResponse({
            messageId: input.messageId,
            conversationId: input.conversationId,
            userMessage: input.text || '',
            conversationContext: input.conversationContext,
            brainAnalysis,
          });

          if (response) {
            console.log('[DecisionEngine] ✅ Response generated:', response.text.substring(0, 50));
          } else {
            // AttendantAI agora sempre retorna resposta (fallback se necessário)
            // Se retornar null, é um erro interno
            console.log('[DecisionEngine] ⚠️  AttendantAI returned null response (unexpected)');
            blockedReason = 'AttendantAI returned null (unexpected error)';
          }
        } else {
          // Não deve acontecer mais, mas mantemos para compatibilidade
          console.log('[DecisionEngine] ⚠️  AttendantAI cannot handle this input (unexpected)');
          blockedReason = 'AttendantAI cannot handle (unexpected)';
        }
      }
    } else {
      if (brainAnalysis.decision !== 'ALLOW_AUTO_RESPONSE') {
        console.log(`[DecisionEngine] Decision does not allow auto-response: ${brainAnalysis.decision}`);
        blockedReason = `BrainAI decision: ${brainAnalysis.decision}`;
      }
      if (!this.deps.attendantAI) {
        console.log('[DecisionEngine] No AttendantAI configured');
        blockedReason = 'No AttendantAI configured';
      }
    }

    return {
      decision: brainAnalysis.decision,
      response: response || undefined,
      brainAnalysis,
      blockedReason,
    };
  }
}

