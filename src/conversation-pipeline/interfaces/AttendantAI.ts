/**
 * AttendantAI Interface
 * Interface para IA de atendimento (plugável e descartável)
 * 
 * Responsabilidade: Gerar respostas para clientes
 * NÃO decide se deve responder - apenas gera resposta quando solicitado
 */
import type { ResponseGenerationInput, GeneratedResponse } from '../types';

export interface IAttendantAI {
  /**
   * Verifica se esta IA pode lidar com o input fornecido
   * Útil quando múltiplas IAs estão disponíveis
   */
  canHandle(input: ResponseGenerationInput): boolean | Promise<boolean>;

  /**
   * Gera uma resposta para a mensagem do cliente
   * 
   * @param input - Contexto da mensagem e conversa
   * @returns Resposta gerada ou null se não puder responder
   */
  generateResponse(input: ResponseGenerationInput): GeneratedResponse | Promise<GeneratedResponse | null>;
}

