/**
 * Layar Antrian TV.
 *
 * Dilihat dari jauh (TV di ruang tunggu), sering sambil berdiri dan tidak
 * fokus. Karena itu papan ini menampilkan **keadaan antrian**, bukan hanya
 * nomor terakhir: pelanggan bisa melihat sendiri di tahap mana pesanannya,
 * dan berapa yang sedang menunggu.
 *
 * Tiga kolom, mengikuti alur pesanan:
 *   1. Antrian Masuk   — sudah dibayar/dipesan, belum mulai dimasak
 *   2. Sedang Dimasak  — sedang dikerjakan dapur
 *   3. Siap Diambil    — selesai; nomor yang terakhir dipanggil ditampilkan
 *                        besar di tengah karena itu satu-satunya hal yang
 *                        perlu dilihat pelanggan saat namanya dipanggil
 *
 * Yang berbeda dari aplikasi aslinya: nomor yang dipanggil **tersimpan di
 * data**, bukan hanya disiarkan sesaat. Jadi TV yang baru dinyalakan, atau
 * yang sempat kehilangan jaringan, tetap tahu nomor mana yang terakhir
 * dipanggil. Di aplikasi aslinya TV harus kebetulan sedang menyala saat
 * panggilan terjadi, kalau tidak pengumumannya hilang.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { compareQueueLabels } from '../../domain/queue.ts';
import { formatTime, nowIso } from '../../domain/time.ts';
import type { Order } from '../../domain/types.ts';
import { Icon } from '../../ui/icons.tsx';
import { announceQueue, isAudioUnlocked, isSpeechSupported, playChime, unlockAudio } from './announcer.ts';

/* ==========================================================================
   Jam berjalan
   ========================================================================= */

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ==========================================================================
   Bagian kecil
   ========================================================================= */

/** Jumlah item pada kartu kolom — dibaca sekilas, jadi hanya totalnya. */
function totalItem(o: Order): number {
  return o.items.reduce((n, it) => n + it.qty, 0);
}

function KartuKolom({ order, warna }: { order: Order; warna: string }) {
  return (
    <div class={['flex items-center gap-4 rounded-xl border-2 px-4 py-3.5', warna].join(' ')}>
      {/* Nomor antrian dinaikkan ke text-5xl. Di TV yang dilihat dari 4–5
          meter, ukuran sebelumnya (text-4xl) sudah di ambang batas baca —
          padahal ini satu-satunya alasan layar ini ada. */}
      <span class="num shrink-0 text-5xl leading-none font-black tabular-nums">
        {order.queueNumber ?? '—'}
      </span>
      {/* Dua baris, bukan satu baris terpotong. Sebelumnya nama menu panjang
          dipotong jadi "Pisang Goreng …" dan informasi pesanannya hilang —
          justru di layar yang tugasnya memberi tahu apa yang sedang dibuat.
          Ukuran dinaikkan ke text-lg: di TV yang dilihat dari beberapa meter,
          16px berada di ambang batas baca. */}
      <span class="line-clamp-2 min-w-0 flex-1 text-lg leading-snug font-bold text-white">
        {order.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
      </span>
      <span class="num shrink-0 rounded-lg bg-white/25 px-2.5 py-1 text-base font-bold text-white">
        {totalItem(order)}
      </span>
    </div>
  );
}

function Kolom({
  judul,
  ikon,
  jumlah,
  aksen,
  children,
}: {
  judul: string;
  ikon: 'inbox' | 'flame' | 'bell';
  jumlah: number;
  aksen: string;
  children: ComponentChildren;
}) {
  return (
    <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
        <h2 class="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-white">
          <Icon name={ikon} size={20} class={aksen} />
          {judul}
        </h2>
        <span class={['num rounded-full bg-white/15 px-3.5 py-0.5 text-xl font-black', aksen].join(' ')}>
          {jumlah}
        </span>
      </header>
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">{children}</div>
    </section>
  );
}

/* ==========================================================================
   Papan
   ========================================================================= */

export interface QueueBoardProps {
  orders: readonly Order[];
  storeName: string;
  /** Baris kecil di bawah nama toko, mis. "Kopi & Dapur Kecil". */
  tagline?: string;
  /** Teks berjalan di kaki layar. */
  infoText?: string;
  /** Teks setelah nomor, mis. "silakan diambil". */
  callSuffix?: string;
  status?: 'connecting' | 'live' | 'polling' | 'offline';
}

export function QueueBoard({
  orders,
  storeName,
  tagline,
  infoText,
  callSuffix,
  status = 'live',
}: QueueBoardProps) {
  const now = useClock();
  const [audioOn, setAudioOn] = useState(() => isAudioUnlocked());
  const [fullscreen, setFullscreen] = useState(false);
  const lastAnnouncedRef = useRef<string | null>(null);

  /* --- Turunan ---------------------------------------------------------- */

  const hidup = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled' && o.status !== 'completed'),
    [orders],
  );

  const masuk = useMemo(
    () =>
      hidup
        .filter((o) => o.status === 'pending')
        .sort((a, b) => compareQueueLabels(a.queueNumber, b.queueNumber)),
    [hidup],
  );

  const dimasak = useMemo(
    () =>
      hidup
        .filter((o) => o.status === 'processing')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [hidup],
  );

  const siap = useMemo(
    () =>
      hidup
        .filter((o) => o.status === 'ready')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [hidup],
  );

  // Yang disorot = order siap yang paling baru dipanggil. Kalau belum ada
  // yang dipanggil, pakai yang paling lama menunggu supaya layar tidak
  // kosong padahal ada pesanan siap.
  const sorot = useMemo(() => {
    const sudah = siap.filter((o) => o.calledAt !== null);
    if (sudah.length > 0) {
      return sudah.reduce((a, b) => (Date.parse(a.calledAt!) >= Date.parse(b.calledAt!) ? a : b));
    }
    return siap[0] ?? null;
  }, [siap]);

  const siapLain = useMemo(() => siap.filter((o) => o.id !== sorot?.id), [siap, sorot]);

  /* --- Pengumuman -------------------------------------------------------- */

  useEffect(() => {
    if (!sorot?.calledAt || !audioOn) return;

    // Kunci unik per panggilan: id + waktu panggil. Panggilan ulang punya
    // waktu baru, jadi akan diumumkan lagi.
    const kunci = `${sorot.id}@${sorot.calledAt}`;
    if (lastAnnouncedRef.current === kunci) return;
    lastAnnouncedRef.current = kunci;

    void announceQueue(sorot.queueNumber ?? '', {
      suffix: callSuffix,
      attempt: sorot.callCount,
    });
  }, [sorot?.id, sorot?.calledAt, sorot?.callCount, sorot?.queueNumber, audioOn, callSuffix]);

  /* --- Aksi -------------------------------------------------------------- */

  async function aktifkanSuara() {
    const ok = await unlockAudio();
    if (ok) {
      setAudioOn(true);
      playChime();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setFullscreen(false);
    } else {
      void document.documentElement.requestFullscreen();
      setFullscreen(true);
    }
  }

  /* --- Render ------------------------------------------------------------ */

  const tanggal = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);

  const dipanggilUlang = (sorot?.callCount ?? 0) > 1;

  return (
    <div class="surface-dark flex h-dvh flex-col overflow-hidden text-white">
      {/* ---------------------------------------------------------------- */}
      <header class="flex shrink-0 items-center justify-between gap-6 border-b border-white/10 px-7 py-4">
        <div class="flex items-center gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 shadow-glow">
            <Icon name="bell" size={28} />
          </div>
          <div class="min-w-0">
            <h1 class="display truncate text-3xl leading-tight font-bold">{storeName}</h1>
            <p class="truncate text-sm font-semibold text-white/80">
              {tagline || 'Layar Antrian'}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-6">
          <span class="flex items-center gap-2 text-sm font-bold text-white/75">
            <span
              class={[
                'h-2.5 w-2.5 rounded-full',
                status === 'live' ? 'bg-emerald-400' : status === 'offline' ? 'bg-red-400' : 'bg-amber-400',
              ].join(' ')}
            />
            {status === 'live' ? 'Tersambung' : status === 'offline' ? 'Terputus' : 'Menyambung'}
          </span>

          <div class="text-right">
            <time class="num block text-4xl leading-none font-black tabular-nums" dateTime={nowIso()}>
              {formatTime(now)}
            </time>
            <span class="text-sm font-semibold text-white/85">{tanggal}</span>
          </div>

          {!audioOn && isSpeechSupported() ? (
            <button
              type="button"
              onClick={() => void aktifkanSuara()}
              class="tap inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
            >
              <Icon name="volume" size={18} />
              Aktifkan Suara
            </button>
          ) : null}

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="Layar penuh"
            class="tap inline-flex items-center justify-center rounded-xl border border-white/15 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Icon name={fullscreen ? 'minimize' : 'maximize'} size={18} />
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      <main class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] gap-4 p-4">
        {/* Antrian masuk ------------------------------------------------- */}
        <Kolom judul="Antrian Masuk" ikon="inbox" jumlah={masuk.length} aksen="text-amber-200">
          {masuk.length === 0 ? (
            <p class="py-8 text-center text-sm font-semibold text-white/70">Tidak ada antrian</p>
          ) : (
            masuk.map((o) => (
              <KartuKolom key={o.id} order={o} warna="border-amber-300/50 bg-amber-400/20" />
            ))
          )}
        </Kolom>

        {/* Sedang dimasak ------------------------------------------------ */}
        <Kolom judul="Sedang Dimasak" ikon="flame" jumlah={dimasak.length} aksen="text-sky-200">
          {dimasak.length === 0 ? (
            <p class="py-8 text-center text-sm font-semibold text-white/70">Dapur kosong</p>
          ) : (
            dimasak.map((o) => (
              <KartuKolom key={o.id} order={o} warna="border-sky-300/50 bg-sky-400/20" />
            ))
          )}
        </Kolom>

        {/* Siap diambil -------------------------------------------------- */}
        <Kolom judul="Siap Diambil" ikon="bell" jumlah={siap.length} aksen="text-emerald-200">
          {sorot ? (
            <>
              <div
                key={`${sorot.id}@${sorot.calledAt ?? 'x'}`}
                class="anim-pop shrink-0 rounded-2xl border-2 border-emerald-300/70 bg-gradient-to-b from-emerald-400/30 to-emerald-600/15 px-5 py-5 text-center"
              >
                <p class="text-xs font-bold tracking-[0.22em] text-emerald-200 uppercase">
                  {dipanggilUlang ? `Panggilan ke-${sorot.callCount}` : 'Nomor Dipanggil'}
                </p>
                <p class="num mt-1 text-[clamp(3.5rem,7.5vw,6.5rem)] leading-none font-black tracking-tight text-white">
                  {sorot.queueNumber ?? '—'}
                </p>
                <p class="mt-2 text-xl font-bold text-white">
                  {sorot.tableNumber === null ? 'Ambil di kasir' : `Meja ${sorot.tableNumber}`}
                </p>
              </div>

              {siapLain.length > 0 ? (
                <>
                  <p class="mt-1 shrink-0 text-xs font-bold tracking-[0.16em] text-white/80 uppercase">
                    Siap lainnya
                  </p>
                  <div class="grid shrink-0 grid-cols-3 gap-2.5">
                    {siapLain.map((o) => (
                      <div
                        key={o.id}
                        class="num rounded-xl border-2 border-emerald-300/50 bg-emerald-400/20 px-2 py-3 text-center text-3xl font-black text-white"
                      >
                        {o.queueNumber ?? '—'}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 text-white/70">
              <Icon name="bell" size={44} strokeWidth={1.3} />
              <p class="text-base font-bold">Belum ada yang siap</p>
              <p class="text-sm">Nomor yang dipanggil akan muncul di sini</p>
            </div>
          )}
        </Kolom>
      </main>

      {/* ---------------------------------------------------------------- */}
      <footer class="flex shrink-0 items-center gap-4 border-t border-white/10 px-7 py-3">
        <span class="shrink-0 rounded-lg bg-brand-600/25 px-3 py-1 text-xs font-bold tracking-[0.14em] text-brand-200 uppercase">
          Info
        </span>
        <div class="min-w-0 flex-1 overflow-hidden">
          <span class="anim-marquee inline-block text-base font-semibold whitespace-nowrap text-white/75">
            {infoText ||
              `Selamat datang di ${storeName} • Mohon perhatikan nomor antrian Anda di layar ini • Silakan ambil pesanan di counter saat nomor Anda muncul di kolom Siap Diambil`}
          </span>
        </div>
        <span class="shrink-0 text-sm font-semibold text-white/80">
          {masuk.length + dimasak.length} diproses · {siap.length} siap
        </span>
      </footer>
    </div>
  );
}
