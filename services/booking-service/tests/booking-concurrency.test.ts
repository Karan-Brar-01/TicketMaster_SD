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

const jwtSecret = process.env.JWT_SECRET!;

function auth(userId: string): string {
  return `Bearer ${jwt.sign(
    { sub: userId, email: `${userId}@example.test`, role: 'user' },
    jwtSecret
  )}`;
}

describe('booking concurrency and ownership invariants', () => {
  const publish = vi.fn(async () => undefined);
  const app = createApp({ publishBookingConfirmed: publish });

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
