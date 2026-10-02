/**
 * Tema yang sedang dipakai.
 *
 * Kenapa di localStorage, bukan di tabel `settings` toko:
 *
 * Layar dapur (tablet di ruang masak), layar antrian (TV di ruang tunggu), dan
 * meja kasir adalah tiga perangkat berbeda di tiga ruang dengan cahaya berbeda.
 * Tema itu sifat PERANGKAT, bukan sifat toko. Kalau disimpan di `settings`,
 * menyalakan tema gelap untuk TV akan ikut menggelapkan layar kasir di meja
 * depan — dan pemilik kafe tidak punya cara membedakannya.
 *
 * Efek sampingnya menguntungkan: tidak perlu migrasi skema, tidak ada tulis
 * jaringan, dan temanya langsung berubah tanpa menunggu server.
 */

import { signal } from '@preact/signals';

import { DEFAULT_THEME, isThemeId, type ThemeId } from '../domain/theme.ts';

const KUNCI = 'byorderkasir.tema';

/** Nama parameter URL yang bisa memaksa tema sebuah perangkat. */
const PARAM_URL = 'tema';

/**
 * Tema awal, berurutan dari yang paling mengikat:
 *
 *   1. `?tema=gelap` di URL — dipakai untuk memasang TV atau tablet tanpa
 *      menyentuh perangkatnya; cukup tempel URL yang berbeda.
 *   2. pilihan terakhir di perangkat ini.
 *   3. bawaan.
 *
 * Yang tidak dikenal di kedua sumber pertama dilewati, bukan dipakai — sisa
 * versi lama yang temanya sudah dihapus tidak boleh membuat halaman tampil
 * tanpa token.
 */
export function temaAwal(
  cari: string | null = typeof window === 'undefined' ? null : window.location.search,
  simpanan: string | null = bacaSimpanan(),
): ThemeId {
  if (cari) {
    const dariUrl = new URLSearchParams(cari).get(PARAM_URL);
    if (isThemeId(dariUrl)) return dariUrl;
  }
  if (isThemeId(simpanan)) return simpanan;
  return DEFAULT_THEME;
}

function bacaSimpanan(): string | null {
  try {
    return localStorage.getItem(KUNCI);
  } catch {
    // Mode privat / cookie diblokir: bukan alasan untuk gagal render.
    return null;
  }
}

function tulisSimpanan(id: ThemeId): void {
  try {
    localStorage.setItem(KUNCI, id);
  } catch {
    /* diabaikan dengan sengaja — lihat bacaSimpanan */
  }
}

/**
 * Pasang tema ke <html>. Seluruh token warna dan bayangan digantung pada
 * atribut ini, jadi satu baris ini yang mengganti tampilan semua layar.
 */
export function pasangTema(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = id;
}

export const theme = signal<ThemeId>(temaAwal());

/** Terapkan tema yang tersimpan saat modul dimuat. */
pasangTema(theme.value);

/**
 * Ganti tema: simpan, terapkan ke DOM, lalu perbarui sinyal.
 *
 * Urutannya disengaja — DOM lebih dulu supaya perubahan terlihat pada frame
 * yang sama, bukan satu frame setelah sinyal merambat ke seluruh komponen.
 */
export function setTheme(id: ThemeId): void {
  if (!isThemeId(id)) return;
  pasangTema(id);
  tulisSimpanan(id);
  theme.value = id;
}

/** Kembalikan ke tema bawaan tanpa menghapus pilihan tersimpan. */
export function resetTheme(): void {
  setTheme(DEFAULT_THEME);
}
