/**
 * Penulisan CSV.
 *
 * Dipakai untuk mengunduh laporan supaya bisa dibuka di Excel atau alat lain.
 * Dua hal yang sering dilewatkan dan di sini ditangani:
 *
 *  1. **Pemisah kolom berbeda menurut lokal.** Excel berlokal Indonesia
 *     memakai titik koma, bukan koma. Berkas dengan koma akan terbaca sebagai
 *     satu kolom panjang — jadi pemisahnya bisa dipilih.
 *
 *  2. **Rumus yang disisipkan lewat data.** Sel yang dimulai dengan `=`, `+`,
 *     `-`, atau `@` akan dieksekusi Excel saat berkas dibuka. Nama menu atau
 *     catatan pelanggan bisa berisi apa saja, termasuk teks seperti
 *     `=1+1` atau yang lebih berbahaya. Setiap sel seperti itu diberi awalan
 *     kutip tunggal supaya diperlakukan sebagai teks.
 */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvOptions {
  /** Pemisah kolom. Bawaan koma. Excel berlokal Indonesia: pakai `;`. */
  delimiter?: string;
  /**
   * Awali berkas dengan BOM. Tanpa ini Excel sering salah membaca huruf
   * beraksen dan karakter non-ASCII.
   */
  bom?: boolean;
}

/** Karakter yang membuat Excel menafsirkan sel sebagai rumus. */
const AWALAN_RUMUS = /^[=+\-@\t\r]/;

function teksDasar(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // Angka tak hingga dan NaN tidak punya bentuk CSV yang masuk akal.
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    // Laporan ini dibaca manusia, bukan diimpor ulang, jadi ditulis dalam
    // bahasa yang dipakai pembacanya.
    return value ? 'Ya' : 'Tidak';
  }
  return value;
}

export function csvCell(value: CsvValue, delimiter = ','): string {
  let teks = teksDasar(value);

  // Cegah penyisipan rumus — tapi hanya untuk teks.
  //
  // Angka negatif seperti -1500 juga dimulai dengan tanda minus, dan
  // menambahkan kutip di depannya justru mengubahnya jadi teks sehingga tidak
  // bisa dijumlahkan lagi di Excel. Karena angka ditulis tanpa kutip, Excel
  // memperlakukannya sebagai angka, bukan rumus.
  if (typeof value === 'string' && AWALAN_RUMUS.test(teks)) teks = `'${teks}`;

  const perluKutip =
    teks.includes(delimiter) || teks.includes('"') || teks.includes('\n') || teks.includes('\r');

  if (!perluKutip) return teks;
  return `"${teks.replaceAll('"', '""')}"`;
}

/**
 * Susun teks CSV lengkap.
 *
 * Baris diakhiri CRLF mengikuti RFC 4180 — itu yang paling diterima luas,
 * termasuk oleh Excel di Windows.
 */
export function buildCsv(
  rows: readonly (readonly CsvValue[])[],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ',';
  const isi = rows.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join('\r\n');

  return options.bom === false ? isi : `\uFEFF${isi}`;
}

/**
 * Nama berkas yang aman untuk semua sistem operasi.
 *
 * Dibersihkan dari karakter yang dilarang di Windows, dan spasi diganti tanda
 * hubung supaya tidak perlu dikutip saat ditulis di terminal.
 */
export function safeFileName(name: string, extension: string): string {
  const bersih = name
    .replaceAll(/[\\/:*?"<>|]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80);
  return `${bersih || 'laporan'}.${extension}`;
}
