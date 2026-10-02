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

const ACQUIRE_SEAT_HOLDS_SCRIPT = `
  for _, key in ipairs(KEYS) do
    if redis.call("exists", key) == 1 then
      return 0
    end
  end

  for _, key in ipairs(KEYS) do
    redis.call("set", key, ARGV[1], "EX", ARGV[2])
  end

  return 1
`;

const RELEASE_SEAT_HOLDS_SCRIPT = `
  local released = 0
  for _, key in ipairs(KEYS) do
    if redis.call("get", key) == ARGV[1] then
      released = released + redis.call("del", key)
    end
  end
  return released
`;

const OWNS_SEAT_HOLDS_SCRIPT = `
  for _, key in ipairs(KEYS) do
    if redis.call("get", key) ~= ARGV[1] then
      return 0
    end
  end
  return 1
`;

/**
 * Atomically acquire every requested seat or none of them.
 * All keys use the same ownership token and TTL. The current deployment uses a
 * single Redis instance, so the script can evaluate the complete key group.
 */
export async function acquireSeatHolds(
  eventId: string,
  seatNumbers: number[],
  token: string
): Promise<boolean> {
  if (seatNumbers.length === 0) return false;
  const keys = seatNumbers.map((seatNumber) => seatLockKey(eventId, seatNumber));
  const result = await redis.eval(
    ACQUIRE_SEAT_HOLDS_SCRIPT,
    keys.length,
    ...keys,
    token,
    String(SEAT_HOLD_TTL_SECONDS)
  );
  return result === 1;
}

/**
 * Backwards-compatible one-seat wrapper around the atomic group acquisition.
 */
export async function acquireSeatHold(
  eventId: string,
  seatNumber: number,
  token: string
): Promise<boolean> {
  return acquireSeatHolds(eventId, [seatNumber], token);
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
  return (await releaseSeatHolds(eventId, [seatNumber], token)) === 1;
}

/** Delete only locks still owned by token; a re-acquired lock is untouched. */
export async function releaseSeatHolds(
  eventId: string,
  seatNumbers: number[],
  token: string
): Promise<number> {
  if (seatNumbers.length === 0) return 0;
  const keys = seatNumbers.map((seatNumber) => seatLockKey(eventId, seatNumber));
  const result = await redis.eval(
    RELEASE_SEAT_HOLDS_SCRIPT,
    keys.length,
    ...keys,
    token
  );
  return Number(result);
}

/** Atomically verify that token still owns every lock in a seat group. */
export async function ownsSeatHolds(
  eventId: string,
  seatNumbers: number[],
  token: string
): Promise<boolean> {
  if (seatNumbers.length === 0) return false;
  const keys = seatNumbers.map((seatNumber) => seatLockKey(eventId, seatNumber));
  const result = await redis.eval(
    OWNS_SEAT_HOLDS_SCRIPT,
    keys.length,
    ...keys,
    token
  );
  return result === 1;
}
