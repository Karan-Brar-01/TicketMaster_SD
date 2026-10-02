import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { BookingStatus, Prisma, type Booking } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  acquireSeatHolds,
  releaseSeatHolds,
  ownsSeatHolds,
  SEAT_HOLD_TTL_SECONDS,
  seatLockKey,
  redis,
} from '../db/redis';
import {
  publishBookingConfirmed,
  BookingConfirmedMessage,
} from '../db/rabbitmq';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import {
  EventCatalogError,
  EventCatalogReader,
  EventSeatConfig,
  getEventSeatConfig,
} from '../services/eventCatalog';

interface BookingRow {
  id: string;
  reservation_id: string | null;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: BookingStatus;
  created_at: Date;
  updated_at: Date;
}

function serializeBooking(b: {
  id: string;
  reservation_id?: string | null;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: BookingStatus;
  created_at: Date;
}) {
  return {
    id: b.id,
    reservation_id: b.reservation_id ?? null,
    user_id: b.user_id,
    event_id: b.event_id,
    seat_number: b.seat_number,
    status: b.status,
    created_at: b.created_at.toISOString(),
  };
}

type SerializableBooking = Parameters<typeof serializeBooking>[0];

function serializeReservation(bookings: SerializableBooking[]) {
  const first = bookings[0];
  return {
    id: first.reservation_id ?? first.id,
    user_id: first.user_id,
    event_id: first.event_id,
    status: first.status,
    booking_ids: bookings.map((booking) => booking.id),
    seat_numbers: bookings.map((booking) => booking.seat_number),
  };
}

function confirmationResponse(bookings: SerializableBooking[], message: string) {
  const serializedBookings = bookings.map(serializeBooking);
  const response: Record<string, unknown> = {
    reservation: serializeReservation(bookings),
    bookings: serializedBookings,
    payment: { status: 'simulated_success', amount_charged: 'simulated' },
    message,
  };
  if (serializedBookings.length === 1) {
    response.booking = serializedBookings[0];
  }
  return response;
}

export type BookingConfirmedPublisher = (
  message: BookingConfirmedMessage
) => Promise<void>;

export interface HeldBookingGroupInput {
  reservationId: string;
  userId: string;
  eventId: string;
  seatNumbers: number[];
}

export type HeldBookingGroupCreator = (
  input: HeldBookingGroupInput
) => Promise<Booking[]>;

export const createHeldBookingGroup: HeldBookingGroupCreator = async ({
  reservationId,
  userId,
  eventId,
  seatNumbers,
}) =>
  prisma.$transaction(async (tx) => {
    // Redis ownership proves any existing held rows are abandoned/stale.
    await tx.booking.updateMany({
      where: {
        event_id: eventId,
        seat_number: { in: seatNumbers },
        status: BookingStatus.held,
      },
      data: { status: BookingStatus.expired },
    });

    return Promise.all(
      seatNumbers.map((seatNumber) =>
        tx.booking.create({
          data: {
            reservation_id: reservationId,
            user_id: userId,
            event_id: eventId,
            seat_number: seatNumber,
            status: BookingStatus.held,
          },
        })
      )
    );
  });

export function createBookingRouter(
  publishConfirmed: BookingConfirmedPublisher = publishBookingConfirmed,
  readEvent: EventCatalogReader = getEventSeatConfig,
  createHeldGroup: HeldBookingGroupCreator = createHeldBookingGroup
): Router {
  const router = Router();

/**
 * POST /bookings/reserve
 * Accepts the legacy seat_number or a seat_numbers group. Redis evaluates the
 * whole group in one Lua invocation, then PostgreSQL creates all rows in one
 * transaction.
 */
router.post('/reserve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event_id, seat_number, seat_numbers } = req.body as {
      event_id?: string;
      seat_number?: number;
      seat_numbers?: number[];
    };

    const hasSingleSeat = seat_number != null;
    const hasSeatGroup = seat_numbers != null;
    if (!event_id?.trim() || hasSingleSeat === hasSeatGroup) {
      res.status(400).json({
        error: 'event_id and exactly one of seat_number or seat_numbers are required',
      });
      return;
    }

    const requestedSeats = hasSeatGroup ? seat_numbers : [seat_number];
    if (
      !Array.isArray(requestedSeats) ||
      requestedSeats.length === 0 ||
      requestedSeats.some((seat) => !Number.isInteger(seat))
    ) {
      res.status(400).json({ error: 'seat numbers must be a non-empty list of integers' });
      return;
    }

    const normalizedSeats = [...requestedSeats].sort((a, b) => a! - b!) as number[];
    if (new Set(normalizedSeats).size !== normalizedSeats.length) {
      res.status(400).json({ error: 'duplicate seat numbers are not allowed' });
      return;
    }
    if (normalizedSeats.some((seat) => seat < 1)) {
      res.status(400).json({ error: 'seat numbers must be >= 1' });
      return;
    }

    const eventId = event_id.trim();
    const event = await readEvent(eventId);
    const outOfRange = normalizedSeats.find((seat) => seat > event.total_seats);
    if (outOfRange != null) {
      res.status(400).json({
        error: `seat ${outOfRange} is outside this theatre`,
      });
      return;
    }

    const seats = normalizedSeats.map((seat) => describeSeat(event, seat));
    const blockedSeat = seats.find((seat) => seat.status === 'blocked');
    if (blockedSeat) {
      res.status(409).json({
        error: 'seat row is unavailable',
        seat_number: blockedSeat.seat_number,
      });
      return;
    }

    const alreadyConfirmed = await prisma.booking.findFirst({
      where: {
        event_id: eventId,
        seat_number: { in: normalizedSeats },
        status: BookingStatus.confirmed,
      },
      select: { seat_number: true },
    });
    if (alreadyConfirmed) {
      res.status(409).json({
        error: 'one or more seats are already booked',
        unavailable_seat_number: alreadyConfirmed.seat_number,
      });
      return;
    }

    const userId = req.user!.sub;
    const reservationId = randomUUID();
    const holdToken = randomUUID();
    const acquired = await acquireSeatHolds(eventId, normalizedSeats, holdToken);
    if (!acquired) {
      res.status(409).json({
        error: 'one or more seats are currently held by another user',
        hold_ttl_seconds: SEAT_HOLD_TTL_SECONDS,
      });
      return;
    }

    try {
      const bookings = await createHeldGroup({
        reservationId,
        userId,
        eventId,
        seatNumbers: normalizedSeats,
      });

      const serializedBookings = bookings.map(serializeBooking);
      const seatResponses = seats.map((seat) => ({
        ...seat,
        booking_id: bookings.find((booking) => booking.seat_number === seat.seat_number)!.id,
      }));
      const response: Record<string, unknown> = {
        reservation: {
          ...serializeReservation(bookings),
          seats: seatResponses,
          total_price: seats.reduce((sum, seat) => sum + seat.price, 0),
          currency: event.currency,
        },
        bookings: serializedBookings,
        seats: seatResponses,
        hold_token: holdToken,
        hold_ttl_seconds: SEAT_HOLD_TTL_SECONDS,
        message: `${normalizedSeats.length === 1 ? 'Seat' : 'Seats'} held for ${SEAT_HOLD_TTL_SECONDS} seconds. Confirm before the hold expires.`,
      };

      // Preserve the original single-seat response fields for existing clients.
      if (bookings.length === 1) {
        response.booking = serializedBookings[0];
        response.seat = seatResponses[0];
      }

      res.status(201).json(response);
    } catch (err) {
      try {
        await releaseSeatHolds(eventId, normalizedSeats, holdToken);
      } catch (releaseError) {
        console.error('[POST /bookings/reserve] failed to compensate Redis holds', releaseError);
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof EventCatalogError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[POST /bookings/reserve]', err);
    res.status(500).json({ error: 'failed to reserve seats' });
  }
});

/**
 * POST /bookings/confirm
 * Confirms one legacy booking or every booking in a reservation group as one
 * PostgreSQL transaction. Publishes one booking.confirmed event per seat.
 */
router.post('/confirm', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { booking_id, reservation_id, hold_token } = req.body as {
      booking_id?: string;
      reservation_id?: string;
      hold_token?: string;
    };

    const hasBookingId = Boolean(booking_id?.trim());
    const hasReservationId = Boolean(reservation_id?.trim());
    if (hasBookingId === hasReservationId || !hold_token?.trim()) {
      res.status(400).json({
        error: 'hold_token and exactly one of booking_id or reservation_id are required',
      });
      return;
    }

    const userId = req.user!.sub;

    let bookings;
    if (hasReservationId) {
      bookings = await prisma.booking.findMany({
        where: { reservation_id: reservation_id!.trim() },
        orderBy: { seat_number: 'asc' },
      });
    } else {
      const booking = await prisma.booking.findUnique({
        where: { id: booking_id!.trim() },
      });
      if (!booking) {
        res.status(404).json({ error: 'booking not found' });
        return;
      }
      bookings = booking.reservation_id
        ? await prisma.booking.findMany({
            where: { reservation_id: booking.reservation_id },
            orderBy: { seat_number: 'asc' },
          })
        : [booking];
    }

    if (bookings.length === 0) {
      res.status(404).json({ error: 'reservation not found' });
      return;
    }
    if (bookings.some((booking) => booking.user_id !== userId)) {
      res.status(403).json({ error: 'not your booking' });
      return;
    }

    const allConfirmed = bookings.every(
      (booking) => booking.status === BookingStatus.confirmed
    );
    if (allConfirmed) {
      res.json(confirmationResponse(bookings, 'already confirmed'));
      return;
    }
    if (bookings.some((booking) => booking.status !== BookingStatus.held)) {
      res.status(409).json({
        error: 'reservation is not entirely held and cannot be partially confirmed',
      });
      return;
    }

    const eventIds = new Set(bookings.map((booking) => booking.event_id));
    if (eventIds.size !== 1) {
      res.status(409).json({ error: 'reservation contains inconsistent events' });
      return;
    }
    const eventId = bookings[0].event_id;
    const seatNumbers = bookings.map((booking) => booking.seat_number);
    const token = hold_token.trim();
    if (!(await ownsSeatHolds(eventId, seatNumbers, token))) {
      res.status(409).json({
        error: 'one or more seat holds expired or the token does not own the complete group',
      });
      return;
    }

    const bookingIds = bookings.map((booking) => booking.id);
    const confirmed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<BookingRow[]>`
        SELECT id, reservation_id, user_id, event_id, seat_number, status, created_at, updated_at
        FROM bookings
        WHERE event_id = ${eventId}
          AND seat_number IN (${Prisma.join(seatNumbers)})
          AND status IN ('held', 'confirmed')
        ORDER BY seat_number
        FOR UPDATE
      `;

      const groupIds = new Set(bookingIds);
      const existingConfirmed = locked.find(
        (row) => row.status === BookingStatus.confirmed && !groupIds.has(row.id)
      );
      if (existingConfirmed) {
        throw Object.assign(new Error('seat already booked'), { code: 'SEAT_TAKEN' });
      }

      const heldGroupRows = locked.filter(
        (row) => groupIds.has(row.id) && row.status === BookingStatus.held
      );
      if (heldGroupRows.length !== bookingIds.length) {
        throw Object.assign(new Error('held booking missing'), { code: 'HOLD_GONE' });
      }

      const updated = await tx.booking.updateMany({
        where: { id: { in: bookingIds }, status: BookingStatus.held },
        data: { status: BookingStatus.confirmed },
      });
      if (updated.count !== bookingIds.length) {
        throw Object.assign(new Error('held booking changed'), { code: 'HOLD_GONE' });
      }

      return tx.booking.findMany({
        where: { id: { in: bookingIds } },
        orderBy: { seat_number: 'asc' },
      });
    });

    await releaseSeatHolds(eventId, seatNumbers, token);

    const confirmedAt = new Date().toISOString();
    await Promise.all(
      confirmed.map((booking) =>
        publishConfirmed({
          booking_id: booking.id,
          user_id: booking.user_id,
          event_id: booking.event_id,
          seat_number: booking.seat_number,
          status: booking.status,
          confirmed_at: confirmedAt,
        })
      )
    );

    res.json(
      confirmationResponse(
        confirmed,
        `${confirmed.length === 1 ? 'Booking' : 'Reservation'} confirmed. Notification${confirmed.length === 1 ? '' : 's'} queued.`
      )
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.status(409).json({ error: 'seat already booked' });
      return;
    }
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
 * GET /bookings/events/:eventId/seats
 * Live seat map: available | held | booked | blocked, with server-owned pricing.
 */
router.get('/events/:eventId/seats', async (req, res: Response) => {
  try {
    const eventId = req.params.eventId;
    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return;
    }
    const event = await readEvent(eventId);
    const total = event.total_seats;

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
      const details = describeSeat(event, seat_number);
      if (details.status === 'blocked') return details;
      if (confirmedMap.has(seat_number)) {
        return {
          ...details,
          seat_number,
          status: 'booked' as const,
          mine: userId != null && confirmedMap.get(seat_number) === userId,
        };
      }
      if (holdTokens[i]) {
        return {
          ...details,
          seat_number,
          status: 'held' as const,
          mine: myHeldSeats.has(seat_number),
          booking_id: myHeldSeats.get(seat_number),
        };
      }
      return { ...details, status: 'available' as const, mine: false };
    });

    res.json({
      event_id: eventId,
      total,
      currency: event.currency,
      seat_layout: event.seat_layout,
      seats,
    });
  } catch (err) {
    if (err instanceof EventCatalogError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[GET /bookings/events/:eventId/seats]', err);
    res.status(500).json({ error: 'failed to load seats' });
  }
});

  return router;
}

function describeSeat(event: EventSeatConfig, seatNumber: number) {
  const rowNumber = Math.floor((seatNumber - 1) / event.seat_layout.columns) + 1;
  const seatInRow = ((seatNumber - 1) % event.seat_layout.columns) + 1;
  const vip = event.seat_layout.vip_rows.includes(rowNumber);
  const blocked = event.seat_layout.blocked_rows.includes(rowNumber);
  return {
    seat_number: seatNumber,
    row_number: rowNumber,
    row_label: String.fromCharCode(64 + rowNumber),
    seat_in_row: seatInRow,
    seat_type: vip ? ('vip' as const) : ('standard' as const),
    price: vip ? event.vip_price : event.price,
    currency: event.currency,
    status: blocked ? ('blocked' as const) : ('available' as const),
  };
}

export default createBookingRouter();
