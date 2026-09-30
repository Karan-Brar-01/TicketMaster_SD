import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onTraffic } from '../api/client';
import type { TrafficHit } from '../types';

interface TrafficContextValue {
  lastHit: TrafficHit | null;
  recent: TrafficHit[];
  counts: Record<string, number>;
  clear: () => void;
  recordHits: (hits: TrafficHit[]) => void;
}

const TrafficContext = createContext<TrafficContextValue | null>(null);

export function TrafficProvider({ children }: { children: ReactNode }) {
  const [recent, setRecent] = useState<TrafficHit[]>([]);
  const [lastHit, setLastHit] = useState<TrafficHit | null>(null);

  useEffect(() => {
    return onTraffic((hit) => {
      setLastHit(hit);
      setRecent((prev) => [hit, ...prev].slice(0, 100));
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    setLastHit(null);
  }, []);

  const recordHits = useCallback((hits: TrafficHit[]) => {
    if (hits.length === 0) return;
    setLastHit(hits[hits.length - 1]);
    setRecent((prev) => [...hits].reverse().concat(prev).slice(0, 200));
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const hit of recent) {
      map[hit.servedBy] = (map[hit.servedBy] || 0) + 1;
    }
    return map;
  }, [recent]);

  const value = useMemo(
    () => ({ lastHit, recent, counts, clear, recordHits }),
    [lastHit, recent, counts, clear, recordHits]
  );

  return (
    <TrafficContext.Provider value={value}>{children}</TrafficContext.Provider>
  );
}

export function useTraffic(): TrafficContextValue {
  const ctx = useContext(TrafficContext);
  if (!ctx) throw new Error('useTraffic requires TrafficProvider');
  return ctx;
}
