import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { HoldRecord, SeatInfo } from '../types';

const HOLD_KEY = 'tm_holds';

function loadHolds(): HoldRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HOLD_KEY) || '[]') as HoldRecord[];
  } catch {
    return [];
  }
}

function saveHolds(holds: HoldRecord[]) {
  localStorage.setItem(HOLD_KEY, JSON.stringify(holds));
}

const statusClass: Record<string, string> = {
  available:
    'bg-ink-700/80 border-white/20 hover:border-ember-400 hover:bg-ember-500/20 cursor-pointer',
  held: 'bg-ember-500/30 border-ember-400/60 text-ember-400 animate-pulseSeat',
  booked: 'bg-red-900/50 border-red-500/40 text-red-300 cursor-not-allowed',
};

interface Props {
  eventId: string;
  totalSeats: number;
}

export function SeatMap({ eventId, totalSeats }: Props) {
  const { token } = useAuth();
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [holds, setHolds] = useState<HoldRecord[]>(() =>
    loadHolds().filter((h) => h.event_id === eventId && h.expires_at > Date.now())
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cols = useMemo(() => {
    if (totalSeats <= 40) return 8;
    if (totalSeats <= 80) return 10;
    return 12;
  }, [totalSeats]);

  async function refresh() {
    const { data } = await apiFetch<{ seats: SeatInfo[] }>(
      `/api/bookings/events/${eventId}/seats?total=${totalSeats}`
    );
    setSeats(data.seats);
  }

  useEffect(() => {
    void refresh().catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load seats')
    );
    const id = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [eventId, totalSeats]);

  useEffect(() => {
    saveHolds([
      ...loadHolds().filter((h) => h.event_id !== eventId),
      ...holds,
    ]);
  }, [holds, eventId]);

  async function onSeatClick(seat: SeatInfo) {
    setError(null);
    setMessage(null);

    if (seat.status === 'booked') return;
    if (seat.status === 'held' && !seat.mine) {
      setError('Seat is held by someone else');
      return;
    }

    if (!token) {
      setError('Sign in to hold a seat');
      return;
    }

    const existing = holds.find((h) => h.seat_number === seat.seat_number);
    if (existing || seat.mine) {
      // Confirm hold
      const hold = existing;
      if (!hold) {
        setError('Hold token missing — reserve again');
        return;
      }
      setBusy(seat.seat_number);
      try {
        await apiFetch('/api/bookings/confirm', {
          method: 'POST',
          body: JSON.stringify({
            booking_id: hold.booking_id,
            hold_token: hold.hold_token,
          }),
        });
        setHolds((prev) => prev.filter((h) => h.seat_number !== seat.seat_number));
        setMessage(`Seat ${seat.seat_number} confirmed. Ticket queued.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Confirm failed');
      } finally {
        setBusy(null);
      }
      return;
    }

    if (seat.status !== 'available') return;

    setBusy(seat.seat_number);
    try {
      const { data } = await apiFetch<{
        booking: { id: string; seat_number: number };
        hold_token: string;
        hold_ttl_seconds: number;
      }>('/api/bookings/reserve', {
        method: 'POST',
        body: JSON.stringify({
          event_id: eventId,
          seat_number: seat.seat_number,
        }),
      });

      const record: HoldRecord = {
        booking_id: data.booking.id,
        hold_token: data.hold_token,
        seat_number: data.booking.seat_number,
        event_id: eventId,
        expires_at: Date.now() + data.hold_ttl_seconds * 1000,
      };
      setHolds((prev) => [...prev.filter((h) => h.seat_number !== seat.seat_number), record]);
      setMessage(
        `Seat ${seat.seat_number} held for 10 minutes. Click again to confirm payment.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reserve failed');
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-xs font-body text-sand-300">
        <Legend swatch="bg-ink-700 border-white/20" label="Available" />
        <Legend swatch="bg-ember-500/40 border-ember-400" label="Held (10 min)" />
        <Legend swatch="bg-red-900/60 border-red-500/50" label="Booked" />
        {!token && (
          <Link to="/login" className="text-ember-400 underline-offset-2 hover:underline">
            Sign in to reserve
          </Link>
        )}
      </div>

      <div
        className="mx-auto grid max-w-3xl gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {(seats.length
          ? seats
          : Array.from({ length: totalSeats }, (_, i) => ({
              seat_number: i + 1,
              status: 'available' as const,
            }))
        ).map((seat) => {
          const mineHold = holds.some((h) => h.seat_number === seat.seat_number);
          const visual =
            seat.status === 'held' && (seat.mine || mineHold)
              ? 'held'
              : seat.status;
          return (
            <button
              key={seat.seat_number}
              type="button"
              disabled={busy === seat.seat_number || seat.status === 'booked'}
              onClick={() => void onSeatClick(seat)}
              title={`Seat ${seat.seat_number} — ${visual}`}
              className={`aspect-square rounded-md border text-[10px] font-mono transition sm:text-xs ${statusClass[visual]} ${
                mineHold ? 'ring-2 ring-ember-400' : ''
              }`}
            >
              {seat.seat_number}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-dashed border-white/15 bg-ink-900/40 px-4 py-3 text-center text-xs text-sand-300">
        Stage / Screen
      </div>

      {message && (
        <p className="animate-slideIn rounded-lg border border-ember-400/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-400">
          {message}
        </p>
      )}
      {error && (
        <p className="animate-slideIn rounded-lg border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm border ${swatch}`} />
      {label}
    </span>
  );
}
