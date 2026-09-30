-- Final database invariant: historical held/cancelled/expired rows may coexist,
-- but an event seat can have at most one confirmed booking.
CREATE UNIQUE INDEX "unique_confirmed_seat"
ON "bookings" ("event_id", "seat_number")
WHERE "status" = 'confirmed';
