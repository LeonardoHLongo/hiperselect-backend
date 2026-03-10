/**
 * Fake AttendantAI (Stub)
 * Implementação simples para validar o pipeline
 * 
 * NÃO usa OpenAI
 * NÃO contém lógica de negócio complexa
 * Apenas valida o fluxo de ponta a ponta
 */
import type { IAttendantAI } from '../interfaces/AttendantAI';
import type { ResponseGenerationInput, GeneratedResponse } from '../types';

export class FakeAttendantAI implements IAttendantAI {
  /**
   * Verifica se pode lidar com o input
   * 
   * Retorna true apenas se:
   * - Mensagem for texto
   * - Tamanho < 200 caracteres
   * - Não for mensagem de sistema
   */
  canHandle(input: ResponseGenerationInput): boolean {
    console.log('[FakeAttendantAI] Checking if can handle input...');
    
    // Verificar se é mensagem de sistema
    const isSystemMessage = 
      input.conversationContext.participantId === 'system' ||
      input.userMessage === null ||
      input.userMessage === undefined;
    
    if (isSystemMessage) {
      console.log('[FakeAttendantAI] ❌ Cannot handle: system message');
      return false;
    }

    // Verificar se tem texto
    if (!input.userMessage || input.userMessage.trim().length === 0) {
      console.log('[FakeAttendantAI] ❌ Cannot handle: empty message');
      return false;
    }

    // Verificar tamanho
    if (input.userMessage.length >= 200) {
      console.log('[FakeAttendantAI] ❌ Cannot handle: message too long (>= 200 chars)');
      return false;
    }

    console.log('[FakeAttendantAI] ✅ Can handle this input');
    return true;
  }

  /**
   * Gera resposta fixa (stub)
   * 
   * Retorna sempre a mesma mensagem de resposta automática
   */
  generateResponse(input: ResponseGenerationInput): GeneratedResponse {
    console.log('[FakeAttendantAI] Generating response...');
    console.log(`[FakeAttendantAI] User message: ${input.userMessage.substring(0, 50)}...`);
    console.log(`[FakeAttendantAI] Conversation: ${input.conversationId}`);
    
    const response: GeneratedResponse = {
      text: 'Olá! Recebemos sua mensagem e em breve um atendente irá responder.',
      confidence: 1.0, // Resposta fixa sempre tem confiança máxima
      metadata: {
        provider: 'fake-attendant',
        timestamp: Date.now(),
        originalMessageLength: input.userMessage.length,
      },
    };

    console.log('[FakeAttendantAI] ✅ Response generated:', response.text);
    return response;
  }
}


