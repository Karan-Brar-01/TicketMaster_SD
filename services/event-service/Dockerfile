FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://ticketmaster:ticketmaster@localhost:5432/events_db"
RUN npm install && npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

ENV PORT=3002
EXPOSE 3002

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
