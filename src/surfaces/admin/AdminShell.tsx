/**
 * Shell layar kasir & admin.
 *
 * Tata letak: bilah atas tipis + area isi penuh lebar. Sengaja bukan sidebar
 * karena POS butuh lebar maksimal — grid menu di kiri dan keranjang di kanan
 * tidak boleh terpotong.
 *
 * Di bawah ini ada gerbang login. Tanpa sesi, yang tampil hanya formulir masuk.
 */

import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { ConnectionPill, LoadingBlock } from '../../ui/components.tsx';
import { Icon, type IconName } from '../../ui/icons.tsx';
import {
  canView,
  connectRealtime,
  loadCatalog,
  loadOrders,
  loadSettings,
  loadStock,
  online,
  pendingWrites,
  realtimeStatus,
  realtimeTransport,
  recordStockMovement,
  resolveView,
  restoreSession,
  session,
  settings,
  signOut,
  stockMovements,
  storeId,
  watchConnectivity,
} from '../../state/store.ts';
import { ROLE_LABEL, type AdminView } from '../../domain/permissions.ts';
import { StockView } from './StockView.tsx';
import { AnalyticsView } from './AnalyticsView.tsx';
import { KitchenView } from './KitchenView.tsx';
import { LoginView } from './LoginView.tsx';
import { MenuView } from './MenuView.tsx';
import { OrdersView } from './OrdersView.tsx';
import { PosView } from './PosView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { TablesView } from './TablesView.tsx';
import {
  simpanPengaturanKeCache,
  useAdminActions,
  type Periode,
} from './useAdminActions.ts';
import { orderStats, orders, displayOrder, categories, menus, tables, loading } from '../../state/store.ts';

/* ==========================================================================
   Navigasi
   ========================================================================= */

type Tab = AdminView;

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'kasir', label: 'Kasir', icon: 'cart' },
  { id: 'dapur', label: 'Dapur', icon: 'kitchen' },
  { id: 'order', label: 'Order', icon: 'receipt' },
  { id: 'menu', label: 'Menu', icon: 'coffee' },
  { id: 'meja', label: 'Meja', icon: 'table' },
  { id: 'stok', label: 'Stok', icon: 'box' },
  { id: 'analitik', label: 'Analitik', icon: 'chart' },
  { id: 'pengaturan', label: 'Pengaturan', icon: 'settings' },
];

function tabDariUrl(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.id === t) ? (t as Tab) : 'kasir';
}

/* ==========================================================================
   Shell
   ========================================================================= */

export function AdminShell() {
  const [tab, setTab] = useState<Tab>(tabDariUrl);
  const [siap, setSiap] = useState(false);
  const [periode, setPeriode] = useState<Periode>('hari');

  const aksi = useAdminActions();

  /* --- Muat awal -------------------------------------------------------- */

  useEffect(() => {
    void (async () => {
      await restoreSession();
      await Promise.all([loadSettings(), loadCatalog(), loadStock()]);
      simpanPengaturanKeCache(settings.value);
      setSiap(true);
    })();
    // Antrean tulis luring ikut dikirim begitu jaringan kembali.
    return watchConnectivity();
  }, []);

  /* --- Peran: pindahkan ke layar yang boleh dibuka ---------------------- */

  useEffect(() => {
    if (!session.value) return;
    const boleh = resolveView(tab);
    if (boleh !== tab) setTab(boleh);
  }, [tab, session.value?.userId]);

  /* --- Realtime --------------------------------------------------------- */

  useEffect(() => {
    if (!session.value) return;
    return connectRealtime({
      onOrders: loadOrders,
      onMenus: loadCatalog,
      onStock: loadStock,
      onSettings: () => {
        void loadSettings();
        simpanPengaturanKeCache(settings.value);
      },
    });
  }, [session.value?.userId]);

  /* --- Analitik: muat ulang saat periode berubah ------------------------ */

  useEffect(() => {
    if (tab !== 'analitik' || !session.value) return;
    void loadOrders(aksi.filterPeriode(periode));
  }, [tab, periode, session.value?.userId]);

  /* --- Tab di URL ------------------------------------------------------- */

  function pindahTab(t: Tab) {
    // Layar yang tidak diizinkan tidak ditolak dengan pesan galat, melainkan
    // dialihkan ke layar pertama yang memang boleh dibuka. Menampilkan
    // "akses ditolak" hanya memberi tahu apa yang tidak bisa dilakukan,
    // tanpa memberi jalan keluar.
    const boleh = resolveView(t);
    setTab(boleh);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', boleh);
    window.history.replaceState(null, '', url);
    // Kasir & dapur butuh daftar order penuh; analitik punya filternya sendiri.
    if (boleh !== 'analitik') void loadOrders(aksi.filterHariIni());
  }

  /* --- Render ----------------------------------------------------------- */

  if (!siap) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-50">
        <LoadingBlock label="Menyiapkan…" />
      </div>
    );
  }

  if (!session.value) {
    return <LoginView onMasuk={() => void pindahTab('kasir')} />;
  }

  const s = settings.value;

  return (
    <div class="min-h-dvh bg-ink-50">
      {/* ================================================================ */}
      <header class="surface-dark sticky top-0 z-30 text-white shadow-lift">
        <div class="flex items-center gap-4 px-4 py-2.5">
          {/* Identitas toko --------------------------------------------- */}
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white shadow-[0_2px_10px_rgb(234_88_12/0.4)]">
              <Icon name="store" size={18} />
            </span>
            <span class="hidden min-w-0 sm:block">
              <span class="display block truncate text-base leading-tight">
                {s?.name ?? 'byorderkasir'}
              </span>
              <span class="block truncate text-[11px] leading-tight text-white/50">
                {storeId.value}
              </span>
            </span>
          </div>

          {/* Tab --------------------------------------------------------- */}
          <nav class="scrollbar-none -mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
            {TABS.filter((t) => canView(t.id)).map((t) => {
              const aktif = tab === t.id;
              const lencana =
                t.id === 'dapur'
                  ? orders.value.filter((o) => o.status === 'pending' || o.status === 'processing').length
                  : t.id === 'order'
                    ? orderStats.value.unpaid
                    : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pindahTab(t.id)}
                  class={[
                    'relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
                    aktif
                      ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]'
                      : 'text-white/65 hover:bg-white/8 hover:text-white',
                  ].join(' ')}
                >
                  <Icon name={t.icon} size={16} />
                  {t.label}
                  {lencana > 0 ? (
                    <span class="num ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                      {lencana}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Kanan -------------------------------------------------------- */}
          <div class="flex shrink-0 items-center gap-2">
            <IndikatorTulis />
            <ConnectionPill status={realtimeStatus.value} dark />
            <span class="hidden text-right lg:block">
              <span class="block text-xs leading-tight font-semibold">
                {session.value.displayName}
              </span>
              <span class="block text-[11px] leading-tight text-white/50">
                {ROLE_LABEL[session.value.role]}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              title="Keluar"
              aria-label="Keluar"
              class="flex h-9 w-9 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* ================================================================ */}
      <main>
        {tab === 'kasir' ? (
          <PosView
            settings={s!}
            categories={categories.value}
            menus={menus.value}
            cashierName={session.value.displayName}
            onCreate={aksi.buatOrder}
            onPay={aksi.tandaiLunas}
          />
        ) : null}

        {tab === 'dapur' ? (
          <KitchenView
            orders={orders.value}
            onAdvance={aksi.ubahStatus}
            onPrint={aksi.cetakTiketDapur}
          />
        ) : null}

        {tab === 'order' ? (
          <OrdersView
            orders={orders.value}
            onPay={aksi.tandaiLunas}
            onCall={aksi.panggilAntrian}
            onDisplay={aksi.kirimKeLayar}
            onCancel={aksi.batalkanOrder}
            onPrint={aksi.cetakStruk}
            displayOrderId={displayOrder.value?.id ?? null}
          />
        ) : null}

        {tab === 'menu' ? (
          <MenuView
            storeId={storeId.value}
            categories={categories.value}
            menus={menus.value}
            onSimpan={aksi.simpanMenu}
            onHapus={aksi.hapusMenu}
            onKetersediaan={aksi.setKetersediaan}
            onSimpanKategori={aksi.simpanKategori}
            onHapusKategori={aksi.hapusKategori}
          />
        ) : null}

        {tab === 'meja' ? (
          <TablesView
            storeId={storeId.value}
            tables={tables.value}
            storeName={s?.name ?? ''}
            onSimpan={aksi.simpanMeja}
            onHapus={aksi.hapusMeja}
          />
        ) : null}

        {tab === 'stok' ? (
          <StockView
            menus={menus.value}
            movements={stockMovements.value}
            settings={s!}
            actor={session.value.displayName}
            bisaUbah={aksi.boleh('stock:adjust')}
            onRecord={recordStockMovement}
          />
        ) : null}

        {tab === 'analitik' ? (
          <AnalyticsView
            orders={orders.value}
            loading={loading.value}
            periode={periode}
            onPeriode={setPeriode}
            stockMovements={stockMovements.value}
          />
        ) : null}

        {tab === 'pengaturan' ? (
          <SettingsView
            settings={s!}
            onSimpan={aksi.simpanPengaturan}
            onResetDemo={aksi.resetDemo}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ==========================================================================
   Indikator tulisan tertunda
   ========================================================================= */

/**
 * Keadaan tulisan yang belum terkirim.
 *
 * Hanya muncul saat ada yang perlu diketahui. Menampilkan "0 menunggu" terus
 * menerus hanya menambah kebisingan di bilah yang sudah padat — dan kasir
 * berhenti membacanya justru saat angkanya penting.
 */
function IndikatorTulis(): JSX.Element | null {
  const tertunda = pendingWrites.value;

  if (tertunda > 0) {
    return (
      <span
        class="flex items-center gap-1.5 rounded-lg bg-pending/20 px-2.5 py-1.5 text-xs font-semibold text-pending"
        title={
          realtimeTransport.value === 'websocket'
            ? 'Tersimpan di perangkat ini, akan dikirim saat jaringan kembali.'
            : 'Tersimpan di perangkat ini. Belum ada server realtime yang dikonfigurasi.'
        }
      >
        <Icon name="clock" size={15} />
        <span class="num">{tertunda}</span>
        <span class="hidden sm:inline">menunggu</span>
      </span>
    );
  }

  if (!online.value) {
    return (
      <span
        class="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/75"
        title="Perangkat sedang luring. Pekerjaan tetap bisa dilakukan."
      >
        <Icon name="cloud-off" size={15} />
        <span class="hidden sm:inline">Luring</span>
      </span>
    );
  }

  return null;
}
