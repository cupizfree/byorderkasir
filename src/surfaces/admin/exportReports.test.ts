/**
 * Uji ekspor laporan.
 *
 * Yang dijaga di sini adalah kesalahan yang tidak terlihat: berkas yang tetap
 * "berhasil" diunduh, ukurannya wajar, tapi isinya tidak lengkap. Pengguna
 * baru sadar saat membukanya di Excel — dan saat itu sudah terlambat.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildXlsx } from '../../domain/xlsx.ts';
import type { Order } from '../../domain/types.ts';
import {
  REPORT_LABEL,
  type ReportKey,
  buildReportSet,
  buildSheets,
  reportFileName,
} from './exportReports.ts';

const URUTAN: readonly ReportKey[] = ['order', 'item', 'harian', 'menu', 'stok'];

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    storeId: 'store-demo',
    code: 'ORD-260929-0001',
    channel: 'pos',
    queueNumber: 'A-01',
    tableNumber: 4,
    customerName: 'Dede',
    customerEmail: '',
    customerNotes: '',
    cashierName: 'Andi',
    items: [
      { menuId: 'm1', name: 'Nasi Goreng', price: 30000, qty: 2, notes: '', costPrice: 16000 },
    ],
    subtotal: 60000,
    discountType: 'none',
    discountValue: 0,
    discountAmount: 0,
    taxPercent: 10,
    taxAmount: 6000,
    serviceAmount: 0,
    total: 66000,
    totalCost: 32000,
    payment: {
      method: 'cash',
      status: 'paid',
      uniqueCode: 0,
      amountDue: 66000,
      amountPaid: 66000,
      cashReceived: 100000,
      cashChange: 34000,
      reference: '',
      paidAt: '2026-09-29T03:00:00.000Z',
      splits: [],
    },
    status: 'completed',
    calledAt: null,
    callCount: 0,
    createdAt: '2026-09-29T03:00:00.000Z',
    updatedAt: '2026-09-29T03:00:00.000Z',
    completedAt: '2026-09-29T03:05:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    ...over,
  };
}

const gerak = {
  id: 'sm-1',
  storeId: 'store-demo',
  menuId: 'm1',
  menuName: 'Nasi Goreng',
  delta: -2,
  balance: 8,
  reason: 'sale' as const,
  note: 'Order ORD-260929-0001',
  actor: 'Andi',
  at: '2026-09-29T03:00:00.000Z',
};

/* ==========================================================================
   Susunan sheet
   ========================================================================= */

test('judul kolom ikut tertulis sebagai baris pertama tiap sheet', () => {
  // Ini kesalahan yang pernah terjadi: judul dikirim lewat field yang tidak
  // dipakai penulis xlsx, jadi berkasnya keluar tanpa judul sama sekali —
  // dan tetap dianggap berhasil.
  const set = buildReportSet([order()], [gerak]);
  const sheets = buildSheets(set, URUTAN);

  for (const s of sheets) {
    const k = URUTAN.find((x) => REPORT_LABEL[x] === s.name)!;
    assert.deepEqual(
      s.rows[0],
      [...set[k].header],
      `sheet "${s.name}" tidak diawali judul kolom`,
    );
  }
});

test('setiap sheet berisi satu baris judul ditambah baris datanya', () => {
  const set = buildReportSet([order()], [gerak]);
  for (const s of buildSheets(set, URUTAN)) {
    const k = URUTAN.find((x) => REPORT_LABEL[x] === s.name)!;
    assert.equal(s.rows.length, set[k].rows.length + 1, `jumlah baris sheet "${s.name}"`);
  }
});

test('lebar kolom sejajar dengan jumlah kolom setelah judul ditambahkan', () => {
  const set = buildReportSet([order()], [gerak]);
  for (const s of buildSheets(set, URUTAN)) {
    if (!s.widths) continue;
    assert.equal(
      s.widths.length,
      s.rows[0]!.length,
      `lebar kolom sheet "${s.name}" tidak cocok dengan jumlah kolom`,
    );
  }
});

test('laporan kosong tetap menghasilkan sheet berjudul kolom saja', () => {
  const set = buildReportSet([], []);
  for (const s of buildSheets(set, URUTAN)) {
    assert.equal(s.rows.length, 1, `sheet "${s.name}" seharusnya hanya berisi judul`);
    assert.ok(s.rows[0]!.length > 0);
  }
});

/* ==========================================================================
   Nama sheet
   ========================================================================= */

test('nama sheet sah menurut aturan Excel', () => {
  // Excel menolak seluruh berkas kalau satu nama sheet melanggar — bukan
  // hanya melewati sheet itu.
  for (const s of buildSheets(buildReportSet([order()], [gerak]), URUTAN)) {
    assert.ok(s.name.length > 0 && s.name.length <= 31, `panjang nama: "${s.name}"`);
    assert.equal(/[[\]:*?/\\]/.test(s.name), false, `karakter terlarang di "${s.name}"`);
  }
});

test('nama sheet memakai label yang sama dengan yang dilihat pengguna', () => {
  const sheets = buildSheets(buildReportSet([], []), URUTAN);
  assert.deepEqual(
    sheets.map((s) => s.name),
    URUTAN.map((k) => REPORT_LABEL[k]),
  );
});

/* ==========================================================================
   Berkas sungguhan
   ========================================================================= */

test('judul kolom benar-benar ada di dalam bita berkas xlsx', () => {
  // ZIP-nya memakai metode STORE (tanpa kompresi), jadi XML-nya bisa dibaca
  // langsung dari bita. Ini memeriksa berkas akhirnya, bukan sekadar bentuk
  // data di memori.
  const set = buildReportSet([order()], [gerak]);
  const bytes = buildXlsx(buildSheets(set, URUTAN));
  const isi = new TextDecoder().decode(bytes);

  assert.ok(bytes.length > 1000, 'berkas terlalu kecil untuk berisi laporan');
  for (const kolom of ['Tanggal', 'Omzet', 'Margin (%)']) {
    assert.ok(isi.includes(kolom), `judul "${kolom}" tidak ditemukan di dalam berkas`);
  }
  assert.ok(isi.includes('2026-09-29'), 'tanggal data tidak ditemukan di dalam berkas');
  assert.ok(isi.includes('Nasi Goreng'), 'nama menu tidak ditemukan di dalam berkas');
});

test('nama berkas memuat tanggal supaya unduhan tidak saling menimpa', () => {
  const a = reportFileName('laporan', 'xlsx', new Date('2026-09-29T03:00:00.000Z'));
  const b = reportFileName('laporan', 'xlsx', new Date('2026-09-30T03:00:00.000Z'));
  assert.equal(a, 'byorderkasir-laporan-2026-09-29.xlsx');
  assert.notEqual(a, b);
});

/* ==========================================================================
   Dasar hitung uang
   ========================================================================= */

test('rekap uang hanya menghitung order yang sudah lunas', () => {
  // Layar analitik sudah memakai dasar ini. Kalau berkas yang diunduh memakai
  // dasar berbeda, pemilik menemukan dua omzet berbeda untuk periode yang sama
  // dan tidak ada cara tahu mana yang benar.
  const lunas = order({ id: 'a', code: 'A', total: 100000, totalCost: 40000 });
  const belum = order({
    id: 'b',
    code: 'B',
    total: 999000,
    totalCost: 500000,
    payment: {
      method: 'cash',
      status: 'unpaid',
      uniqueCode: 0,
      amountDue: 999000,
      amountPaid: 0,
      cashReceived: 0,
      cashChange: 0,
      reference: '',
      paidAt: null,
      splits: [],
    },
  });

  const set = buildReportSet([lunas, belum], []);

  // Rekap harian & kinerja menu: hanya yang lunas.
  assert.equal(set.harian.rows.length, 1);
  assert.equal(set.harian.rows[0]?.[2], 100000, 'omzet rekap memuat order belum lunas');

  // Kinerja menu menghitung per item (2 × Rp 30.000), bukan total order —
  // jadi angkanya memang berbeda dari rekap harian. Yang penting: order yang
  // belum lunas tidak ikut menambah.
  const totalMenu = set.menu.rows.reduce((s, r) => s + (r[2] as number), 0);
  assert.equal(totalMenu, 60000, 'omzet kinerja menu memuat order belum lunas');
  assert.equal(set.menu.rows.length, 1, 'menu dari order belum lunas ikut terhitung');

  // Rincian order: keduanya, karena gunanya sebagai catatan transaksi.
  assert.equal(set.order.rows.length, 2, 'rincian order seharusnya memuat semua order');
});
