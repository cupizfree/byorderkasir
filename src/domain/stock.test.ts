import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  balanceMatches,
  lowStockMenus,
  stockDirectionLabel,
  stockLevel,
  stockLevelLabel,
  stockReasonLabel,
  summarizeStock,
} from './stock.ts';
import type { Menu, StockMovement } from './types.ts';

const menu = (id: string, stock: number | null, name = id): Menu => ({
  id,
  storeId: 's',
  name,
  categoryId: 'c',
  price: 10000,
  costPrice: 4000,
  description: '',
  imageUrl: null,
  isAvailable: true,
  stock,
  sortOrder: 0,
});

const gerak = (
  menuId: string,
  delta: number,
  balance: number,
  at = '2026-09-28T10:00:00.000Z',
  reason: StockMovement['reason'] = 'sale',
): StockMovement => ({
  id: `${menuId}-${at}-${delta}`,
  storeId: 's',
  menuId,
  menuName: menuId,
  delta,
  balance,
  reason,
  note: '',
  actor: 'Kasir',
  at,
});

/* ==========================================================================
   Tingkat stok
   ========================================================================= */

test('stok null berarti tidak dilacak, bukan habis', () => {
  // Aplikasi aslinya memakai string kosong untuk dua keadaan yang berbeda
  // ini, sehingga "habis" dan "tidak dilacak" tampil sama.
  assert.equal(stockLevel({ stock: null }, 5), 'tak_dilacak');
  assert.equal(stockLevel({ stock: 0 }, 5), 'habis');
});

test('stok di atau di bawah ambang disebut menipis', () => {
  assert.equal(stockLevel({ stock: 5 }, 5), 'menipis');
  assert.equal(stockLevel({ stock: 6 }, 5), 'aman');
});

test('ambang 0 mematikan peringatan menipis', () => {
  assert.equal(stockLevel({ stock: 1 }, 0), 'aman');
  // Tapi stok habis tetap terdeteksi.
  assert.equal(stockLevel({ stock: 0 }, 0), 'habis');
});

test('stok negatif tetap terbaca habis', () => {
  // Bisa terjadi kalau penjualan tercatat lebih dulu daripada restock.
  assert.equal(stockLevel({ stock: -2 }, 5), 'habis');
});

test('label tingkat stok lengkap', () => {
  assert.equal(stockLevelLabel('habis'), 'Habis');
  assert.equal(stockLevelLabel('menipis'), 'Menipis');
  assert.equal(stockLevelLabel('aman'), 'Aman');
  assert.equal(stockLevelLabel('tak_dilacak'), 'Tidak dilacak');
});

/* ==========================================================================
   Daftar yang perlu ditambah
   ========================================================================= */

test('yang habis didahulukan, lalu yang menipis paling sedikit', () => {
  const daftar = [
    menu('aman', 40),
    menu('menipis-banyak', 8),
    menu('habis', 0),
    menu('menipis-sedikit', 2),
    menu('tak-dilacak', null),
  ];

  assert.deepEqual(
    lowStockMenus(daftar, 10).map((m) => m.id),
    ['habis', 'menipis-sedikit', 'menipis-banyak'],
  );
});

test('menu yang tidak dilacak tidak pernah masuk peringatan', () => {
  assert.deepEqual(lowStockMenus([menu('a', null)], 10), []);
});

/* ==========================================================================
   Rekap
   ========================================================================= */

test('rekap memisahkan masuk dan keluar, bukan hanya selisihnya', () => {
  // Selisih 0 bisa berarti tidak ada apa-apa, atau 10 masuk dan 10 keluar.
  // Dua keadaan itu menuntut tindakan yang berbeda, jadi dipisah.
  const r = summarizeStock([gerak('m1', 10, 20), gerak('m1', -10, 10)]);
  assert.equal(r.masuk, 10);
  assert.equal(r.keluar, 10);
  assert.equal(r.bersih, 0);
  assert.equal(r.jumlah, 2);
});

test('rekap bisa disaring per menu', () => {
  const semua = [gerak('m1', 5, 5), gerak('m2', 3, 3), gerak('m1', -2, 3)];
  assert.equal(summarizeStock(semua, 'm1').jumlah, 2);
  assert.equal(summarizeStock(semua, 'm1').bersih, 3);
  assert.equal(summarizeStock(semua).jumlah, 3);
});

test('rekap mencatat waktu pergerakan terakhir', () => {
  const r = summarizeStock([
    gerak('m1', 1, 1, '2026-09-28T08:00:00.000Z'),
    gerak('m1', 1, 2, '2026-09-28T12:00:00.000Z'),
    gerak('m1', 1, 3, '2026-09-28T10:00:00.000Z'),
  ]);
  assert.equal(r.terakhir, '2026-09-28T12:00:00.000Z');
});

test('rekap tanpa pergerakan tidak meledak', () => {
  const r = summarizeStock([]);
  assert.deepEqual(r, { masuk: 0, keluar: 0, bersih: 0, jumlah: 0, terakhir: null });
});

/* ==========================================================================
   Pemeriksaan saldo
   ========================================================================= */

test('saldo cocok kalau pergerakan terakhir sama dengan stok menu', () => {
  assert.ok(balanceMatches(menu('m1', 8), [gerak('m1', -2, 8)]));
});

test('saldo tidak cocok terdeteksi', () => {
  // Ini yang paling perlu diketahui: ada penulisan gagal di tengah jalan,
  // atau stok diubah dari jalur lain.
  assert.equal(balanceMatches(menu('m1', 5), [gerak('m1', -2, 8)]), false);
});

test('menu tanpa riwayat atau tanpa pelacakan dianggap cocok', () => {
  assert.ok(balanceMatches(menu('m1', 5), []));
  assert.ok(balanceMatches(menu('m1', null), [gerak('m1', -2, 8)]));
});

/* ==========================================================================
   Label
   ========================================================================= */

test('label alasan pergerakan lengkap', () => {
  assert.equal(stockReasonLabel('sale'), 'Terjual');
  assert.equal(stockReasonLabel('waste'), 'Susut / rusak');
  assert.equal(stockReasonLabel('restock'), 'Restock');
  assert.equal(stockReasonLabel('adjustment'), 'Penyesuaian');
  assert.equal(stockReasonLabel('return'), 'Dikembalikan');
});

test('arah pergerakan ditulis sebagai kata', () => {
  assert.equal(stockDirectionLabel(3), 'Masuk');
  assert.equal(stockDirectionLabel(-3), 'Keluar');
  assert.equal(stockDirectionLabel(0), 'Tetap');
});
