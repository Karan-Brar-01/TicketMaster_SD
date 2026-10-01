export interface SeatLayout {
  name: string;
  columns: number;
  vip_rows: number[];
  blocked_rows: number[];
  aisle_after_columns: number[];
}

const GRAND_AUDITORIUM: SeatLayout = {
  name: 'Grand Auditorium',
  columns: 12,
  vip_rows: [1, 2],
  blocked_rows: [5],
  aisle_after_columns: [4, 8],
};

const CLASSIC_THEATRE: SeatLayout = {
  name: 'Classic Theatre',
  columns: 10,
  vip_rows: [1, 2],
  blocked_rows: [6],
  aisle_after_columns: [5],
};

export function seatLayoutForVenue(venue: string): SeatLayout {
  return venue === 'Prithvi Theatre' || venue === 'Convention Center Hall B'
    ? CLASSIC_THEATRE
    : GRAND_AUDITORIUM;
}
