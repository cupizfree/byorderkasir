/**
 * Halaman depan — pemilih surface.
 *
 * Berguna untuk demo dan pengembangan: satu tempat untuk membuka keempat
 * surface tanpa menghafal URL. Di produksi halaman ini boleh dihapus atau
 * diganti dengan landing page pemasaran.
 */

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import '../../styles/app.css';
import { Button, Card, ConnectionPill } from '../../ui/components.tsx';
import { Icon, type IconName } from '../../ui/icons.tsx';
import {
  connectRealtime,
  loadCatalog,
  loadOrders,
  loadSettings,
  orderStats,
  realtimeStatus,
  settings,
  storeId,
  tables,
} from '../../state/store.ts';
import { currentAdapter, getRepository, MockRepository } from '../../data/index.ts';

interface Surface {
  href: string;
  title: string;
  description: string;
  icon: IconName;
  who: string;
}

const SURFACES: Surface[] = [
  {
    href: '/admin/',
    title: 'Kasir & Admin',
    description:
      'POS kasir, dapur, kelola menu, meja, analitik, dan pengaturan. Satu layar untuk operator.',
    icon: 'chart',
    who: 'Kasir · Pemilik',
  },
  {
    href: '/order/',
    title: 'Pesan dari Meja',
    description:
      'Pelanggan scan QR di meja, pesan dari HP sendiri, tanpa antre dan tanpa pasang aplikasi.',
    icon: 'qr',
    who: 'Pelanggan',
  },
  {
    href: '/display/',
    title: 'Layar Pelanggan',
    description:
      'Tablet kedua di kasir: pelanggan melihat rincian pesanan dan status pembayaran saat itu juga.',
    icon: 'receipt',
    who: 'Pelanggan di kasir',
  },
  {
    href: '/queue/',
    title: 'Layar Antrian TV',
    description:
      'TV di ruang tunggu. Memanggil nomor dengan bel dan suara, menyorot nomor yang dipanggil.',
    icon: 'bell',
    who: 'Ruang tunggu',
  },
];

function App() {
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    void loadSettings();
    void loadCatalog();
    void loadOrders();
    return connectRealtime({
      onSettings: loadSettings,
      onMenus: loadCatalog,
      onOrders: loadOrders,
    });
  }, []);

  const s = settings.value;
  const stats = orderStats.value;

  async function isiDataDemo() {
    const repo = getRepository();
    if (!(repo instanceof MockRepository)) return;
    setSibuk(true);
    try {
      await repo.seedDemoOrders();
      await loadOrders();
    } finally {
      setSibuk(false);
    }
  }

  async function kosongkan() {
    const repo = getRepository();
    if (!(repo instanceof MockRepository)) return;
    repo.resetDemoData();
    await loadOrders();
  }

  return (
    <div class="min-h-dvh bg-ink-50">
      <header class="safe-x border-b border-ink-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 py-5">
          <div class="flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-700 text-white">
              <Icon name="store" size={22} />
            </div>
            <div>
              <h1 class="text-lg font-extrabold tracking-tight text-ink-900">
                {s?.name ?? 'byorderkasir'}
              </h1>
              <p class="text-xs text-ink-500">
                {s?.tagline ?? 'POS & self-order'} · toko <code class="text-ink-700">{storeId.value}</code>
              </p>
            </div>
          </div>
          <ConnectionPill status={realtimeStatus.value} />
        </div>
      </header>

      <main class="safe-x mx-auto max-w-5xl py-8">
        <h2 class="text-sm font-bold tracking-wide text-ink-500 uppercase">Pilih layar</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          {SURFACES.map((surface) => (
            <a key={surface.href} href={surface.href} class="group block focus:outline-none">
              <Card class="h-full p-5 transition group-hover:border-brand-700 group-hover:shadow-md">
                <div class="flex items-start gap-4">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-800">
                    <Icon name={surface.icon} size={22} />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <h3 class="font-bold text-ink-900">{surface.title}</h3>
                      <Icon
                        name="arrow-right"
                        size={16}
                        class="text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700"
                      />
                    </div>
                    <p class="mt-1 text-sm leading-relaxed text-ink-600">{surface.description}</p>
                    <p class="mt-3 text-xs font-semibold text-ink-400">{surface.who}</p>
                  </div>
                </div>
              </Card>
            </a>
          ))}
        </div>

        <div class="mt-8 rounded-lg border border-ink-200 bg-white p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 class="flex items-center gap-2 text-sm font-bold text-ink-800">
                <Icon name="sparkles" size={16} />
                Data demo
              </h3>
              <p class="mt-1 text-sm text-ink-600">
                {stats.total > 0
                  ? `${stats.total} order · ${stats.active} aktif · ${stats.unpaid} belum dibayar`
                  : 'Belum ada order. Isi data demo untuk mencoba semua layar.'}
              </p>
            </div>
            <div class="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon="sparkles"
                loading={sibuk}
                onClick={() => void isiDataDemo()}
              >
                Isi data demo
              </Button>
              {stats.total > 0 ? (
                <Button variant="outline" size="sm" icon="trash" onClick={() => void kosongkan()}>
                  Kosongkan
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Daftar meja — supaya alur pesan-sendiri bisa dicoba tanpa perlu
            mencetak QR lebih dulu. Tiap tautan membawa token meja, sama
            seperti yang ada di dalam QR fisik. */}
        {tables.value.length > 0 ? (
          <div class="mt-4 rounded-lg border border-ink-200 bg-white p-5">
            <h3 class="flex items-center gap-2 text-sm font-bold text-ink-800">
              <Icon name="table" size={16} />
              Meja — coba alur pesan sendiri
            </h3>
            <p class="mt-1 text-sm text-ink-600">
              Tautan ini sama dengan isi QR yang tertempel di meja. Buka di HP, atau di tab baru
              bersebelahan dengan layar kasir.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              {tables.value.map((t) => (
                <a
                  key={t.id}
                  href={`/order/?t=${encodeURIComponent(t.qrToken)}`}
                  class="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3.5 py-2 text-sm font-bold text-ink-800 transition-colors hover:border-brand-500 hover:bg-brand-50"
                >
                  <Icon name="qr" size={15} />
                  {t.name || `Meja ${t.number}`}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div class="mt-4 rounded-lg border border-ink-200 bg-white p-5">
          <h3 class="flex items-center gap-2 text-sm font-bold text-ink-800">
            <Icon name="info" size={16} />
            Catatan
          </h3>
          <ul class="mt-3 space-y-2 text-sm text-ink-600">
            <li class="flex gap-2">
              <span class="text-ink-400">·</span>
              Adapter data aktif: <code class="font-semibold text-ink-800">{currentAdapter()}</code>
              {currentAdapter() === 'mock' ? ' (data demo, tersimpan di peramban ini)' : ''}
            </li>
            <li class="flex gap-2">
              <span class="text-ink-400">·</span>
              Buka dua layar berdampingan (mis. Kasir dan Layar Pelanggan) untuk melihat sinkronisasi
              realtime bekerja.
            </li>
            <li class="flex gap-2">
              <span class="text-ink-400">·</span>
              Tambahkan <code class="text-ink-800">?store=&lt;id&gt;</code> pada URL untuk memakai toko lain.
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
