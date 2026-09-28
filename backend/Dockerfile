FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY server.js invoices.js order-emails.js ./
COPY migrations ./migrations

EXPOSE 9000

CMD ["node", "server.js"]
