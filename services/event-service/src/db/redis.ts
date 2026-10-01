import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export const CACHE_TTL_SECONDS = 60;
export const EVENTS_LIST_CACHE_KEY = 'events:list';

export function eventCacheKey(id: string): string {
  return `events:id:${id}`;
}

export async function invalidateEventCaches(eventId?: string): Promise<void> {
  const keys = [EVENTS_LIST_CACHE_KEY];
  if (eventId) keys.push(eventCacheKey(eventId));
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function invalidateAllEventCaches(): Promise<void> {
  const detailKeys = await redis.keys('events:id:*');
  await redis.del(EVENTS_LIST_CACHE_KEY, ...detailKeys);
}
