import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ATTEMPTS, MemoryOutboxStore, Outbox, retryDelayMs } from './outbox.ts';

/* ==========================================================================
   Dasar
   ========================================================================= */

test('entri baru masuk antrean dengan penanda unik', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', { total: 36000 });

  assert.equal(outbox.size(), 1);
  assert.equal(e.op, 'createOrder');
  assert.equal(e.status, 'pending');
  assert.equal(e.attempts, 0);
  // Penanda ini yang membuat kiriman ulang bisa dikenali server.
  assert.ok(e.clientRef.length > 0);
  assert.notEqual(e.clientRef, e.id);
});

test('penanda unik bisa ditentukan pemanggil', () => {
  // Dipakai saat nomor order sudah dibuat lebih dulu di sisi klien, sehingga
  // kiriman ulang membawa penanda yang sama persis.
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {}, 'ref-tetap');
  assert.equal(e.clientRef, 'ref-tetap');
});

test('entri baru langsung siap dikirim', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  outbox.add('createOrder', {});
  assert.equal(outbox.due().length, 1);
});

/* ==========================================================================
   Siklus kirim
   ========================================================================= */

test('pengiriman menambah jumlah percobaan', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {});
  outbox.markSending(e.id);

  const [tercatat] = outbox.all();
  assert.equal(tercatat?.attempts, 1);
  assert.equal(tercatat?.status, 'sending');
  assert.ok(tercatat?.lastAttemptAt);
});

test('berhasil dikirim berarti keluar dari antrean', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {});
  outbox.markDone(e.id);
  assert.equal(outbox.size(), 0);
});

test('setelah gagal, entri menunggu jeda sebelum dicoba lagi', () => {
  // Tanpa jeda, antrean yang gagal semua akan menembak backend tanpa henti
  // dan memperparah keadaan yang sedang bermasalah.
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {});
  outbox.markSending(e.id);
  outbox.markFailed(e.id, 'jaringan putus');

  const sekarang = Date.now();
  assert.equal(outbox.due(sekarang).length, 0);
  assert.equal(outbox.due(sekarang + retryDelayMs(1) + 50).length, 1);
});

test('pesan galat terakhir disimpan untuk ditampilkan', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {});
  outbox.markSending(e.id);
  outbox.markFailed(e.id, 'kuota habis');
  assert.equal(outbox.all()[0]?.lastError, 'kuota habis');
});

test('setelah habis percobaan, entri berhenti dicoba tapi tidak dihapus', () => {
  // Menghapusnya berarti pekerjaan kasir hilang tanpa jejak. Lebih baik
  // terlihat sebagai kegagalan yang bisa ditangani manusia.
  const outbox = new Outbox(new MemoryOutboxStore());
  const e = outbox.add('createOrder', {});

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    outbox.markSending(e.id);
    outbox.markFailed(e.id, 'server mati');
  }

  const [akhir] = outbox.all();
  assert.equal(akhir?.status, 'failed');
  assert.equal(outbox.size(), 1);
  // Tidak pernah masuk daftar siap kirim lagi, kapan pun dicek.
  assert.equal(outbox.due(Date.now() + 10 * 60_000).length, 0);
  // Tapi tidak lagi dihitung sebagai pekerjaan yang menunggu.
  assert.equal(outbox.pending().length, 0);
});

/* ==========================================================================
   Urutan & penyaringan
   ========================================================================= */

test('yang paling lama menunggu dikirim lebih dulu', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  const a = outbox.add('createOrder', { n: 1 });
  const b = outbox.add('recordPayment', { n: 2 });

  // Waktu dibuat dipaksa berbeda supaya urutannya tidak bergantung pada
  // kecepatan mesin saat tes berjalan.
  const semua = outbox.all().map((x) => ({
    ...x,
    createdAt: x.id === a.id ? '2026-09-28T08:00:00.000Z' : '2026-09-28T09:00:00.000Z',
  }));
  const store = new MemoryOutboxStore();
  store.write(semua);
  const ulang = new Outbox(store);

  assert.deepEqual(
    ulang.due().map((x) => x.id),
    [a.id, b.id],
  );
});

test('has menandai operasi yang masih menunggu', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  outbox.add('createOrder', {});
  assert.equal(outbox.has('createOrder'), true);
  assert.equal(outbox.has('recordPayment'), false);
});

/* ==========================================================================
   Ketahanan
   ========================================================================= */

test('antrean bertahan setelah dibuat ulang', () => {
  // Ini yang membuat order tidak hilang saat halaman ditutup atau dimuat ulang.
  const store = new MemoryOutboxStore();
  const pertama = new Outbox(store);
  pertama.add('createOrder', { total: 36000 });
  pertama.add('recordPayment', { id: 'o1' });

  const kedua = new Outbox(store);
  assert.equal(kedua.size(), 2);
});

test('pendengar diberi tahu setiap ada perubahan', () => {
  const outbox = new Outbox(new MemoryOutboxStore());
  let panggilan = 0;
  const lepas = outbox.subscribe(() => {
    panggilan += 1;
  });

  const e = outbox.add('createOrder', {});
  outbox.markSending(e.id);
  outbox.markDone(e.id);
  assert.equal(panggilan, 3);

  lepas();
  outbox.add('createOrder', {});
  assert.equal(panggilan, 3);
});

test('jeda percobaan bertambah dua kali lipat lalu berhenti di batas atas', () => {
  assert.equal(retryDelayMs(0), 0);
  assert.equal(retryDelayMs(1), 2_000);
  assert.equal(retryDelayMs(2), 4_000);
  assert.equal(retryDelayMs(3), 8_000);
  // Dibatasi supaya tidak menunggu berhari-hari setelah banyak kegagalan.
  assert.equal(retryDelayMs(20), 5 * 60_000);
});
