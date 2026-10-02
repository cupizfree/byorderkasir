/**
 * Layar dapur (kitchen display).
 *
 * Ada DUA tata letak, dan tema yang menentukan mana yang dipakai:
 *
 *   `papan` (tema Terang & Gelap)
 *     Tiga kolom sesuai tahap: baru masuk, sedang dikerjakan, siap diambil.
 *     Staf memindai kolom, lalu memajukan kartu ke kanan.
 *
 *   `fokus` (tema Fokus)
 *     Satu pesanan paling mendesak jadi pusat perhatian; sisanya jadi antrean
 *     ringkas di sebelahnya, sudah terurut menurut waktu berjalan.
 *
 * Kenapa `fokus` ada: di papan tiga kolom, urutan kerja sebenarnya ada di
 * kepala juru masak, bukan di layar — ia harus memindai tiga kolom dan
 * membandingkan sendiri mana yang paling telat. Di dapur yang ramai itu
 * langkah yang mudah terlewat. Tata letak fokus memindahkan pekerjaan
 * membandingkan itu ke layar: yang paling lama menunggu selalu di kiri, di
 * tempat pertama mata mendarat.
 *
 * Yang dipakai bersama kedua tata letak: ambang keterlambatan, warna tingkat,
 * dan tombol aksinya — supaya keduanya tidak pernah berbeda pendapat soal
 * pesanan mana yang perlu diperhatikan.
 *
 * Aplikasi aslinya mencetak tiket dapur ke printer thermal. Itu tetap
 * didukung (tombol cetak), tapi layar ini menggantikannya sebagai acuan utama
 * — kertas bisa hilang, layar tidak.
 */

import { useEffect, useState } from 'preact/hooks';

import { tataLetakTema } from '../../domain/theme.ts';
import { formatTime } from '../../domain/time.ts';
import type { Order } from '../../domain/types.ts';
import { theme } from '../../state/theme.ts';
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
  normal: 'border-ink-200 bg-surface',
  peringatan: 'border-pending/45 bg-pending-bg',
  terlambat: 'border-cancelled/55 bg-cancelled-bg',
};

/** Lencana umur pesanan. */
const LENCANA: Record<Tingkat, string> = {
  normal: 'bg-ink-100 text-ink-600',
  peringatan: 'bg-pending text-on-pending',
  terlambat: 'bg-cancelled text-on-cancelled',
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

/** Berapa menit sebuah pesanan sudah berjalan. */
function umurMenit(order: Order, sekarang: number): number {
  return Math.max(0, Math.floor((sekarang - Date.parse(order.createdAt)) / 60_000));
}

/**
 * Ringkasan satu layar dapur untuk pil statistik di bilah atas.
 *
 * Diekspor supaya bilah atas dan isi layar memakai ambang yang sama persis.
 * Kalau `MENIT_TERLAMBAT` di sini diubah, angka "TELAT" di atas ikut berubah —
 * tidak mungkin keduanya berbeda cerita.
 */
export function statistikDapur(daftar: readonly Order[], sekarang: number) {
  // `ready` ikut dihitung aktif. Pesanan yang sudah matang tapi belum
  // diserahkan masih ada di tangan dapur — justru itu yang paling perlu
  // diawasi. Kalau hanya pending+processing yang dihitung, angka "Telat"
  // akan selalu 0 di jam sibuk: yang telat biasanya sudah matang dan
  // menunggu diambil, bukan yang masih dimasak.
  const aktif = daftar.filter(
    (o) => o.status === 'pending' || o.status === 'processing' || o.status === 'ready',
  );
  const umur = aktif.map((o) => umurMenit(o, sekarang));
  const jumlah = umur.length;
  return {
    aktif: jumlah,
    telat: umur.filter((m) => m >= MENIT_TERLAMBAT).length,
    rata: jumlah === 0 ? 0 : Math.round(umur.reduce((s, m) => s + m, 0) / jumlah),
  };
}

/* ==========================================================================
   Aksi — satu definisi untuk kedua tata letak
   ========================================================================= */

interface Aksi {
  label: string;
  ke: Order['status'];
  icon: IconName;
  variant: ButtonVariant;
}

/**
 * Langkah berikutnya untuk tiap status pesanan.
 *
 * Di papan tiga kolom, aksinya ditentukan kolomnya. Di tata letak fokus tidak
 * ada kolom — pesanan tampil campur — jadi aksinya harus dibaca dari status
 * pesanannya sendiri. Keduanya memakai tabel ini supaya tidak bisa berbeda.
 */
const AKSI: Partial<Record<Order['status'], Aksi>> = {
  pending: { label: 'Mulai masak', ke: 'processing', icon: 'flame', variant: 'stage-baru' },
  processing: { label: 'Siap diambil', ke: 'ready', icon: 'bell', variant: 'stage-masak' },
  ready: { label: 'Sudah diserahkan', ke: 'completed', icon: 'check', variant: 'stage-siap' },
};

function aksiStatus(status: Order['status']): Aksi {
  return AKSI[status] ?? AKSI.pending!;
}

function aksiUntuk(order: Order): Aksi {
  return aksiStatus(order.status);
}

/** Urut dari yang paling lama menunggu — itu yang paling mendesak. */
function urutMendesak(a: Order, b: Order): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/* ==========================================================================
   Tata letak PAPAN — kartu pesanan
   ========================================================================= */

interface KartuProps {
  order: Order;
  sekarang: number;
  sibuk: boolean;
  aksi: Aksi;
  onAdvance: () => void;
  onPrint: () => void;
}

function KartuPesanan({ order, sekarang, sibuk, aksi, onAdvance, onPrint }: KartuProps) {
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
              dibaca justru di layar yang dilihat sambil lalu. Sekarang lencana
              penuh supaya tidak mungkin terlewat.

              Memakai `chip`, bukan `solid`: di tema gelap `solid` menjadi
              hampir putih, dan pil sekecil ini akan lebih terang daripada
              penghitung waktu di atasnya — hierarki terbalik. */}
          <span class="rounded-md bg-chip px-2 py-0.5 text-xs font-bold text-on-chip">
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
          <span class="inline-flex items-center gap-1.5 rounded-md bg-cancelled px-2.5 py-1 text-xs font-bold text-on-cancelled">
            <Icon name="bell" size={13} />
            Sudah dipanggil {order.callCount}×
          </span>
        </p>
      ) : null}

      {/* Aksi */}
      <footer class="flex items-stretch gap-2 border-t border-ink-900/10 px-4 py-3">
        <Button
          variant={aksi.variant}
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
   Tata letak PAPAN — kolom
   ========================================================================= */

interface KolomProps {
  judul: string;
  ikon: IconName;
  aksen: (typeof AKSEN_KOLOM)[keyof typeof AKSEN_KOLOM];
  daftar: readonly Order[];
  sekarang: number;
  sibuk: string | null;
  aksi: Aksi;
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
    <section class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-card">
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
              aksi={aksi}
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
   Tata letak FOKUS
   ========================================================================= */

interface BarisAntreanProps {
  order: Order;
  sekarang: number;
  sibuk: boolean;
  onAdvance: () => void;
}

/** Satu baris antrean. Ringkas — yang butuh perhatian penuh sudah di kiri. */
function BarisAntrean({ order, sekarang, sibuk, onAdvance }: BarisAntreanProps) {
  const tingkatKini = tingkat(order, sekarang);
  const aksi = aksiUntuk(order);
  const menit = umurMenit(order, sekarang);

  const warnaBaris =
    tingkatKini === 'terlambat'
      ? 'border-l-cancelled'
      : tingkatKini === 'peringatan'
        ? 'border-l-pending'
        : 'border-l-ink-300';
  const warnaMenit =
    tingkatKini === 'terlambat'
      ? 'text-cancelled'
      : tingkatKini === 'peringatan'
        ? 'text-pending'
        : 'text-ink-700';

  return (
    <article
      class={[
        'flex shrink-0 items-center gap-4 rounded-lg border border-ink-200 border-l-[3px] bg-surface px-4 py-3 shadow-card',
        warnaBaris,
      ].join(' ')}
    >
      <div class="w-20 shrink-0">
        <p class="num text-base leading-tight font-black text-ink-900">{order.queueNumber ?? '—'}</p>
        <p class="mt-0.5 truncate text-xs font-semibold text-ink-500">
          {order.tableNumber === null ? 'Kasir' : `Meja ${order.tableNumber}`}
        </p>
      </div>

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-ink-800">
          {order.items.map((it) => `${it.qty}× ${it.name}`).join(' · ')}
        </p>
        <p class="mt-0.5 truncate text-xs font-medium text-ink-500">
          {order.code} · {formatTime(order.createdAt)}
          {order.callCount > 1 ? (
            <span class="ml-2 font-bold text-cancelled">Dipanggil {order.callCount}×</span>
          ) : null}
        </p>
      </div>

      <p class={['num w-16 shrink-0 text-right text-2xl leading-none font-black', warnaMenit].join(' ')}>
        {menit}
        <span class="ml-1 text-xs font-semibold text-ink-400">mnt</span>
      </p>

      {/* Tombol baris dibuat netral, tidak diwarnai status. Warnanya sudah
          dibawa bilah aksen kiri, angka menit, dan teks tahap; kalau tombolnya
          ikut berwarna, empat sinyal berebut perhatian dan tidak ada yang
          menonjol. Hanya "mulai masak" yang diberi isian penuh — itu yang
          dicari mata juru masak begitu ada pesanan baru. */}
      <Button
        variant={order.status === 'pending' ? 'secondary' : 'outline'}
        size="md"
        loading={sibuk}
        onClick={onAdvance}
        class="shrink-0"
      >
        {aksi.label}
      </Button>
    </article>
  );
}

interface FokusProps {
  daftar: readonly Order[];
  sekarang: number;
  sibuk: string | null;
  onAdvance: (o: Order) => void;
  onPrint: (o: Order) => void;
}

function DapurFokus({ daftar, sekarang, sibuk, onAdvance, onPrint }: FokusProps) {
  const urut = [...daftar].sort(urutMendesak);
  const utama = urut[0];
  const antrean = urut.slice(1);

  if (!utama) {
    return (
      <div class="flex h-[calc(100dvh-56px)] flex-col items-center justify-center gap-3 text-ink-400">
        <Icon name="inbox" size={44} strokeWidth={1.3} />
        <p class="text-base font-semibold">Belum ada pesanan masuk</p>
      </div>
    );
  }

  const tingkatUtama = tingkat(utama, sekarang);
  const aksiUtama = aksiUntuk(utama);
  const menitUtama = umurMenit(utama, sekarang);

  // Bingkai kartu utama: gradien hangat oranye→magenta→violet, senada pendar
  // aurora di latarnya. Makin telat, ujung hangatnya makin merah — sinyal
  // keterlambatan tetap terbaca, tapi bingkainya bukan lagi blok warna rata.
  const cincin =
    tingkatUtama === 'terlambat'
      ? 'from-cancelled/85 via-[#be185d]/45 to-[#8b5cf6]/30'
      : tingkatUtama === 'peringatan'
        ? 'from-pending/80 via-[#be185d]/40 to-[#8b5cf6]/28'
        : 'from-[#c2410c]/80 via-[#be185d]/45 to-[#8b5cf6]/30';

  // Angka umur memakai huruf bergradien, bukan satu warna rata. Ujung
  // hangatnya bergeser mengikuti keterlambatan supaya sinyalnya tidak hilang.
  const angkaGradien =
    tingkatUtama === 'terlambat'
      ? 'from-white via-[#ffc9c0] to-[#ff6b4a]'
      : tingkatUtama === 'peringatan'
        ? 'from-white via-[#ffe6b0] to-[#ffb020]'
        : 'from-white via-[#ffd2c2] to-[#ff8a6b]';

  return (
    <div class="flex h-[calc(100dvh-56px)] gap-4 p-4">
      {/* --- Kiri: yang harus dikerjakan sekarang --- */}
      <section class="flex w-[26rem] shrink-0 flex-col">
        <p class="mb-3 flex items-center gap-2 px-1 text-xs font-bold tracking-widest text-ink-500 uppercase">
          <span class="h-1.5 w-1.5 rounded-full bg-cancelled" />
          Sekarang — paling mendesak
        </p>

        <div
          class={[
            'flex min-h-0 flex-1 rounded-2xl bg-gradient-to-br p-[2px]',
            'shadow-[0_20px_60px_-20px_rgb(190_24_93/0.55)]',
            cincin,
          ].join(' ')}
        >
          <article class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-[14px] bg-surface p-5">
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="num text-lg leading-none font-black text-ink-900">
                  {utama.queueNumber ?? '—'}
                </p>
                {/* `bg-chip`, bukan `bg-ink-100`: di tema Fokus keduanya
                    bernilai sama dengan `--color-surface`, jadi lencana ini
                    tidak punya latar sama sekali dan menghilang. */}
                <p class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-chip px-2.5 py-1 text-xs font-bold text-on-chip">
                  <Icon name="table" size={12} />
                  {utama.tableNumber === null ? 'Kasir' : `Meja ${utama.tableNumber}`}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs font-semibold text-ink-500">Masuk</p>
                <p class="num text-sm font-bold text-ink-800">{formatTime(utama.createdAt)}</p>
              </div>
            </header>

            {/* Angka umur — elemen terkuat di seluruh layar. */}
            <p class="num flex items-baseline gap-2 leading-none font-black">
              <span
                class={[
                  'bg-gradient-to-br bg-clip-text text-[5.5rem] tracking-tighter text-transparent',
                  angkaGradien,
                ].join(' ')}
              >
                {menitUtama}
              </span>
              <span class="text-lg font-semibold text-ink-400">menit</span>
            </p>

            <ul class="flex min-h-0 flex-1 flex-col gap-2 border-t border-ink-200 pt-4">
              {utama.items.map((it, i) => (
                <li key={`${it.menuId}-${i}`} class="flex gap-3">
                  <span class="num w-8 shrink-0 text-right text-base font-black text-ink-600">
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

            {utama.callCount > 1 ? (
              <p class="inline-flex items-center gap-1.5 self-start rounded-full bg-cancelled-bg px-3 py-1.5 text-xs font-bold text-cancelled ring-1 ring-cancelled/30">
                <Icon name="bell" size={13} />
                Sudah dipanggil {utama.callCount}×
              </p>
            ) : null}

            <footer class="flex items-stretch gap-2">
              <Button
                variant="aurora"
                size="lg"
                icon={aksiUtama.icon}
                loading={sibuk === utama.id}
                onClick={() => onAdvance(utama)}
                class="flex-1"
              >
                {aksiUtama.label}
              </Button>
              <Button
                variant="outline"
                size="lg"
                icon="printer"
                onClick={() => onPrint(utama)}
                aria-label="Cetak tiket"
                title="Cetak tiket"
              />
            </footer>
          </article>
        </div>
      </section>

      {/* --- Kanan: antrean --- */}
      <section class="flex min-w-0 flex-1 flex-col">
        <p class="mb-3 flex items-center gap-2 px-1 text-xs font-bold tracking-widest text-ink-500 uppercase">
          Antrean — menurut waktu berjalan
          <span class="num rounded-full bg-ink-100 px-2 py-0.5 text-xs font-black text-ink-600">
            {antrean.length}
          </span>
        </p>

        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {antrean.length === 0 ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 text-ink-400">
              <Icon name="check" size={30} strokeWidth={1.4} />
              <p class="text-sm font-semibold">Tidak ada antrean lain</p>
            </div>
          ) : (
            antrean.map((o) => (
              <BarisAntrean
                key={o.id}
                order={o}
                sekarang={sekarang}
                sibuk={sibuk === o.id}
                onAdvance={() => onAdvance(o)}
              />
            ))
          )}
        </div>
      </section>
    </div>
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

  async function majukan(order: Order, ke: Order['status']) {
    setSibuk(order.id);
    try {
      await onAdvance(order.id, ke);
    } finally {
      setSibuk(null);
    }
  }

  // `theme.value` dibaca di sini, jadi mengganti tema langsung mengganti tata
  // letak tanpa perlu memuat ulang halaman.
  if (tataLetakTema(theme.value) === 'fokus') {
    return (
      <DapurFokus
        daftar={orders}
        sekarang={sekarang}
        sibuk={sibuk}
        onAdvance={(o) => void majukan(o, aksiUntuk(o).ke)}
        onPrint={onPrint}
      />
    );
  }

  return (
    <div class="grid h-[calc(100dvh-56px)] grid-cols-3 gap-4 p-4">
      <Kolom
        judul="Baru Masuk"
        ikon="inbox"
        aksen={AKSEN_KOLOM.baru}
        daftar={orders.filter((o) => o.status === 'pending').sort(urutMendesak)}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={aksiStatus('pending')}
        onAdvance={(o) => void majukan(o, 'processing')}
        onPrint={onPrint}
        pesanKosong="Belum ada pesanan baru"
      />

      <Kolom
        judul="Sedang Dikerjakan"
        ikon="flame"
        aksen={AKSEN_KOLOM.dikerjakan}
        daftar={orders.filter((o) => o.status === 'processing').sort(urutMendesak)}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={aksiStatus('processing')}
        onAdvance={(o) => void majukan(o, 'ready')}
        onPrint={onPrint}
        pesanKosong="Tidak ada yang dimasak"
      />

      <Kolom
        judul="Siap Diambil"
        ikon="bell"
        aksen={AKSEN_KOLOM.siap}
        daftar={orders.filter((o) => o.status === 'ready').sort(urutMendesak)}
        sekarang={sekarang}
        sibuk={sibuk}
        aksi={aksiStatus('ready')}
        onAdvance={(o) => void majukan(o, 'completed')}
        onPrint={onPrint}
        pesanKosong="Belum ada yang siap"
      />
    </div>
  );
}
