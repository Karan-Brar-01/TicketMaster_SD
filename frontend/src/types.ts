export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  total_seats: number;
  available_seats: number;
  price: number;
  vip_price: number;
  currency: 'INR';
  seat_layout: SeatLayout;
  date: string;
}

export interface SeatLayout {
  name: string;
  columns: number;
  vip_rows: number[];
  blocked_rows: number[];
  aisle_after_columns: number[];
}

export type SeatStatus = 'available' | 'held' | 'booked' | 'blocked';
export type SeatType = 'standard' | 'vip';

export interface SeatInfo {
  seat_number: number;
  status: SeatStatus;
  mine?: boolean;
  booking_id?: string;
  row_number: number;
  row_label: string;
  seat_in_row: number;
  seat_type: SeatType;
  price: number;
  currency: 'INR';
}

export interface HoldRecord {
  booking_id: string;
  hold_token: string;
  seat_number: number;
  event_id: string;
  expires_at: number;
  row_label?: string;
  seat_type?: SeatType;
  price?: number;
}

export interface TrafficHit {
  servedBy: string;
  ms: number;
  path: string;
  at: number;
  ok: boolean;
}
