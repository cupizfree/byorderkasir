/**
 * Uji penulis XLSX.
 *
 * Uji di sini tidak sekadar memanggil `buildXlsx` lalu memeriksa panjang byte:
 * arsip ZIP-nya dibaca ulang dengan pembaca kecil di bawah, lalu XML tiap
 * bagian diperiksa isinya. CRC32 dihitung ulang dengan cara yang berbeda dari
 * implementasi (bitwise, tanpa tabel) supaya kesalahan di tabel CRC tidak ikut
 * lolos.
 *
 * Dijalankan dengan test runner bawaan Node:
 *   node --test src/domain/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildXlsx } from './xlsx.ts';
import type { XlsxSheet } from './xlsx.ts';

/* ==========================================================================
   Pembaca ZIP untuk verifikasi
   ========================================================================= */

interface ReadEntry {
  name: string;
  data: Uint8Array;
  /** CRC32 seperti yang tercatat di central directory. */
  crc: number;
  /** 0 = STORE. */
  method: number;
}

const decoder = new TextDecoder();

/** CRC32 referensi: bitwise per bit, tanpa tabel — sengaja beda dari implementasi. */
function crc32Reference(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(bytes: Uint8Array): Map<string, ReadEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'End of Central Directory tidak ditemukan');

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const entries = new Map<string, ReadEntry>();
  for (let i = 0; i < entryCount; i++) {
    assert.equal(
      view.getUint32(pointer, true),
      0x02014b50,
      `signature central directory salah pada entri ${i}`,
    );
    const method = view.getUint16(pointer + 10, true);
    const crc = view.getUint32(pointer + 16, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;

    assert.equal(
      view.getUint32(localOffset, true),
      0x04034b50,
      `signature local header salah untuk ${name}`,
    );
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + size);

    entries.set(name, { name, data, crc, method });
  }

  assert.equal(entries.size, entryCount, 'jumlah entri di central directory tidak cocok');
  return entries;
}

function entryText(zip: Map<string, ReadEntry>, name: string): string {
  const entry = zip.get(name);
  assert.ok(entry, `entri ${name} tidak ada di arsip`);
  return decoder.decode(entry.data);
}

function sheetXmlOf(sheets: readonly XlsxSheet[], sheetNumber = 1): string {
  return entryText(readZip(buildXlsx(sheets)), `xl/worksheets/sheet${sheetNumber}.xml`);
}

/** Nama sheet seperti yang tertulis di xl/workbook.xml. */
function sheetNamesOf(sheets: readonly XlsxSheet[]): string[] {
  const workbook = entryText(readZip(buildXlsx(sheets)), 'xl/workbook.xml');
  return [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1] as string);
}

/* ==========================================================================
   Struktur arsip
   ========================================================================= */

test('buildXlsx menghasilkan entri ZIP yang diwajibkan', () => {
  const zip = readZip(buildXlsx([{ name: 'Penjualan', rows: [['Total', 15000]] }]));

  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(zip.has(name), `entri ${name} tidak ada`);
  }
});

test('semua entri memakai STORE sehingga isinya bisa dibaca langsung', () => {
  const zip = readZip(buildXlsx([{ name: 'S', rows: [['x']] }]));
  for (const entry of zip.values()) {
    assert.equal(entry.method, 0, `${entry.name} bukan STORE`);
  }
});

test('CRC32 tiap entri cocok dengan perhitungan independen', () => {
  const zip = readZip(
    buildXlsx([
      { name: 'Satu', rows: [['Kopi & Teh', 15000, true]] },
      { name: 'Dua', rows: [['é', null]] },
    ]),
  );
  for (const entry of zip.values()) {
    assert.equal(
      entry.crc,
      crc32Reference(entry.data),
      `CRC32 ${entry.name} tidak cocok (isi: ${entryText(zip, entry.name).slice(0, 40)})`,
    );
  }
});

test('keluaran deterministik untuk masukan yang sama', () => {
  const input: XlsxSheet[] = [{ name: 'S', rows: [['x', 1, true]] }];
  assert.deepEqual([...buildXlsx(input)], [...buildXlsx(input)]);
});

test('[Content_Types].xml mencantumkan workbook dan semua worksheet', () => {
  const types = entryText(
    readZip(buildXlsx([{ name: 'A', rows: [] }, { name: 'B', rows: [] }])),
    '[Content_Types].xml',
  );

  assert.ok(types.includes('PartName="/xl/workbook.xml"'), types);
  assert.ok(types.includes('PartName="/xl/worksheets/sheet1.xml"'), types);
  assert.ok(types.includes('PartName="/xl/worksheets/sheet2.xml"'), types);
  assert.ok(types.includes('Extension="rels"'), types);
  // Default harus mendahului Override menurut skema OPC.
  assert.ok(types.indexOf('<Default') < types.indexOf('<Override'), types);
});

test('beberapa sheet menghasilkan worksheet dan relasi yang cocok', () => {
  const zip = readZip(
    buildXlsx([
      { name: 'Satu', rows: [['a']] },
      { name: 'Dua', rows: [['b']] },
    ]),
  );

  assert.ok(zip.has('xl/worksheets/sheet1.xml'));
  assert.ok(zip.has('xl/worksheets/sheet2.xml'));

  const workbook = entryText(zip, 'xl/workbook.xml');
  assert.ok(workbook.includes('<sheet name="Satu" sheetId="1" r:id="rId1"/>'), workbook);
  assert.ok(workbook.includes('<sheet name="Dua" sheetId="2" r:id="rId2"/>'), workbook);
  assert.ok(
    workbook.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'),
    workbook,
  );

  const rels = entryText(zip, 'xl/_rels/workbook.xml.rels');
  assert.ok(
    rels.includes(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    ),
    rels,
  );
  assert.ok(rels.includes('Target="worksheets/sheet2.xml"'), rels);

  assert.ok(entryText(zip, 'xl/worksheets/sheet1.xml').includes('>a<'));
  assert.ok(entryText(zip, 'xl/worksheets/sheet2.xml').includes('>b<'));
});

/* ==========================================================================
   Nilai sel
   ========================================================================= */

test('angka jadi sel numerik, teks jadi inlineStr, boolean jadi t="b"', () => {
  const xml = sheetXmlOf([
    { name: 'S', rows: [['Nasi Goreng', 15000, true, false, null, undefined]] },
  ]);

  assert.ok(
    xml.includes('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Nasi Goreng</t></is></c>'),
    xml,
  );
  assert.ok(xml.includes('<c r="B1"><v>15000</v></c>'), 'angka harus sel numerik tanpa atribut t');
  assert.ok(xml.includes('<c r="C1" t="b"><v>1</v></c>'), xml);
  assert.ok(xml.includes('<c r="D1" t="b"><v>0</v></c>'), xml);
  assert.ok(!xml.includes('r="E1"'), 'null harus jadi sel kosong');
  assert.ok(!xml.includes('r="F1"'), 'undefined harus jadi sel kosong');
});

test('teks tidak pernah masuk ke sharedStrings', () => {
  const zip = readZip(buildXlsx([{ name: 'S', rows: [['Kopi']] }]));
  assert.ok(!zip.has('xl/sharedStrings.xml'), 'sharedStrings seharusnya tidak dibuat');
});

test('angka tak hingga ditulis sebagai teks, bukan <v>NaN</v>', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [[Number.NaN, Number.POSITIVE_INFINITY]] }]);

  assert.ok(!xml.includes('<v>NaN</v>'), xml);
  assert.ok(!xml.includes('<v>Infinity</v>'), xml);
  assert.ok(xml.includes('>NaN<'), xml);
  assert.ok(xml.includes('>Infinity<'), xml);
});

test('angka nol dan negatif tetap ditulis sebagai angka', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [[0, -2500, 1.5]] }]);
  assert.ok(xml.includes('<c r="A1"><v>0</v></c>'), xml);
  assert.ok(xml.includes('<c r="B1"><v>-2500</v></c>'), xml);
  assert.ok(xml.includes('<c r="C1"><v>1.5</v></c>'), xml);
});

test('teks kosong menghasilkan sel inlineStr kosong, bukan sel hilang', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['']] }]);
  assert.ok(xml.includes('<c r="A1" t="inlineStr"><is><t/></is></c>'), xml);
});

/* ==========================================================================
   Escaping
   ========================================================================= */

test('teks di-escape untuk &, <, >, dan "', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['Kopi & Teh <panas> "spesial"']] }]);

  assert.ok(xml.includes('Kopi &amp; Teh &lt;panas&gt; &quot;spesial&quot;'), xml);
  assert.ok(!xml.includes('Kopi & Teh'), 'ampersand mentah tidak boleh lolos');
  assert.ok(!xml.includes('<panas>'), 'tag mentah tidak boleh lolos');
});

test('kutip tunggal juga di-escape', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [["Kopi 'manis'"]] }]);
  assert.ok(xml.includes('Kopi &apos;manis&apos;'), xml);
});

test('karakter kontrol dibuang, tab dan baris baru dipertahankan', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['a\u0000b\u0007c\u001bd']] }]);
  assert.ok(xml.includes('>abcd<'), xml);

  const multiline = sheetXmlOf([{ name: 'S', rows: [['baris1\nbaris2\ttab']] }]);
  assert.ok(multiline.includes('>baris1\nbaris2\ttab<'), multiline);
});

test('tidak ada karakter kontrol terlarang di bagian XML mana pun', () => {
  const zip = readZip(buildXlsx([{ name: 'S', rows: [['x\u0000y', 1]] }]));
  for (const entry of zip.values()) {
    const text = decoder.decode(entry.data);
    assert.ok(
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text),
      `${entry.name} masih memuat karakter kontrol`,
    );
  }
});

test('nama sheet juga di-escape di workbook.xml', () => {
  const names = sheetNamesOf([{ name: 'Rekap & Laba <2024>', rows: [] }]);
  const workbook = entryText(
    readZip(buildXlsx([{ name: 'Rekap & Laba <2024>', rows: [] }])),
    'xl/workbook.xml',
  );
  assert.equal(names.length, 1);
  assert.ok(workbook.includes('name="Rekap &amp; Laba &lt;2024&gt;"'), workbook);
});

/* ==========================================================================
   Nama sheet
   ========================================================================= */

test('nama sheet dibersihkan dari karakter terlarang', () => {
  assert.deepEqual(sheetNamesOf([{ name: 'Rekap/Bulan:*?[]', rows: [] }]), ['RekapBulan']);
  assert.deepEqual(sheetNamesOf([{ name: 'a[b]c:d*e?f/g\\h', rows: [] }]), ['abcdefgh']);
});

test('nama sheet dipotong sampai 31 karakter', () => {
  const long = 'x'.repeat(40);
  const names = sheetNamesOf([{ name: long, rows: [] }]);
  assert.equal(names.length, 1);
  assert.equal(names[0]?.length, 31);
  assert.equal(names[0], 'x'.repeat(31));
});

test('nama sheet kosong atau hanya karakter terlarang memakai nama cadangan', () => {
  const names = sheetNamesOf([
    { name: '', rows: [] },
    { name: '   ', rows: [] },
    { name: '///', rows: [] },
  ]);
  assert.deepEqual(names, ['Sheet1', 'Sheet2', 'Sheet3']);
});

test('nama sheet yang bentrok setelah dibersihkan dibuat unik', () => {
  const names = sheetNamesOf([
    { name: 'A/B', rows: [] },
    { name: 'A?B', rows: [] },
    { name: 'A:B', rows: [] },
    { name: 'ab', rows: [] },
  ]);
  assert.deepEqual(names, ['AB', 'AB (2)', 'AB (3)', 'ab (4)']);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
});

/* ==========================================================================
   Lebar kolom
   ========================================================================= */

test('widths menghasilkan elemen cols sebelum sheetData', () => {
  const xml = sheetXmlOf([
    { name: 'S', rows: [['Nama', 'Harga']], widths: [24, 12] },
  ]);

  assert.ok(
    xml.includes(
      '<cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/></cols>',
    ),
    xml,
  );
  assert.ok(xml.indexOf('<cols>') < xml.indexOf('<sheetData>'), 'cols harus mendahului sheetData');
});

test('widths tidak wajar dilewati, bukan ditulis apa adanya', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['x']], widths: [0, -5, Number.NaN, 300] }]);

  assert.ok(!xml.includes('width="0"'), xml);
  assert.ok(!xml.includes('width="-5"'), xml);
  assert.ok(!xml.includes('width="NaN"'), xml);
  assert.ok(xml.includes('width="255"'), 'lebar di atas 255 harus dijepit');
});

test('tanpa widths tidak ada elemen cols', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['x']] }]);
  assert.ok(!xml.includes('<cols>'), xml);
});

/* ==========================================================================
   Kasus tepi
   ========================================================================= */

test('sheet tanpa baris tetap menghasilkan sheetData kosong', () => {
  const xml = sheetXmlOf([{ name: 'Kosong', rows: [] }]);
  assert.ok(xml.includes('<sheetData/>'), xml);
  assert.ok(xml.includes('</worksheet>'), xml);
  assert.ok(!xml.includes('<row'), xml);
});

test('baris kosong dilewati tapi nomor baris berikutnya tetap benar', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [[], [], ['tiga']] }]);

  assert.ok(!xml.includes('<row r="1"'), xml);
  assert.ok(!xml.includes('<row r="2"'), xml);
  assert.ok(
    xml.includes('<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">tiga</t></is></c></row>'),
    xml,
  );
});

test('baris yang hanya berisi null/undefined dianggap kosong', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [[null, undefined], [null, 7]] }]);
  assert.ok(!xml.includes('<row r="1"'), xml);
  assert.ok(xml.includes('<row r="2"><c r="B2"><v>7</v></c></row>'), xml);
});

test('sel kosong di tengah baris tidak menggeser kolom berikutnya', () => {
  const xml = sheetXmlOf([{ name: 'S', rows: [['a', null, 'c']] }]);
  assert.ok(xml.includes('<c r="A1"'), xml);
  assert.ok(!xml.includes('r="B1"'), xml);
  assert.ok(xml.includes('<c r="C1"'), xml);
});

test('referensi kolom melewati Z dengan benar', () => {
  const row = Array.from({ length: 28 }, (_, i) => i + 1);
  const xml = sheetXmlOf([{ name: 'S', rows: [row] }]);

  assert.ok(xml.includes('<c r="Z1"><v>26</v></c>'), xml);
  assert.ok(xml.includes('<c r="AA1"><v>27</v></c>'), xml);
  assert.ok(xml.includes('<c r="AB1"><v>28</v></c>'), xml);
});

test('daftar sheet kosong tetap menghasilkan workbook yang bisa dibuka', () => {
  const zip = readZip(buildXlsx([]));

  assert.ok(zip.has('xl/worksheets/sheet1.xml'), 'harus ada satu sheet kosong');
  assert.deepEqual(
    [...entryText(zip, 'xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]),
    ['Sheet1'],
  );
});
