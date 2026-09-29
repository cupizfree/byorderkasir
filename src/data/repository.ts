/**
 * Kontrak lapisan data.
 *
 * Semua surface hanya bicara lewat antarmuka ini — tidak ada satu pun tempat di
 * UI yang tahu apakah datanya datang dari mock, Supabase, atau backend lain.
 * Itu yang membuat frontend bisa jalan penuh sebelum backend ada, dan membuat
 * penggantian backend tidak menyentuh UI.
 *
 * Prinsip yang dipegang:
 *
 *  1. **Penulisan order adalah satu panggilan atomik.** Kode order, nomor
 *     antrian, kode unik, dan perhitungan total ditentukan oleh SISI SERVER,
 *     bukan client. Aplikasi aslinya menghitung semuanya di client lalu
 *     mengirim hasilnya — artinya harga dan total bisa dimanipulasi dari
 *     browser. Di sini client hanya mengirim niat, server yang memutuskan.
 *
 *  2. **Realtime adalah sinyal, bukan data.** Kanal hanya memberi tahu BAHWA
 *     ada yang berubah. Data diambil ulang lewat pembacaan biasa. Ini yang
 *     membuatnya murah dibanding polling yang mengirim seluruh dataset.
 */

import type {
  Category,
  Discount,
  DiningTable,
  ID,
  Menu,
  Order,
  OrderChannel,
  OrderItem,
  OrderStatus,
  Payment,
  RealtimeSignal,
  Session,
  StoreSettings,
  UserRole,
} from '../domain/types.ts';

/* ==========================================================================
   Filter & masukan
   ========================================================================= */

export interface OrderFilter {
  from?: string;
  to?: string;
  status?: readonly OrderStatus[];
  channel?: OrderChannel;
  /** Pencarian bebas: kode order, nama pelanggan, atau nomor meja. */
  search?: string;
  limit?: number;
}

export interface CreateOrderInput {
  storeId: ID;
  channel: OrderChannel;
  tableNumber: number | null;
  customerName: string;
  customerEmail: string;
  customerNotes: string;
  cashierName: string;
  items: readonly OrderItem[];
  discount: Discount;
  /** Metode bayar yang dipilih. Nominal akhir dihitung server. */
  paymentMethod: Payment['method'];
  /** Untuk tunai: uang yang diserahkan. */
  cashReceived?: number;
  /** Untuk split: rincian per metode. */
  splits?: Payment['splits'];
}

export interface MenuInput {
  id?: ID;
  storeId: ID;
  name: string;
  categoryId: ID;
  price: number;
  costPrice: number;
  description: string;
  imageUrl: string | null;
  isAvailable: boolean;
  stock: number | null;
  sortOrder: number;
}

export interface CategoryInput {
  id?: ID;
  storeId: ID;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export interface TableInput {
  id?: ID;
  storeId: ID;
  number: number;
  name: string;
  capacity: number;
  status: DiningTable['status'];
}

/* ==========================================================================
   Status koneksi realtime
   ========================================================================= */

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline';

/* ==========================================================================
   Kanal realtime
   ========================================================================= */

export interface RealtimeHub {
  /** Mulai mendengarkan perubahan untuk satu toko. */
  start(storeId: ID): void;
  /** Berhenti dan lepaskan semua langganan. */
  stop(): void;
  /** Daftarkan pendengar sinyal. Mengembalikan fungsi untuk melepas. */
  subscribe(listener: (signal: RealtimeSignal) => void): () => void;
  /** Status koneksi saat ini. */
  status(): ConnectionStatus;
  /** Daftarkan pendengar perubahan status koneksi. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
}

/* ==========================================================================
   Repositori
   ========================================================================= */

export interface Repository {
  /* --- Pengaturan & master data ----------------------------------------- */

  getSettings(storeId: ID): Promise<StoreSettings>;
  saveSettings(storeId: ID, settings: StoreSettings): Promise<void>;

  listCategories(storeId: ID): Promise<Category[]>;
  saveCategory(input: CategoryInput): Promise<Category>;
  deleteCategory(id: ID): Promise<void>;

  listMenus(storeId: ID): Promise<Menu[]>;
  saveMenu(input: MenuInput): Promise<Menu>;
  deleteMenu(id: ID): Promise<void>;
  setMenuAvailability(id: ID, isAvailable: boolean): Promise<void>;

  listTables(storeId: ID): Promise<DiningTable[]>;
  saveTable(input: TableInput): Promise<DiningTable>;
  deleteTable(id: ID): Promise<void>;
  /** Cari meja dari token di URL QR. */
  getTableByToken(token: string): Promise<DiningTable | null>;

  /* --- Order ------------------------------------------------------------- */

  /**
   * Buat order. Seluruh penomoran dan perhitungan dilakukan implementasi
   * (di Supabase: satu fungsi Postgres, jadi atomik).
   */
  createOrder(input: CreateOrderInput): Promise<Order>;

  listOrders(storeId: ID, filter?: OrderFilter): Promise<Order[]>;
  getOrder(id: ID): Promise<Order | null>;
  getOrderByCode(storeId: ID, code: string): Promise<Order | null>;

  updateOrderStatus(id: ID, status: OrderStatus): Promise<void>;
  cancelOrder(id: ID, reason: string): Promise<void>;
  /** Catat pembayaran yang diterima (dipakai konfirmasi kasir & webhook QRIS). */
  recordPayment(id: ID, payment: Payment): Promise<void>;

  /**
   * Order yang masih perlu ditampilkan di layar antrian TV:
   * sedang dipanggil, dan yang menunggu disajikan.
   */
  listQueueBoard(storeId: ID): Promise<Order[]>;
  /** Tandai nomor antrian sedang dipanggil (memicu bel + suara di TV). */
  callQueue(id: ID): Promise<void>;

  /* --- Layar pelanggan --------------------------------------------------- */

  /** Ambil order yang sedang ditampilkan di layar pelanggan. */
  getDisplayOrder(storeId: ID): Promise<Order | null>;
  /** Kirim order ke layar pelanggan. `null` untuk kembali ke mode siaga. */
  setDisplayOrder(storeId: ID, orderId: ID | null): Promise<void>;

  /* --- Sesi -------------------------------------------------------------- */

  signIn(storeId: ID, username: string, password: string, pin: string): Promise<Session>;
  signOut(): Promise<void>;
  currentSession(): Promise<Session | null>;

  /* --- Realtime ---------------------------------------------------------- */

  readonly realtime: RealtimeHub;
}

/* ==========================================================================
   Kesalahan
   ========================================================================= */

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'unauthorized'
      | 'conflict'
      | 'invalid'
      | 'network'
      | 'server' = 'server',
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export const ROLES: readonly UserRole[] = ['owner', 'cashier', 'kitchen'] as const;
