/**
 * POS kasir.
 *
 * Tata letak untuk tablet lanskap: menu di kiri, keranjang di kanan. Semua
 * target sentuh besar karena dipakai sambil berdiri dan sering dengan satu
 * tangan.
 *
 * Yang berbeda dari aplikasi aslinya:
 *  - **Nominal dihitung server.** Pratinjau di sini hanya untuk kasir; angka
 *    final datang dari `createOrder`. Aplikasi aslinya mengirim total dari
 *    peramban.
 *  - **QRIS toko jadi dinamis.** Nominal disisipkan ke payload QRIS statis
 *    sehingga pelanggan tidak mengetik nominal dan tidak bisa salah ketik.
 */

import { useMemo, useState } from 'preact/hooks';

import {
  cashChange,
  cashIsEnough,
  computeTotals,
  formatRupiah,
  parseRupiah,
  quickCashOptions,
  totalQty,
} from '../../domain/money.ts';
import { QrisError, qrisWithAmount } from '../../domain/qris.ts';
import { tataLetakTema } from '../../domain/theme.ts';
import type { Category, Discount, Menu, Order, OrderItem, PaymentMethod, StoreSettings } from '../../domain/types.ts';
import { theme } from '../../state/theme.ts';
import { Button, Card, Field, Input, Money } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { MenuThumb } from '../../ui/MenuThumb.tsx';
import { QrCode } from '../../ui/QrCode.tsx';

/* ==========================================================================
   Tipe
   ========================================================================= */

interface Baris {
  menu: Menu;
  qty: number;
  notes: string;
}

/** Metode yang bisa dipilih kasir di layar ini. */
type MetodeKasir = Extract<PaymentMethod, 'cash' | 'qris_static' | 'qris_gateway'>;

const LABEL_METODE: Record<MetodeKasir, string> = {
  cash: 'Tunai',
  qris_static: 'QRIS Toko',
  qris_gateway: 'QRIS Otomatis',
};

export interface PosViewProps {
  settings: StoreSettings;
  categories: readonly Category[];
  menus: readonly Menu[];
  cashierName: string;
  /** Buat order. Mengembalikan order lengkap dari server. */
  onCreate: (input: {
    items: OrderItem[];
    discount: Discount;
    paymentMethod: MetodeKasir;
    cashReceived: number;
    tableNumber: number | null;
    customerName: string;
    customerNotes: string;
  }) => Promise<Order>;
  /** Tandai lunas. */
  onPay: (orderId: string, amountPaid: number, cashReceived: number) => Promise<void>;
}

/* ==========================================================================
   Tampilan
   ========================================================================= */

export function PosView({
  settings,
  categories,
  menus,
  cashierName,
  onCreate,
  onPay,
}: PosViewProps) {
  const [keranjang, setKeranjang] = useState<Baris[]>([]);
  const [kategori, setKategori] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [diskon, setDiskon] = useState<Discount>({ type: 'none', value: 0 });
  const [diskonTerbuka, setDiskonTerbuka] = useState(false);
  // Di ponsel tidak ada ruang untuk dua kolom sekaligus. Kisi menu dapat
  // seluruh lebar, keranjang jadi panel bawah yang digeser naik.
  const [keranjangTerbuka, setKeranjangTerbuka] = useState(false);
  const [metode, setMetode] = useState<MetodeKasir>('cash');
  const [tunai, setTunai] = useState(0);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [hasil, setHasil] = useState<{ order: Order; qris: string | null } | null>(null);

  const tersedia = useMemo(() => menus.filter((m) => m.isAvailable), [menus]);

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (q) {
      return tersedia.filter(
        (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
      );
    }
    return kategori ? tersedia.filter((m) => m.categoryId === kategori) : tersedia;
  }, [tersedia, kategori, cari]);

  const items = useMemo<OrderItem[]>(
    () =>
      keranjang.map((b) => ({
        menuId: b.menu.id,
        name: b.menu.name,
        price: b.menu.price,
        qty: b.qty,
        notes: b.notes,
        costPrice: b.menu.costPrice,
      })),
    [keranjang],
  );

  const total = useMemo(() => {
    if (items.length === 0) return null;
    return computeTotals({
      items,
      discount: diskon.type === 'none' ? undefined : diskon,
      taxPercent: settings.tax.percent,
      serviceAmount: settings.serviceFee.enabled ? settings.serviceFee.amount : 0,
    });
  }, [items, diskon, settings.tax.percent, settings.serviceFee]);

  const jumlah = totalQty(items);
  const opsiTunai = total ? quickCashOptions(total.total) : [];
  const kembalian = total ? cashChange(tunai, total.total) : 0;
  const tunaiCukup = total ? cashIsEnough(tunai, total.total) : false;

  /* --- Keranjang -------------------------------------------------------- */

  function tambah(menu: Menu) {
    setKeranjang((prev) => {
      const ada = prev.find((b) => b.menu.id === menu.id && b.notes === '');
      if (ada) return prev.map((b) => (b === ada ? { ...b, qty: b.qty + 1 } : b));
      return [...prev, { menu, qty: 1, notes: '' }];
    });
  }

  function ubahQty(menuId: string, delta: number) {
    setKeranjang((prev) =>
      prev.map((b) => (b.menu.id === menuId ? { ...b, qty: b.qty + delta } : b)).filter((b) => b.qty > 0),
    );
  }

  function ubahCatatan(menuId: string, notes: string) {
    setKeranjang((prev) => prev.map((b) => (b.menu.id === menuId ? { ...b, notes } : b)));
  }

  function bersihkan() {
    setKeranjang([]);
    setDiskon({ type: 'none', value: 0 });
    setTunai(0);
    setGalat(null);
    setHasil(null);
  }

  /* --- Bayar ------------------------------------------------------------ */

  async function bayar() {
    if (!total || items.length === 0) return;
    setGalat(null);
    setSibuk(true);
    try {
      const order = await onCreate({
        items,
        discount: diskon,
        paymentMethod: metode,
        cashReceived: metode === 'cash' ? tunai : 0,
        tableNumber: null,
        customerName: '',
        customerNotes: '',
      });

      // Tunai dan QRIS toko diselesaikan langsung di kasir. QRIS otomatis
      // menunggu notifikasi dari payment gateway.
      let qris: string | null = null;

      if (metode === 'cash') {
        await onPay(order.id, total.total, tunai);
      } else if (metode === 'qris_static') {
        const payload = settings.payments.qrisStatic.payload;
        if (payload) {
          try {
            qris = qrisWithAmount(payload, order.payment.amountDue).payload;
          } catch (err) {
            if (!(err instanceof QrisError)) throw err;
            // QRIS toko belum diisi dengan benar — order tetap dibuat, kasir
            // konfirmasi manual.
          }
        }
      }

      setHasil({ order, qris });
      setKeranjang([]);
      setDiskon({ type: 'none', value: 0 });
      setTunai(0);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan order');
    } finally {
      setSibuk(false);
    }
  }

  async function konfirmasiQris() {
    if (!hasil) return;
    setSibuk(true);
    try {
      await onPay(hasil.order.id, hasil.order.payment.amountDue, 0);
      setHasil({ ...hasil, qris: null });
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menandai lunas');
    } finally {
      setSibuk(false);
    }
  }

  /* --- Render ----------------------------------------------------------- */

  return (
    // Ponsel: satu kolom, kisi menu di atas lalu bilah keranjang di bawah.
    // Layar lebar: dua kolom bersebelahan seperti semula.
    <div class="flex h-[calc(100dvh-56px)] flex-col gap-3 p-4 lg:flex-row lg:gap-4">
      {/* ================================================================ */}
      {/* Menu                                                             */}
      {/* ================================================================ */}
      <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <Icon
              name="search"
              size={16}
              class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={cari}
              onInput={(e) => setCari((e.target as HTMLInputElement).value)}
              placeholder="Cari menu…"
              class="w-full rounded-lg border border-ink-200 bg-surface py-2.5 pr-3 pl-9 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          {cari ? (
            <Button variant="outline" size="sm" icon="x" onClick={() => setCari('')}>
              Hapus
            </Button>
          ) : null}
        </div>

        <nav class="scrollbar-none flex gap-2 overflow-x-auto pb-1">
          <TombolKategori aktif={kategori === null && !cari} onClick={() => { setKategori(null); setCari(''); }}>
            Semua
          </TombolKategori>
          {categories
            .filter((c) => c.isActive)
            .map((c) => (
              <TombolKategori
                key={c.id}
                aktif={kategori === c.id}
                onClick={() => {
                  setKategori(c.id);
                  setCari('');
                }}
              >
                {c.name}
              </TombolKategori>
            ))}
        </nav>

        <div class="scrollbar-thin flex-1 overflow-y-auto">
          {daftar.length === 0 ? (
            <p class="py-16 text-center text-sm text-ink-500">Tidak ada menu yang cocok.</p>
          ) : (
            // Tema Fokus: foto lebih besar dan kisi lebih longgar. Kasir memilih
            // sambil melayani antrean — mengenali gambar sekilas lebih cepat
            // daripada membaca nama, jadi gambar yang layak dilihat lebih
            // berguna daripada kartu kecil yang rapat.
            <div
              class={
                // Di bawah `lg` kisi menu dapat seluruh lebar layar, jadi
                // kolomnya bisa lebih banyak. Di `lg` panel keranjang kembali
                // mengambil 380 px, jadi kolomnya dikurangi lagi.
                tataLetakTema(theme.value) === 'fokus'
                  ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3'
                  : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'
              }
            >
              {daftar.map((m) => {
                const diKeranjang = keranjang.find((b) => b.menu.id === m.id);
                const besar = tataLetakTema(theme.value) === 'fokus';
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => tambah(m)}
                    class={[
                      'relative flex flex-col gap-2.5 overflow-hidden rounded-xl border p-3 text-left transition-colors',
                      diKeranjang
                        ? 'border-brand-500 bg-brand-soft'
                        : 'border-ink-200 bg-surface hover:border-brand-300 hover:bg-brand-soft/50',
                    ].join(' ')}
                  >
                    <MenuThumb
                      name={m.name}
                      imageUrl={m.imageUrl}
                      category={categories.find((c) => c.id === m.categoryId)?.name}
                      size={besar ? 'tile-lg' : 'tile'}
                      rounded="rounded-lg"
                    />

                    {/* Tinggi nama dikunci dua baris supaya harga semua kartu
                        tetap sebaris walau ada nama yang panjang. */}
                    <span class="line-clamp-2 min-h-10 text-sm leading-5 font-bold text-ink-900">
                      {m.name}
                    </span>

                    <span class="flex items-center justify-between gap-2">
                      <Money value={m.price} class="num text-base font-extrabold text-brand-700" />
                      {diKeranjang ? (
                        <span class="num flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">
                          {diKeranjang.qty}
                        </span>
                      ) : null}
                    </span>
                    {m.stock !== null && m.stock <= 5 ? (
                      <span class="absolute top-2 right-2 rounded bg-pending-bg px-1.5 py-0.5 text-[10px] font-bold text-pending">
                        {m.stock}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ================================================================ */}
      {/* Bilah keranjang — ponsel saja                                     */}
      {/* ================================================================ */}
      <button
        type="button"
        onClick={() => setKeranjangTerbuka(true)}
        class="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-ink-200 bg-surface px-4 py-3 text-left lg:hidden"
      >
        <span class="flex items-center gap-2.5">
          <span class="relative flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-700">
            <Icon name="cart" size={18} />
            {jumlah > 0 ? (
              <span class="num absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
                {jumlah}
              </span>
            ) : null}
          </span>
          <span class="flex flex-col">
            <span class="text-sm font-bold text-ink-900">
              {jumlah > 0 ? `${jumlah} item` : 'Keranjang kosong'}
            </span>
            <span class="text-xs text-ink-500">
              {total ? formatRupiah(total.total) : 'Ketuk menu untuk menambah'}
            </span>
          </span>
        </span>
        <span class="text-xs font-bold text-brand-700">
          {jumlah > 0 ? 'Lihat pesanan' : ''}
        </span>
      </button>

      {/* Latar gelap saat panel keranjang terbuka — ponsel saja. */}
      {keranjangTerbuka ? (
        <div
          class="fixed inset-0 z-30 bg-ink-950/60 lg:hidden"
          onClick={() => setKeranjangTerbuka(false)}
        />
      ) : null}

      {/* ================================================================ */}
      {/* Keranjang                                                        */}
      {/* ================================================================ */}
      <aside
        class={[
          'flex flex-col border-ink-200 bg-surface',
          // Ponsel: panel bawah yang digeser naik. Dipatok `w-[380px]` seperti
          // sebelumnya, panel ini menelan seluruh lebar layar sempit dan kisi
          // menu yang menyusut jadi nol.
          // Tingginya 92dvh, bukan 85dvh: blok pembayaran saja butuh ~440 px,
          // jadi dengan 85dvh daftar item cuma kebagian ~205 px dan langsung
          // terpotong. Kasir lebih perlu melihat apa yang ditagih.
          'fixed inset-x-0 bottom-0 z-40 max-h-[92dvh] rounded-t-2xl border-t shadow-2xl transition-transform duration-200',
          keranjangTerbuka ? 'translate-y-0' : 'translate-y-full',
          // Layar lebar: kolom tetap di sisi kanan, selalu terlihat.
          'lg:static lg:z-auto lg:max-h-none lg:w-[380px] lg:shrink-0 lg:translate-y-0 lg:rounded-xl lg:border lg:shadow-none',
        ].join(' ')}
      >
        <header class="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <div>
            <h2 class="font-bold text-ink-900">Pesanan</h2>
            <p class="text-xs text-ink-500">Kasir: {cashierName || '—'}</p>
          </div>
          <div class="flex items-center gap-1">
            {keranjang.length > 0 ? (
              <Button variant="ghost" size="sm" icon="trash" onClick={bersihkan}>
                Kosongkan
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => setKeranjangTerbuka(false)}
              class="flex h-9 w-9 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 lg:hidden"
              aria-label="Tutup keranjang"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>

        {/* Lantai tinggi: tanpa ini daftar item bisa menyusut jadi ~200 px
            saat blok pembayaran panjang, dan pesanan yang ditagih jadi tidak
            kelihatan. */}
        <div class="scrollbar-thin min-h-44 flex-1 overflow-y-auto px-4 py-3">
          {keranjang.length === 0 ? (
            <div class="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-ink-400">
              <Icon name="cart" size={32} strokeWidth={1.4} />
              <p class="text-sm">Ketuk menu untuk menambah</p>
            </div>
          ) : (
            <ul class="space-y-3">
              {keranjang.map((b) => (
                <li key={b.menu.id} class="rounded-lg border border-ink-200 p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-bold text-ink-900">{b.menu.name}</p>
                      <p class="text-xs text-ink-500">{formatRupiah(b.menu.price)}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => ubahQty(b.menu.id, -1)}
                        class="flex h-8 w-8 items-center justify-center rounded-md bg-ink-100 text-ink-700 hover:bg-ink-200"
                        aria-label="Kurangi"
                      >
                        <Icon name="minus" size={14} />
                      </button>
                      <span class="num w-7 text-center text-sm font-bold">{b.qty}</span>
                      <button
                        type="button"
                        onClick={() => ubahQty(b.menu.id, 1)}
                        class="flex h-8 w-8 items-center justify-center rounded-md bg-ink-100 text-ink-700 hover:bg-ink-200"
                        aria-label="Tambah"
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={b.notes}
                    onInput={(e) => ubahCatatan(b.menu.id, (e.target as HTMLInputElement).value)}
                    placeholder="Catatan dapur…"
                    class="mt-2 w-full rounded-md border border-ink-200 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rincian & bayar ------------------------------------------------ */}
        {total ? (
          <div class="border-t border-ink-200 px-4 py-3">
            <dl class="space-y-1 text-sm">
              <Baris label={`Subtotal (${jumlah} item)`} value={total.subtotal} />
              {total.discountAmount > 0 ? (
                <Baris label="Diskon" value={-total.discountAmount} />
              ) : null}
              {total.serviceAmount > 0 ? (
                <Baris label="Biaya layanan" value={total.serviceAmount} />
              ) : null}
              {total.taxAmount > 0 ? (
                <Baris label={`Pajak (${settings.tax.percent}%)`} value={total.taxAmount} />
              ) : null}
              <div class="!mt-2 flex items-baseline justify-between border-t border-ink-200 pt-2">
                <dt class="font-bold text-ink-900">Total</dt>
                <dd>
                  <Money value={total.total} class="text-xl font-black text-ink-900" />
                </dd>
              </div>
            </dl>

            <Button
              variant="ghost"
              size="sm"
              icon="percent"
              onClick={() => setDiskonTerbuka((v) => !v)}
              class="mt-2 w-full"
            >
              {diskon.type === 'none' ? 'Tambah diskon' : 'Ubah diskon'}
            </Button>

            {diskonTerbuka ? (
              <PanelDiskon
                nilai={diskon}
                subtotal={total.subtotal}
                onUbah={setDiskon}
                onTutup={() => setDiskonTerbuka(false)}
              />
            ) : null}

            {/* Metode --------------------------------------------------- */}
            <div class="mt-3 grid grid-cols-3 gap-1.5">
              {(['cash', 'qris_static', 'qris_gateway'] as MetodeKasir[]).map((m) => {
                const aktif =
                  settings.payments[m === 'cash' ? 'cash' : m === 'qris_static' ? 'qrisStatic' : 'qrisGateway']
                    .enabled;
                if (!aktif) return null;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetode(m)}
                    class={[
                      'rounded-lg px-2 py-2.5 text-xs font-bold transition-colors',
                      metode === m
                        ? 'bg-solid text-on-solid'
                        : 'bg-ink-100 text-ink-700 hover:bg-ink-200',
                    ].join(' ')}
                  >
                    {LABEL_METODE[m]}
                  </button>
                );
              })}
            </div>

            {/* Tunai ---------------------------------------------------- */}
            {metode === 'cash' ? (
              <div class="mt-3">
                <Field label="Uang diterima">
                  <Input
                    inputMode="numeric"
                    value={tunai === 0 ? '' : formatRupiah(tunai, false)}
                    onInput={(e) => setTunai(parseRupiah((e.target as HTMLInputElement).value))}
                    placeholder="0"
                    class="text-right text-lg font-bold"
                  />
                </Field>
                <div class="mt-2 grid grid-cols-4 gap-1.5">
                  {opsiTunai.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTunai(n)}
                      class="num rounded-md bg-ink-100 py-2 text-xs font-bold text-ink-700 hover:bg-ink-200"
                    >
                      {n >= 1000 ? `${n / 1000}rb` : n}
                    </button>
                  ))}
                </div>
                {tunai > 0 ? (
                  <div
                    class={[
                      'mt-2 flex items-center justify-between rounded-md px-3 py-2 text-sm font-bold',
                      tunaiCukup ? 'bg-done-bg text-done' : 'bg-cancelled-bg text-cancelled',
                    ].join(' ')}
                  >
                    <span>{tunaiCukup ? 'Kembalian' : 'Kurang'}</span>
                    <Money value={Math.abs(tunaiCukup ? kembalian : total.total - tunai)} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {galat ? (
              <p class="mt-2 rounded-md bg-cancelled-bg px-3 py-2 text-xs font-semibold text-cancelled">
                {galat}
              </p>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              icon="check"
              loading={sibuk}
              disabled={metode === 'cash' && tunai > 0 && !tunaiCukup}
              onClick={() => void bayar()}
              class="mt-3 w-full"
            >
              {metode === 'cash' ? 'Bayar tunai' : metode === 'qris_static' ? 'Simpan & tampilkan QR' : 'Simpan pesanan'}
            </Button>
          </div>
        ) : null}
      </aside>

      {/* ================================================================ */}
      {/* Hasil                                                            */}
      {/* ================================================================ */}
      {hasil ? (
        <HasilOrder
          order={hasil.order}
          qris={hasil.qris}
          sibuk={sibuk}
          onKonfirmasi={() => void konfirmasiQris()}
          onTutup={() => setHasil(null)}
        />
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

function TombolKategori({
  aktif,
  onClick,
  children,
}: {
  aktif: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={[
        'shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-colors',
        aktif ? 'bg-brand-600 text-white' : 'bg-surface text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Baris({ label, value }: { label: string; value: number }) {
  return (
    <div class="flex items-baseline justify-between">
      <dt class="text-ink-600">{label}</dt>
      <dd>
        <Money value={value} class="font-semibold text-ink-800" />
      </dd>
    </div>
  );
}

function PanelDiskon({
  nilai,
  subtotal,
  onUbah,
  onTutup,
}: {
  nilai: Discount;
  subtotal: number;
  onUbah: (d: Discount) => void;
  onTutup: () => void;
}) {
  return (
    <div class="mt-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
      <div class="flex gap-1.5">
        {(['percent', 'amount'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onUbah({ type: t, value: 0 })}
            class={[
              'flex-1 rounded-md px-2 py-1.5 text-xs font-bold',
              nilai.type === t ? 'bg-solid text-on-solid' : 'bg-surface text-ink-700 ring-1 ring-ink-200',
            ].join(' ')}
          >
            {t === 'percent' ? 'Persen' : 'Rupiah'}
          </button>
        ))}
      </div>
      <Input
        inputMode="numeric"
        value={nilai.value === 0 ? '' : String(nilai.value)}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          const n = nilai.type === 'percent' ? Math.min(100, Math.max(0, Number(raw) || 0)) : parseRupiah(raw);
          onUbah({ type: nilai.type, value: n });
        }}
        placeholder={nilai.type === 'percent' ? '10' : '5000'}
        class="mt-2 text-right font-bold"
      />
      <div class="mt-2 flex items-center justify-between text-xs text-ink-500">
        <span>Subtotal {formatRupiah(subtotal)}</span>
        <button type="button" onClick={onTutup} class="font-bold text-ink-700 hover:underline">
          Tutup
        </button>
      </div>
    </div>
  );
}

function HasilOrder({
  order,
  qris,
  sibuk,
  onKonfirmasi,
  onTutup,
}: {
  order: Order;
  qris: string | null;
  sibuk: boolean;
  onKonfirmasi: () => void;
  onTutup: () => void;
}) {
  const lunas = order.payment.status === 'paid';

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4" onClick={onTutup}>
      <Card class="anim-pop max-h-[92dvh] w-full max-w-md overflow-y-auto" onClick={(e: Event) => e.stopPropagation()}>
        <div class="text-center">
          <div
            class={[
              'mx-auto flex h-14 w-14 items-center justify-center rounded-full',
              lunas ? 'bg-done-bg text-done' : 'bg-brand-soft text-brand-soft-fg',
            ].join(' ')}
          >
            <Icon name={lunas ? 'check' : 'receipt'} size={26} />
          </div>
          <h2 class="mt-3 text-lg font-extrabold text-ink-900">
            {lunas ? 'Lunas' : 'Pesanan tersimpan'}
          </h2>
          <p class="text-sm text-ink-500">{order.code}</p>
          {order.queueNumber ? (
            <p class="num mt-2 text-4xl font-black text-brand-700">{order.queueNumber}</p>
          ) : null}
        </div>

        {qris ? (
          <div class="mt-4 flex flex-col items-center gap-2 rounded-lg border border-ink-200 p-4">
            <QrCode value={qris} size={220} label={`QRIS ${formatRupiah(order.payment.amountDue)}`} />
            <Money value={order.payment.amountDue} class="text-2xl font-black text-ink-900" />
            <p class="text-center text-xs text-ink-500">
              Minta pelanggan scan QR ini. Nominal sudah terisi otomatis.
            </p>
            <Button variant="primary" size="md" icon="check" loading={sibuk} onClick={onKonfirmasi} class="w-full">
              Tandai sudah dibayar
            </Button>
          </div>
        ) : null}

        {order.payment.method === 'qris_gateway' && !lunas ? (
          <p class="mt-4 rounded-md bg-pending-bg px-4 py-3 text-center text-sm font-semibold text-pending">
            Menunggu pembayaran dari pelanggan. Order akan otomatis lunas saat notifikasi masuk.
          </p>
        ) : null}

        <div class="mt-4 flex items-baseline justify-between border-t border-ink-200 pt-3">
          <span class="font-bold text-ink-900">Total</span>
          <Money value={order.payment.amountDue} class="text-xl font-black text-ink-900" />
        </div>

        <Button variant="outline" size="md" onClick={onTutup} class="mt-4 w-full">
          Tutup
        </Button>
      </Card>
    </div>
  );
}
