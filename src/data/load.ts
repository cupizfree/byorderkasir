/**
 * Pemuatan adapter data.
 *
 * Adapter Supabase diimpor **secara dinamis**, dan itu bukan gaya-gayaan:
 * SDK-nya sekitar 40 KB terkompresi, dan aplikasi demo tidak boleh membayar
 * ongkos itu. Dengan impor dinamis, bundel `vendor-supabase` hanya diunduh
 * kalau `VITE_DATA_ADAPTER=supabase`.
 *
 * `getRepository()` tetap sinkron karena seluruh lapisan tampilan memanggilnya
 * saat render. Caranya: fungsi ini dijalankan sekali di awal oleh tiap entry
 * (dengan `await` di tingkat atas modul), lalu menaruh hasilnya lewat
 * `setRepository()`. Sesudah itu `getRepository()` tinggal mengembalikan yang
 * sudah ada.
 *
 * Kegagalannya sengaja tidak dilempar: kalau kredensial belum diisi, halaman
 * tetap dirender dan pesan yang jelas muncul dari `getRepository()`. Kalau
 * fungsi ini melempar di tingkat atas modul, halaman hanya akan kosong tanpa
 * penjelasan apa pun.
 */

import type { Repository } from './repository.ts';
import { currentAdapter, setRepository } from './index.ts';

export async function loadRepository(): Promise<Repository | null> {
  if (currentAdapter() !== 'supabase') {
    // Adapter mock dibuat malas oleh `getRepository()`, tidak perlu disiapkan.
    return null;
  }

  try {
    const { SupabaseRepository } = await import('./supabase/supabaseRepository.ts');
    const repo = new SupabaseRepository();
    setRepository(repo);
    return repo;
  } catch (err) {
    console.error('[data] adapter Supabase gagal dimuat', err);
    return null;
  }
}
