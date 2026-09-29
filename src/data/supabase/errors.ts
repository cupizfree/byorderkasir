/**
 * Pemetaan galat server → `RepositoryError`.
 *
 * Dipisah dari `client.ts` supaya bisa diuji tanpa memuat SDK Supabase sama
 * sekali. Pemetaan ini bukan urusan sepele: dari sinilah antrean tulis luring
 * tahu apakah sebuah kegagalan layak dikirim ulang (`network`) atau memang
 * ditolak dan tidak akan berubah (`conflict`, `invalid`).
 *
 * Salah memetakan punya dua akibat yang sama-sama buruk:
 *  - kegagalan jaringan dianggap penolakan → tulisan kasir hilang diam-diam
 *  - penolakan dianggap kegagalan jaringan → antrean berputar selamanya
 */

import { RepositoryError, type RepositoryErrorCode } from '../repository.ts';

/**
 * PostgREST mengembalikan SQLSTATE di field `code`. Kode yang dipakai fungsi
 * di supabase/schema.sql:
 *
 *   28000  sesi tidak sah atau sudah kedaluwarsa   → unauthorized
 *   42501  peran tidak berhak                      → unauthorized
 *   P0002  data tidak ditemukan                    → not_found
 *   P0001  ditolak aturan bisnis (mis. stok)       → conflict
 *   23505  melanggar indeks unik                   → conflict
 *   23503  melanggar kunci asing                   → conflict
 *   22023  nilai masukan tidak sah                 → invalid
 *   23514  melanggar CHECK                         → invalid
 *   22P02  teks tidak bisa diubah ke tipe tujuan   → invalid
 */
const DARI_SQLSTATE: Record<string, RepositoryErrorCode> = {
  '28000': 'unauthorized',
  '42501': 'unauthorized',
  P0002: 'not_found',
  P0001: 'conflict',
  '23505': 'conflict',
  '23503': 'conflict',
  '22023': 'invalid',
  '23514': 'invalid',
  '22P02': 'invalid',
};

/** PostgREST memakai kode HTTP untuk galat yang bukan berasal dari SQLSTATE. */
const DARI_HTTP: Record<string, RepositoryErrorCode> = {
  '400': 'invalid',
  '401': 'unauthorized',
  '403': 'unauthorized',
  '404': 'not_found',
  '409': 'conflict',
  '429': 'network',
};

const POLA_JARINGAN = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;

export function toRepositoryError(err: unknown): RepositoryError {
  if (err instanceof RepositoryError) return err;

  // `fetch` yang tidak bisa menjangkau apa pun melempar TypeError. Ini juga
  // yang terjadi saat perangkat benar-benar luring.
  if (err instanceof TypeError) {
    return new RepositoryError('Tidak bisa menjangkau server', 'network');
  }

  const e = (err ?? {}) as { code?: string; message?: string; details?: string; hint?: string };
  const pesan = e.message || e.details || 'Galat tidak dikenal dari server';
  const kode = e.code ?? '';

  const hasil =
    DARI_SQLSTATE[kode] ??
    DARI_HTTP[kode] ??
    (POLA_JARINGAN.test(pesan) ? 'network' : undefined);

  return new RepositoryError(pesan, hasil ?? 'server');
}
