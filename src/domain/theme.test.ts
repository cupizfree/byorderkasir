import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_THEME,
  THEME_INFO,
  THEME_LIST,
  THEMES,
  infoTema,
  isThemeId,
  tataLetakTema,
} from './theme.ts';

test('tema bawaan ada di dalam daftar', () => {
  assert.ok(THEMES.includes(DEFAULT_THEME));
});

test('setiap tema punya info lengkap', () => {
  for (const id of THEMES) {
    const info = THEME_INFO[id];
    assert.equal(info.id, id);
    assert.ok(info.label.length > 0, `${id} tidak punya label`);
    assert.ok(info.deskripsi.length > 0, `${id} tidak punya deskripsi`);
    assert.equal(typeof info.gelap, 'boolean');
    // Pratinjau dirender langsung sebagai warna CSS, jadi harus berbentuk
    // warna yang sah — kalau tidak, kotak pratinjaunya tampil kosong.
    for (const [nama, warna] of Object.entries(info.contoh)) {
      assert.match(warna, /^#[0-9a-f]{6}$/, `contoh.${nama} tema ${id} bukan warna hex`);
    }
  }
});

test('daftar tema mengikuti urutan THEMES', () => {
  assert.deepEqual(
    THEME_LIST.map((t) => t.id),
    [...THEMES],
  );
});

test('tema pertama di daftar adalah tema bawaan', () => {
  // Pengaturan merender THEME_LIST apa adanya; yang pertama harus yang dipakai
  // saat pertama kali dibuka, supaya tidak ada tema yang "menang" tanpa alasan.
  assert.equal(THEME_LIST[0]?.id, DEFAULT_THEME);
});

test('hanya ada satu tema bertata letak fokus', () => {
  const fokus = THEME_LIST.filter((t) => t.tataLetak === 'fokus');
  assert.equal(fokus.length, 1);
  assert.equal(fokus[0]?.id, 'fokus');
});

test('isThemeId menerima nama yang dikenal saja', () => {
  assert.equal(isThemeId('fokus'), true);
  assert.equal(isThemeId('gelap'), true);
  assert.equal(isThemeId('terang'), true);
  assert.equal(isThemeId('FOKUS'), false, 'harus peka huruf besar-kecil');
  assert.equal(isThemeId('terang '), false, 'spasi tidak boleh diloloskan');
  assert.equal(isThemeId(''), false);
  assert.equal(isThemeId(null), false);
  assert.equal(isThemeId(undefined), false);
  assert.equal(isThemeId(7), false);
  assert.equal(isThemeId({}), false);
  assert.equal(isThemeId(['fokus']), false);
});

test('infoTema jatuh ke bawaan untuk nilai asing', () => {
  // localStorage dan ?tema= bisa berisi sisa versi lama. Yang tidak dikenal
  // harus jatuh ke bawaan, bukan menghasilkan tema tanpa token.
  assert.equal(infoTema('tema-yang-sudah-dihapus').id, DEFAULT_THEME);
  assert.equal(infoTema(undefined).id, DEFAULT_THEME);
  assert.equal(infoTema(null).id, DEFAULT_THEME);
  assert.equal(infoTema('').id, DEFAULT_THEME);
  assert.equal(infoTema('gelap').id, 'gelap');
});

test('tataLetakTema mengikuti infonya', () => {
  assert.equal(tataLetakTema('fokus'), 'fokus');
  assert.equal(tataLetakTema('gelap'), 'papan');
  assert.equal(tataLetakTema('terang'), 'papan');
  assert.equal(tataLetakTema('tidak-ada'), 'fokus', 'asing → bawaan');
});
