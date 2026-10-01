FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://ticketmaster:ticketmaster@localhost:5432/events_db"
RUN --mount=type=cache,target=/root/.npm npm ci && npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV PORT=3002
EXPOSE 3002

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
