export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  total_seats: number;
  available_seats: number;
  price: number;
  date: string;
}

export type SeatStatus = 'available' | 'held' | 'booked';

export interface SeatInfo {
  seat_number: number;
  status: SeatStatus;
  mine?: boolean;
  booking_id?: string;
}

export interface HoldRecord {
  booking_id: string;
  hold_token: string;
  seat_number: number;
  event_id: string;
  expires_at: number;
}

export interface TrafficHit {
  servedBy: string;
  ms: number;
  path: string;
  at: number;
  ok: boolean;
}
