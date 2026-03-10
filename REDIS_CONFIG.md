# Configuração do Redis para BullMQ

## Variáveis de Ambiente Necessárias

Adicione as seguintes variáveis ao seu arquivo `.env`:

```env
# Habilitar BullMQ
USE_BULLMQ=true

# Opção 1: URL Pública do Redis (Railway - Recomendado para produção)
REDIS_PUBLIC_URL=redis://default:xpfEDUlxXOoYGrMVGMNZIQdpxVxLoITc@switchback.proxy.rlwy.net:59668

# Opção 2: URL Interna do Redis (Railway - Para uso interno)
REDIS_URL=redis://default:xpfEDUlxXOoYGrMVGMNZIQdpxVxLoITc@redis.railway.internal:6379

# Opção 3: Configuração Separada (Fallback se URLs não estiverem disponíveis)
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=xpfEDUlxXOoYGrMVGMNZIQdpxVxLoITc
REDIS_USER=default
```

## Prioridade de Configuração

O sistema usa as variáveis na seguinte ordem de prioridade:

1. **REDIS_PUBLIC_URL** (mais alta) - URL pública do Redis
2. **REDIS_URL** - URL interna do Redis
3. **REDIS_HOST + REDIS_PORT + REDIS_PASSWORD** (fallback) - Configuração separada

## Como Funciona

- Se `REDIS_PUBLIC_URL` estiver definida, ela será usada
- Caso contrário, se `REDIS_URL` estiver definida, ela será usada
- Se nenhuma URL estiver definida, o sistema usa `REDIS_HOST`, `REDIS_PORT` e `REDIS_PASSWORD`

## Verificação

Após adicionar as variáveis, reinicie o backend. Você verá no log:

```
[Bootstrap] ✅ BullMQ ManagerVerificationQueue initialized
```

Se houver erro, verifique:
- Se o Redis está acessível
- Se as credenciais estão corretas
- Se a porta está aberta
