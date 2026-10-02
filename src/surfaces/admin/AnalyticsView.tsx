/**
 * Analitik penjualan.
 *
 * Dihitung dari daftar order yang sudah diambil untuk periode terpilih.
 * Aplikasi aslinya menaruh seluruh perhitungan di lembar Google Sheets dengan
 * banyak sel rumus; di sini perhitungannya di TypeScript, jadi bisa diuji
 * (lihat `domain/money.test.ts`) dan tidak pecah kalau ada baris yang terhapus.
 *
 * Catatan penting soal HPP: laba kotor memakai `totalCost` yang **disalin saat
 * transaksi**. Kalau HPP sebuah menu diubah besok, laporan bulan lalu tidak
 * ikut berubah. Aplikasi aslinya menghitung ulang dari daftar menu saat ini,
 * sehingga laporan lama berubah diam-diam setiap kali harga HPP diperbarui.
 */

import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { formatRupiah, summarizeReport } from '../../domain/money.ts';
import { awaitingPayment, forRevenue } from '../../domain/orders.ts';
import { dateKey, formatDateLong, lastNDaysRange, monthRange, todayRange, yearRange } from '../../domain/time.ts';
import type { Order, PaymentMethod, StockMovement } from '../../domain/types.ts';
import { Button, Card, EmptyState, Money, Select, Spinner } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import {
  REPORT_HINT,
  REPORT_LABEL,
  type ReportKey,
  buildReportSet,
  downloadReportCsv,
  downloadReportXlsx,
} from './exportReports.ts';

/* ==========================================================================
   Periode
   ========================================================================= */

type Periode = 'hari' | '7hari' | '30hari' | 'bulan' | 'tahun' | 'semua';

const LABEL_PERIODE: Record<Periode, string> = {
  hari: 'Hari ini',
  '7hari': '7 hari',
  '30hari': '30 hari',
  bulan: 'Bulan ini',
  tahun: 'Tahun ini',
  semua: 'Semua',
};

function rentang(p: Periode): { from?: string; to?: string } {
  switch (p) {
    case 'hari':
      return todayRange();
    case '7hari':
      return lastNDaysRange(7);
    case '30hari':
      return lastNDaysRange(30);
    case 'bulan':
      return monthRange();
    case 'tahun':
      return yearRange();
    case 'semua':
      return {};
  }
}

const LABEL_METODE: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris_gateway: 'QRIS Otomatis',
  qris_static: 'QRIS Toko',
  transfer: 'Transfer',
  debit: 'Debit',
  split: 'Gabungan',
};

/* ==========================================================================
   Tampilan
   ========================================================================= */

export interface AnalyticsViewProps {
  orders: readonly Order[];
  loading: boolean;
  periode: Periode;
  onPeriode: (p: Periode) => void;
  /** Riwayat stok, dipakai untuk laporan stok yang bisa diunduh. */
  stockMovements?: readonly StockMovement[];
}

export function AnalyticsView({
  orders,
  loading,
  periode,
  onPeriode,
  stockMovements = [],
}: AnalyticsViewProps) {
  /**
   * Semua angka uang memakai `lunas` — order yang uangnya sudah masuk.
   *
   * Sebelumnya halaman ini memakai daftar order yang sekadar tidak dibatalkan,
   * jadi omzet, laba, menu terlaris, dan sebaran metode bayar semuanya ikut
   * menghitung order yang belum dibayar — padahal banner di bawah layar justru
   * menulis "ini belum masuk omzet di atas". Dua bagian layar menyatakan hal
   * yang berlawanan, dan yang salah adalah angkanya: pemilik melihat omzet
   * yang belum ia terima.
   *
   * Aturannya sekarang tinggal di `domain/orders.ts` supaya tidak bisa
   * ditafsirkan berbeda oleh tiap layar.
   */
  const lunas = useMemo(() => forRevenue(orders), [orders]);

  const ringkas = useMemo(() => summarizeReport(lunas), [lunas]);

  const belumBayar = useMemo(() => awaitingPayment(orders), [orders]);

  /** Menu terlaris berdasarkan jumlah porsi. */
  const menuTerlaris = useMemo(() => {
    const map = new Map<string, { nama: string; qty: number; omzet: number; hpp: number }>();
    for (const o of lunas) {
      for (const it of o.items) {
        const ada = map.get(it.menuId) ?? { nama: it.name, qty: 0, omzet: 0, hpp: 0 };
        ada.qty += it.qty;
        ada.omzet += it.price * it.qty;
        ada.hpp += it.costPrice * it.qty;
        map.set(it.menuId, ada);
      }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [lunas]);

  /** Sebaran per metode bayar. */
  const perMetode = useMemo(() => {
    const map = new Map<PaymentMethod, { jumlah: number; nilai: number }>();
    for (const o of lunas) {
      const ada = map.get(o.payment.method) ?? { jumlah: 0, nilai: 0 };
      ada.jumlah += 1;
      ada.nilai += o.total;
      map.set(o.payment.method, ada);
    }
    return [...map.entries()].sort((a, b) => b[1].nilai - a[1].nilai);
  }, [lunas]);

  /** Sebaran per kanal. */
  const perKanal = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of lunas) {
      map.set(o.channel, (map.get(o.channel) ?? 0) + o.total);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [lunas]);

  /** Jam tersibuk — dasar penjadwalan staf. */
  const perJam = useMemo(() => {
    const jam = new Array<number>(24).fill(0);
    for (const o of lunas) {
      const d = new Date(o.createdAt);
      // Jam lokal toko, bukan jam server.
      const h = Number(
        new Intl.DateTimeFormat('id-ID', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
          .format(d),
      );
      if (h >= 0 && h < 24) jam[h] = (jam[h] ?? 0) + 1;
    }
    return jam;
  }, [lunas]);

  /**
   * Nilai tertinggi untuk penskalaan batang. Minimal 1 supaya tidak pernah
   * membagi nol. Dipakai terpisah dari `jamTertinggi` karena angkanya dipakai
   * sebagai penyebut, sedangkan `jamTertinggi` dipakai sebagai angka yang
   * ditampilkan — kalau disatukan, layar akan mengaku "1 order" padahal belum
   * ada order sama sekali.
   */
  const jamSkala = Math.max(1, ...perJam);
  const jamTertinggi = Math.max(...perJam);
  const jamTersibuk = perJam.indexOf(jamTertinggi);

  /** Rekap per hari. */
  const perHari = useMemo(() => {
    const map = new Map<string, { order: number; omzet: number; hpp: number }>();
    for (const o of lunas) {
      const k = dateKey(o.createdAt);
      const ada = map.get(k) ?? { order: 0, omzet: 0, hpp: 0 };
      ada.order += 1;
      ada.omzet += o.total;
      ada.hpp += o.totalCost;
      map.set(k, ada);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [lunas]);

  return (
    <div class="space-y-4 p-4">
      {/* Ekspor ------------------------------------------------------------ */}
      <PanelEkspor orders={orders} movements={stockMovements} />

      {/* Periode ----------------------------------------------------------- */}
      <div class="flex flex-wrap items-center gap-2">
        {(Object.keys(LABEL_PERIODE) as Periode[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriode(p)}
            class={[
              'rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors',
              periode === p
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100',
            ].join(' ')}
          >
            {LABEL_PERIODE[p]}
          </button>
        ))}
        {loading ? (
          <span class="ml-1 flex items-center gap-2 text-sm text-ink-500">
            <Spinner size={14} /> memuat…
          </span>
        ) : null}
      </div>

      {/* KPI --------------------------------------------------------------- */}
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Omzet" nilai={formatRupiah(ringkas.revenue)} utama catatan="hanya order lunas" />
        <Kpi label="Order" nilai={String(ringkas.orderCount)} catatan="sudah dibayar" />
        <Kpi label="Rata-rata/order" nilai={formatRupiah(ringkas.averageOrderValue)} />
        <Kpi label="HPP" nilai={formatRupiah(ringkas.cost)} />
        <Kpi label="Laba kotor" nilai={formatRupiah(ringkas.grossProfit)} tone="done" />
        {/* Margin sengaja tanpa warna. Sebelumnya diberi warna merek (oranye),
            yang di halaman ini dipakai untuk peringatan — jadi margin sehat
            64% terbaca seperti ada yang salah. */}
        <Kpi label="Margin" nilai={`${ringkas.marginPercent}%`} />
      </div>

      {ringkas.orderCount === 0 ? (
        <Card>
          <EmptyState
            icon="chart"
            title="Belum ada data"
            description="Belum ada order pada periode ini. Coba pilih periode lain."
          />
        </Card>
      ) : (
        <>
          {/* Dua kolom yang mengalir sendiri-sendiri, bukan satu grid berbaris.
              Sebelumnya kartu tinggi (Menu terlaris, 10 baris) duduk sebaris
              dengan kartu pendek (Jam tersibuk), jadi di bawah kartu pendek
              itu tersisa lubang kosong setinggi selisihnya. */}
          <div class="grid items-start gap-4 lg:grid-cols-2">
            <div class="space-y-4">
            {/* Menu terlaris ------------------------------------------- */}
            <Card>
              <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                <Icon name="flame" size={16} /> Menu terlaris
              </h2>
              {/* Judul kolom. Sebelumnya angka di kanan tidak berlabel, jadi
                  tidak jelas itu omzet, laba, atau jumlah. */}
              <div class="mb-1.5 flex items-baseline gap-3 border-b border-ink-200 pb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">
                <span class="w-5 shrink-0 text-right">#</span>
                <span class="min-w-0 flex-1">Menu</span>
                <span class="shrink-0">Omzet</span>
              </div>
              <ul class="space-y-2.5">
                {menuTerlaris.map((m, i) => (
                  <li key={m.nama} class="flex items-baseline gap-3">
                    <span class="num w-5 shrink-0 text-right text-xs font-bold text-ink-400">
                      {i + 1}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-semibold text-ink-900">{m.nama}</span>
                      <span class="block text-xs text-ink-600">
                        {m.qty} porsi · laba {formatRupiah(m.omzet - m.hpp)}
                      </span>
                    </span>
                    <Money value={m.omzet} class="shrink-0 text-sm font-bold text-ink-900" />
                  </li>
                ))}
              </ul>
            </Card>
            </div>

            <div class="space-y-4">
            {/* Jam tersibuk -------------------------------------------- */}
            <Card>
              <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                <Icon name="clock" size={16} /> Jam tersibuk
              </h2>

              <div class="flex gap-2.5">
                {/* Sumbu tegak. Tanpa ini batangnya mengambang tanpa acuan,
                    jadi tidak ada cara menilai besarnya. */}
                <div class="flex h-40 flex-col justify-between text-right text-[10px] font-semibold text-ink-500">
                  <span class="num">{jamSkala}</span>
                  <span class="num">{Math.round(jamSkala / 2)}</span>
                  <span class="num">0</span>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="relative h-40 border-b-2 border-ink-300">
                    {/* Garis bantu tengah. */}
                    <div class="absolute inset-x-0 top-1/2 border-t border-dashed border-ink-200" />

                    <div class="flex h-full items-end gap-[3px]">
                      {perJam.map((n, h) => {
                        const jamIni = h === jamTersibuk;
                        return (
                          <div
                            key={h}
                            class="flex h-full flex-1 items-end"
                            title={`${String(h).padStart(2, '0')}:00 — ${n} order`}
                          >
                            <div
                              class={[
                                'w-full rounded-t',
                                jamIni ? 'bg-brand-700' : n > 0 ? 'bg-brand-400' : 'bg-ink-200',
                              ].join(' ')}
                              // Jam yang tidak ada ordernya tetap digambar tipis
                              // sebagai penanda posisi, supaya sumbunya terbaca
                              // utuh dan tidak terlihat seperti grafik rusak.
                              style={{
                                height: n > 0 ? `${Math.max((n / jamSkala) * 100, 6)}%` : '3px',
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Label jam sejajar dengan batangnya masing-masing. */}
                  <div class="mt-1 flex gap-[3px]">
                    {perJam.map((_, h) => (
                      <span key={h} class="num flex-1 text-center text-[9px] font-semibold text-ink-500">
                        {/* 23 ikut diberi label: tanpa itu batang paling kanan
                            berdiri di luar label terakhir dan posisinya jadi
                            menyesatkan. */}
                        {h % 3 === 0 || h === 23 ? h : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <p class="mt-3 text-xs text-ink-600">
                {jamTertinggi === 0 ? (
                  'Belum ada order pada periode ini.'
                ) : (
                  <>
                    Paling ramai pukul{' '}
                    <span class="num font-bold text-ink-900">
                      {String(jamTersibuk).padStart(2, '0')}:00
                    </span>{' '}
                    dengan <span class="num font-bold text-ink-900">{jamTertinggi} order</span>
                  </>
                )}
              </p>
            </Card>

            {/* Metode bayar -------------------------------------------- */}
            <Card>
              <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                <Icon name="wallet" size={16} /> Metode bayar
              </h2>
              <ul class="space-y-2.5">
                {perMetode.map(([m, d]) => (
                  <li key={m} class="flex items-baseline justify-between gap-3">
                    {/* Keterangan sekunder di kolom kiri, sama seperti kartu
                        Menu terlaris — sebelumnya di sini ia diletakkan di
                        kolom kanan, jadi polanya bertukar antar kartu. */}
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-semibold text-ink-900">{LABEL_METODE[m]}</span>
                      <span class="num block text-xs text-ink-600">{d.jumlah} order</span>
                    </span>
                    <Money value={d.nilai} class="shrink-0 text-sm font-bold text-ink-900" />
                  </li>
                ))}
              </ul>
            </Card>

            {/* Kanal ---------------------------------------------------- */}
            <Card>
              <h2 class="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                <Icon name="qr" size={16} /> Kanal
              </h2>
              <ul class="space-y-2">
                {perKanal.map(([k, nilai]) => (
                  <li key={k} class="flex items-baseline justify-between gap-3">
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-semibold text-ink-900">
                        {k === 'self_order' ? 'Pesan sendiri (QR meja)' : 'Kasir (POS)'}
                      </span>
                      <span class="num block text-xs text-ink-600">
                        {Math.round((nilai / ringkas.revenue) * 100)}% dari omzet
                      </span>
                    </span>
                    <Money value={nilai} class="shrink-0 text-sm font-bold text-ink-900" />
                  </li>
                ))}
              </ul>
            </Card>
            </div>
          </div>

          {/* Belum dibayar ------------------------------------------------- */}
          {belumBayar.length > 0 ? (
            <Card class="!border-pending/40 !bg-pending-bg">
              <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-pending">
                <Icon name="alert" size={16} /> {belumBayar.length} order belum dibayar
              </h2>
              <p class="text-sm text-pending/90">
                Total tagihan{' '}
                <span class="num font-bold">
                  {formatRupiah(belumBayar.reduce((s, o) => s + o.payment.amountDue, 0))}
                </span>{' '}
                — termasuk kode unik, jadi angkanya sedikit di atas nilai ordernya.
              </p>
              <p class="mt-1 text-sm text-pending/90">
                Belum dihitung di angka mana pun pada halaman ini. Semua angka di atas hanya
                menghitung order yang sudah lunas.
              </p>
            </Card>
          ) : null}

          {/* Rekap harian -------------------------------------------------- */}
          <Card class="!p-0">
            <h2 class="border-b border-ink-200 px-4 py-3 text-sm font-bold text-ink-800">
              Rekap per hari
            </h2>
            <div class="max-h-96 overflow-y-auto">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-ink-50 text-left text-xs font-bold text-ink-500 uppercase">
                  <tr>
                    <th class="px-4 py-2">Tanggal</th>
                    <th class="px-4 py-2 text-right">Order</th>
                    <th class="px-4 py-2 text-right">Omzet</th>
                    <th class="px-4 py-2 text-right">HPP</th>
                    <th class="px-4 py-2 text-right">Laba</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-ink-100">
                  {perHari.map(([k, d]) => (
                    <tr key={k} class="hover:bg-ink-50">
                      <td class="px-4 py-2 font-semibold text-ink-800">
                        {formatDateLong(`${k}T04:00:00.000Z`)}
                      </td>
                      <td class="num px-4 py-2 text-right text-ink-700">{d.order}</td>
                      <td class="num px-4 py-2 text-right font-semibold text-ink-900">
                        {formatRupiah(d.omzet, false)}
                      </td>
                      <td class="num px-4 py-2 text-right text-ink-600">
                        {formatRupiah(d.hpp, false)}
                      </td>
                      <td class="num px-4 py-2 text-right font-bold text-done">
                        {formatRupiah(d.omzet - d.hpp, false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

function Kpi({
  label,
  nilai,
  utama = false,
  tone = 'neutral',
  catatan,
}: {
  label: string;
  nilai: string;
  utama?: boolean;
  tone?: 'neutral' | 'done' | 'brand';
  catatan?: string;
}) {
  const warna = {
    neutral: 'text-ink-900',
    done: 'text-done',
    brand: 'text-brand-700',
  }[tone];

  return (
    <Card class="!p-4">
      <p class="text-xs font-semibold text-ink-500">{label}</p>
      <p class={['mt-1 font-black', utama ? 'text-2xl' : 'text-xl', warna].join(' ')}>{nilai}</p>
      {/* Keterangan kecil di bawah angka. Dipakai untuk menyatakan dasar
          hitungnya, supaya tidak ada angka yang harus ditebak asalnya. */}
      {catatan ? <p class="mt-0.5 text-[11px] text-ink-500">{catatan}</p> : null}
    </Card>
  );
}

/* ==========================================================================
   Ekspor laporan
   ========================================================================= */

const URUTAN_EKSPOR: readonly ReportKey[] = ['order', 'item', 'harian', 'menu', 'stok'];

/**
 * Unduh laporan sebagai CSV atau Excel.
 *
 * Aplikasi aslinya tidak punya tombol unduh sama sekali — pemilik yang ingin
 * menghitung ulang HPP di Excel harus menyalin manual dari tabel HTML.
 *
 * Dua tombol, bukan satu, karena keduanya dipakai untuk hal berbeda: CSV
 * untuk diolah lagi, Excel untuk dibuka apa adanya dan dibagikan.
 */
function PanelEkspor({
  orders,
  movements,
}: {
  orders: readonly Order[];
  movements: readonly StockMovement[];
}): JSX.Element {
  const [mana, setMana] = useState<ReportKey>('order');
  const [pesan, setPesan] = useState<string | null>(null);

  const set = useMemo(() => buildReportSet(orders, movements), [orders, movements]);
  const adaOrder = orders.length > 0;

  function jalankan(kerjakan: () => void, teks: string): void {
    try {
      kerjakan();
      setPesan(teks);
    } catch (err) {
      setPesan(err instanceof Error ? `Gagal: ${err.message}` : 'Gagal menyiapkan berkas');
    }
  }

  return (
    <Card>
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-52 flex-1">
          <label for="ekspor-pilih" class="mb-1.5 block text-sm font-semibold text-ink-700">
            Laporan
          </label>
          <Select
            id="ekspor-pilih"
            value={mana}
            onChange={(e) => setMana((e.currentTarget as HTMLSelectElement).value as ReportKey)}
          >
            {URUTAN_EKSPOR.map((k) => (
              <option key={k} value={k}>
                {REPORT_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>

        <div class="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            icon="download"
            onClick={() => jalankan(() => downloadReportCsv(set[mana]), 'CSV diunduh.')}
          >
            CSV
          </Button>
          <Button
            variant="primary"
            icon="download"
            disabled={!adaOrder && movements.length === 0}
            onClick={() =>
              jalankan(
                () => downloadReportXlsx(set, URUTAN_EKSPOR),
                'Excel diunduh (5 sheet).',
              )
            }
          >
            Excel
          </Button>
        </div>
      </div>

      <p class="mt-2.5 text-xs text-ink-500">
        {REPORT_HINT[mana]}
        {' '}
        <span class="text-ink-400">
          Excel memuat kelima laporan sebagai sheet terpisah.
        </span>
      </p>

      {pesan ? (
        <p class="mt-2 rounded-md bg-ink-100 px-3 py-2 text-xs font-semibold text-ink-700">
          {pesan}
        </p>
      ) : null}
    </Card>
  );
}

export { LABEL_PERIODE, rentang as rentangPeriode, type Periode };
