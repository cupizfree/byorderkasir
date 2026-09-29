/**
 * Penulis XLSX minimal — tanpa dependensi.
 *
 * Berkas .xlsx sebenarnya cuma arsip ZIP berisi beberapa berkas XML
 * (ECMA-376). Jadi berkas ini terdiri dari dua bagian: penulis ZIP mode STORE
 * dan penyusun potongan XML-nya.
 *
 * Kenapa STORE, bukan deflate:
 *  - laporan yang kita hasilkan berukuran kecil, jadi ukuran berkas bukan
 *    masalah
 *  - tidak perlu `node:zlib`, sehingga modul ini tetap bisa dipakai di peramban
 *  - isi tiap entri bisa dibaca ulang hanya dengan menggeser offset
 *
 * Kenapa teks memakai `t="inlineStr"`, bukan sharedStrings: satu baris tabel
 * tidak perlu menunjuk ke tabel string terpisah, jadi ada lebih sedikit bagian
 * yang bisa salah. Excel dan LibreOffice sama-sama menerimanya.
 */

export interface XlsxSheet {
  name: string;
  rows: XlsxValue[][];
  /** Lebar kolom, indeks 0 = kolom A. Kolom yang tidak disebut memakai lebar bawaan. */
  widths?: number[];
}

export type XlsxValue = string | number | boolean | null | undefined;

/* ==========================================================================
   Konstanta format
   ========================================================================= */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Batas keras Excel: nama sheet lebih panjang dari ini membuat berkas ditolak. */
const MAX_SHEET_NAME_LENGTH = 31;

/** Excel juga menolak lebar kolom di luar rentang 0..255. */
const MAX_COLUMN_WIDTH = 255;

/**
 * Cap waktu tetap untuk entri ZIP. Dua pemanggilan dengan masukan sama
 * menghasilkan byte yang identik, sehingga keluaran bisa diuji dan di-hash;
 * kalau memakai waktu sekarang, hasilnya berubah tiap detik.
 * Format MS-DOS: 2024-01-01 00:00:00.
 */
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/* ==========================================================================
   Escaping XML
   ========================================================================= */

/**
 * Escape teks untuk isi elemen maupun nilai atribut.
 *
 * Karakter kontrol C0 dibuang, bukan di-escape: XML 1.0 tidak mengizinkan
 * keberadaannya sama sekali (kecuali tab, LF, CR), dan Excel menolak berkas
 * yang memuatnya. Membuangnya lebih baik daripada menghasilkan berkas rusak
 * hanya karena satu karakter sampah di nama menu.
 */
function escapeXml(value: string): string {
  let out = '';
  for (const char of value) {
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default: {
        const code = char.codePointAt(0) ?? 0;
        const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
        if (code < 0x20 && !isAllowedControl) break;
        // Surrogate setengah (tanpa pasangan) bukan karakter sah di XML.
        if (code >= 0xd800 && code <= 0xdfff) break;
        out += char;
      }
    }
  }
  return out;
}

/* ==========================================================================
   Penulis ZIP (mode STORE)
   ========================================================================= */

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
/** Bit 11: nama berkas dikodekan UTF-8. */
const ZIP_FLAG_UTF8 = 0x0800;
/** Versi minimum 2.0 = format ZIP yang mendukung kompresi dan direktori. */
const ZIP_VERSION = 20;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ (bytes[i] as number)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Susun arsip ZIP dari daftar entri. Ukuran dan CRC sudah diketahui sebelum
 * ditulis, jadi tidak perlu data descriptor setelah isi entri.
 */
function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, ZIP_LOCAL_SIGNATURE, true);
    localView.setUint16(4, ZIP_VERSION, true);
    localView.setUint16(6, ZIP_FLAG_UTF8, true);
    localView.setUint16(8, 0, true); // 0 = STORE
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true); // ukuran terkompresi = asli (STORE)
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // tanpa extra field
    local.set(nameBytes, 30);

    localChunks.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, ZIP_CENTRAL_SIGNATURE, true);
    centralView.setUint16(4, ZIP_VERSION, true); // versi pembuat
    centralView.setUint16(6, ZIP_VERSION, true); // versi minimum pembaca
    centralView.setUint16(8, ZIP_FLAG_UTF8, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, DOS_TIME, true);
    centralView.setUint16(14, DOS_DATE, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // tanpa extra field
    centralView.setUint16(32, 0, true); // tanpa komentar
    centralView.setUint16(34, 0, true); // nomor disk
    centralView.setUint16(36, 0, true); // atribut internal
    centralView.setUint32(38, 0, true); // atribut eksternal
    centralView.setUint32(42, offset, true); // offset local header
    central.set(nameBytes, 46);

    centralChunks.push(central);
    offset += local.length + entry.data.length;
  }

  const centralBytes = concatChunks(centralChunks);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, ZIP_EOCD_SIGNATURE, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralBytes.length, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true); // tanpa komentar arsip

  return concatChunks([...localChunks, centralBytes, eocd]);
}

/* ==========================================================================
   Nama sheet
   ========================================================================= */

/**
 * Excel menolak nama sheet yang memuat `[ ] : * ? / \`, lebih dari 31 karakter,
 * atau diawali/diakhiri apostrof. Nama kosong diganti nama cadangan supaya
 * sheet tidak pernah kehilangan identitas di UI.
 */
function sanitizeSheetName(raw: string, index: number): string {
  const cleaned = raw
    .replace(/[[\]:*?/\\]/g, '')
    .replace(/^'+|'+$/g, '')
    .trim();
  const fallback = cleaned === '' ? `Sheet${index + 1}` : cleaned;
  return fallback.slice(0, MAX_SHEET_NAME_LENGTH);
}

/**
 * Dua sheet dengan nama sama (tanpa peduli huruf besar/kecil) juga membuat
 * berkas ditolak, jadi bentrokan setelah pembersihan diberi akhiran urut.
 */
function uniqueSheetNames(sheets: readonly XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    const base = sanitizeSheetName(sheet.name, index);
    let name = base;
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${counter++})`;
      name = base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/* ==========================================================================
   Sel & baris
   ========================================================================= */

/** 0 → "A", 25 → "Z", 26 → "AA". */
function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function inlineStringCell(ref: string, text: string): string {
  if (text === '') return `<c r="${ref}" t="inlineStr"><is><t/></is></c>`;
  // xml:space="preserve" menjaga spasi di ujung teks, yang kalau tidak
  // ditandai akan dipangkas oleh pembaca XML.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/**
 * Satu sel. Mengembalikan string kosong untuk nilai kosong supaya pemanggil
 * bisa membuang selnya sekalian — sel kosong tanpa `<c>` sama artinya dan
 * menghasilkan berkas yang lebih kecil.
 */
function cellXml(ref: string, value: XlsxValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // NaN dan Infinity tidak punya bentuk numerik di Excel; sebagai teks
    // setidaknya isinya tidak hilang tanpa jejak.
    if (!Number.isFinite(value)) return inlineStringCell(ref, String(value));
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return inlineStringCell(ref, value);
}

function rowXml(rowNumber: number, values: readonly XlsxValue[]): string {
  const cells: string[] = [];
  for (let column = 0; column < values.length; column++) {
    const cell = cellXml(`${columnName(column)}${rowNumber}`, values[column]);
    if (cell !== '') cells.push(cell);
  }
  // Baris tanpa sel berguna tidak ditulis. Nomor baris berikutnya tetap benar
  // karena `r` dihitung dari indeks array, bukan dari urutan keluaran.
  if (cells.length === 0) return '';
  return `<row r="${rowNumber}">${cells.join('')}</row>`;
}

function colsXml(widths: readonly number[] | undefined): string {
  if (!widths || widths.length === 0) return '';
  const cols: string[] = [];
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) continue;
    const n = i + 1;
    const clamped = Math.min(width, MAX_COLUMN_WIDTH);
    cols.push(`<col min="${n}" max="${n}" width="${clamped}" customWidth="1"/>`);
  }
  return cols.length === 0 ? '' : `<cols>${cols.join('')}</cols>`;
}

/* ==========================================================================
   Bagian-bagian paket
   ========================================================================= */

function contentTypesXml(sheetCount: number): string {
  const overrides: string[] = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  ];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  }
  return (
    XML_HEADER +
    `<Types xmlns="${NS_CONTENT_TYPES}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.join('') +
    '</Types>'
  );
}

function rootRelsXml(): string {
  return (
    XML_HEADER +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  );
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    XML_HEADER +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(sheetCount: number): string {
  const rels: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`,
    );
  }
  // styles mendapat rId setelah semua sheet supaya penomoran worksheet tidak
  // bergeser saat jumlah sheet berubah.
  rels.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
  );
  return XML_HEADER + `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}

/**
 * styles.xml minimal. Isinya tidak dipakai untuk memformat apa pun, tapi
 * sebagian pembaca (terutama Excel versi lama) mengeluh kalau bagian ini
 * hilang. Dua `fill` wajib ada: index 0 = none, index 1 = gray125.
 */
const STYLES_XML =
  XML_HEADER +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  // Tanpa <cellStyles> ini sebagian pembaca (openpyxl, Excel versi lama)
  // menganggap buku kerja tidak punya gaya bawaan dan menolak membukanya.
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function sheetXml(sheet: XlsxSheet): string {
  const parts: string[] = [XML_HEADER, `<worksheet xmlns="${NS_MAIN}">`];

  const cols = colsXml(sheet.widths);
  if (cols !== '') parts.push(cols);

  const rows: string[] = [];
  for (let i = 0; i < sheet.rows.length; i++) {
    const row = rowXml(i + 1, sheet.rows[i] ?? []);
    if (row !== '') rows.push(row);
  }
  parts.push(rows.length === 0 ? '<sheetData/>' : `<sheetData>${rows.join('')}</sheetData>`);

  parts.push('</worksheet>');
  return parts.join('');
}

/* ==========================================================================
   API publik
   ========================================================================= */

/**
 * Bangun berkas .xlsx dari daftar sheet.
 *
 * Daftar sheet kosong tetap menghasilkan satu sheet kosong: workbook tanpa
 * sheet sama sekali bukan berkas yang sah, dan Excel menolaknya.
 */
export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const source: readonly XlsxSheet[] = sheets.length > 0 ? sheets : [{ name: '', rows: [] }];
  const names = uniqueSheetNames(source);
  const encoder = new TextEncoder();
  const encode = (xml: string): Uint8Array => encoder.encode(xml);

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encode(contentTypesXml(source.length)) },
    { name: '_rels/.rels', data: encode(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: encode(workbookXml(names)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encode(workbookRelsXml(source.length)) },
    { name: 'xl/styles.xml', data: encode(STYLES_XML) },
  ];

  for (let i = 0; i < source.length; i++) {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encode(sheetXml(source[i] as XlsxSheet)),
    });
  }

  return buildZip(entries);
}
