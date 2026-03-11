FROM node:20-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json package-lock.json* ./

# Instalar todas as dependências (incluindo devDependencies para ter tsx)
RUN npm ci

# Copiar código fonte
COPY . .

EXPOSE 3000

# Rodar com tsx diretamente (sem build)
CMD ["npm", "run", "start"]
