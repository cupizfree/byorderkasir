/**
 * Pemetaan baris PostgREST → tipe domain.
 *
 * PostgREST mengembalikan nama kolom apa adanya (snake_case), sementara
 * kontrak `Repository` memakai camelCase. Pemetaan dikerjakan di sini, bukan
 * di dalam komponen, supaya:
 *
 *  - bisa diuji tanpa basis data sama sekali
 *  - satu perubahan nama kolom hanya merusak satu tempat
 *
 * Order dan pergerakan stok TIDAK dipetakan di sini: keduanya dibentuk oleh
 * fungsi SQL (`app.order_json`, `app.movement_json`) yang sudah mengembalikan
 * camelCase. Itu disengaja — dua bentuk itu yang paling mahal kalau salah
 * petakan, jadi pemetaannya ditaruh di tempat yang tidak bisa dilewati.
 */

import type { Category, DiningTable, Menu, StoreSettings } from '../../domain/types.ts';

/* ==========================================================================
   Pembantu tipe longgar
   ========================================================================== */

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function channelList(v: unknown): StoreSettings['tax']['channels'] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is 'pos' | 'qr' => x === 'pos' || x === 'qr');
}

/* ==========================================================================
   Baris
   ========================================================================== */

export interface MenuRow {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  price: number;
  cost_price: number;
  description: string;
  image_url: string | null;
  is_available: boolean;
  stock: number | null;
  sort_order: number;
}

export interface CategoryRow {
  id: string;
  store_id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
}

export interface TableRow {
  id: string;
  store_id: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  qr_token: string;
}

export interface SettingsRow {
  store_id: string;
  data: unknown;
}

/* ==========================================================================
   Pemetaan
   ========================================================================== */

/**
 * Kategori yang dihapus meninggalkan NULL di `category_id` (kuncinya
 * ON DELETE SET NULL), sementara tipe domain memakai `ID`. Baris tanpa
 * kategori dipetakan ke string kosong, yang berarti "tanpa kategori" —
 * bukan "kategori tidak dikenal".
 */
export function toMenu(row: MenuRow): Menu {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    categoryId: row.category_id ?? '',
    price: row.price,
    costPrice: row.cost_price,
    description: row.description,
    imageUrl: row.image_url,
    isAvailable: row.is_available,
    stock: row.stock,
    sortOrder: row.sort_order,
  };
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    icon: row.icon || 'box',
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export function toTable(row: TableRow): DiningTable {
  return {
    id: row.id,
    storeId: row.store_id,
    number: row.number,
    name: row.name,
    capacity: row.capacity,
    status:
      row.status === 'occupied' || row.status === 'reserved' ? row.status : 'available',
    qrToken: row.qr_token,
  };
}

/**
 * Pengaturan toko.
 *
 * Setiap bagian bersarang diisi nilai bawaan yang masuk akal, bukan dibiarkan
 * `undefined`. Alasannya praktis: layar membaca `settings.payments.cash.enabled`
 * dan sejenisnya secara langsung, jadi satu bagian yang hilang di basis data
 * akan menjatuhkan seluruh layar — bukan sekadar menampilkan nilai kosong.
 * Dengan bawaan di sini, pengaturan yang belum lengkap tetap bisa dibuka.
 */
export function toSettings(row: SettingsRow): StoreSettings {
  const d = obj(row.data);

  const tax = obj(d.tax);
  const service = obj(d.serviceFee);
  const pay = obj(d.payments);
  const receipt = obj(d.receipt);
  const queue = obj(d.queue);
  const stock = obj(d.stock);

  const qrisStatic = obj(pay.qrisStatic);
  const debit = obj(pay.debit);
  const transfer = obj(pay.transfer);

  const range = Array.isArray(pay.uniqueCodeRange) ? pay.uniqueCodeRange : [];
  const uniqueCodeRange: [number, number] = [
    num(range[0], 1),
    num(range[1], 999),
  ];

  return {
    storeId: row.store_id,
    name: str(d.name, 'Toko'),
    tagline: str(d.tagline),
    address: str(d.address),
    phone: str(d.phone),
    logoUrl: typeof d.logoUrl === 'string' ? d.logoUrl : null,
    currency: str(d.currency, 'Rp'),

    tax: { percent: num(tax.percent), channels: channelList(tax.channels) },
    serviceFee: {
      enabled: bool(service.enabled),
      amount: num(service.amount),
      channels: channelList(service.channels),
    },

    payments: {
      qrisGateway: {
        channels: channelList(obj(pay.qrisGateway).channels),
        enabled: bool(obj(pay.qrisGateway).enabled),
      },
      qrisStatic: {
        channels: channelList(qrisStatic.channels),
        enabled: bool(qrisStatic.enabled),
        imageUrl: typeof qrisStatic.imageUrl === 'string' ? qrisStatic.imageUrl : null,
        payload: typeof qrisStatic.payload === 'string' ? qrisStatic.payload : null,
      },
      cash: {
        channels: channelList(obj(pay.cash).channels),
        enabled: bool(obj(pay.cash).enabled),
      },
      debit: {
        channels: channelList(debit.channels),
        enabled: bool(debit.enabled),
        provider: str(debit.provider),
      },
      transfer: {
        channels: channelList(transfer.channels),
        enabled: bool(transfer.enabled),
        bankName: str(transfer.bankName),
        accountNumber: str(transfer.accountNumber),
        accountHolder: str(transfer.accountHolder),
      },
      split: {
        channels: channelList(obj(pay.split).channels),
        enabled: bool(obj(pay.split).enabled),
      },
      uniqueCodeEnabled: bool(pay.uniqueCodeEnabled),
      uniqueCodeRange,
    },

    receipt: {
      customerFooter: str(receipt.customerFooter),
      kitchenFooter: str(receipt.kitchenFooter),
    },

    queue: {
      prefix: str(queue.prefix, 'A'),
      resetDaily: bool(queue.resetDaily, true),
    },

    stock: {
      // Ambang 5 adalah nilai yang masuk akal untuk kedai kecil; 0 berarti
      // peringatan dimatikan, jadi bawaannya sengaja bukan 0.
      lowStockThreshold: num(stock.lowStockThreshold, 5),
    },
  };
}
