import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Home, MessageCircle } from 'lucide-react';
import type { Booking, Room, Settings } from '../types';
import { si, dateTimeSi } from '../i18n/si';
import { rupeesSi } from '../lib/money';
import { balanceDue, bookingTotal, paidTotal } from '../lib/booking';
import { confirmationMessage, whatsappLink } from '../lib/whatsapp';
import { formatLkPhone } from '../lib/phone';
import { BigButton } from '../components/ui';
import { SummaryRow } from './parts';

export const WhatsAppButton = ({ booking, room, settings }: { booking: Booking; room: Room; settings: Settings }) => {
  const link = whatsappLink(booking.guest_phone, confirmationMessage(booking, room, settings.property_name, settings.property_phone));
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="si flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-5 text-2xl font-bold text-white shadow-md active:scale-[0.98] active:bg-[#1da851]"
    >
      <MessageCircle className="size-8" aria-hidden />
      <span>{si.actions.whatsapp}</span>
    </a>
  );
};

export const BookingSaved = ({ booking, room, settings }: { booking: Booking; room: Room; settings: Settings }) => {
  const navigate = useNavigate();
  return (
    <div className="space-y-4 p-4 pb-10">
      <div className="si flex flex-col items-center rounded-3xl bg-green-600 p-6 text-center text-white shadow-lg">
        <CheckCircle2 className="size-20" aria-hidden />
        <h1 className="mt-2 text-4xl font-extrabold">{si.success.title}</h1>
        <p className="text-xl">{si.success.subtitle}</p>
      </div>

      <WhatsAppButton booking={booking} room={room} settings={settings} />

      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <SummaryRow label="කාමරය" value={room.name_si} strong />
        <SummaryRow label={si.form.type} value={si.bookingType[booking.booking_type]} />
        <SummaryRow label={si.form.from} value={dateTimeSi(new Date(booking.check_in_time))} />
        <SummaryRow label={si.form.to} value={dateTimeSi(new Date(booking.check_out_time))} />
        <SummaryRow label={si.form.phone} value={formatLkPhone(booking.guest_phone)} />
        {booking.guest_name && <SummaryRow label="නම" value={booking.guest_name} />}
        <hr className="my-2" />
        <SummaryRow label={si.form.total} value={rupeesSi(bookingTotal(booking))} />
        <SummaryRow label={si.form.advance} value={rupeesSi(paidTotal(booking))} tone="green" />
        <SummaryRow label={si.form.balance} value={rupeesSi(balanceDue(booking))} strong tone={balanceDue(booking) > 0 ? 'red' : 'green'} />
      </div>

      <BigButton tone="neutral" icon={<Home className="size-7" aria-hidden />} onClick={() => navigate('/caretaker', { replace: true })}>
        {si.actions.home}
      </BigButton>
    </div>
  );
};
