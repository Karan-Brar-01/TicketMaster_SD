import express, { Express } from 'express';
import cors from 'cors';
import {
  BookingConfirmedPublisher,
  createBookingRouter,
} from './routes/bookings';
import { EventCatalogReader } from './services/eventCatalog';

export interface AppDependencies {
  publishBookingConfirmed?: BookingConfirmedPublisher;
  getEventSeatConfig?: EventCatalogReader;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const instanceId = process.env.INSTANCE_ID || 'booking-service';

  app.use(cors());
  app.use(express.json());

  app.use((_req, res, next) => {
    res.setHeader('X-Instance-Id', instanceId);
    next();
  });

  app.get('/api/bookings/health', (_req, res) => {
    res.json({ status: 'ok', service: 'booking-service', instance: instanceId });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'booking-service', instance: instanceId });
  });

  const bookingRouter = createBookingRouter(
    dependencies.publishBookingConfirmed,
    dependencies.getEventSeatConfig
  );
  app.use('/api/bookings', bookingRouter);
  app.use('/bookings', bookingRouter);

  return app;
}
