import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { WifiOff, Loader2 } from 'lucide-react';
import { si } from '../i18n/si';
import { dateTimeSi } from '../i18n/si';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

type Tone = 'primary' | 'green' | 'red' | 'orange' | 'blue' | 'neutral' | 'whatsapp' | 'ghost';

const tones: Record<Tone, string> = {
  primary: 'bg-teal-700 text-white active:bg-teal-800 shadow-md',
  green: 'bg-green-600 text-white active:bg-green-700 shadow-md',
  red: 'bg-red-600 text-white active:bg-red-700 shadow-md',
  orange: 'bg-orange-500 text-white active:bg-orange-600 shadow-md',
  blue: 'bg-blue-600 text-white active:bg-blue-700 shadow-md',
  neutral: 'bg-white text-slate-900 border-2 border-slate-300 active:bg-slate-100',
  whatsapp: 'bg-[#25D366] text-white active:bg-[#1da851] shadow-md',
  ghost: 'bg-transparent text-slate-700 active:bg-slate-200',
};

type BigButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  icon?: ReactNode;
  size?: 'lg' | 'xl' | 'md';
  busy?: boolean;
};

/** Minimum 56px tall, label always visible next to the icon. */
export const BigButton = ({ tone = 'primary', icon, size = 'lg', busy, className, children, disabled, ...rest }: BigButtonProps) => (
  <button
    type="button"
    {...rest}
    disabled={disabled || busy}
    className={cx(
      'si flex w-full items-center justify-center gap-3 rounded-2xl font-bold transition-transform active:scale-[0.98]',
      'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
      size === 'xl' && 'min-h-20 px-5 text-2xl',
      size === 'lg' && 'min-h-16 px-4 text-xl',
      size === 'md' && 'min-h-14 px-4 text-lg',
      tones[tone],
      className,
    )}
  >
    {busy ? <Loader2 className="size-7 animate-spin" aria-hidden /> : icon}
    <span>{children}</span>
  </button>
);

/** Large toggle chip used for presets (booking type, room, amounts). */
export const Choice = ({
  selected, onClick, children, disabled, className, tone = 'teal',
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  tone?: 'teal' | 'orange';
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={selected}
    className={cx(
      'si min-h-16 rounded-2xl border-[3px] px-3 py-2 text-left font-semibold transition-transform active:scale-[0.97]',
      'disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
      selected && tone === 'teal' && 'border-teal-700 bg-teal-50 text-teal-900 ring-2 ring-teal-700/30',
      selected && tone === 'orange' && 'border-orange-500 bg-orange-50 text-orange-900 ring-2 ring-orange-500/30',
      !selected && 'border-slate-300 bg-white text-slate-800',
      className,
    )}
  >
    {children}
  </button>
);

export const Section = ({ title, children, step }: { title: string; children: ReactNode; step?: number }) => (
  <section className="rounded-3xl bg-white p-4 shadow-sm">
    <h2 className="si mb-3 flex items-center gap-2 text-xl font-bold text-slate-800">
      {step !== undefined && (
        <span className="flex size-8 items-center justify-center rounded-full bg-teal-700 text-base text-white">{step}</span>
      )}
      {title}
    </h2>
    {children}
  </section>
);

export const OfflineBanner = ({ lastSync }: { lastSync: string | null }) => (
  <div role="alert" className="si sticky top-0 z-40 bg-red-700 px-4 py-3 text-white shadow-lg">
    <div className="flex items-center gap-3 text-lg font-bold">
      <WifiOff className="size-7 shrink-0" aria-hidden />
      <span>{si.offline}</span>
    </div>
    {lastSync && (
      <p className="mt-1 text-sm opacity-90">
        {si.offlineSaved}: {dateTimeSi(new Date(lastSync))}
      </p>
    )}
  </div>
);

export const Spinner = ({ label }: { label?: string }) => (
  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
    <Loader2 className="size-10 animate-spin" aria-hidden />
    {label && <p className="si text-lg">{label}</p>}
  </div>
);

/** Full-screen modal; focus moves into it and Escape closes it. */
export const Dialog = ({ open, onClose, children, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl outline-none safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export const ErrorNote = ({ children }: { children: ReactNode }) =>
  children ? (
    <p role="alert" className="si rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-lg font-semibold text-red-800">
      {children}
    </p>
  ) : null;
