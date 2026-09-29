/**
 * Nomor antrian.
 *
 * Aturan yang berlaku (sama seperti aplikasi aslinya, tapi sekarang eksplisit
 * dan bisa diuji):
 *  - Nomor direset setiap hari kalender **waktu toko**, bukan waktu UTC.
 *  - Format: `<prefix>-<nomor>`, mis. "A-01".
 *  - Lebar digit melebar otomatis kalau order harian melewati batas padding,
 *    jadi tidak pernah terpotong.
 *
 * Reset harian ditentukan dengan membandingkan kunci tanggal, bukan dengan
 * menyimpan timer. Artinya kalau server sempat mati semalaman, nomor tetap
 * benar saat hidup lagi.
 */

import { dateKey, DEFAULT_TZ } from './time.ts';

export interface QueueState {
  prefix: string;
  /** Nomor terakhir yang sudah diberikan pada `dateKey`. */
  lastNumber: number;
  /** Tanggal (YYYY-MM-DD, zona toko) saat `lastNumber` berlaku. */
  dateKey: string;
}

export interface NextQueueResult {
  /** Nomor urut mentah, mis. 7. */
  number: number;
  /** Label siap tampil, mis. "A-07". */
  label: string;
  /** State baru yang harus disimpan. */
  state: QueueState;
  /** true bila reset harian terjadi pada panggilan ini. */
  didReset: boolean;
}

/** Lebar digit default. "A-01", bukan "A-1". */
export const DEFAULT_QUEUE_WIDTH = 2;

/**
 * 7 → "A-07". Lebar minimum 2 digit, tapi tidak pernah memotong angka
 * yang lebih panjang (order ke-100 jadi "A-100").
 */
export function formatQueueNumber(
  n: number,
  prefix = 'A',
  width = DEFAULT_QUEUE_WIDTH,
): string {
  const safe = Math.max(1, Math.floor(n));
  const digits = String(safe).padStart(width, '0');
  return prefix ? `${prefix}-${digits}` : digits;
}

/** "A-07" → { prefix: "A", number: 7 }. null bila tidak cocok. */
export function parseQueueNumber(label: string): { prefix: string; number: number } | null {
  const m = /^\s*([A-Za-z]*)\s*-?\s*(\d+)\s*$/.exec(label);
  if (!m) return null;
  const [, prefix = '', digits = ''] = m;
  const number = Number.parseInt(digits, 10);
  if (!Number.isFinite(number)) return null;
  return { prefix: prefix.toUpperCase(), number };
}

/** Apakah state ini sudah kedaluwarsa dan perlu direset? */
export function needsDailyReset(
  state: QueueState,
  today: string = dateKey(new Date(), DEFAULT_TZ),
): boolean {
  return state.dateKey !== today;
}

/** State awal untuk hari baru. */
export function freshQueue(
  prefix = 'A',
  today: string = dateKey(new Date(), DEFAULT_TZ),
): QueueState {
  return { prefix, lastNumber: 0, dateKey: today };
}

/**
 * Ambil nomor antrian berikutnya.
 *
 * Fungsi ini murni: dia menerima state lama dan mengembalikan state baru.
 * Pemanggil yang bertanggung jawab menyimpan hasilnya secara atomik —
 * itulah sebabnya penomoran dilakukan di server (atau di satu tempat terpusat),
 * bukan di masing-masing client seperti aplikasi aslinya.
 */
export function nextQueue(
  state: QueueState | null,
  today: string = dateKey(new Date(), DEFAULT_TZ),
  prefix?: string,
): NextQueueResult {
  const effectivePrefix = prefix ?? state?.prefix ?? 'A';
  const didReset = !state || needsDailyReset(state, today);
  const base = didReset
    ? freshQueue(effectivePrefix, today)
    : { ...state, prefix: effectivePrefix };

  const number = base.lastNumber + 1;
  return {
    number,
    label: formatQueueNumber(number, effectivePrefix),
    state: { prefix: effectivePrefix, lastNumber: number, dateKey: today },
    didReset,
  };
}

/**
 * Urutkan label antrian secara numerik, bukan leksikografis.
 * "A-2" harus datang sebelum "A-10" — perbandingan string biasa salah.
 */
export function compareQueueLabels(a: string | null, b: string | null): number {
  const pa = a ? parseQueueNumber(a) : null;
  const pb = b ? parseQueueNumber(b) : null;
  if (!pa && !pb) return 0;
  if (!pa) return 1; // yang belum punya nomor ditaruh di akhir
  if (!pb) return -1;
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  return pa.number - pb.number;
}
