/**
 * Daftar order untuk kasir.
 *
 * Menampilkan order hari ini dengan aksi yang paling sering dibutuhkan:
 * menandai lunas, memanggil antrian, mengirim ke layar pelanggan, dan
 * membatalkan.
 *
 * Yang berbeda dari aplikasi aslinya: aksi yang tidak sah tidak ditawarkan
 * sejak awal (order yang sudah dibatalkan tidak punya tombol "lunas"), bukan
 * ditolak setelah diklik.
 */

import { useMemo, useState } from 'preact/hooks';

import { canCallQueue, canCancel, isPaid } from '../../domain/orders.ts';
import { formatRupiah } from '../../domain/money.ts';
import { formatTime, humanizeDuration } from '../../domain/time.ts';
import type { Order, OrderStatus } from '../../domain/types.ts';
import { Badge, Button, Card, EmptyState, Input, Money, StatusBadge } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';

type Saringan = 'semua' | 'aktif' | 'belum_bayar' | 'selesai';

const LABEL_SARINGAN: Record<Saringan, string> = {
  semua: 'Semua',
  aktif: 'Aktif',
  belum_bayar: 'Belum bayar',
  selesai: 'Selesai',
};

const STATUS_AKTIF: OrderStatus[] = ['pending', 'processing', 'ready'];

export interface OrdersViewProps {
  orders: readonly Order[];
  onPay: (orderId: string, amountPaid: number) => Promise<void>;
  onCall: (orderId: string) => Promise<void>;
  onDisplay: (orderId: string | null) => Promise<void>;
  onCancel: (orderId: string, reason: string) => Promise<void>;
  onPrint: (order: Order) => void;
  displayOrderId: string | null;
}

export function OrdersView({
  orders,
  onPay,
  onCall,
  onDisplay,
  onCancel,
  onPrint,
  displayOrderId,
}: OrdersViewProps) {
  const [saringan, setSaringan] = useState<Saringan>('aktif');
  const [cari, setCari] = useState('');
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [batalUntuk, setBatalUntuk] = useState<Order | null>(null);
  const [alasan, setAlasan] = useState('');
  const [sekarang] = useState(() => Date.now());

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return orders
      .filter((o) => {
        switch (saringan) {
          case 'aktif':
            return STATUS_AKTIF.includes(o.status);
          case 'belum_bayar':
            return !isPaid(o.payment) && o.status !== 'cancelled';
          case 'selesai':
            return o.status === 'completed' || o.status === 'cancelled';
          default:
            return true;
        }
      })
      .filter((o) => {
        if (!q) return true;
        return (
          o.code.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          (o.queueNumber ?? '').toLowerCase().includes(q) ||
          String(o.tableNumber ?? '').includes(q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, saringan, cari]);

  const ringkas = useMemo(() => {
    const aktif = orders.filter((o) => STATUS_AKTIF.includes(o.status));
    const belumBayar = orders.filter((o) => !isPaid(o.payment) && o.status !== 'cancelled');
    const lunas = orders.filter((o) => isPaid(o.payment) && o.status !== 'cancelled');
    return {
      aktif: aktif.length,
      belumBayar: belumBayar.length,
      nilaiBelumBayar: belumBayar.reduce((s, o) => s + o.payment.amountDue, 0),
      omzet: lunas.reduce((s, o) => s + o.payment.amountPaid, 0),
    };
  }, [orders]);

  async function jalankan(id: string, fn: () => Promise<void>) {
    setSibuk(id);
    try {
      await fn();
    } finally {
      setSibuk(null);
    }
  }

  return (
    <div class="space-y-4 p-4">
      {/* Ringkasan --------------------------------------------------------- */}
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KotakRingkas label="Order aktif" nilai={String(ringkas.aktif)} icon="inbox" />
        <KotakRingkas label="Belum dibayar" nilai={String(ringkas.belumBayar)} icon="wallet" tone="pending" />
        <KotakRingkas
          label="Nilai belum bayar"
          nilai={formatRupiah(ringkas.nilaiBelumBayar)}
          icon="banknote"
          tone="pending"
        />
        <KotakRingkas label="Omzet lunas" nilai={formatRupiah(ringkas.omzet)} icon="chart" tone="done" />
      </div>

      {/* Saringan ---------------------------------------------------------- */}
      <div class="flex flex-wrap items-center gap-2">
        {(Object.keys(LABEL_SARINGAN) as Saringan[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSaringan(s)}
            class={[
              'rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors',
              saringan === s
                ? 'bg-brand-600 text-white'
                : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100',
            ].join(' ')}
          >
            {LABEL_SARINGAN[s]}
          </button>
        ))}
        <div class="relative ml-auto w-full max-w-xs">
          <Icon
            name="search"
            size={16}
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            value={cari}
            onInput={(e) => setCari((e.target as HTMLInputElement).value)}
            placeholder="Cari kode, nama, meja…"
            class="w-full rounded-lg border border-ink-200 bg-white py-2 pr-3 pl-9 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Daftar ------------------------------------------------------------ */}
      {daftar.length === 0 ? (
        <Card>
          <EmptyState icon="inbox" title="Tidak ada order" description="Coba ubah saringan atau kata kunci." />
        </Card>
      ) : (
        <div class="space-y-2">
          {daftar.map((o) => {
            const lunas = isPaid(o.payment);
            const diLayar = displayOrderId === o.id;
            return (
              <Card key={o.id} class="!p-3">
                <div class="flex flex-wrap items-start gap-3">
                  {/* Identitas -------------------------------------------- */}
                  <div class="w-20 shrink-0 text-center">
                    <p class="num text-xl leading-none font-black text-ink-900">
                      {o.queueNumber ?? '—'}
                    </p>
                    <p class="mt-1 text-[10px] text-ink-500">{formatTime(o.createdAt)}</p>
                  </div>

                  <div class="min-w-[160px] flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-bold text-ink-900">{o.code}</span>
                      <StatusBadge status={o.status} />
                      {lunas ? (
                        <Badge tone="done">
                          <Icon name="check" size={11} /> Lunas
                        </Badge>
                      ) : (
                        <Badge tone="pending">Belum bayar</Badge>
                      )}
                      {diLayar ? <Badge tone="brand">Di layar</Badge> : null}
                    </div>

                    <p class="mt-1 text-sm text-ink-600">
                      {o.tableNumber === null ? 'Kasir' : `Meja ${o.tableNumber}`}
                      {o.customerName ? ` · ${o.customerName}` : ''}
                      {o.cashierName ? ` · kasir ${o.cashierName}` : ''}
                      {' · '}
                      {humanizeDuration(sekarang - Date.parse(o.createdAt))} lalu
                    </p>

                    <p class="mt-1 line-clamp-2 text-xs text-ink-500">
                      {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                    </p>
                  </div>

                  {/* Nominal --------------------------------------------- */}
                  <div class="shrink-0 text-right">
                    <Money
                      value={lunas ? o.payment.amountPaid : o.payment.amountDue}
                      class="block text-lg font-black text-ink-900"
                    />
                    <p class="text-[10px] text-ink-500">
                      {lunas ? 'diterima' : 'tagihan'}
                    </p>
                  </div>

                  {/* Aksi ------------------------------------------------ */}
                  <div class="flex shrink-0 flex-wrap gap-1.5">
                    {!lunas && o.status !== 'cancelled' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        icon="check"
                        loading={sibuk === o.id}
                        onClick={() => void jalankan(o.id, () => onPay(o.id, o.payment.amountDue))}
                      >
                        Lunas
                      </Button>
                    ) : null}

                    {canCallQueue(o.status) ? (
                      <Button
                        variant={o.callCount > 0 ? 'secondary' : 'outline'}
                        size="sm"
                        icon="bell"
                        onClick={() => void jalankan(o.id, () => onCall(o.id))}
                      >
                        {o.callCount > 0 ? `Panggil (${o.callCount})` : 'Panggil'}
                      </Button>
                    ) : null}

                    {STATUS_AKTIF.includes(o.status) ? (
                      <Button
                        variant={diLayar ? 'secondary' : 'outline'}
                        size="sm"
                        icon="table"
                        onClick={() =>
                          void jalankan(o.id, () => onDisplay(diLayar ? null : o.id))
                        }
                      >
                        {diLayar ? 'Tutup layar' : 'Ke layar'}
                      </Button>
                    ) : null}

                    <Button
                      variant="outline"
                      size="sm"
                      icon="printer"
                      onClick={() => onPrint(o)}
                      aria-label="Cetak struk"
                    />

                    {canCancel(o.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="x"
                        onClick={() => {
                          setBatalUntuk(o);
                          setAlasan('');
                        }}
                        aria-label="Batalkan"
                      />
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pembatalan -------------------------------------------------------- */}
      {batalUntuk ? (
        <div
          class="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/60 p-4"
          onClick={() => setBatalUntuk(null)}
        >
          <Card class="anim-pop w-full max-w-sm" onClick={(e: Event) => e.stopPropagation()}>
            <h3 class="font-bold text-ink-900">Batalkan {batalUntuk.code}?</h3>
            <p class="mt-1 text-sm text-ink-600">
              Order yang dibatalkan tidak bisa dikembalikan. Alasan dicatat untuk laporan.
            </p>
            <Input
              value={alasan}
              onInput={(e) => setAlasan((e.target as HTMLInputElement).value)}
              placeholder="Alasan (mis. pelanggan pergi)"
              class="mt-3"
            />
            <div class="mt-4 flex gap-2">
              <Button variant="outline" size="md" onClick={() => setBatalUntuk(null)} class="flex-1">
                Batal
              </Button>
              <Button
                variant="danger"
                size="md"
                icon="trash"
                loading={sibuk === batalUntuk.id}
                onClick={() =>
                  void jalankan(batalUntuk.id, async () => {
                    await onCancel(batalUntuk.id, alasan.trim() || 'Tanpa alasan');
                    setBatalUntuk(null);
                  })
                }
                class="flex-1"
              >
                Batalkan order
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

function KotakRingkas({
  label,
  nilai,
  icon,
  tone = 'neutral',
}: {
  label: string;
  nilai: string;
  icon: 'inbox' | 'wallet' | 'banknote' | 'chart';
  tone?: 'neutral' | 'pending' | 'done';
}) {
  const warna = {
    neutral: 'bg-ink-100 text-ink-700',
    pending: 'bg-pending-bg text-pending',
    done: 'bg-done-bg text-done',
  }[tone];

  return (
    <Card class="!p-4">
      <div class="flex items-center gap-3">
        <span class={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', warna].join(' ')}>
          <Icon name={icon} size={18} />
        </span>
        <span class="min-w-0">
          <span class="block text-xs font-semibold text-ink-500">{label}</span>
          <span class="block truncate text-lg font-black text-ink-900">{nilai}</span>
        </span>
      </div>
    </Card>
  );
}
