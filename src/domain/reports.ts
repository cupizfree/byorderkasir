/**
 * Tabel laporan.
 *
 * Modul ini hanya menyusun bentuk tabelnya; penulisan berkasnya ada di
 * `csv.ts` (dan `xlsx.ts`). Pemisahan ini disengaja: satu definisi kolom
 * dipakai untuk semua format, jadi CSV dan Excel tidak mungkin berbeda isi.
 *
 * Satu keputusan yang penting: **nominal ditulis sebagai angka, bukan teks
 * "Rp 36.000"**. Kalau ditulis sebagai teks, Excel tidak bisa menjumlahkannya
 * dan pemilik harus membersihkan datanya dulu sebelum bisa dihitung — padahal
 * justru itu alasan ia mengunduh laporan.
 */

import type { CsvValue } from './csv.ts';
import { paymentMethodLabel, statusLabel } from './orders.ts';
import { dateKey, formatTime } from './time.ts';
import type { Order, StockMovement } from './types.ts';
import { stockReasonLabel } from './stock.ts';

export interface ReportTable {
  name: string;
  header: readonly string[];
  rows: readonly (readonly CsvValue[])[];
  /** Lebar kolom dalam satuan karakter — dipakai penulis Excel. */
  widths?: readonly number[];
}

const KANAL: Record<Order['channel'], string> = {
  pos: 'Kasir',
  self_order: 'Pesan sendiri',
};

const STATUS_BAYAR: Record<Order['payment']['status'], string> = {
  unpaid: 'Belum dibayar',
  paid: 'Lunas',
  refunded: 'Dikembalikan',
};

function jam(iso: string): string {
  return formatTime(new Date(iso));
}

function tanggal(iso: string): string {
  return dateKey(new Date(iso));
}

/**
 * Rincian per order — satu baris per order.
 *
 * Untuk pembukuan dan pencocokan dengan mutasi bank. Nomor meja ditulis
 * kosong (bukan 0) untuk order kasir, karena 0 akan terbaca sebagai "meja 0".
 */
export function orderReport(orders: readonly Order[]): ReportTable {
  return {
    name: 'Order',
    header: [
      'Kode',
      'Tanggal',
      'Jam',
      'Kanal',
      'Meja',
      'Pelanggan',
      'Kasir',
      'Status order',
      'Status bayar',
      'Metode bayar',
      'Subtotal',
      'Diskon',
      'Pajak',
      'Biaya layanan',
      'Total',
      'HPP',
      'Laba kotor',
      'Kode unik',
    ],
    widths: [22, 12, 8, 14, 7, 16, 12, 14, 14, 16, 12, 10, 10, 13, 12, 12, 12, 10],
    rows: orders.map((o) => [
      o.code,
      tanggal(o.createdAt),
      jam(o.createdAt),
      KANAL[o.channel],
      o.tableNumber ?? '',
      o.customerName,
      o.cashierName,
      statusLabel(o.status),
      STATUS_BAYAR[o.payment.status],
      paymentMethodLabel(o.payment.method),
      o.subtotal,
      o.discountAmount,
      o.taxAmount,
      o.serviceAmount,
      o.total,
      o.totalCost,
      o.total - o.totalCost,
      o.payment.uniqueCode,
    ]),
  };
}

/**
 * Rincian per item — satu baris per menu dalam tiap order.
 *
 * Ini yang dipakai untuk menjawab "menu apa yang paling menguntungkan",
 * karena satu order bisa berisi beberapa menu dengan margin berbeda.
 */
export function orderItemReport(orders: readonly Order[]): ReportTable {
  const rows: CsvValue[][] = [];

  for (const o of orders) {
    for (const it of o.items) {
      rows.push([
        o.code,
        tanggal(o.createdAt),
        KANAL[o.channel],
        it.name,
        it.qty,
        it.price,
        it.qty * it.price,
        it.costPrice,
        it.qty * it.costPrice,
        it.qty * (it.price - it.costPrice),
        it.notes,
      ]);
    }
  }

  return {
    name: 'Item Order',
    header: [
      'Kode order',
      'Tanggal',
      'Kanal',
      'Menu',
      'Jumlah',
      'Harga satuan',
      'Omzet',
      'HPP satuan',
      'HPP total',
      'Laba',
      'Catatan',
    ],
    widths: [22, 12, 14, 26, 8, 13, 12, 12, 12, 12, 24],
    rows,
  };
}

/** Rekap harian — satu baris per tanggal. */
export function dailyReport(orders: readonly Order[]): ReportTable {
  const peta = new Map<string, { order: number; omzet: number; hpp: number }>();

  for (const o of orders) {
    const kunci = tanggal(o.createdAt);
    const ada = peta.get(kunci) ?? { order: 0, omzet: 0, hpp: 0 };
    ada.order += 1;
    ada.omzet += o.total;
    ada.hpp += o.totalCost;
    peta.set(kunci, ada);
  }

  const baris = [...peta.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kunci, d]) => [
      kunci,
      d.order,
      d.omzet,
      d.hpp,
      d.omzet - d.hpp,
      // Dibagi omzet, bukan jumlah order — kalau pembaginya salah, hari tanpa
      // penjualan menghasilkan NaN dan seluruh kolom margin jadi rusak.
      d.omzet > 0 ? Math.round(((d.omzet - d.hpp) / d.omzet) * 1000) / 10 : 0,
    ]);

  return {
    name: 'Rekap Harian',
    header: ['Tanggal', 'Jumlah order', 'Omzet', 'HPP', 'Laba kotor', 'Margin (%)'],
    widths: [14, 13, 14, 14, 14, 11],
    rows: baris,
  };
}

/** Kinerja per menu — satu baris per menu. */
export function menuReport(orders: readonly Order[]): ReportTable {
  const peta = new Map<string, { nama: string; qty: number; omzet: number; hpp: number }>();

  for (const o of orders) {
    for (const it of o.items) {
      const ada = peta.get(it.menuId) ?? { nama: it.name, qty: 0, omzet: 0, hpp: 0 };
      ada.qty += it.qty;
      ada.omzet += it.qty * it.price;
      ada.hpp += it.qty * it.costPrice;
      peta.set(it.menuId, ada);
    }
  }

  const baris = [...peta.values()]
    .sort((a, b) => b.qty - a.qty)
    .map((d) => [
      d.nama,
      d.qty,
      d.omzet,
      d.hpp,
      d.omzet - d.hpp,
      d.omzet > 0 ? Math.round(((d.omzet - d.hpp) / d.omzet) * 1000) / 10 : 0,
    ]);

  return {
    name: 'Kinerja Menu',
    header: ['Menu', 'Jumlah terjual', 'Omzet', 'HPP', 'Laba kotor', 'Margin (%)'],
    widths: [28, 15, 14, 14, 14, 11],
    rows: baris,
  };
}

/** Riwayat pergerakan stok. */
export function stockReport(movements: readonly StockMovement[]): ReportTable {
  const baris = [...movements]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((m) => [
      m.at,
      m.menuName,
      m.delta > 0 ? 'Masuk' : m.delta < 0 ? 'Keluar' : 'Tetap',
      m.delta,
      m.balance,
      stockReasonLabel(m.reason),
      m.actor,
      m.note,
    ]);

  return {
    name: 'Riwayat Stok',
    header: ['Waktu', 'Menu', 'Arah', 'Jumlah', 'Saldo', 'Alasan', 'Dicatat oleh', 'Catatan'],
    widths: [24, 26, 9, 10, 10, 16, 16, 26],
    rows: baris,
  };
}
