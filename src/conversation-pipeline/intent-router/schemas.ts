/**
 * Schemas Zod para Intents e Análise de Sentimento
 * Validação rigorosa dos dados extraídos pelo Router
 */
import { z } from 'zod';

/**
 * Intents possíveis do sistema
 */
export const IntentSchema = z.enum([
  'URGENT_COMPLAINT',
  'PRICE_INQUIRY',
  'STORE_INFO',
  'SALUTATION',
  'HUMAN_REQUEST',
  'RESERVATION_REQUEST',
  'ACKNOWLEDGMENT', // Confirmações passivas (ok, beleza, obrigado) - permite Silent Drop
  'UNKNOWN', // Para mensagens incoerentes ou fora de contexto
]).describe(
  "A intenção primária do usuário. Se for um elogio curto após feedback check-in, use SALUTATION ou mantenha o contexto de feedback. " +
  "Se o usuário está respondendo a uma pergunta anterior do sistema (ex: 'Sim', 'Não', 'Armação'), mantenha o intent do fluxo anterior. " +
  "Nunca use UNKNOWN se puder inferir pelo histórico ou contexto. Use UNKNOWN apenas para mensagens totalmente incoerentes ou fora do contexto de supermercado."
);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Análise de Sentimento
 */
export const SentimentSchema = z.enum([
  'PROMOTER',    // Cliente satisfeito, promotor da marca
  'NEUTRAL',     // Cliente neutro
  'DISSATISFIED', // Cliente insatisfeito
]).describe(
  "O sentimento emocional do cliente. PROMOTER: satisfeito, elogios, feedback positivo (ex: 'excelente', 'ótimo', 'adorei'). " +
  "DISSATISFIED: insatisfeito, reclamando, frustrado (ex: 'ruim', 'péssimo', 'não gostei'). " +
  "NEUTRAL: neutro, apenas fazendo perguntas sem carga emocional. Se o sistema perguntou sobre feedback e o cliente respondeu positivamente, use PROMOTER."
);

export type Sentiment = z.infer<typeof SentimentSchema>;

/**
 * Entidades extraídas da mensagem
 * 
 * IMPORTANTE: Para máxima compatibilidade com AI SDK e structured outputs (strict mode),
 * use .nullable() em vez de .optional() conforme documentação:
 * https://ai-sdk.dev/docs/ai-sdk-core/prompt-engineering#optional-parameters
 * 
 * "For maximum compatibility, optional parameters should use .nullable() instead of .optional()"
 */
export const EntitiesSchema = z.object({
  store_name: z.string().nullable().describe(
    "O nome exato da loja mencionada (ex: 'Armação', 'Centro', 'Lagoa', 'Rio Tavares'). " +
    "Se o usuário mencionar um bairro ou localização que corresponda a uma loja da lista disponível, extraia o nome completo da loja. " +
    "Variações como 'da Armação', 'na Armação', 'unidade Armação', 'Hiperselect Armação' devem resultar em 'Armação'. " +
    "Se a mensagem atual não mencionar loja mas o histórico mencionar, use o valor do histórico. " +
    "Se o usuário mencionar uma localização casualmente (ex: 'Moro no Rio Tavares'), extraia se corresponder a uma loja disponível."
  ),
  store: z.string().nullable().describe("DEPRECATED: usar store_name. Mantido para compatibilidade."),
  product_name: z.string().nullable().describe(
    "O nome exato do produto mencionado, extrair APENAS o nome do produto sem palavras como 'preço', 'valor', 'tem', 'custa', 'viu', 'olha', 'sabe'. " +
    "IMPORTANTE: Extraia o produto MESMO se estiver no plural (ex: 'ovos' → 'ovos' ou normalize para 'ovo', 'leites' → 'leite'). " +
    "Ignore palavras iniciais como 'viu', 'olha', 'sabe', 'opa' - elas não são parte do produto. " +
    "Exemplos: " +
    "'quanto custa o leite' → 'leite', " +
    "'tem pão integral aí?' → 'pão integral', " +
    "'preço do arroz' → 'arroz', " +
    "'viu ainda tem a promoção de ovos ai?' → 'ovos' (ou 'ovo'), " +
    "'tem leite em promoção?' → 'leite', " +
    "'quanto custa os ovos?' → 'ovos' (ou 'ovo'). " +
    "Não inclua marcas genéricas sem o produto. Se mencionar 'picanha', extraia 'picanha', não 'carne'. " +
    "Se a mensagem mencionar produto + promoção, extraia o product_name E marque is_promotion_query: true."
  ),
  product: z.string().nullable().describe("DEPRECATED: usar product_name. Mantido para compatibilidade."),
  department: z.string().nullable().describe(
    "Setor do supermercado mencionado (Padaria, Açougue, Hortifruti, Peixaria, Laticínios, etc.) ou null se não mencionado. " +
    "Extraia apenas se o usuário mencionar explicitamente o setor ou se o produto mencionado claramente pertence a um setor específico."
  ),
  price: z.string().nullable().describe(
    "Valor monetário mencionado na mensagem (ex: 'R$ 5,99', '10 reais', 'cinco reais'). " +
    "Extraia o valor exato como string, mantendo a formatação mencionada pelo usuário."
  ),
  location: z.string().nullable().describe(
    "Localização geográfica mencionada que NÃO corresponde a uma loja (ex: 'moro no centro', 'estou na praia'). " +
    "Se a localização corresponder a uma loja da lista disponível, use store_name em vez de location."
  ),
  is_promotion_query: z.boolean().nullable().describe(
    "true se a mensagem é explicitamente sobre promoção, oferta ou desconto (ex: 'está em promoção?', 'tem desconto?', 'ainda tá na promoção?'). " +
    "false se não mencionar promoção. null se não for relevante para a mensagem."
  ),
  pickup_time: z.string().nullable().describe(
    "Horário de retirada confirmado pelo usuário (formato ISO ou timestamp). " +
    "Extraia apenas se o usuário mencionar explicitamente um horário para retirada (ex: '16h', 'às 16', '16 horas', '4 da tarde', 'amanhã às 10h'). " +
    "Use apenas para RESERVATION_REQUEST."
  ),
  quantity: z.string().nullable().describe(
    "Quantidade de produtos para reserva mencionada pelo usuário (ex: '2', 'três', 'alguns', 'um', 'uma dúzia'). " +
    "Extraia como string mantendo a forma mencionada. Use apenas para RESERVATION_REQUEST."
  ),
});

export type Entities = z.infer<typeof EntitiesSchema>;

/**
 * Resultado do Intent Dispatcher (Agent 1)
 * 
 * Responsabilidade: Apenas classificar INTENT e SENTIMENT
 * NÃO extrai entidades - isso é responsabilidade do EntityExtractorAgent
 * 
 * IMPORTANTE: O campo 'reasoning' DEVE ser o primeiro campo para garantir Chain of Thought.
 */
export const RouterResultSchema = z.object({
  reasoning: z.string().describe(
    "O raciocínio passo-a-passo que levou à classificação da INTENÇÃO e SENTIMENTO. " +
    "Explique: (1) o que o usuário disse, (2) o contexto da conversa anterior (se houver), (3) por que escolheu este intent específico. " +
    "Seja específico sobre como o contexto histórico ou a última ação do sistema influenciou a classificação. " +
    "NÃO mencione extração de entidades (produtos, lojas) - isso será feito por outro agente. " +
    "Exemplo: 'User is confirming a positive experience from a previous system question about feedback check-in. The system asked about pickup experience, and user responded positively with sentiment PROMOTER.'"
  ),
  intent: IntentSchema,
  sentiment: SentimentSchema,
  confidence: z.number().min(0).max(1).describe(
    "Confiança na classificação (0.0 a 1.0). " +
    "Use 0.9+ para mensagens claras e diretas. " +
    "Use 0.7-0.8 para mensagens que dependem de contexto histórico. " +
    "Use 0.5-0.6 para mensagens ambíguas. " +
    "Use 0.1 apenas para mensagens totalmente incoerentes ou fora de contexto (UNKNOWN)."
  ),
  isReputationAtRisk: z.boolean().describe(
    "true se sentiment === 'DISSATISFIED' ou intent === 'URGENT_COMPLAINT'. " +
    "Indica que a conversa requer atenção imediata para proteger a reputação da empresa."
  ),
});

export type RouterResult = z.infer<typeof RouterResultSchema>;

/**
 * Resultado do Entity Extractor (Agent 2)
 * 
 * Responsabilidade: Extrair APENAS entidades (produtos, lojas, horários, quantidades)
 * NÃO classifica intenção - isso já foi feito pelo Intent Dispatcher
 * 
 * IMPORTANTE: O campo 'reasoning' DEVE ser o primeiro campo para garantir Chain of Thought focado em extração.
 */
export const EntityExtractorSchema = z.object({
  reasoning: z.string().describe(
    "O raciocínio passo-a-passo que levou à extração das entidades. " +
    "Explique: (1) o que foi mencionado na mensagem atual, (2) o que foi mencionado no histórico recente, (3) como extraiu cada entidade (produto, loja, horário, quantidade). " +
    "Se a mensagem atual omitir um produto mas ele foi claramente estabelecido no histórico recente, explique que está extraindo do histórico. " +
    "Seja específico sobre como ignorou palavras iniciais como 'viu', 'olha', 'sabe' e focou apenas nos dados relevantes."
  ),
  store_name: z.string().nullable().describe(
    "O nome exato da loja mencionada (ex: 'Armação', 'Centro', 'Lagoa', 'Rio Tavares'). " +
    "Se o usuário mencionar um bairro ou localização que corresponda a uma loja da lista disponível, extraia o nome completo da loja. " +
    "Variações como 'da Armação', 'na Armação', 'unidade Armação', 'Hiperselect Armação' devem resultar em 'Armação'. " +
    "Se a mensagem atual não mencionar loja mas o histórico mencionar (ex: 'da Armação'), use o valor do histórico. " +
    "Se o usuário mencionar uma localização casualmente (ex: 'Moro no Rio Tavares'), extraia se corresponder a uma loja disponível."
  ),
  store: z.string().nullable().describe("DEPRECATED: usar store_name. Mantido para compatibilidade."),
  product_name: z.string().nullable().describe(
    "O nome exato do produto mencionado, extrair APENAS o nome do produto sem palavras como 'preço', 'valor', 'tem', 'custa', 'viu', 'olha', 'sabe'. " +
    "IMPORTANTE: Extraia o produto MESMO se estiver no plural (ex: 'ovos' → 'ovos' ou normalize para 'ovo', 'leites' → 'leite'). " +
    "Ignore palavras iniciais como 'viu', 'olha', 'sabe', 'opa' - elas não são parte do produto. " +
    "Se a mensagem atual omitir o produto mas ele foi claramente estabelecido no histórico recente (ex: 'ainda tem a promoção de ovos ai?' seguido de 'armação'), extraia 'ovos' do histórico. " +
    "Exemplos: " +
    "'quanto custa o leite' → 'leite', " +
    "'tem pão integral aí?' → 'pão integral', " +
    "'preço do arroz' → 'arroz', " +
    "'viu ainda tem a promoção de ovos ai?' → 'ovos' (ou 'ovo'), " +
    "'tem leite em promoção?' → 'leite', " +
    "'quanto custa os ovos?' → 'ovos' (ou 'ovo'). " +
    "Não inclua marcas genéricas sem o produto. Se mencionar 'picanha', extraia 'picanha', não 'carne'. " +
    "Se a mensagem mencionar produto + promoção, extraia o product_name E marque is_promotion_query: true."
  ),
  product: z.string().nullable().describe("DEPRECATED: usar product_name. Mantido para compatibilidade."),
  department: z.string().nullable().describe(
    "Setor do supermercado mencionado (Padaria, Açougue, Hortifruti, Peixaria, Laticínios, etc.) ou null se não mencionado. " +
    "Extraia apenas se o usuário mencionar explicitamente o setor ou se o produto mencionado claramente pertence a um setor específico."
  ),
  price: z.string().nullable().describe(
    "Valor monetário mencionado na mensagem (ex: 'R$ 5,99', '10 reais', 'cinco reais'). " +
    "Extraia o valor exato como string, mantendo a formatação mencionada pelo usuário."
  ),
  location: z.string().nullable().describe(
    "Localização geográfica mencionada que NÃO corresponde a uma loja (ex: 'moro no centro', 'estou na praia'). " +
    "Se a localização corresponder a uma loja da lista disponível, use store_name em vez de location."
  ),
  is_promotion_query: z.boolean().nullable().describe(
    "true se a mensagem é explicitamente sobre promoção, oferta ou desconto (ex: 'está em promoção?', 'tem desconto?', 'ainda tá na promoção?'). " +
    "false se não mencionar promoção. null se não for relevante para a mensagem."
  ),
  pickup_time: z.string().nullable().describe(
    "Horário de retirada confirmado pelo usuário (formato ISO ou timestamp). " +
    "Extraia apenas se o usuário mencionar explicitamente um horário para retirada (ex: '16h', 'às 16', '16 horas', '4 da tarde', 'amanhã às 10h'). " +
    "Use apenas para RESERVATION_REQUEST."
  ),
  quantity: z.string().nullable().describe(
    "Quantidade de produtos para reserva mencionada pelo usuário (ex: '2', 'três', 'alguns', 'um', 'uma dúzia'). " +
    "Extraia como string mantendo a forma mencionada. Use apenas para RESERVATION_REQUEST."
  ),
});

export type EntityExtractorResult = z.infer<typeof EntityExtractorSchema>;

/**
 * Resultado consolidado (RouterResult + EntityExtractorResult)
 * 
 * Usado pelo Orchestrator para passar dados completos para o Executor
 * Mantém compatibilidade com a interface existente do Executor
 */
export type ConsolidatedRouterResult = RouterResult & {
  entities: z.infer<typeof EntitiesSchema>; // EntitiesSchema mantido para compatibilidade
};
