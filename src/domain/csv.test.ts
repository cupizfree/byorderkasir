import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCsv, csvCell, safeFileName } from './csv.ts';

/* ==========================================================================
   Escaping
   ========================================================================= */

test('teks biasa dibiarkan apa adanya', () => {
  assert.equal(csvCell('Nasi Goreng'), 'Nasi Goreng');
});

test('sel yang memuat pemisah dikutip', () => {
  assert.equal(csvCell('Nasi Goreng, Pedas'), '"Nasi Goreng, Pedas"');
});

test('tanda kutip di dalam sel digandakan', () => {
  assert.equal(csvCell('Es Teh "Jumbo"'), '"Es Teh ""Jumbo"""');
});

test('baris baru di dalam sel dikutip', () => {
  assert.equal(csvCell('Baris satu\nBaris dua'), '"Baris satu\nBaris dua"');
});

test('pemisah titik koma dihormati', () => {
  // Excel berlokal Indonesia memakai titik koma; koma biasa akan terbaca
  // sebagai satu kolom panjang.
  assert.equal(csvCell('Nasi, Goreng', ';'), 'Nasi, Goreng');
  assert.equal(csvCell('Nasi; Goreng', ';'), '"Nasi; Goreng"');
});

/* ==========================================================================
   Penyisipan rumus
   ========================================================================= */

test('sel yang dimulai dengan = tidak dieksekusi Excel', () => {
  // Nama menu atau catatan pelanggan bisa berisi apa saja. Tanpa penanganan
  // ini, Excel akan menjalankan isinya saat berkas dibuka.
  assert.equal(csvCell('=1+1'), "'=1+1");
});

test('awalan berbahaya lain juga diamankan', () => {
  for (const bahaya of ['+SUM(A1)', '-2+3', '@import', '\tTAB']) {
    assert.ok(csvCell(bahaya).startsWith("'"), `${bahaya} seharusnya diamankan`);
  }
});

test('teks yang mengandung tanda sama dengan di tengah aman', () => {
  // Hanya AWALAN yang berbahaya, bukan setiap tanda sama dengan.
  assert.equal(csvCell('Harga = 10rb'), 'Harga = 10rb');
});

/* ==========================================================================
   Tipe nilai
   ========================================================================= */

test('angka ditulis sebagai angka, bukan teks berformat', () => {
  // Kalau ditulis "Rp 36.000", Excel tidak bisa menjumlahkannya — padahal
  // justru itu alasan laporan diunduh.
  assert.equal(csvCell(36000), '36000');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(-1500), '-1500');
});

test('angka tak hingga dan NaN menjadi sel kosong', () => {
  assert.equal(csvCell(Number.POSITIVE_INFINITY), '');
  assert.equal(csvCell(Number.NaN), '');
});

test('kosong dan undefined menjadi sel kosong', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('boolean ditulis dalam bahasa pembacanya', () => {
  assert.equal(csvCell(true), 'Ya');
  assert.equal(csvCell(false), 'Tidak');
});

/* ==========================================================================
   Berkas utuh
   ========================================================================= */

test('baris digabung dengan CRLF mengikuti RFC 4180', () => {
  const csv = buildCsv(
    [
      ['Kode', 'Total'],
      ['ORD-1', 36000],
    ],
    { bom: false },
  );
  assert.equal(csv, 'Kode,Total\r\nORD-1,36000');
});

test('BOM ditambahkan secara bawaan', () => {
  const csv = buildCsv([['Nama']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(buildCsv([['Nama']], { bom: false }).startsWith('\uFEFF'), false);
});

test('berkas kosong tetap menghasilkan teks yang sah', () => {
  assert.equal(buildCsv([], { bom: false }), '');
});

test('sel kosong di tengah baris tetap dipertahankan', () => {
  // Penting supaya kolom tidak bergeser: meja kosong pada order kasir tidak
  // boleh membuat kolom berikutnya naik satu posisi.
  assert.equal(buildCsv([['A', '', 'C']], { bom: false }), 'A,,C');
});

/* ==========================================================================
   Nama berkas
   ========================================================================= */

test('nama berkas dibersihkan dari karakter terlarang', () => {
  assert.equal(safeFileName('Laporan: Order/2026*', 'csv'), 'laporan-order2026.csv');
});

test('spasi diganti tanda hubung', () => {
  assert.equal(safeFileName('Rekap Harian Kafe', 'csv'), 'rekap-harian-kafe.csv');
});

test('nama kosong tetap menghasilkan nama yang bisa dipakai', () => {
  assert.equal(safeFileName('   ', 'csv'), 'laporan.csv');
});
