import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_THEME } from '../domain/theme.ts';
import { pasangTema, setTheme, temaAwal } from './theme.ts';

test('tanpa apa-apa, tema jatuh ke bawaan', () => {
  assert.equal(temaAwal('', null), DEFAULT_THEME);
  assert.equal(temaAwal(null, null), DEFAULT_THEME);
});

test('pilihan tersimpan dipakai kalau URL tidak menentukan', () => {
  assert.equal(temaAwal('', 'terang'), 'terang');
  assert.equal(temaAwal(null, 'gelap'), 'gelap');
});

test('URL mengalahkan pilihan tersimpan', () => {
  // Ini yang membuat satu TV bisa dipasang gelap tanpa menyentuh
  // perangkatnya, walaupun perangkat itu terakhir dipakai dengan tema terang.
  assert.equal(temaAwal('?tema=gelap', 'terang'), 'gelap');
  assert.equal(temaAwal('?tema=fokus', 'terang'), 'fokus');
});

test('URL dengan parameter lain tetap terbaca', () => {
  assert.equal(temaAwal('?store=kopi-senja&tema=terang', 'gelap'), 'terang');
  assert.equal(temaAwal('?tema=terang&store=x', null), 'terang');
});

test('nilai asing dilewati, bukan dipakai', () => {
  // Sisa versi lama: temanya sudah dihapus tapi masih tersimpan di perangkat.
  assert.equal(temaAwal('?tema=neon', 'terang'), 'terang', 'URL asing → simpanan');
  assert.equal(temaAwal('?tema=neon', 'tema-hapus'), DEFAULT_THEME, 'dua-duanya asing → bawaan');
  assert.equal(temaAwal('?tema=', 'gelap'), 'gelap', 'kosong dianggap tidak ada');
  assert.equal(temaAwal('?tema=FOKUS', null), DEFAULT_THEME, 'peka huruf besar-kecil');
});

test('pasangTema aman dipanggil tanpa document', () => {
  // Modul ini dimuat juga oleh tes yang jalan di Node tanpa DOM. Kalau
  // fungsi ini melempar di sana, seluruh berkas tes ikut gagal.
  assert.equal(typeof document, 'undefined');
  assert.doesNotThrow(() => pasangTema('gelap'));
});

test('setTheme menolak nama yang tidak dikenal', () => {
  // Tanpa penjagaan ini, nilai asing akan lolos ke `data-theme` dan seluruh
  // token warna hilang — halaman tampil tanpa gaya sama sekali.
  assert.doesNotThrow(() => setTheme('neon' as never));
});
