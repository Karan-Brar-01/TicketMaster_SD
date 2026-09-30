import express from 'express';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { prisma } from './db/prisma';
import { redis } from './db/redis';
import eventRoutes from './routes/events';

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const INSTANCE_ID = process.env.INSTANCE_ID || 'event-service';

app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Instance-Id', INSTANCE_ID);
  next();
});

app.get('/api/events/health', (_req, res) => {
  res.json({ status: 'ok', service: 'event-service', instance: INSTANCE_ID });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'event-service', instance: INSTANCE_ID });
});

// Gateway: /api/events/* → this service
app.use('/api/events', eventRoutes);
// Direct short paths for local testing
app.use('/events', eventRoutes);

async function seedDemoEvents(): Promise<void> {
  const count = await prisma.event.count();
  if (count > 0) return;

  const demos = [
    {
      title: 'Neon Nights Live',
      description: 'An electronic music festival under the city skyline.',
      venue: 'Harbor Arena',
      total_seats: 120,
      available_seats: 120,
      price: new Prisma.Decimal('79.00'),
      date: new Date('2026-09-15T19:00:00Z'),
    },
    {
      title: 'Symphony at Dusk',
      description: 'Classical orchestra performing contemporary scores.',
      venue: 'Grand Opera House',
      total_seats: 80,
      available_seats: 80,
      price: new Prisma.Decimal('55.50'),
      date: new Date('2026-10-02T18:30:00Z'),
    },
    {
      title: 'Tech Summit Keynote',
      description: 'Industry leaders on scaling high-concurrency systems.',
      venue: 'Convention Center Hall B',
      total_seats: 200,
      available_seats: 200,
      price: new Prisma.Decimal('120.00'),
      date: new Date('2026-11-08T09:00:00Z'),
    },
  ];

  await prisma.event.createMany({ data: demos });
  console.log(`[seed] created ${demos.length} demo events`);
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    await redis.connect();
  } catch (err) {
    console.warn('[redis] connect deferred / already connected', err);
  }

  await seedDemoEvents();

  app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start event-service', err);
  process.exit(1);
});
