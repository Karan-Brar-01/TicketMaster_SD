import fs from 'fs/promises';
import path from 'path';

export interface BookingConfirmedEvent {
  booking_id: string;
  user_id: string;
  event_id: string;
  seat_number: number;
  status: string;
  confirmed_at: string;
}

const TICKETS_DIR = process.env.TICKETS_DIR || '/tickets';

export async function simulateEmail(event: BookingConfirmedEvent): Promise<void> {
  console.log(
    `[email] To user=${event.user_id} | Subject: Your tickets are confirmed` +
      ` | booking=${event.booking_id} event=${event.event_id} seat=${event.seat_number}`
  );
}

export async function simulatePdfTicket(
  event: BookingConfirmedEvent
): Promise<string> {
  await fs.mkdir(TICKETS_DIR, { recursive: true });
  const filename = `ticket-${event.booking_id}.pdf`;
  const filepath = path.join(TICKETS_DIR, filename);

  // Simulated PDF contents (plain text stand-in for a real PDF generator)
  const content = [
    '%PDF-1.4 SIMULATED',
    `Ticket for booking ${event.booking_id}`,
    `User: ${event.user_id}`,
    `Event: ${event.event_id}`,
    `Seat: ${event.seat_number}`,
    `Confirmed at: ${event.confirmed_at}`,
    '%%EOF',
  ].join('\n');

  await fs.writeFile(filepath, content, 'utf8');
  console.log(`[pdf] Generated simulated ticket → ${filepath}`);
  return filepath;
}
