/**
 * Set ikon internal.
 *
 * Menggantikan Font Awesome 6.4.2 yang diambil dari CDN di aplikasi aslinya.
 * Alasan penggantian:
 *
 *  - **Berat.** Font Awesome menarik ~1 file CSS + beberapa file font untuk
 *    memakai belasan ikon saja.
 *  - **Ketergantungan jaringan.** Kalau CDN diblokir atau mati, ikon hilang
 *    dan tampilan rusak. Aplikasi kasir harus jalan di jaringan apa pun.
 *  - **Lisensi.** Font Awesome Free punya batasan; set internal ini bebas.
 *
 * Semua ikon memakai grid 24×24, garis (bukan isi), `stroke: currentColor`,
 * jadi warnanya otomatis ikut teks dan ukurannya bisa diatur lewat `size`.
 */

import type { JSX } from 'preact';

export type IconName =
  // kategori
  | 'coffee'
  | 'cup'
  | 'bowl'
  | 'cookie'
  | 'ice-cream'
  | 'utensils'
  // navigasi & umum
  | 'menu'
  | 'x'
  | 'check'
  | 'plus'
  | 'minus'
  | 'search'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-right'
  | 'arrow-left'
  | 'refresh'
  | 'maximize'
  | 'minimize'
  | 'more'
  | 'filter'
  | 'calendar'
  | 'clock'
  // transaksi
  | 'cart'
  | 'receipt'
  | 'printer'
  | 'trash'
  | 'tag'
  | 'percent'
  | 'wallet'
  | 'banknote'
  | 'credit-card'
  | 'qr'
  | 'split'
  // status & sistem
  | 'bell'
  | 'volume'
  | 'volume-off'
  | 'wifi'
  | 'wifi-off'
  | 'alert'
  | 'info'
  | 'chart'
  | 'settings'
  | 'table'
  | 'kitchen'
  | 'store'
  | 'user'
  | 'lock'
  | 'logout'
  | 'eye'
  | 'eye-off'
  | 'loader'
  | 'inbox'
  | 'flame'
  | 'sparkles'
  | 'box'
  | 'download'
  | 'cloud-off';

const PATHS: Record<IconName, string> = {
  coffee:
    'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z M6 2v2 M10 2v2 M14 2v2',
  cup: 'M6 3h12l-1.2 15.2A2 2 0 0 1 14.8 20H9.2a2 2 0 0 1-2-1.8Z M6.4 8h11.2',
  bowl: 'M3 11h18a9 9 0 0 1-18 0Z M7 7c0-1.5 1-2 1-3.5 M12 7c0-1.5 1-2 1-3.5 M17 7c0-1.5 1-2 1-3.5',
  cookie: 'M21 12a9 9 0 1 1-9-9 4 4 0 0 0 5 5 4 4 0 0 0 4 4Z M9 10h.01 M15 15h.01 M10 16h.01 M14 9h.01',
  'ice-cream': 'M8 10a4 4 0 0 1 8 0Z M8 10h8l-3 10a1 1 0 0 1-2 0Z M7 10a5 5 0 0 1 10 0',
  utensils: 'M4 3v7a2 2 0 0 0 4 0V3 M6 12v9 M15 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6Z M15 12v9',

  menu: 'M4 6h16 M4 12h16 M4 18h16',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-right': 'M5 12h14 M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5 M11 6l-6 6 6 6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M16 21h3a2 2 0 0 0 2-2v-3 M8 21H5a2 2 0 0 1-2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3 M16 3v3a2 2 0 0 0 2 2h3 M16 21v-3a2 2 0 0 1 2-2h3 M8 21v-3a2 2 0 0 0-2-2H3',
  more: 'M12 6h.01 M12 12h.01 M12 18h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8Z',
  calendar: 'M4 6h16v14H4Z M8 3v4 M16 3v4 M4 11h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',

  cart: 'M3 4h2l2.5 11h10L20 7H6 M9 20h.01 M17 20h.01',
  receipt: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z M9 8h6 M9 12h6',
  printer: 'M7 9V3h10v6 M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M7 15h10v6H7Z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
  tag: 'M3 12V4h8l9 9-8 8Z M7.5 8h.01',
  percent: 'M19 5L5 19 M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M16.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M3 7V6a2 2 0 0 1 2-2h11 M17 13h.01',
  banknote: 'M2 7h20v10H2Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M6 10v4 M18 10v4',
  'credit-card': 'M2 6h20v12H2Z M2 10h20 M6 15h3',
  qr: 'M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h2v2h-2Z M18 14h2v2h-2Z M14 18h2v2h-2Z M18 18h2v2h-2Z',
  split: 'M12 3v6 M12 9 6 15v6 M12 9l6 6v6 M3 21h6 M15 21h6',

  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z M10 20a2 2 0 0 0 4 0',
  volume: 'M11 5 6 9H3v6h3l5 4Z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12',
  'volume-off': 'M11 5 6 9H3v6h3l5 4Z M17 9l4 6 M21 9l-4 6',
  wifi: 'M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 20h.01',
  'wifi-off': 'M3 3l18 18 M8.5 16a5 5 0 0 1 7 0 M12 20h.01 M5 12.5a10 10 0 0 1 3-2.2 M19 12.5a10 10 0 0 0-2.6-2',
  alert: 'M12 3 2 20h20Z M12 9v5 M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 8h.01',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.4a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  table: 'M3 10h18 M5 10v10 M19 10v10 M3 6h18v4H3Z',
  kitchen: 'M6 3v8a3 3 0 0 0 6 0V3 M9 11v10 M18 3c-1.5 0-2.5 2-2.5 5s1 3 2.5 3 2.5 0 2.5-3-1-5-2.5-5Z M18 11v10',
  store: 'M3 9l2-5h14l2 5 M3 9h18v11H3Z M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 M10 20v-5h4v5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
  lock: 'M6 11h12v10H6Z M9 11V7a3 3 0 0 1 6 0v4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M3 3l18 18 M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2 M6.7 6.7C4 8.3 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.3-.9 M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.2',
  loader: 'M12 3v4 M12 17v4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M3 12h4 M17 12h4 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  inbox: 'M3 12h5l2 3h4l2-3h5 M3 12 5.5 5h13L21 12v7H3Z',
  flame: 'M12 22c4 0 6-2.7 6-6 0-4-3-6-3-9 0 0-1.5 1.5-1.5 3.5C13.5 8 12 6 12 3c0 0-6 4.5-6 10 0 3.3 2 6 6 6Z',
  sparkles: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4Z M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7Z',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z M3 7.5 12 12l9-4.5 M12 12v9',
  download: 'M12 3v12 M7.5 10.5 12 15l4.5-4.5 M4 20h16',
  'cloud-off':
    'M4 4l16 16 M18 17H7.5A4.5 4.5 0 0 1 7 8.05 M9.7 5.6A5 5 0 0 1 18.9 9.4 3.6 3.6 0 0 1 20 16.3',
};

export interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
  /** Ketebalan garis. Ikon besar terlihat lebih baik dengan garis tipis. */
  strokeWidth?: number;
}

export function Icon({ name, size = 20, class: cls, strokeWidth = 1.9 }: IconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Ikon yang bisa dipakai sebagai ikon kategori (dipetakan dari nama bebas). */
export const CATEGORY_ICON_CHOICES: readonly IconName[] = [
  'coffee',
  'cup',
  'bowl',
  'cookie',
  'ice-cream',
  'utensils',
  'flame',
  'sparkles',
] as const;

/**
 * Nama ikon apa pun yang tidak dikenal akan jatuh ke 'utensils'.
 * Kategori buatan pengguna bisa memakai nama bebas, jadi tidak boleh error.
 */
export function toIconName(raw: string | null | undefined): IconName {
  if (!raw) return 'utensils';
  return raw in PATHS ? (raw as IconName) : 'utensils';
}
