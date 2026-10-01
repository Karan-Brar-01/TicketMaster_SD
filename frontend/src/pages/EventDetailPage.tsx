import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { SeatMap } from '../components/SeatMap';
import type { EventItem } from '../types';
import { formatRupees } from '../utils/currency';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const result = await apiFetch<{ event: EventItem }>(`/api/events/${id}`);
        setEvent(result.data.event);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Event not found');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }

  if (!event) {
    return <p className="text-sand-300">Loading event…</p>;
  }

  return (
    <div className="space-y-8 animate-slideIn">
      <div className="rounded-3xl border border-white/10 bg-ink-900/55 p-6 sm:p-8">
        <Link
          to="/"
          className="font-mono text-[11px] uppercase tracking-widest text-sand-300 hover:text-ember-400"
        >
          ← Catalog
        </Link>
        <h1 className="mt-5 font-display text-3xl font-extrabold text-sand-50 sm:text-5xl">
          {event.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sand-300">{event.description}</p>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <Detail label="Venue" value={event.venue} />
          <Detail label="Date & time" value={new Date(event.date).toLocaleString()} />
          <Detail
            label="Ticket price"
            value={`${formatRupees(event.price)} · VIP ${formatRupees(event.vip_price)}`}
            accent
          />
        </div>
      </div>

      <section className="rounded-3xl border border-white/10 bg-ink-900/35 p-5 sm:p-8">
        <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember-400">
              Step 2 of 3
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-sand-50">
              Choose your seat
            </h2>
            <p className="mt-1 text-sm text-sand-300">
              Live availability updates automatically. A hold lasts 10 minutes.
            </p>
          </div>
          <div className="flex gap-2" aria-label="Booking progress">
            <Step done label="Event" />
            <Step active label="Seat" />
            <Step label="Confirm" />
          </div>
        </div>
        <div>
          <SeatMap event={event} />
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-sand-300">{label}</p>
      <p className={`mt-1 font-medium ${accent ? 'text-ember-400' : 'text-sand-50'}`}>{value}</p>
    </div>
  );
}

function Step({ label, active = false, done = false }: { label: string; active?: boolean; done?: boolean }) {
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs ${active || done ? 'border-ember-400/50 text-ember-400' : 'border-white/10 text-sand-300'}`}>
      {done ? '✓ ' : ''}{label}
    </span>
  );
}
