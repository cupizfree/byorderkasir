/**
 * Alur pesan-sendiri untuk pelanggan.
 *
 * Didesain untuk satu tangan, di HP, sambil berdiri di meja:
 *  - target sentuh besar (minimal 44px)
 *  - keranjang selalu terlihat di bawah
 *  - tanpa langkah yang tidak perlu
 *
 * Yang berbeda dari aplikasi aslinya:
 *  - **Harga dihitung server.** Total di sini hanya pratinjau; angka yang
 *    benar datang dari `createOrder`. Aplikasi aslinya menghitung di peramban
 *    dan mengirim hasilnya — artinya pelanggan bisa mengubah nominal.
 *  - **Pesanan dilacak setelah dikirim.** Pelanggan melihat statusnya berubah
 *    tanpa memuat ulang halaman.
 */

import { useMemo, useState } from 'preact/hooks';

import { computeTotals, formatRupiah, totalQty } from '../../domain/money.ts';
import { ORDER_FLOW } from '../../domain/orders.ts';
import type { Category, DiningTable, Menu, Order, OrderItem, StoreSettings } from '../../domain/types.ts';
import { Button, Card, Field, Input, Money, StatusBadge, Textarea } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { MenuThumb } from '../../ui/MenuThumb.tsx';

/* ==========================================================================
   Label
   ========================================================================= */

const LABEL_LANGKAH: Record<string, string> = {
  pending: 'Pesanan diterima',
  processing: 'Sedang disiapkan',
  ready: 'Siap diambil',
  completed: 'Selesai',
};

type MetodeBayar = 'qris_static' | 'cash';

/* ==========================================================================
   Keranjang
   ========================================================================= */

interface Baris {
  menu: Menu;
  qty: number;
  notes: string;
}

function keOrderItem(baris: readonly Baris[]): OrderItem[] {
  return baris.map((b) => ({
    menuId: b.menu.id,
    name: b.menu.name,
    price: b.menu.price,
    qty: b.qty,
    notes: b.notes,
    costPrice: b.menu.costPrice,
  }));
}

/* ==========================================================================
   Halaman
   ========================================================================= */

export interface OrderAppProps {
  settings: StoreSettings;
  categories: readonly Category[];
  menus: readonly Menu[];
  table: DiningTable | null;
  /** Dipanggil saat pelanggan menekan "Kirim pesanan". */
  onSubmit: (input: {
    items: OrderItem[];
    customerName: string;
    customerEmail: string;
    customerNotes: string;
    paymentMethod: MetodeBayar;
  }) => Promise<Order>;
  /** Pesanan yang sudah dikirim di sesi ini — untuk pelacakan. */
  submitted: Order | null;
  onNewOrder: () => void;
}

export function OrderApp({
  settings,
  categories,
  menus,
  table,
  onSubmit,
  submitted,
  onNewOrder,
}: OrderAppProps) {
  const [keranjang, setKeranjang] = useState<Baris[]>([]);
  const [kategoriAktif, setKategoriAktif] = useState<string | null>(null);
  const [keranjangTerbuka, setKeranjangTerbuka] = useState(false);
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [catatan, setCatatan] = useState('');
  const [metode, setMetode] = useState<MetodeBayar>('qris_static');
  const [kirim, setKirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const tersedia = useMemo(() => menus.filter((m) => m.isAvailable), [menus]);

  const kategoriTerpakai = useMemo(
    () => categories.filter((c) => c.isActive && tersedia.some((m) => m.categoryId === c.id)),
    [categories, tersedia],
  );

  const items = useMemo(() => keOrderItem(keranjang), [keranjang]);

  const total = useMemo(() => {
    if (items.length === 0) return null;
    return computeTotals({
      items,
      taxPercent: settings.tax.percent,
      serviceAmount: settings.serviceFee.enabled ? settings.serviceFee.amount : 0,
    });
  }, [items, settings.tax.percent, settings.serviceFee]);

  const jumlah = totalQty(items);
  const aktif = kategoriAktif ?? kategoriTerpakai[0]?.id ?? null;
  const daftar = tersedia.filter((m) => m.categoryId === aktif);

  /* --- Aksi ------------------------------------------------------------- */

  function tambah(menu: Menu) {
    setKeranjang((prev) => {
      const ada = prev.find((b) => b.menu.id === menu.id && b.notes === '');
      if (ada) {
        return prev.map((b) => (b === ada ? { ...b, qty: b.qty + 1 } : b));
      }
      return [...prev, { menu, qty: 1, notes: '' }];
    });
  }

  function ubahQty(menuId: string, delta: number) {
    setKeranjang((prev) =>
      prev
        .map((b) => (b.menu.id === menuId ? { ...b, qty: b.qty + delta } : b))
        .filter((b) => b.qty > 0),
    );
  }

  function ubahCatatan(menuId: string, notes: string) {
    setKeranjang((prev) => prev.map((b) => (b.menu.id === menuId ? { ...b, notes } : b)));
  }

  async function kirimPesanan() {
    setGalat(null);
    setKirim(true);
    try {
      await onSubmit({
        items,
        customerName: nama.trim() || 'Tamu',
        customerEmail: email.trim(),
        customerNotes: catatan.trim(),
        paymentMethod: metode,
      });
      setKeranjang([]);
      setKeranjangTerbuka(false);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal mengirim pesanan');
    } finally {
      setKirim(false);
    }
  }

  /* --- Sudah dikirim → pelacakan ---------------------------------------- */

  if (submitted) {
    return <Pelacakan order={submitted} settings={settings} onBaru={onNewOrder} />;
  }

  /* --- Tanpa meja → tidak bisa memesan ---------------------------------- */

  if (!table) {
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-50 px-8 text-center">
        <Icon name="qr" size={48} class="text-ink-400" />
        <h1 class="text-xl font-bold text-ink-900">Scan QR di meja</h1>
        <p class="max-w-sm text-sm text-ink-600">
          Untuk memesan, arahkan kamera HP ke kode QR yang tertempel di meja Anda. Halaman ini
          terbuka otomatis dari QR tersebut.
        </p>
      </div>
    );
  }

  /* --- Menu ------------------------------------------------------------- */

  return (
    <div class="flex min-h-dvh flex-col bg-ink-50 pb-24">
      <header class="sticky top-0 z-10 bg-ink-950 px-5 py-4 text-white">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm text-ink-400">{settings.name}</p>
            <h1 class="text-lg font-extrabold tracking-tight">
              {table.name || `Meja ${table.number}`}
            </h1>
          </div>
          <span class="num shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold">
            {table.number}
          </span>
        </div>
      </header>

      {/* Kategori ---------------------------------------------------------- */}
      <nav class="scrollbar-none sticky top-[68px] z-10 flex gap-2 overflow-x-auto bg-ink-50 px-5 py-3">
        {kategoriTerpakai.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setKategoriAktif(c.id)}
            class={[
              'tap shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-colors',
              c.id === aktif
                ? 'bg-brand-600 text-white'
                : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100',
            ].join(' ')}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {/* Menu -------------------------------------------------------------- */}
      <main class="flex-1 space-y-3 px-5">
        {daftar.length === 0 ? (
          <Card>
            <p class="py-8 text-center text-sm text-ink-500">Belum ada menu di kategori ini.</p>
          </Card>
        ) : (
          daftar.map((m) => (
            <Card key={m.id} class="!p-0">
              <div class="flex items-start gap-4 p-4">
                <MenuThumb
                  name={m.name}
                  imageUrl={m.imageUrl}
                  category={categories.find((c) => c.id === m.categoryId)?.name}
                  size="md"
                />
                <div class="min-w-0 flex-1">
                  <h3 class="font-bold text-ink-900">{m.name}</h3>
                  {m.description ? (
                    <p class="mt-1 text-sm text-ink-600">{m.description}</p>
                  ) : null}
                  <Money value={m.price} class="mt-2 block font-bold text-brand-700" />
                  {m.stock !== null && m.stock <= 5 ? (
                    <p class="mt-1 text-xs font-semibold text-pending">Sisa {m.stock}</p>
                  ) : null}
                </div>

                {(() => {
                  const diKeranjang = keranjang.find((b) => b.menu.id === m.id);
                  return diKeranjang ? (
                    <div class="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 p-1 text-white">
                      <button
                        type="button"
                        onClick={() => ubahQty(m.id, -1)}
                        class="flex h-9 w-9 items-center justify-center rounded-md hover:bg-brand-700"
                        aria-label="Kurangi"
                      >
                        <Icon name="minus" size={16} />
                      </button>
                      <span class="num w-7 text-center font-bold">{diKeranjang.qty}</span>
                      <button
                        type="button"
                        onClick={() => tambah(m)}
                        class="flex h-9 w-9 items-center justify-center rounded-md hover:bg-brand-700"
                        aria-label="Tambah"
                      >
                        <Icon name="plus" size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => tambah(m)}
                      class="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                      aria-label={`Tambah ${m.name}`}
                    >
                      <Icon name="plus" size={20} />
                    </button>
                  );
                })()}
              </div>
            </Card>
          ))
        )}
      </main>

      {/* Bilah keranjang --------------------------------------------------- */}
      {jumlah > 0 && total ? (
        <div class="safe-b fixed inset-x-0 bottom-0 border-t border-ink-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={() => setKeranjangTerbuka(true)}
            class="tap flex w-full items-center justify-between rounded-lg bg-brand-600 px-5 py-3.5 font-bold text-white hover:bg-brand-700"
          >
            <span class="flex items-center gap-2">
              <Icon name="cart" size={18} />
              {jumlah} item
            </span>
            <Money value={total.total} class="text-lg" />
          </button>
        </div>
      ) : null}

      {/* Lembar keranjang -------------------------------------------------- */}
      {keranjangTerbuka ? (
        <LembarKeranjang
          baris={keranjang}
          total={total}
          settings={settings}
          nama={nama}
          email={email}
          catatan={catatan}
          metode={metode}
          kirim={kirim}
          galat={galat}
          onTutup={() => setKeranjangTerbuka(false)}
          onQty={ubahQty}
          onCatatan={ubahCatatan}
          onNama={setNama}
          onEmail={setEmail}
          onCatatanUmum={setCatatan}
          onMetode={setMetode}
          onKirim={() => void kirimPesanan()}
        />
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Lembar keranjang
   ========================================================================= */

interface LembarProps {
  baris: readonly Baris[];
  total: ReturnType<typeof computeTotals> | null;
  settings: StoreSettings;
  nama: string;
  email: string;
  catatan: string;
  metode: MetodeBayar;
  kirim: boolean;
  galat: string | null;
  onTutup: () => void;
  onQty: (menuId: string, delta: number) => void;
  onCatatan: (menuId: string, notes: string) => void;
  onNama: (v: string) => void;
  onEmail: (v: string) => void;
  onCatatanUmum: (v: string) => void;
  onMetode: (m: MetodeBayar) => void;
  onKirim: () => void;
}

function LembarKeranjang(p: LembarProps) {
  const qrisAda = p.settings.payments.qrisStatic.enabled;

  return (
    <div class="fixed inset-0 z-30 flex flex-col bg-ink-950/50" onClick={p.onTutup}>
      <div
        class="anim-sheet safe-b mt-auto flex max-h-[92dvh] flex-col rounded-t-2xl bg-ink-50"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="flex items-center justify-between border-b border-ink-200 px-5 py-4">
          <h2 class="font-bold text-ink-900">Pesanan Anda</h2>
          <button
            type="button"
            onClick={p.onTutup}
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-200"
            aria-label="Tutup"
          >
            <Icon name="x" size={20} />
          </button>
        </header>

        <div class="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Baris pesanan ------------------------------------------------- */}
          {p.baris.map((b) => (
            <div key={b.menu.id} class="rounded-lg border border-ink-200 bg-white p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-ink-900">{b.menu.name}</p>
                  <p class="text-sm text-ink-500">{formatRupiah(b.menu.price)}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => p.onQty(b.menu.id, -1)}
                    class="flex h-8 w-8 items-center justify-center rounded-md bg-ink-100 text-ink-700 hover:bg-ink-200"
                    aria-label="Kurangi"
                  >
                    <Icon name="minus" size={14} />
                  </button>
                  <span class="num w-7 text-center font-bold">{b.qty}</span>
                  <button
                    type="button"
                    onClick={() => p.onQty(b.menu.id, 1)}
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
                onInput={(e) => p.onCatatan(b.menu.id, (e.target as HTMLInputElement).value)}
                placeholder="Catatan (mis. tanpa gula)"
                class="mt-2 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          ))}

          {/* Rincian biaya ------------------------------------------------- */}
          {p.total ? (
            <Card>
              <dl class="space-y-1.5 text-sm">
                <Baris label="Subtotal" value={p.total.subtotal} />
                {p.total.serviceAmount > 0 ? (
                  <Baris label="Biaya layanan" value={p.total.serviceAmount} />
                ) : null}
                {p.total.taxAmount > 0 ? (
                  <Baris label={`Pajak (${p.settings.tax.percent}%)`} value={p.total.taxAmount} />
                ) : null}
                <div class="!mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
                  <dt class="font-bold text-ink-900">Total</dt>
                  <dd>
                    <Money value={p.total.total} class="text-xl font-black text-ink-900" />
                  </dd>
                </div>
              </dl>
              <p class="mt-2 text-xs text-ink-400">
                Nominal akhir dihitung ulang oleh sistem saat pesanan dikirim.
              </p>
            </Card>
          ) : null}

          {/* Data pelanggan ------------------------------------------------ */}
          <Card>
            <h3 class="mb-3 text-sm font-bold text-ink-800">Data Anda</h3>
            <div class="space-y-3">
              <Field label="Nama">
                <Input
                  value={p.nama}
                  onInput={(e) => p.onNama((e.target as HTMLInputElement).value)}
                  placeholder="Nama Anda"
                />
              </Field>
              <Field label="Email" hint="Opsional — struk digital dikirim ke sini">
                <Input
                  type="email"
                  value={p.email}
                  onInput={(e) => p.onEmail((e.target as HTMLInputElement).value)}
                  placeholder="nama@email.com"
                />
              </Field>
              <Field label="Catatan untuk dapur">
                <Textarea
                  value={p.catatan}
                  onInput={(e) => p.onCatatanUmum((e.target as HTMLTextAreaElement).value)}
                  rows={2}
                  placeholder="Mis. pesanan untuk 4 orang, tolong bertahap"
                />
              </Field>
            </div>
          </Card>

          {/* Metode bayar -------------------------------------------------- */}
          <Card>
            <h3 class="mb-3 text-sm font-bold text-ink-800">Cara bayar</h3>
            <div class="space-y-2">
              {qrisAda ? (
                <PilihanBayar
                  aktif={p.metode === 'qris_static'}
                  onClick={() => p.onMetode('qris_static')}
                  icon="qr"
                  judul="QRIS"
                  keterangan="Scan QR — nominal terisi otomatis"
                />
              ) : null}
              <PilihanBayar
                aktif={p.metode === 'cash'}
                onClick={() => p.onMetode('cash')}
                icon="banknote"
                judul="Bayar di kasir"
                keterangan="Tunai atau kartu, saat mengambil pesanan"
              />
            </div>
          </Card>

          {p.galat ? (
            <div class="rounded-lg border border-cancelled/30 bg-cancelled-bg px-4 py-3 text-sm font-semibold text-cancelled">
              {p.galat}
            </div>
          ) : null}
        </div>

        <footer class="border-t border-ink-200 bg-white px-5 py-4">
          <Button
            variant="primary"
            size="lg"
            icon="check"
            loading={p.kirim}
            disabled={p.baris.length === 0}
            onClick={p.onKirim}
            class="w-full"
          >
            Kirim pesanan{p.total ? ` · ${formatRupiah(p.total.total)}` : ''}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function PilihanBayar({
  aktif,
  onClick,
  icon,
  judul,
  keterangan,
}: {
  aktif: boolean;
  onClick: () => void;
  icon: 'qr' | 'banknote';
  judul: string;
  keterangan: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={[
        'tap flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
        aktif ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:bg-ink-50',
      ].join(' ')}
    >
      <span
        class={[
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          aktif ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600',
        ].join(' ')}
      >
        <Icon name={icon} size={18} />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-bold text-ink-900">{judul}</span>
        <span class="block text-sm text-ink-500">{keterangan}</span>
      </span>
      {aktif ? <Icon name="check" size={18} class="shrink-0 text-brand-600" /> : null}
    </button>
  );
}

/* ==========================================================================
   Pelacakan
   ========================================================================= */

function Pelacakan({
  order,
  settings,
  onBaru,
}: {
  order: Order;
  settings: StoreSettings;
  onBaru: () => void;
}) {
  const langkah = Math.max(0, ORDER_FLOW.indexOf(order.status));

  return (
    <div class="flex min-h-dvh flex-col bg-ink-50">
      <header class="bg-ink-950 px-5 py-6 text-center text-white">
        <p class="text-sm text-ink-400">{settings.name}</p>
        <h1 class="mt-1 text-xl font-extrabold">Pesanan terkirim</h1>
        {order.queueNumber ? (
          <p class="num mt-4 text-5xl leading-none font-black text-brand-400">
            {order.queueNumber}
          </p>
        ) : null}
        <p class="mt-2 text-sm text-ink-400">{order.code}</p>
      </header>

      <main class="flex-1 space-y-4 px-5 py-5">
        <Card>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink-800">Status</h2>
            <StatusBadge status={order.status} />
          </div>

          <ol class="space-y-3">
            {ORDER_FLOW.map((step, i) => {
              const selesai = i <= langkah;
              return (
                <li key={step} class="flex items-center gap-3">
                  <span
                    class={[
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      selesai ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500',
                    ].join(' ')}
                  >
                    {selesai ? <Icon name="check" size={15} /> : i + 1}
                  </span>
                  <span
                    class={[
                      'font-semibold',
                      selesai ? 'text-ink-900' : 'text-ink-400',
                    ].join(' ')}
                  >
                    {LABEL_LANGKAH[step] ?? step}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card>
          <h2 class="mb-3 text-sm font-bold text-ink-800">Rincian</h2>
          <ul class="divide-y divide-ink-100">
            {order.items.map((it, i) => (
              <li key={`${it.menuId}-${i}`} class="flex items-start justify-between gap-3 py-2.5">
                <span class="min-w-0 flex-1">
                  <span class="font-semibold text-ink-900">
                    {it.qty}× {it.name}
                  </span>
                  {it.notes ? (
                    <span class="block text-sm text-ink-500 italic">{it.notes}</span>
                  ) : null}
                </span>
                <Money value={it.price * it.qty} class="shrink-0 font-semibold text-ink-800" />
              </li>
            ))}
          </ul>
          <div class="mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
            <span class="font-bold text-ink-900">Total</span>
            <Money value={order.payment.amountDue} class="text-xl font-black text-ink-900" />
          </div>
          <p class="mt-2 text-sm text-ink-600">
            {order.payment.status === 'paid'
              ? 'Sudah dibayar. Terima kasih!'
              : order.payment.method === 'qris_static'
                ? 'Tunjukkan halaman ini di kasir untuk membayar dengan QRIS.'
                : 'Silakan bayar di kasir saat mengambil pesanan.'}
          </p>
        </Card>
      </main>

      <footer class="px-5 pb-8">
        <Button variant="outline" size="md" icon="plus" onClick={onBaru} class="w-full">
          Pesan lagi
        </Button>
      </footer>
    </div>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

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
