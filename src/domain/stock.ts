/**
 * Pergerakan stok: label, tingkat, dan rekap.
 *
 * Menu menyimpan satu angka `stock` supaya pembacaan cepat tidak perlu
 * menjumlahkan riwayat. Modul ini yang menghubungkan angka itu dengan
 * riwayatnya: menentukan kapan sebuah menu disebut menipis, dan meringkas
 * pergerakan agar selisih bisa ditelusuri.
 */

import type { Menu, StockMovement, StockReason } from './types.ts';

export const STOCK_REASONS: readonly StockReason[] = [
  'sale',
  'restock',
  'waste',
  'adjustment',
  'return',
];

export function stockReasonLabel(reason: StockReason): string {
  switch (reason) {
    case 'sale':
      return 'Terjual';
    case 'restock':
      return 'Restock';
    case 'waste':
      return 'Susut / rusak';
    case 'adjustment':
      return 'Penyesuaian';
    case 'return':
      return 'Dikembalikan';
  }
}

/**
 * Arah pergerakan sebagai kata. Dipakai di riwayat supaya tidak bergantung
 * pada tanda minus yang mudah terlewat saat memindai daftar panjang.
 */
export function stockDirectionLabel(delta: number): string {
  if (delta > 0) return 'Masuk';
  if (delta < 0) return 'Keluar';
  return 'Tetap';
}

export type StockLevel = 'habis' | 'menipis' | 'aman' | 'tak_dilacak';

/**
 * Tingkat stok sebuah menu.
 *
 * `null` berarti menu ini memang tidak dilacak (mis. kopi racikan yang
 * bahannya dihitung cara lain). Itu dibedakan tegas dari stok 0 — aplikasi
 * aslinya memakai string kosong untuk keduanya, sehingga "habis" dan "tidak
 * dilacak" tampil sama.
 */
export function stockLevel(menu: Pick<Menu, 'stock'>, threshold: number): StockLevel {
  if (menu.stock === null) return 'tak_dilacak';
  if (menu.stock <= 0) return 'habis';
  if (threshold > 0 && menu.stock <= threshold) return 'menipis';
  return 'aman';
}

export function stockLevelLabel(level: StockLevel): string {
  switch (level) {
    case 'habis':
      return 'Habis';
    case 'menipis':
      return 'Menipis';
    case 'aman':
      return 'Aman';
    case 'tak_dilacak':
      return 'Tidak dilacak';
  }
}

/** Menu yang perlu segera ditambah — habis lebih dulu, lalu yang menipis. */
export function lowStockMenus(menus: readonly Menu[], threshold: number): Menu[] {
  const bobot: Record<StockLevel, number> = {
    habis: 0,
    menipis: 1,
    aman: 2,
    tak_dilacak: 3,
  };

  return menus
    .filter((m) => {
      const level = stockLevel(m, threshold);
      return level === 'habis' || level === 'menipis';
    })
    .sort((a, b) => {
      const selisih = bobot[stockLevel(a, threshold)] - bobot[stockLevel(b, threshold)];
      // Dalam tingkat yang sama, yang stoknya paling sedikit didahulukan.
      return selisih !== 0 ? selisih : (a.stock ?? 0) - (b.stock ?? 0);
    });
}

export interface StockSummary {
  /** Total yang masuk (delta positif). */
  masuk: number;
  /** Total yang keluar, sebagai angka positif. */
  keluar: number;
  /** Selisih bersih: masuk - keluar. */
  bersih: number;
  /** Banyak pergerakan. */
  jumlah: number;
  /** Waktu pergerakan terakhir, atau null kalau belum ada. */
  terakhir: string | null;
}

/**
 * Rekap pergerakan untuk satu menu (atau semua menu bila `menuId` kosong).
 *
 * `masuk` dan `keluar` sengaja dipisah, bukan hanya menampilkan selisih:
 * selisih 0 bisa berarti tidak ada apa-apa, atau bisa berarti 10 masuk dan 10
 * keluar — dan dua keadaan itu menuntut tindakan yang berbeda.
 */
export function summarizeStock(
  movements: readonly StockMovement[],
  menuId?: string,
): StockSummary {
  const dipakai = menuId ? movements.filter((m) => m.menuId === menuId) : movements;

  let masuk = 0;
  let keluar = 0;
  let terakhir: string | null = null;

  for (const m of dipakai) {
    if (m.delta > 0) masuk += m.delta;
    else keluar += -m.delta;
    if (terakhir === null || m.at > terakhir) terakhir = m.at;
  }

  return { masuk, keluar, bersih: masuk - keluar, jumlah: dipakai.length, terakhir };
}

/**
 * Periksa apakah saldo yang tercatat pada pergerakan terakhir masih cocok
 * dengan angka stok di menu.
 *
 * Kalau tidak cocok, ada penulisan yang gagal di tengah jalan atau stok
 * diubah dari jalur lain — dan itu justru hal yang paling perlu diketahui,
 * bukan disembunyikan.
 */
export function balanceMatches(
  menu: Pick<Menu, 'id' | 'stock'>,
  movements: readonly StockMovement[],
): boolean {
  if (menu.stock === null) return true;
  const milikMenu = movements.filter((m) => m.menuId === menu.id);
  if (milikMenu.length === 0) return true;

  const terbaru = milikMenu.reduce((a, b) => (a.at >= b.at ? a : b));
  return terbaru.balance === menu.stock;
}
