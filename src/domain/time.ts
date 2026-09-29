/**
 * Waktu & zona waktu.
 *
 * Semua waktu disimpan sebagai ISO-8601 UTC (timestamptz di Postgres).
 * Zona waktu toko dipakai HANYA saat menampilkan dan saat menentukan batas hari
 * — karena nomor antrian dan laporan harian direset per hari kalender lokal,
 * bukan per hari UTC.
 *
 * Aplikasi aslinya menyimpan `created_at` sebagai string "YYYY-MM-DD HH:MM:SS"
 * tanpa keterangan zona waktu, lalu membandingkan string itu untuk filter
 * tanggal. Itu rapuh: order pukul 23:30 WIB tercatat sebagai tanggal UTC
 * berikutnya, sehingga masuk ke laporan hari yang salah.
 */

/** Zona waktu default toko (WIB). */
export const DEFAULT_TZ = 'Asia/Jakarta';

/** ISO-8601 UTC saat ini. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Kunci tanggal lokal toko: "2026-09-28".
 * Memakai locale en-CA yang formatnya persis YYYY-MM-DD.
 */
export function dateKey(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** "28/09/2026" */
export function formatDateShort(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** "28 September 2026" */
export function formatDateLong(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** "14:35" */
export function formatTime(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "14:35:07" — untuk log dan struk. */
export function formatTimeLong(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/** "28 Sep 2026, 14:35" */
export function formatDateTime(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Awal hari (00:00:00.000) di zona waktu toko, dikembalikan sebagai ISO UTC.
 *
 * Caranya: cari tahu offset zona pada tanggal itu dengan memformat balik,
 * lalu susun ulang. Ini menghindari asumsi offset tetap — WIB memang selalu
 * +07:00 tanpa DST, tapi fungsi ini tetap benar untuk zona lain.
 */
export function startOfDay(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const [y, m, day] = dateKey(d, tz).split('-').map(Number) as [number, number, number];
  return zonedMidnightToIso(y, m, day, tz);
}

/** Akhir hari (23:59:59.999) di zona waktu toko, sebagai ISO UTC. */
export function endOfDay(at: Date | string, tz: string = DEFAULT_TZ): string {
  const start = new Date(startOfDay(at, tz));
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return new Date(next.getTime() - 1).toISOString();
}

/** Rentang hari ini dalam ISO UTC — dipakai filter laporan. */
export function todayRange(tz: string = DEFAULT_TZ): { from: string; to: string } {
  const now = new Date();
  return { from: startOfDay(now, tz), to: endOfDay(now, tz) };
}

/** Rentang N hari terakhir (termasuk hari ini). */
export function lastNDaysRange(days: number, tz: string = DEFAULT_TZ): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: startOfDay(start, tz), to: endOfDay(now, tz) };
}

/** Rentang bulan berjalan. */
export function monthRange(tz: string = DEFAULT_TZ): { from: string; to: string } {
  const now = new Date();
  const key = dateKey(now, tz);
  const [y, m] = key.split('-').map(Number) as [number, number];
  const first = zonedMidnightToIso(y, m, 1, tz);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: first, to: endOfDay(zonedMidnightToIso(y, m, lastDay, tz), tz) };
}

/** Rentang tahun berjalan. */
export function yearRange(tz: string = DEFAULT_TZ): { from: string; to: string } {
  const now = new Date();
  const y = Number(dateKey(now, tz).slice(0, 4));
  return { from: zonedMidnightToIso(y, 1, 1, tz), to: endOfDay(zonedMidnightToIso(y, 12, 31, tz), tz) };
}

/** Selisih hari kalender lokal antara dua waktu. */
export function daysBetween(a: Date | string, b: Date | string, tz: string = DEFAULT_TZ): number {
  const ka = dateKey(a, tz);
  const kb = dateKey(b, tz);
  const ta = Date.parse(`${ka}T00:00:00Z`);
  const tb = Date.parse(`${kb}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** Sisa waktu dalam bentuk "2h 15m" — untuk countdown. */
export function humanizeDuration(msRemaining: number): string {
  if (msRemaining <= 0) return '0m';
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((msRemaining % 60_000) / 1000);
  if (totalMinutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/* ==========================================================================
   Internal
   ========================================================================= */

/**
 * Ubah "jam 00:00 di zona tz pada tanggal y-m-d" menjadi ISO UTC.
 * Offset dicari dengan memformat balik lewat Intl, bukan dengan mengasumsikan
 * offset tetap.
 */
function zonedMidnightToIso(y: number, m: number, day: number, tz: string): string {
  const guess = Date.UTC(y, m - 1, day, 0, 0, 0, 0);
  // Format ulang tebakan itu di zona toko untuk melihat offset sebenarnya.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess));

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asLocal = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  const offset = asLocal - guess;
  return new Date(guess - offset).toISOString();
}
