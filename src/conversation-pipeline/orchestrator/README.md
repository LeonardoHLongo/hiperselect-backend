# Nova Arquitetura: Router-Executor-Humanizer

## Visão Geral

A nova arquitetura substitui o sistema anterior de Tools por uma abordagem mais estruturada e focada em gestão de experiência do cliente e proteção de reputação.

## Componentes

### 1. Router (Intent Router)
**Localização:** `backend/src/conversation-pipeline/intent-router/`

**Responsabilidade:**
- Classifica mensagens em Intents usando Vercel AI SDK
- Analisa sentimento do cliente (Promotor, Neutro, Insatisfeito)
- Extrai entidades (loja, produto, preço, localização)
- Identifica riscos à reputação

**Intents Suportados:**
- `URGENT_COMPLAINT`: Reclamações graves, problemas de saúde, falhas operacionais críticas
- `PRICE_INQUIRY`: Perguntas sobre preços, disponibilidade, promoções
- `STORE_INFO`: Horários, endereços, contatos das unidades
- `SALUTATION`: Cumprimentos iniciais

### 2. Executor (Intent Executor)
**Localização:** `backend/src/conversation-pipeline/intent-executor/`

**Responsabilidade:**
- Executa ações estratégicas baseadas no Intent classificado
- Gerencia crise para `URGENT_COMPLAINT` (cria tickets urgentes automaticamente)
- Processa consultas de preços com verificação de gerente
- Fornece informações de loja
- Trata saudações

### 3. Humanizer (Agente Boca)
**Localização:** `backend/src/conversation-pipeline/humanizer/`

**Responsabilidade:**
- Transforma respostas técnicas em linguagem natural
- Alinha com posicionamento da marca: profissional, ágil, focado em resolver
- Garante que o cliente sinta que a empresa 'está presente'

### 4. Orchestrator
**Localização:** `backend/src/conversation-pipeline/orchestrator/`

**Responsabilidade:**
- Orquestra as 3 camadas (Router → Executor → Humanizer)
- Gerencia ContextSnapshot (substitui histórico longo)
- Emite eventos apropriados
- Garante rastreabilidade com traceId

## ContextSnapshot

Substitui o histórico longo de mensagens por um objeto leve contendo:
- `currentIntent`: Intent atual
- `selectedStoreId`: Loja selecionada
- `selectedStoreName`: Nome da loja
- `isReputationAtRisk`: Flag de risco à reputação
- `lastInteractionAt`: Timestamp da última interação
- `sentimentHistory`: Últimos 3 sentimentos
- `pendingFields`: Campos pendentes (ex: ['store', 'product'])

## Gestão de Reputação

O sistema monitora automaticamente:
- Clientes insatisfeitos (`sentiment === 'DISSATISFIED'`)
- Reclamações urgentes (`intent === 'URGENT_COMPLAINT'`)

Quando detectado, marca a conversa com `isReputationAtRisk = true` e emite evento `conversation.reputation.at.risk` para monitoramento em tempo real.

## Gestão de Crise Automática

Quando `URGENT_COMPLAINT` é detectado:
1. Cria ticket URGENTE automaticamente
2. Desliga IA para a conversa
3. Emite evento de handoff
4. Notifica equipe

## Verificação com Gerente

Para `PRICE_INQUIRY`:
1. Verifica se loja tem gerente configurado
2. Se sim: cria task e envia mensagem ao gerente
3. Se não: fornece telefone da loja

## Migração

Para migrar do sistema antigo para o novo:

1. **Aplicar migration:**
   ```sql
   -- backend/database/migrations/025_add_reputation_at_risk.sql
   ```

2. **Atualizar bootstrap:**
   - Substituir `ConversationPipeline` por `ConversationOrchestrator`
   - Passar `openaiApiKey` para o orchestrator

3. **Configurar BullMQ (opcional):**
   - Para gerenciar timeout de 20 minutos de verificações com gerentes
   - Ver: `backend/src/conversation-pipeline/queue/manager-verification-queue.ts`

## Próximos Passos

- [ ] Integrar BullMQ no bootstrap
- [ ] Testar fluxo completo Router-Executor-Humanizer
- [ ] Adicionar métricas de reputação em tempo real
- [ ] Implementar dashboard de monitoramento de reputação
