import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { EventItem } from '../types';

export function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [ms, setMs] = useState<number | null>(null);
  const [servedBy, setServedBy] = useState<string | null>(null);
  const [cache, setCache] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ events: EventItem[] }>('/api/events');
      setEvents(result.data.events);
      setMs(result.ms);
      setServedBy(result.servedBy);
      setCache(result.cache ?? null);
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
    <div className="space-y-8 animate-slideIn">
      <section className="max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ember-400">
          Live catalog
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-sand-50 sm:text-5xl">
          TicketMaster
        </h1>
        <p className="mt-3 text-base text-sand-300 sm:text-lg">
          Browse events served through Nginx round-robin. Response timing and
          upstream identity update on every fetch.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-sand-300">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sand-100 hover:border-ember-400/50"
        >
          Refresh
        </button>
        {ms != null && (
          <span>
            {ms}ms
            {cache ? ` · cache ${cache}` : ''}
            {servedBy ? ` · via ${servedBy}` : ''}
          </span>
        )}
      </div>

      {loading && (
        <p className="text-sm text-sand-300">Loading events…</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event, i) => (
          <Link
            key={event.id}
            to={`/events/${event.id}`}
            className="group block animate-slideIn border-b border-white/10 pb-5 transition hover:border-ember-400/40"
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
            <h2 className="mt-2 font-display text-xl font-bold text-sand-50 group-hover:text-ember-400">
              {event.title}
            </h2>
            <p className="mt-1 line-clamp-2 text-sm text-sand-300">
              {event.description}
            </p>
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span className="text-sand-300">{event.venue}</span>
              <span className="font-mono text-ember-400">
                ${event.price.toFixed(2)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-sand-300">
              {event.available_seats}/{event.total_seats} seats listed
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
