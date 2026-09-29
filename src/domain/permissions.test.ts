import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_VIEWS,
  ROLE_LABEL,
  can,
  canView,
  firstAllowedView,
  homeViewOf,
  permissionsOf,
  viewsOf,
} from './permissions.ts';
import { ROLES } from '../data/repository.ts';

test('pemilik bisa membuka semua layar', () => {
  assert.equal(viewsOf('owner').length, ALL_VIEWS.length);
  for (const v of ALL_VIEWS) assert.ok(canView('owner', v), `pemilik harus bisa membuka ${v}`);
});

test('kasir tidak bisa membuka menu, analitik, dan pengaturan', () => {
  // Ini inti pemisahan peran: HPP ada di layar Menu, margin ada di Analitik,
  // dan kredensial QRIS ada di Pengaturan. Kalau kasir bisa membukanya,
  // rahasia dagang kafe ikut terbuka.
  assert.equal(canView('cashier', 'menu'), false);
  assert.equal(canView('cashier', 'analitik'), false);
  assert.equal(canView('cashier', 'pengaturan'), false);
  assert.equal(canView('cashier', 'kasir'), true);
});

test('dapur hanya dapat papan kerja dan catatan stok', () => {
  assert.deepEqual(viewsOf('kitchen'), ['dapur', 'order', 'stok']);
});

test('kasir tidak boleh mengubah menu dan pengaturan', () => {
  assert.equal(can('cashier', 'menu:write'), false);
  assert.equal(can('cashier', 'settings:write'), false);
  // Tapi tetap boleh melayani transaksi.
  assert.equal(can('cashier', 'order:create'), true);
  assert.equal(can('cashier', 'order:pay'), true);
});

test('dapur tidak boleh membatalkan order atau mencatat pembayaran', () => {
  // Pembatalan dan uang masuk menyangkut kas, bukan dapur.
  assert.equal(can('kitchen', 'order:cancel'), false);
  assert.equal(can('kitchen', 'order:pay'), false);
  // Memajukan tahap justru pekerjaannya.
  assert.equal(can('kitchen', 'order:advance'), true);
});

test('hanya pemilik yang boleh mengunduh laporan', () => {
  assert.equal(can('owner', 'report:export'), true);
  assert.equal(can('cashier', 'report:export'), false);
  assert.equal(can('kitchen', 'report:export'), false);
});

test('urutan layar mengikuti urutan tab, bukan urutan izin', () => {
  const v = viewsOf('cashier');
  const indeks = v.map((x) => ALL_VIEWS.indexOf(x));
  const terurut = [...indeks].sort((a, b) => a - b);
  assert.deepEqual(indeks, terurut);
});

test('layar pertama dapur adalah papan kerja, bukan kasir', () => {
  assert.equal(homeViewOf('kitchen'), 'dapur');
  assert.equal(homeViewOf('owner'), 'kasir');
  assert.equal(homeViewOf('cashier'), 'kasir');
});

test('layar yang tidak diizinkan dialihkan ke yang diizinkan', () => {
  // Kasus nyata: pengguna membuka ?tab=menu, lalu perannya diganti ke kasir.
  assert.equal(firstAllowedView('cashier', 'menu'), 'kasir');
  assert.equal(firstAllowedView('kitchen', 'analitik'), 'dapur');
  // Yang sudah diizinkan tidak diubah.
  assert.equal(firstAllowedView('owner', 'analitik'), 'analitik');
});

test('setiap peran yang dikenal punya label dan izin', () => {
  for (const role of ROLES) {
    assert.ok(ROLE_LABEL[role], `label untuk ${role} belum ada`);
    assert.ok(permissionsOf(role).length > 0, `izin untuk ${role} kosong`);
  }
});

test('setiap peran minimal bisa membuka satu layar', () => {
  // Kalau tidak, pengguna akan masuk ke panel kosong tanpa jalan keluar.
  for (const role of ROLES) assert.ok(viewsOf(role).length > 0, `${role} tidak punya layar`);
});
