/**
 * Klien Supabase: kredensial, token sesi, dan pemetaan galat.
 *
 * Kunci yang dipakai adalah **kunci anon**, dan itu memang ikut terkirim ke
 * setiap peramban pengunjung — begitulah cara Supabase bekerja. Yang membuat
 * itu aman bukan kerahasiaan kuncinya, melainkan kebijakan RLS di
 * supabase/schema.sql: tidak ada satu pun policy INSERT / UPDATE / DELETE,
 * jadi kunci ini tidak bisa mengubah apa pun. Semua penulisan harus lewat
 * fungsi, dan setiap fungsi memeriksa token sesi serta peran.
 *
 * Bandingkan dengan aplikasi aslinya, yang menaruh `.getAdminData('123456')`
 * di dalam JavaScript client — di sana kredensialnya benar-benar bocor.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { RepositoryError, type RepositoryErrorCode } from '../repository.ts';

/** Token sesi disimpan per perangkat — sesi bukan milik toko, tapi milik orang. */
const TOKEN_KEY = 'byorderkasir:session-token';

let klien: SupabaseClient | null = null;

function env(name: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) {
    throw new RepositoryError(
      `Variabel lingkungan ${name} belum diisi. Salin .env.example menjadi .env, ` +
        'isi nilainya, lalu jalankan ulang dev server.',
      'invalid',
    );
  }
  return v;
}

/** Klien dibuat sekali, saat pertama dibutuhkan. */
export function getClient(): SupabaseClient {
  if (klien) return klien;

  const url = env('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
  const key = env('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY);

  klien = createClient(url, key, {
    auth: {
      // Aplikasi ini punya sistem sesinya sendiri (nama pengguna + sandi + PIN
      // lewat fungsi `sign_in`), bukan Supabase Auth. Kalau pustakanya ikut
      // menyimpan sesinya sendiri, akan ada dua sumber kebenaran yang bisa
      // saling bertentangan.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return klien;
}

/* ==========================================================================
   Token sesi
   ========================================================================== */

export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Token untuk fungsi yang mensyaratkan sesi. Dilempar sebagai
 * `unauthorized` kalau kosong, supaya lapisan tampilan menampilkan
 * "silakan masuk lagi" alih-alih galat server yang membingungkan.
 */
export function requireToken(): string {
  const token = getToken();
  if (!token) {
    throw new RepositoryError('Sesi tidak ditemukan — silakan masuk lagi', 'unauthorized');
  }
  return token;
}

/* ==========================================================================
   Galat
   ========================================================================== */

// Pemetaan galat tinggal di `errors.ts` supaya bisa diuji tanpa memuat SDK
// Supabase sama sekali. Diekspor ulang dari sini agar pemanggil lain cukup
// mengimpor satu berkas.
import { toRepositoryError } from './errors.ts';
export { toRepositoryError };

/**
 * Bungkus pemanggilan apa pun supaya galatnya selalu berbentuk
 * `RepositoryError` — termasuk galat jaringan, yang harus bisa dikenali
 * antrean luring lewat `code === 'network'`.
 */
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toRepositoryError(err);
  }
}

/** Hanya untuk pengujian: buang klien yang sudah dibuat. */
export function resetClient(): void {
  klien = null;
}
