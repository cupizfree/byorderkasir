/**
 * Uji pemetaan baris PostgREST → tipe domain.
 *
 * Berkas ini tidak menyentuh basis data sama sekali, dan itu memang tujuan
 * pemisahannya: kesalahan pemetaan adalah kesalahan yang paling sulit
 * terlihat — halaman tetap terbuka, angkanya tetap tampil, tapi nilainya
 * salah. Contohnya `stock: null` yang berubah jadi `0`: menu yang stoknya
 * tidak dilacak akan tampak habis, dan kasir tidak bisa menjualnya.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toCategory, toMenu, toSettings, toTable } from './rows.ts';
import type { CategoryRow, MenuRow, SettingsRow, TableRow } from './rows.ts';

const menu: MenuRow = {
  id: 'mn-kopi',
  store_id: 'store-demo',
  category_id: 'cat-minuman',
  name: 'Kopi Susu',
  price: 22000,
  cost_price: 8000,
  description: 'Espresso + susu',
  image_url: null,
  is_available: true,
  stock: 12,
  sort_order: 3,
};

test('menu: nama kolom snake_case dipetakan ke camelCase', () => {
  const m = toMenu(menu);
  assert.equal(m.id, 'mn-kopi');
  assert.equal(m.storeId, 'store-demo');
  assert.equal(m.categoryId, 'cat-minuman');
  assert.equal(m.costPrice, 8000);
  assert.equal(m.isAvailable, true);
  assert.equal(m.sortOrder, 3);
});

test('menu: stok null berarti TIDAK DILACAK, bukan habis', () => {
  const m = toMenu({ ...menu, stock: null });
  assert.equal(m.stock, null);
});

test('menu: stok 0 tetap 0 — habis, dan itu berbeda dari tidak dilacak', () => {
  const m = toMenu({ ...menu, stock: 0 });
  assert.equal(m.stock, 0);
});

test('menu: kategori yang dihapus jadi string kosong, bukan null', () => {
  // Kuncinya ON DELETE SET NULL, sementara tipe domain memakai `ID`.
  // Kalau ini lolos sebagai null, penyaringan per kategori akan pecah.
  const m = toMenu({ ...menu, category_id: null });
  assert.equal(m.categoryId, '');
});

test('menu: imageUrl null diteruskan apa adanya', () => {
  const m = toMenu({ ...menu, image_url: null });
  assert.equal(m.imageUrl, null);
  assert.equal(toMenu({ ...menu, image_url: '/x.png' }).imageUrl, '/x.png');
});

const kategori: CategoryRow = {
  id: 'cat-minuman',
  store_id: 'store-demo',
  name: 'Minuman',
  icon: 'cup',
  sort_order: 2,
  is_active: true,
};

test('kategori: dipetakan lengkap', () => {
  const c = toCategory(kategori);
  assert.equal(c.id, 'cat-minuman');
  assert.equal(c.sortOrder, 2);
  assert.equal(c.isActive, true);
});

test('kategori: ikon kosong jatuh ke "box" supaya tidak ada ikon tak dikenal', () => {
  assert.equal(toCategory({ ...kategori, icon: '' }).icon, 'box');
});

const meja: TableRow = {
  id: 'tbl-1',
  store_id: 'store-demo',
  number: 1,
  name: 'Meja 1',
  capacity: 4,
  status: 'occupied',
  qr_token: 'demo-token-1',
};

test('meja: token QR ikut, karena halaman pesan-sendiri membutuhkannya', () => {
  const t = toTable(meja);
  assert.equal(t.qrToken, 'demo-token-1');
  assert.equal(t.number, 1);
});

test('meja: status tak dikenal jatuh ke "available", bukan diteruskan mentah', () => {
  // Kalau nilai asing diteruskan, komponen yang men-switch status akan
  // menampilkan meja tanpa label sama sekali.
  assert.equal(toTable({ ...meja, status: 'aneh' }).status, 'available');
  assert.equal(toTable({ ...meja, status: 'reserved' }).status, 'reserved');
});

/* ==========================================================================
   Pengaturan — bagian yang paling mudah menjatuhkan seluruh layar
   ========================================================================== */

const settingsLengkap: SettingsRow = {
  store_id: 'store-demo',
  data: {
    name: 'Kopi Senja',
    tagline: 'Kopi & Dapur Kecil',
    currency: 'Rp',
    tax: { percent: 10, channels: [] },
    serviceFee: { enabled: false, amount: 0, channels: [] },
    payments: {
      cash: { channels: ['pos'], enabled: true },
      qrisStatic: { channels: ['qr'], enabled: true, payload: '00020101...', imageUrl: null },
      uniqueCodeEnabled: true,
      uniqueCodeRange: [1, 999],
    },
    receipt: { customerFooter: 'Terima kasih', kitchenFooter: 'Cepat' },
    queue: { prefix: 'A', resetDaily: true },
    stock: { lowStockThreshold: 5 },
  },
};

test('pengaturan: nilai yang tersimpan dipakai apa adanya', () => {
  const s = toSettings(settingsLengkap);
  assert.equal(s.storeId, 'store-demo');
  assert.equal(s.name, 'Kopi Senja');
  assert.equal(s.tax.percent, 10);
  assert.equal(s.payments.uniqueCodeRange[0], 1);
  assert.equal(s.payments.uniqueCodeRange[1], 999);
  assert.equal(s.payments.qrisStatic.payload, '00020101...');
  assert.equal(s.queue.prefix, 'A');
  assert.equal(s.stock.lowStockThreshold, 5);
});

test('pengaturan: `storeId` selalu diambil dari barisnya, bukan dari isi data', () => {
  // Kalau `data.storeId` dipakai, satu nilai yang salah di basis data akan
  // membuat aplikasi menulis ke toko yang salah.
  const s = toSettings({
    store_id: 'store-benar',
    data: { ...(settingsLengkap.data as Record<string, unknown>), storeId: 'store-salah' },
  });
  assert.equal(s.storeId, 'store-benar');
});

test('pengaturan: data kosong tetap menghasilkan bentuk yang lengkap', () => {
  // Inilah alasan utama fungsi ini ada. Layar membaca
  // `settings.payments.cash.enabled` secara langsung; satu bagian yang hilang
  // akan menjatuhkan seluruh halaman, bukan sekadar menampilkan nilai kosong.
  const s = toSettings({ store_id: 'store-demo', data: {} });

  assert.equal(s.storeId, 'store-demo');
  assert.equal(s.currency, 'Rp');
  assert.equal(s.tax.percent, 0);
  assert.deepEqual(s.tax.channels, []);
  assert.equal(s.serviceFee.enabled, false);
  assert.equal(s.payments.cash.enabled, false);
  assert.deepEqual(s.payments.cash.channels, []);
  assert.equal(s.payments.qrisStatic.payload, null);
  assert.equal(s.payments.transfer.accountNumber, '');
  assert.equal(s.payments.uniqueCodeEnabled, false);
  assert.deepEqual(s.payments.uniqueCodeRange, [1, 999]);
  assert.equal(s.queue.prefix, 'A');
  assert.equal(s.queue.resetDaily, true);
  // 5, bukan 0: 0 berarti peringatan stok dimatikan, dan itu bukan bawaan
  // yang aman untuk kedai kecil.
  assert.equal(s.stock.lowStockThreshold, 5);
});

test('pengaturan: data null tidak melempar', () => {
  const s = toSettings({ store_id: 'store-demo', data: null });
  assert.equal(s.name, 'Toko');
  assert.equal(s.tax.percent, 0);
});

test('pengaturan: tipe yang salah diabaikan, tidak diteruskan', () => {
  const s = toSettings({
    store_id: 'store-demo',
    data: {
      name: 12345,
      tax: { percent: 'sepuluh' },
      queue: { prefix: null },
      payments: { uniqueCodeRange: 'bukan array' },
      stock: { lowStockThreshold: 'lima' },
    },
  });

  assert.equal(s.name, 'Toko');
  assert.equal(s.tax.percent, 0);
  assert.equal(s.queue.prefix, 'A');
  assert.deepEqual(s.payments.uniqueCodeRange, [1, 999]);
  assert.equal(s.stock.lowStockThreshold, 5);
});

test('pengaturan: kanal pembayaran asing disaring keluar', () => {
  const s = toSettings({
    store_id: 'store-demo',
    data: { tax: { percent: 10, channels: ['pos', 'telepati', 'qr'] } },
  });
  assert.deepEqual(s.tax.channels, ['pos', 'qr']);
});
