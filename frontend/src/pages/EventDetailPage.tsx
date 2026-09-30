import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { SeatMap } from '../components/SeatMap';
import type { EventItem } from '../types';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [servedBy, setServedBy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const result = await apiFetch<{ event: EventItem }>(`/api/events/${id}`);
        setEvent(result.data.event);
        setMs(result.ms);
        setServedBy(result.servedBy);
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
      <div>
        <Link
          to="/"
          className="font-mono text-[11px] uppercase tracking-widest text-sand-300 hover:text-ember-400"
        >
          ← Catalog
        </Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold text-sand-50 sm:text-4xl">
          {event.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sand-300">{event.description}</p>
        <div className="mt-4 flex flex-wrap gap-4 font-mono text-xs text-sand-300">
          <span>{event.venue}</span>
          <span>{new Date(event.date).toLocaleString()}</span>
          <span className="text-ember-400">${event.price.toFixed(2)}</span>
          {ms != null && (
            <span>
              loaded in {ms}ms
              {servedBy ? ` via ${servedBy}` : ''}
            </span>
          )}
        </div>
      </div>

      <section>
        <h2 className="font-display text-xl font-bold text-sand-50">
          Seat map
        </h2>
        <p className="mt-1 text-sm text-sand-300">
          Click an available seat to place a 10-minute Redis hold. Click your
          held seat again to confirm (simulated payment).
        </p>
        <div className="mt-6">
          <SeatMap eventId={event.id} totalSeats={event.total_seats} />
        </div>
      </section>
    </div>
  );
}
