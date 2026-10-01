import { SystemDashboard } from '../components/SystemDashboard';

export function SystemLabPage() {
  return (
    <div className="space-y-8 animate-slideIn">
      <section className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ember-400">
          Engineering mode
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-sand-50 sm:text-5xl">
          System Lab
        </h1>
        <p className="mt-3 text-base leading-relaxed text-sand-300 sm:text-lg">
          Inspect the distributed behavior behind Product Mode. Exercise Nginx
          load balancing, Redis caching and seat locks, and live request telemetry
          without changing the production-style booking path.
        </p>
      </section>
      <SystemDashboard />
    </div>
  );
}
