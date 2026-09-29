import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MIN_QUIET_ZONE, QrError, qrMatrix, qrPathD, qrViewBoxSize } from './qr.ts';

/** Payload QRIS statis yang sama dengan fixture di qris.test.ts. */
const QRIS =
  '00020101021126660014ID.CO.QRIS.WWW01189360091400000000000215ID10200000000000303UMI' +
  '5204581253033605802ID5910KOPI SENJA6007JAKARTA6105121906304A4A4';

test('qrMatrix membuang zona tenang bawaan uqr', () => {
  const m = qrMatrix(QRIS, 'M');
  // Ukuran QR yang sah selalu 21 + 4k. Kalau quiet zone bawaan tidak dibuang,
  // angkanya akan 43 — bukan ukuran yang sah.
  assert.equal((m.size - 21) % 4, 0, `ukuran ${m.size} bukan 21 + 4k`);
  assert.equal(m.data.length, m.size, 'tinggi matriks tidak sesuai');
  assert.equal(m.data[0]!.length, m.size, 'lebar matriks tidak sesuai');
});

test('qrMatrix menghasilkan modul boolean', () => {
  const m = qrMatrix('halo', 'M');
  for (const row of m.data) {
    for (const cell of row) assert.equal(typeof cell, 'boolean');
  }
});

test('qrMatrix menempatkan pola pencari 7x7 di tiga sudut', () => {
  const { size, data } = qrMatrix(QRIS, 'M');

  /**
   * Pola pencari: cincin gelap 7x7, cincin terang di dalamnya, inti gelap 3x3.
   *
   * Perhatikan: QR hanya punya TIGA pola pencari (kiri-atas, kanan-atas,
   * kiri-bawah). Sudut kanan-bawah berisi modul data, jadi tidak boleh
   * diasumsikan terang maupun gelap.
   */
  const periksaPencari = (ox: number, oy: number, nama: string) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const diCincinLuar = x === 0 || y === 0 || x === 6 || y === 6;
        const diInti = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const diharapkan = diCincinLuar || diInti;
        assert.equal(
          data[oy + y]![ox + x],
          diharapkan,
          `${nama}: modul (${x},${y}) salah`,
        );
      }
    }
  };

  periksaPencari(0, 0, 'kiri-atas');
  periksaPencari(size - 7, 0, 'kanan-atas');
  periksaPencari(0, size - 7, 'kiri-bawah');
});

test('qrMatrix menempatkan pola penyelaras di versi 2 ke atas', () => {
  const { size, data } = qrMatrix(QRIS, 'M');
  assert.ok(size >= 25, `QRIS seharusnya versi 2+, dapat ${size}`);

  // Pusat pola penyelaras ada di koordinat 6 dan size-7.
  const pusat = size - 7;
  // Pola penyelaras 5x5: cincin gelap, isi terang, inti gelap.
  assert.equal(data[pusat]![pusat], true, 'inti penyelaras harus gelap');
  assert.equal(data[pusat - 1]![pusat - 1], false, 'cincin dalam harus terang');
  assert.equal(data[pusat - 2]![pusat - 2], true, 'cincin luar harus gelap');
});

test('qrMatrix menolak teks kosong', () => {
  assert.throws(() => qrMatrix('', 'M'), QrError);
});

test('qrMatrix menolak teks yang terlalu panjang', () => {
  assert.throws(() => qrMatrix('x'.repeat(5000), 'H'), QrError);
});

test('qrPathD menggambar tepat satu segmen per modul gelap', () => {
  const m = qrMatrix(QRIS, 'M');
  const gelap = m.data.flat().filter(Boolean).length;
  const d = qrPathD(m, 0);
  assert.equal(d.split('M').filter(Boolean).length, gelap);
});

test('qrPathD menggeser modul sebesar lebar zona tenang', () => {
  const m = qrMatrix('tes', 'M');
  const d = qrPathD(m, MIN_QUIET_ZONE);
  const koordinat: [number, number][] = [...d.matchAll(/M(\d+) (\d+)/g)].map((x) => [
    Number(x[1]),
    Number(x[2]),
  ]);
  const minX = Math.min(...koordinat.map((c) => c[0]));
  const minY = Math.min(...koordinat.map((c) => c[1]));
  assert.ok(minX >= MIN_QUIET_ZONE, `modul pertama di x=${minX}, harus >= ${MIN_QUIET_ZONE}`);
  assert.ok(minY >= MIN_QUIET_ZONE, `modul pertama di y=${minY}, harus >= ${MIN_QUIET_ZONE}`);
});

test('qrViewBoxSize menyertakan zona tenang di kedua sisi', () => {
  const m = qrMatrix(QRIS, 'M');
  assert.equal(qrViewBoxSize(m, 4), m.size + 8);
  assert.equal(qrViewBoxSize(m, 0), m.size);
});

test('qrMatrix dengan ECC lebih tinggi menghasilkan matriks lebih besar atau sama', () => {
  const m = qrMatrix(QRIS, 'L');
  const h = qrMatrix(QRIS, 'H');
  assert.ok(h.size >= m.size, 'ECC H seharusnya tidak lebih kecil dari L');
});

test('setiap ukuran yang dihasilkan selalu 21 + 4k', () => {
  for (const teks of ['a', 'halo dunia', QRIS, 'x'.repeat(200), 'y'.repeat(600)]) {
    const m = qrMatrix(teks, 'M');
    assert.equal((m.size - 21) % 4, 0, `teks ${teks.length} karakter → ukuran ${m.size}`);
  }
});
