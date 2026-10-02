/**
 * Tema tampilan.
 *
 * Tema di sini BUKAN sekadar tukar warna. Dua hal berubah bersamaan:
 *
 *   1. Token warna & bayangan  — lewat atribut `data-theme` di <html>,
 *      sehingga seluruh layar ikut berubah tanpa satu pun layar disentuh.
 *   2. Tata letak layar dapur  — `papan` (tiga kolom) atau `fokus`
 *      (satu pesanan jadi pusat perhatian, sisanya antrean ringkas).
 *
 * Yang SENGAJA tidak berubah antar tema: warna merek (oranye `brand-*`).
 * Merek itu identitas toko, bukan pilihan tampilan — kalau temanya ikut
 * mengganti warna merek, nota, QRIS, dan logo jadi tidak lagi sewarna.
 * Yang berubah adalah permukaan, teks, garis, dan bayangannya.
 */

/** Urutan ini yang tampil di Pengaturan. Yang pertama jadi bawaan. */
export const THEMES = ['fokus', 'gelap', 'terang'] as const;

export type ThemeId = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeId = 'fokus';

/** Tata letak layar dapur. */
export type TataLetak = 'fokus' | 'papan';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  deskripsi: string;
  /** Benar kalau tema ini berlatar gelap — dipakai untuk `color-scheme`. */
  gelap: boolean;
  tataLetak: TataLetak;
  /**
   * Warna untuk kotak pratinjau di Pengaturan. Ditulis di sini, bukan dibaca
   * dari CSS, supaya pratinjau bisa dirender tanpa harus benar-benar
   * mengganti tema seluruh halaman lebih dulu.
   */
  contoh: {
    latar: string;
    permukaan: string;
    garis: string;
    aksen: string;
    teks: string;
  };
}

export const THEME_INFO: Record<ThemeId, ThemeInfo> = {
  fokus: {
    id: 'fokus',
    label: 'Fokus',
    deskripsi: 'Satu pesanan jadi pusat, sisanya antrean. Gelap dengan pendar warna.',
    gelap: true,
    tataLetak: 'fokus',
    contoh: {
      latar: '#08090c',
      permukaan: '#12111a',
      garis: '#24222f',
      aksen: '#ff6b4a',
      teks: '#f4f5f7',
    },
  },
  gelap: {
    id: 'gelap',
    label: 'Gelap',
    deskripsi: 'Papan tiga kolom di atas permukaan gelap netral.',
    gelap: true,
    tataLetak: 'papan',
    contoh: {
      latar: '#0a0b0d',
      permukaan: '#14161a',
      garis: '#22252b',
      aksen: '#ea580c',
      teks: '#f2f3f5',
    },
  },
  terang: {
    id: 'terang',
    label: 'Terang',
    deskripsi: 'Papan tiga kolom, kartu putih mengambang di kanvas sejuk.',
    gelap: false,
    tataLetak: 'papan',
    contoh: {
      latar: '#f4f5f7',
      permukaan: '#ffffff',
      garis: '#e0e3e9',
      aksen: '#ea580c',
      teks: '#0f172a',
    },
  },
};

/** Daftar tema siap-render, urut sesuai tampilan di Pengaturan. */
export const THEME_LIST: readonly ThemeInfo[] = THEMES.map((id) => THEME_INFO[id]);

/**
 * Apakah nilai ini nama tema yang dikenal.
 *
 * Dipakai saat membaca dari localStorage dan dari `?tema=` di URL — dua-duanya
 * bisa berisi apa saja, termasuk sisa versi lama yang temanya sudah dihapus.
 * Tanpa pemeriksaan ini, tema asing akan lolos ke `data-theme` dan halaman
 * tampil tanpa satu pun token terdefinisi.
 */
export function isThemeId(nilai: unknown): nilai is ThemeId {
  return typeof nilai === 'string' && (THEMES as readonly string[]).includes(nilai);
}

/** Ambil info tema, dengan bawaan kalau nilainya tidak dikenal. */
export function infoTema(nilai: unknown): ThemeInfo {
  return THEME_INFO[isThemeId(nilai) ? nilai : DEFAULT_THEME];
}

/** Tata letak layar dapur untuk sebuah tema. */
export function tataLetakTema(nilai: unknown): TataLetak {
  return infoTema(nilai).tataLetak;
}
