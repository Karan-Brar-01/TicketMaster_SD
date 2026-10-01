export interface SeatLayoutConfig {
  name: string;
  columns: number;
  vip_rows: number[];
  blocked_rows: number[];
  aisle_after_columns: number[];
}

export interface EventSeatConfig {
  id: string;
  total_seats: number;
  price: number;
  vip_price: number;
  currency: 'INR';
  seat_layout: SeatLayoutConfig;
}

export type EventCatalogReader = (eventId: string) => Promise<EventSeatConfig>;

export class EventCatalogError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export const getEventSeatConfig: EventCatalogReader = async (eventId) => {
  const baseUrl =
    process.env.EVENT_SERVICE_URL || 'http://event-service-1:3002/api/events';

  try {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`);
    if (response.status === 404) {
      throw new EventCatalogError('event not found', 404);
    }
    if (!response.ok) {
      throw new EventCatalogError('event catalog unavailable', 503);
    }
    const body = (await response.json()) as { event?: EventSeatConfig };
    if (!body.event?.seat_layout) {
      throw new EventCatalogError('event seating configuration unavailable', 503);
    }
    return body.event;
  } catch (err) {
    if (err instanceof EventCatalogError) throw err;
    throw new EventCatalogError('event catalog unavailable', 503);
  }
};
