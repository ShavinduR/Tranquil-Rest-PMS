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
    extend: 'කාලය දීර්ඝ කරන්න',
    move: 'කාමරය මාරු කරන්න',
    notes: 'සටහනක් ලියන්න',
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
    cash: 'මුදල්',
    bank: 'බැංකුවට',
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
    phoneForeign: 'විදේශ අංක + ලකුණ සමග (උදා: +44 7911 123456)',
    phoneInvalid: 'නිවැරදි දුරකථන අංකයක් ඇතුළත් කරන්න. විදේශ අංකයක් නම් + ලකුණෙන් පටන් ගන්න.',
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
    closedToday: 'අදට කාලය අවසන්',
    closedHint: 'මෙම කාලය අද සඳහා අවසන් වෙමින් පවතී. කෙටි කාලය හෝ ඉදිරි දිනයක් තෝරන්න.',
    pastStart: 'ආරම්භක වේලාව දැනටමත් ගතවී ඇත. වේලාව වෙනස් කරන්න.',
    showAddons: '+ කෑම / බීම එකතු කරන්න',
    hideAddons: 'කෑම / බීම වසන්න',
    addonsChosen: 'තෝරාගත් කෑම / බීම',
    priceConfirmTitle: 'කාමර ගාස්තුව වෙනස් කරන්නද?',
    priceConfirmBody: 'සාමාන්‍ය ගාස්තුව වෙනස් කරන්නේ අයිතිකරු අනුමත කළොත් පමණි. මෙම වෙනස් කිරීම වාර්තාවේ සටහන් වේ.',
    priceConfirmYes: 'ඔව්, වෙනස් කරන්න',
    priceChanged: 'වෙනස් කළ ගාස්තුව',
  },
  success: {
    title: 'සුරැකුවා!',
    subtitle: 'වෙන්කිරීම සාර්ථකයි',
  },
  home: {
    cashTitle: 'අද අතේ තිබිය යුතු මුදල',
    cashHint: 'අද ලැබුණු මුදල් (බැංකු ගෙවීම් හැර, ආපසු දුන් මුදල් අඩු කර)',
    availability: 'දිනය අනුව කාමර බලන්න',
    noUpcoming: 'අද සහ හෙට වෙන්කිරීම් නැත',
    overdue: 'පිටවීමේ වේලාව පසුවී ඇත',
    notArrived: 'තවම පැමිණ නැත',
    until: 'දක්වා',
    next: 'ඊළඟ',
  },
  offline: 'අන්තර්ජාල සම්බන්ධතාවය නැත - දත්ත සුරැකිය නොහැක',
  offlineSaved: 'අවසන් වරට යාවත්කාලීන කළේ',
  error: 'දෝෂයක් ඇති විය. නැවත උත්සාහ කරන්න.',
  dbUpdate: 'මෙම කාර්යය සඳහා පද්ධතිය යාවත්කාලීන කළ යුතුය. අයිතිකරුට දන්වන්න.',
  networkError: 'අන්තර්ජාලය නැති නිසා සුරැකීමට නොහැකි විය. නැවත උත්සාහ කරන්න.',
  conflictError: 'මේ වේලාවට කාමරය දැනටමත් වෙන්කර ඇත.',
  pastError: 'ගතවී ගිය වේලාවකට වෙන්කිරීමක් කළ නොහැක.',
  pin: {
    title: 'ඔබගේ PIN අංකය ඇතුළත් කරන්න',
    wrong: 'PIN අංකය වැරදියි',
    locked: 'බොහෝ වාර ගණනක් වැරදියි. ටික වේලාවකින් නැවත උත්සාහ කරන්න.',
    lockedFor: (s: number) => `බොහෝ වාර ගණනක් වැරදියි. තත්පර ${s}කින් නැවත උත්සාහ කරන්න.`,
    demo: 'ආදර්ශ PIN අංකය: 1234',
    clear: 'මකන්න',
    offlineFirst: 'පළමු වරට අන්තර්ජාලය අවශ්‍යයි',
    signOut: 'මෙම දුරකථනයෙන් ඉවත් වන්න',
    signOutTitle: 'මෙම දුරකථනයෙන් ඉවත් වෙනවාද?',
    signOutBody: 'නැවත ඇතුළු වීමට අයිතිකරුගේ ඊමේල් ලිපිනය සහ මුරපදය අවශ්‍ය වේ.',
    signOutConfirm: 'ඔව්, ඉවත් වන්න',
    signOutCancel: 'නැහැ, ආපසු',
  },
  cancelDialog: {
    title: 'මෙම වෙන්කිරීම අවලංගු කරන්නද?',
    body: 'අවලංගු කළ පසු කාමරය නැවත නිදහස් වේ.',
    reason: 'හේතුව (අවශ්‍ය නම්)',
    paid: 'දැනටමත් ලැබී ඇති මුදල',
    keep: 'අත්තිකාරම ආපසු නොදේ',
    refund: 'මුදල් ආපසු දෙන්න',
    refundAmount: 'ආපසු දෙන මුදල',
    refundMethod: 'ආපසු දුන් ආකාරය',
  },
  extendDialog: {
    title: 'පිටවීමේ වේලාව දීර්ඝ කිරීම',
    now: 'දැනට පිටවීම',
    newEnd: 'නව පිටවීම',
    hours: (h: number) => `+ පැය ${h}`,
    extra: 'අමතර ගාස්තුව',
    extraHint: 'අමතර කාලය සඳහා ගාස්තුවක් නැත්නම් හිස්ව තබන්න',
  },
  moveDialog: {
    title: 'වෙනත් කාමරයකට මාරු කිරීම',
    current: 'දැනට',
  },
  notesDialog: {
    title: 'වෙන්කිරීමේ සටහන',
    placeholder: 'උදා: උදේ 9ට පමණ පැමිණේ',
  },
  refunded: 'ආපසු දුන් මුදල',
  availability: {
    title: 'දිනය අනුව කාමර',
    chooseDate: 'දිනය තෝරන්න',
    otherDay: 'වෙනත් දිනයක්',
    booked: 'වෙන්කර ඇත',
    occupied: 'පවතී',
    free: 'නිදහස්',
    allFree: 'මුළු දවසම නිදහස්',
    restFree: 'ඉතිරි දවසම නිදහස්',
    noneFree: 'නිදහස් කාලයක් නැත',
    someFree: 'නිදහස් කාල ඇත',
    fromPrev: 'පෙර දින සිට',
    intoNext: 'ඊළඟ දිනට',
    tapToBook: 'වෙන්කිරීමට ඔබන්න',
    cleaningNow: 'දැන් පිරිසිදු කරමින්',
    loading: 'පූරණය වෙමින්...',
    offlineNoData: 'අන්තර්ජාලය නැති නිසා මෙම දිනයේ තොරතුරු නැත.',
    closedRoom: 'මෙම කාමරය භාවිතයේ නැත',
  },
  noteLabel: 'සටහන',
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
