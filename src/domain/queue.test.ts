import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareQueueLabels,
  formatQueueNumber,
  freshQueue,
  needsDailyReset,
  nextQueue,
  parseQueueNumber,
} from './queue.ts';

test('formatQueueNumber memberi padding dua digit', () => {
  assert.equal(formatQueueNumber(1), 'A-01');
  assert.equal(formatQueueNumber(7), 'A-07');
  assert.equal(formatQueueNumber(99), 'A-99');
});

test('formatQueueNumber melebar, tidak memotong angka', () => {
  assert.equal(formatQueueNumber(100), 'A-100');
  assert.equal(formatQueueNumber(1234), 'A-1234');
});

test('formatQueueNumber mendukung prefix kustom dan tanpa prefix', () => {
  assert.equal(formatQueueNumber(3, 'B'), 'B-03');
  assert.equal(formatQueueNumber(3, ''), '03');
});

test('formatQueueNumber menangani nilai tidak masuk akal', () => {
  assert.equal(formatQueueNumber(0), 'A-01');
  assert.equal(formatQueueNumber(-5), 'A-01');
});

test('parseQueueNumber membaca kembali label', () => {
  assert.deepEqual(parseQueueNumber('A-07'), { prefix: 'A', number: 7 });
  assert.deepEqual(parseQueueNumber('B-100'), { prefix: 'B', number: 100 });
  assert.deepEqual(parseQueueNumber('a-3'), { prefix: 'A', number: 3 });
  assert.deepEqual(parseQueueNumber('12'), { prefix: '', number: 12 });
});

test('parseQueueNumber menolak input tidak valid', () => {
  assert.equal(parseQueueNumber(''), null);
  assert.equal(parseQueueNumber('abc'), null);
  assert.equal(parseQueueNumber('-'), null);
});

test('format lalu parse menghasilkan nilai yang sama', () => {
  for (const n of [1, 9, 42, 100, 999]) {
    const parsed = parseQueueNumber(formatQueueNumber(n, 'C'));
    assert.equal(parsed?.number, n);
    assert.equal(parsed?.prefix, 'C');
  }
});

/* ==========================================================================
   Reset harian
   ========================================================================= */

test('needsDailyReset mendeteksi pergantian hari', () => {
  const state = { prefix: 'A', lastNumber: 5, dateKey: '2026-09-28' };
  assert.equal(needsDailyReset(state, '2026-09-28'), false);
  assert.equal(needsDailyReset(state, '2026-09-29'), true);
});

test('nextQueue memulai dari 1 pada state kosong', () => {
  const r = nextQueue(null, '2026-09-28');
  assert.equal(r.number, 1);
  assert.equal(r.label, 'A-01');
  assert.equal(r.didReset, true);
});

test('nextQueue menaikkan nomor dalam hari yang sama', () => {
  const s1 = nextQueue(null, '2026-09-28');
  const s2 = nextQueue(s1.state, '2026-09-28');
  const s3 = nextQueue(s2.state, '2026-09-28');

  assert.equal(s1.number, 1);
  assert.equal(s2.number, 2);
  assert.equal(s3.number, 3);
  assert.equal(s2.didReset, false);
  assert.equal(s3.label, 'A-03');
});

test('nextQueue mereset ke 1 pada hari berikutnya', () => {
  const akhirHari = { prefix: 'A', lastNumber: 42, dateKey: '2026-09-28' };
  const r = nextQueue(akhirHari, '2026-09-29');

  assert.equal(r.number, 1);
  assert.equal(r.didReset, true);
  assert.equal(r.state.dateKey, '2026-09-29');
  assert.equal(r.state.lastNumber, 1);
});

test('nextQueue mengganti prefix bila diminta', () => {
  const s = freshQueue('A', '2026-09-28');
  const r = nextQueue(s, '2026-09-28', 'B');
  assert.equal(r.label, 'B-01');
  assert.equal(r.state.prefix, 'B');
});

test('nextQueue tidak memutasi state masukan', () => {
  const state = { prefix: 'A', lastNumber: 5, dateKey: '2026-09-28' };
  const salinan = { ...state };
  nextQueue(state, '2026-09-28');
  assert.deepEqual(state, salinan, 'state lama harus tidak berubah');
});

test('urutan 100 order menghasilkan 100 label unik', () => {
  let state = freshQueue('A', '2026-09-28');
  const labels = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const r = nextQueue(state, '2026-09-28');
    state = r.state;
    labels.add(r.label);
  }
  assert.equal(labels.size, 100);
  assert.ok(labels.has('A-100'));
});

/* ==========================================================================
   Pengurutan
   ========================================================================= */

test('compareQueueLabels mengurutkan numerik, bukan leksikografis', () => {
  // Ini yang salah kalau memakai perbandingan string biasa:
  // "A-10" < "A-2" secara leksikografis, padahal 10 > 2.
  const labels = ['A-10', 'A-2', 'A-1', 'A-21', 'A-3'];
  labels.sort(compareQueueLabels);
  assert.deepEqual(labels, ['A-1', 'A-2', 'A-3', 'A-10', 'A-21']);
});

test('compareQueueLabels menaruh order tanpa nomor di akhir', () => {
  const labels: (string | null)[] = ['A-2', null, 'A-1'];
  labels.sort(compareQueueLabels);
  assert.deepEqual(labels, ['A-1', 'A-2', null]);
});

test('compareQueueLabels memisahkan prefix', () => {
  const labels = ['B-1', 'A-2', 'A-1'];
  labels.sort(compareQueueLabels);
  assert.deepEqual(labels, ['A-1', 'A-2', 'B-1']);
});
