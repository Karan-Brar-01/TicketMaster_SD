import express from 'express';
import cors from 'cors';
import { startConsumer } from './consumer';

const app = express();
const PORT = Number(process.env.PORT) || 3004;
const INSTANCE_ID = process.env.INSTANCE_ID || 'notification-service';

app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Instance-Id', INSTANCE_ID);
  next();
});

app.get('/api/notifications/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service', instance: INSTANCE_ID });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service', instance: INSTANCE_ID });
});

async function main(): Promise<void> {
  // Retry RabbitMQ connect (broker may still be starting)
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await startConsumer();
      break;
    } catch (err) {
      console.warn(`[consumer] connect attempt ${attempt}/${maxAttempts} failed`, err);
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start notification-service', err);
  process.exit(1);
});
