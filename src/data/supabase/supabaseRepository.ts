/**
 * Adapter Supabase — implementasi `Repository` di atas Postgres + Realtime.
 *
 * Bentuknya sengaja tipis. Hampir setiap metode hanya memanggil satu fungsi
 * Postgres, karena di situlah keputusannya diambil: harga, penomoran order,
 * nomor antrian, kode unik, pemotongan stok, dan pemeriksaan peran semuanya
 * terjadi di server. Client tidak menghitung apa pun yang menentukan uang.
 *
 * Perhatikan apa yang TIDAK ada di berkas ini:
 *
 *  - tidak ada perhitungan total, pajak, atau diskon
 *  - tidak ada pembuatan kode order atau nomor antrian
 *  - tidak ada pemeriksaan stok
 *  - tidak ada PIN atau kata sandi
 *
 * Semuanya sudah ada di schema.sql. Kalau salah satunya ditambahkan di sini,
 * akan ada dua sumber kebenaran — dan yang di client selalu kalah.
 */

import type {
  Category,
  DiningTable,
  ID,
  Menu,
  Order,
  OrderStatus,
  Payment,
  QueueBoardOrder,
  Session,
  StockMovement,
  StoreSettings,
} from '../../domain/types.ts';
import type {
  CategoryInput,
  CreateOrderInput,
  MenuInput,
  OrderFilter,
  Repository,
  RealtimeHub,
  StockMovementInput,
  TableInput,
} from '../repository.ts';
import { RepositoryError } from '../repository.ts';
import { call, getClient, getToken, requireToken, setToken, toRepositoryError } from './client.ts';
import { SupabaseRealtimeHub } from './realtimeHub.ts';
import {
  toCategory,
  toMenu,
  toSettings,
  toTable,
  type CategoryRow,
  type MenuRow,
  type SettingsRow,
  type TableRow,
} from './rows.ts';

/* ==========================================================================
   Pembantu
   ========================================================================== */

/**
 * Panggil fungsi Postgres. `args` memakai nama parameter apa adanya
 * (`p_token`, `p_input`, …) karena itulah yang PostgREST harapkan.
 */
async function rpc<T>(nama: string, args: Record<string, unknown>): Promise<T> {
  return call(async () => {
    const { data, error } = await getClient().rpc(nama, args);
    if (error) throw error;
    return data as T;
  });
}

/** Panggil fungsi yang tidak mengembalikan apa pun. */
async function rpcVoid(nama: string, args: Record<string, unknown>): Promise<void> {
  await rpc<null>(nama, args);
}

/* ==========================================================================
   Adapter
   ========================================================================== */

export class SupabaseRepository implements Repository {
  readonly realtime: RealtimeHub = new SupabaseRealtimeHub();

  /* --- Pengaturan & master data ----------------------------------------- */

  /**
   * Pengaturan, kategori, dan menu dibaca LANGSUNG dari tabelnya, bukan lewat
   * fungsi. Tabel-tabel itu punya policy SELECT untuk anon karena halaman
   * pesan-sendiri memang menampilkannya tanpa login — dan datanya memang
   * dimaksudkan untuk pelanggan.
   */
  async getSettings(storeId: ID): Promise<StoreSettings> {
    const row = await call(async () => {
      const { data, error } = await getClient()
        .from('settings')
        .select('store_id, data')
        .eq('store_id', storeId)
        .maybeSingle();
      if (error) throw error;
      return data as SettingsRow | null;
    });

    if (!row) {
      throw new RepositoryError(`Pengaturan toko ${storeId} belum ada`, 'not_found');
    }
    return toSettings(row);
  }

  async saveSettings(storeId: ID, settings: StoreSettings): Promise<void> {
    // `storeId` dari argumen diabaikan; server memakai toko milik sesinya.
    // Kalau nilai dari client dipakai, seorang kasir bisa menulis ke toko lain.
    void storeId;
    await rpcVoid('save_settings', { p_token: requireToken(), p_data: settings });
  }

  async listCategories(storeId: ID): Promise<Category[]> {
    const rows = await call(async () => {
      const { data, error } = await getClient()
        .from('categories')
        .select('id, store_id, name, icon, sort_order, is_active')
        .eq('store_id', storeId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    });
    return rows.map(toCategory);
  }

  async saveCategory(input: CategoryInput): Promise<Category> {
    const data = await rpc<CategoryRow>('save_category', {
      p_token: requireToken(),
      p_input: input,
    });
    return toCategory(data);
  }

  async deleteCategory(id: ID): Promise<void> {
    await rpcVoid('delete_category', { p_token: requireToken(), p_id: id });
  }

  async listMenus(storeId: ID): Promise<Menu[]> {
    const rows = await call(async () => {
      const { data, error } = await getClient()
        .from('menus')
        // Satu literal utuh: kalau stringnya disambung, inferensi tipe
        // supabase-js tidak bisa membaca daftar kolomnya dan hasilnya jadi
        // tipe galat, bukan tipe baris.
        .select('id, store_id, category_id, name, price, cost_price, description, image_url, is_available, stock, sort_order')
        .eq('store_id', storeId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MenuRow[];
    });
    return rows.map(toMenu);
  }

  async saveMenu(input: MenuInput): Promise<Menu> {
    const data = await rpc<MenuRow>('save_menu', {
      p_token: requireToken(),
      p_input: input,
    });
    return toMenu(data);
  }

  async deleteMenu(id: ID): Promise<void> {
    await rpcVoid('delete_menu', { p_token: requireToken(), p_id: id });
  }

  async setMenuAvailability(id: ID, isAvailable: boolean): Promise<void> {
    await rpcVoid('set_menu_availability', {
      p_token: requireToken(),
      p_id: id,
      p_is_available: isAvailable,
    });
  }

  /* --- Meja --------------------------------------------------------------- */

  /**
   * Daftar meja lewat fungsi, bukan pembacaan langsung, karena tabelnya
   * memuat token QR — dan daftar seluruh token tidak boleh bisa dibaca siapa
   * pun yang memegang kunci anon.
   */
  async listTables(storeId: ID): Promise<DiningTable[]> {
    void storeId;
    return rpc<DiningTable[]>('list_tables', { p_token: requireToken() });
  }

  async saveTable(input: TableInput): Promise<DiningTable> {
    return rpc<DiningTable>('save_table', { p_token: requireToken(), p_input: input });
  }

  async deleteTable(id: ID): Promise<void> {
    await rpcVoid('delete_table', { p_token: requireToken(), p_id: id });
  }

  async getTableByToken(token: string): Promise<DiningTable | null> {
    const data = await rpc<TableRow | null>('get_table_by_token', { p_token: token });
    return data ? toTable(data) : null;
  }

  /* --- Stok --------------------------------------------------------------- */

  async listStockMovements(storeId: ID, menuId?: ID): Promise<StockMovement[]> {
    void storeId;
    return rpc<StockMovement[]>('list_stock_movements', {
      p_token: requireToken(),
      p_menu_id: menuId ?? null,
    });
  }

  /**
   * Saldo tidak boleh jadi negatif, dan yang menolaknya adalah fungsi
   * Postgres — bukan layar ini. Kalau pemeriksaannya ada di sini, jalur lain
   * (mis. antrean luring yang dikirim ulang) bisa menembusnya.
   */
  async recordStockMovement(input: StockMovementInput): Promise<StockMovement> {
    return rpc<StockMovement>('record_stock_movement', {
      p_token: requireToken(),
      p_input: input,
    });
  }

  /* --- Order -------------------------------------------------------------- */

  /**
   * Client hanya mengirim NIAT: menu apa, berapa banyak, catatan apa.
   * Harga, total, pajak, diskon, kode order, nomor antrian, dan kode unik
   * ditentukan server dari katalog dan pengaturan toko.
   *
   * `clientKey` (opsional) membuat pemanggilan ini idempoten: kalau koneksi
   * putus setelah order tersimpan tetapi sebelum jawabannya sampai, kiriman
   * ulang mengembalikan order yang sama, bukan membuat yang kedua.
   */
  async createOrder(input: CreateOrderInput): Promise<Order> {
    return rpc<Order>('create_order', { p_token: requireToken(), p_input: input });
  }

  async listOrders(storeId: ID, filter: OrderFilter = {}): Promise<Order[]> {
    void storeId;
    return rpc<Order[]>('list_orders', {
      p_token: requireToken(),
      p_filter: filter,
    });
  }

  async getOrder(id: ID): Promise<Order | null> {
    return rpc<Order | null>('get_order', { p_token: requireToken(), p_id: id });
  }

  /** Tanpa sesi: pelanggan memeriksa status pesanannya sendiri lewat kode. */
  async getOrderByCode(storeId: ID, code: string): Promise<Order | null> {
    return rpc<Order | null>('get_order_by_code', { p_store: storeId, p_code: code });
  }

  async updateOrderStatus(id: ID, status: OrderStatus): Promise<void> {
    await rpcVoid('update_order_status', {
      p_token: requireToken(),
      p_id: id,
      p_status: status,
    });
  }

  async cancelOrder(id: ID, reason: string): Promise<void> {
    await rpcVoid('cancel_order', {
      p_token: requireToken(),
      p_id: id,
      p_reason: reason,
    });
  }

  async recordPayment(id: ID, payment: Payment): Promise<void> {
    await rpcVoid('record_payment', {
      p_token: requireToken(),
      p_id: id,
      p_payment: payment,
    });
  }

  async listQueueBoard(storeId: ID): Promise<QueueBoardOrder[]> {
    // Server hanya mengirim kolom yang ditampilkan papan antrian; bentuknya
    // dijelaskan oleh `QueueBoardOrder`, bukan `Order`.
    return rpc<QueueBoardOrder[]>('list_queue_board', { p_store: storeId });
  }

  async callQueue(id: ID): Promise<void> {
    await rpcVoid('call_queue', { p_token: requireToken(), p_id: id });
  }

  async getDisplayOrder(storeId: ID): Promise<Order | null> {
    return rpc<Order | null>('get_display_order', { p_store: storeId });
  }

  async setDisplayOrder(storeId: ID, orderId: ID | null): Promise<void> {
    void storeId;
    await rpcVoid('set_display_order', {
      p_token: requireToken(),
      p_order_id: orderId,
    });
  }

  /* --- Sesi --------------------------------------------------------------- */

  /**
   * Verifikasi terjadi di server. Yang dikembalikan adalah token sesi; sandi
   * dan PIN tidak pernah disimpan di peramban, dan tidak ada satu pun
   * kredensial di dalam bundel JavaScript.
   */
  async signIn(storeId: ID, username: string, password: string, pin: string): Promise<Session> {
    const hasil = await rpc<Session & { token: string }>('sign_in', {
      p_store: storeId,
      p_username: username,
      p_password: password,
      p_pin: pin,
    });

    setToken(hasil.token);
    const { token: _token, ...sesi } = hasil;
    void _token;
    return sesi;
  }

  async signOut(): Promise<void> {
    const token = requireToken();
    setToken(null);
    try {
      await rpcVoid('sign_out', { p_token: token });
    } catch (err) {
      // Token lokal sudah dibuang, jadi dari sudut pandang perangkat ini
      // pengguna memang sudah keluar. Kegagalan menghapus baris sesi di server
      // tidak boleh membuat tombol keluar tampak gagal — sesinya akan
      // kedaluwarsa sendiri.
      console.warn('[supabase] gagal menghapus sesi di server', toRepositoryError(err).message);
    }
  }

  async currentSession(): Promise<Session | null> {
    const token = getToken();
    if (!token) return null;

    try {
      return await rpc<Session | null>('current_session', { p_token: token });
    } catch (err) {
      // Sesi kedaluwarsa atau sudah dihapus di server: bersihkan lokalnya,
      // lalu anggap memang belum masuk. Ini bukan galat bagi pengguna.
      const e = toRepositoryError(err);
      if (e.code === 'unauthorized') {
        setToken(null);
        return null;
      }
      throw e;
    }
  }
}
