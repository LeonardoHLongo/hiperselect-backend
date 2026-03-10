# Contrato de Ordenação de Mensagens

## 📋 Regras Definitivas

### 1. Ordenação no Backend (API)
- **Endpoint**: `GET /api/v1/conversations/:id/messages`
- **Ordenação garantida**: `timestamp ASC, created_at ASC, id ASC`
- **API sempre retorna já ordenado** - frontend NÃO deve fazer sort

### 2. Critérios de Ordenação (Tie-Breakers)
1. **Primeiro**: `timestamp` (Unix timestamp em milissegundos - BIGINT)
2. **Segundo**: `created_at` (Timestamp de inserção no banco - TIMESTAMP)
3. **Terceiro**: `id` (messageId - TEXT, sempre único)

### 3. Normalização de Timestamp
- **Sempre em milissegundos** (BIGINT)
- Timestamps em segundos são automaticamente convertidos
- Validação: `timestamp > 0` (constraint no banco)

### 4. Idempotência
- **PRIMARY KEY** em `id` garante que mesma `messageId` não duplica
- Inserção idempotente: tentar inserir mesma mensagem duas vezes = sucesso (sem erro)

### 5. Mensagens Fora de Ordem
- Mensagens podem chegar fora de ordem (reprocessamento, atrasos)
- **Armazenamento**: Mensagens são salvas com timestamp original
- **Fetch**: Sempre retorna ordenado corretamente (independente da ordem de inserção)

## 🗄️ Estrutura do Banco

### Tabela `messages`
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                    -- messageId único
  conversation_id TEXT NOT NULL,
  timestamp BIGINT NOT NULL,              -- Unix timestamp em ms
  created_at TIMESTAMP DEFAULT NOW(),     -- Timestamp de inserção
  -- ... outros campos
);
```

### Índices
```sql
-- Índice composto para ordenação eficiente
CREATE INDEX messages_conversation_order_idx 
ON messages(conversation_id, timestamp ASC, created_at ASC, id ASC);

-- Índice único para garantir idempotência
CREATE UNIQUE INDEX messages_id_unique ON messages(id);
```

### Constraints
```sql
-- Garantir timestamp positivo
ALTER TABLE messages 
ADD CONSTRAINT messages_timestamp_positive 
CHECK (timestamp > 0);
```

## 🔄 Fluxo de Dados

### 1. Recebimento de Mensagem
```
WhatsApp → Adapter → Event → Handler → Repository.create()
```
- Timestamp normalizado para milissegundos
- Inserção idempotente (PRIMARY KEY garante)

### 2. Busca de Mensagens
```
API Request → Service → Repository.findByConversationId()
```
- Query com `ORDER BY timestamp, created_at, id`
- Retorna sempre ordenado

### 3. Frontend
```
API Response → setMessages() → Render
```
- **NÃO fazer sort no client**
- Renderizar na ordem recebida

## ✅ Garantias

1. **Ordem Cronológica**: Sempre correta, mesmo com:
   - Timestamps iguais
   - Mensagens chegando fora de ordem
   - Reprocessamento de mensagens
   - Atrasos de rede

2. **Idempotência**: Mesma mensagem pode ser processada múltiplas vezes sem duplicar

3. **Performance**: Índice composto garante queries rápidas mesmo com milhões de mensagens

4. **Consistência**: Ordem determinística e previsível

## 🚫 Proibições

- ❌ Frontend não deve fazer `.sort()` nas mensagens
- ❌ Não confiar em ordem de inserção
- ❌ Não usar apenas `timestamp` sem tie-breakers
- ❌ Não assumir que timestamps são únicos

## 📝 Exemplo de Query

```sql
SELECT * 
FROM messages 
WHERE conversation_id = '554896942834'
ORDER BY timestamp ASC, created_at ASC, id ASC;
```

## 🔍 Debug

Se mensagens aparecerem fora de ordem:

1. Verificar logs do repository: `[PostgresMessageRepository] ✅ Fetched X messages`
2. Verificar timestamps: logs mostram primeiro e último timestamp
3. Verificar índices: `\d messages` no psql
4. Verificar constraint: `SELECT * FROM messages WHERE timestamp <= 0;`

