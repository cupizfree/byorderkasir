/**
 * Layar Pelanggan.
 *
 * Tablet yang menghadap pelanggan di meja kasir. Menampilkan rincian pesanan
 * dan statusnya saat itu juga.
 *
 * Yang berbeda dari aplikasi aslinya:
 *
 *  - **QRIS dinamis.** Kalau toko punya QRIS statis, nominalnya disisipkan
 *    otomatis (lihat `domain/qris.ts`), jadi pelanggan tidak mengetik nominal
 *    dan tidak bisa salah ketik. Aplikasi aslinya hanya menampilkan gambar
 *    QRIS statis.
 *  - **Status dari data, bukan dari panggilan sesaat.** Layar ini membaca
 *    status order yang tersimpan, jadi tablet yang baru dinyalakan langsung
 *    menampilkan keadaan terkini.
 */

import { useMemo } from 'preact/hooks';

import { formatRupiah } from '../../domain/money.ts';
import { ORDER_FLOW, isPaid } from '../../domain/orders.ts';
import { QrisError, qrisWithAmount } from '../../domain/qris.ts';
import { formatTime } from '../../domain/time.ts';
import type { Order, PaymentMethod, StoreSettings } from '../../domain/types.ts';
import { Badge, Card, Money, StatusBadge } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { QrCode } from '../../ui/QrCode.tsx';

/* ==========================================================================
   Label
   ========================================================================= */

const LABEL_METODE: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris_gateway: 'QRIS (otomatis)',
  qris_static: 'QRIS',
  transfer: 'Transfer bank',
  debit: 'Kartu debit',
  split: 'Bayar gabungan',
};

const LABEL_LANGKAH: Record<string, string> = {
  pending: 'Pesanan diterima',
  processing: 'Sedang disiapkan',
  ready: 'Siap diambil',
  completed: 'Selesai',
};

/* ==========================================================================
   Papan
   ========================================================================= */

export interface DisplayBoardProps {
  order: Order | null;
  settings: StoreSettings;
}

export function DisplayBoard({ order, settings }: DisplayBoardProps) {
  if (!order) return <IdleScreen settings={settings} />;
  return <OrderScreen order={order} settings={settings} />;
}

/* ==========================================================================
   Mode siaga
   ========================================================================= */

function IdleScreen({ settings }: { settings: StoreSettings }) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center bg-ink-950 px-8 text-center text-white">
      <div class="flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-600">
        <Icon name="coffee" size={40} />
      </div>
      <h1 class="mt-6 text-4xl font-extrabold tracking-tight">{settings.name}</h1>
      {settings.tagline ? (
        <p class="mt-2 text-lg text-ink-400">{settings.tagline}</p>
      ) : null}
      <p class="mt-10 text-sm font-semibold tracking-[0.25em] text-ink-500 uppercase">
        Menunggu pesanan
      </p>
    </div>
  );
}

/* ==========================================================================
   Pesanan
   ========================================================================= */

function OrderScreen({ order, settings }: { order: Order; settings: StoreSettings }) {
  const lunas = isPaid(order.payment);
  const langkahSekarang = Math.max(0, ORDER_FLOW.indexOf(order.status));

  /**
   * QRIS dinamis: sisipkan nominal ke payload statis toko.
   *
   * Kalau payload belum diisi atau tidak terbaca, layar tetap tampil — hanya
   * tanpa QR, dan pelanggan diminta membayar di kasir. Jangan sampai satu QR
   * yang gagal membuat seluruh layar kosong.
   */
  const qr = useMemo(() => {
    const statis = settings.payments.qrisStatic;
    if (lunas) return null;
    // Order yang dibatalkan tidak boleh menampilkan QR pembayaran.
    if (order.status === 'cancelled') return null;
    if (order.payment.method !== 'qris_static' && order.payment.method !== 'qris_gateway') return null;
    if (!statis.payload) return null;

    try {
      return qrisWithAmount(statis.payload, order.payment.amountDue);
    } catch (err) {
      if (err instanceof QrisError) return null;
      throw err;
    }
  }, [
    lunas,
    order.status,
    order.payment.method,
    order.payment.amountDue,
    settings.payments.qrisStatic.payload,
  ]);

  return (
    <div class="flex min-h-dvh flex-col bg-ink-100">
      {/* ---------------------------------------------------------------- */}
      <header class="bg-ink-950 px-6 py-4 text-white">
        <div class="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <p class="text-sm text-ink-400">{settings.name}</p>
            <h1 class="text-xl font-extrabold tracking-tight">Pesanan Anda</h1>
          </div>
          <div class="text-right">
            {order.queueNumber ? (
              <p class="num text-4xl leading-none font-black text-brand-400">{order.queueNumber}</p>
            ) : null}
            <p class="mt-1 text-xs text-ink-400">
              {order.code} · {formatTime(order.createdAt)}
            </p>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      <main class="mx-auto w-full max-w-4xl flex-1 space-y-4 px-6 py-6">
        {/* Peringatan pembatalan ------------------------------------------- */}
        {order.status === 'cancelled' ? (
          <div class="flex items-center gap-3 rounded-lg border border-cancelled/30 bg-cancelled-bg px-5 py-4">
            <Icon name="alert" size={22} class="text-cancelled" />
            <div>
              <p class="font-bold text-cancelled">Pesanan dibatalkan</p>
              <p class="text-sm text-cancelled/80">
                {order.cancelReason ? `Alasan: ${order.cancelReason}` : 'Silakan tanya kasir.'}
              </p>
            </div>
          </div>
        ) : null}

        {/* Langkah status -------------------------------------------------- */}
        <Card>
          <ol class="flex items-center gap-1">
            {ORDER_FLOW.map((step, i) => {
              const selesai = i <= langkahSekarang;
              const aktif = i === langkahSekarang;
              return (
                <li key={step} class="flex flex-1 flex-col items-center gap-2 text-center">
                  <span
                    class={[
                      'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors',
                      selesai ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500',
                      aktif ? 'ring-4 ring-brand-200' : '',
                    ].join(' ')}
                  >
                    {selesai && !aktif ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span
                    class={[
                      'text-xs leading-tight font-semibold',
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

        {/* Rincian --------------------------------------------------------- */}
        <Card>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink-800">Rincian</h2>
            <StatusBadge status={order.status} />
          </div>

          <ul class="divide-y divide-ink-100">
            {order.items.map((item, i) => (
              <li key={`${item.menuId}-${i}`} class="flex items-start gap-3 py-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-100 text-sm font-bold text-ink-700">
                  {item.qty}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-ink-900">{item.name}</p>
                  {item.notes ? (
                    <p class="mt-0.5 text-sm text-ink-500 italic">Catatan: {item.notes}</p>
                  ) : null}
                  {item.qty > 1 ? (
                    <p class="mt-0.5 text-xs text-ink-400">
                      {item.qty} × {formatRupiah(item.price)}
                    </p>
                  ) : null}
                </div>
                <Money value={item.price * item.qty} class="shrink-0 font-semibold text-ink-900" />
              </li>
            ))}
          </ul>
        </Card>

        {/* Pembayaran ------------------------------------------------------ */}
        <Card>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink-800">Pembayaran</h2>
            {lunas ? (
              <Badge tone="done">
                <Icon name="check" size={12} /> Lunas
              </Badge>
            ) : (
              <Badge tone="pending">Belum dibayar</Badge>
            )}
          </div>

          <dl class="space-y-1.5 text-sm">
            <Baris label="Subtotal" value={order.subtotal} />
            {order.discountAmount > 0 ? (
              <Baris
                label={`Diskon${order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}`}
                value={-order.discountAmount}
              />
            ) : null}
            {order.serviceAmount > 0 ? (
              <Baris label="Biaya layanan" value={order.serviceAmount} />
            ) : null}
            {order.taxAmount > 0 ? (
              <Baris label={`Pajak (${order.taxPercent}%)`} value={order.taxAmount} />
            ) : null}
            {order.payment.uniqueCode > 0 ? (
              <Baris label="Kode unik" value={order.payment.uniqueCode} />
            ) : null}

            <div class="!mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
              <dt class="text-base font-bold text-ink-900">Total</dt>
              <dd>
                <Money value={order.payment.amountDue} class="text-2xl font-black text-ink-900" />
              </dd>
            </div>
          </dl>

          <p class="mt-3 text-sm text-ink-600">
            Metode: <span class="font-semibold text-ink-800">{LABEL_METODE[order.payment.method]}</span>
          </p>

          {/* QRIS ---------------------------------------------------------- */}
          {qr ? (
            <div class="mt-4 flex flex-col items-center gap-3 rounded-lg border border-ink-200 bg-surface p-5">
              <QrCode value={qr.payload} size={230} label={`QRIS ${formatRupiah(qr.amount)}`} />
              <div class="text-center">
                <p class="text-xs font-semibold tracking-wider text-ink-500 uppercase">
                  Scan untuk membayar
                </p>
                <Money value={qr.amount} class="mt-1 block text-2xl font-black text-ink-900" />
                <p class="mt-1 text-sm text-ink-500">{qr.merchantName}</p>
              </div>
              <p class="text-center text-xs text-ink-400">
                Nominal sudah terisi otomatis — pastikan angka di aplikasi sama dengan di atas.
              </p>
            </div>
          ) : null}

          {!lunas && !qr ? (
            <p class="mt-4 rounded-md bg-ink-100 px-4 py-3 text-center text-sm font-semibold text-ink-700">
              Silakan lanjutkan pembayaran di kasir
            </p>
          ) : null}
        </Card>
      </main>

      {/* ---------------------------------------------------------------- */}
      <footer class="px-6 pb-6">
        <p class="text-center text-xs text-ink-500">{settings.receipt.customerFooter}</p>
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
