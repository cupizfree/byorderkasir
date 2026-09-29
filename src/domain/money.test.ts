/**
 * Uji aritmetika uang.
 *
 * Dijalankan dengan test runner bawaan Node:
 *   node --test src/domain/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { OrderItem } from './types.ts';
import {
  amountDueWithUniqueCode,
  cashChange,
  computeTotals,
  needsUniqueCode,
  discountAmountFor,
  effectiveDiscountPercent,
  formatRupiah,
  halveAmount,
  lineTotal,
  parseRupiah,
  quickCashOptions,
  subtotalOf,
  summarizeReport,
  uniqueCodeFromSequence,
  validateSplits,
} from './money.ts';

function item(over: Partial<OrderItem> = {}): OrderItem {
  return {
    menuId: 'MN1',
    name: 'Nasi Goreng',
    price: 15000,
    qty: 1,
    notes: '',
    costPrice: 10000,
    ...over,
  };
}

/* ==========================================================================
   Format & parse
   ========================================================================= */

test('formatRupiah memakai pemisah ribuan Indonesia', () => {
  assert.equal(formatRupiah(15000), 'Rp 15.000');
  assert.equal(formatRupiah(1000000), 'Rp 1.000.000');
  assert.equal(formatRupiah(0), 'Rp 0');
  assert.equal(formatRupiah(999), 'Rp 999');
  assert.equal(formatRupiah(-2500), '-Rp 2.500');
});

test('parseRupiah menerima bentuk umum dan menolak sampah', () => {
  assert.equal(parseRupiah('Rp 15.000'), 15000);
  assert.equal(parseRupiah('15000'), 15000);
  assert.equal(parseRupiah('15.000'), 15000);
  assert.equal(parseRupiah(''), 0);
  assert.equal(parseRupiah('abc'), 0);
  assert.equal(parseRupiah('Rp'), 0);
});

test('parseRupiah(formatRupiah(n)) kembali ke n', () => {
  for (const n of [0, 1, 999, 1000, 15000, 1234567]) {
    assert.equal(parseRupiah(formatRupiah(n)), n, `gagal pada ${n}`);
  }
});

/* ==========================================================================
   Subtotal
   ========================================================================= */

test('lineTotal dan subtotalOf menjumlah dengan benar', () => {
  assert.equal(lineTotal({ price: 15000, qty: 3 }), 45000);

  const items = [
    item({ price: 15000, qty: 1 }),
    item({ price: 5000, qty: 2 }),
    item({ price: 100, qty: 1 }),
  ];
  assert.equal(subtotalOf(items), 15000 + 10000 + 100);
});

test('subtotalOf pada keranjang kosong = 0', () => {
  assert.equal(subtotalOf([]), 0);
});

/* ==========================================================================
   Diskon
   ========================================================================= */

test('diskon nominal dan persen dihitung benar', () => {
  assert.equal(discountAmountFor(100000, { type: 'amount', value: 15000 }), 15000);
  assert.equal(discountAmountFor(100000, { type: 'percent', value: 10 }), 10000);
  assert.equal(discountAmountFor(100000, { type: 'none', value: 999 }), 0);
});

test('diskon tidak pernah melebihi subtotal', () => {
  // Diskon 500rb pada keranjang 100rb harus dipangkas ke 100rb,
  // supaya total tidak pernah negatif.
  assert.equal(discountAmountFor(100000, { type: 'amount', value: 500000 }), 100000);
  assert.equal(discountAmountFor(100000, { type: 'percent', value: 150 }), 100000);
});

test('diskon persen negatif diperlakukan sebagai nol', () => {
  assert.equal(discountAmountFor(100000, { type: 'percent', value: -20 }), 0);
  assert.equal(discountAmountFor(100000, { type: 'amount', value: -5000 }), 0);
});

test('effectiveDiscountPercent membulatkan ke satu desimal', () => {
  assert.equal(effectiveDiscountPercent(100000, 10000), 10);
  assert.equal(effectiveDiscountPercent(30000, 10000), 33.3);
  assert.equal(effectiveDiscountPercent(0, 5000), 0);
});

/* ==========================================================================
   computeTotals
   ========================================================================= */

test('computeTotals: order sederhana tanpa pajak', () => {
  const items = [item({ price: 15000, qty: 1 }), item({ price: 100, qty: 1, costPrice: 10 })];
  const t = computeTotals({ items });

  assert.equal(t.subtotal, 15100);
  assert.equal(t.discountAmount, 0);
  assert.equal(t.netSubtotal, 15100);
  assert.equal(t.serviceAmount, 0);
  assert.equal(t.taxAmount, 0);
  assert.equal(t.total, 15100);
  assert.equal(t.totalCost, 10010);
  assert.equal(t.grossProfit, 5090);
  assert.equal(t.marginPercent, 33.7);
});

test('computeTotals: pajak + service, dasar termasuk service', () => {
  // subtotal 100000, service 5000, pajak 10% dari (100000+5000) = 10500
  const items = [item({ price: 100000, qty: 1, costPrice: 60000 })];
  const t = computeTotals({ items, taxPercent: 10, serviceAmount: 5000 });

  assert.equal(t.netSubtotal, 100000);
  assert.equal(t.serviceAmount, 5000);
  assert.equal(t.taxAmount, 10500);
  assert.equal(t.total, 115500);
  assert.equal(t.totalCost, 60000);
});

test('computeTotals: taxBase "net" tidak menghitung service dalam dasar pajak', () => {
  const items = [item({ price: 100000, qty: 1 })];
  const t = computeTotals({ items, taxPercent: 10, serviceAmount: 5000, taxBase: 'net' });

  assert.equal(t.taxAmount, 10000, 'pajak hanya dari netSubtotal');
  assert.equal(t.total, 115000);
});

test('computeTotals: diskon mengurangi dasar pajak', () => {
  // subtotal 100000, diskon 20% = 20000 → net 80000
  // service 0, pajak 10% dari 80000 = 8000 → total 88000
  const items = [item({ price: 100000, qty: 1 })];
  const t = computeTotals({
    items,
    discount: { type: 'percent', value: 20 },
    taxPercent: 10,
  });

  assert.equal(t.discountAmount, 20000);
  assert.equal(t.netSubtotal, 80000);
  assert.equal(t.taxAmount, 8000);
  assert.equal(t.total, 88000);
});

test('INVARIAN: total selalu sama dengan jumlah komponen yang dibulatkan', () => {
  // Ini yang menjaga struk tercetak selalu cocok dengan totalnya.
  const cases = [
    { items: [item({ price: 33333, qty: 3 })], taxPercent: 11, serviceAmount: 1000 },
    { items: [item({ price: 1234, qty: 7 })], taxPercent: 10.5, serviceAmount: 999 },
    { items: [item({ price: 999, qty: 1 })], taxPercent: 7.77, serviceAmount: 1 },
    { items: [item({ price: 1, qty: 1 })], taxPercent: 100, serviceAmount: 0 },
    { items: [item({ price: 100000, qty: 2 })], taxPercent: 0, serviceAmount: 0 },
  ];

  for (const [i, c] of cases.entries()) {
    const t = computeTotals(c);
    assert.equal(
      t.total,
      t.netSubtotal + t.serviceAmount + t.taxAmount,
      `kasus ${i}: total != netSubtotal + service + tax`,
    );
    assert.equal(t.netSubtotal, t.subtotal - t.discountAmount, `kasus ${i}: net != subtotal - diskon`);
    assert.ok(t.total >= 0, `kasus ${i}: total negatif`);
    assert.ok(Number.isInteger(t.total), `kasus ${i}: total bukan bilangan bulat`);
  }
});

test('computeTotals: keranjang kosong tidak menghasilkan nilai aneh', () => {
  const t = computeTotals({ items: [], taxPercent: 10, serviceAmount: 1000 });
  assert.equal(t.subtotal, 0);
  assert.equal(t.total, 0, 'total harus 0, bukan biaya service sendirian');
  assert.equal(t.marginPercent, 0);
  assert.ok(Number.isFinite(t.marginPercent), 'margin tidak boleh NaN/Infinity');
});

test('computeTotals: pajak dan service negatif diperlakukan sebagai nol', () => {
  const t = computeTotals({ items: [item()], taxPercent: -10, serviceAmount: -5000 });
  assert.equal(t.taxAmount, 0);
  assert.equal(t.serviceAmount, 0);
  assert.equal(t.total, 15000);
});

test('computeTotals: margin negatif saat harga di bawah HPP', () => {
  const items = [item({ price: 5000, qty: 1, costPrice: 8000 })];
  const t = computeTotals({ items });
  assert.equal(t.grossProfit, -3000);
  assert.equal(t.marginPercent, -60);
});

/* ==========================================================================
   Kode unik
   ========================================================================= */

test('uniqueCodeFromSequence stabil dan unik dalam rentang', () => {
  assert.equal(uniqueCodeFromSequence(1), 1);
  assert.equal(uniqueCodeFromSequence(2), 2);
  assert.equal(uniqueCodeFromSequence(1), uniqueCodeFromSequence(1), 'harus stabil');

  const seen = new Set<number>();
  for (let i = 1; i <= 999; i++) seen.add(uniqueCodeFromSequence(i));
  assert.equal(seen.size, 999, 'harus 999 nilai unik untuk 999 order');
});

test('uniqueCodeFromSequence membungkus di luar rentang', () => {
  assert.equal(uniqueCodeFromSequence(1000), 1);
  assert.equal(uniqueCodeFromSequence(0), 999, 'urutan 0 membungkus ke akhir');
});

/* ==========================================================================
   Kode unik: metode mana yang memakainya
   ========================================================================= */

test('needsUniqueCode hanya untuk metode yang dicocokkan ke mutasi bank', () => {
  assert.equal(needsUniqueCode('qris_static'), true);
  assert.equal(needsUniqueCode('qris_gateway'), true);
  assert.equal(needsUniqueCode('transfer'), true);

  // Tunai & debit diselesaikan kasir di tempat: nominalnya harus bulat.
  assert.equal(needsUniqueCode('cash'), false);
  assert.equal(needsUniqueCode('debit'), false);
  // Split dipecah jadi metode di bawahnya; tidak berdiri sendiri.
  assert.equal(needsUniqueCode('split'), false);
});

test('pembayaran tunai tidak menambah kode unik', () => {
  // Kasus nyata yang pernah salah: order tunai Rp 63.800 diminta jadi
  // Rp 63.811, dan kembalian di layar kasir berbeda dari yang tercatat.
  const total = 63_800;
  const kode = needsUniqueCode('cash') ? uniqueCodeFromSequence(11) : 0;

  assert.equal(kode, 0);
  assert.equal(amountDueWithUniqueCode(total, kode), total, 'tunai harus bulat');
  assert.equal(cashChange(100_000, amountDueWithUniqueCode(total, kode)), 36_200);
});

test('pembayaran QRIS tetap memakai kode unik', () => {
  const total = 63_800;
  const kode = needsUniqueCode('qris_static') ? uniqueCodeFromSequence(11) : 0;

  assert.equal(kode, 11);
  assert.equal(amountDueWithUniqueCode(total, kode), 63_811);
});

test('amountDueWithUniqueCode menambahkan kode ke total', () => {
  assert.equal(amountDueWithUniqueCode(15000, 7), 15007);
  assert.equal(amountDueWithUniqueCode(15000, 0), 15000);
});

/* ==========================================================================
   Tunai
   ========================================================================= */

test('cashChange tidak pernah negatif', () => {
  assert.equal(cashChange(50000, 15100), 34900);
  assert.equal(cashChange(15100, 15100), 0);
  assert.equal(cashChange(10000, 15100), 0, 'kurang bayar bukan kembalian negatif');
});

test('quickCashOptions selalu memuat nominal pas dan semua >= total', () => {
  const due = 15100;
  const opts = quickCashOptions(due);
  assert.ok(opts.includes(due), 'harus ada opsi bayar pas');
  for (const o of opts) assert.ok(o >= due, `opsi ${o} lebih kecil dari total ${due}`);
  assert.deepEqual(opts, [...opts].sort((a, b) => a - b), 'harus terurut');
  assert.ok(opts.length <= 6);
});

test('quickCashOptions pada total 0 mengembalikan daftar kosong', () => {
  assert.deepEqual(quickCashOptions(0), []);
});

/* ==========================================================================
   Split
   ========================================================================= */

test('validateSplits menerima split yang menutup tepat', () => {
  const r = validateSplits(
    [
      { method: 'cash', amount: 10000 },
      { method: 'qris_gateway', amount: 5100 },
    ],
    15100,
  );
  assert.equal(r.valid, true);
  assert.equal(r.difference, 0);
  assert.equal(r.total, 15100);
});

test('validateSplits menolak split kurang atau lebih', () => {
  const kurang = validateSplits([{ method: 'cash', amount: 10000 }], 15100);
  assert.equal(kurang.valid, false);
  assert.equal(kurang.difference, 5100);

  const lebih = validateSplits([{ method: 'cash', amount: 20000 }], 15100);
  assert.equal(lebih.valid, false);
  assert.equal(lebih.difference, -4900);
});

test('halveAmount selalu berjumlah tepat sama dengan input', () => {
  for (const n of [0, 1, 100, 15100, 15101, 99999]) {
    const [a, b] = halveAmount(n);
    assert.equal(a + b, n, `gagal pada ${n}`);
    assert.ok(a >= b, `sisa pembulatan harus di bagian pertama (${n})`);
  }
});

/* ==========================================================================
   Laporan
   ========================================================================= */

test('summarizeReport menghitung pendapatan, laba, dan rata-rata', () => {
  const r = summarizeReport([
    { total: 15100, totalCost: 10010 },
    { total: 30000, totalCost: 20000 },
  ]);
  assert.equal(r.orderCount, 2);
  assert.equal(r.revenue, 45100);
  assert.equal(r.cost, 30010);
  assert.equal(r.grossProfit, 15090);
  assert.equal(r.averageOrderValue, 22550);
  assert.ok(r.marginPercent > 33 && r.marginPercent < 34);
});

test('summarizeReport pada daftar kosong tidak membagi nol', () => {
  const r = summarizeReport([]);
  assert.equal(r.orderCount, 0);
  assert.equal(r.revenue, 0);
  assert.equal(r.averageOrderValue, 0);
  assert.equal(r.marginPercent, 0);
  assert.ok(Number.isFinite(r.marginPercent));
});
