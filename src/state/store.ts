/**
 * State aplikasi (signal-based) + penjodohan realtime.
 *
 * Ini pengganti langsung dari mekanisme polling di aplikasi aslinya. Bedanya:
 *
 *   SEBELUM  setInterval(loadAdminData, 6000) — setiap 6 detik seluruh dataset
 *            (order + menu + kategori + meja + settings + analitik) diambil
 *            ulang, apa pun yang berubah. Layar display tiap 1,2 detik.
 *            Satu layar ≈ 72.000 permintaan/hari.
 *
 *   SEKARANG Kanal realtime mengirim sinyal kecil saat ada perubahan. Sinyal
 *            beruntun DIGABUNG (coalesce) dalam jendela pendek, lalu hanya
 *            bagian yang berubah yang diambil ulang. Saat tidak ada aktivitas,
 *            tidak ada satu pun permintaan.
 *
 * Ditambah lagi, kalau kanal realtime mati, ada pengaman: interval polling
 * lambat (30 detik) sebagai cadangan — bukan interval agresif sebagai
 * satu-satunya cara.
 */

import { computed, signal } from '@preact/signals';

import { currentAdapter, getRepository } from '../data/index.ts';
import type { ConnectionStatus, OrderFilter } from '../data/repository.ts';
import { RepositoryError } from '../data/repository.ts';
import type {
  Category,
  DiningTable,
  ID,
  Menu,
  Order,
  OrderStatus,
  RealtimeSignal,
  Session,
  StoreSettings,
} from '../domain/types.ts';
import { DEMO_STORE_ID } from '../data/mock/seed.ts';

/* ==========================================================================
   Identitas toko
   ========================================================================= */

/**
 * Toko ditentukan lewat URL (`?store=...`) supaya satu deployment bisa melayani
 * banyak kafe. Kalau tidak ada, jatuh ke toko demo.
 */
function resolveStoreId(): ID {
  if (typeof window === 'undefined') return DEMO_STORE_ID;
  const p = new URLSearchParams(window.location.search);
  return p.get('store')?.trim() || DEMO_STORE_ID;
}

export const storeId = signal<ID>(resolveStoreId());

/* ==========================================================================
   State
   ========================================================================= */

export const settings = signal<StoreSettings | null>(null);
export const categories = signal<Category[]>([]);
export const menus = signal<Menu[]>([]);
export const tables = signal<DiningTable[]>([]);
export const orders = signal<Order[]>([]);
export const queueBoard = signal<Order[]>([]);
export const displayOrder = signal<Order | null>(null);
export const session = signal<Session | null>(null);

export const realtimeStatus = signal<ConnectionStatus>('connecting');
export const loading = signal(false);
export const lastError = signal<string | null>(null);
/** Naik setiap kali data berhasil dimuat ulang — dipakai indikator "baru saja". */
export const dataRevision = signal(0);

/* ==========================================================================
   Turunan
   ========================================================================= */

export const activeMenus = computed(() => menus.value.filter((m) => m.isAvailable));

export const menusByCategory = computed(() => {
  const map = new Map<ID, Menu[]>();
  for (const m of menus.value) {
    const list = map.get(m.categoryId);
    if (list) list.push(m);
    else map.set(m.categoryId, [m]);
  }
  return map;
});

export const orderStats = computed(() => {
  const list = orders.value.filter((o) => o.status !== 'cancelled');
  return {
    total: list.length,
    revenue: list.reduce((s, o) => s + o.total, 0),
    active: list.filter((o) => o.status === 'pending' || o.status === 'processing').length,
    unpaid: list.filter((o) => o.payment.status === 'unpaid').length,
  };
});

/** Order yang belum lunas dan belum dibatalkan — daftar tagihan kasir. */
export const unpaidOrders = computed(() =>
  orders.value.filter((o) => o.payment.status === 'unpaid' && o.status !== 'cancelled'),
);

/* ==========================================================================
   Pemuatan
   ========================================================================= */

export async function loadSettings(): Promise<void> {
  settings.value = await getRepository().getSettings(storeId.value);
}

export async function loadCatalog(): Promise<void> {
  const repo = getRepository();
  const [c, m, t] = await Promise.all([
    repo.listCategories(storeId.value),
    repo.listMenus(storeId.value),
    repo.listTables(storeId.value),
  ]);
  categories.value = c;
  menus.value = m;
  tables.value = t;
}

export async function loadOrders(filter?: OrderFilter): Promise<void> {
  orders.value = await getRepository().listOrders(storeId.value, filter);
}

export async function loadQueueBoard(): Promise<void> {
  queueBoard.value = await getRepository().listQueueBoard(storeId.value);
}

export async function loadDisplayOrder(): Promise<void> {
  displayOrder.value = await getRepository().getDisplayOrder(storeId.value);
}

/**
 * Muat semua data yang dibutuhkan surface admin/kasir.
 * Dipanggil sekali saat mount; selebihnya realtime yang menjaga kesegaran.
 */
export async function bootstrapAdmin(): Promise<void> {
  loading.value = true;
  lastError.value = null;
  try {
    await Promise.all([loadSettings(), loadCatalog(), loadOrders()]);
    dataRevision.value += 1;
  } catch (err) {
    lastError.value = messageOf(err);
  } finally {
    loading.value = false;
  }
}

/** Muat data untuk halaman pesan customer. */
export async function bootstrapOrder(): Promise<void> {
  loading.value = true;
  lastError.value = null;
  try {
    await Promise.all([loadSettings(), loadCatalog()]);
    dataRevision.value += 1;
  } catch (err) {
    lastError.value = messageOf(err);
  } finally {
    loading.value = false;
  }
}

/* ==========================================================================
   Penjodohan realtime
   ========================================================================= */

/** Jendela penggabungan. Sinyal yang datang beruntun jadi satu pembacaan. */
const COALESCE_MS = 150;

/** Interval pengaman kalau kanal realtime mati. Jauh lebih lambat dari aslinya. */
const FALLBACK_POLL_MS = 30_000;

const pendingScopes = new Map<RealtimeSignal['scope'], number>();
let lastRevision = 0;

/**
 * Tandai sebuah scope perlu dimuat ulang, lalu tunda sebentar.
 * Kalau dalam jendela itu ada sinyal lain untuk scope yang sama, timer-nya
 * direset — jadi 10 order yang masuk bersamaan hanya memicu satu pembacaan.
 */
function scheduleScope(scope: RealtimeSignal['scope'], handler: () => void): void {
  const existing = pendingScopes.get(scope);
  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingScopes.delete(scope);
    handler();
  }, COALESCE_MS) as unknown as number;

  pendingScopes.set(scope, timer);
}

export interface RealtimeHandlers {
  onOrders?: () => void | Promise<void>;
  onMenus?: () => void | Promise<void>;
  onSettings?: () => void | Promise<void>;
  onDisplay?: () => void | Promise<void>;
  onQueue?: () => void | Promise<void>;
}

let fallbackTimer: number | null = null;

/**
 * Sambungkan kanal realtime ke handler surface.
 * Mengembalikan fungsi pembersih — wajib dipanggil saat surface dilepas.
 */
export function connectRealtime(handlers: RealtimeHandlers): () => void {
  const repo = getRepository();
  const hub = repo.realtime;

  const safe = (fn?: () => void | Promise<void>) => () => {
    try {
      void Promise.resolve(fn?.()).catch((err) => {
        lastError.value = messageOf(err);
      });
    } catch (err) {
      lastError.value = messageOf(err);
    }
  };

  hub.start(storeId.value);

  const offSignal = hub.subscribe((signal) => {
    // Sinyal lama (mis. dari tab yang baru dibuka) diabaikan.
    if (signal.revision <= lastRevision) return;
    lastRevision = signal.revision;

    switch (signal.scope) {
      case 'orders':
        scheduleScope('orders', safe(handlers.onOrders));
        break;
      case 'menus':
        scheduleScope('menus', safe(handlers.onMenus));
        break;
      case 'settings':
        scheduleScope('settings', safe(handlers.onSettings));
        break;
      case 'display':
        scheduleScope('display', safe(handlers.onDisplay));
        break;
      case 'queue':
        scheduleScope('queue', safe(handlers.onQueue));
        break;
    }
  });

  const offStatus = hub.onStatus((s) => {
    realtimeStatus.value = s;

    // Pengaman: hanya hidupkan polling cadangan saat kanal benar-benar mati.
    if (s === 'offline' && fallbackTimer === null) {
      fallbackTimer = setInterval(() => {
        void Promise.resolve(handlers.onOrders?.()).catch(() => {});
      }, FALLBACK_POLL_MS) as unknown as number;
    } else if (s !== 'offline' && fallbackTimer !== null) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  });

  return () => {
    offSignal();
    offStatus();
    hub.stop();
    for (const timer of pendingScopes.values()) clearTimeout(timer);
    pendingScopes.clear();
    if (fallbackTimer !== null) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };
}

/* ==========================================================================
   Aksi
   ========================================================================= */

export async function setOrderStatus(id: ID, status: OrderStatus): Promise<void> {
  await getRepository().updateOrderStatus(id, status);
  await loadOrders();
}

export async function cancelOrder(id: ID, reason: string): Promise<void> {
  await getRepository().cancelOrder(id, reason);
  await loadOrders();
}

export async function signIn(username: string, password: string, pin: string): Promise<Session> {
  const s = await getRepository().signIn(storeId.value, username, password, pin);
  session.value = s;
  return s;
}

export async function signOut(): Promise<void> {
  await getRepository().signOut();
  session.value = null;
}

export async function restoreSession(): Promise<void> {
  session.value = await getRepository().currentSession();
}

/* ==========================================================================
   Utilitas
   ========================================================================= */

export function messageOf(err: unknown): string {
  if (err instanceof RepositoryError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan yang tidak diketahui';
}

/** Info untuk bilah pengembangan di kaki halaman. */
export const adapterName = computed(() => currentAdapter());
