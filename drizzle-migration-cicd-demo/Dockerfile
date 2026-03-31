FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

RUN npm run build
RUN npm run db:build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000

# App container only starts the server.
# Migrations should be executed separately in CI/CD:
# docker run --rm --env-file .env <image> node dist/migrate.js
CMD ["node", "dist/src/server.js"]
