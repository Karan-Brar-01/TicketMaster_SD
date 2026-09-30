import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  acquireSeatHold,
  getSeatHoldToken,
  releaseSeatHold,
  SEAT_HOLD_TTL_SECONDS,
  seatLockKey,
  redis,
} from '../db/redis';
import { publishBookingConfirmed } from '../db/rabbitmq';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

interface BookingRow {
  id: string;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

function serializeBooking(b: {
  id: string;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: BookingStatus;
  created_at: Date;
}) {
  return {
    id: b.id,
    user_id: b.user_id,
    event_id: b.event_id,
    seat_number: b.seat_number,
    status: b.status,
    created_at: b.created_at.toISOString(),
  };
}

/**
 * POST /bookings/reserve
 * Redis SET seat:{event_id}:{seat_no} token NX EX 600
 */
router.post('/reserve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event_id, seat_number } = req.body as {
      event_id?: string;
      seat_number?: number;
    };

    if (!event_id?.trim() || seat_number == null || !Number.isInteger(seat_number)) {
      res.status(400).json({ error: 'event_id and integer seat_number are required' });
      return;
    }

    if (seat_number < 1) {
      res.status(400).json({ error: 'seat_number must be >= 1' });
      return;
    }

    const userId = req.user!.sub;

    const alreadyConfirmed = await prisma.booking.findFirst({
      where: {
        event_id: event_id.trim(),
        seat_number,
        status: BookingStatus.confirmed,
      },
    });
    if (alreadyConfirmed) {
      res.status(409).json({ error: 'seat already booked' });
      return;
    }

    const holdToken = randomUUID();
    const acquired = await acquireSeatHold(event_id.trim(), seat_number, holdToken);
    if (!acquired) {
      res.status(409).json({
        error: 'seat is currently held by another user',
        hold_ttl_seconds: SEAT_HOLD_TTL_SECONDS,
      });
      return;
    }

    try {
      // Expire any stale held rows for this seat (Redis expired / abandoned)
      await prisma.booking.updateMany({
        where: {
          event_id: event_id.trim(),
          seat_number,
          status: BookingStatus.held,
        },
        data: { status: BookingStatus.expired },
      });

      const booking = await prisma.booking.create({
        data: {
          user_id: userId,
          event_id: event_id.trim(),
          seat_number,
          status: BookingStatus.held,
        },
      });

      res.status(201).json({
        booking: serializeBooking(booking),
        hold_token: holdToken,
        hold_ttl_seconds: SEAT_HOLD_TTL_SECONDS,
        message: 'Seat held for 10 minutes. Confirm before the hold expires.',
      });
    } catch (err) {
      await releaseSeatHold(event_id.trim(), seat_number, holdToken);
      throw err;
    }
  } catch (err) {
    console.error('[POST /bookings/reserve]', err);
    res.status(500).json({ error: 'failed to reserve seat' });
  }
});

/**
 * POST /bookings/confirm
 * Verifies Redis hold token, then SELECT ... FOR UPDATE to prevent double-booking.
 * Publishes booking.confirmed to exchange booking_events.
 */
router.post('/confirm', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { booking_id, hold_token } = req.body as {
      booking_id?: string;
      hold_token?: string;
    };

    if (!booking_id?.trim() || !hold_token?.trim()) {
      res.status(400).json({ error: 'booking_id and hold_token are required' });
      return;
    }

    const userId = req.user!.sub;

    const booking = await prisma.booking.findUnique({
      where: { id: booking_id.trim() },
    });
    if (!booking) {
      res.status(404).json({ error: 'booking not found' });
      return;
    }
    if (booking.user_id !== userId) {
      res.status(403).json({ error: 'not your booking' });
      return;
    }
    if (booking.status === BookingStatus.confirmed) {
      res.json({ booking: serializeBooking(booking), message: 'already confirmed' });
      return;
    }
    if (booking.status !== BookingStatus.held) {
      res.status(409).json({ error: `booking status is ${booking.status}` });
      return;
    }

    const currentToken = await getSeatHoldToken(booking.event_id, booking.seat_number);
    if (!currentToken || currentToken !== hold_token.trim()) {
      res.status(409).json({
        error: 'seat hold expired or token mismatch — reserve again',
      });
      return;
    }

    // Checkout under row-level lock: no concurrent confirm for this seat
    const confirmed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<BookingRow[]>`
        SELECT id, user_id, event_id, seat_number, status, created_at, updated_at
        FROM bookings
        WHERE event_id = ${booking.event_id}
          AND seat_number = ${booking.seat_number}
          AND status IN ('held', 'confirmed')
        FOR UPDATE
      `;

      const existingConfirmed = locked.find((r) => r.status === BookingStatus.confirmed);
      if (existingConfirmed) {
        throw Object.assign(new Error('seat already booked'), { code: 'SEAT_TAKEN' });
      }

      const heldRow = locked.find(
        (r) => r.id === booking.id && r.status === BookingStatus.held
      );
      if (!heldRow) {
        throw Object.assign(new Error('held booking missing'), { code: 'HOLD_GONE' });
      }

      return tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.confirmed },
      });
    });

    await releaseSeatHold(booking.event_id, booking.seat_number, hold_token.trim());

    await publishBookingConfirmed({
      booking_id: confirmed.id,
      user_id: confirmed.user_id,
      event_id: confirmed.event_id,
      seat_number: confirmed.seat_number,
      status: confirmed.status,
      confirmed_at: new Date().toISOString(),
    });

    res.json({
      booking: serializeBooking(confirmed),
      payment: { status: 'simulated_success', amount_charged: 'simulated' },
      message: 'Booking confirmed. Notification queued.',
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: string }).code;
      if (code === 'SEAT_TAKEN') {
        res.status(409).json({ error: 'seat already booked' });
        return;
      }
      if (code === 'HOLD_GONE') {
        res.status(409).json({ error: 'hold no longer valid' });
        return;
      }
    }
    console.error('[POST /bookings/confirm]', err);
    res.status(500).json({ error: 'failed to confirm booking' });
  }
});

router.get('/mine', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { user_id: req.user!.sub },
      orderBy: { created_at: 'desc' },
    });
    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (err) {
    console.error('[GET /bookings/mine]', err);
    res.status(500).json({ error: 'failed to list bookings' });
  }
});

/**
 * GET /bookings/events/:eventId/seats?total=N
 * Live seat map: available | held | booked
 */
router.get('/events/:eventId/seats', async (req, res: Response) => {
  try {
    const eventId = req.params.eventId;
    const total = Number(req.query.total);
    if (!eventId || !Number.isInteger(total) || total < 1 || total > 2000) {
      res.status(400).json({ error: 'eventId and total (1–2000) are required' });
      return;
    }

    const confirmed = await prisma.booking.findMany({
      where: { event_id: eventId, status: BookingStatus.confirmed },
      select: { seat_number: true, user_id: true },
    });
    const confirmedMap = new Map(confirmed.map((b) => [b.seat_number, b.user_id]));

    const keys = Array.from({ length: total }, (_, i) =>
      seatLockKey(eventId, i + 1)
    );
    const holdTokens = keys.length > 0 ? await redis.mget(...keys) : [];

    let userId: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ') && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET) as {
          sub: string;
        };
        userId = decoded.sub;
      } catch {
        /* optional auth */
      }
    }

    const heldBookings = userId
      ? await prisma.booking.findMany({
          where: {
            event_id: eventId,
            user_id: userId,
            status: BookingStatus.held,
          },
          select: { seat_number: true, id: true },
        })
      : [];
    const myHeldSeats = new Map(heldBookings.map((b) => [b.seat_number, b.id]));

    const seats = Array.from({ length: total }, (_, i) => {
      const seat_number = i + 1;
      if (confirmedMap.has(seat_number)) {
        return {
          seat_number,
          status: 'booked' as const,
          mine: userId != null && confirmedMap.get(seat_number) === userId,
        };
      }
      if (holdTokens[i]) {
        return {
          seat_number,
          status: 'held' as const,
          mine: myHeldSeats.has(seat_number),
          booking_id: myHeldSeats.get(seat_number),
        };
      }
      return { seat_number, status: 'available' as const, mine: false };
    });

    res.json({ event_id: eventId, total, seats });
  } catch (err) {
    console.error('[GET /bookings/events/:eventId/seats]', err);
    res.status(500).json({ error: 'failed to load seats' });
  }
});

export default router;
