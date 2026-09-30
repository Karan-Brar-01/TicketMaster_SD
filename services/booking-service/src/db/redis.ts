import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
export const SEAT_HOLD_TTL_SECONDS = Number(process.env.SEAT_HOLD_TTL_SECONDS) || 600;

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

/** Redis key: seat:{event_id}:{seat_no} */
export function seatLockKey(eventId: string, seatNumber: number): string {
  return `seat:${eventId}:${seatNumber}`;
}

/**
 * Acquire a 10-minute hold: SET seat:{event_id}:{seat_no} token NX EX 600
 * Returns true if this caller owns the hold.
 */
export async function acquireSeatHold(
  eventId: string,
  seatNumber: number,
  token: string
): Promise<boolean> {
  const result = await redis.set(
    seatLockKey(eventId, seatNumber),
    token,
    'EX',
    SEAT_HOLD_TTL_SECONDS,
    'NX'
  );
  return result === 'OK';
}

export async function getSeatHoldToken(
  eventId: string,
  seatNumber: number
): Promise<string | null> {
  return redis.get(seatLockKey(eventId, seatNumber));
}

export async function releaseSeatHold(
  eventId: string,
  seatNumber: number,
  token: string
): Promise<boolean> {
  // Release only if we still own the lock (compare-and-del)
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  const result = await redis.eval(script, 1, seatLockKey(eventId, seatNumber), token);
  return result === 1;
}
