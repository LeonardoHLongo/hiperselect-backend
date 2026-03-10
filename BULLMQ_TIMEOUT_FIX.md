# Correções Aplicadas para Erro "Command timed out" no BullMQ

## Análise do Problema

O erro `Command timed out` ocorria porque:

1. **Timeouts muito baixos**: `commandTimeout: 5000ms` (5 segundos) era insuficiente para conexões remotas (Railway)
2. **Falta de tratamento de erros**: Timeouts causavam falhas não tratadas
3. **Configurações inadequadas**: `enableReadyCheck: true` causava verificações desnecessárias que podiam timeout
4. **Sem retry adequado**: Falhas não eram recuperadas automaticamente

## Correções Implementadas

### 1. Timeouts Aumentados

```typescript
connectTimeout: 30000,  // 30 segundos (era 10s)
commandTimeout: 30000,  // 30 segundos (era 5s)
```

**Por quê**: Conexões remotas (Railway) têm latência maior. 30s é um timeout seguro que evita falsos positivos.

### 2. Configurações Otimizadas do Redis

```typescript
maxRetriesPerRequest: null,        // Obrigatório para BullMQ
enableReadyCheck: false,           // Evita verificações que causam timeout
enableOfflineQueue: false,         // Não enfileirar quando offline
keepAlive: 30000,                 // Manter conexão viva
family: 4,                        // Forçar IPv4 (mais estável)
```

**Por quê**: 
- `enableReadyCheck: false` evita verificações bloqueantes que podem timeout
- `enableOfflineQueue: false` evita acúmulo de comandos quando offline
- `keepAlive` mantém a conexão ativa, reduzindo reconexões

### 3. Retry Strategy Melhorada

```typescript
retryStrategy: (times) => {
  if (times > 10) {
    return null; // Parar após 10 tentativas
  }
  const delay = Math.min(times * 100, 5000); // Backoff exponencial até 5s
  return delay;
}
```

**Por quê**: 
- Limita tentativas para evitar loops infinitos
- Backoff exponencial reduz carga no Redis
- Logs informativos para debugging

### 4. Configurações do Worker

```typescript
concurrency: 1,                    // Processar 1 job por vez
limiter: {
  max: 10,                         // Máximo 10 jobs/segundo
  duration: 1000,
},
settings: {
  stalledInterval: 30000,         // Verificar jobs travados a cada 30s
  maxStalledCount: 1,             // Marcar como falho após 1 verificação
}
```

**Por quê**: 
- `concurrency: 1` evita sobrecarga
- Limiter previne picos de carga
- Stalled detection identifica jobs travados rapidamente

### 5. Tratamento de Erros Robusto

#### Métodos que não lançam exceções:

- `scheduleTaskExpiration()`: Retorna `boolean` (não lança exceção)
- `cancelTaskExpiration()`: Retorna `boolean` (não lança exceção)

**Por quê**: Se o BullMQ falhar, o sistema continua funcionando. A task é criada no banco mesmo se o agendamento falhar.

#### Timeouts de Segurança:

```typescript
await Promise.race([
  this.queue.add(...),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 10000)
  ),
]);
```

**Por quê**: Evita que operações fiquem travadas indefinidamente.

### 6. Logs Melhorados

- Erros de timeout são logados como `warning` (não `error`) para evitar spam
- Logs incluem contexto e hints para debugging
- Handlers de eventos do Redis logam reconexões

### 7. Handlers de Eventos Adicionais

```typescript
worker.on('stalled', ...)      // Detecta jobs travados
worker.on('error', ...)        // Erros gerais do worker
queueEvents.on('error', ...)   // Erros do QueueEvents
redisClient.on('reconnecting', ...) // Reconexões do Redis
```

**Por quê**: Visibilidade completa do estado do sistema para debugging.

## Prevenção de Problemas Futuros

### ✅ Checklist de Configuração

1. **Timeouts adequados**: Sempre use pelo menos 30s para conexões remotas
2. **maxRetriesPerRequest: null**: Obrigatório para BullMQ
3. **enableReadyCheck: false**: Para conexões remotas
4. **Tratamento de erros**: Métodos críticos devem retornar boolean, não lançar exceções
5. **Timeouts de segurança**: Use `Promise.race` para operações que podem travar

### ✅ Monitoramento

- Logs de timeout devem ser monitorados
- Se timeouts persistirem, verificar:
  - Latência de rede com Redis
  - Carga do Redis
  - Firewall/proxy bloqueando conexões

### ✅ Fallback

O sistema funciona mesmo se BullMQ falhar:
- Tasks são criadas no banco
- Expiração pode ser verificada manualmente se necessário
- Sistema não trava por falhas do BullMQ

## Testes Recomendados

1. **Teste de timeout**: Simular latência alta no Redis
2. **Teste de desconexão**: Desconectar Redis e verificar reconexão
3. **Teste de carga**: Múltiplas tasks simultâneas
4. **Teste de falha**: BullMQ indisponível - sistema deve continuar

## Referências

- [BullMQ Documentation](https://docs.bullmq.io/)
- [ioredis Configuration](https://github.com/redis/ioredis/blob/master/API.md#new-redisport-host-options)
- [Railway Redis](https://docs.railway.app/databases/redis)
