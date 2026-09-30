process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://ticketmaster:ticketmaster@127.0.0.1:5434/bookings_db';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
process.env.SEAT_HOLD_TTL_SECONDS = '60';
