import express from 'express';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { prisma } from './db/prisma';
import { redis } from './db/redis';
import eventRoutes from './routes/events';
import { invalidateAllEventCaches } from './db/redis';

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
  const demos = [
    {
      title: 'Neon Nights Live',
      description: 'An electronic music festival under the city skyline.',
      venue: 'Harbor Arena',
      total_seats: 120,
      available_seats: 120,
      price: new Prisma.Decimal('600.00'),
      date: new Date('2026-11-15T19:00:00Z'),
    },
    {
      title: 'Symphony at Dusk',
      description: 'Classical orchestra performing contemporary scores.',
      venue: 'Grand Opera House',
      total_seats: 80,
      available_seats: 80,
      price: new Prisma.Decimal('500.00'),
      date: new Date('2026-10-12T18:30:00Z'),
    },
    {
      title: 'Tech Summit Keynote',
      description: 'Industry leaders on scaling high-concurrency systems.',
      venue: 'Convention Center Hall B',
      total_seats: 200,
      available_seats: 200,
      price: new Prisma.Decimal('900.00'),
      date: new Date('2026-11-08T09:00:00Z'),
    },
    {
      title: 'The Last Monsoon',
      description: 'An intimate contemporary stage production about home and memory.',
      venue: 'Prithvi Theatre',
      total_seats: 100,
      available_seats: 100,
      price: new Prisma.Decimal('400.00'),
      date: new Date('2026-10-25T14:30:00Z'),
    },
    {
      title: 'The Royal Comedy',
      description: 'A sharp ensemble comedy performed in a landmark Mumbai theatre.',
      venue: 'Royal Opera Theatre',
      total_seats: 120,
      available_seats: 120,
      price: new Prisma.Decimal('500.00'),
      date: new Date('2026-11-01T15:00:00Z'),
    },
  ];

  // Both event-service replicas start together. The advisory lock keeps their
  // seed/update work serialized without changing the event schema.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2026093002)`;
    for (const demo of demos) {
      const existing = await tx.event.findFirst({ where: { title: demo.title } });
      if (existing) {
        await tx.event.update({ where: { id: existing.id }, data: demo });
      } else {
        await tx.event.create({ data: demo });
      }
    }
  });

  await invalidateAllEventCaches();
  console.log(`[seed] synchronized ${demos.length} demo events`);
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
