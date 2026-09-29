/**
 * Adapter mock — "backend" in-memory untuk mode demo & pengembangan frontend.
 *
 * Meski hanya mock, dia **meniru perilaku server yang benar**, dan itu
 * disengaja:
 *
 *  - **Harga diambil dari katalog internal, bukan dari yang dikirim client.**
 *    Kalau UI mengirim harga yang salah, mock akan mengabaikannya. Ini meniru
 *    fungsi Postgres yang akan dipakai di Supabase, jadi bug "client menentukan
 *    harga" tertangkap lebih awal — sebelum backend ada.
 *  - **Penomoran order dan antrian dilakukan di sini**, bukan di UI.
 *  - **Perubahan disiarkan lewat kanal sinyal**, persis seperti Supabase
 *    Realtime nanti. UI tidak perlu tahu bedanya.
 *
 * Keadaan disimpan di localStorage supaya tahan refresh, dan disiarkan lewat
 * BroadcastChannel supaya beberapa tab (kasir + display + TV) benar-benar
 * saling sinkron saat dikembangkan di satu peramban.
 */

import type {
  Category,
  DiningTable,
  ID,
  Menu,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  RealtimeSignal,
  Session,
  StockMovement,
  StoreSettings,
} from '../../domain/types.ts';
import {
  amountDueWithUniqueCode,
  cashChange,
  computeTotals,
  needsUniqueCode,
  uniqueCodeFromSequence,
} from '../../domain/money.ts';
import { orderCode, sequenceFromOrderCode } from '../../domain/orders.ts';
import { nextQueue, type QueueState } from '../../domain/queue.ts';
import { dateKey, DEFAULT_TZ, nowIso } from '../../domain/time.ts';

import {
  DEMO_ACCOUNTS,
  DEMO_STORE_ID,
  STORAGE_KEY,
  seedCategories,
  seedMenus,
  seedSettings,
  seedTables,
} from './seed.ts';
import {
  type CategoryInput,
  type ConnectionStatus,
  type CreateOrderInput,
  type MenuInput,
  type OrderFilter,
  RepositoryError,
  type Repository,
  type StockMovementInput,
  type TableInput,
} from '../repository.ts';
import { createRealtimeHub, type PublishingRealtimeHub } from '../realtime/index.ts';

/* ==========================================================================
   Bentuk state
   ========================================================================= */

interface MockState {
  settings: StoreSettings;
  categories: Category[];
  menus: Menu[];
  tables: DiningTable[];
  orders: Order[];
  /** Riwayat pergerakan stok, terbaru di depan. */
  stockMovements: StockMovement[];
  /** Nomor urut order harian — dasar kode order & kode unik. */
  sequence: { dateKey: string; last: number };
  queue: QueueState;
  displayOrderId: ID | null;
  revision: number;
  session: Session | null;
}

/** Jeda buatan supaya perilaku asinkron terasa seperti backend sungguhan. */
const LATENCY_MS = 40;

/* ==========================================================================
   Repositori mock
   ========================================================================= */

export class MockRepository implements Repository {
  readonly realtime: PublishingRealtimeHub = createRealtimeHub();

  #state: MockState;

  constructor() {
    this.#state = this.#load();

    /**
     * Sinkronisasi antar-tab.
     *
     * Mock ini menyimpan state di memori. Kalau tab lain menulis ke
     * localStorage, salinan di sini jadi basi — pembacaan berikutnya akan
     * mengembalikan data lama, walaupun sinyal realtime-nya sudah diterima.
     *
     * Jadi: setiap sinyal dengan revisi lebih baru memaksa muat ulang dari
     * penyimpanan SEBELUM pendengar lain (termasuk UI) dipanggil. Pendengar ini
     * didaftarkan paling awal, dan Set menjaga urutan penyisipan, sehingga
     * state sudah segar saat UI melakukan pembacaan.
     *
     * Tanpa ini, beberapa tab (kasir + display + TV) tidak akan benar-benar
     * sinkron — persis masalah yang membuat aplikasi aslinya harus polling.
     */
    this.realtime.subscribe((signal) => {
      if (signal.revision > this.#state.revision) {
        this.#state = this.#load();
      }
    });

    /**
     * Sinkronisasi lintas-perangkat.
     *
     * Perangkat lain tidak berbagi localStorage, jadi memuat ulang dari
     * penyimpanan tidak ada gunanya di sana — datanya memang belum pernah ada.
     * Yang datang justru datanya sendiri, dan itu yang dipakai.
     *
     * Revisi diperiksa lebih dulu: snapshot yang tiba terlambat (sambungan
     * lambat) tidak boleh menimpa perubahan yang lebih baru dan membatalkan
     * pekerjaan yang sedang berjalan.
     *
     * Sesi lokal dipertahankan. Snapshot tidak pernah membawa sesi (lihat
     * `#commit`), jadi tanpa penjagaan ini perangkat akan terlempar keluar
     * dari akunnya sendiri setiap kali perangkat lain menyimpan perubahan.
     */
    this.realtime.onSnapshot((snapshot) => {
      if (snapshot.revision <= this.#state.revision) return;
      const masuk = snapshot.state as Partial<MockState> | null;
      if (!masuk || typeof masuk !== 'object') return;
      if (!Array.isArray(masuk.menus) || !Array.isArray(masuk.orders)) return;

      this.#state = { ...(masuk as MockState), session: this.#state.session };
      this.#persist();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Pengaturan                                                              */
  /* ---------------------------------------------------------------------- */

  async getSettings(storeId: ID): Promise<StoreSettings> {
    await this.#delay();
    return structuredClone({ ...this.#state.settings, storeId });
  }

  async saveSettings(storeId: ID, settings: StoreSettings): Promise<void> {
    await this.#delay();
    this.#state.settings = { ...structuredClone(settings), storeId };
    this.#commit('settings');
  }

  /* ---------------------------------------------------------------------- */
  /* Kategori                                                                */
  /* ---------------------------------------------------------------------- */

  async listCategories(storeId: ID): Promise<Category[]> {
    await this.#delay();
    return structuredClone(
      this.#state.categories
        .filter((c) => c.storeId === storeId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }

  async saveCategory(input: CategoryInput): Promise<Category> {
    await this.#delay();
    const category: Category = {
      id: input.id ?? `cat-${crypto.randomUUID().slice(0, 8)}`,
      storeId: input.storeId,
      name: input.name.trim(),
      icon: input.icon,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    };
    if (!category.name) throw new RepositoryError('Nama kategori wajib diisi', 'invalid');

    const i = this.#state.categories.findIndex((c) => c.id === category.id);
    if (i >= 0) this.#state.categories[i] = category;
    else this.#state.categories.push(category);

    this.#commit('menus');
    return structuredClone(category);
  }

  async deleteCategory(id: ID): Promise<void> {
    await this.#delay();
    const dipakai = this.#state.menus.some((m) => m.categoryId === id);
    if (dipakai) {
      throw new RepositoryError(
        'Kategori masih dipakai menu lain. Pindahkan menunya dulu.',
        'conflict',
      );
    }
    this.#state.categories = this.#state.categories.filter((c) => c.id !== id);
    this.#commit('menus');
  }

  /* ---------------------------------------------------------------------- */
  /* Menu                                                                    */
  /* ---------------------------------------------------------------------- */

  async listMenus(storeId: ID): Promise<Menu[]> {
    await this.#delay();
    return structuredClone(
      this.#state.menus
        .filter((m) => m.storeId === storeId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }

  async saveMenu(input: MenuInput): Promise<Menu> {
    await this.#delay();
    const name = input.name.trim();
    if (!name) throw new RepositoryError('Nama menu wajib diisi', 'invalid');
    if (input.price < 0) throw new RepositoryError('Harga tidak boleh negatif', 'invalid');
    if (input.costPrice < 0) throw new RepositoryError('HPP tidak boleh negatif', 'invalid');

    const menu: Menu = {
      id: input.id ?? `mn-${crypto.randomUUID().slice(0, 8)}`,
      storeId: input.storeId,
      name,
      categoryId: input.categoryId,
      price: Math.round(input.price),
      costPrice: Math.round(input.costPrice),
      description: input.description.trim(),
      imageUrl: input.imageUrl,
      isAvailable: input.isAvailable,
      stock: input.stock === null ? null : Math.max(0, Math.floor(input.stock)),
      sortOrder: input.sortOrder,
    };

    const i = this.#state.menus.findIndex((m) => m.id === menu.id);
    if (i >= 0) this.#state.menus[i] = menu;
    else this.#state.menus.push(menu);

    this.#commit('menus');
    return structuredClone(menu);
  }

  async deleteMenu(id: ID): Promise<void> {
    await this.#delay();
    this.#state.menus = this.#state.menus.filter((m) => m.id !== id);
    this.#commit('menus');
  }

  async setMenuAvailability(id: ID, isAvailable: boolean): Promise<void> {
    await this.#delay();
    const menu = this.#state.menus.find((m) => m.id === id);
    if (!menu) throw new RepositoryError('Menu tidak ditemukan', 'not_found');
    menu.isAvailable = isAvailable;
    this.#commit('menus');
  }

  /* ---------------------------------------------------------------------- */
  /* Meja                                                                    */
  /* ---------------------------------------------------------------------- */

  async listTables(storeId: ID): Promise<DiningTable[]> {
    await this.#delay();
    return structuredClone(
      this.#state.tables.filter((t) => t.storeId === storeId).sort((a, b) => a.number - b.number),
    );
  }

  async saveTable(input: TableInput): Promise<DiningTable> {
    await this.#delay();
    const bentrok = this.#state.tables.find(
      (t) => t.storeId === input.storeId && t.number === input.number && t.id !== input.id,
    );
    if (bentrok) {
      throw new RepositoryError(`Meja nomor ${input.number} sudah ada`, 'conflict');
    }

    const table: DiningTable = {
      id: input.id ?? `tbl-${crypto.randomUUID().slice(0, 8)}`,
      storeId: input.storeId,
      number: input.number,
      name: input.name.trim() || `Meja ${input.number}`,
      capacity: Math.max(1, Math.floor(input.capacity)),
      status: input.status,
      qrToken: input.id
        ? (this.#state.tables.find((t) => t.id === input.id)?.qrToken ??
          crypto.randomUUID().slice(0, 12))
        : crypto.randomUUID().slice(0, 12),
    };

    const i = this.#state.tables.findIndex((t) => t.id === table.id);
    if (i >= 0) this.#state.tables[i] = table;
    else this.#state.tables.push(table);

    this.#commit('settings');
    return structuredClone(table);
  }

  async deleteTable(id: ID): Promise<void> {
    await this.#delay();
    this.#state.tables = this.#state.tables.filter((t) => t.id !== id);
    this.#commit('settings');
  }

  async getTableByToken(token: string): Promise<DiningTable | null> {
    await this.#delay();
    const table = this.#state.tables.find((t) => t.qrToken === token);
    return table ? structuredClone(table) : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Order                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Membuat order.
   *
   * Perhatikan: harga TIDAK diambil dari `input.items`, melainkan dicari ulang
   * dari katalog di sini. Item yang menunya sudah tidak ada akan ditolak.
   * Ini yang membuat harga tidak bisa dimanipulasi dari browser.
   */
  async createOrder(input: CreateOrderInput): Promise<Order> {
    await this.#delay();

    if (input.items.length === 0) {
      throw new RepositoryError('Keranjang kosong', 'invalid');
    }

    // 1. Resolusi harga dari katalog internal.
    const items: OrderItem[] = input.items.map((dikirim) => {
      const menu = this.#state.menus.find((m) => m.id === dikirim.menuId);
      if (!menu) {
        throw new RepositoryError(`Menu tidak ditemukan: ${dikirim.menuId}`, 'not_found');
      }
      if (!menu.isAvailable) {
        throw new RepositoryError(`${menu.name} sedang tidak tersedia`, 'conflict');
      }
      const qty = Math.max(1, Math.floor(dikirim.qty));
      return {
        menuId: menu.id,
        name: menu.name,
        price: menu.price, // ← harga dari katalog, bukan dari client
        qty,
        notes: (dikirim.notes ?? '').trim(),
        costPrice: menu.costPrice,
      };
    });

    // 2. Total.
    const totals = computeTotals({
      items,
      discount: input.discount,
      taxPercent: this.#taxFor(input.paymentMethod),
      serviceAmount: this.#serviceFor(input.paymentMethod),
    });

    // 3. Nomor urut harian & kode order.
    const today = dateKey(new Date(), DEFAULT_TZ);
    if (this.#state.sequence.dateKey !== today) {
      this.#state.sequence = { dateKey: today, last: 0 };
    }
    this.#state.sequence.last += 1;
    const sequence = this.#state.sequence.last;
    const code = orderCode(input.channel, new Date(), sequence, DEFAULT_TZ);

    // 4. Nomor antrian (reset harian, dikelola di satu tempat).
    const queueResult = nextQueue(this.#state.queue, today, this.#state.settings.queue.prefix);
    this.#state.queue = queueResult.state;

    // 5. Kode unik + nominal akhir.
    // Kode unik hanya untuk metode yang perlu dicocokkan ke mutasi bank.
    // Tunai & debit diselesaikan kasir di tempat, jadi nominalnya bulat.
    const uniqueCode =
      this.#state.settings.payments.uniqueCodeEnabled && needsUniqueCode(input.paymentMethod)
        ? uniqueCodeFromSequence(sequence, this.#state.settings.payments.uniqueCodeRange)
        : 0;
    const amountDue = amountDueWithUniqueCode(totals.total, uniqueCode);

    // 6. Status pembayaran awal.
    const cashReceived = Math.max(0, Math.round(input.cashReceived ?? 0));
    const lunasLangsung =
      input.paymentMethod === 'cash' ||
      input.paymentMethod === 'debit' ||
      (input.paymentMethod === 'split' && (input.splits?.length ?? 0) > 0);

    const payment: Payment = {
      method: input.paymentMethod,
      status: lunasLangsung ? 'paid' : 'unpaid',
      uniqueCode,
      amountDue,
      amountPaid: lunasLangsung ? amountDue : 0,
      cashReceived: input.paymentMethod === 'cash' ? cashReceived : 0,
      cashChange:
        input.paymentMethod === 'cash' && cashReceived >= amountDue
          ? cashChange(cashReceived, amountDue)
          : 0,
      reference: '',
      paidAt: lunasLangsung ? nowIso() : null,
      splits: input.splits ? [...input.splits] : [],
    };

    const now = nowIso();
    const order: Order = {
      id: `ord-${crypto.randomUUID().slice(0, 12)}`,
      storeId: input.storeId,
      code,
      channel: input.channel,
      queueNumber: queueResult.label,
      tableNumber: input.tableNumber,
      customerName: input.customerName.trim() || 'Tanpa nama',
      customerEmail: input.customerEmail.trim(),
      customerNotes: input.customerNotes.trim(),
      cashierName: input.cashierName.trim(),
      items,
      subtotal: totals.subtotal,
      discountType: input.discount.type,
      discountValue: input.discount.value,
      discountAmount: totals.discountAmount,
      taxPercent: totals.taxPercent,
      taxAmount: totals.taxAmount,
      serviceAmount: totals.serviceAmount,
      total: totals.total,
      totalCost: totals.totalCost,
      payment,
      status: 'pending',
      calledAt: null,
      callCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
    };

    this.#state.orders.unshift(order);

    // 7. Kurangi stok untuk menu yang dilacak, dan catat pergerakannya.
    //
    //    Catatan ini yang menjawab pertanyaan "kenapa stok berkurang 5 padahal
    //    penjualan hanya 3" — pertanyaan yang tidak bisa dijawab aplikasi
    //    aslinya karena hanya menyimpan satu angka tanpa jejak.
    const pergerakan: StockMovement[] = [];
    for (const item of items) {
      const menu = this.#state.menus.find((m) => m.id === item.menuId);
      if (!menu || menu.stock === null) continue;

      menu.stock = Math.max(0, menu.stock - item.qty);
      if (menu.stock === 0) menu.isAvailable = false;

      pergerakan.push({
        // Id diturunkan dari order dan menu, sehingga kiriman ulang order yang
        // sama tidak bisa mencatat penjualan dua kali.
        id: `sm-${order.id}-${item.menuId}`,
        storeId: input.storeId,
        menuId: menu.id,
        menuName: menu.name,
        delta: -item.qty,
        balance: menu.stock,
        reason: 'sale',
        note: `Order ${order.code}`,
        actor: input.cashierName.trim() || 'Pesan sendiri',
        at: now,
      });
    }
    if (pergerakan.length > 0) {
      this.#state.stockMovements.unshift(...pergerakan);
    }

    this.#commit('orders');
    return structuredClone(order);
  }

  async listOrders(storeId: ID, filter: OrderFilter = {}): Promise<Order[]> {
    await this.#delay();
    let hasil = this.#state.orders.filter((o) => o.storeId === storeId);

    if (filter.from) {
      const from = Date.parse(filter.from);
      hasil = hasil.filter((o) => Date.parse(o.createdAt) >= from);
    }
    if (filter.to) {
      const to = Date.parse(filter.to);
      hasil = hasil.filter((o) => Date.parse(o.createdAt) <= to);
    }
    if (filter.status?.length) {
      const set = new Set(filter.status);
      hasil = hasil.filter((o) => set.has(o.status));
    }
    if (filter.channel) {
      hasil = hasil.filter((o) => o.channel === filter.channel);
    }
    if (filter.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      hasil = hasil.filter(
        (o) =>
          o.code.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          (o.queueNumber ?? '').toLowerCase().includes(q) ||
          String(o.tableNumber ?? '').includes(q),
      );
    }

    hasil.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (filter.limit) hasil = hasil.slice(0, filter.limit);

    return structuredClone(hasil);
  }

  async getOrder(id: ID): Promise<Order | null> {
    await this.#delay();
    const order = this.#state.orders.find((o) => o.id === id);
    return order ? structuredClone(order) : null;
  }

  async getOrderByCode(storeId: ID, code: string): Promise<Order | null> {
    await this.#delay();
    const cari = code.trim().toUpperCase();
    const order = this.#state.orders.find(
      (o) => o.storeId === storeId && (o.code.toUpperCase() === cari || o.queueNumber === cari),
    );
    return order ? structuredClone(order) : null;
  }

  async updateOrderStatus(id: ID, status: OrderStatus): Promise<void> {
    await this.#delay();
    const order = this.#state.orders.find((o) => o.id === id);
    if (!order) throw new RepositoryError('Order tidak ditemukan', 'not_found');

    order.status = status;
    order.updatedAt = nowIso();
    if (status === 'completed') order.completedAt = nowIso();

    this.#commit('orders');
  }

  async cancelOrder(id: ID, reason: string): Promise<void> {
    await this.#delay();
    const order = this.#state.orders.find((o) => o.id === id);
    if (!order) throw new RepositoryError('Order tidak ditemukan', 'not_found');
    if (order.status === 'completed' || order.status === 'cancelled') {
      throw new RepositoryError('Order ini sudah tidak bisa dibatalkan', 'conflict');
    }

    order.status = 'cancelled';
    order.cancelReason = reason.trim() || 'Tanpa alasan';
    order.cancelledAt = nowIso();
    order.updatedAt = nowIso();

    // Kembalikan stok.
    for (const item of order.items) {
      const menu = this.#state.menus.find((m) => m.id === item.menuId);
      if (menu && menu.stock !== null) {
        menu.stock += item.qty;
        if (menu.stock > 0) menu.isAvailable = true;
      }
    }

    this.#commit('orders');
  }

  async recordPayment(id: ID, payment: Payment): Promise<void> {
    await this.#delay();
    const order = this.#state.orders.find((o) => o.id === id);
    if (!order) throw new RepositoryError('Order tidak ditemukan', 'not_found');
    if (order.payment.status === 'paid') {
      throw new RepositoryError('Order ini sudah lunas', 'conflict');
    }

    order.payment = { ...structuredClone(payment), status: 'paid', paidAt: nowIso() };
    order.updatedAt = nowIso();
    this.#commit('orders');
  }

  /* ---------------------------------------------------------------------- */
  /* Antrian                                                                 */
  /* ---------------------------------------------------------------------- */

  async listQueueBoard(storeId: ID): Promise<Order[]> {
    await this.#delay();
    const hariIni = dateKey(new Date(), DEFAULT_TZ);
    return structuredClone(
      this.#state.orders.filter(
        (o) =>
          o.storeId === storeId &&
          o.queueNumber !== null &&
          o.status !== 'cancelled' &&
          dateKey(o.createdAt, DEFAULT_TZ) === hariIni,
      ),
    );
  }

  async callQueue(id: ID): Promise<void> {
    await this.#delay();
    const order = this.#state.orders.find((o) => o.id === id);
    if (!order) throw new RepositoryError('Order tidak ditemukan', 'not_found');

    // Panggilan tercatat di data, bukan hanya disiarkan sesaat. Dengan begitu
    // TV yang baru dinyalakan (atau sempat putus jaringan) tetap tahu nomor
    // mana yang terakhir dipanggil — aplikasi aslinya hanya menyiarkan event
    // sesaat, sehingga TV yang baru dibuka tidak menampilkan apa pun.
    order.calledAt = nowIso();
    order.callCount += 1;
    order.updatedAt = order.calledAt;

    this.#commit('queue');
  }

  /* ---------------------------------------------------------------------- */
  /* Layar pelanggan                                                         */
  /* ---------------------------------------------------------------------- */

  async getDisplayOrder(storeId: ID): Promise<Order | null> {
    await this.#delay();
    const id = this.#state.displayOrderId;
    if (!id) return null;
    const order = this.#state.orders.find((o) => o.id === id && o.storeId === storeId);
    return order ? structuredClone(order) : null;
  }

  async setDisplayOrder(storeId: ID, orderId: ID | null): Promise<void> {
    await this.#delay();
    if (orderId) {
      const order = this.#state.orders.find((o) => o.id === orderId && o.storeId === storeId);
      if (!order) throw new RepositoryError('Order tidak ditemukan', 'not_found');

      // Order yang sudah dibatalkan atau selesai tidak boleh dikirim ke layar
      // pelanggan — kalau lolos, layar akan menampilkan QR pembayaran untuk
      // pesanan yang tidak ada.
      if (order.status === 'cancelled') {
        throw new RepositoryError('Order yang dibatalkan tidak bisa dikirim ke layar pelanggan', 'conflict');
      }
      if (order.status === 'completed') {
        throw new RepositoryError('Order yang sudah selesai tidak bisa dikirim ke layar pelanggan', 'conflict');
      }
    }
    this.#state.displayOrderId = orderId;
    this.#commit('display');
  }

  /* ---------------------------------------------------------------------- */
  /* Sesi                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Verifikasi kredensial.
   *
   * CATATAN PENTING: di adapter mock ini pemeriksaan terjadi di sisi "server"
   * yang kebetulan satu proses dengan client, jadi bisa dibaca dari DevTools —
   * itu tidak terhindarkan untuk mode demo.
   *
   * Di adapter Supabase nanti, verifikasi terjadi di server (fungsi Postgres +
   * RLS), dan **tidak ada PIN atau kata sandi di dalam kode yang dikirim ke
   * browser**. Inilah perbaikan dari aplikasi aslinya, yang menaruh
   * `.getAdminData('123456', ...)` langsung di JavaScript client.
   *
   * Peran datang dari akunnya, bukan dari pilihan di layar masuk. Kalau
   * pengguna bisa memilih sendiri "masuk sebagai pemilik", pemisahan peran
   * tidak ada gunanya.
   */
  async signIn(storeId: ID, username: string, password: string, pin: string): Promise<Session> {
    await this.#delay(220);

    const akun = DEMO_ACCOUNTS.find((a) => a.username === username.trim().toLowerCase());

    // Semua kegagalan memakai pesan yang sama. Membedakan "nama pengguna tidak
    // ada" dari "PIN salah" justru memberi tahu penyerang bagian mana yang
    // sudah benar.
    if (!akun || password !== akun.password || pin !== akun.pin) {
      throw new RepositoryError('Nama pengguna, sandi, atau PIN salah', 'unauthorized');
    }

    const session: Session = {
      userId: akun.userId,
      storeId,
      role: akun.role,
      displayName: akun.displayName,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    };
    this.#state.session = session;
    this.#persist();
    return structuredClone(session);
  }

  async signOut(): Promise<void> {
    this.#state.session = null;
    this.#persist();
  }

  async currentSession(): Promise<Session | null> {
    const s = this.#state.session;
    if (!s) return null;
    if (Date.parse(s.expiresAt) < Date.now()) {
      this.#state.session = null;
      this.#persist();
      return null;
    }
    return structuredClone(s);
  }

  /* ---------------------------------------------------------------------- */
  /* Internal                                                                */
  /* ---------------------------------------------------------------------- */

  /** Pajak hanya berlaku di kanal yang dikonfigurasi (kosong = semua kanal). */
  #taxFor(_method: Payment['method']): number {
    const t = this.#state.settings.tax;
    return t.percent;
  }

  #serviceFor(_method: Payment['method']): number {
    const s = this.#state.settings.serviceFee;
    return s.enabled ? s.amount : 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Stok                                                                    */
  /* ---------------------------------------------------------------------- */

  async listStockMovements(storeId: ID, menuId?: ID): Promise<StockMovement[]> {
    await this.#delay();
    return structuredClone(
      this.#state.stockMovements
        .filter((m) => m.storeId === storeId && (!menuId || m.menuId === menuId))
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  }

  async recordStockMovement(input: StockMovementInput): Promise<StockMovement> {
    await this.#delay();

    const menu = this.#state.menus.find((m) => m.id === input.menuId);
    if (!menu) throw new RepositoryError('Menu tidak ditemukan', 'not_found');

    // Menu tanpa pelacakan tidak bisa dicatat pergerakannya: saldonya tidak
    // punya titik awal, jadi hasilnya akan tampak seperti stok yang muncul
    // dari udara.
    if (menu.stock === null) {
      throw new RepositoryError('Menu ini tidak dilacak stoknya', 'invalid');
    }

    if (!Number.isInteger(input.delta) || input.delta === 0) {
      throw new RepositoryError('Jumlah pergerakan harus bilangan bulat bukan nol', 'invalid');
    }

    const saldoBaru = menu.stock + input.delta;
    if (saldoBaru < 0) {
      throw new RepositoryError(
        `Stok tidak cukup: tersisa ${menu.stock}, diminta ${Math.abs(input.delta)}`,
        'conflict',
      );
    }

    menu.stock = saldoBaru;
    // Stok yang kembali terisi otomatis bisa dijual lagi. Sebaliknya, kalau
    // stok habis, menu disembunyikan dari pelanggan.
    if (saldoBaru > 0) menu.isAvailable = true;

    const movement: StockMovement = {
      id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      storeId: input.storeId,
      menuId: menu.id,
      menuName: menu.name,
      delta: input.delta,
      balance: saldoBaru,
      reason: input.reason,
      note: input.note,
      actor: input.actor,
      at: nowIso(),
    };
    this.#state.stockMovements.unshift(movement);

    // Dua scope sekaligus: stok berubah, dan katalog ikut berubah karena
    // saldo menu disimpan di sana.
    this.#commit('stock');
    this.#commit('menus');

    return structuredClone(movement);
  }

  /** Simpan + siarkan sinyal perubahan. */
  #commit(scope: RealtimeSignal['scope']): void {
    this.#state.revision += 1;
    this.#persist();

    const signal: RealtimeSignal = {
      storeId: this.#state.settings.storeId,
      revision: this.#state.revision,
      scope,
      at: nowIso(),
    };
    this.realtime.publish(signal);

    // Sesi TIDAK ikut dikirim. Sesi adalah milik perangkat ini, bukan milik
    // toko — mengirimkannya berarti setiap perangkat lain menerima identitas
    // pengguna yang sedang masuk di sini.
    const { session: _sesiMilikPerangkatIni, ...tanpaSesi } = this.#state;
    void _sesiMilikPerangkatIni;

    // Snapshot penuh hanya berguna untuk jalur lintas-perangkat. Tanpa ini,
    // perangkat kedua menerima "revisi 12" untuk data yang tidak pernah ia
    // miliki, dan sinkronisasi lintas-perangkat tidak pernah benar-benar jalan.
    this.realtime.publishSnapshot({
      storeId: signal.storeId,
      revision: signal.revision,
      state: tanpaSesi,
    });
  }

  #persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state));
    } catch {
      // Mode privat / kuota penuh: tetap jalan di memori saja.
    }
  }

  #load(): MockState {
    const kosong = (): MockState => ({
      settings: structuredClone(seedSettings),
      categories: structuredClone(seedCategories),
      menus: structuredClone(seedMenus),
      tables: structuredClone(seedTables),
      orders: [],
      stockMovements: [],
      sequence: { dateKey: dateKey(new Date(), DEFAULT_TZ), last: 0 },
      queue: { prefix: seedSettings.queue.prefix, lastNumber: 0, dateKey: dateKey(new Date(), DEFAULT_TZ) },
      displayOrderId: null,
      revision: 0,
      session: null,
    });

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return kosong();
      const parsed = JSON.parse(raw) as Partial<MockState>;
      const base = kosong();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        // Versi seed baru harus tetap terpakai kalau menu belum pernah diubah.
        categories: parsed.categories?.length ? parsed.categories : base.categories,
        menus: parsed.menus?.length ? parsed.menus : base.menus,
        tables: parsed.tables?.length ? parsed.tables : base.tables,
        orders: parsed.orders ?? [],
      };
    } catch {
      return kosong();
    }
  }

  /** Reset penuh — dipakai tombol "reset data demo". */
  resetDemoData(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* diabaikan */
    }
    this.#state = this.#load();
    this.#commit('orders');
  }

  /**
   * Isi data demo: beberapa order dengan status berbeda-beda.
   *
   * Gunanya bukan sekadar hiasan — ini cara memverifikasi seluruh alur
   * (penomoran antrian, kode unik, perhitungan total, transisi status) bekerja
   * di peramban nyata, bukan hanya di unit test.
   */
  async seedDemoOrders(): Promise<number> {
    const menu = this.#state.menus;
    if (menu.length === 0) return 0;

    const pelanggan = ['Dede', 'Rina', 'Bagas', 'Sinta', 'Yoga', 'Maya', 'Fikri'];
    /**
     * `umurMenit` memundurkan waktu pembuatan order.
     *
     * Tanpa ini semua order demo dibuat pada detik yang sama, jadi seluruh
     * kartu di layar dapur menampilkan "0 mnt" dan indikator urgensi (normal →
     * terlambat → sangat terlambat) tidak pernah terlihat bekerja. Data demo
     * yang semua seragam menyembunyikan fitur yang justru paling penting di
     * layar itu.
     */
    const buat = async (
      picks: [number, number][],
      status: Order['status'],
      lunas: boolean,
      meja: number | null,
      umurMenit = 0,
    ): Promise<Order> => {
      const order = await this.createOrder({
        storeId: DEMO_STORE_ID,
        channel: meja === null ? 'pos' : 'self_order',
        tableNumber: meja,
        customerName: pelanggan[Math.floor(Math.random() * pelanggan.length)] ?? 'Tamu',
        customerEmail: '',
        customerNotes: '',
        cashierName: meja === null ? 'Andi' : '',
        items: picks.map(([idx, qty]) => {
          const m = menu[idx % menu.length]!;
          return {
            menuId: m.id,
            name: m.name,
            price: m.price,
            qty,
            notes: '',
            costPrice: m.costPrice,
          };
        }),
        discount: { type: 'none', value: 0 },
        // Belum dibayar → QRIS toko (statis + nominal disisipkan = dinamis),
        // supaya layar pelanggan benar-benar menampilkan QR yang bisa discan.
        // Sudah dibayar → tunai, supaya riwayatnya beragam.
        paymentMethod: lunas ? 'cash' : 'qris_static',
        cashReceived: lunas ? 1_000_000 : 0,
      });

      if (umurMenit > 0) {
        const asli = this.#state.orders.find((o) => o.id === order.id);
        if (asli) {
          const dibuat = new Date(Date.parse(asli.createdAt) - umurMenit * 60_000).toISOString();
          asli.createdAt = dibuat;
          asli.updatedAt = dibuat;
        }
      }

      if (status !== 'pending') {
        await this.updateOrderStatus(order.id, status);
      }
      return order;
    };

    // Sudah dipanggil & menunggu diambil → muncul besar di layar antrian.
    const a = await buat([[0, 2], [6, 1]], 'ready', true, 3, 19);
    await this.callQueue(a.id);

    // Sudah dipanggil lebih dulu (panggilan ulang kedua) → paling lama menunggu.
    const b = await buat([[2, 1], [11, 1]], 'ready', true, 5, 26);
    await this.callQueue(b.id);
    await this.callQueue(b.id);

    // Sedang dikerjakan dapur — dua umur berbeda supaya warna urgensi terlihat.
    await buat([[11, 1], [14, 1], [18, 1]], 'processing', true, 1, 13);
    await buat([[1, 3]], 'processing', false, 2, 5);

    // Antre, belum dibayar (muncul di tagihan kasir).
    await buat([[3, 2], [16, 1]], 'pending', false, 4, 3);
    await buat([[9, 1], [10, 2]], 'pending', false, null, 2);
    await buat([[7, 1], [19, 1]], 'pending', false, null, 1);

    // Selesai hari ini (untuk laporan).
    await buat([[4, 2]], 'completed', true, 6, 52);
    await buat([[13, 1], [17, 2]], 'completed', true, null, 38);

    // Satu dibatalkan, untuk menguji tampilan.
    const c = await buat([[5, 1]], 'pending', false, 7, 9);
    await this.cancelOrder(c.id, 'Pelanggan berubah pikiran');

    // Umur order diubah langsung di state, jadi sinyalnya harus dikirim ulang
    // supaya tab lain ikut memuat data yang sudah dimundurkan.
    this.#commit('orders');
    return this.#state.orders.length;
  }

  #delay(ms: number = LATENCY_MS): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export { DEMO_STORE_ID };
