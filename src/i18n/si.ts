import type { BookingStatus, BookingType, PaymentMethod } from '../types';
import { colomboParts, dateKey, addDaysKey } from '../lib/time';

/** Every caretaker-facing string lives here so wording can be tuned in one place. */
export const si = {
  appName: 'Tranquil Rest',
  status: {
    available: 'නිදහස්',
    occupied: 'අමුත්තන් ඇත',
    booked_today: 'අද වෙන්කර ඇත',
    cleaning: 'පිරිසිදු කරමින්',
  },
  actions: {
    walkIn: 'දැන් කාමරය දෙන්න',
    future: 'ඉදිරි දිනකට වෙන්කරන්න',
    save: 'සුරකින්න',
    saving: 'සුරකිමින්...',
    back: 'ආපසු',
    home: 'මුල් පිටුවට',
    checkIn: 'අමුත්තා පැමිණියා',
    checkOut: 'අමුත්තා පිටත්ව ගියා',
    markReady: 'පිරිසිදු කර අවසන් – නිදහස්',
    markCleaning: 'පිරිසිදු කිරීමට යොමු කරන්න',
    cancel: 'වෙන්කිරීම අවලංගු කරන්න',
    confirmCancel: 'ඔව්, අවලංගු කරන්න',
    keep: 'නැහැ, තබාගන්න',
    addFood: 'කෑම / බීම එකතු කරන්න',
    addPayment: 'මුදල් ලැබුණා',
    whatsapp: 'WhatsApp පණිවිඩයක් යවන්න',
    lock: 'අගුළු දමන්න',
    edit: 'වෙනස් කරන්න',
    done: 'හරි',
    call: 'අමතන්න',
  },
  bookingType: {
    short_time: 'කෙටි කාලය',
    day: 'දවල් කාලය',
    night: 'රාත්‍රී කාලය',
    full_day: 'මුළු දවස',
  } satisfies Record<BookingType, string>,
  bookingStatus: {
    booked: 'වෙන්කර ඇත',
    checked_in: 'කාමරයේ සිටී',
    checked_out: 'පිටත්ව ගොස් ඇත',
    cancelled: 'අවලංගුයි',
  } satisfies Record<BookingStatus, string>,
  method: {
    cash: 'මුදල් / Cash',
    bank: 'බැංකු / Bank',
  } satisfies Record<PaymentMethod, string>,
  form: {
    titleWalkIn: 'දැන් කාමරය දෙන්න',
    titleFuture: 'ඉදිරි දිනකට වෙන්කිරීම',
    date: 'දිනය',
    type: 'කාලය තෝරන්න',
    room: 'කාමරය තෝරන්න',
    time: 'වේලාව',
    from: 'පැමිණීම',
    to: 'පිටවීම',
    price: 'කාමර ගාස්තුව',
    editPrice: 'මිල වෙනස් කරන්න',
    phone: 'දුරකථන අංකය',
    phoneHint: 'උදා: 077 123 4567',
    phoneInvalid: 'නිවැරදි දුරකථන අංකයක් ඇතුළත් කරන්න',
    name: 'නම (අවශ්‍ය නම් පමණක්)',
    advance: 'අත්තිකාරම්',
    balance: 'ඉතිරි මුදල',
    total: 'මුළු මුදල',
    method: 'ගෙවීමේ ක්‍රමය',
    addons: 'කෑම / බීම',
    custom: 'වෙනත් මුදලක්',
    customLabel: 'විස්තරය',
    amount: 'මුදල',
    full: 'සම්පූර්ණ',
    none: 'නැත',
    notes: 'සටහන',
    taken: 'වෙන්කර ඇත',
    bufferWarn: 'පිරිසිදු කිරීමට කාලය අඩුයි',
    overlap: 'මේ වේලාවට කාමරය වෙන්කර ඇත. වෙනත් කාමරයක් හෝ වේලාවක් තෝරන්න.',
    bufferConfirm: 'පිරිසිදු කිරීමට ඇත්තේ විනාඩි කිහිපයක් පමණි. කෙසේ හෝ සුරකින්නද?',
    today: 'අද',
    tomorrow: 'හෙට',
    dayAfter: 'අනිද්දා',
    otherDay: 'වෙනත් දිනයක්',
    minus30: '− විනාඩි 30',
    plus30: '+ විනාඩි 30',
    missing: 'කරුණාකර කාලය, කාමරය සහ දුරකථන අංකය තෝරන්න',
  },
  success: {
    title: 'සුරැකුවා!',
    subtitle: 'වෙන්කිරීම සාර්ථකයි',
  },
  home: {
    cashTitle: 'අද අතේ තිබිය යුතු මුදල (Cash)',
    cashHint: 'අද ලැබුණු මුදල් (බැංකු ගෙවීම් හැර)',
    noUpcoming: 'අද සහ හෙට වෙන්කිරීම් නැත',
    overdue: 'පිටවීමේ වේලාව පසුවී ඇත',
    notArrived: 'තවම පැමිණ නැත',
    until: 'දක්වා',
    next: 'ඊළඟ',
  },
  offline: 'අන්තර්ජාල සම්බන්ධතාවය නැත - දත්ත සුරැකිය නොහැක',
  offlineSaved: 'අවසන් වරට යාවත්කාලීන කළේ',
  error: 'දෝෂයක් ඇති විය. නැවත උත්සාහ කරන්න.',
  networkError: 'අන්තර්ජාලය නැති නිසා සුරැකීමට නොහැකි විය. නැවත උත්සාහ කරන්න.',
  conflictError: 'මේ වේලාවට කාමරය දැනටමත් වෙන්කර ඇත.',
  pin: {
    title: 'ඔබගේ PIN අංකය ඇතුළත් කරන්න',
    wrong: 'PIN අංකය වැරදියි',
    locked: 'බොහෝ වාර ගණනක් වැරදියි. තත්පර 30ක් රැඳී සිටින්න.',
    clear: 'මකන්න',
    offlineFirst: 'පළමු වරට අන්තර්ජාලය අවශ්‍යයි',
  },
  cancelDialog: {
    title: 'මෙම වෙන්කිරීම අවලංගු කරන්නද?',
    body: 'අවලංගු කළ පසු කාමරය නැවත නිදහස් වේ. ලැබුණු අත්තිකාරම් මුදල් වාර්තාවේ පවතී.',
    reason: 'හේතුව (අවශ්‍ය නම්)',
  },
  checkoutDialog: {
    title: 'අමුත්තා පිටත්ව ගියාද?',
    balanceDue: 'තවම ලැබිය යුතු මුදල',
    collect: 'ඉතිරි මුදල ලැබුණා',
    skip: 'මුදල් පසුව',
  },
} as const;

const MONTHS = ['ජනවාරි', 'පෙබරවාරි', 'මාර්තු', 'අප්‍රේල්', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝස්තු', 'සැප්තැම්බර්', 'ඔක්තෝබර්', 'නොවැම්බර්', 'දෙසැම්බර්'];
const WEEKDAYS = ['ඉරිදා', 'සඳුදා', 'අඟහරුවාදා', 'බදාදා', 'බ්‍රහස්පතින්දා', 'සිකුරාදා', 'සෙනසුරාදා'];

/** Natural Sinhala time of day: 'උදේ 10:00', 'දවල් 1:30', 'හවස 5:00', 'රෑ 9:00' */
export const timeSi = (date: Date): string => {
  const { hour, minute } = colomboParts(date);
  const period = hour < 4 ? 'රෑ' : hour < 12 ? 'උදේ' : hour < 16 ? 'දවල්' : hour < 19 ? 'හවස' : 'රෑ';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${h12}:${String(minute).padStart(2, '0')}`;
};

/** 'අද', 'හෙට', or 'දෙසැම්බර් 3 (බදාදා)' */
export const daySi = (date: Date, now: Date = new Date()): string => {
  const key = dateKey(date);
  const today = dateKey(now);
  if (key === today) return si.form.today;
  if (key === addDaysKey(today, 1)) return si.form.tomorrow;
  if (key === addDaysKey(today, -1)) return 'ඊයේ';
  const p = colomboParts(date);
  return `${MONTHS[p.month - 1]} ${p.day} (${WEEKDAYS[p.weekday]})`;
};

export const dateTimeSi = (date: Date, now: Date = new Date()): string => `${daySi(date, now)} ${timeSi(date)}`;

export const fullDateSi = (date: Date): string => {
  const p = colomboParts(date);
  return `${p.year} ${MONTHS[p.month - 1]} ${p.day} (${WEEKDAYS[p.weekday]})`;
};

/** 'වෙන්කිරීම් 1ක්' / 'වෙන්කිරීම් 3ක්' */
export const countSi = (n: number): string => `වෙන්කිරීම් ${n}ක්`;
