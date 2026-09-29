/**
 * Jembatan antara tampilan admin dan lapisan data.
 *
 * Semua efek samping (menyimpan, membatalkan, mencetak, memuat ulang) ada di
 * sini, sehingga komponen tampilan tetap murni: mereka menerima aksi dan
 * memanggilnya. Itu membuat tiap layar mudah dibaca dan diuji.
 *
 * Pola yang dipakai konsisten: **jalankan aksi → muat ulang dari server**,
 * bukan menambal state lokal. Dengan begitu yang tampil selalu yang tersimpan,
 * dan tidak ada dua sumber kebenaran.
 */

import { useMemo } from 'preact/hooks';

import { getRepository } from '../../data/index.ts';
import type {
  CategoryInput,
  MenuInput,
  TableInput,
} from '../../data/repository.ts';
import { lastNDaysRange, monthRange, todayRange, yearRange } from '../../domain/time.ts';
import type {
  Category,
  Discount,
  DiningTable,
  ID,
  Menu,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentMethod,
  StoreSettings,
} from '../../domain/types.ts';
import {
  loadCatalog,
  loadDisplayOrder,
  loadOrders,
  loadQueueBoard,
  loadSettings,
  messageOf,
  setOrderStatus,
  storeId,
} from '../../state/store.ts';
import { printKitchenTicket, printReceipt } from './print.ts';

/* ==========================================================================
   Periode analitik
   ========================================================================= */

export type Periode = 'hari' | '7hari' | '30hari' | 'bulan' | 'tahun' | 'semua';

export function rentangPeriode(p: Periode): { from?: string; to?: string } {
  switch (p) {
    case 'hari':
      return todayRange();
    case '7hari':
      return lastNDaysRange(7);
    case '30hari':
      return lastNDaysRange(30);
    case 'bulan':
      return monthRange();
    case 'tahun':
      return yearRange();
    case 'semua':
      return {};
  }
}

/* ==========================================================================
   Aksi
   ========================================================================= */

export interface AdminActions {
  /* Kasir */
  buatOrder: (input: {
    items: OrderItem[];
    discount: Discount;
    paymentMethod: Extract<PaymentMethod, 'cash' | 'qris_static' | 'qris_gateway'>;
    cashReceived: number;
    tableNumber: number | null;
    customerName: string;
    customerNotes: string;
  }) => Promise<Order>;

  /* Order */
  tandaiLunas: (orderId: ID, amountPaid: number, cashReceived?: number) => Promise<void>;
  ubahStatus: (orderId: ID, status: OrderStatus) => Promise<void>;
  panggilAntrian: (orderId: ID) => Promise<void>;
  kirimKeLayar: (orderId: ID | null) => Promise<void>;
  batalkanOrder: (orderId: ID, reason: string) => Promise<void>;

  /* Cetak */
  cetakStruk: (order: Order) => void;
  cetakTiketDapur: (order: Order) => void;

  /* Master data */
  simpanMenu: (input: MenuInput) => Promise<void>;
  hapusMenu: (id: ID) => Promise<void>;
  setKetersediaan: (id: ID, tersedia: boolean) => Promise<void>;
  simpanKategori: (input: CategoryInput) => Promise<void>;
  hapusKategori: (id: ID) => Promise<void>;
  simpanMeja: (input: TableInput) => Promise<void>;
  hapusMeja: (id: ID) => Promise<void>;
  simpanPengaturan: (s: StoreSettings) => Promise<void>;

  /* Demo */
  resetDemo: () => void;

  /* Filter */
  filterHariIni: () => { from: string; to: string };
  filterPeriode: (p: Periode) => { from?: string; to?: string };

  pesanGalat: (err: unknown) => string;
}

export function useAdminActions(): AdminActions {
  return useMemo<AdminActions>(() => {
    const repo = () => getRepository();
    const sid = () => storeId.value;

    return {
      /* --- Kasir -------------------------------------------------------- */

      async buatOrder(input) {
        // Harga, pajak, biaya layanan, dan kode unik dihitung ulang di sini
        // (server). Angka dari peramban tidak dipercaya.
        const order = await repo().createOrder({
          storeId: sid(),
          channel: 'pos',
          tableNumber: input.tableNumber,
          customerName: input.customerName,
          customerEmail: '',
          customerNotes: input.customerNotes,
          cashierName: '',
          items: input.items,
          discount: input.discount,
          paymentMethod: input.paymentMethod,
          cashReceived: input.cashReceived,
        });
        await Promise.all([loadOrders(), loadQueueBoard()]);
        return order;
      },

      /* --- Order -------------------------------------------------------- */

      async tandaiLunas(orderId, amountPaid, cashReceived = 0) {
        const order = await repo().getOrder(orderId);
        if (!order) throw new Error('Order tidak ditemukan');
        if (order.payment.status === 'paid') throw new Error('Order ini sudah lunas');

        const payment: Payment = {
          ...order.payment,
          amountPaid,
          cashReceived,
          cashChange: Math.max(0, cashReceived - amountPaid),
        };
        await repo().recordPayment(orderId, payment);
        await Promise.all([loadOrders(), loadQueueBoard(), loadDisplayOrder()]);
      },

      async ubahStatus(orderId, status) {
        await setOrderStatus(orderId, status);
        await Promise.all([loadOrders(), loadQueueBoard(), loadDisplayOrder()]);
      },

      async panggilAntrian(orderId) {
        await repo().callQueue(orderId);
        await Promise.all([loadOrders(), loadQueueBoard()]);
      },

      async kirimKeLayar(orderId) {
        await repo().setDisplayOrder(sid(), orderId);
        await loadDisplayOrder();
      },

      async batalkanOrder(orderId, reason) {
        await repo().cancelOrder(orderId, reason);
        await Promise.all([loadOrders(), loadQueueBoard(), loadDisplayOrder()]);
      },

      /* --- Cetak -------------------------------------------------------- */

      cetakStruk(order) {
        const s = requireSettings();
        printReceipt(order, s);
      },

      cetakTiketDapur(order) {
        const s = requireSettings();
        printKitchenTicket(order, s);
      },

      /* --- Master data -------------------------------------------------- */

      async simpanMenu(input) {
        await repo().saveMenu({ ...input, storeId: sid() });
        await Promise.all([loadCatalog(), loadOrders()]);
      },

      async hapusMenu(id) {
        await repo().deleteMenu(id);
        await loadCatalog();
      },

      async setKetersediaan(id, tersedia) {
        await repo().setMenuAvailability(id, tersedia);
        await loadCatalog();
      },

      async simpanKategori(input) {
        await repo().saveCategory({ ...input, storeId: sid() });
        await loadCatalog();
      },

      async hapusKategori(id) {
        await repo().deleteCategory(id);
        await loadCatalog();
      },

      async simpanMeja(input) {
        await repo().saveTable({ ...input, storeId: sid() });
        await loadCatalog();
      },

      async hapusMeja(id) {
        await repo().deleteTable(id);
        await loadCatalog();
      },

      async simpanPengaturan(s) {
        await repo().saveSettings(sid(), s);
        await loadSettings();
      },

      /* --- Demo --------------------------------------------------------- */

      resetDemo() {
        const r = repo();
        // Hanya adapter mock yang punya metode ini.
        if ('resetDemoData' in r && typeof r.resetDemoData === 'function') {
          (r as { resetDemoData(): void }).resetDemoData();
        }
        void Promise.all([loadCatalog(), loadOrders(), loadSettings()]);
      },

      /* --- Filter ------------------------------------------------------- */

      filterHariIni: todayRange,
      filterPeriode: rentangPeriode,

      pesanGalat: messageOf,
    };

    function requireSettings(): StoreSettings {
      const s = settingsCache;
      if (!s) throw new Error('Pengaturan toko belum dimuat');
      return s;
    }
  }, []);
}

/* ==========================================================================
   Cache pengaturan untuk pencetakan
   ========================================================================= */

/**
 * Fungsi cetak bersifat sinkron (dipanggil dari `onClick`), jadi tidak bisa
 * `await` pengaturan. Nilai terakhir yang dimuat disimpan di sini.
 */
let settingsCache: StoreSettings | null = null;

export function simpanPengaturanKeCache(s: StoreSettings | null): void {
  settingsCache = s;
}

/* ==========================================================================
   Ekspor ulang tipe yang dipakai tampilan
   ========================================================================= */

export type { Category, DiningTable, Menu };
