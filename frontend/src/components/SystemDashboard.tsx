import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTraffic } from '../context/TrafficContext';
import type { TrafficHit } from '../types';

interface ProbeResult {
  cache: string;
  servedBy: string;
  ms: number;
}

export function SystemDashboard() {
  const { user } = useAuth();
  const { lastHit, recent, clear, recordHits } = useTraffic();
  const [running, setRunning] = useState<'traffic' | 'seat' | 'cache' | null>(null);
  const [trafficSummary, setTrafficSummary] = useState<string | null>(null);
  const [seatSummary, setSeatSummary] = useState<string | null>(null);
  const [cacheResults, setCacheResults] = useState<ProbeResult[]>([]);

  const eventCounts = recent.reduce<Record<string, number>>((totals, hit) => {
    if (hit.path === '/api/events') {
      totals[hit.servedBy] = (totals[hit.servedBy] || 0) + 1;
    }
    return totals;
  }, {});
  const entries = Object.entries(eventCounts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));

  async function probeCache() {
    setRunning('cache');
    setCacheResults([]);
    try {
      const results: ProbeResult[] = [];
      for (let index = 0; index < 3; index += 1) {
        const result = await apiFetch('/api/events');
        results.push({
          cache: result.cache ?? '—',
          servedBy: result.servedBy,
          ms: result.ms,
        });
      }
      setCacheResults(results);
    } finally {
      setRunning(null);
    }
  }

  async function spamEvents() {
    setRunning('traffic');
    setTrafficSummary(null);
    try {
      const results = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const started = performance.now();
          try {
            const response = await fetch('/api/events', {
              headers: { 'Content-Type': 'application/json' },
            });
            return {
              servedBy: response.headers.get('X-Served-By') || 'unknown',
              ms: Math.round(performance.now() - started),
              path: '/api/events',
              at: Date.now(),
              ok: response.ok,
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
      const distribution: Record<string, number> = {};
      for (const result of results) {
        distribution[result.servedBy] =
          (distribution[result.servedBy] || 0) + 1;
      }
      setTrafficSummary(
        Object.entries(distribution)
          .map(([host, count]) => `${host}: ${count}`)
          .join(' · ')
      );
    } finally {
      setRunning(null);
    }
  }

  async function spamSameSeat() {
    setRunning('seat');
    setSeatSummary(null);
    try {
      const token = localStorage.getItem('tm_token');
      if (!token) {
        setSeatSummary('Sign in first to run the same-seat contention test.');
        return;
      }

      const { data } = await apiFetch<{
        events: { id: string; total_seats: number }[];
      }>('/api/events');
      const first = data.events[0];
      if (!first) {
        setSeatSummary('No events are available.');
        return;
      }

      const { data: seatData } = await apiFetch<{
        seats: { seat_number: number; status: string; seat_type: string }[];
      }>(`/api/bookings/events/${first.id}/seats`);
      const targetSeat =
        seatData.seats.find(
          (seat) => seat.status === 'available' && seat.seat_type === 'standard'
        ) ?? seatData.seats.find((seat) => seat.status === 'available');
      if (!targetSeat) {
        setSeatSummary('No reservable seat is available for the contention test.');
        return;
      }
      const seat = targetSeat.seat_number;
      const results = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const started = performance.now();
          const response = await fetch('/api/bookings/reserve', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ event_id: first.id, seat_number: seat }),
          });
          return {
            status: response.status,
            hit: {
              servedBy: response.headers.get('X-Served-By') || 'unknown',
              ms: Math.round(performance.now() - started),
              path: '/api/bookings/reserve',
              at: Date.now(),
              ok: response.ok,
            } satisfies TrafficHit,
          };
        })
      );

      recordHits(results.map((result) => result.hit));
      const wins = results.filter((result) => result.status === 201).length;
      const conflicts = results.filter((result) => result.status === 409).length;
      setSeatSummary(
        wins === 1
          ? `Verified: exactly 1 hold won for seat ${seat}; ${conflicts} requests were rejected with 409.`
          : `Unexpected result: ${wins} successful holds and ${conflicts} conflicts for seat ${seat}.`
      );
    } catch (err) {
      setSeatSummary(err instanceof Error ? err.message : 'Contention test failed.');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LabCard eyebrow="Nginx round-robin" title="Replica traffic">
        <p className="text-sm leading-relaxed text-sand-300">
          Fire 50 simultaneous catalog requests and inspect how Nginx distributes
          them across the two event-service replicas.
        </p>
        <button
          type="button"
          disabled={running != null}
          onClick={() => void spamEvents()}
          className="mt-5 rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-ember-400 disabled:opacity-50"
        >
          {running === 'traffic' ? 'Sending 50 requests…' : 'Run load-balancing test'}
        </button>
        {trafficSummary && <Result>{trafficSummary}</Result>}
        <div className="mt-5 space-y-3">
          {entries.length === 0 ? (
            <p className="text-xs text-sand-300">No recorded traffic yet.</p>
          ) : (
            entries.map(([host, count]) => (
              <div key={host}>
                <div className="flex justify-between font-mono text-xs">
                  <span className="truncate text-sand-100">{host}</span>
                  <span className="text-ember-400">{count}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-ember-500 transition-all"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </LabCard>

      <LabCard eyebrow="Redis read-through" title="Cache behavior">
        <p className="text-sm leading-relaxed text-sand-300">
          Request the event catalog three times and compare the response cache
          header, upstream replica, and latency.
        </p>
        <button
          type="button"
          disabled={running != null}
          onClick={() => void probeCache()}
          className="mt-5 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-sand-50 hover:border-ember-400/60 disabled:opacity-50"
        >
          {running === 'cache' ? 'Probing cache…' : 'Run cache probe'}
        </button>
        <div className="mt-5 space-y-2">
          {cacheResults.map((result, index) => (
            <div
              key={`${result.servedBy}-${index}`}
              className="grid grid-cols-[3rem_4rem_1fr_auto] gap-2 rounded-lg border border-white/10 bg-ink-950/45 px-3 py-2 font-mono text-xs"
            >
              <span className="text-sand-300">#{index + 1}</span>
              <span className={result.cache === 'HIT' ? 'text-emerald-300' : 'text-ember-400'}>
                {result.cache}
              </span>
              <span className="truncate text-sand-100">{result.servedBy}</span>
              <span className="text-sand-300">{result.ms}ms</span>
            </div>
          ))}
        </div>
      </LabCard>

      <LabCard eyebrow="Redis SET NX" title="Same-seat contention">
        <p className="text-sm leading-relaxed text-sand-300">
          Race 50 authenticated requests for one seat. A correct run produces one
          temporary hold and rejects the rest as conflicts.
        </p>
        {user ? (
          <button
            type="button"
            disabled={running != null}
            onClick={() => void spamSameSeat()}
            className="mt-5 rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-ember-400 disabled:opacity-50"
          >
            {running === 'seat' ? 'Racing 50 reservations…' : 'Run contention test'}
          </button>
        ) : (
          <Link
            to="/login"
            state={{ from: '/lab' }}
            className="mt-5 inline-block rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-ember-400"
          >
            Sign in to run test
          </Link>
        )}
        {seatSummary && <Result>{seatSummary}</Result>}
      </LabCard>

      <LabCard eyebrow="Request telemetry" title="Latest API activity">
        <div className="rounded-xl border border-white/10 bg-ink-950/45 p-4">
          <p className="text-[10px] uppercase tracking-widest text-sand-300">Last upstream</p>
          <p className="mt-1 break-all font-mono text-base text-ember-400">
            {lastHit?.servedBy ?? 'No requests recorded'}
          </p>
          {lastHit && (
            <p className="mt-1 font-mono text-xs text-sand-300">
              {lastHit.path} · {lastHit.ms}ms · {lastHit.ok ? 'ok' : 'error'}
            </p>
          )}
        </div>
        <div className="mt-3 max-h-36 space-y-1 overflow-auto font-mono text-[11px] text-sand-300">
          {recent.slice(0, 8).map((hit, index) => (
            <p key={`${hit.at}-${index}`}>
              {hit.ok ? '200' : 'ERR'} · {hit.ms}ms · {hit.path} · {hit.servedBy}
            </p>
          ))}
        </div>
        <button
          type="button"
          onClick={clear}
          className="mt-4 text-xs text-sand-300 underline-offset-2 hover:text-sand-50 hover:underline"
        >
          Clear telemetry
        </button>
      </LabCard>
    </div>
  );
}

function LabCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-ink-900/55 p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember-400">{eyebrow}</p>
      <h2 className="mt-1 font-display text-xl font-bold text-sand-50">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Result({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-lg border border-ember-400/20 bg-ember-500/10 px-3 py-2 font-mono text-xs leading-relaxed text-ember-300">
      {children}
    </p>
  );
}
