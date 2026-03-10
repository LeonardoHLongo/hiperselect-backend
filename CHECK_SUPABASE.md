# Verificação do Supabase

## Passos para verificar se está salvando no Supabase

### 1. Verificar se SUPABASE_URL está configurado

No arquivo `backend/.env`, você deve ter:

```env
SUPABASE_URL=https://ooancmvihrxzgtegvmwn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. Verificar logs ao iniciar o backend

Ao iniciar o backend, você deve ver:

```
[Config] ✅ SUPABASE_URL detected: https://ooancmvihrxzgtegvmwn.supabase.co
[Config] ✅ PostgreSQL (Supabase) will be used for persistence
[Bootstrap] ✅ Using PostgreSQL repository (Supabase)
[Bootstrap] 🔍 Repository type: PostgresMessageRepository
[Bootstrap] ✅ Confirmed: PostgresMessageRepository is active
[Database] ✅ Supabase connection successful
[Database] ✅ Tables are accessible
```

Se você ver:
```
[Bootstrap] ⚠️  Using in-memory repository (SUPABASE_URL not set)
```

Significa que `SUPABASE_URL` não está configurado no `.env`.

### 3. Verificar se as tabelas existem no Supabase

1. Acesse https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em "Table Editor"
4. Você deve ver as tabelas:
   - `conversations`
   - `messages`
   - `tickets`
   - `ai_decisions`

Se as tabelas não existirem, execute o SQL schema em "SQL Editor".

### 4. Verificar logs ao receber/enviar mensagens

Quando uma mensagem chega ou é enviada, você deve ver:

```
[PostgresMessageRepository] 💾 Saving message to Supabase: <messageId>
[PostgresMessageRepository] Inserting message row into Supabase...
[PostgresMessageRepository] ✅ Message saved successfully to Supabase: <messageId>
[PostgresMessageRepository] Confirmed: Message ID <messageId> in database
```

### 5. Verificar dados no Supabase

1. Acesse Supabase Dashboard → Table Editor
2. Selecione a tabela `messages`
3. Você deve ver as mensagens sendo salvas em tempo real

### 6. Problemas comuns

#### Erro: "Table does not exist"
**Solução**: Execute o SQL schema em Supabase SQL Editor

#### Erro: "SUPABASE_URL not set"
**Solução**: Adicione `SUPABASE_URL` ao arquivo `backend/.env`

#### Erro: "Connection test failed"
**Solução**: Verifique se a URL e a Service Role Key estão corretas

#### Nenhum log de salvamento aparece
**Solução**: Verifique se está usando `PostgresMessageRepository` e não `InMemoryMessageRepository`

