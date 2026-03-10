/**
 * Greetings Tool
 * Lida com saudações e acks simples (oi, bom dia, ok, valeu)
 * 
 * Responsabilidade:
 * - Identificar quando usuário apenas cumprimenta ou confirma
 * - Responder curto e humano, perguntando como ajudar
 * - NÃO despejar informações (endereço/telefone/horário) sem pedido explícito
 */

import type { Tool, ToolInput, ToolResult } from './types';
import { logger } from '../../utils/logger';

export class GreetingsTool implements Tool {
  name = 'greetings';

  canHandle(input: ToolInput): boolean {
    const text = input.messageText.toLowerCase().trim();
    
    // Lista de saudações/acks simples
    const greetings = [
      'oi', 'olá', 'ola', 'hey', 'e aí', 'eai',
      'bom dia', 'boa tarde', 'boa noite',
      'tudo bem', 'td bem', 'tudo bom', 'td bom',
      'ok', 'okay', 'beleza', 'blz',
      'valeu', 'vlw', 'obrigado', 'obrigada', 'obg',
      'tchau', 'até', 'até mais',
    ];
    
    // Verificar se a mensagem é APENAS uma saudação/ack (sem outras palavras significativas)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const isOnlyGreeting = words.length <= 3 && greetings.some(g => text.includes(g));
    
    // Verificar se NÃO contém palavras que indicam pedido de informação
    const infoKeywords = [
      'endereço', 'endereco', 'localização', 'localizacao', 'onde fica',
      'telefone', 'contato', 'fone', 'ligar',
      'horário', 'horario', 'abre', 'fecha', 'funciona',
      'troca', 'devolução', 'devolucao', 'política', 'politica',
      'curriculo', 'vaga', 'emprego', 'parceria',
    ];
    
    const hasInfoRequest = infoKeywords.some(keyword => text.includes(keyword));
    
    // Só lidar se for apenas saudação E não tiver pedido de informação
    const matched = isOnlyGreeting && !hasInfoRequest;
    
    logger.debug(`[GreetingsTool] canHandle()`, {
      message: input.messageText.substring(0, 50) + '...',
      matched,
      isOnlyGreeting,
      hasInfoRequest,
      wordsCount: words.length,
    });
    
    return matched;
  }

  async run(input: ToolInput): Promise<ToolResult> {
    logger.group('👋 GreetingsTool - Executando', [
      { label: 'Conversation ID', value: input.conversationId },
      { label: 'Mensagem', value: input.messageText.substring(0, 50) + '...' },
    ]);

    const text = input.messageText.toLowerCase().trim();
    
    // Detectar tipo de saudação para responder apropriadamente
    let greeting = 'Olá';
    if (text.includes('bom dia')) {
      greeting = 'Bom dia';
    } else if (text.includes('boa tarde')) {
      greeting = 'Boa tarde';
    } else if (text.includes('boa noite')) {
      greeting = 'Boa noite';
    } else if (text.includes('tchau') || text.includes('até')) {
      greeting = 'Tchau';
    } else if (text.includes('valeu') || text.includes('obrigad')) {
      greeting = 'De nada';
    }
    
    // Resposta curta e humana, sem bullets ou formato de menu
    // Template fixo: saudação + pergunta aberta (sem frases adicionais)
    let responseText = '';
    
    if (text.includes('tchau') || text.includes('até')) {
      // Despedida: resposta curta
      responseText = `${greeting}! 😊 Até mais!`;
    } else {
      // Saudação: saudação + pergunta aberta (curta e natural)
      // Variações naturais para não soar repetitivo
      const variations = [
        `${greeting}! 😊 Tudo bem? Como posso te ajudar hoje?`,
        `${greeting}! 😊 O que você precisa hoje?`,
        `${greeting}! 😊 Em que posso ajudar?`,
      ];
      
      // Escolher variação baseada no comprimento da mensagem (para variar)
      const variationIndex = input.messageText.length % variations.length;
      responseText = variations[variationIndex];
    }

    logger.success('✅ Resposta de saudação gerada', { prefix: '[GreetingsTool]', emoji: '✅' });
    logger.pipeline('📝 Resposta', {
      preview: responseText.substring(0, 100) + '...',
      length: responseText.length,
    });
    logger.groupEnd();

    return {
      status: 'done',
      responseText,
    };
  }
}
