/**
 * Komponen dasar.
 *
 * Prinsipnya: satu definisi per konsep, tanpa `!important`, dan setiap kontrol
 * yang bisa disentuh jari punya tinggi minimum 44px (lihat utilitas `tap` di
 * app.css). Aplikasi aslinya menulis 64 KB CSS dengan 103 `!important` karena
 * tidak ada lapisan komponen seperti ini.
 */

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { formatRupiah } from '../domain/money.ts';
import { statusLabel, statusTone, type StatusTone } from '../domain/orders.ts';
import type { OrderStatus } from '../domain/types.ts';
import { Icon, type IconName } from './icons.tsx';

/* ==========================================================================
   Tombol
   ========================================================================= */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  /* Warna tahap pesanan — dipakai layar dapur supaya aksi utama mengikuti
     warna kolomnya, bukan semuanya oranye. Putih di atas ketiga warna ini
     semuanya lolos AA (pending 6.84:1, processing 6.16:1, done 5.21:1). */
  | 'stage-baru'
  | 'stage-masak'
  | 'stage-siap'
  /* Tombol utama tema Fokus. Gradien hangat oranye→magenta, senada pendar
     aurora di latarnya. Dua ujungnya sengaja dipilih yang lebih gelap:
     putih di atas #FF8A5B — gradien prototipe aslinya — hanya 2,32:1 dan
     gagal telak, sedangkan #C2410C sudah 5,18:1. */
  | 'aurora';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  // Putih di atas brand-700 = 5.18:1 → lolos AA.
  // (Aslinya #ea580c, yang hanya 3.56:1 dan gagal.)
  primary:
    'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 ' +
    'shadow-[0_2px_8px_rgb(194_65_12/0.22)] hover:shadow-glow',
  secondary: 'bg-solid text-on-solid hover:opacity-90 active:opacity-80 shadow-card',
  outline:
    'border border-ink-300 bg-surface text-ink-800 hover:border-ink-400 hover:bg-ink-100 active:bg-ink-200',
  ghost: 'text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  danger: 'bg-cancelled text-on-cancelled hover:brightness-90 active:brightness-75 shadow-card',
  'stage-baru': 'bg-pending text-on-pending hover:brightness-110 active:brightness-95 shadow-card',
  'stage-masak': 'bg-processing text-on-processing hover:brightness-110 active:brightness-95 shadow-card',
  'stage-siap': 'bg-done text-on-done hover:brightness-110 active:brightness-95 shadow-card',
  aurora:
    'bg-gradient-to-br from-[#c2410c] to-[#be185d] text-white ' +
    'shadow-[0_10px_30px_-10px_rgb(190_24_93/0.6)] hover:brightness-110 active:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-sm',
  md: 'h-11 px-4 text-sm gap-2 rounded-md',
  lg: 'h-14 px-6 text-base gap-2.5 rounded-lg',
};

export interface ButtonProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'variant'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ComponentChildren;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  class: cls = '',
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      class={[
        'tap inline-flex items-center justify-center font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth ? 'w-full' : '',
        cls,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <Icon name="loader" size={size === 'lg' ? 20 : 16} class="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={size === 'lg' ? 20 : 16} />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'lg' ? 20 : 16} /> : null}
    </button>
  );
}

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  variant?: ButtonVariant;
}

export function IconButton({
  icon,
  label,
  size = 20,
  variant = 'ghost',
  class: cls = '',
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      class={['tap inline-flex items-center justify-center rounded-md p-2 transition', VARIANTS[variant], cls]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/* ==========================================================================
   Wadah
   ========================================================================= */

export function Card({
  children,
  class: cls = '',
  ...rest
}: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div {...rest} class={['card', cls].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ComponentChildren;
  action?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="text-sm font-bold tracking-wide text-ink-500 uppercase">{children}</h2>
      {action}
    </div>
  );
}

/* ==========================================================================
   Lencana status
   ========================================================================= */

/** Nada → kelas. Memakai token desain yang sudah diukur kontrasnya. */
const TONES: Record<StatusTone | 'neutral' | 'brand', string> = {
  pending: 'bg-pending-bg text-pending',
  processing: 'bg-processing-bg text-processing',
  ready: 'bg-ready-bg text-ready',
  done: 'bg-done-bg text-done',
  cancelled: 'bg-cancelled-bg text-cancelled',
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
};

export function Badge({
  tone = 'neutral',
  children,
  class: cls = '',
}: {
  tone?: StatusTone | 'neutral' | 'brand';
  children: ComponentChildren;
  class?: string;
}): JSX.Element {
  return (
    <span
      class={[
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap',
        TONES[tone],
        cls,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

/* ==========================================================================
   Angka uang
   ========================================================================= */

/**
 * Angka uang selalu memakai lebar digit tetap (`tabular-nums`), supaya kolom
 * nominal tidak bergoyang saat data diperbarui realtime — masalah yang sangat
 * terasa di daftar order yang berubah sendiri.
 */
export function Money({
  value,
  class: cls = '',
  size = 'md',
}: {
  value: number;
  class?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}): JSX.Element {
  const sizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg font-bold',
    xl: 'text-3xl font-extrabold',
  } as const;

  return <span class={['num', sizes[size], cls].filter(Boolean).join(' ')}>{formatRupiah(value)}</span>;
}

/* ==========================================================================
   Formulir
   ========================================================================= */

export function Field({
  label,
  hint,
  error,
  children,
  forId,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ComponentChildren;
  forId?: string;
}): JSX.Element {
  return (
    <div class="space-y-1.5">
      <label for={forId} class="block text-sm font-semibold text-ink-700">
        {label}
      </label>
      {children}
      {error ? (
        <p class="flex items-center gap-1 text-xs font-medium text-cancelled">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : hint ? (
        <p class="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_BASE =
  'w-full rounded-md border border-ink-300 bg-surface px-3 py-2.5 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 ' +
  'focus:outline-none disabled:bg-ink-100 disabled:text-ink-500';

export function Input({
  class: cls = '',
  ...rest
}: JSX.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...rest} class={[INPUT_BASE, 'tap', cls].filter(Boolean).join(' ')} />;
}

export function Textarea({
  class: cls = '',
  ...rest
}: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...rest} class={[INPUT_BASE, cls].filter(Boolean).join(' ')} />;
}

export function Select({
  class: cls = '',
  children,
  ...rest
}: JSX.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select {...rest} class={[INPUT_BASE, 'tap pr-8', cls].filter(Boolean).join(' ')}>
      {children}
    </select>
  );
}

/* ==========================================================================
   Keadaan
   ========================================================================= */

export function Spinner({ size = 20, class: cls = '' }: { size?: number; class?: string }): JSX.Element {
  return <Icon name="loader" size={size} class={['animate-spin text-ink-400', cls].join(' ')} />;
}

export function LoadingBlock({ label = 'Memuat…' }: { label?: string }): JSX.Element {
  return (
    <div class="flex items-center justify-center gap-3 py-16 text-sm text-ink-500">
      <Spinner size={22} />
      {label}
    </div>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Icon name={icon} size={26} />
      </div>
      <div>
        <p class="font-semibold text-ink-800">{title}</p>
        {description ? <p class="mt-1 max-w-sm text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-3 rounded-lg border border-cancelled/20 bg-cancelled-bg px-6 py-10 text-center">
      <Icon name="alert" size={26} class="text-cancelled" />
      <p class="max-w-sm text-sm font-medium text-cancelled">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" icon="refresh" onClick={onRetry}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Modal
   ========================================================================= */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** 'md' untuk dialog biasa, 'lg' untuk keranjang/kasir, 'full' untuk layar penuh. */
  size?: 'sm' | 'md' | 'lg' | 'full';
  closeOnBackdrop?: boolean;
}

const MODAL_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  full: 'max-w-[min(96vw,1200px)] h-[92vh]',
} as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape menutup modal — kebiasaan yang diharapkan operator kasir.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Kunci scroll latar selama modal terbuka.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      class="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        class={[
          'flex w-full flex-col overflow-hidden bg-surface shadow-xl outline-none',
          'rounded-t-xl sm:rounded-xl',
          MODAL_SIZES[size],
        ].join(' ')}
      >
        {title ? (
          <header class="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-4">
            <h2 class="text-base font-bold text-ink-900">{title}</h2>
            <IconButton icon="x" label="Tutup" onClick={onClose} />
          </header>
        ) : null}

        <div class="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer ? (
          <footer class="safe-b border-t border-ink-200 bg-ink-50 px-5 py-4">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/* ==========================================================================
   Bilah status koneksi
   ========================================================================= */

export function ConnectionPill({
  status,
  dark = false,
}: {
  status: 'connecting' | 'live' | 'polling' | 'offline';
  /** Di atas permukaan gelap: warna status dinaikkan supaya tetap terbaca. */
  dark?: boolean;
}): JSX.Element {
  const map = {
    live: { icon: 'wifi' as IconName, text: 'Realtime', cls: 'text-done', clsDark: 'text-emerald-400' },
    connecting: {
      icon: 'loader' as IconName,
      text: 'Menyambung',
      cls: 'text-pending',
      clsDark: 'text-amber-400',
    },
    polling: { icon: 'refresh' as IconName, text: 'Cadangan', cls: 'text-pending', clsDark: 'text-amber-400' },
    offline: {
      icon: 'wifi-off' as IconName,
      text: 'Terputus',
      cls: 'text-cancelled',
      clsDark: 'text-red-400',
    },
  } as const;
  const s = map[status];

  return (
    <span
      class={['inline-flex items-center gap-1.5 text-xs font-semibold', dark ? s.clsDark : s.cls].join(' ')}
      title={`Koneksi: ${s.text}`}
    >
      <Icon name={s.icon} size={14} class={status === 'connecting' ? 'animate-spin' : ''} />
      <span class={dark ? 'hidden xl:inline' : ''}>{s.text}</span>
    </span>
  );
}
