/**
 * Aritmetika uang.
 *
 * Aturan yang dipegang di seluruh berkas ini:
 *
 *  1. **Rupiah bulat.** Tidak ada desimal. Semua nilai adalah `number` bulat,
 *     dan tidak pernah negatif kecuali dinyatakan lain.
 *  2. **Total = jumlah komponen yang dibulatkan.** Setiap komponen dibulatkan
 *     lebih dulu, lalu total dijumlahkan dari komponen yang sudah bulat itu.
 *     Ini penting: kalau total dihitung terpisah, struk yang tercetak bisa
 *     tidak cocok dengan totalnya (meleset 1-2 rupiah).
 *  3. **Fungsi murni.** Tidak ada I/O, tidak ada state. Semua bisa diuji.
 */

import type { Discount, DiscountType, OrderItem, PaymentMethod, PaymentSplit } from './types.ts';

/* ==========================================================================
   Format
   ========================================================================= */

/** 15000 → "Rp 15.000" */
export function formatRupiah(value: number, withSymbol = true): string {
  const n = Math.round(value);
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toLocaleString('id-ID');
  return withSymbol ? `${sign}Rp ${digits}` : `${sign}${digits}`;
}

/** "Rp 15.000" | "15000" | "15.000" → 15000. Mengembalikan 0 untuk input tak valid. */
export function parseRupiah(input: string): number {
  const digits = input.replace(/[^\d-]/g, '');
  if (digits === '' || digits === '-') return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/* ==========================================================================
   Baris & subtotal
   ========================================================================= */

/** Harga satu baris. Selalu dihitung, tidak pernah disimpan. */
export function lineTotal(item: Pick<OrderItem, 'price' | 'qty'>): number {
  return item.price * item.qty;
}

export function lineCost(item: Pick<OrderItem, 'costPrice' | 'qty'>): number {
  return item.costPrice * item.qty;
}

export function subtotalOf(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function totalCostOf(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + lineCost(item), 0);
}

export function totalQty(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

/** "1x Nasi Goreng, 2x Kopi" — untuk ringkasan di daftar order. */
export function summarizeItems(items: readonly OrderItem[]): string {
  return items.map((i) => `${i.qty}x ${i.name}`).join(', ');
}

/* ==========================================================================
   Diskon
   ========================================================================= */

/**
 * Nilai diskon dalam rupiah, dibatasi agar tidak melebihi subtotal.
 * Diskon tidak pernah membuat total negatif.
 */
export function discountAmountFor(subtotal: number, discount: Discount): number {
  if (subtotal <= 0) return 0;
  let amount: number;
  switch (discount.type) {
    case 'amount':
      amount = Math.round(discount.value);
      break;
    case 'percent':
      amount = Math.round((subtotal * clamp(discount.value, 0, 100)) / 100);
      break;
    case 'none':
      amount = 0;
      break;
  }
  return clamp(amount, 0, subtotal);
}

/** Persen diskon efektif — untuk ditampilkan di struk. */
export function effectiveDiscountPercent(subtotal: number, amount: number): number {
  if (subtotal <= 0) return 0;
  return Math.round((amount / subtotal) * 1000) / 10;
}

/* ==========================================================================
   Total order
   ========================================================================= */

export interface TotalsInput {
  items: readonly OrderItem[];
  discount?: Discount;
  /** Persen pajak, mis. 10 untuk PB1. */
  taxPercent?: number;
  /** Biaya layanan tetap dalam rupiah. */
  serviceAmount?: number;
  /**
   * Dasar pengenaan pajak.
   *  - 'net'                 : hanya subtotal setelah diskon (umum untuk PPN)
   *  - 'net_plus_service'    : subtotal setelah diskon + biaya layanan
   *                            (umum untuk PB1 restoran)
   * Default 'net_plus_service'.
   */
  taxBase?: 'net' | 'net_plus_service';
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  /** subtotal - discountAmount */
  netSubtotal: number;
  serviceAmount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  /** Persen laba kotor terhadap total. 0 bila total 0. */
  marginPercent: number;
  itemCount: number;
}

/**
 * Hitung seluruh komponen biaya satu order.
 *
 * Urutan (dokumentasi ini adalah spesifikasinya):
 *   1. subtotal        = Σ harga × qty
 *   2. diskon          = dihitung dari subtotal, dibatasi ≤ subtotal
 *   3. netSubtotal     = subtotal − diskon
 *   4. serviceAmount   = biaya tetap (bukan persen), 0 bila tidak aktif
 *   5. taxAmount       = round(dasar × taxPercent / 100)
 *                        dasar = netSubtotal (+ serviceAmount bila 'net_plus_service')
 *   6. total           = netSubtotal + serviceAmount + taxAmount
 *
 * Setiap komponen dibulatkan sebelum dijumlahkan, jadi hasilnya selalu
 * cocok dengan yang tercetak di struk.
 */
export function computeTotals(input: TotalsInput): OrderTotals {
  const {
    items,
    discount = { type: 'none' as DiscountType, value: 0 },
    taxPercent = 0,
    serviceAmount = 0,
    taxBase = 'net_plus_service',
  } = input;

  const subtotal = subtotalOf(items);

  // Keranjang kosong tidak boleh menghasilkan tagihan. Tanpa penjaga ini,
  // biaya layanan + pajak tetap dikenakan pada subtotal 0.
  if (subtotal <= 0) {
    return {
      subtotal: 0,
      discountAmount: 0,
      netSubtotal: 0,
      serviceAmount: 0,
      taxPercent: 0,
      taxAmount: 0,
      total: 0,
      totalCost: totalCostOf(items),
      grossProfit: 0,
      marginPercent: 0,
      itemCount: 0,
    };
  }

  const discountAmount = discountAmountFor(subtotal, discount);
  const netSubtotal = subtotal - discountAmount;

  const service = Math.max(0, Math.round(serviceAmount));
  const base = taxBase === 'net' ? netSubtotal : netSubtotal + service;
  const taxAmount = Math.max(0, Math.round((base * clamp(taxPercent, 0, 100)) / 100));

  const total = netSubtotal + service + taxAmount;
  const totalCost = totalCostOf(items);
  const grossProfit = total - totalCost;

  return {
    subtotal,
    discountAmount,
    netSubtotal,
    serviceAmount: service,
    taxPercent,
    taxAmount,
    total,
    totalCost,
    grossProfit,
    marginPercent: total > 0 ? Math.round((grossProfit / total) * 1000) / 10 : 0,
    itemCount: totalQty(items),
  };
}

/* ==========================================================================
   Kode unik — rekonsiliasi QRIS
   ========================================================================= */

/**
 * Kode unik ditambahkan ke nominal supaya setiap order punya jumlah transfer
 * yang berbeda, sehingga mutasi bank/QRIS bisa dicocokkan otomatis.
 *
 * Diturunkan dari nomor urut order (bukan acak) supaya:
 *  - stabil: nilai yang sama dihasilkan setiap kali dihitung ulang
 *  - unik dalam satu hari selama rentang ≥ jumlah order harian
 *  - tidak perlu penanganan tabrakan
 */
export function uniqueCodeFromSequence(sequence: number, range: [number, number] = [1, 999]): number {
  const [min, max] = range;
  const span = max - min + 1;
  if (span <= 0) return 0;
  return min + (((sequence - 1) % span) + span) % span;
}

/** Nominal yang harus dibayar customer = total + kode unik. */
export function amountDueWithUniqueCode(total: number, uniqueCode: number): number {
  return total + Math.max(0, uniqueCode);
}

/**
 * Apakah metode pembayaran ini butuh kode unik?
 *
 * Kode unik berguna HANYA saat kita harus mencocokkan sebuah pemasukan di
 * mutasi bank dengan satu order — di situ dua pelanggan bisa membayar nominal
 * yang persis sama, dan kode unik memisahkannya.
 *
 * Untuk tunai dan kartu debit, kasir ada di tempat dan menekan "Lunas"
 * sendiri. Menambahkan kode unik di situ justru merusak dua hal:
 *  - pelanggan diminta membayar Rp 63.811 padahal harga menunya Rp 63.800
 *  - kembalian jadi tidak bulat, dan angkanya berbeda dari yang ditampilkan
 *    layar ke kasir (selisih sebesar kode unik)
 */
export function needsUniqueCode(method: PaymentMethod): boolean {
  return method === 'qris_static' || method === 'qris_gateway' || method === 'transfer';
}

/* ==========================================================================
   Tunai
   ========================================================================= */

export function cashChange(cashReceived: number, amountDue: number): number {
  return Math.max(0, Math.round(cashReceived) - Math.round(amountDue));
}

export function cashIsEnough(cashReceived: number, amountDue: number): boolean {
  return cashReceived >= amountDue;
}

/**
 * Saran tombol uang cepat. Membulatkan ke atas ke kelipatan yang masuk akal
 * untuk nominal rupiah, lalu selalu menyertakan nominal pas.
 */
export function quickCashOptions(amountDue: number): number[] {
  if (amountDue <= 0) return [];
  const denominations = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000];
  const options = new Set<number>([amountDue]);

  for (const step of denominations) {
    const rounded = Math.ceil(amountDue / step) * step;
    if (rounded > amountDue) options.add(rounded);
  }
  // Nominal kertas yang umum di Indonesia.
  for (const note of [20_000, 50_000, 100_000]) {
    if (note >= amountDue) options.add(note);
  }

  return [...options].sort((a, b) => a - b).slice(0, 6);
}

/* ==========================================================================
   Pembayaran terbagi (split)
   ========================================================================= */

export interface SplitValidation {
  valid: boolean;
  /** Selisih antara jumlah split dan nominal yang harus dibayar. */
  difference: number;
  total: number;
}

/**
 * Split harus menutup nominal tepat. Kurang = belum lunas;
 * lebih = kelebihan yang harus dikembalikan, jadi tidak valid.
 */
export function validateSplits(splits: readonly PaymentSplit[], amountDue: number): SplitValidation {
  const total = splits.reduce((sum, s) => sum + Math.max(0, Math.round(s.amount)), 0);
  const difference = amountDue - total;
  return { valid: difference === 0, difference, total };
}

/** Bagi dua nominal, sisa pembulatan ditaruh di bagian pertama. */
export function halveAmount(amount: number): [number, number] {
  const half = Math.floor(amount / 2);
  return [amount - half, half];
}

/* ==========================================================================
   Laporan
   ========================================================================= */

export interface ReportSummary {
  orderCount: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
  averageOrderValue: number;
}

export function summarizeReport(
  orders: readonly { total: number; totalCost: number }[],
): ReportSummary {
  const orderCount = orders.length;
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const cost = orders.reduce((s, o) => s + o.totalCost, 0);
  const grossProfit = revenue - cost;
  return {
    orderCount,
    revenue,
    cost,
    grossProfit,
    marginPercent: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    averageOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
  };
}

/* ==========================================================================
   Internal
   ========================================================================= */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
