import express from 'express';
import cors from 'cors';
import { prisma } from './db/prisma';
import { redis } from './db/redis';
import { getPublisherChannel } from './db/rabbitmq';
import bookingRoutes from './routes/bookings';

const app = express();
const PORT = Number(process.env.PORT) || 3003;
const INSTANCE_ID = process.env.INSTANCE_ID || 'booking-service';

app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Instance-Id', INSTANCE_ID);
  next();
});

app.get('/api/bookings/health', (_req, res) => {
  res.json({ status: 'ok', service: 'booking-service', instance: INSTANCE_ID });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'booking-service', instance: INSTANCE_ID });
});

app.use('/api/bookings', bookingRoutes);
app.use('/bookings', bookingRoutes);

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    await redis.connect();
  } catch (err) {
    console.warn('[redis] connect deferred / already connected', err);
  }
  await getPublisherChannel();
  console.log('[rabbitmq] publisher ready (exchange booking_events)');

  app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start booking-service', err);
  process.exit(1);
});
