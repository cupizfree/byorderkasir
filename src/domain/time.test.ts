import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dateKey,
  daysBetween,
  endOfDay,
  formatDateLong,
  formatTime,
  humanizeDuration,
  lastNDaysRange,
  monthRange,
  startOfDay,
  todayRange,
  yearRange,
} from './time.ts';

/* ==========================================================================
   dateKey — inti dari perbaikan bug tengah malam WIB
   ========================================================================= */

test('dateKey memakai hari kalender WIB, bukan UTC', () => {
  // 2026-09-28 23:59 WIB = 2026-09-28T16:59:00Z
  assert.equal(dateKey('2026-09-28T16:59:00Z'), '2026-09-28');

  // 2026-09-29 00:01 WIB = 2026-09-28T17:01:00Z
  // Di UTC masih tanggal 28, tapi di toko sudah tanggal 29.
  assert.equal(
    dateKey('2026-09-28T17:01:00Z'),
    '2026-09-29',
    'order lewat tengah malam WIB harus masuk hari berikutnya',
  );
});

test('dateKey: jam 17:00 UTC tepat adalah pergantian hari WIB', () => {
  assert.equal(dateKey('2026-09-28T16:59:59Z'), '2026-09-28');
  assert.equal(dateKey('2026-09-28T17:00:00Z'), '2026-09-29');
});

test('dateKey menghormati zona waktu lain', () => {
  const at = '2026-09-28T17:30:00Z';
  assert.equal(dateKey(at, 'Asia/Jakarta'), '2026-09-29');
  assert.equal(dateKey(at, 'UTC'), '2026-09-28');
  assert.equal(dateKey(at, 'Asia/Makassar'), '2026-09-29'); // WITA +08
  assert.equal(dateKey(at, 'America/New_York'), '2026-09-28');
});

test('dateKey menerima Date maupun string', () => {
  const d = new Date('2026-09-28T17:30:00Z');
  assert.equal(dateKey(d), dateKey('2026-09-28T17:30:00Z'));
});

/* ==========================================================================
   Batas hari
   ========================================================================= */

test('startOfDay = 17:00 UTC hari sebelumnya untuk WIB', () => {
  // 00:00 WIB pada 29 Sep = 17:00 UTC pada 28 Sep
  assert.equal(startOfDay('2026-09-29T10:00:00Z'), '2026-09-28T17:00:00.000Z');
});

test('endOfDay = 16:59:59.999 UTC pada hari yang sama', () => {
  assert.equal(endOfDay('2026-09-29T10:00:00Z'), '2026-09-29T16:59:59.999Z');
});

test('startOfDay dan endOfDay membentuk rentang 24 jam', () => {
  const from = new Date(startOfDay('2026-09-29T10:00:00Z'));
  const to = new Date(endOfDay('2026-09-29T10:00:00Z'));
  const span = to.getTime() - from.getTime() + 1;
  assert.equal(span, 24 * 60 * 60 * 1000);
});

test('todayRange memuat waktu sekarang', () => {
  const { from, to } = todayRange();
  const now = Date.now();
  assert.ok(Date.parse(from) <= now, 'from harus <= sekarang');
  assert.ok(Date.parse(to) >= now, 'to harus >= sekarang');
});

test('lastNDaysRange mencakup N hari', () => {
  const { from, to } = lastNDaysRange(7);
  const days = daysBetween(from, to);
  assert.equal(days, 6, '7 hari inklusif = selisih 6 hari');
});

test('monthRange mencakup seluruh bulan berjalan', () => {
  const { from, to } = monthRange();
  const startKey = dateKey(from);
  const endKey = dateKey(to);

  assert.ok(startKey.endsWith('-01'), `awal bulan harus tanggal 01, dapat ${startKey}`);
  assert.equal(startKey.slice(0, 7), endKey.slice(0, 7), 'from dan to harus di bulan yang sama');

  // September punya 30 hari, jadi rentangnya 29 hari kalender.
  const [y, m] = startKey.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  assert.ok(endKey.endsWith(`-${String(lastDay).padStart(2, '0')}`), `akhir bulan harus tanggal ${lastDay}, dapat ${endKey}`);
  assert.equal(daysBetween(from, to), lastDay - 1);
});

test('yearRange mencakup 1 Januari sampai 31 Desember', () => {
  const { from, to } = yearRange();
  assert.ok(dateKey(from).endsWith('-01-01'), dateKey(from));
  assert.ok(dateKey(to).endsWith('-12-31'), dateKey(to));
  assert.equal(dateKey(from).slice(0, 4), dateKey(to).slice(0, 4));
});

/* ==========================================================================
   Selisih hari
   ========================================================================= */

test('daysBetween menghitung hari kalender lokal, bukan selisih jam', () => {
  // 23:59 WIB tanggal 28 → 00:01 WIB tanggal 29 = 1 hari kalender,
  // walaupun selisih jamnya hanya 2 menit.
  const a = '2026-09-28T16:59:00Z';
  const b = '2026-09-28T17:01:00Z';
  assert.equal(daysBetween(a, b), 1);
});

test('daysBetween pada hari yang sama = 0', () => {
  assert.equal(daysBetween('2026-09-28T01:00:00Z', '2026-09-28T15:00:00Z'), 0);
});

/* ==========================================================================
   Format tampilan
   ========================================================================= */

test('formatTime memakai jam 24 dan zona toko', () => {
  assert.equal(formatTime('2026-09-28T07:35:00Z'), '14.35');
  assert.equal(formatTime('2026-09-28T17:05:00Z'), '00.05');
});

test('formatDateLong memakai nama bulan Indonesia', () => {
  const s = formatDateLong('2026-09-28T07:00:00Z');
  assert.ok(s.includes('September'), s);
  assert.ok(s.includes('2026'), s);
  assert.ok(s.includes('28'), s);
});

/* ==========================================================================
   Durasi
   ========================================================================= */

test('humanizeDuration memformat jam, menit, detik', () => {
  assert.equal(humanizeDuration(0), '0m');
  assert.equal(humanizeDuration(-5000), '0m');
  assert.equal(humanizeDuration(30_000), '30s');
  assert.equal(humanizeDuration(5 * 60_000), '5m 0s');
  assert.equal(humanizeDuration(2 * 3_600_000 + 15 * 60_000), '2h 15m');
  assert.equal(humanizeDuration(45_000), '45s');
});
