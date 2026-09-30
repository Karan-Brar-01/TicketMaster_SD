import { useState } from 'react';
import { apiFetch } from '../api/client';
import { useTraffic } from '../context/TrafficContext';
import type { TrafficHit } from '../types';

export function SystemDashboard() {
  const { lastHit, counts, clear, recordHits } = useTraffic();
  const [open, setOpen] = useState(true);
  const [spamming, setSpamming] = useState(false);
  const [spamSummary, setSpamSummary] = useState<string | null>(null);
  const [doubleBookTest, setDoubleBookTest] = useState<string | null>(null);

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  async function spamEvents() {
    setSpamming(true);
    setSpamSummary(null);
    try {
      const results = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const started = performance.now();
          try {
            const res = await fetch('/api/events', {
              headers: { 'Content-Type': 'application/json' },
            });
            const ms = Math.round(performance.now() - started);
            const servedBy = res.headers.get('X-Served-By') || 'unknown';
            return {
              servedBy,
              ms,
              path: '/api/events',
              at: Date.now(),
              ok: res.ok,
            } satisfies TrafficHit;
          } catch {
            return {
              servedBy: 'error',
              ms: Math.round(performance.now() - started),
              path: '/api/events',
              at: Date.now(),
              ok: false,
            } satisfies TrafficHit;
          }
        })
      );
      recordHits(results);
      const dist: Record<string, number> = {};
      for (const r of results) {
        dist[r.servedBy] = (dist[r.servedBy] || 0) + 1;
      }
      const parts = Object.entries(dist)
        .map(([k, v]) => `${k} → ${v}`)
        .join(' · ');
      setSpamSummary(`50 GETs done. Distribution: ${parts}`);
    } finally {
      setSpamming(false);
    }
  }

  async function spamSameSeat() {
    setSpamming(true);
    setDoubleBookTest(null);
    try {
      const token = localStorage.getItem('tm_token');
      if (!token) {
        setDoubleBookTest('Sign in first to run the double-booking stress test.');
        return;
      }

      const { data: eventsData } = await apiFetch<{
        events: { id: string; total_seats: number }[];
      }>('/api/events');
      const first = eventsData.events[0];
      if (!first) {
        setDoubleBookTest('No events available.');
        return;
      }

      const seat = Math.min(first.total_seats, 50);
      const results = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const started = performance.now();
          const res = await fetch('/api/bookings/reserve', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ event_id: first.id, seat_number: seat }),
          });
          const ms = Math.round(performance.now() - started);
          const servedBy = res.headers.get('X-Served-By') || 'unknown';
          return {
            status: res.status,
            hit: {
              servedBy,
              ms,
              path: '/api/bookings/reserve',
              at: Date.now(),
              ok: res.ok,
            } satisfies TrafficHit,
          };
        })
      );

      recordHits(results.map((r) => r.hit));
      const wins = results.filter((r) => r.status === 201).length;
      const conflicts = results.filter((r) => r.status === 409).length;
      setDoubleBookTest(
        wins === 1
          ? `Seat ${seat}: exactly 1 hold won, ${conflicts} rejected (409). Zero double-bookings.`
          : `Seat ${seat}: unexpected — ${wins} successes, ${conflicts} conflicts.`
      );
    } catch (err) {
      setDoubleBookTest(err instanceof Error ? err.message : 'Stress test failed');
    } finally {
      setSpamming(false);
    }
  }

  return (
    <aside
      className={`fixed bottom-4 right-4 z-40 w-[min(100%-2rem,22rem)] font-body transition-all ${
        open ? '' : 'translate-y-[calc(100%-2.75rem)]'
      }`}
    >
      <div className="overflow-hidden rounded-xl border border-white/15 bg-ink-900/95 shadow-glow backdrop-blur-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="font-display text-sm font-bold tracking-wide text-sand-50">
            System Design
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-ember-400">
            {open ? 'collapse' : 'expand'}
          </span>
        </button>

        <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-sand-300">
              Last upstream
            </p>
            <p className="mt-1 break-all font-mono text-sm text-ember-400">
              {lastHit?.servedBy ?? '—'}
            </p>
            {lastHit && (
              <p className="mt-1 font-mono text-[11px] text-sand-300">
                {lastHit.path} · {lastHit.ms}ms ·{' '}
                {lastHit.ok ? 'ok' : 'error'}
              </p>
            )}
          </div>

          {entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-sand-300">
                Replica traffic
              </p>
              {entries.map(([host, n]) => (
                <div key={host} className="space-y-1">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="truncate text-sand-100">{host}</span>
                    <span className="text-ember-400">{n}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full origin-left animate-barGrow rounded-full bg-ember-500"
                      style={{ width: `${(n / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={spamming}
              onClick={() => void spamEvents()}
              className="rounded-lg bg-ember-500 px-3 py-2 text-sm font-medium text-ink-950 hover:bg-ember-400 disabled:opacity-60"
            >
              {spamming ? 'Running…' : 'Spam 50 Concurrent Requests'}
            </button>
            <button
              type="button"
              disabled={spamming}
              onClick={() => void spamSameSeat()}
              className="rounded-lg border border-white/20 px-3 py-2 text-sm text-sand-100 hover:border-ember-400/60 disabled:opacity-60"
            >
              Stress: 50× same seat
            </button>
            <button
              type="button"
              onClick={clear}
              className="text-left text-[11px] text-sand-300 underline-offset-2 hover:underline"
            >
              Clear counters
            </button>
          </div>

          {spamSummary && (
            <p className="font-mono text-[11px] leading-relaxed text-sand-100">
              {spamSummary}
            </p>
          )}
          {doubleBookTest && (
            <p className="font-mono text-[11px] leading-relaxed text-ember-400">
              {doubleBookTest}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
