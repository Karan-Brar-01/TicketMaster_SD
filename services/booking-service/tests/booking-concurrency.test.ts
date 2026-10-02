import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingStatus } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import {
  getSeatHoldToken,
  redis,
  releaseSeatHold,
  seatLockKey,
} from '../src/db/redis';
import type { EventCatalogReader } from '../src/services/eventCatalog';

const jwtSecret = process.env.JWT_SECRET!;

function auth(userId: string): string {
  return `Bearer ${jwt.sign(
    { sub: userId, email: `${userId}@example.test`, role: 'user' },
    jwtSecret
  )}`;
}

describe('booking concurrency and ownership invariants', () => {
  const publish = vi.fn(async () => undefined);
  const getEventSeatConfig: EventCatalogReader = vi.fn(async (eventId) => ({
    id: eventId,
    total_seats: 100,
    price: 500,
    vip_price: 1000,
    currency: 'INR',
    seat_layout: {
      name: 'Test Theatre',
      columns: 10,
      vip_rows: [1, 2],
      blocked_rows: [6],
      aisle_after_columns: [5],
    },
  }));
  const app = createApp({
    publishBookingConfirmed: publish,
    getEventSeatConfig,
  });

  beforeEach(async () => {
    publish.mockClear();
    await prisma.booking.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('rejects an invalid seat number', async () => {
    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('user-1'))
      .send({ event_id: 'E1', seat_number: 0 });

    expect(response.status).toBe(400);
  });

  it('rejects reservations in the theatre blocked row', async () => {
    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('user-1'))
      .send({ event_id: 'E1', seat_number: 51 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('seat row is unavailable');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('returns backend-owned row, tier, price, and blocked-seat metadata', async () => {
    const response = await request(app).get('/api/bookings/events/E1/seats');

    expect(response.status).toBe(200);
    expect(response.body.currency).toBe('INR');
    expect(response.body.seats[0]).toMatchObject({
      row_label: 'A',
      seat_type: 'vip',
      price: 1000,
      status: 'available',
    });
    expect(response.body.seats[50]).toMatchObject({
      row_label: 'F',
      status: 'blocked',
    });
  });

  it('atomically reserves three available seats with backend-owned pricing', async () => {
    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });

    expect(response.status).toBe(201);
    expect(response.body.reservation).toMatchObject({
      event_id: 'E1',
      status: 'held',
      seat_numbers: [42, 43, 44],
      total_price: 1500,
      currency: 'INR',
    });
    expect(response.body.bookings).toHaveLength(3);
    expect(response.body.seats.map((seat: { price: number }) => seat.price)).toEqual([
      500, 500, 500,
    ]);

    const tokens = await redis.mget(
      seatLockKey('E1', 42),
      seatLockKey('E1', 43),
      seatLockKey('E1', 44)
    );
    expect(tokens).toEqual([
      response.body.hold_token,
      response.body.hold_token,
      response.body.hold_token,
    ]);
    expect(
      await prisma.booking.count({
        where: {
          reservation_id: response.body.reservation.id,
          status: BookingStatus.held,
        },
      })
    ).toBe(3);
  });

  it('rejects a duplicate seat inside one group', async () => {
    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 42, 43] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('duplicate seat numbers are not allowed');
    expect(await prisma.booking.count()).toBe(0);
    expect(await redis.dbsize()).toBe(0);
  });

  it('rejects blocked and out-of-range seats before acquiring any group lock', async () => {
    const blocked = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 51, 43] });
    const outOfRange = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 101, 43] });

    expect(blocked.status).toBe(409);
    expect(blocked.body.seat_number).toBe(51);
    expect(outOfRange.status).toBe(400);
    expect(await prisma.booking.count()).toBe(0);
    expect(await redis.dbsize()).toBe(0);
  });

  it('leaves no partial locks or held rows when one requested seat is unavailable', async () => {
    await redis.set(seatLockKey('E1', 43), 'existing-owner', 'EX', 60);

    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });

    expect(response.status).toBe(409);
    expect(await getSeatHoldToken('E1', 42)).toBeNull();
    expect(await getSeatHoldToken('E1', 43)).toBe('existing-owner');
    expect(await getSeatHoldToken('E1', 44)).toBeNull();
    expect(await prisma.booking.count({ where: { status: BookingStatus.held } })).toBe(0);
  });

  it('rejects an entire group when one seat is already confirmed', async () => {
    await prisma.booking.create({
      data: {
        user_id: 'first-owner',
        event_id: 'E1',
        seat_number: 43,
        status: BookingStatus.confirmed,
      },
    });

    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });

    expect(response.status).toBe(409);
    expect(response.body.unavailable_seat_number).toBe(43);
    expect(
      await redis.mget(
        seatLockKey('E1', 42),
        seatLockKey('E1', 43),
        seatLockKey('E1', 44)
      )
    ).toEqual([null, null, null]);
    expect(await prisma.booking.count({ where: { status: BookingStatus.held } })).toBe(0);
  });

  it('allows exactly one winner for overlapping concurrent seat groups', async () => {
    const groups = [
      { user: 'group-a', seats: [42, 43, 44] },
      { user: 'group-b', seats: [44, 45, 46] },
    ];
    const responses = await Promise.all(
      groups.map((group) =>
        request(app)
          .post('/api/bookings/reserve')
          .set('Authorization', auth(group.user))
          .send({ event_id: 'E1', seat_numbers: group.seats })
      )
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = responses[winnerIndex];
    const winnerSeats = groups[winnerIndex].seats;
    const losingOnlySeats = groups[loserIndex].seats.filter(
      (seat) => !winnerSeats.includes(seat)
    );

    expect(
      await redis.mget(...winnerSeats.map((seat) => seatLockKey('E1', seat)))
    ).toEqual(winnerSeats.map(() => winner.body.hold_token));
    expect(
      await redis.mget(...losingOnlySeats.map((seat) => seatLockKey('E1', seat)))
    ).toEqual(losingOnlySeats.map(() => null));
    expect(await prisma.booking.count({ where: { status: BookingStatus.held } })).toBe(3);
  });

  it('releases every newly acquired lock when the database transaction fails', async () => {
    const failingApp = createApp({
      publishBookingConfirmed: publish,
      getEventSeatConfig,
      createHeldBookingGroup: ({ reservationId, userId, eventId, seatNumbers }) =>
        prisma.$transaction(async (tx) => {
          await tx.booking.create({
            data: {
              reservation_id: reservationId,
              user_id: userId,
              event_id: eventId,
              seat_number: seatNumbers[0],
              status: BookingStatus.held,
            },
          });
          throw new Error('forced database failure after first insert');
        }),
    });

    const response = await request(failingApp)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });

    expect(response.status).toBe(500);
    expect(
      await redis.mget(
        seatLockKey('E1', 42),
        seatLockKey('E1', 43),
        seatLockKey('E1', 44)
      )
    ).toEqual([null, null, null]);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('allows exactly one of 20 users to hold the same seat', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app)
          .post('/api/bookings/reserve')
          .set('Authorization', auth(`user-${index}`))
          .send({ event_id: 'E1', seat_number: 42 })
      )
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(19);
    expect(
      await prisma.booking.count({
        where: { event_id: 'E1', seat_number: 42, status: BookingStatus.held },
      })
    ).toBe(1);
  });

  it('allows concurrent holds for different seats', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app)
          .post('/api/bookings/reserve')
          .set('Authorization', auth(`user-${index}`))
          .send({ event_id: 'E1', seat_number: index + 1 })
      )
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
  });

  it('rejects a wrong hold token without releasing the real owner lock', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('owner'))
      .send({ event_id: 'E1', seat_number: 42 });

    const response = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('owner'))
      .send({ booking_id: reservation.body.booking.id, hold_token: 'wrong-token' });

    expect(response.status).toBe(409);
    expect(await getSeatHoldToken('E1', 42)).toBe(reservation.body.hold_token);
  });

  it('rejects confirmation after the Redis hold expires', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('owner'))
      .send({ event_id: 'E1', seat_number: 42 });
    await redis.del(seatLockKey('E1', 42));

    const response = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('owner'))
      .send({
        booking_id: reservation.body.booking.id,
        hold_token: reservation.body.hold_token,
      });

    expect(response.status).toBe(409);
  });

  it('prevents another user from confirming the owner booking', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('owner'))
      .send({ event_id: 'E1', seat_number: 42 });

    const response = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('intruder'))
      .send({
        booking_id: reservation.body.booking.id,
        hold_token: reservation.body.hold_token,
      });

    expect(response.status).toBe(403);
  });

  it('confirms once, publishes once, and releases the Redis hold', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('owner'))
      .send({ event_id: 'E1', seat_number: 42 });

    const response = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('owner'))
      .send({
        booking_id: reservation.body.booking.id,
        hold_token: reservation.body.hold_token,
      });

    expect(response.status).toBe(200);
    expect(response.body.booking.status).toBe('confirmed');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await getSeatHoldToken('E1', 42)).toBeNull();
  });

  it('makes a repeated confirmation idempotent', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('owner'))
      .send({ event_id: 'E1', seat_number: 42 });
    const payload = {
      booking_id: reservation.body.booking.id,
      hold_token: reservation.body.hold_token,
    };

    const first = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('owner'))
      .send(payload);
    const second = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('owner'))
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('already confirmed');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('confirms every seat in a reservation group in one operation', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });

    const response = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('group-owner'))
      .send({
        reservation_id: reservation.body.reservation.id,
        hold_token: reservation.body.hold_token,
      });

    expect(response.status).toBe(200);
    expect(response.body.reservation).toMatchObject({
      id: reservation.body.reservation.id,
      status: 'confirmed',
      seat_numbers: [42, 43, 44],
    });
    expect(response.body.bookings).toHaveLength(3);
    expect(response.body.bookings.every((booking: { status: string }) => booking.status === 'confirmed')).toBe(true);
    expect(
      await prisma.booking.count({
        where: {
          reservation_id: reservation.body.reservation.id,
          status: BookingStatus.confirmed,
        },
      })
    ).toBe(3);
    expect(
      await redis.mget(
        seatLockKey('E1', 42),
        seatLockKey('E1', 43),
        seatLockKey('E1', 44)
      )
    ).toEqual([null, null, null]);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('makes repeated group confirmation idempotent', async () => {
    const reservation = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('group-owner'))
      .send({ event_id: 'E1', seat_numbers: [42, 43, 44] });
    const payload = {
      reservation_id: reservation.body.reservation.id,
      hold_token: reservation.body.hold_token,
    };

    const first = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('group-owner'))
      .send(payload);
    const second = await request(app)
      .post('/api/bookings/confirm')
      .set('Authorization', auth('group-owner'))
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('already confirmed');
    expect(second.body.bookings).toHaveLength(3);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('rejects a new hold for an already-confirmed seat', async () => {
    await prisma.booking.create({
      data: {
        user_id: 'first-owner',
        event_id: 'E1',
        seat_number: 42,
        status: BookingStatus.confirmed,
      },
    });

    const response = await request(app)
      .post('/api/bookings/reserve')
      .set('Authorization', auth('second-owner'))
      .send({ event_id: 'E1', seat_number: 42 });

    expect(response.status).toBe(409);
  });

  it('enforces one confirmed row while retaining booking history', async () => {
    const [first, second] = await Promise.all([
      prisma.booking.create({
        data: { user_id: 'u1', event_id: 'E1', seat_number: 42 },
      }),
      prisma.booking.create({
        data: { user_id: 'u2', event_id: 'E1', seat_number: 42 },
      }),
    ]);

    const updates = await Promise.allSettled([
      prisma.booking.update({
        where: { id: first.id },
        data: { status: BookingStatus.confirmed },
      }),
      prisma.booking.update({
        where: { id: second.id },
        data: { status: BookingStatus.confirmed },
      }),
    ]);

    expect(updates.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.booking.count({
        where: { event_id: 'E1', seat_number: 42, status: BookingStatus.confirmed },
      })
    ).toBe(1);
    expect(await prisma.booking.count()).toBe(2);
  });

  it('releases a Redis lock only when the caller owns its token', async () => {
    await redis.set(seatLockKey('E1', 42), 'owner-token', 'EX', 60);

    expect(await releaseSeatHold('E1', 42, 'wrong-token')).toBe(false);
    expect(await getSeatHoldToken('E1', 42)).toBe('owner-token');
    expect(await releaseSeatHold('E1', 42, 'owner-token')).toBe(true);
    expect(await getSeatHoldToken('E1', 42)).toBeNull();
  });
});
