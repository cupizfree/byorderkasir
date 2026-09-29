/**
 * Unduh laporan: CSV dan Excel.
 *
 * Aplikasi aslinya hanya bisa menampilkan angka di layar — tidak ada satu pun
 * tombol unduh. Pemilik yang ingin menghitung HPP di Excel harus menyalin
 * manual dari tabel HTML.
 *
 * Dua format disediakan karena keduanya dipakai untuk hal berbeda:
 *
 *  - **CSV** untuk diolah lagi (Excel, Google Sheets, skrip). Ringan, dan
 *    angka ditulis sebagai angka sehingga bisa langsung dijumlahkan.
 *  - **Excel (.xlsx)** untuk dibuka apa adanya dan dibagikan ke orang lain —
 *    beberapa sheet sekaligus, dengan lebar kolom yang sudah diatur.
 */

import { buildCsv } from '../../domain/csv.ts';
import {
  type ReportTable,
  dailyReport,
  menuReport,
  orderItemReport,
  orderReport,
  stockReport,
} from '../../domain/reports.ts';
import { DEFAULT_TZ, dateKey } from '../../domain/time.ts';
import { forRevenue } from '../../domain/orders.ts';
import type { Order, StockMovement } from '../../domain/types.ts';
import { buildXlsx, type XlsxSheet } from '../../domain/xlsx.ts';

export interface ReportSet {
  order: ReportTable;
  item: ReportTable;
  harian: ReportTable;
  menu: ReportTable;
  stok: ReportTable;
}

export type ReportKey = keyof ReportSet;

export const REPORT_LABEL: Record<ReportKey, string> = {
  order: 'Rincian Order',
  item: 'Rincian Item',
  harian: 'Rekap Harian',
  menu: 'Kinerja Menu',
  stok: 'Riwayat Stok',
};

export const REPORT_HINT: Record<ReportKey, string> = {
  order: 'Satu baris per order: pembayaran, diskon, pajak, laba.',
  item: 'Satu baris per menu di dalam order — untuk melihat menu mana yang menguntungkan.',
  harian: 'Omzet, HPP, laba, dan margin per hari.',
  menu: 'Total terjual per menu, terurut dari yang paling laris.',
  stok: 'Seluruh pergerakan stok beserta saldo setelah tiap perubahan.',
};

/** Susun semua tabel laporan dari data yang sedang ditampilkan. */
export function buildReportSet(
  orders: readonly Order[],
  movements: readonly StockMovement[],
): ReportSet {
  // Rekap dan kinerja menu memakai dasar yang sama dengan angka di layar:
  // hanya order yang uangnya sudah masuk.
  //
  // Kalau keduanya berbeda, pemilik akan menemukan dua omzet berbeda untuk
  // periode yang sama — satu di layar, satu di berkas yang ia unduh — dan
  // tidak ada cara mengetahui mana yang benar.
  //
  // Dua laporan rincian tetap memuat SEMUA order, termasuk yang belum lunas,
  // karena gunanya memang sebagai catatan transaksi; kolom status bayarnya
  // yang membedakan.
  const lunas = forRevenue(orders);

  return {
    order: orderReport(orders),
    item: orderItemReport(orders),
    harian: dailyReport(lunas),
    menu: menuReport(lunas),
    stok: stockReport(movements),
  };
}

/** Nama berkas dengan tanggal supaya unduhan lama tidak saling menimpa. */
export function reportFileName(prefix: string, ext: string, at = new Date()): string {
  return `byorderkasir-${prefix}-${dateKey(at, DEFAULT_TZ)}.${ext}`;
}

/**
 * Picu unduhan di peramban.
 *
 * Objek URL dilepas setelah klik: tanpa itu, blob-nya tetap tertahan di
 * memori halaman selama tab hidup — dan laporan bisa berukuran megabita.
 */
function unduh(blob: Blob, namaBerkas: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Satu tabel sebagai CSV. */
export function downloadReportCsv(tabel: ReportTable): void {
  // Titik koma dipakai karena Excel berlokal Indonesia memisahkan kolom
  // dengan itu; dengan koma, seluruh baris masuk ke satu sel.
  const teks = buildCsv([tabel.header, ...tabel.rows], { delimiter: ';', bom: true });
  unduh(new Blob([teks], { type: 'text/csv;charset=utf-8' }), reportFileName(tabel.name, 'csv'));
}

/**
 * Susun daftar sheet Excel dari tabel laporan.
 *
 * Dipisah dari proses unduh supaya bisa diuji tanpa DOM — dan supaya kesalahan
 * seperti "judul kolom tidak ikut tertulis" tertangkap pengujian, bukan
 * tertangkap saat pemilik membuka berkasnya.
 */
export function buildSheets(set: ReportSet, urutan: readonly ReportKey[]): XlsxSheet[] {
  return urutan.map((k) => {
    const t = set[k];
    return {
      // Nama sheet memakai label yang sama dengan yang dilihat pengguna di
      // layar, bukan nama internal tabel.
      name: namaSheet(REPORT_LABEL[k]),
      // Judul kolom ditulis sebagai baris pertama.
      //
      // Penulis xlsx hanya menerima baris data — tidak ada field `header`
      // terpisah. Sebelumnya judul dikirim lewat field yang tidak ada, jadi
      // berkasnya keluar tanpa judul kolom sama sekali dan tetap "berhasil"
      // tanpa peringatan apa pun.
      rows: [[...t.header], ...t.rows.map((r) => [...r])],
      widths: t.widths ? [...t.widths] : undefined,
    };
  });
}

/**
 * Seluruh tabel sebagai satu berkas Excel, satu sheet per laporan.
 *
 * Nama sheet dibatasi 31 karakter dan tidak boleh memuat `[]:*?/\` — aturan
 * Excel, bukan aturan kita. Pelanggarannya membuat berkasnya ditolak saat
 * dibuka, jadi dibersihkan lebih dulu di sini.
 */
export function downloadReportXlsx(set: ReportSet, urutan: readonly ReportKey[]): void {
  const bytes = buildXlsx(buildSheets(set, urutan));
  // `Uint8Array` bisa jadi hanya potongan dari buffer yang lebih besar, dan
  // tipenya mengizinkan SharedArrayBuffer. Keduanya tidak diterima `Blob`,
  // jadi potongannya disalin dulu menjadi ArrayBuffer yang utuh dan pasti.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  unduh(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    reportFileName('laporan', 'xlsx'),
  );
}

const TERLARANG_SHEET = /[[\]:*?/\\]/g;

function namaSheet(mentah: string): string {
  const bersih = mentah.replace(TERLARANG_SHEET, '-').trim();
  const dipotong = bersih.slice(0, 31);
  return dipotong || 'Sheet';
}
