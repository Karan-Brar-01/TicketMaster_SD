import { prisma } from './db/prisma';
import { redis } from './db/redis';
import { getPublisherChannel } from './db/rabbitmq';
import { createApp } from './app';

const PORT = Number(process.env.PORT) || 3003;
const INSTANCE_ID = process.env.INSTANCE_ID || 'booking-service';
const app = createApp();

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
