/**
 * Entry surface pesan-sendiri (pelanggan).
 *
 * Halaman ini dibuka dari QR yang tertempel di meja, dengan token di URL:
 *   /order/?t=<qrToken>
 *
 * Token itu yang menentukan meja mana yang dipesan. Tanpa token, pelanggan
 * tidak bisa memesan — halaman hanya menampilkan petunjuk untuk scan QR.
 *
 * Token dipakai, bukan nomor meja, supaya orang tidak bisa memesan ke meja
 * lain hanya dengan menebak angka di URL.
 */

import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import '../../styles/app.css';
import { ErrorBlock, LoadingBlock } from '../../ui/components.tsx';
import { getRepository } from '../../data/index.ts';
import { loadRepository } from '../../data/load.ts';
import type { DiningTable, Order, OrderItem } from '../../domain/types.ts';
import {
  bootstrapOrder,
  categories,
  connectRealtime,
  loadCatalog,
  lastError,
  loading,
  menus,
  settings,
  storeId,
} from '../../state/store.ts';
import { OrderApp } from './OrderApp.tsx';

function tokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  // `t` untuk pendek (URL di QR harus ringkas). `table` diterima juga supaya
  // tautan lama tetap jalan.
  return (params.get('t') ?? params.get('table') ?? '').trim();
}

/**
 * Kunci idempoten untuk satu niat pesan.
 *
 * `crypto.randomUUID` hanya ada di konteks aman (https atau localhost). Di
 * http biasa ia tidak ada, jadi ada cadangan sederhana — yang penting
 * nilainya unik, bukan tidak bisa ditebak.
 */
function newClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function App() {
  const [table, setTable] = useState<DiningTable | null>(null);
  const [tokenSelesai, setTokenSelesai] = useState(false);
  const [submitted, setSubmitted] = useState<Order | null>(null);
  // Satu kunci per niat pesan. Kalau pelanggan menekan "Kirim" dua kali karena
  // jaringannya lambat, kiriman kedua mengembalikan order yang SAMA — bukan
  // membuat pesanan kedua yang tidak pernah dipesan.
  const [clientKey, setClientKey] = useState(newClientKey);

  const token = tokenFromUrl();

  /* --- Muat awal -------------------------------------------------------- */

  useEffect(() => {
    void (async () => {
      await bootstrapOrder();

      if (token) {
        try {
          const t = await getRepository().getTableByToken(token);
          setTable(t);
        } catch {
          setTable(null);
        }
      }
      setTokenSelesai(true);
    })();
  }, [token]);

  /* --- Lacak pesanan yang sudah dikirim --------------------------------- */

  const segarkanPesanan = useCallback(async () => {
    if (!submitted) return;
    const segar = await getRepository().getOrder(submitted.id);
    if (segar) setSubmitted(segar);
  }, [submitted]);

  useEffect(() => {
    return connectRealtime({
      onOrders: () => void segarkanPesanan(),
      onSettings: () => void loadCatalog(),
    });
  }, [segarkanPesanan]);

  /* --- Kirim ------------------------------------------------------------ */

  async function kirim(input: {
    items: OrderItem[];
    customerName: string;
    customerEmail: string;
    customerNotes: string;
    paymentMethod: 'qris_static' | 'cash';
  }): Promise<Order> {
    if (!table) throw new Error('Meja tidak dikenali — scan ulang QR di meja Anda.');

    const order = await getRepository().createOrder({
      storeId: storeId.value,
      channel: 'self_order',
      tableNumber: table.number,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerNotes: input.customerNotes,
      cashierName: '',
      items: input.items,
      discount: { type: 'none', value: 0 },
      paymentMethod: input.paymentMethod,
      clientKey,
    });

    setSubmitted(order);
    return order;
  }

  /* --- Render ----------------------------------------------------------- */

  const s = settings.value;

  if (!tokenSelesai || (loading.value && s === null)) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-50">
        <LoadingBlock label="Menyiapkan menu…" />
      </div>
    );
  }

  if (lastError.value && s === null) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-50 p-6">
        <ErrorBlock message={lastError.value} onRetry={() => void bootstrapOrder()} />
      </div>
    );
  }

  if (!s) return null;

  return (
    <OrderApp
      settings={s}
      categories={categories.value}
      menus={menus.value}
      table={table}
      onSubmit={kirim}
      submitted={submitted}
      onNewOrder={() => {
        setSubmitted(null);
        setClientKey(newClientKey());
      }}
    />
  );
}

const root = document.getElementById('app');
if (root) {
  await loadRepository();
  render(<App />, root);
}
