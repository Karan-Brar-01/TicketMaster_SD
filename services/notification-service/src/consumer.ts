import amqp, { Channel, ConsumeMessage } from 'amqplib';
import {
  BookingConfirmedEvent,
  simulateEmail,
  simulatePdfTicket,
} from './worker';

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || 'amqp://ticketmaster:ticketmaster@rabbitmq:5672';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'booking_events';
const ROUTING_KEY = process.env.RABBITMQ_ROUTING_KEY || 'booking.confirmed';
const QUEUE = process.env.RABBITMQ_QUEUE || 'booking.confirmed';

async function handleMessage(msg: ConsumeMessage | null, channel: Channel): Promise<void> {
  if (!msg) return;

  try {
    const event = JSON.parse(msg.content.toString()) as BookingConfirmedEvent;
    console.log('[consumer] received booking.confirmed', event);

    await simulatePdfTicket(event);
    await simulateEmail(event);

    channel.ack(msg);
  } catch (err) {
    console.error('[consumer] failed to process message', err);
    channel.nack(msg, false, false);
  }
}

export async function startConsumer(): Promise<void> {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await channel.prefetch(1);

  console.log(
    `[consumer] listening on queue="${QUEUE}" exchange="${EXCHANGE}" key="${ROUTING_KEY}"`
  );

  await channel.consume(QUEUE, (msg) => {
    void handleMessage(msg, channel);
  });

  connection.on('error', (err) => {
    console.error('[rabbitmq] connection error', err);
  });
  connection.on('close', () => {
    console.error('[rabbitmq] connection closed — exiting');
    process.exit(1);
  });
}
