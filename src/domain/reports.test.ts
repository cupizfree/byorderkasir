import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dailyReport, menuReport, orderItemReport, orderReport, stockReport } from './reports.ts';
import type { Order, StockMovement } from './types.ts';

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    storeId: 's',
    code: 'ORD-260928-0001',
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
      paidAt: '2026-09-28T10:00:00.000Z',
      splits: [],
    },
    status: 'completed',
    calledAt: null,
    callCount: 0,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    completedAt: '2026-09-28T10:05:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    ...over,
  };
}

const gerak = (over: Partial<StockMovement> = {}): StockMovement => ({
  id: 'x1',
  storeId: 's',
  menuId: 'm1',
  menuName: 'Nasi Goreng',
  delta: -2,
  balance: 8,
  reason: 'sale',
  note: '',
  actor: 'Andi',
  at: '2026-09-28T10:00:00.000Z',
  ...over,
});

/* ==========================================================================
   Bentuk tabel
   ========================================================================= */

test('jumlah kolom judul sama dengan jumlah kolom tiap baris', () => {
  // Ketidaksamaan di sini berarti kolom bergeser dan laporan salah dibaca —
  // persis jenis kesalahan yang tidak terlihat sampai angkanya dicocokkan.
  const orders = [
    order(),
    order({ id: 'o2', code: 'ORD-2', channel: 'self_order', tableNumber: null }),
  ];
  const tabel = [
    orderReport(orders),
    orderItemReport(orders),
    dailyReport(orders),
    menuReport(orders),
    stockReport([gerak()]),
  ];

  for (const t of tabel) {
    for (const [i, baris] of t.rows.entries()) {
      assert.equal(
        baris.length,
        t.header.length,
        `${t.name} baris ${i}: ${baris.length} sel untuk ${t.header.length} kolom`,
      );
    }
    if (t.widths) {
      assert.equal(t.widths.length, t.header.length, `${t.name}: lebar kolom tidak cocok`);
    }
  }
});

/* ==========================================================================
   Rincian order
   ========================================================================= */

test('satu baris per order', () => {
  const t = orderReport([order(), order({ id: 'o2', code: 'ORD-2' })]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0]?.[0], 'ORD-260928-0001');
});

test('nominal ditulis sebagai angka supaya bisa dijumlahkan', () => {
  // Kalau ditulis "Rp 66.000", Excel tidak bisa menjumlahkannya.
  const [baris] = orderReport([order()]).rows;
  const total = baris?.[14];
  assert.equal(typeof total, 'number');
  assert.equal(total, 66000);
  assert.equal(typeof baris?.[16], 'number');
  assert.equal(baris?.[16], 66000 - 32000);
});

test('meja kosong pada order kasir bukan angka nol', () => {
  // 0 akan terbaca sebagai "meja 0" dan membingungkan saat difilter.
  const [baris] = orderReport([order({ tableNumber: null })]).rows;
  assert.equal(baris?.[4], '');
});

test('status dan metode bayar ditulis dalam bahasa Indonesia', () => {
  const [baris] = orderReport([order()]).rows;
  assert.equal(baris?.[7], 'Selesai');
  assert.equal(baris?.[8], 'Lunas');
  assert.equal(baris?.[9], 'Tunai');
});

/* ==========================================================================
   Rincian per item
   ========================================================================= */

test('satu baris per menu dalam order', () => {
  const o = order({
    items: [
      { menuId: 'm1', name: 'Espresso', price: 18000, qty: 2, notes: '', costPrice: 6000 },
      { menuId: 'm2', name: 'Brownies', price: 26000, qty: 1, notes: 'tanpa kacang', costPrice: 12000 },
    ],
  });
  const t = orderItemReport([o]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0]?.[6], 36000);
  assert.equal(t.rows[1]?.[10], 'tanpa kacang');
});

/* ==========================================================================
   Rekap harian
   ========================================================================= */

test('rekap harian mengelompokkan per tanggal', () => {
  const t = dailyReport([
    order({ id: 'a', createdAt: '2026-09-28T02:00:00.000Z', total: 10000, totalCost: 4000 }),
    order({ id: 'b', createdAt: '2026-09-28T05:00:00.000Z', total: 20000, totalCost: 9000 }),
    order({ id: 'c', createdAt: '2026-09-29T05:00:00.000Z', total: 5000, totalCost: 1000 }),
  ]);

  assert.equal(t.rows.length, 2);
  const [hari1, hari2] = t.rows;
  assert.equal(hari1?.[0], '2026-09-28');
  assert.equal(hari1?.[1], 2);
  assert.equal(hari1?.[2], 30000);
  assert.equal(hari1?.[4], 30000 - 13000);
  assert.equal(hari2?.[0], '2026-09-29');
});

test('rekap harian terurut dari tanggal paling awal', () => {
  const t = dailyReport([
    order({ id: 'c', createdAt: '2026-09-29T05:00:00.000Z' }),
    order({ id: 'a', createdAt: '2026-09-27T05:00:00.000Z' }),
    order({ id: 'b', createdAt: '2026-09-28T05:00:00.000Z' }),
  ]);
  assert.deepEqual(
    t.rows.map((r) => r[0]),
    ['2026-09-27', '2026-09-28', '2026-09-29'],
  );
});

test('margin nol tidak menghasilkan pembagian dengan nol', () => {
  const t = dailyReport([order({ total: 0, totalCost: 0 })]);
  assert.equal(t.rows[0]?.[5], 0);
});

/* ==========================================================================
   Kinerja menu
   ========================================================================= */

test('kinerja menu menjumlahkan seluruh order dan terurut dari terlaris', () => {
  const t = menuReport([
    order({
      id: 'a',
      items: [{ menuId: 'm1', name: 'Espresso', price: 18000, qty: 3, notes: '', costPrice: 6000 }],
    }),
    order({
      id: 'b',
      items: [
        { menuId: 'm1', name: 'Espresso', price: 18000, qty: 1, notes: '', costPrice: 6000 },
        { menuId: 'm2', name: 'Brownies', price: 26000, qty: 5, notes: '', costPrice: 12000 },
      ],
    }),
  ]);

  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0]?.[0], 'Brownies');
  assert.equal(t.rows[0]?.[1], 5);

  const espresso = t.rows.find((r) => r[0] === 'Espresso');
  assert.equal(espresso?.[1], 4);
  assert.equal(espresso?.[2], 72000);
  assert.equal(espresso?.[4], 72000 - 24000);
});

/* ==========================================================================
   Riwayat stok
   ========================================================================= */

test('riwayat stok terurut dari yang terbaru dan menulis arah sebagai kata', () => {
  const t = stockReport([
    gerak({ id: 'lama', at: '2026-09-28T08:00:00.000Z', delta: 10, reason: 'restock' }),
    gerak({ id: 'baru', at: '2026-09-28T12:00:00.000Z', delta: -2 }),
  ]);

  assert.equal(t.rows[0]?.[1], 'Nasi Goreng');
  assert.equal(t.rows[0]?.[2], 'Keluar');
  assert.equal(t.rows[1]?.[2], 'Masuk');
  assert.equal(t.rows[1]?.[5], 'Restock');
});

test('laporan kosong tetap punya judul kolom', () => {
  for (const t of [orderReport([]), orderItemReport([]), dailyReport([]), menuReport([]), stockReport([])]) {
    assert.ok(t.header.length > 0, `${t.name} tidak punya judul kolom`);
    assert.equal(t.rows.length, 0);
  }
});
