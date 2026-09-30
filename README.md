# Distributed Ticket Reservation System

[![CI](https://github.com/Karan-Brar-01/distributed-ticketing-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Karan-Brar-01/distributed-ticketing-system/actions/workflows/ci.yml)

A containerized event-booking platform designed to prevent double booking under concurrent seat reservations.

The project focuses on four engineering problems:

- Temporary distributed seat holds with Redis
- Transactional booking confirmation in PostgreSQL
- Asynchronous notifications with RabbitMQ
- Horizontal event-service scaling behind Nginx

## Architecture

```text
                         Nginx
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
       User API       Event API ×2      Booking API
          │                │                 │
      Users DB          Events DB        Bookings DB
                           │                 │
                         Redis ←──────── Seat holds
                                             │
                                             ▼
                                         RabbitMQ
                                             │
                                             ▼
                                     Notification Worker
```

Each API owns its PostgreSQL database. Nginx exposes one entry point and round-robins event requests across two service replicas. Redis is shared by the event cache and the booking service's expiring seat locks.

## The problem

Two users can select the same seat at almost the same instant. A normal read-then-write flow allows both requests to observe that the seat is free and can create two successful bookings. This system closes that race at three layers:

1. **Redis contention control:** `SET seat:{event}:{seat} token NX EX 600` permits one temporary holder.
2. **PostgreSQL transaction:** confirmation locks the relevant booking rows with `SELECT ... FOR UPDATE` before changing `held` to `confirmed`.
3. **Database invariant:** a partial unique index permits historical held, expired, and cancelled rows, but guarantees at most one confirmed booking for an event seat.

```sql
CREATE UNIQUE INDEX unique_confirmed_seat
ON bookings (event_id, seat_number)
WHERE status = 'confirmed';
```

Redis handles temporary contention, the transaction handles confirmation concurrency, and the database constraint is the final invariant.

## Booking flow

```text
User selects seat 42
        │
        ▼
POST /api/bookings/reserve
        │
        ├─ reject an existing confirmed booking
        ├─ acquire Redis hold with a unique token and TTL
        └─ create a HELD booking row
        │
        ▼
POST /api/bookings/confirm
        │
        ├─ validate user and hold token
        ├─ lock matching rows in a PostgreSQL transaction
        ├─ transition HELD → CONFIRMED
        ├─ release the Redis hold with compare-and-delete Lua
        └─ publish booking.confirmed
        │
        ▼
RabbitMQ → notification worker → simulated ticket and email
```

Confirmation is idempotent for the owner: a repeated request returns the existing confirmed booking without publishing a second event.

## Concurrency tests

The booking integration suite uses real PostgreSQL and Redis. It covers:

- 20 users racing for one seat: one hold succeeds and 19 conflict
- Concurrent reservations for different seats
- The partial unique index under competing confirmations
- Repeated confirmation by the same user
- Expired holds and incorrect hold tokens
- Cross-user confirmation attempts
- Reservations of already-confirmed seats
- Compare-and-delete Redis lock ownership

## Asynchronous notifications

`booking.confirmed` messages are published persistently to a durable topic exchange. The notification consumer acknowledges only after ticket and email simulation succeeds.

Failed deliveries follow a bounded path:

```text
notifications queue → retry queue (5-second TTL) → notifications queue
        │                                              │
        └──────── after 3 failed retries ──────────────┘
                              │
                              ▼
                       dead-letter queue
```

Retry delay, limit, exchange, and queue names are configurable through environment variables.

## Tech stack

| Layer | Technology |
|---|---|
| Edge | Nginx |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| APIs | Node.js, Express, TypeScript |
| Persistence | PostgreSQL, Prisma |
| Distributed locks/cache | Redis |
| Messaging | RabbitMQ |
| Runtime | Docker Compose |
| CI | GitHub Actions |

## Run locally

Requirements: Docker Desktop and Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost](http://localhost). RabbitMQ management is available at [http://localhost:15672](http://localhost:15672).

This release replaces Prisma `db push` with versioned migrations. If you previously ran the old schema locally, recreate the disposable development volumes once:

```bash
docker compose down -v
docker compose up --build
```

## Run the booking tests

Start only the required infrastructure:

```bash
docker compose up -d bookings_db redis
```

Then run the migration and tests:

```bash
cd services/booking-service
npm ci
DATABASE_URL=postgresql://ticketmaster:ticketmaster@127.0.0.1:5434/bookings_db npm run prisma:migrate:deploy
TEST_DATABASE_URL=postgresql://ticketmaster:ticketmaster@127.0.0.1:5434/bookings_db \
TEST_REDIS_URL=redis://127.0.0.1:6379 \
npm test
```

GitHub Actions builds the frontend and all four services on every push and pull request, then runs the booking concurrency suite with PostgreSQL and Redis service containers.

## Limitations and production follow-ups

- Payment and email/PDF delivery are simulations.
- Authentication uses a shared JWT secret rather than a dedicated identity platform.
- The database commit and RabbitMQ publish are separate operations, leaving a dual-write failure window. A production version should use a **transactional outbox**, committing the booking and outbox event atomically before a worker publishes it.
- Retry and dead-letter queues preserve failed notification events, but there is no operator replay UI.
- The deployment is intentionally Docker Compose-based; Kubernetes, Kafka, service meshes, and event sourcing are outside this project's scope.
