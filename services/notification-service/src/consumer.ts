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
const RETRY_EXCHANGE =
  process.env.RABBITMQ_RETRY_EXCHANGE || 'booking_events.retry';
const RETRY_QUEUE = process.env.RABBITMQ_RETRY_QUEUE || 'booking.confirmed.retry';
const DEAD_LETTER_EXCHANGE =
  process.env.RABBITMQ_DEAD_LETTER_EXCHANGE || 'booking_events.dead';
const DEAD_LETTER_QUEUE =
  process.env.RABBITMQ_DEAD_LETTER_QUEUE || 'booking.confirmed.dead';
const DEAD_LETTER_KEY =
  process.env.RABBITMQ_DEAD_LETTER_KEY || 'booking.confirmed.dead';
const RETRY_DELAY_MS = Number(process.env.RABBITMQ_RETRY_DELAY_MS) || 5_000;
const MAX_RETRIES = Number(process.env.RABBITMQ_MAX_RETRIES) || 3;

function retryCount(msg: ConsumeMessage): number {
  const deaths = msg.properties.headers?.['x-death'];
  if (!Array.isArray(deaths)) return 0;

  const mainQueueDeath = deaths.find(
    (death) => death && typeof death === 'object' && death.queue === QUEUE
  );
  return typeof mainQueueDeath?.count === 'number' ? mainQueueDeath.count : 0;
}

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
    const attempts = retryCount(msg);

    if (attempts >= MAX_RETRIES) {
      channel.publish(DEAD_LETTER_EXCHANGE, DEAD_LETTER_KEY, msg.content, {
        contentType: msg.properties.contentType || 'application/json',
        persistent: true,
        headers: {
          ...msg.properties.headers,
          'x-final-failure': err instanceof Error ? err.message : 'unknown error',
        },
      });
      channel.ack(msg);
      console.error(
        `[consumer] moved message to dead-letter queue after ${attempts} retries`
      );
      return;
    }

    // The main queue dead-letters to the retry queue. Its TTL then routes the
    // message back through the booking exchange for another bounded attempt.
    channel.nack(msg, false, false);
  }
}

export async function startConsumer(): Promise<void> {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', {
    durable: true,
  });

  await channel.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-message-ttl': RETRY_DELAY_MS,
      'x-dead-letter-exchange': EXCHANGE,
      'x-dead-letter-routing-key': ROUTING_KEY,
    },
  });
  await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, ROUTING_KEY);

  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_LETTER_QUEUE,
    DEAD_LETTER_EXCHANGE,
    DEAD_LETTER_KEY
  );

  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': RETRY_EXCHANGE,
      'x-dead-letter-routing-key': ROUTING_KEY,
    },
  });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  await channel.prefetch(1);

  console.log(
    `[consumer] listening on queue="${QUEUE}" exchange="${EXCHANGE}" ` +
      `key="${ROUTING_KEY}" retries=${MAX_RETRIES}`
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
