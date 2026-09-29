/**
 * Order: kode, state machine, dan aturan transisi.
 *
 * State machine-nya dibuat eksplisit. Aplikasi aslinya menyimpan status sebagai
 * string bebas dan memutuskan transisi di client, sehingga order bisa melompat
 * dari "Pending" langsung ke "Completed" tanpa pernah masuk dapur.
 */

import type {
  Order,
  OrderChannel,
  OrderStatus,
  Payment,
  PaymentStatus,
} from './types.ts';
import { dateKey, DEFAULT_TZ } from './time.ts';

/* ==========================================================================
   Status
   ========================================================================= */

/** Alur normal dapur → selesai. */
export const ORDER_FLOW: readonly OrderStatus[] = [
  'pending',
  'processing',
  'ready',
  'completed',
] as const;

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [], // terminal
  cancelled: [], // terminal
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Status berikutnya dalam alur normal. null bila sudah terminal. */
export function nextStatus(from: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(from);
  if (i < 0 || i >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[i + 1] ?? null;
}

export function isTerminal(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Order yang belum selesai/dibatalkan masih boleh dibatalkan. */
export function canCancel(status: OrderStatus): boolean {
  return TRANSITIONS[status].includes('cancelled');
}

/**
 * Order yang boleh dipanggil ke papan antrian.
 *
 * Hanya yang sudah **siap** — itulah saat pelanggan memang perlu dipanggil.
 *
 * Sebelumnya layar kasir memakai `canTransition(status, 'ready')` sebagai
 * syarat, yang justru bernilai benar hanya untuk order `processing`. Akibatnya
 * tombol "Panggil" tidak pernah muncul pada order yang sudah siap, padahal
 * papan antrian hanya menyiarkan order siap yang punya `calledAt`. Alur yang
 * paling wajar — pesanan siap, lalu panggil pelanggan — jadi tidak bisa
 * dijalankan sama sekali, dan pengumuman suara tidak pernah berbunyi.
 */
export function canCallQueue(status: OrderStatus): boolean {
  return status === 'ready';
}

/** Masih perlu dikerjakan dapur? */
export function isActive(status: OrderStatus): boolean {
  return status === 'pending' || status === 'processing';
}

/** Sudah disajikan atau selesai — dipakai untuk daftar "selesai". */
export function isDone(status: OrderStatus): boolean {
  return status === 'ready' || status === 'completed';
}

/** Label bahasa Indonesia untuk UI. */
export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return 'Menunggu';
    case 'processing':
      return 'Diproses';
    case 'ready':
      return 'Siap';
    case 'completed':
      return 'Selesai';
    case 'cancelled':
      return 'Dibatalkan';
  }
}

export type StatusTone = 'pending' | 'processing' | 'ready' | 'done' | 'cancelled';

/** Nada warna — dipetakan ke token desain di lapisan UI. */
export function statusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'ready':
      return 'ready';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
  }
}

/* ==========================================================================
   Pembayaran
   ========================================================================= */

export function isPaid(payment: Pick<Payment, 'status'>): boolean {
  return payment.status === 'paid';
}

/**
 * Dasar hitung untuk semua angka uang di laporan.
 *
 * Order yang dibatalkan tidak pernah terjadi; order yang belum dibayar belum
 * menghasilkan uang. Keduanya harus keluar dari omzet — kalau tidak, laporan
 * menampilkan pemasukan yang belum diterima pemilik.
 *
 * Ini dipisahkan ke ranah domain, bukan ditulis ulang di tiap layar, karena
 * satu layar yang lupa menyaring akan membuat dua bagian halaman saling
 * bertentangan tanpa ada yang gagal.
 */
export function forRevenue<T extends { status: OrderStatus; payment: Pick<Payment, 'status'> }>(
  orders: readonly T[],
): T[] {
  return orders.filter((o) => o.status !== 'cancelled' && o.payment.status === 'paid');
}

/**
 * Order yang masih menunggu uang masuk — dasar hitungan piutang.
 * Sengaja tidak memakai `forRevenue` karena maksudnya justru kebalikannya.
 */
export function awaitingPayment<T extends { status: OrderStatus; payment: Pick<Payment, 'status'> }>(
  orders: readonly T[],
): T[] {
  return orders.filter((o) => o.status !== 'cancelled' && o.payment.status !== 'paid');
}

export function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'unpaid':
      return 'Belum bayar';
    case 'paid':
      return 'Lunas';
    case 'refunded':
      return 'Dikembalikan';
  }
}

export function paymentMethodLabel(method: Payment['method']): string {
  switch (method) {
    case 'cash':
      return 'Tunai';
    case 'qris_gateway':
      return 'QRIS Otomatis';
    case 'qris_static':
      return 'QRIS Toko';
    case 'transfer':
      return 'Transfer Bank';
    case 'debit':
      return 'Kartu Debit';
    case 'split':
      return 'Bayar Terbagi';
  }
}

/**
 * Order boleh masuk dapur kalau sudah dibayar ATAU dibayar di akhir.
 * Di banyak kafe, self-order dibayar dulu; POS kasir sering bayar di akhir.
 * Aturannya di sini: order hanya boleh mulai diproses bila tidak ada
 * tunggakan pembayaran.
 */
export function canStartCooking(order: {
  status: OrderStatus;
  payment: { status: PaymentStatus };
}): boolean {
  return order.status === 'pending' && isPaid(order.payment);
}

/* ==========================================================================
   Kode order
   ========================================================================= */

/**
 * Kode order yang bisa dibaca manusia.
 *   ORD-260928-0001   (dibuat kasir)
 *   WEB-260928-0001   (self-order dari meja)
 *
 * Memakai tanggal lokal toko supaya kode cocok dengan tanggal di laporan —
 * aplikasi aslinya memakai tanggal UTC, sehingga order lewat tengah malam WIB
 * tercatat di hari berikutnya.
 */
export function orderCode(
  channel: OrderChannel,
  at: Date | string,
  sequence: number,
  tz: string = DEFAULT_TZ,
): string {
  const prefix = channel === 'pos' ? 'ORD' : 'WEB';
  const key = dateKey(at, tz).replace(/-/g, '').slice(2); // 260928
  return `${prefix}-${key}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Nomor urut harian dari kode order. Dipakai untuk menurunkan kode unik
 * pembayaran dan untuk mengurutkan.
 */
export function sequenceFromOrderCode(code: string): number {
  const m = /-(\d{4})$/.exec(code);
  return m?.[1] ? Number.parseInt(m[1], 10) : 0;
}

/* ==========================================================================
   Tampilan
   ========================================================================= */

/** "Meja 4" | "Bawa pulang" */
export function tableLabel(tableNumber: number | null): string {
  return tableNumber === null ? 'Bawa pulang' : `Meja ${tableNumber}`;
}

/** Ringkasan singkat untuk kartu order. */
export function orderHeadline(order: Pick<Order, 'queueNumber' | 'code' | 'tableNumber'>): string {
  return order.queueNumber ?? order.code ?? tableLabel(order.tableNumber);
}

/**
 * Lama order menunggu, dalam menit. Dipakai kitchen display untuk menandai
 * order yang sudah terlalu lama (mis. > 15 menit jadi merah).
 */
export function waitingMinutes(
  order: Pick<Order, 'createdAt' | 'completedAt'>,
  now: Date = new Date(),
): number {
  const end = order.completedAt ? new Date(order.completedAt) : now;
  const start = new Date(order.createdAt);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
}

export type Urgency = 'fresh' | 'normal' | 'late';

/** Ambang batas untuk menandai order di kitchen display. */
export const URGENCY_THRESHOLDS = { normal: 8, late: 15 } as const;

export function urgencyOf(minutes: number): Urgency {
  if (minutes >= URGENCY_THRESHOLDS.late) return 'late';
  if (minutes >= URGENCY_THRESHOLDS.normal) return 'normal';
  return 'fresh';
}
