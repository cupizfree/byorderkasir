/**
 * Uji pemetaan galat server → `RepositoryError`.
 *
 * Yang diuji di sini bukan pesan galatnya, melainkan KODE-nya. Dari kode itu
 * antrean tulis luring memutuskan apakah sebuah kegagalan dikirim ulang atau
 * tidak, jadi salah memetakan punya akibat nyata:
 *
 *  - kegagalan jaringan dianggap penolakan → tulisan kasir hilang diam-diam
 *  - penolakan dianggap kegagalan jaringan → antrean berputar tanpa henti
 *
 * Berkas ini sengaja tidak memuat SDK Supabase sama sekali — itu sebabnya
 * pemetaannya dipisah ke `errors.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toRepositoryError } from './errors.ts';
import { RepositoryError } from '../repository.ts';

test('galat yang sudah RepositoryError diteruskan apa adanya', () => {
  const asli = new RepositoryError('sudah benar', 'conflict');
  assert.equal(toRepositoryError(asli), asli);
});

test('TypeError dari fetch berarti jaringan, bukan penolakan', () => {
  // Ini yang terjadi saat perangkat benar-benar luring. Kalau ini dipetakan
  // ke `server`, antrean luring tidak akan pernah mengirim ulang tulisan
  // kasir — dan tulisan itu hilang tanpa jejak.
  const e = toRepositoryError(new TypeError('Failed to fetch'));
  assert.equal(e.code, 'network');
});

test('SQLSTATE sesi tidak sah → unauthorized', () => {
  assert.equal(toRepositoryError({ code: '28000', message: 'Sesi tidak ditemukan' }).code, 'unauthorized');
});

test('SQLSTATE peran tidak berhak → unauthorized', () => {
  assert.equal(toRepositoryError({ code: '42501', message: 'Peran kitchen tidak berhak' }).code, 'unauthorized');
});

test('SQLSTATE data tidak ditemukan → not_found', () => {
  assert.equal(toRepositoryError({ code: 'P0002', message: 'Order tidak ditemukan' }).code, 'not_found');
});

test('penolakan aturan bisnis → conflict, bukan network', () => {
  // Contohnya "Stok tidak cukup" dan "Order ini sudah tidak bisa dibatalkan".
  // Mengantrekannya hanya menunda kegagalan: dikirim ulang seratus kali pun
  // jawabannya tetap sama.
  const e = toRepositoryError({ code: 'P0001', message: 'Stok tidak cukup: tersisa 2, diminta 999' });
  assert.equal(e.code, 'conflict');
});

test('pelanggaran indeks unik dan kunci asing → conflict', () => {
  assert.equal(toRepositoryError({ code: '23505', message: 'duplicate key' }).code, 'conflict');
  assert.equal(toRepositoryError({ code: '23503', message: 'foreign key' }).code, 'conflict');
});

test('nilai masukan tidak sah → invalid', () => {
  assert.equal(toRepositoryError({ code: '22023', message: 'Keranjang kosong' }).code, 'invalid');
  assert.equal(toRepositoryError({ code: '23514', message: 'check violation' }).code, 'invalid');
  assert.equal(toRepositoryError({ code: '22P02', message: 'invalid input syntax' }).code, 'invalid');
});

test('kode HTTP dari PostgREST dipetakan juga', () => {
  assert.equal(toRepositoryError({ code: '401', message: 'JWT' }).code, 'unauthorized');
  assert.equal(toRepositoryError({ code: '403', message: 'forbidden' }).code, 'unauthorized');
  assert.equal(toRepositoryError({ code: '404', message: 'not found' }).code, 'not_found');
  assert.equal(toRepositoryError({ code: '409', message: 'conflict' }).code, 'conflict');
  assert.equal(toRepositoryError({ code: '400', message: 'bad request' }).code, 'invalid');
});

test('429 berarti jaringan: terlalu banyak permintaan akan sembuh sendiri', () => {
  assert.equal(toRepositoryError({ code: '429', message: 'rate limited' }).code, 'network');
});

test('pesan bergaya jaringan dikenali walau kodenya tidak ada', () => {
  assert.equal(toRepositoryError({ message: 'Load failed' }).code, 'network');
  assert.equal(toRepositoryError({ message: 'Network request failed' }).code, 'network');
});

test('galat tak dikenal jadi server — dan itu TIDAK dikirim ulang', () => {
  // Sengaja: galat yang tidak kita pahami lebih baik muncul di layar daripada
  // berputar di antrean tanpa henti.
  assert.equal(toRepositoryError({ code: 'XX000', message: 'internal error' }).code, 'server');
  assert.equal(toRepositoryError({}).code, 'server');
  assert.equal(toRepositoryError(null).code, 'server');
  assert.equal(toRepositoryError(undefined).code, 'server');
});

test('pesan galat ikut terbawa supaya bisa ditampilkan ke kasir', () => {
  const e = toRepositoryError({ code: 'P0001', message: 'Stok tidak cukup: tersisa 2, diminta 999' });
  assert.equal(e.message, 'Stok tidak cukup: tersisa 2, diminta 999');
  assert.equal(e.name, 'RepositoryError');
});

test('kode SQLSTATE menang atas pesan yang kebetulan berbunyi seperti jaringan', () => {
  // Kalau pesan menang, penolakan sah yang kebetulan memuat kata "failed"
  // akan dikirim ulang selamanya oleh antrean.
  const e = toRepositoryError({ code: 'P0001', message: 'Load failed: order sudah dibatalkan' });
  assert.equal(e.code, 'conflict');
});
