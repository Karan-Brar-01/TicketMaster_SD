import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { EventItem } from '../types';
import { formatRupees } from '../utils/currency';

export function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ events: EventItem[] }>('/api/events');
      setEvents(result.data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-10 animate-slideIn">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/60 px-6 py-12 sm:px-10 sm:py-16">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-ember-500/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ember-400">
            Tickets, held fairly
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-sand-50 sm:text-6xl">
            Find your next live moment.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-sand-300 sm:text-lg">
            Pick an event, choose a live seat, and confirm it before your
            temporary hold expires.
          </p>
        </div>
      </section>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember-400">
            Now booking
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-sand-50">
            Upcoming events
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border border-white/15 px-4 py-2 text-xs text-sand-200 transition hover:border-ember-400/50 hover:text-sand-50"
        >
          Refresh events
        </button>
      </div>

      {loading && (
        <p className="text-sm text-sand-300">Loading events…</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center text-sand-300">
          No events are on sale right now.
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event, i) => (
          <Link
            key={event.id}
            to={`/events/${event.id}`}
            className="group flex min-h-64 animate-slideIn flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/55 p-5 transition hover:-translate-y-1 hover:border-ember-400/40 hover:shadow-glow"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-ember-400">
              {new Date(event.date).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <h3 className="mt-4 font-display text-2xl font-bold text-sand-50 transition group-hover:text-ember-400">
              {event.title}
            </h3>
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-sand-300">
              {event.description}
            </p>
            <div className="mt-auto flex items-end justify-between gap-4 pt-7 text-sm">
              <div>
              <span className="text-sand-300">{event.venue}</span>
                <p className="mt-1 text-xs text-sand-300">
                  {event.total_seats} seat venue
                </p>
              </div>
              <div className="text-right font-mono">
                <p className="text-ember-400">from {formatRupees(event.price)}</p>
                <p className="mt-1 text-[10px] text-sand-300">
                  VIP {formatRupees(event.vip_price)}
                </p>
              </div>
            </div>
            <span className="mt-5 block rounded-lg bg-ember-500 px-4 py-2.5 text-center text-sm font-semibold text-ink-950 transition group-hover:bg-ember-400">
              Choose seats
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
