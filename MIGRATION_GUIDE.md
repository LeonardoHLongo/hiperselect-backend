# Guia de Migração para Nova Arquitetura Router-Executor-Humanizer

## ✅ Passos Aplicados

### 1. Migration do Banco de Dados

A migration `025_add_reputation_at_risk.sql` adiciona o campo `is_reputation_at_risk` na tabela `conversations`.

**Para aplicar manualmente:**

1. Acesse o Supabase SQL Editor
2. Execute o conteúdo de `backend/database/migrations/025_add_reputation_at_risk.sql`:

```sql
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS is_reputation_at_risk BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_reputation_at_risk 
ON conversations(tenant_id, is_reputation_at_risk) 
WHERE is_reputation_at_risk = true;

COMMENT ON COLUMN conversations.is_reputation_at_risk IS 'Indica se a reputação está em risco (cliente insatisfeito ou reclamação grave)';
```

**Ou use o script:**
```bash
node backend/scripts/apply-migration-025.js
```

### 2. Bootstrap Atualizado

O `backend/src/bootstrap/index.ts` foi atualizado para usar `ConversationOrchestrator` ao invés de `ConversationPipeline`.

**Mudanças principais:**
- ✅ Substituído `ConversationPipeline` por `ConversationOrchestrator`
- ✅ Removida dependência de `AttendantAI` e `LanguageAgent` (agora integrados no orchestrator)
- ✅ Adicionada validação de `OPENAI_API_KEY` obrigatória

### 3. Event Handlers Atualizados

O `backend/src/bootstrap/events.ts` foi atualizado para usar `conversationOrchestrator` ao invés de `conversationPipeline`.

**Mudanças:**
- ✅ Tipo atualizado de `ConversationPipeline` para `ConversationOrchestrator`
- ✅ Chamadas de método atualizadas

### 4. Pipeline Handlers

O `backend/src/bootstrap/pipeline-handlers.ts` agora inclui handler para evento `conversation.reputation.at.risk`.

## 🚀 Como Testar

1. **Aplicar migration:**
   ```bash
   # No Supabase SQL Editor ou via script
   node backend/scripts/apply-migration-025.js
   ```

2. **Verificar variáveis de ambiente:**
   ```bash
   # Certifique-se de que OPENAI_API_KEY está configurada
   echo $OPENAI_API_KEY
   ```

3. **Iniciar o backend:**
   ```bash
   cd backend
   npm run dev
   ```

4. **Testar fluxo:**
   - Envie uma mensagem de saudação: "Olá"
   - Envie uma consulta de preço: "Quanto custa o leite?"
   - Envie uma reclamação: "Estou muito insatisfeito com o atendimento"

## 📊 Monitoramento

O sistema agora monitora automaticamente:
- **Reputação em risco:** Conversas marcadas com `is_reputation_at_risk = true`
- **Eventos emitidos:** `conversation.reputation.at.risk` para cada detecção

## 🔄 Rollback (se necessário)

Se precisar voltar ao sistema antigo:

1. Reverter `backend/src/bootstrap/index.ts` para usar `ConversationPipeline`
2. Reverter `backend/src/bootstrap/events.ts` para usar `conversationPipeline`
3. O campo `is_reputation_at_risk` pode permanecer no banco (não causa problemas)

## 📝 Notas

- O novo sistema **requer** `OPENAI_API_KEY` configurada
- O sistema antigo (`ConversationPipeline`) ainda está disponível para referência
- Todas as funcionalidades antigas foram preservadas na nova arquitetura
