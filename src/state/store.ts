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
import type {
  ConnectionStatus,
  CreateOrderInput,
  OrderFilter,
  StockMovementInput,
} from '../data/repository.ts';
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
  StockMovement,
  StoreSettings,
} from '../domain/types.ts';
import { DEMO_STORE_ID } from '../data/mock/seed.ts';
import { LocalStorageOutboxStore, Outbox } from '../domain/outbox.ts';
import {
  type AdminView,
  type Permission,
  can as roleCan,
  canView as roleCanView,
  firstAllowedView,
} from '../domain/permissions.ts';
import { lowStockMenus as daftarStokMenipis } from '../domain/stock.ts';
import type { RealtimeTransport } from '../data/realtime/index.ts';

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
/** Riwayat pergerakan stok, terbaru di depan. */
export const stockMovements = signal<StockMovement[]>([]);
export const queueBoard = signal<Order[]>([]);
export const displayOrder = signal<Order | null>(null);
export const session = signal<Session | null>(null);

export const realtimeStatus = signal<ConnectionStatus>('connecting');
export const loading = signal(false);
export const lastError = signal<string | null>(null);
/** Naik setiap kali data berhasil dimuat ulang — dipakai indikator "baru saja". */
export const dataRevision = signal(0);

/**
 * Apakah peramban mengaku punya jaringan.
 *
 * Ini hanya petunjuk, bukan kebenaran: `navigator.onLine` tetap `true` selama
 * ada antarmuka jaringan, walaupun wifi-nya tidak bisa menjangkau apa pun.
 * Karena itu yang menangani kegagalan sungguhan adalah antrean tulis, bukan
 * pemeriksaan ini — lihat `outbox`.
 */
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

/** Jumlah tulisan yang masih menunggu dikirim. */
export const pendingWrites = signal(0);

/** Jalur realtime yang sedang dipakai: antar-tab saja, atau lintas-perangkat. */
export const realtimeTransport = signal<RealtimeTransport>('tab');

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

/** Menu yang stoknya habis atau menipis — sumber peringatan bahan. */
export const lowStockMenus = computed(() =>
  daftarStokMenipis(menus.value, settings.value?.stock.lowStockThreshold ?? 0),
);

/** Peran pengguna yang sedang masuk, atau null kalau belum masuk. */
export const role = computed(() => session.value?.role ?? null);

/* ==========================================================================
   Izin
   ========================================================================= */

/**
 * Izin diperiksa lewat fungsi di lapisan state, bukan disebar sebagai `if` di
 * dalam komponen. Satu tempat, bisa diuji, dan tidak ada layar yang bisa lupa
 * memeriksanya.
 */
export function can(permission: Permission): boolean {
  const r = session.value?.role;
  return r ? roleCan(r, permission) : false;
}

export function canView(view: AdminView): boolean {
  const r = session.value?.role;
  return r ? roleCanView(r, view) : false;
}

/**
 * Layar yang benar-benar boleh dibuka.
 *
 * Dipakai saat layar yang dituju tidak diizinkan — mis. juru masak membuka
 * tautan kasir. Yang dikembalikan bukan pesan galat, melainkan layar pertama
 * yang memang boleh dia buka.
 */
export function resolveView(ingin: AdminView): AdminView {
  const r = session.value?.role;
  return r ? firstAllowedView(r, ingin) : ingin;
}

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

export async function loadStock(): Promise<void> {
  stockMovements.value = await getRepository().listStockMovements(storeId.value);
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
  onStock?: () => void | Promise<void>;
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

  // Laporkan jalur mana yang dipakai, supaya layar bisa memilih kalimat yang
  // benar: "hanya sinkron antar-tab" berbeda artinya dari "terputus".
  const denganTransport = hub as { transport?: () => RealtimeTransport };
  if (typeof denganTransport.transport === 'function') {
    realtimeTransport.value = denganTransport.transport();
  }

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
      case 'stock':
        scheduleScope('stock', safe(handlers.onStock));
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
   Antrean tulis luring
   ========================================================================= */

/**
 * Antrean tulis — satu untuk seluruh aplikasi.
 *
 * Sengaja tunggal. Kalau tiap layar punya antreannya sendiri, urutan
 * penulisan antar layar tidak lagi terjaga, dan dua antrean bisa mengirim
 * perubahan yang saling menimpa dalam urutan yang salah.
 */
export const outbox = new Outbox(new LocalStorageOutboxStore());

function syncPendingWrites(): void {
  pendingWrites.value = outbox.pending().length;
}

outbox.subscribe(syncPendingWrites);
syncPendingWrites();

/** Operasi yang boleh mengantre saat jaringan mati. */
export type OutboxOp =
  | 'createOrder'
  | 'updateOrderStatus'
  | 'cancelOrder'
  | 'recordStockMovement';

/**
 * Cara mengirim ulang tiap operasi.
 *
 * Dipisah sebagai tabel supaya menambah operasi baru cukup menambah satu
 * baris — bukan menambah cabang `if` di tengah fungsi pengiriman.
 */
const PENGIRIM: Record<OutboxOp, (payload: unknown) => Promise<void>> = {
  createOrder: async (p) => {
    await getRepository().createOrder(p as CreateOrderInput);
  },
  updateOrderStatus: async (p) => {
    const { id, status } = p as { id: ID; status: OrderStatus };
    await getRepository().updateOrderStatus(id, status);
  },
  cancelOrder: async (p) => {
    const { id, reason } = p as { id: ID; reason: string };
    await getRepository().cancelOrder(id, reason);
  },
  recordStockMovement: async (p) => {
    await getRepository().recordStockMovement(p as StockMovementInput);
  },
};

/**
 * Apakah galat ini berarti "jaringan bermasalah" — bukan "permintaan ditolak".
 *
 * Bedanya menentukan: permintaan yang ditolak server (harga salah, stok tidak
 * cukup) akan tetap ditolak kalau dikirim ulang, jadi mengantrekannya hanya
 * menunda kegagalan. Yang diantrekan hanyalah kegagalan yang bisa sembuh
 * sendiri.
 */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof RepositoryError) return err.code === 'network';
  // `fetch` yang tidak bisa menjangkau apa pun melempar TypeError.
  if (err instanceof TypeError) return true;
  return false;
}

/**
 * Tulis lewat antrean: coba sekarang, dan kalau jaringannya yang bermasalah,
 * simpan untuk dikirim nanti.
 *
 * Mengembalikan `tertunda` supaya layar bisa jujur mengatakan "tersimpan,
 * akan dikirim" alih-alih "berhasil" — dua hal yang berbeda bagi kasir yang
 * sedang melayani antrean.
 */
export async function writeThrough<T>(
  op: OutboxOp,
  payload: unknown,
  run: () => Promise<T>,
): Promise<{ hasil: T | null; tertunda: boolean }> {
  try {
    const hasil = await run();
    // Ada kemungkinan antrean lama ikut terkirim sekarang.
    void flushOutbox();
    return { hasil, tertunda: false };
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    outbox.add(op, payload);
    return { hasil: null, tertunda: true };
  }
}

let sedangKirim = false;

/**
 * Kirim isi antrean yang sudah jatuh tempo.
 *
 * Berurutan, satu per satu, dan tidak tumpang-tindih dengan dirinya sendiri.
 * Urutannya penting: menandai order lunas sebelum ordernya terkirim akan
 * gagal, dan pengiriman bersamaan bisa membuat order dibuat dua kali.
 */
export async function flushOutbox(): Promise<void> {
  if (sedangKirim) return;
  sedangKirim = true;

  try {
    for (;;) {
      const siap = outbox.due();
      if (siap.length === 0) break;

      const entri = siap[0]!;
      const kirim = PENGIRIM[entri.op as OutboxOp];
      if (!kirim) {
        // Operasi tak dikenal: tandai gagal permanen supaya tidak menahan
        // antrean di belakangnya selamanya.
        outbox.markSending(entri.id);
        outbox.markFailed(entri.id, `operasi tidak dikenal: ${entri.op}`);
        continue;
      }

      outbox.markSending(entri.id);
      try {
        await kirim(entri.payload);
        outbox.markDone(entri.id);
      } catch (err) {
        if (!isOfflineError(err)) {
          // Ditolak server — mengulanginya tidak akan berubah.
          outbox.markFailed(entri.id, messageOf(err));
          continue;
        }
        outbox.markFailed(entri.id, messageOf(err));
        // Jaringan masih mati; tidak ada gunanya mencoba entri berikutnya.
        break;
      }
    }
  } finally {
    sedangKirim = false;
    syncPendingWrites();
  }
}

/** Pantau keadaan jaringan dan kirim antrean begitu kembali tersambung. */
export function watchConnectivity(): () => void {
  if (typeof window === 'undefined') return () => {};

  const perbarui = (): void => {
    online.value = navigator.onLine;
    if (navigator.onLine) void flushOutbox();
  };

  window.addEventListener('online', perbarui);
  window.addEventListener('offline', perbarui);
  perbarui();

  return () => {
    window.removeEventListener('online', perbarui);
    window.removeEventListener('offline', perbarui);
  };
}

/** Catat pergerakan stok, dengan antrean luring yang sama. */
export async function recordStockMovement(
  input: Omit<StockMovementInput, 'storeId'>,
): Promise<{ tertunda: boolean }> {
  const lengkap: StockMovementInput = { ...input, storeId: storeId.value };
  const { tertunda } = await writeThrough('recordStockMovement', lengkap, () =>
    getRepository().recordStockMovement(lengkap),
  );
  await Promise.all([loadStock(), loadCatalog()]);
  return { tertunda };
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
