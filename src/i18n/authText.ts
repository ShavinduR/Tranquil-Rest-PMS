import { useState } from 'react';

/** Welcome + login screens are shared by owner and caretakers, so they offer both languages (Sinhala first). */
export type Lang = 'si' | 'en';
const KEY = 'tr-lang';

const text = {
  si: {
    subtitle: 'අමුත්තන් නිවාසය',
    caretakerDevice: 'සේවක දුරකථනය සකසන්න',
    ownerLogin: 'අයිතිකරු ඇතුළු වීම',
    demoTitle: 'ආදර්ශ ක්‍රමය',
    demoBody: 'සජීවී දත්ත ගබඩාවක් සම්බන්ධ කර නැත. දත්ත මෙම බ්‍රව්සරයේ පමණක් ගබඩා වේ.',
    demoReset: 'ආදර්ශ දත්ත මුල් තත්වයට',
    back: 'ආපසු',
    titleOwner: 'අයිතිකරු ඇතුළු වීම',
    titleCaretaker: 'සේවක දුරකථනය සකසන්න',
    caretakerHelp: 'අයිතිකරු මෙම දුරකථනයේ සේවක ගිණුමෙන් එක් වරක් ඇතුළු වේ. ඉන්පසු සේවකයා PIN අංකය පමණක් භාවිතා කරයි.',
    email: 'ඊමේල් ලිපිනය',
    password: 'මුරපදය',
    signIn: 'ඇතුළු වන්න',
    wrong: 'ඊමේල් ලිපිනය හෝ මුරපදය වැරදියි.',
    failed: 'ඇතුළු විය නොහැකි විය. අන්තර්ජාලය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
    switchTo: 'English',
  },
  en: {
    subtitle: 'Guest House',
    caretakerDevice: 'Set up caretaker phone',
    ownerLogin: 'Owner / Admin login',
    demoTitle: 'Demo mode',
    demoBody: 'No live database is connected, so data is stored only in this browser.',
    demoReset: 'Reset demo data',
    back: 'Back',
    titleOwner: 'Owner / Admin login',
    titleCaretaker: 'Set up caretaker phone',
    caretakerHelp: 'The owner signs in once with the caretaker account. After that the caretaker only uses their 4-digit PIN on this phone.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    wrong: 'Wrong email or password.',
    failed: 'Could not sign in. Check the connection and try again.',
    switchTo: 'සිංහල',
  },
} as const;

export const useAuthText = () => {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(KEY) === 'en' ? 'en' : 'si'));
  const toggle = () => {
    const next: Lang = lang === 'si' ? 'en' : 'si';
    localStorage.setItem(KEY, next);
    setLang(next);
  };
  return { lang, t: text[lang], toggle };
};
