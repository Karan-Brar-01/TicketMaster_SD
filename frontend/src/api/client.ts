import type { TrafficHit } from '../types';

type TrafficListener = (hit: TrafficHit) => void;

const listeners = new Set<TrafficListener>();

export function onTraffic(listener: TrafficListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(hit: TrafficHit) {
  listeners.forEach((l) => l(hit));
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface ApiResult<T> {
  data: T;
  servedBy: string;
  ms: number;
  cache?: string | null;
}

function authHeader(): HeadersInit {
  const token = localStorage.getItem('tm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const started = performance.now();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(init.headers || {}),
    },
  });
  const ms = Math.round(performance.now() - started);
  const servedBy = res.headers.get('X-Served-By') || 'unknown';
  const cache = res.headers.get('X-Cache');

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  emit({
    servedBy,
    ms,
    path,
    at: Date.now(),
    ok: res.ok,
  });

  if (!res.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: string }).error)
        : res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return { data: body as T, servedBy, ms, cache };
}
