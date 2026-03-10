# Hiperselect Backend

AI-driven customer support platform - Backend service.

## Architecture

Event-driven architecture with clear separation of concerns:
- **whatsapp/**: WhatsApp adapter (infrastructure only)
- **ai/**: AI decision engine (analyzer, decision, responder)
- **tickets/**: Ticket lifecycle management
- **conversations/**: Conversation state tracking
- **company/**: Company context management
- **events/**: Event bus for cross-module communication
- **api/**: Fastify HTTP layer (thin, deterministic)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Docker

```bash
docker build -t hiperselect-backend .
docker run -p 3000:3000 hiperselect-backend
```

