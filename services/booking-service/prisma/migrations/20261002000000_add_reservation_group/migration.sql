-- A reservation_id groups one or more seat rows so they can be held and
-- confirmed as one unit. It remains nullable for pre-migration booking rows.
ALTER TABLE "bookings" ADD COLUMN "reservation_id" TEXT;

CREATE INDEX "bookings_reservation_id_idx"
ON "bookings"("reservation_id");
