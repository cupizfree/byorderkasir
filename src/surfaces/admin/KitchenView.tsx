/**
 * Layar dapur (kitchen display).
 *
 * Tiga kolom sesuai tahap: baru masuk, sedang dikerjakan, siap diambil.
 * Dirancang untuk dilihat sambil berdiri, sering dengan tangan basah atau
 * sibuk — jadi:
 *  - nomor antrian besar, bisa dibaca dari beberapa langkah
 *  - umur pesanan diberi warna; yang tertinggal jadi merah dengan sendirinya
 *  - satu tombol besar per kartu, tinggi seragam supaya mudah ditekan tanpa
 *    melihat
 *  - tiap kolom punya warna sendiri, jadi staf tahu posisinya tanpa membaca
 *
 * Aplikasi aslinya mencetak tiket dapur ke printer thermal. Itu tetap
 * didukung (tombol cetak), tapi layar ini menggantikannya sebagai acuan utama
 * — kertas bisa hilang, layar tidak.
 */

import { useEffect, useState } from 'preact/hooks';

import { formatTime } from '../../domain/time.ts';
import type { Order } from '../../domain/types.ts';
import { Button, type ButtonVariant } from '../../ui/components.tsx';
import { Icon, type IconName } from '../../ui/icons.tsx';

/* ==========================================================================
   Ambang keterlambatan
   ========================================================================= */

/** Menit sebelum sebuah pesanan dianggap perlu diperhatikan. */
const MENIT_PERINGATAN = 10;
const MENIT_TERLAMBAT = 20;

type Tingkat = 'normal' | 'peringatan' | 'terlambat';

function tingkat(order: Order, sekarang: number): Tingkat {
  const menit = (sekarang - Date.parse(order.createdAt)) / 60_000;
  if (menit >= MENIT_TERLAMBAT) return 'terlambat';
  if (menit >= MENIT_PERINGATAN) return 'peringatan';
  return 'normal';
}

/** Warna kartu: tepi kiri tebal + latar tipis, makin panas makin merah. */
const KARTU: Record<Tingkat, string> = {
  normal: 'border-ink-200 bg-white',
  peringatan: 'border-pending/45 bg-pending-bg',
  terlambat: 'border-cancelled/55 bg-cancelled-bg',
};

/** Lencana umur pesanan. */
const LENCANA: Record<Tingkat, string> = {
  normal: 'bg-ink-100 text-ink-600',
  peringatan: 'bg-pending text-white',
  terlambat: 'bg-cancelled text-white',
};

/** Warna aksen per kolom. */
const AKSEN_KOLOM = {
  baru: {
    strip: 'bg-pending',
    judul: 'text-pending',
    lencana: 'bg-pending-bg text-pending ring-1 ring-pending/25',
    tombol: 'stage-baru',
  },
  dikerjakan: {
    strip: 'bg-processing',
    judul: 'text-processing',
    lencana: 'bg-processing-bg text-processing ring-1 ring-processing/25',
    tombol: 'stage-masak',
  },
  siap: {
    strip: 'bg-done',
    judul: 'text-done',
    lencana: 'bg-done-bg text-done ring-1 ring-done/25',
    tombol: 'stage-siap',
  },
} as const satisfies Record<string, { strip: string; judul: string; lencana: string; tombol: ButtonVariant }>;

function menitKe(ms: number): string {
  const menit = Math.floor(ms / 60_000);
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  return `${jam} jam ${menit % 60}`;
}

/* ==========================================================================
   Kartu pesanan
   ========================================================================= */

interface KartuProps {
  order: Order;
  sekarang: number;
  sibuk: boolean;
  aksi: { label: string; ke: Order['status']; icon: IconName };
  /** Warna tombol mengikuti kolomnya, bukan selalu oranye. */
  variant: ButtonVariant;
  onAdvance: () => void;
  onPrint: () => void;
}

function KartuPesanan({ order, sekarang, sibuk, aksi, variant, onAdvance, onPrint }: KartuProps) {
  const tingkatKini = tingkat(order, sekarang);
  const totalItem = order.items.reduce((n, it) => n + it.qty, 0);

  return (
    <article
      class={[
        // `min-h` disamakan supaya baris tombol di semua kartu duduk di
        // ketinggian yang sama. Sebelumnya kartu 1 item jauh lebih pendek dari
        // kartu 3 item, jadi tombol "Mulai masak" berpindah-pindah posisi antar
        // kartu — di layar yang dipakai dengan gerakan cepat dan hafalan
        // posisi, tombol yang melompat menaikkan salah tekan.
        'flex min-h-64 flex-col overflow-hidden rounded-xl border-2 border-l-[6px] shadow-card',
        KARTU[tingkatKini],
      ].join(' ')}
    >
      {/* Kepala: nomor + umur + asal */}
      <header class="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div class="min-w-0">
          <p class="num text-4xl leading-none font-black text-ink-900">{order.queueNumber ?? '—'}</p>
          <p class="mt-1.5 truncate text-xs font-semibold text-ink-600">
            {order.code} · {formatTime(order.createdAt)}
          </p>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-1.5">
          <span class={['num rounded-lg px-2.5 py-1 text-sm font-bold', LENCANA[tingkatKini]].join(' ')}>
            {menitKe(sekarang - Date.parse(order.createdAt))}
          </span>
          {/* "Meja 4" adalah info paling penting untuk pengantaran, tapi
              sebelumnya ditulis abu-abu di atas abu-abu muda — paling sulit
              dibaca justru di layar yang dilihat sambil lalu. Sekarang hitam
              penuh supaya tidak mungkin terlewat. */}
          <span class="rounded-md bg-ink-900 px-2 py-0.5 text-xs font-bold text-white">
            {order.tableNumber === null ? 'Kasir' : `Meja ${order.tableNumber}`}
          </span>
        </div>
      </header>

      {/* Item */}
      <ul class="flex-1 space-y-1.5 px-4 pb-2">
        {order.items.map((it, i) => (
          <li key={`${it.menuId}-${i}`} class="flex gap-2.5">
            <span class="num w-8 shrink-0 text-right text-base font-black text-ink-800">
              {it.qty}×
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-base leading-snug font-bold text-ink-900">{it.name}</span>
              {it.notes ? (
                <span class="block text-sm font-semibold text-cancelled italic">{it.notes}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {/* Catatan & lencana panggilan */}
      {order.customerNotes ? (
        <p class="mx-4 mb-2 rounded-md bg-ink-900/[0.06] px-2.5 py-1.5 text-sm font-semibold text-ink-800 italic">
          “{order.customerNotes}”
        </p>
      ) : null}

      {order.callCount > 1 ? (
        <p class="mx-4 mb-2">
          {/* Merah, bukan hitam. Badge lokasi ("Meja 5", "Kasir") juga hitam
              penuh, jadi kalau pil ini memakai gaya yang sama, peringatan
              "sudah dipanggil 2×" akan terbaca sebagai label meja biasa saat
              dipindai cepat. Merah di sini berarti alarm, dan status merah
              "terlambat" pada kartu justru memperkuat maksud yang sama. */}
          <span class="inline-flex items-center gap-1.5 rounded-md bg-cancelled px-2.5 py-1 text-xs font-bold text-white">
            <Icon name="bell" size={13} />
            Sudah dipanggil {order.callCount}×
          </span>
        </p>
      ) : null}

      {/* Aksi */}
      <footer class="flex items-stretch gap-2 border-t border-ink-900/10 px-4 py-3">
        <Button
          variant={variant}
          size="lg"
          icon={aksi.icon}
          loading={sibuk}
          onClick={onAdvance}
          class="flex-1"
        >
          {aksi.label}
        </Button>
        <Button
          variant="outline"
          size="lg"
          icon="printer"
          onClick={onPrint}
          aria-label="Cetak tiket"
          title="Cetak tiket"
        />
      </footer>

      <span class="sr-only">{totalItem} item</span>
    </article>
  );
}

/* ==========================================================================
   Kolom
   ========================================================================= */

interface KolomProps {
  judul: string;
  ikon: IconName;
  aksen: (typeof AKSEN_KOLOM)[keyof typeof AKSEN_KOLOM];
  daftar: readonly Order[];
  sekarang: number;
  sibuk: string | null;
  aksi: (o: Order) => { label: string; ke: Order['status']; icon: IconName };
  onAdvance: (o: Order) => void;
  onPrint: (o: Order) => void;
  pesanKosong: string;
}

function Kolom({
  judul,
  ikon,
  aksen,
  daftar,
  sekarang,
  sibuk,
  aksi,
  onAdvance,
  onPrint,
  pesanKosong,
}: KolomProps) {
  const totalItem = daftar.reduce((n, o) => n + o.items.reduce((m, it) => m + it.qty, 0), 0);

  return (
    <section class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
      <header class="flex shrink-0 items-center gap-3 border-b border-ink-200 px-4 py-3">
        <span class={['h-8 w-1.5 shrink-0 rounded-full', aksen.strip].join(' ')} />
        <Icon name={ikon} size={20} class={aksen.judul} />
        <h2 class="min-w-0 flex-1 truncate text-base font-extrabold tracking-tight text-ink-900">
          {judul}
        </h2>
        <span class="num shrink-0 text-sm font-semibold text-ink-500">{totalItem} item</span>
        <span class={['num shrink-0 rounded-full px-3 py-0.5 text-base font-black', aksen.lencana].join(' ')}>
          {daftar.length}
        </span>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {daftar.length === 0 ? (
          <div class="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-200 py-12 text-ink-400">
            <Icon name="inbox" size={32} strokeWidth={1.4} />
            <p class="text-sm font-semibold">{pesanKosong}</p>
          </div>
        ) : (
          daftar.map((o) => (
            <KartuPesanan
              key={o.id}
              order={o}
              sekarang={sekarang}
              sibuk={sibuk === o.id}
              aksi={aksi(o)}
              variant={aksen.tombol}
              onAdvance={() => onAdvance(o)}
              onPrint={() => onPrint(o)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ==========================================================================
   Tampilan
   ========================================================================= */

export interface KitchenViewProps {
  orders: readonly Order[];
  onAdvance: (id: string, status: Order['status']) => Promise<void>;
  onPrint: (order: Order) => void;
}

export function KitchenView({ orders, onAdvance, onPrint }: KitchenViewProps) {
  const [sekarang, setSekarang] = useState(() => Date.now());
  const [sibuk, setSibuk] = useState<string | null>(null);

  // Jam berdetak tiap 10 detik: cukup untuk menghitung umur pesanan tanpa
  // membebani peramban tablet yang menyala sepanjang hari.
  useEffect(() => {
    const id = setInterval(() => setSekarang(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Yang paling lama menunggu naik ke atas — itu yang paling mendesak.
  const urut = (a: Order, b: Order) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

  const baru = orders.filter((o) => o.status === 'pending').sort(urut);
  const dikerjakan = orders.filter((o) => o.status === 'processing').sort(urut);
  const siap = orders.filter((o) => o.status === 'ready').sort(urut);

  async function majukan(order: Order, ke: Order['status']) {
    setSibuk(order.id);
    try {
      await onAdvance(order.id, ke);
    } finally {
      setSibuk(null);
    }
  }

  return (
    <div class="grid h-[calc(100dvh-56px)] grid-cols-3 gap-4 p-4">
      <Kolom
        judul="Baru Masuk"
        ikon="inbox"
        aksen={AKSEN_KOLOM.baru}
        daftar={baru}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={() => ({ label: 'Mulai masak', ke: 'processing', icon: 'flame' })}
        onAdvance={(o) => void majukan(o, 'processing')}
        onPrint={onPrint}
        pesanKosong="Belum ada pesanan baru"
      />

      <Kolom
        judul="Sedang Dikerjakan"
        ikon="flame"
        aksen={AKSEN_KOLOM.dikerjakan}
        daftar={dikerjakan}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={() => ({ label: 'Siap diambil', ke: 'ready', icon: 'bell' })}
        onAdvance={(o) => void majukan(o, 'ready')}
        onPrint={onPrint}
        pesanKosong="Tidak ada yang dimasak"
      />

      <Kolom
        judul="Siap Diambil"
        ikon="bell"
        aksen={AKSEN_KOLOM.siap}
        daftar={siap}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={() => ({ label: 'Sudah diserahkan', ke: 'completed', icon: 'check' })}
        onAdvance={(o) => void majukan(o, 'completed')}
        onPrint={onPrint}
        pesanKosong="Belum ada yang siap"
      />
    </div>
  );
}
