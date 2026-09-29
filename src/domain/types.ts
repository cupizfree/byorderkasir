/**
 * Model data byorderkasir.
 *
 * Model ini memperbaiki tiga cacat model aslinya (lihat ANALISIS.md §3):
 *
 *  1. `items_json` disimpan sebagai STRING JSON di dalam sel, lalu di-parse ulang
 *     di client. Di sini item adalah array sungguhan.
 *  2. `created_timestamp` kosong sementara `created_at` berupa string
 *     "YYYY-MM-DD HH:MM:SS" — pengurutan dan filter tanggal jadi rapuh.
 *     Di sini waktu selalu ISO-8601 UTC (timestamptz di Postgres).
 *  3. Settings punya 46 kunci datar dengan duplikat yang saling menimpa
 *     (`tax_percent` vs `tax_percent_pos` vs `tax_percent_qr`, dst).
 *     Di sini settings bersarang dan setiap konsep punya satu tempat.
 */

export type ID = string;

/* ==========================================================================
   Order
   ========================================================================= */

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

export type PaymentMethod =
  | 'cash'
  | 'qris_gateway'
  | 'qris_static'
  | 'transfer'
  | 'debit'
  | 'split';

/** Dari mana order dibuat — memengaruhi prefix kode dan tampilan kasir. */
export type OrderChannel = 'pos' | 'self_order';

export interface OrderItem {
  menuId: ID;
  /** Nama disalin saat order dibuat: menu bisa diganti/dihapus nanti. */
  name: string;
  /** Harga satuan saat transaksi, dalam rupiah bulat. */
  price: number;
  qty: number;
  notes: string;
  /** HPP satuan saat transaksi — dasar hitung margin historis. */
  costPrice: number;
}

export interface PaymentSplit {
  method: Exclude<PaymentMethod, 'split'>;
  amount: number;
}

export interface Payment {
  method: PaymentMethod;
  status: PaymentStatus;
  /** Kode unik yang ditambahkan ke nominal untuk rekonsiliasi QRIS. */
  uniqueCode: number;
  /** Nominal akhir yang harus ditransfer customer (total + uniqueCode). */
  amountDue: number;
  /** Yang benar-benar diterima. */
  amountPaid: number;
  cashReceived: number;
  cashChange: number;
  /** Referensi dari payment gateway / bukti transfer. */
  reference: string;
  paidAt: string | null;
  splits: PaymentSplit[];
}

export interface Order {
  id: ID;
  storeId: ID;
  /** Kode manusiawi, mis. ORD-260928-0001 (POS) / WEB-260928-0001 (self-order). */
  code: string;
  channel: OrderChannel;
  /** Nomor antrian harian, mis. A-01. null sebelum order masuk antrian. */
  queueNumber: string | null;
  tableNumber: number | null;
  customerName: string;
  customerEmail: string;
  customerNotes: string;
  cashierName: string;

  items: OrderItem[];

  /** Semua nominal dalam rupiah bulat. Lihat domain/money.ts untuk hitungannya. */
  subtotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  serviceAmount: number;
  total: number;
  /** Total HPP — dasar perhitungan laba kotor. */
  totalCost: number;

  payment: Payment;
  status: OrderStatus;

  /**
   * Kapan nomor antrian ini dipanggil. `null` = belum pernah dipanggil.
   * Dipakai layar TV untuk menyorot nomor yang sedang dipanggil dan menandai
   * panggilan ulang (dipanggil dua kali berarti customer belum dengar).
   */
  calledAt: string | null;
  /** Berapa kali dipanggil. > 1 ditampilkan sebagai "dipanggil ulang". */
  callCount: number;

  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/* ==========================================================================
   Diskon
   ========================================================================= */

export type DiscountType = 'none' | 'amount' | 'percent';

export interface Discount {
  type: DiscountType;
  /** Rupiah bila type='amount', persen (0-100) bila type='percent'. */
  value: number;
}

/* ==========================================================================
   Menu & kategori
   ========================================================================= */

export interface Category {
  id: ID;
  storeId: ID;
  name: string;
  /** Nama ikon dari set internal (bukan kelas Font Awesome — lihat ui/icons). */
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Menu {
  id: ID;
  storeId: ID;
  name: string;
  categoryId: ID;
  price: number;
  /** HPP satuan. 0 bila belum diisi. */
  costPrice: number;
  description: string;
  imageUrl: string | null;
  isAvailable: boolean;
  /**
   * Stok tersisa. `null` = tidak dilacak (unlimited).
   * Model aslinya memakai string kosong "" untuk kasus ini — ambigu dengan
   * "stok habis", jadi di sini dibedakan tegas.
   */
  stock: number | null;
  sortOrder: number;
}

/* ==========================================================================
   Meja
   ========================================================================= */

export type TableStatus = 'available' | 'occupied' | 'reserved';

export interface DiningTable {
  id: ID;
  storeId: ID;
  number: number;
  name: string;
  capacity: number;
  status: TableStatus;
  /** Token acak untuk URL QR meja — mencegah orang memesan ke meja orang lain. */
  qrToken: string;
}

/* ==========================================================================
   Pengaturan toko — menggantikan 46 kunci datar
   ========================================================================= */

export type PaymentChannel = 'pos' | 'qr';

export interface PaymentMethodConfig {
  /** Kanal tempat metode ini muncul. */
  channels: PaymentChannel[];
  enabled: boolean;
}

export interface PaymentSettings {
  /** QRIS dinamis lewat payment gateway (notifikasi otomatis). */
  qrisGateway: PaymentMethodConfig;
  /**
   * QRIS toko statis — pelanggan scan sendiri, kasir konfirmasi manual.
   *
   * `payload` adalah teks QRIS statis dari bank/PJSP (bukan gambar). Dari teks
   * ini kita bisa menyisipkan nominal sehingga jadi QRIS dinamis — pelanggan
   * tidak perlu mengetik nominal, dan tidak bisa salah ketik. Lihat
   * `domain/qris.ts`. `imageUrl` disimpan untuk toko yang ingin menampilkan
   * gambar aslinya apa adanya.
   */
  qrisStatic: PaymentMethodConfig & { imageUrl: string | null; payload: string | null };
  cash: PaymentMethodConfig;
  debit: PaymentMethodConfig & { provider: string };
  transfer: PaymentMethodConfig & {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
  };
  split: PaymentMethodConfig;
  /**
   * Kode unik nominal. Ditambahkan ke total supaya tiap order punya nominal
   * berbeda, sehingga mutasi QRIS bisa dicocokkan otomatis.
   */
  uniqueCodeEnabled: boolean;
  uniqueCodeRange: [number, number];
}

export interface TaxRule {
  /** Persen pajak (PB1 biasanya 10, PPN 11/12). 0 = tidak ada pajak. */
  percent: number;
  /** Pajak hanya berlaku di kanal tertentu; kosong = semua kanal. */
  channels: PaymentChannel[];
}

export interface ServiceFeeRule {
  enabled: boolean;
  /** Rupiah tetap per transaksi. */
  amount: number;
  channels: PaymentChannel[];
}

export interface StoreSettings {
  storeId: ID;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  logoUrl: string | null;
  currency: string;

  tax: TaxRule;
  serviceFee: ServiceFeeRule;

  payments: PaymentSettings;

  receipt: {
    customerFooter: string;
    kitchenFooter: string;
  };

  queue: {
    /** Huruf awal nomor antrian, mis. "A". */
    prefix: string;
    /** Nomor antrian direset setiap hari. */
    resetDaily: boolean;
  };
}

/* ==========================================================================
   Payload realtime
   ========================================================================== */

/**
 * Yang dikirim lewat kanal realtime. Sengaja kecil: kanal hanya memberi tahu
 * BAHWA ada perubahan, bukan isi perubahannya. Client lalu mengambil data segar.
 * Ini yang membuat penggantinya polling 1,2 detik jadi murah.
 */
export interface RealtimeSignal {
  storeId: ID;
  /** Naik setiap ada perubahan. Client membandingkan dengan yang terakhir dilihat. */
  revision: number;
  scope: 'orders' | 'menus' | 'settings' | 'display' | 'queue';
  at: string;
}

/* ==========================================================================
   Sesi pengguna
   ========================================================================= */

export type UserRole = 'owner' | 'cashier' | 'kitchen';

export interface Session {
  userId: ID;
  storeId: ID;
  role: UserRole;
  displayName: string;
  expiresAt: string;
}
