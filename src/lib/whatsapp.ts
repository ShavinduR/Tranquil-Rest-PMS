import type { Booking, Room } from '../types';
import { bookingTotal, balanceDue, paidTotal } from './booking';
import { plain } from './money';
import { normalizeLkPhone } from './phone';
import { colomboParts } from './time';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (iso: string): string => {
  const p = colomboParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
};

/** Bilingual (Sinhala + English) so it works for local and foreign guests. */
export const confirmationMessage = (booking: Booking, room: Room, propertyName: string, propertyPhone?: string | null): string => {
  const lines = [
    `*${propertyName}*`,
    'වෙන්කිරීම තහවුරුයි / Booking Confirmed',
    '',
    booking.guest_name ? `නම / Name: ${booking.guest_name}` : null,
    `කාමරය / Room: ${room.name_si} (${room.name})`,
    `පැමිණීම / Check-in: ${stamp(booking.check_in_time)}`,
    `පිටවීම / Check-out: ${stamp(booking.check_out_time)}`,
    '',
    `මුළු මුදල / Total: Rs. ${plain(bookingTotal(booking))}`,
    `අත්තිකාරම / Advance Paid: Rs. ${plain(paidTotal(booking))}`,
    `ඉතිරි මුදල / Balance Due: Rs. ${plain(balanceDue(booking))}`,
    '',
    'ස්තූතියි! / Thank you!',
    propertyPhone ? `${propertyName} - ${propertyPhone}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
};

export const whatsappLink = (phone: string, message: string): string | null => {
  const normalized = normalizeLkPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};
