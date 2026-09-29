/**
 * Titik masuk lapisan data.
 *
 * Adapter dipilih lewat variabel lingkungan `VITE_DATA_ADAPTER`:
 *
 *   mock      (default) — in-memory + localStorage + BroadcastChannel.
 *                         Aplikasi jalan penuh tanpa backend apa pun.
 *   supabase            — Postgres + Realtime + Auth.
 *
 * UI tidak pernah mengimpor adapter secara langsung; dia hanya memanggil
 * `getRepository()`. Itu sebabnya menukar backend tidak menyentuh satu baris
 * pun di lapisan tampilan.
 */

import { MockRepository } from './mock/mockRepository.ts';
import type { Repository } from './repository.ts';

export type AdapterName = 'mock' | 'supabase';

let instance: Repository | null = null;

export function currentAdapter(): AdapterName {
  const raw = import.meta.env.VITE_DATA_ADAPTER;
  return raw === 'supabase' ? 'supabase' : 'mock';
}

export function getRepository(): Repository {
  if (instance) return instance;

  switch (currentAdapter()) {
    case 'supabase': {
      // Diimpor dinamis supaya bundel mock-only tidak ikut membawa SDK Supabase.
      // Kalau adapter ini dipilih tanpa kredensial, pesannya harus jelas.
      throw new Error(
        'Adapter Supabase belum diaktifkan. Isi VITE_SUPABASE_URL dan ' +
          'VITE_SUPABASE_ANON_KEY, lalu jalankan skema di supabase/schema.sql. ' +
          'Untuk menjalankan tanpa backend, pakai VITE_DATA_ADAPTER=mock.',
      );
    }
    case 'mock':
    default:
      instance = new MockRepository();
      return instance;
  }
}

/** Hanya untuk pengujian dan tombol reset data demo. */
export function setRepository(repo: Repository | null): void {
  instance = repo;
}

/**
 * Di mode pengembangan, repositori dipasang di `window` supaya bisa diperiksa
 * langsung dari konsol peramban — memicu aksi tanpa harus mengklik, memeriksa
 * state mentah, dan menulis uji otomatis. Tidak ikut ke build produksi karena
 * `import.meta.env.DEV` diganti `false` saat build.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.defineProperty(window, '__byorder', {
    configurable: true,
    get: () => ({
      repo: getRepository(),
      adapter: currentAdapter(),
      reset: () => setRepository(null),
    }),
  });
}

export { MockRepository };
export * from './repository.ts';
