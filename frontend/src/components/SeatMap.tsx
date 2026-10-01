import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { EventItem, HoldRecord, SeatInfo, SeatLayout } from '../types';
import { formatRupees } from '../utils/currency';

const HOLD_KEY = 'tm_holds';

type BookingView =
  | { kind: 'idle'; message?: string }
  | { kind: 'held'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'booked'; message: string }
  | { kind: 'error'; message: string };

function loadHolds(): HoldRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HOLD_KEY) || '[]') as HoldRecord[];
  } catch {
    return [];
  }
}

function saveEventHolds(eventId: string, holds: HoldRecord[]) {
  const otherEvents = loadHolds().filter((hold) => hold.event_id !== eventId);
  localStorage.setItem(HOLD_KEY, JSON.stringify([...otherEvents, ...holds]));
}

function countdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function seatName(seat: Pick<SeatInfo, 'row_label' | 'seat_in_row' | 'seat_number'>) {
  return seat.row_label ? `${seat.row_label}${seat.seat_in_row}` : `#${seat.seat_number}`;
}

const seatClass: Record<string, string> = {
  available:
    'bg-ink-700/80 border-white/15 text-sand-100 hover:border-ember-400 hover:bg-ember-500/15',
  vip: 'bg-violet-950/70 border-violet-400/50 text-violet-200 hover:border-violet-300 hover:bg-violet-500/20',
  selected:
    'bg-ember-500 border-ember-300 text-ink-950 ring-2 ring-ember-400/30',
  held: 'bg-amber-950/70 border-amber-400/50 text-amber-200',
  mine: 'bg-ember-500/25 border-ember-400 text-ember-300 ring-2 ring-ember-400/20',
  booked: 'bg-ink-950/80 border-white/5 text-sand-300/40',
  blocked:
    'theatre-blocked-seat border-red-500/20 text-red-200/45 cursor-not-allowed',
};

interface Props {
  event: EventItem;
}

export function SeatMap({ event }: Props) {
  const { token } = useAuth();
  const location = useLocation();
  const eventId = event.id;
  const [seats, setSeats] = useState<SeatInfo[]>(() =>
    createPlaceholderSeats(event)
  );
  const [layout, setLayout] = useState<SeatLayout>(event.seat_layout);
  const [holds, setHolds] = useState<HoldRecord[]>(() =>
    loadHolds().filter((hold) => hold.event_id === eventId)
  );
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState<'reserve' | 'confirm' | null>(null);
  const [view, setView] = useState<BookingView>({ kind: 'idle' });
  const [now, setNow] = useState(Date.now());

  const activeHold = useMemo(
    () =>
      holds.find(
        (hold) => hold.seat_number === selectedSeat && hold.expires_at > now
      ) ?? null,
    [holds, selectedSeat, now]
  );

  const rows = useMemo(() => {
    const grouped = new Map<number, SeatInfo[]>();
    for (const seat of seats) {
      const current = grouped.get(seat.row_number) ?? [];
      current.push(seat);
      grouped.set(seat.row_number, current);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [seats]);

  async function refresh() {
    const { data } = await apiFetch<{
      seats: SeatInfo[];
      seat_layout: SeatLayout;
    }>(`/api/bookings/events/${eventId}/seats`);
    setSeats(data.seats);
    setLayout(data.seat_layout);
  }

  useEffect(() => {
    void refresh().catch((err) =>
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not load live seats.',
      })
    );
    const refreshId = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(refreshId);
  }, [eventId]);

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    saveEventHolds(eventId, holds);
  }, [holds, eventId]);

  useEffect(() => {
    const expiredSelected = holds.find(
      (hold) => hold.seat_number === selectedSeat && hold.expires_at <= now
    );
    if (!expiredSelected) return;

    setHolds((current) => current.filter((hold) => hold !== expiredSelected));
    setView({
      kind: 'expired',
      message: `The hold on seat ${expiredSelected.row_label ?? expiredSelected.seat_number} expired. Select an available seat to try again.`,
    });
    void refresh().catch(() => undefined);
  }, [now, selectedSeat, holds]);

  function selectSeat(seat: SeatInfo) {
    if (busy) return;
    setSelectedSeat(seat.seat_number);
    const label = seatName(seat);

    if (seat.status === 'blocked') {
      setView({
        kind: 'conflict',
        message: `Row ${seat.row_label} is closed and cannot be booked. Choose another row.`,
      });
      return;
    }
    if (seat.status === 'booked') {
      setView({
        kind: 'booked',
        message: `Seat ${label} is already booked. Choose another available seat.`,
      });
      return;
    }
    if (seat.status === 'held' && !seat.mine) {
      setView({
        kind: 'conflict',
        message: `Seat ${label} is temporarily held by another customer. Its availability will update automatically.`,
      });
      return;
    }

    const localHold = holds.find(
      (hold) => hold.seat_number === seat.seat_number && hold.expires_at > Date.now()
    );
    if (seat.mine && localHold) {
      setView({
        kind: 'held',
        message: `Seat ${label} is held for you. Confirm before the timer reaches zero.`,
      });
    } else if (seat.mine) {
      setView({
        kind: 'conflict',
        message: `Seat ${label} is held by your account in another session. This browser does not have its secure hold token.`,
      });
    } else {
      setView({ kind: 'idle' });
    }
  }

  async function reserveSelected() {
    if (selectedSeat == null || busy) return;
    setBusy('reserve');
    setView({ kind: 'idle' });
    try {
      const { data } = await apiFetch<{
        booking: { id: string; seat_number: number };
        seat: SeatInfo;
        hold_token: string;
        hold_ttl_seconds: number;
      }>('/api/bookings/reserve', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId, seat_number: selectedSeat }),
      });

      const record: HoldRecord = {
        booking_id: data.booking.id,
        hold_token: data.hold_token,
        seat_number: data.booking.seat_number,
        event_id: eventId,
        expires_at: Date.now() + data.hold_ttl_seconds * 1000,
        row_label: data.seat.row_label,
        seat_type: data.seat.seat_type,
        price: data.seat.price,
      };
      setHolds((current) => [
        ...current.filter((hold) => hold.seat_number !== record.seat_number),
        record,
      ]);
      setNow(Date.now());
      setView({
        kind: 'held',
        message: `Seat ${seatName(data.seat)} is now held for you. The reservation only becomes final after confirmation.`,
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const lower = err.message.toLowerCase();
        const alreadyBooked = lower.includes('booked');
        const closedRow = lower.includes('row');
        setView({
          kind: alreadyBooked ? 'booked' : 'conflict',
          message: closedRow
            ? 'That theatre row is closed and cannot be booked.'
            : alreadyBooked
              ? 'That seat was already booked. Choose another seat.'
              : 'That seat was just held by someone else. Choose another seat or wait for it to be released.',
        });
      } else {
        setView({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not reserve this seat.',
        });
      }
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function confirmHold() {
    if (!activeHold || busy) return;
    setBusy('confirm');
    try {
      const { data } = await apiFetch<{
        booking: { id: string; seat_number: number; status: string };
        message: string;
      }>('/api/bookings/confirm', {
        method: 'POST',
        body: JSON.stringify({
          booking_id: activeHold.booking_id,
          hold_token: activeHold.hold_token,
        }),
      });

      setHolds((current) =>
        current.filter((hold) => hold.booking_id !== activeHold.booking_id)
      );
      const selected = seats.find((seat) => seat.seat_number === activeHold.seat_number);
      const label = selected ? seatName(selected) : String(activeHold.seat_number);
      setView({
        kind: 'success',
        message:
          data.message === 'already confirmed'
            ? `Seat ${label} was already confirmed for your account.`
            : `You're going! Seat ${label} is confirmed and your ticket notification is queued.`,
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const lower = err.message.toLowerCase();
        const isExpired = lower.includes('expired') || lower.includes('hold');
        setView({
          kind: isExpired ? 'expired' : 'booked',
          message: isExpired
            ? 'The hold expired before confirmation. Reserve an available seat again.'
            : 'This seat is already booked. Choose another seat.',
        });
        setHolds((current) =>
          current.filter((hold) => hold.booking_id !== activeHold.booking_id)
        );
      } else {
        setView({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not confirm the booking.',
        });
      }
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  const selectedInfo = seats.find((seat) => seat.seat_number === selectedSeat);
  const canReserve =
    token && selectedInfo?.status === 'available' && !activeHold;

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-4 text-xs text-sand-300">
          <Legend swatch="bg-ink-700 border-white/20" label="Standard" />
          <Legend swatch="bg-violet-950 border-violet-400/50" label="VIP" />
          <Legend swatch="bg-ember-500 border-ember-300" label="Selected" />
          <Legend swatch="bg-amber-950 border-amber-400/50" label="Held" />
          <Legend swatch="theatre-blocked-seat border-red-500/20" label="Closed row" />
        </div>

        <div className="mx-auto max-w-4xl rounded-t-[50%] border-x border-t border-ember-400/30 bg-gradient-to-b from-ember-400/15 to-transparent py-4 text-center text-[10px] uppercase tracking-[0.35em] text-ember-300 shadow-[0_-8px_30px_rgba(240,180,41,0.08)]">
          Stage · {layout.name}
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="mx-auto min-w-[38rem] max-w-4xl space-y-2">
            {rows.map(([rowNumber, rowSeats]) => (
              <div key={rowNumber} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center font-mono text-xs font-bold text-sand-300">
                  {rowSeats[0]?.row_label}
                </span>
                <div className="flex flex-1 items-center justify-center gap-1.5 sm:gap-2">
                  {rowSeats.map((seat) => {
                    const localHold = holds.some(
                      (hold) =>
                        hold.seat_number === seat.seat_number && hold.expires_at > now
                    );
                    const visual =
                      selectedSeat === seat.seat_number && seat.status === 'available'
                        ? 'selected'
                        : seat.status === 'held' && (seat.mine || localHold)
                          ? 'mine'
                          : seat.status === 'available' && seat.seat_type === 'vip'
                            ? 'vip'
                            : seat.status;
                    return (
                      <Fragment key={seat.seat_number}>
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => selectSeat(seat)}
                          aria-pressed={selectedSeat === seat.seat_number}
                          aria-label={`${seat.seat_type === 'vip' ? 'VIP ' : ''}seat ${seatName(seat)}, ${formatRupees(seat.price)}, ${visual}`}
                          className={`h-9 min-w-0 flex-1 rounded-t-lg rounded-b-sm border text-[10px] font-mono transition disabled:cursor-wait disabled:opacity-70 sm:h-10 sm:text-xs ${seatClass[visual]}`}
                        >
                          {seat.seat_in_row}
                        </button>
                        {layout.aisle_after_columns.includes(seat.seat_in_row) && (
                          <Staircase />
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.18em] text-sand-300">
          <span className="theatre-stairs h-4 w-8 rounded-sm border border-white/10" />
          Staircase / aisle
        </div>
      </div>

      <aside className="h-fit rounded-2xl border border-white/10 bg-ink-950/65 p-5 lg:sticky lg:top-28">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sand-300">
          Your reservation
        </p>

        {!selectedInfo ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/20 text-sand-300">
              #
            </div>
            <p className="mt-3 text-sm text-sand-300">Select an available seat to continue.</p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-end justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-xs text-sand-300">
                  {selectedInfo.seat_type === 'vip' ? 'VIP seat' : 'Standard seat'}
                </p>
                <p className="mt-1 font-display text-3xl font-bold text-sand-50">
                  {seatName(selectedInfo)}
                </p>
                <p className="mt-1 font-mono text-sm text-ember-400">
                  {formatRupees(activeHold?.price ?? selectedInfo.price)}
                </p>
              </div>
              {activeHold && (
                <div className="text-right">
                  <p className="text-xs text-sand-300">Hold expires in</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-ember-400" aria-live="polite">
                    {countdown(activeHold.expires_at - now)}
                  </p>
                </div>
              )}
            </div>

            {activeHold ? (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void confirmHold()}
                className="mt-5 w-full rounded-xl bg-ember-500 px-4 py-3 font-semibold text-ink-950 transition hover:bg-ember-400 disabled:opacity-60"
              >
                {busy === 'confirm' ? 'Confirming with server…' : 'Confirm booking'}
              </button>
            ) : token ? (
              <button
                type="button"
                disabled={!canReserve || busy != null}
                onClick={() => void reserveSelected()}
                className="mt-5 w-full rounded-xl bg-ember-500 px-4 py-3 font-semibold text-ink-950 transition hover:bg-ember-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'reserve' ? 'Creating secure hold…' : 'Reserve this seat'}
              </button>
            ) : selectedInfo.status === 'available' ? (
              <Link
                to="/login"
                state={{ from: location.pathname }}
                className="mt-5 block w-full rounded-xl bg-ember-500 px-4 py-3 text-center font-semibold text-ink-950 transition hover:bg-ember-400"
              >
                Sign in to reserve
              </Link>
            ) : null}

            <p className="mt-3 text-center text-[11px] leading-relaxed text-sand-300">
              Seat tier, price, availability, and closed rows are verified by the booking service.
            </p>
          </div>
        )}

        {view.kind !== 'idle' && <StatusNotice view={view} />}
      </aside>
    </div>
  );
}

function createPlaceholderSeats(event: EventItem): SeatInfo[] {
  return Array.from({ length: event.total_seats }, (_, index) => {
    const seatNumber = index + 1;
    const rowNumber = Math.floor(index / event.seat_layout.columns) + 1;
    const vip = event.seat_layout.vip_rows.includes(rowNumber);
    const blocked = event.seat_layout.blocked_rows.includes(rowNumber);
    return {
      seat_number: seatNumber,
      row_number: rowNumber,
      row_label: String.fromCharCode(64 + rowNumber),
      seat_in_row: (index % event.seat_layout.columns) + 1,
      seat_type: vip ? 'vip' : 'standard',
      price: vip ? event.vip_price : event.price,
      currency: 'INR',
      status: blocked ? 'blocked' : 'available',
    };
  });
}

function Staircase() {
  return (
    <span
      className="theatre-stairs h-9 w-7 shrink-0 rounded-sm border border-white/10 sm:h-10 sm:w-9"
      aria-label="staircase aisle"
      role="img"
    />
  );
}

function StatusNotice({ view }: { view: Exclude<BookingView, { kind: 'idle' }> }) {
  const styles: Record<typeof view.kind, string> = {
    held: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    conflict: 'border-orange-400/30 bg-orange-400/10 text-orange-200',
    expired: 'border-red-400/30 bg-red-400/10 text-red-200',
    booked: 'border-red-400/30 bg-red-400/10 text-red-200',
    error: 'border-red-400/30 bg-red-400/10 text-red-200',
  };
  const labels: Record<typeof view.kind, string> = {
    held: 'Seat held',
    success: 'Booking confirmed',
    conflict: 'Seat unavailable',
    expired: 'Hold expired',
    booked: 'Already booked',
    error: 'Something went wrong',
  };
  return (
    <div className={`mt-5 rounded-xl border px-4 py-3 ${styles[view.kind]}`} role="status">
      <p className="text-xs font-semibold uppercase tracking-wider">{labels[view.kind]}</p>
      <p className="mt-1 text-sm leading-relaxed">{view.message}</p>
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
