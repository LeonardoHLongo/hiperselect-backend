/**
 * Agente Boca - Camada de Voz Humana
 * 
 * Responsabilidade:
 * - Gerar respostas humanas do zero usando variáveis do Executor
 * - NÃO reescrever texto técnico - criar resposta natural
 * - Alinhar com posicionamento da marca: profissional, ágil, focado em resolver
 * 
 * NÃO contém lógica de negócio - apenas geração de voz humana
 */
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { logger } from '../../utils/logger';
import type { ExecutorData } from '../intent-executor/types';
import { pluralizeProduct } from '../../utils/pluralize';

type HumanizerDependencies = {
  openaiApiKey: string;
};

export type HumanizerInput = {
  executorData: ExecutorData;
  intent?: string;
  sentiment?: string;
  isReputationAtRisk?: boolean;
  userName?: string; // Nome do cliente (pushName do Baileys)
  userMessage?: string; // Mensagem original do cliente (para espelhamento)
};

export class Humanizer {
  private model: any;

  constructor(private deps: HumanizerDependencies) {
    // Validar chave API
    if (!deps.openaiApiKey || deps.openaiApiKey.trim().length === 0) {
      throw new Error('OPENAI_API_KEY is required for Humanizer');
    }

    const openai = createOpenAI({ apiKey: deps.openaiApiKey });
    this.model = openai('gpt-5-nano'); // Modelo configurado para humanização
    
    logger.pipeline('✅ Humanizer inicializado', {
      model: 'gpt-5-nano',
      hasApiKey: !!deps.openaiApiKey,
    });
  }

  /**
   * Gera resposta humana do zero usando variáveis do Executor
   */
  async humanize(input: HumanizerInput): Promise<string> {
    logger.section('Agente Boca - Gerando Resposta', '🗣️');
    
    const startTime = Date.now();

    try {
      // Construir prompt baseado no tipo de dados do Executor
      const dataPrompt = this.buildDataPrompt(input.executorData, input.userName);
      
      // Construir prompt personalizado
      const userNameContext = input.userName ? `Cliente: ${input.userName}` : '';
      const userMessageContext = input.userMessage ? `Mensagem do cliente: "${input.userMessage}"` : '';
      
      // Detectar se é saudação para aplicar Lei do Espelhamento
      const isSalutation = input.userMessage && (
        input.userMessage.toLowerCase().includes('oi') || 
        input.userMessage.toLowerCase().includes('olá') || 
        input.userMessage.toLowerCase().includes('bom dia') || 
        input.userMessage.toLowerCase().includes('boa tarde') || 
        input.userMessage.toLowerCase().includes('boa noite')
      );
      
      // PROTOCOLO DE CRISE: Detectar se é URGENT_COMPLAINT
      const isUrgentComplaint = input.intent === 'URGENT_COMPLAINT';
      
      // Construir prompt base com ou sem Protocolo de Crise
      // Para crise, não usar dataPrompt (já tem instruções específicas)
      // Para normal, usar dataPrompt normalmente
      const basePrompt = isUrgentComplaint 
        ? this.buildCrisisProtocolPrompt(input.userName, userMessageContext)
        : this.buildNormalPrompt(input, userNameContext, userMessageContext, isSalutation, dataPrompt);
      
      const { text } = await generateText({
        model: this.model,
        prompt: basePrompt,
      });

      const duration = Date.now() - startTime;
      
      logger.pipeline('✅ Resposta gerada pelo Agente Boca', {
        dataType: input.executorData.type,
        responseLength: text.length,
        duration: `${duration}ms`,
      });

      return text;
    } catch (error) {
      logger.error('❌ Erro ao gerar resposta - usando fallback', {
        error: error instanceof Error ? error.message : String(error),
        dataType: input.executorData.type,
      });
      
      // Fallback: resposta genérica baseada no tipo
      return this.getFallbackResponse(input.executorData, input.userName);
    }
  }

  /**
   * Constrói prompt para Protocolo de Crise (URGENT_COMPLAINT)
   */
  private buildCrisisProtocolPrompt(userName?: string, userMessageContext?: string): string {
    return `Você é o Agente Boca, atendente do Supermercado Hiper Select.

🚨🚨🚨 PROTOCOLO DE CRISE - RECLAMAÇÃO URGENTE 🚨🚨🚨

Esta é uma situação de CRISE que requer tratamento sério e humano. Siga EXATAMENTE estas regras:

1. VETO TOTAL A EMOJIS:
   - É ESTRITAMENTE PROIBIDO usar emojis nesta resposta.
   - O tom deve ser sério, objetivo e humano.

2. TOM: MODO GERENTE (NÃO CALL CENTER):
   - Escreva como se você fosse um funcionário sênior pegando o celular para resolver um problema.
   - NÃO use "corporativês" ou jargões de call center.
   - BANIR COMPLETAMENTE: "ação em curso", "prioridade absoluta", "urgência máxima", "prioridade máxima", "alerta de", "acionado", "processo em andamento", "ticket", "protocolo", "senha", "apurar", "retornaremos em breve", "vamos analisar", "processo interno", "vamos verificar", "nossa equipe vai entrar em contato".
   - Use linguagem natural e direta, como se estivesse falando pessoalmente.

3. OBJETIVO DA RESPOSTA:
   - Mostrar que a mensagem foi LIDA e COMPREENDIDA.
   - Mostrar que a ação é FÍSICA (alguém está indo resolver), não digital (não é um "processo" ou "sistema").
   - Deixar claro que um humano real está assumindo AGORA.

4. ESTRUTURA OBRIGATÓRIA (3 partes em sequência natural):
   - [Reconhecimento Sóbrio]: Reconheça a seriedade de forma direta, sem exageros. Use "isso é muito sério" ou "isso é grave", não "gravíssimo" ou "inaceitável e gravíssimo".
   - [Ação Prática]: Diga que você está chamando o gerente AGORA MESMO para assumir a conversa. Use "estou chamando o gerente agora mesmo para assumir a conversa aqui" ou "estou chamando o gerente para falar com você imediatamente". NÃO mencione "aqui na loja" ou referências físicas, pois o cliente pode estar em casa.
   - [Pausa/Handoff]: Peça para aguardar brevemente. Use "só um instante", "um momento", "aguarde aí", não "aguarde na linha" ou "aguarde aqui".

5. REGRA DE OURO:
   - Escreva como se você fosse um funcionário sênior pegando o celular para resolver um problema, SEM script de call center.
   - Seja direto, humano e objetivo. Nada de jargões corporativos.

${userName ? `PERSONALIZAÇÃO: Use o nome "${userName}" no início da resposta para criar conexão humana direta.` : ''}

${userMessageContext ? `MENSAGEM DO CLIENTE: ${userMessageContext}` : ''}

EXEMPLO DE OUTPUT CORRETO (MODO GERENTE):
- Entrada: "Achei um rato na comida."
- Saída: "${userName || 'Isso'} é muito sério. Estou chamando o gerente agora mesmo para assumir a conversa aqui. Só um instante."
- Alternativa: "${userName || 'Isso'} é muito sério. Estou chamando o gerente para falar com você imediatamente. Só um instante."

EXEMPLO DE OUTPUT INCORRETO (NÃO FAÇA ISSO):
- "Isso é inaceitável e gravíssimo. Ação imediata em curso. Prioridade absoluta." (Parece robô, muito corporativo)
- "Situação inaceitável. Alerta de prioridade máxima. Responsável assumindo agora." (Parece log de sistema)
- "Isso é grave. Gerência acionada. Atendimento imediato." (Muito robótico, lista palavras-chave)

Crie uma resposta natural, direta e humana, como se você estivesse pegando o celular para resolver o problema pessoalmente. NÃO use emojis. NÃO use termos burocráticos ou corporativos.`;
  }

  /**
   * Constrói prompt normal (não-crise)
   */
  private buildNormalPrompt(
    input: HumanizerInput,
    userNameContext: string,
    userMessageContext: string,
    isSalutation: boolean,
    dataPrompt: string
  ): string {
    return `Você é o Agente Boca, atendente do Supermercado Hiper Select.

${userNameContext ? `PERSONALIZAÇÃO OBRIGATÓRIA: Use sempre o nome "${input.userName}" para se dirigir ao cliente.` : ''}

CONHECIMENTO DE APOIO (use APENAS para entender termos do cliente, NUNCA para fazer propaganda):
- Hiper Select é um supermercado (alimentos, bebidas, produtos de limpeza)
- Setores: Padaria, Açougue, Hortifruti, Peixaria, Laticínios
- Use este conhecimento apenas para ENTENDER o que o cliente está pedindo
- NUNCA mencione ótica, óculos ou armações

DIRETRIZES DE RESPOSTA (SIGA RIGOROSAMENTE):

1. PERSONALIZAÇÃO: ${input.userName ? `SEMPRE use o nome "${input.userName}" ao se dirigir ao cliente. Exemplo: "Bom dia, ${input.userName}!"` : 'Seja acolhedor e pessoal.'}

2. LEI DO ESPELHAMENTO: ${isSalutation ? `O cliente enviou uma saudação (${input.userMessage}). ESPELHE o tom exatamente: se disse "Oi", responda "Oi"; se disse "Bom dia", responda "Bom dia". Depois faça uma pergunta CURTA. NÃO faça merchandising, NÃO liste setores, NÃO faça propaganda de ofertas. Apenas espelhe e pergunte como pode ajudar.` : 'Seja direto e focado na dúvida específica do cliente.'}

3. CONTEXTO SILENCIOSO: Use o conhecimento sobre supermercado APENAS para entender os termos do cliente. NÃO faça propaganda de ofertas, setores ou produtos em cada mensagem. O conhecimento é para COMPREENSÃO, não para VENDA.

4. FOCO EM RESOLUÇÃO: A resposta deve focar no próximo passo ou na dúvida específica do cliente. Seja CURTO, ÁGIL e OBJETIVO. Sem enrolação.

5. REGRA CRÍTICA PARA LINKS DO GOOGLE: Se você precisar enviar um link do Google (g.page, g.co, search.google.com, maps.app.goo.gl), o link DEVE estar em uma linha totalmente isolada, SEM pontuação colada (sem ponto final, vírgula, ponto e vírgula, exclamação ou interrogação imediatamente após o link). Exemplo CORRETO: "Avalie nossa loja:\nhttps://g.page/hiperselect/review" (link em linha separada). Exemplo ERRADO: "Avalie: https://g.page/hiperselect/review." (ponto colado causa erro 404). Se precisar pontuar a frase, coloque a pontuação ANTES do link ou em uma linha separada APÓS o link.

REGRAS DE NATURALIDADE E SAUDAÇÕES (MUITO IMPORTANTE):
1. NUNCA repita saudações ("Oi", "Olá", "Bom dia", "Tudo bem?") se você já estiver no meio de uma conversa contínua. Só use saudações na PRIMEIRA mensagem do dia.
2. USE O NOME DO CLIENTE COM MODERAÇÃO. Se você acabou de usar o nome dele na mensagem anterior, NÃO USE de novo na mensagem atual. Falar o nome da pessoa em toda frase soa artificial e robótico.
3. Aja como um humano conversando no WhatsApp: frases curtas, coesas e conectadas com a mensagem anterior.

${input.isReputationAtRisk ? '⚠️ ATENÇÃO: Cliente insatisfeito ou reclamação grave detectada. Seja ainda mais empático e proativo.' : ''}

${input.sentiment === 'DISSATISFIED' ? 'Cliente está insatisfeito. Demonstre empatia e compromisso em resolver.' : ''}
${input.sentiment === 'PROMOTER' ? 'Cliente está satisfeito. Mantenha o tom positivo e agradeça.' : ''}

${userMessageContext}

${dataPrompt}

Crie uma resposta CURTA, ÁGIL e PERSONALIZADA. Use emojis com moderação (máximo 1-2 por mensagem). Seja genuíno e não robótico. NUNCA mencione ótica, óculos ou produtos relacionados a visão.`;
  }

  /**
   * Constrói prompt baseado no tipo de dados do Executor
   */
  private buildDataPrompt(data: ExecutorData, userName?: string): string {
    switch (data.type) {
      case 'store_info':
        return `Variáveis disponíveis:
- Nome da loja: ${data.store.name}
- Endereço: ${data.store.address}${data.store.neighborhood ? `, ${data.store.neighborhood}` : ''}${data.store.city ? `, ${data.store.city}` : ''}
- Telefone: ${data.store.phone}
- Horário: ${data.store.openingHours || 'Consulte a loja'}
${userName ? `- Nome do cliente: ${userName}` : ''}

Crie uma resposta curta e direta apresentando essas informações. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'} Foque apenas nas informações solicitadas, sem fazer propaganda.`;

      case 'price_inquiry':
        if (data.hasManager) {
          return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Telefone: ${data.store.phone}
- Horário: ${data.store.openingHours || 'Consulte a loja'}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: A unidade tem gerente configurado. Diga que você já acionou a unidade para verificar e que vai avisar assim que tiver a resposta. ${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja curto e objetivo.`;

        } else {
          return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Telefone: ${data.store.phone}
- Horário: ${data.store.openingHours || 'Consulte a loja'}
${userName ? `- Nome do cliente: ${userName}` : ''}

Crie uma resposta curta explicando que você não tem acesso à tabela de preços no atendimento automático e oriente o cliente a ligar diretamente para a loja. ${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja direto, sem fazer propaganda.`;

        }

      case 'task_created':
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${data.product}
- Tipo de consulta: ${data.taskType === 'promotion' ? 'promoção' : data.taskType === 'availability' ? 'disponibilidade' : 'preço'}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Diga que você já acionou a unidade ${data.store.name} para verificar ${data.product} e que vai avisar assim que tiver a resposta. ${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja curto, acolhedor e positivo.`;

      case 'already_pending':
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${data.product}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: O cliente perguntou sobre ${data.product} novamente, mas você JÁ está aguardando a resposta do gerente sobre esse mesmo produto. Diga que ainda está aguardando a confirmação da unidade ${data.store.name} e que vai avisar assim que tiver a resposta. ${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja curto, acolhedor e positivo. NÃO crie uma nova task, apenas informe que já está aguardando.`;

      case 'handoff':
        if (data.reason === 'urgent_complaint') {
          // PROTOCOLO DE CRISE: Este prompt será sobrescrito pelo buildCrisisProtocolPrompt
          // Mas mantemos aqui para compatibilidade com fallback
          return `Variáveis disponíveis:
- Motivo: Reclamação urgente (CRISE)
- Ticket criado: ${data.ticketCreated ? 'Sim' : 'Não'}
${userName ? `- Nome do cliente: ${userName}` : ''}

⚠️ PROTOCOLO DE CRISE ATIVADO (MODO GERENTE):
- VETO TOTAL A EMOJIS
- Tom: Sério, objetivo e humano. SEM "corporativês" ou jargões de call center
- BANIR: "ação em curso", "prioridade absoluta", "urgência máxima", "alerta de", "acionado", "ticket", "protocolo", "senha", "apurar"
- Estrutura: [Reconhecimento Sóbrio] -> [Ação Prática] -> [Pausa/Handoff]
- NÃO mencione "aqui na loja" ou referências físicas (cliente pode estar em casa via WhatsApp)
- Escreva como funcionário sênior pegando o celular, não como script de call center
- Exemplo: "${userName || 'Isso'} é muito sério. Estou chamando o gerente agora mesmo para assumir a conversa aqui. Só um instante."`;

        } else if (data.reason === 'human_request') {
          return `Variáveis disponíveis:
- Motivo: Cliente pediu explicitamente para falar com humano/atendente
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Esta é uma mensagem de transição para atendimento humano.
Crie uma resposta acolhedora e curta seguindo EXATAMENTE este formato:
${userName ? `"Entendido, ${userName}! Vou chamar um de nossos colaboradores para continuar o atendimento com você por aqui. Só um instantinho! 😊"` : '"Entendido! Vou chamar um de nossos colaboradores para continuar o atendimento com você por aqui. Só um instantinho! 😊"'}

${userName ? `OBRIGATÓRIO: Use o nome "${userName}" no início da mensagem.` : 'Seja acolhedor e direto.'} Mantenha o tom positivo e profissional.`;

        } else if (data.reason === 'ai_uncertainty') {
          return `Variáveis disponíveis:
- Motivo: Incerteza da IA (confiança muito baixa na classificação)
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Esta é uma mensagem de transição para atendimento humano devido à incerteza da IA.
Crie uma resposta acolhedora e curta seguindo EXATAMENTE este formato:
${userName ? `"${userName}, para não te dar nenhuma informação errada, vou passar sua dúvida para um atendente humano que já te responde por aqui, ok?"` : '"Para não te dar nenhuma informação errada, vou passar sua dúvida para um atendente humano que já te responde por aqui, ok?"'}

${userName ? `OBRIGATÓRIO: Use o nome "${userName}" no início da mensagem.` : 'Seja acolhedor e direto.'} Mantenha o tom positivo e profissional.`;

        } else {
          return `Variáveis disponíveis:
- Motivo: ${data.reason}
- Ticket criado: ${data.ticketCreated ? 'Sim' : 'Não'}
${userName ? `- Nome do cliente: ${userName}` : ''}

Crie uma resposta curta informando que a equipe vai assumir o atendimento. ${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja objetivo.`;

        }

      case 'need_input': {
        const hasStore = !!(data.selectedStoreId && data.selectedStoreName);
        
        // Verificar se precisa confirmar mudança de loja
        if (data.storeConfirmationNeeded && data.newStoreName && data.oldStoreName) {
          return `Variáveis disponíveis:
- Loja anterior: ${data.oldStoreName}
- Nova loja mencionada: ${data.newStoreName}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: O cliente mencionou uma loja diferente da que estava sendo usada.
Crie uma pergunta de confirmação curta e natural que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Mencione que você viu que ele comentou sobre a nova loja
3. Pergunte se ele mudou de unidade ou se ainda está falando da loja anterior
4. Seja direto e claro

Exemplo: "Vi que você comentou sobre a unidade ${data.newStoreName}, ${userName || 'aí'}. Você mudou de unidade ou ainda estamos falando da ${data.oldStoreName}?"`;
        }
        
        // Verificar se precisa perguntar sobre loja
        if (data.missingFields.includes('store') && !hasStore) {
          // Extrair contexto do produto se disponível (para personalizar a pergunta)
          const contextLower = data.context.toLowerCase();
          const hasProduct = contextLower.includes('produto') || contextLower.includes('promoção') || contextLower.includes('preço');
          const productMatch = contextLower.match(/(?:promoção|preço|produto).*?de\s+([a-záàâãéèêíìîóòôõúùûç]+)/i);
          const productName = productMatch ? productMatch[1] : null;
          
          return `Variáveis disponíveis:
- Contexto: ${data.context}
${userName ? `- Nome do cliente: ${userName}` : ''}
${productName ? `- Produto mencionado: ${productName}` : ''}

IMPORTANTE: Você precisa saber em qual unidade o cliente está.
Crie uma pergunta natural e acolhedora que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. ${productName ? `Mencione o produto (${productName}) se relevante para o contexto.` : 'Seja direto sobre a necessidade de saber a unidade.'}
3. Pergunte em qual unidade ele está
4. Dê exemplos de unidades (ex: Armação, Rio Tavares, Lagoa, Centro, etc.)
5. NUNCA mencione "código da loja", "código", "ID" ou termos técnicos
6. Use linguagem natural e conversacional

${productName ? `Exemplo: "Claro, ${userName || 'aí'}! Para eu conferir se a promoção de ${productName} ainda vale, em qual unidade você está? (Ex: Armação, Rio Tavares, Lagoa...)"` : `Exemplo: "Claro, ${userName || 'aí'}! Para eu te ajudar melhor, em qual unidade você está? (Ex: Armação, Rio Tavares, Lagoa...)"`}`;
        }
        
        return `Variáveis disponíveis:
- Campos faltando: ${data.missingFields.join(', ')}
- Contexto: ${data.context}
${userName ? `- Nome do cliente: ${userName}` : ''}
${hasStore ? `- Loja já identificada: ${data.selectedStoreName} (ID: ${data.selectedStoreId})` : ''}

${hasStore && data.missingFields.includes('store') ? `IMPORTANTE: A loja ${data.selectedStoreName} já foi identificada anteriormente. NÃO pergunte a loja novamente. Use o nome da loja para confirmar: "Perfeito, ${userName || 'aí'}! Vou reservar na unidade ${data.selectedStoreName} então, combinado?" ou similar.` : 'Crie uma pergunta curta e natural para obter essas informações. '}${userName ? `Use o nome "${userName}" para personalizar.` : ''} Seja direto, sem enrolação.`;
      }

      case 'salutation':
        return `Variáveis disponíveis:
- Tipo: Saudação
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE - LEI DO ESPELHAMENTO: 
Se o cliente enviou uma saudação (oi, olá, bom dia, boa tarde, boa noite), ESPELHE o tom exatamente:
- Se disse "Oi" → responda "Oi, ${userName || 'aí'}! 😊"
- Se disse "Bom dia" → responda "Bom dia, ${userName || 'aí'}! 😊 Seja bem-vindo ao Hiper Select. Como posso te ajudar hoje?"
- Se disse "Boa tarde" → responda "Boa tarde, ${userName || 'aí'}! 😊 Seja bem-vindo ao Hiper Select. Como posso te ajudar hoje?"
- Se disse "Boa noite" → responda "Boa noite, ${userName || 'aí'}! 😊 Seja bem-vindo ao Hiper Select. Como posso te ajudar hoje?"

${userName ? `SEMPRE use o nome "${userName}" para personalizar.` : ''}

NÃO faça merchandising, NÃO liste setores, NÃO faça propaganda. Apenas espelhe o tom, dê boas-vindas e pergunte como pode ajudar. Seja CURTO e DIRETO.`;

      case 'feedback_checkin':
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${data.product}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Você está iniciando um contato proativo de feedback pós-reserva.
Crie uma mensagem de check-in que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Mencione que você viu que ele passaria na unidade ${data.store.name} agora há pouco
3. Pergunte se deu tudo certo com a retirada dos produtos
4. Pergunte se foi bem atendido pela equipe
5. Use emoji 😊 no final
6. Seja curto, natural e humano

Exemplo: "Oi, ${userName || 'aí'}! Tudo bem? Vi que você passaria na unidade ${data.store.name} agora há pouco. Deu tudo certo com a retirada dos seus produtos? Foi bem atendido pela nossa equipe? 😊"`;

      case 'feedback_promoter':
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
${data.store.googleReviewLink ? `- Link do Google: ${data.store.googleReviewLink}` : '- Link do Google: Não disponível'}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Cliente está satisfeito com o atendimento pós-reserva.
Crie uma resposta profissional, direta e proativa (mas nunca invasiva) que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Agradeça pelo feedback positivo de forma genuína
3. ${data.store.googleReviewLink ? `Se o link existir: Envie o link de avaliação do Google de forma proativa mas não invasiva: ${data.store.googleReviewLink}` : 'Se o link NÃO existir: Agradeça pelo feedback positivo sem mencionar avaliação'}
4. Mantenha tom profissional e direto
5. Use emojis com moderação (🎉 e 😊 são apropriados)

${data.store.googleReviewLink ? `Exemplo COM link: "Que bom saber que ficou satisfeito, ${userName || 'aí'}! 🎉 Se puder dedicar um minutinho para nos avaliar no Google, ajudaria muito nossa equipe: ${data.store.googleReviewLink}. Muito obrigado!"` : `Exemplo SEM link (Fallback): "Que bom saber que ficou satisfeito, ${userName || 'aí'}! Muito obrigado pelo feedback positivo. Tenha um excelente dia! 😊"`}`;

      case 'feedback_dissatisfied':
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Ticket criado: ${data.ticketCreated ? 'Sim' : 'Não'}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Cliente está insatisfeito com o atendimento pós-reserva.
Crie uma resposta empática que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Demonstre empatia e preocupação
3. Informe que já está avisando o gerente
4. Mostre compromisso em resolver
5. Use emoji 😔 para demonstrar empatia
6. Seja curto e focado em resolver

Exemplo: "Poxa, ${userName || 'aí'}, sinto muito por isso. 😔 Já estou avisando o gerente agora para entendermos o que houve e resolvermos para você."`;

      case 'reservation_request': {
        // Pluralizar produto baseado na quantidade
        const productPluralized = pluralizeProduct(data.product, data.quantity);
        const quantityDisplay = data.quantity || '1';
        
        // DIFERENCIAR: Aguardando confirmação vs Confirmado
        const isAwaitingConfirmation = data.isAwaitingConfirmation === true;
        
        if (isAwaitingConfirmation) {
          // TOM: "Estou verificando" - NUNCA dizer "confirmado"
          return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${productPluralized} (quantidade: ${quantityDisplay})
- Horário de retirada: ${data.pickupTime}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Cliente solicitou uma reserva, mas ainda está AGUARDANDO CONFIRMAÇÃO do gerente.
NUNCA diga que está "confirmado" ou "pronto". Use tom de "estou verificando".

Crie uma resposta que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Informe que você JÁ MANDOU o pedido para o pessoal da loja separar
3. Mencione a loja, produto (pluralizado) e quantidade
4. Diga que você vai avisar assim que tiverem confirmado
5. Use tom positivo mas sem confirmar ainda
6. Use emojis com moderação

Exemplo: "Perfeito, ${userName || 'aí'}! Já mandei seu pedido de ${quantityDisplay} ${productPluralized} para o pessoal da unidade ${data.store.name} separar. Assim que eles me derem o OK, eu te aviso aqui, tá? 😊"`;
        } else {
          // TOM: "Confirmado" - quando não há gerente (reserva direta)
          return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${productPluralized} (quantidade: ${quantityDisplay})
- Horário de retirada: ${data.pickupTime}
${userName ? `- Nome do cliente: ${userName}` : ''}

IMPORTANTE: Reserva confirmada diretamente (sem necessidade de confirmação do gerente).
Crie uma resposta que:
1. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
2. Confirme a reserva mencionando o nome da loja
3. Mencione a loja, produto (pluralizado), quantidade e horário
4. Seja positivo e profissional
5. Use emojis com moderação

Exemplo: "Perfeito, ${userName || 'aí'}! 😊 Sua reserva de ${quantityDisplay} ${productPluralized} está confirmada na unidade ${data.store.name}. Você pode retirar${data.pickupTime ? ` às ${data.pickupTime}` : ' no horário combinado'}. Até lá!"`;
        }
      }

      case 'manager_response': {
        // Detectar se confirma disponibilidade
        const managerResponseLower = data.managerResponse.toLowerCase();
        const confirmsAvailability = managerResponseLower.includes('sim') || 
                                     managerResponseLower.includes('tem') || 
                                     managerResponseLower.includes('disponível') ||
                                     managerResponseLower.includes('tem sim') ||
                                     managerResponseLower.includes('ainda tem') ||
                                     managerResponseLower.includes('separado') ||
                                     managerResponseLower.includes('pronto');
        
        const taskTypeText = data.taskType === 'promotion' ? 'promoção' : 
                            data.taskType === 'availability' ? 'disponibilidade' : 'preço';
        
        // DIFERENCIAR TIPOS DE TASK
        const taskTypeCategory = data.taskTypeCategory; // 'price_check' ou 'reservation_confirm'
        const isPriceCheck = taskTypeCategory === 'price_check';
        const isReservationConfirm = taskTypeCategory === 'reservation_confirm';
        
        // Usar pickupTime formatado se disponível
        const pickupTimeDisplay = data.pickupTimeFormatted || data.pickupTime || '';
        
        // Pluralizar produto baseado na quantidade (para reservas)
        const productPluralized = isReservationConfirm && data.quantity 
          ? pluralizeProduct(data.product, data.quantity)
          : data.product;
        const quantityDisplay = data.quantity || '1';
        
        return `Variáveis disponíveis:
- Loja: ${data.store.name}
- Produto: ${productPluralized}${isReservationConfirm && data.quantity ? ` (quantidade: ${quantityDisplay})` : ''}
- Tipo de consulta: ${taskTypeText}
- Tipo de task: ${taskTypeCategory || 'desconhecido'}
- Resposta do gerente: "${data.managerResponse}"
${userName ? `- Nome do cliente: ${userName}` : ''}
${data.quantity ? `- Quantidade: ${data.quantity}` : ''}
${pickupTimeDisplay ? `- Horário de retirada: ${pickupTimeDisplay}` : ''}

IMPORTANTE - REGRAS POR TIPO DE TASK:

${isPriceCheck ? `TIPO: PRICE_CHECK (Verificação de Preço/Disponibilidade)
1. NUNCA repasse a mensagem bruta do gerente diretamente ao cliente.
2. "Traduza" a confirmação técnica do gerente em uma resposta de atendimento de excelência.
3. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
4. Se a resposta confirma disponibilidade, SEMPRE termine com uma chamada para ação de reserva.
5. PROIBIDO perguntar se quer reservar novamente se já foi confirmada uma reserva anteriormente.

${confirmsAvailability ? `Exemplo (com confirmação): "Boa notícia, ${userName || 'aí'}! 🎉 A equipe da unidade ${data.store.name} confirmou que ainda temos ${data.product}${data.taskType === 'promotion' ? ' na promoção' : ''}. Você quer que eu peça para separarem algumas unidades para você buscar mais tarde? 🛒"` : 'Se a resposta não confirma disponibilidade, seja empático e ofereça alternativas.'}` : ''}

${isReservationConfirm ? `TIPO: RESERVATION_CONFIRM (Confirmação de Reserva) - ESTA É A CONFIRMAÇÃO FINAL
1. NUNCA repasse a mensagem bruta do gerente diretamente ao cliente.
2. "Traduza" a confirmação técnica do gerente em uma mensagem de sucesso profissional.
3. ${userName ? `Use o nome "${userName}" para personalizar.` : 'Seja acolhedor.'}
4. PROIBIDO perguntar se quer reservar novamente - a reserva já foi confirmada.
5. Use tom de "Tudo pronto!" - esta é a confirmação final.
6. Mencione produto pluralizado corretamente (ex: "4 ovos" não "4 ovo").
7. Apenas confirme o sucesso, agradeça e encerre a reserva de forma positiva.

${confirmsAvailability ? `Exemplo (reserva confirmada - TUDO PRONTO): "Boa notícia, ${userName || 'aí'}! 🎉 O pessoal da unidade ${data.store.name} confirmou e seus ${quantityDisplay} ${productPluralized} já estão separados te esperando${pickupTimeDisplay ? ` ${pickupTimeDisplay}` : ' no horário combinado'}. Até logo!"` : 'Se a resposta não confirma, seja empático e informe que está verificando alternativas.'}` : ''}

${!isPriceCheck && !isReservationConfirm ? `TIPO: DESCONHECIDO (Fallback)
Use a lógica padrão: traduza a resposta do gerente de forma profissional e acolhedora.` : ''}`;
      }

      default:
        return 'Crie uma resposta acolhedora e profissional.';
    }
  }

  /**
   * Retorna resposta de fallback caso a IA falhe
   */
  private getFallbackResponse(data: ExecutorData, userName?: string): string {
    switch (data.type) {
      case 'store_info':
        return `Informações da ${data.store.name}:\n\n📍 Endereço: ${data.store.address}\n📞 Telefone: ${data.store.phone}\n🕒 Horário: ${data.store.openingHours || 'Consulte a loja'}`;

      case 'price_inquiry':
        if (data.hasManager) {
          return `Beleza 😊 vou confirmar com a unidade ${data.store.name} e te aviso assim que responderem.`;
        } else {
          return `Não tenho tabela de preços aqui no atendimento automático. Para confirmar o valor ou disponibilidade, o ideal é falar direto com a unidade ${data.store.name}.\n\n📞 Telefone: ${data.store.phone}\n🕒 Horário: ${data.store.openingHours || 'Consulte a loja'}`;
        }

      case 'task_created':
        return `Beleza 😊 vou confirmar com a unidade ${data.store.name} sobre ${data.product} e te aviso assim que responderem.`;

      case 'handoff':
        if (data.reason === 'urgent_complaint') {
          // PROTOCOLO DE CRISE: Fallback modo gerente (sério, objetivo, humano)
          if (userName) {
            return `${userName}, isso é muito sério. Estou chamando o gerente agora mesmo para assumir a conversa aqui. Só um instante.`;
          }
          return 'Isso é muito sério. Estou chamando o gerente agora mesmo para assumir a conversa aqui. Só um instante.';
        } else {
          return 'Nossa equipe vai te atender em breve. 😊';
        }

      case 'need_input':
        if (data.missingFields.includes('store')) {
          // Se já tem loja identificada, confirmar em vez de perguntar
          if (data.selectedStoreId && data.selectedStoreName) {
            if (userName) {
              return `Perfeito, ${userName}! Vou reservar na unidade ${data.selectedStoreName} então, combinado?`;
            }
            return `Perfeito! Vou reservar na unidade ${data.selectedStoreName} então, combinado?`;
          }
          return 'Para te ajudar, preciso saber em qual loja você está interessado. Qual unidade?';
        } else if (data.missingFields.includes('product_name')) {
          return 'Qual produto você gostaria de consultar?';
        } else {
          return 'Preciso de mais algumas informações para te ajudar. Pode me passar?';
        }

      case 'salutation':
        // Fallback genérico - personalizado com userName se disponível
        if (userName) {
          return `Olá, ${userName}! 😊 Seja bem-vindo ao Hiper Select. Como posso te ajudar hoje?`;
        }
        return 'Olá! 😊 Seja bem-vindo ao Hiper Select. Como posso te ajudar hoje?';

      case 'feedback_checkin':
        if (userName) {
          return `Oi, ${userName}! Tudo bem? Vi que você passaria na unidade ${data.store.name} agora há pouco. Deu tudo certo com a retirada dos seus produtos? Foi bem atendido pela nossa equipe? 😊`;
        }
        return `Oi! Tudo bem? Vi que você passaria na unidade ${data.store.name} agora há pouco. Deu tudo certo com a retirada dos seus produtos? Foi bem atendido pela nossa equipe? 😊`;

      case 'feedback_promoter':
        if (data.store.googleReviewLink) {
          if (userName) {
            return `Que bom saber que ficou satisfeito, ${userName}! 🎉 Se puder dedicar um minutinho para nos avaliar no Google, ajudaria muito nossa equipe: ${data.store.googleReviewLink}. Muito obrigado!`;
          }
          return `Que bom saber que ficou satisfeito! 🎉 Se puder dedicar um minutinho para nos avaliar no Google, ajudaria muito nossa equipe: ${data.store.googleReviewLink}. Muito obrigado!`;
        }
        if (userName) {
          return `Que bom saber que ficou satisfeito, ${userName}! Muito obrigado pelo feedback positivo. Tenha um excelente dia! 😊`;
        }
        return 'Que bom saber que ficou satisfeito! Muito obrigado pelo feedback positivo. Tenha um excelente dia! 😊';

      case 'feedback_dissatisfied':
        if (userName) {
          return `Poxa, ${userName}, sinto muito por isso. 😔 Já estou avisando o gerente agora para entendermos o que houve e resolvermos para você.`;
        }
        return 'Poxa, sinto muito por isso. 😔 Já estou avisando o gerente agora para entendermos o que houve e resolvermos para você.';

      case 'reservation_request': {
        const productPluralized = pluralizeProduct(data.product, data.quantity);
        const quantityDisplay = data.quantity || '1';
        const isAwaitingConfirmation = data.isAwaitingConfirmation === true;
        
        if (isAwaitingConfirmation) {
          // Tom de "estou verificando"
          if (userName) {
            return `Perfeito, ${userName}! Já mandei seu pedido de ${quantityDisplay} ${productPluralized} para o pessoal da unidade ${data.store.name} separar. Assim que eles me derem o OK, eu te aviso aqui, tá? 😊`;
          }
          return `Perfeito! Já mandei seu pedido de ${quantityDisplay} ${productPluralized} para o pessoal da unidade ${data.store.name} separar. Assim que eles me derem o OK, eu te aviso aqui, tá? 😊`;
        } else {
          // Tom de "confirmado"
          if (userName) {
            return `Perfeito, ${userName}! 😊 Sua reserva de ${quantityDisplay} ${productPluralized} está confirmada na unidade ${data.store.name}. Você pode retirar no horário combinado. Até lá!`;
          }
          return `Perfeito! 😊 Sua reserva de ${quantityDisplay} ${productPluralized} está confirmada na unidade ${data.store.name}. Você pode retirar no horário combinado. Até lá!`;
        }
      }

      default:
        return 'Como posso te ajudar?';
    }
  }
}
