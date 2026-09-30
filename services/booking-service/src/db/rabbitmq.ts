import amqp, { Channel, ChannelModel } from 'amqplib';

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://ticketmaster:ticketmaster@rabbitmq:5672';
export const BOOKING_EXCHANGE =
  process.env.RABBITMQ_EXCHANGE || 'booking_events';
export const BOOKING_CONFIRMED_KEY =
  process.env.RABBITMQ_ROUTING_KEY || 'booking.confirmed';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function getPublisherChannel(): Promise<Channel> {
  if (channel) return channel;

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertExchange(BOOKING_EXCHANGE, 'topic', { durable: true });

  connection.on('close', () => {
    connection = null;
    channel = null;
  });
  connection.on('error', (err: Error) => {
    console.error('[rabbitmq] connection error', err);
  });

  return channel;
}

export interface BookingConfirmedMessage {
  booking_id: string;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: string;
  confirmed_at: string;
}

export async function publishBookingConfirmed(
  message: BookingConfirmedMessage
): Promise<void> {
  const ch = await getPublisherChannel();
  const body = Buffer.from(JSON.stringify(message));
  ch.publish(BOOKING_EXCHANGE, BOOKING_CONFIRMED_KEY, body, {
    contentType: 'application/json',
    persistent: true,
  });
}
