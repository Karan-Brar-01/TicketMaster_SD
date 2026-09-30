import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  CACHE_TTL_SECONDS,
  EVENTS_LIST_CACHE_KEY,
  eventCacheKey,
  invalidateEventCaches,
  redis,
} from '../db/redis';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';

const router = Router();

function serializeEvent(event: {
  id: string;
  title: string;
  description: string;
  venue: string;
  total_seats: number;
  available_seats: number;
  price: Prisma.Decimal;
  date: Date;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    total_seats: event.total_seats,
    available_seats: event.available_seats,
    price: Number(event.price),
    date: event.date.toISOString(),
    created_at: event.created_at.toISOString(),
    updated_at: event.updated_at.toISOString(),
  };
}

/** GET /events — read-through Redis cache (60s) */
router.get('/', async (_req, res: Response) => {
  try {
    const cached = await redis.get(EVENTS_LIST_CACHE_KEY);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(JSON.parse(cached));
      return;
    }

    const events = await prisma.event.findMany({
      orderBy: { date: 'asc' },
    });
    const payload = {
      events: events.map(serializeEvent),
      cached: false,
    };

    await redis.set(
      EVENTS_LIST_CACHE_KEY,
      JSON.stringify({ ...payload, cached: true }),
      'EX',
      CACHE_TTL_SECONDS
    );

    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  } catch (err) {
    console.error('[GET /events]', err);
    res.status(500).json({ error: 'failed to list events' });
  }
});

/** GET /events/:id — read-through Redis cache (60s) */
router.get('/:id', async (req, res: Response) => {
  try {
    const { id } = req.params;
    if (id === 'health') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const key = eventCacheKey(id);
    const cached = await redis.get(key);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(JSON.parse(cached));
      return;
    }

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      res.status(404).json({ error: 'event not found' });
      return;
    }

    const payload = { event: serializeEvent(event), cached: false };
    await redis.set(
      key,
      JSON.stringify({ ...payload, cached: true }),
      'EX',
      CACHE_TTL_SECONDS
    );

    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  } catch (err) {
    console.error('[GET /events/:id]', err);
    res.status(500).json({ error: 'failed to get event' });
  }
});

/** POST /events — admin only; invalidates list cache */
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      title,
      description,
      venue,
      total_seats,
      available_seats,
      price,
      date,
    } = req.body as {
      title?: string;
      description?: string;
      venue?: string;
      total_seats?: number;
      available_seats?: number;
      price?: number;
      date?: string;
    };

    if (
      !title?.trim() ||
      !description?.trim() ||
      !venue?.trim() ||
      total_seats == null ||
      price == null ||
      !date
    ) {
      res.status(400).json({
        error:
          'title, description, venue, total_seats, price, and date are required',
      });
      return;
    }

    if (total_seats < 1) {
      res.status(400).json({ error: 'total_seats must be >= 1' });
      return;
    }

    const seatsAvailable =
      available_seats != null ? available_seats : total_seats;
    if (seatsAvailable < 0 || seatsAvailable > total_seats) {
      res.status(400).json({
        error: 'available_seats must be between 0 and total_seats',
      });
      return;
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: 'invalid date' });
      return;
    }

    const event = await prisma.event.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        venue: venue.trim(),
        total_seats,
        available_seats: seatsAvailable,
        price: new Prisma.Decimal(price),
        date: parsedDate,
      },
    });

    await invalidateEventCaches(event.id);

    res.status(201).json({ event: serializeEvent(event) });
  } catch (err) {
    console.error('[POST /events]', err);
    res.status(500).json({ error: 'failed to create event' });
  }
});

export default router;
