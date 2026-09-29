import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER_FLOW,
  awaitingPayment,
  canCallQueue,
  canCancel,
  canStartCooking,
  canTransition,
  forRevenue,
  isActive,
  isDone,
  isPaid,
  isTerminal,
  nextStatus,
  orderCode,
  orderHeadline,
  paymentMethodLabel,
  sequenceFromOrderCode,
  statusLabel,
  statusTone,
  tableLabel,
  urgencyOf,
  waitingMinutes,
} from './orders.ts';

/* ==========================================================================
   Dasar hitung laporan keuangan
   ========================================================================= */

const order = (status: string, bayar: string) => ({
  status: status as never,
  payment: { status: bayar as never },
});

test('omzet hanya menghitung order yang sudah dibayar', () => {
  const daftar = [
    order('completed', 'paid'),
    order('ready', 'paid'),
    order('pending', 'unpaid'),
    order('processing', 'unpaid'),
  ];

  assert.equal(forRevenue(daftar).length, 2);
});

test('order yang dibatalkan tidak pernah masuk omzet meski sudah dibayar', () => {
  // Kasus nyata: pelanggan sudah bayar lalu ordernya dibatalkan dan uangnya
  // dikembalikan. Kalau order ini ikut dihitung, omzet jadi terlalu besar.
  const daftar = [order('completed', 'paid'), order('cancelled', 'paid')];

  assert.equal(forRevenue(daftar).length, 1);
});

test('piutang adalah kebalikan omzet, dan keduanya tidak tumpang tindih', () => {
  const daftar = [
    order('completed', 'paid'),
    order('pending', 'unpaid'),
    order('ready', 'unpaid'),
    order('cancelled', 'unpaid'),
  ];

  const omzet = forRevenue(daftar);
  const piutang = awaitingPayment(daftar);

  assert.equal(omzet.length, 1);
  assert.equal(piutang.length, 2);
  // Jumlah keduanya harus sama dengan order yang tidak dibatalkan — tidak ada
  // order yang terhitung dua kali atau hilang dari dua-duanya.
  assert.equal(omzet.length + piutang.length, 3);
});

/* ==========================================================================
   Transisi status
   ========================================================================= */

test('alur normal pending → processing → ready → completed', () => {
  assert.ok(canTransition('pending', 'processing'));
  assert.ok(canTransition('processing', 'ready'));
  assert.ok(canTransition('ready', 'completed'));
});

test('tidak boleh melompati tahap dapur', () => {
  assert.equal(
    canTransition('pending', 'completed'),
    false,
    'order tidak boleh langsung selesai tanpa lewat dapur',
  );
  assert.equal(canTransition('pending', 'ready'), false);
  assert.equal(canTransition('processing', 'completed'), false);
});

test('tidak boleh mundur', () => {
  assert.equal(canTransition('processing', 'pending'), false);
  assert.equal(canTransition('ready', 'processing'), false);
  assert.equal(canTransition('completed', 'ready'), false);
});

test('pembatalan hanya dari status aktif', () => {
  assert.ok(canCancel('pending'));
  assert.ok(canCancel('processing'));
  assert.ok(canCancel('ready'));
  assert.equal(canCancel('completed'), false, 'order selesai tidak bisa dibatalkan');
  assert.equal(canCancel('cancelled'), false);
});

test('yang boleh dipanggil hanya order yang sudah siap', () => {
  // Papan antrian hanya menyiarkan order `ready` yang punya `calledAt`. Kalau
  // layar kasir memakai syarat lain — misalnya `canTransition(status, 'ready')`,
  // yang justru benar hanya untuk `processing` — tombol Panggil tidak pernah
  // muncul saat pesanan benar-benar siap, dan pengumuman suara tidak berbunyi.
  assert.ok(canCallQueue('ready'), 'order siap harus bisa dipanggil');
  assert.equal(canCallQueue('pending'), false, 'order baru belum dipanggil');
  assert.equal(canCallQueue('processing'), false, 'masih dimasak, belum dipanggil');
  assert.equal(canCallQueue('completed'), false);
  assert.equal(canCallQueue('cancelled'), false);
});

test('syarat panggil tidak boleh disamakan dengan syarat transisi ke siap', () => {
  // Keduanya pernah tertukar. Dikunci di sini supaya tidak terulang.
  for (const s of ORDER_FLOW) {
    if (canCallQueue(s)) {
      assert.equal(
        canTransition(s, 'ready'),
        false,
        `status "${s}" memakai syarat transisi, bukan syarat panggil`,
      );
    }
  }
});

test('completed dan cancelled bersifat terminal', () => {
  assert.ok(isTerminal('completed'));
  assert.ok(isTerminal('cancelled'));
  assert.equal(isTerminal('pending'), false);
  assert.equal(isTerminal('processing'), false);
  assert.equal(isTerminal('ready'), false);
});

test('status terminal tidak punya transisi keluar', () => {
  for (const s of ['completed', 'cancelled'] as const) {
    assert.equal(nextStatus(s), null);
    for (const t of ORDER_FLOW) {
      assert.equal(canTransition(s, t), false, `${s} → ${t} harus ditolak`);
    }
  }
});

test('nextStatus mengikuti alur dan berhenti di terminal', () => {
  assert.equal(nextStatus('pending'), 'processing');
  assert.equal(nextStatus('processing'), 'ready');
  assert.equal(nextStatus('ready'), 'completed');
  assert.equal(nextStatus('completed'), null);
  assert.equal(nextStatus('cancelled'), null);
});

test('setiap status punya label dan nada warna', () => {
  for (const s of ORDER_FLOW.concat('cancelled')) {
    assert.ok(statusLabel(s).length > 0, `label kosong untuk ${s}`);
    assert.ok(statusTone(s).length > 0, `tone kosong untuk ${s}`);
  }
  assert.equal(statusLabel('pending'), 'Menunggu');
  assert.equal(statusLabel('completed'), 'Selesai');
});

test('isActive dan isDone saling melengkapi untuk status non-terminal', () => {
  for (const s of ORDER_FLOW) {
    if (isTerminal(s)) continue;
    assert.equal(
      isActive(s) !== isDone(s),
      true,
      `${s} harus tepat salah satu: aktif atau selesai`,
    );
  }
});

/* ==========================================================================
   Pembayaran
   ========================================================================= */

test('isPaid hanya benar untuk status paid', () => {
  assert.equal(isPaid({ status: 'paid' }), true);
  assert.equal(isPaid({ status: 'unpaid' }), false);
  assert.equal(isPaid({ status: 'refunded' }), false);
});

test('canStartCooking butuh order pending DAN sudah lunas', () => {
  assert.equal(canStartCooking({ status: 'pending', payment: { status: 'paid' } }), true);
  assert.equal(canStartCooking({ status: 'pending', payment: { status: 'unpaid' } }), false);
  assert.equal(canStartCooking({ status: 'processing', payment: { status: 'paid' } }), false);
});

test('setiap metode bayar punya label', () => {
  for (const m of ['cash', 'qris_gateway', 'qris_static', 'transfer', 'debit', 'split'] as const) {
    assert.ok(paymentMethodLabel(m).length > 0, `label kosong untuk ${m}`);
  }
});

/* ==========================================================================
   Kode order
   ========================================================================= */

test('orderCode memakai prefix kanal dan tanggal lokal toko', () => {
  assert.equal(orderCode('pos', '2026-09-28T07:00:00Z', 1), 'ORD-260928-0001');
  assert.equal(orderCode('self_order', '2026-09-28T07:00:00Z', 42), 'WEB-260928-0042');
});

test('orderCode memakai tanggal WIB, bukan UTC', () => {
  // 2026-09-28T17:30Z = 29 Sep 00:30 WIB
  assert.equal(orderCode('pos', '2026-09-28T17:30:00Z', 1), 'ORD-260929-0001');
  // 2026-09-28T16:30Z = 28 Sep 23:30 WIB
  assert.equal(orderCode('pos', '2026-09-28T16:30:00Z', 1), 'ORD-260928-0001');
});

test('orderCode memberi padding 4 digit dan melebar', () => {
  assert.equal(orderCode('pos', '2026-09-28T07:00:00Z', 7), 'ORD-260928-0007');
  assert.equal(orderCode('pos', '2026-09-28T07:00:00Z', 12345), 'ORD-260928-12345');
});

test('sequenceFromOrderCode membaca balik nomor urut', () => {
  assert.equal(sequenceFromOrderCode('ORD-260928-0001'), 1);
  assert.equal(sequenceFromOrderCode('WEB-260928-0042'), 42);
  assert.equal(sequenceFromOrderCode('sampah'), 0);
});

/* ==========================================================================
   Tampilan
   ========================================================================= */

test('tableLabel menangani meja dan bawa pulang', () => {
  assert.equal(tableLabel(4), 'Meja 4');
  assert.equal(tableLabel(null), 'Bawa pulang');
});

test('orderHeadline mengutamakan nomor antrian', () => {
  assert.equal(orderHeadline({ queueNumber: 'A-07', code: 'ORD-1', tableNumber: 4 }), 'A-07');
  assert.equal(orderHeadline({ queueNumber: null, code: 'ORD-1', tableNumber: 4 }), 'ORD-1');
});

test('waitingMinutes menghitung dari createdAt sampai sekarang', () => {
  const created = '2026-09-28T07:00:00Z';
  const now = new Date('2026-09-28T07:20:00Z');
  assert.equal(waitingMinutes({ createdAt: created, completedAt: null }, now), 20);
});

test('waitingMinutes berhenti di completedAt', () => {
  assert.equal(
    waitingMinutes(
      { createdAt: '2026-09-28T07:00:00Z', completedAt: '2026-09-28T07:10:00Z' },
      new Date('2026-09-28T09:00:00Z'),
    ),
    10,
  );
});

test('waitingMinutes tidak pernah negatif', () => {
  assert.equal(
    waitingMinutes({ createdAt: '2026-09-28T09:00:00Z', completedAt: null }, new Date('2026-09-28T07:00:00Z')),
    0,
  );
});

test('urgencyOf menandai order yang terlambat', () => {
  assert.equal(urgencyOf(0), 'fresh');
  assert.equal(urgencyOf(7), 'fresh');
  assert.equal(urgencyOf(8), 'normal');
  assert.equal(urgencyOf(14), 'normal');
  assert.equal(urgencyOf(15), 'late');
  assert.equal(urgencyOf(120), 'late');
});
