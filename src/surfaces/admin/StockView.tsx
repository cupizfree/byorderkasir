/**
 * Layar stok: peringatan bahan menipis + riwayat pergerakan.
 *
 * Aplikasi aslinya menyimpan satu angka `stock` per menu dan menurunkannya
 * saat order dibuat — tanpa jejak apa pun. Akibatnya pertanyaan paling dasar
 * saat operasional tidak bisa dijawab: kenapa stok berkurang 5 padahal
 * penjualannya 3? Tidak ada cara mengetahuinya, karena yang tersisa hanya
 * angka akhirnya.
 *
 * Di sini setiap perubahan punya barisnya sendiri: siapa, kapan, berapa,
 * karena apa, dan saldonya jadi berapa. Peringatan menipis dihitung dari
 * angka yang sama, jadi tidak ada dua kebenaran.
 */

import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Button, Card, EmptyState, Field, Input, SectionTitle, Select } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import type { StockMovementInput } from '../../data/repository.ts';
import {
  STOCK_REASONS,
  stockDirectionLabel,
  stockLevel,
  stockLevelLabel,
  stockReasonLabel,
} from '../../domain/stock.ts';
import { formatTime } from '../../domain/time.ts';
import type { Menu, StockMovement, StockReason, StoreSettings } from '../../domain/types.ts';

export interface StockViewProps {
  menus: readonly Menu[];
  movements: readonly StockMovement[];
  settings: StoreSettings;
  /** Nama tampilan pencatat — ikut tersimpan di riwayat. */
  actor: string;
  /** Boleh mencatat pergerakan atau tidak (juri masak boleh, juru masak lihat saja). */
  bisaUbah: boolean;
  onRecord: (input: Omit<StockMovementInput, 'storeId'>) => Promise<{ tertunda: boolean }>;
}

const TONE: Record<string, string> = {
  habis: 'border-cancelled/40 bg-cancelled/5',
  menipis: 'border-pending/40 bg-pending/5',
  aman: 'border-ink-200 bg-white',
};

export function StockView({
  menus,
  movements,
  settings,
  actor,
  bisaUbah,
  onRecord,
}: StockViewProps) {
  const ambang = settings.stock.lowStockThreshold;

  const dilacak = useMemo(() => menus.filter((m) => m.stock !== null), [menus]);

  const perhatian = useMemo(
    () =>
      dilacak
        .filter((m) => stockLevel(m, ambang) === 'habis' || stockLevel(m, ambang) === 'menipis')
        .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)),
    [dilacak, ambang],
  );

  const habis = perhatian.filter((m) => stockLevel(m, ambang) === 'habis').length;

  return (
    <div class="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div>
        <SectionTitle>Riwayat stok</SectionTitle>
        <p class="-mt-1 mb-1 text-sm text-ink-500">
          Peringatan muncul saat stok mencapai {ambang} atau kurang.
        </p>
      </div>

      {/* Ringkasan -------------------------------------------------------- */}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Ringkas label="Menu dilacak" nilai={String(dilacak.length)} catatan="dari total menu" />
        <Ringkas
          label="Habis"
          nilai={String(habis)}
          catatan={habis > 0 ? 'tidak bisa dipesan' : 'semua tersedia'}
          tone={habis > 0 ? 'bahaya' : 'netral'}
        />
        <Ringkas
          label="Menipis"
          nilai={String(perhatian.length - habis)}
          catatan={`stok ≤ ${ambang}`}
          tone={perhatian.length - habis > 0 ? 'hati' : 'netral'}
        />
        <Ringkas
          label="Pergerakan tercatat"
          nilai={String(movements.length)}
          catatan={movements[0] ? `terakhir ${formatTime(movements[0].at)}` : 'belum ada'}
        />
      </div>

      <div class="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* Perlu perhatian ------------------------------------------------ */}
        <Card>
          <h2 class="mb-3 flex items-center gap-2 text-base font-bold text-ink-900">
            <Icon name="alert" size={17} class={perhatian.length > 0 ? 'text-pending' : 'text-ink-400'} />
            Perlu perhatian
            {perhatian.length > 0 ? (
              <span class="num ml-1 rounded-full bg-pending/15 px-2 py-0.5 text-xs font-bold text-pending">
                {perhatian.length}
              </span>
            ) : null}
          </h2>

          {perhatian.length === 0 ? (
            <EmptyState
              icon="check"
              title="Semua stok aman"
              description={`Tidak ada menu dengan stok di bawah ${ambang + 1}.`}
            />
          ) : (
            <ul class="divide-y divide-ink-100">
              {perhatian.map((m) => (
                <BarisPerhatian
                  key={m.id}
                  menu={m}
                  ambang={ambang}
                  bisaUbah={bisaUbah}
                  onTambah={(jumlah) =>
                    onRecord({
                      menuId: m.id,
                      delta: jumlah,
                      reason: 'restock',
                      note: 'Tambah cepat dari peringatan',
                      actor,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Catat pergerakan ---------------------------------------------- */}
        {bisaUbah ? (
          <FormPergerakan
            menus={dilacak}
            actor={actor}
            onRecord={onRecord}
          />
        ) : (
          <Card>
            <h2 class="mb-2 text-base font-bold text-ink-900">Catat pergerakan</h2>
            <p class="text-sm text-ink-500">
              Peran Anda hanya bisa melihat stok. Pencatatan dilakukan oleh kasir atau pemilik.
            </p>
          </Card>
        )}
      </div>

      {/* Riwayat ---------------------------------------------------------- */}
      <Card>
        <h2 class="mb-3 text-base font-bold text-ink-900">Riwayat pergerakan</h2>

        {movements.length === 0 ? (
          <EmptyState
            icon="box"
            title="Belum ada pergerakan"
            description="Setiap penjualan, penambahan, dan pembuangan akan tercatat di sini."
          />
        ) : (
          <div class="-mx-4 overflow-x-auto sm:-mx-5">
            <table class="w-full min-w-[640px] text-sm">
              <thead>
                <tr class="border-b border-ink-200 text-left text-xs font-bold tracking-wide text-ink-500 uppercase">
                  <th class="px-4 py-2 sm:px-5">Waktu</th>
                  <th class="px-3 py-2">Menu</th>
                  <th class="px-3 py-2">Arah</th>
                  <th class="px-3 py-2 text-right">Jumlah</th>
                  <th class="px-3 py-2 text-right">Saldo</th>
                  <th class="px-3 py-2">Alasan</th>
                  <th class="px-4 py-2 sm:px-5">Oleh</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ink-100">
                {movements.map((mv) => (
                  <tr key={mv.id} class="hover:bg-ink-50">
                    <td class="num px-4 py-2.5 whitespace-nowrap text-ink-600 sm:px-5">
                      {formatTime(mv.at)}
                    </td>
                    <td class="px-3 py-2.5 font-semibold text-ink-900">{mv.menuName}</td>
                    <td class="px-3 py-2.5">
                      <span
                        class={[
                          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold',
                          mv.delta > 0
                            ? 'bg-ready/12 text-ready'
                            : 'bg-cancelled/10 text-cancelled',
                        ].join(' ')}
                      >
                        {stockDirectionLabel(mv.delta)}
                      </span>
                    </td>
                    <td class="num px-3 py-2.5 text-right font-semibold text-ink-900">
                      {mv.delta > 0 ? `+${mv.delta}` : mv.delta}
                    </td>
                    <td class="num px-3 py-2.5 text-right text-ink-600">{mv.balance}</td>
                    <td class="px-3 py-2.5 text-ink-600">
                      {stockReasonLabel(mv.reason)}
                      {mv.note ? <span class="block text-xs text-ink-400">{mv.note}</span> : null}
                    </td>
                    <td class="px-4 py-2.5 text-ink-600 sm:px-5">{mv.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ==========================================================================
   Bagian
   ========================================================================= */

function Ringkas({
  label,
  nilai,
  catatan,
  tone = 'netral',
}: {
  label: string;
  nilai: string;
  catatan: string;
  tone?: 'netral' | 'hati' | 'bahaya';
}): JSX.Element {
  const warna =
    tone === 'bahaya' ? 'text-cancelled' : tone === 'hati' ? 'text-pending' : 'text-ink-900';
  return (
    <Card>
      <p class="text-xs font-bold tracking-wide text-ink-500 uppercase">{label}</p>
      <p class={['num mt-1 text-2xl font-bold', warna].join(' ')}>{nilai}</p>
      <p class="mt-0.5 text-xs text-ink-500">{catatan}</p>
    </Card>
  );
}

function BarisPerhatian({
  menu,
  ambang,
  bisaUbah,
  onTambah,
}: {
  menu: Menu;
  ambang: number;
  bisaUbah: boolean;
  onTambah: (jumlah: number) => Promise<{ tertunda: boolean }>;
}): JSX.Element {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const level = stockLevel(menu, ambang);
  const saran = Math.max(ambang * 2 - (menu.stock ?? 0), 1);

  async function tambah(jumlah: number): Promise<void> {
    setSibuk(true);
    setPesan(null);
    try {
      const { tertunda } = await onTambah(jumlah);
      setPesan(tertunda ? `+${jumlah} tersimpan, menunggu jaringan` : `+${jumlah} tercatat`);
    } catch (err) {
      setPesan(err instanceof Error ? err.message : 'Gagal mencatat');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <li class={['flex flex-wrap items-center gap-3 px-3 py-3', TONE[level] ?? ''].join(' ')}>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-semibold text-ink-900">{menu.name}</span>
        <span class="block text-xs text-ink-500">
          {stockLevelLabel(level)} · sisa <span class="num font-semibold">{menu.stock}</span>
          {pesan ? <span class="ml-2 font-semibold text-brand-700">{pesan}</span> : null}
        </span>
      </span>

      {bisaUbah ? (
        <span class="flex shrink-0 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={sibuk}
            onClick={() => void tambah(saran)}
            title={`Tambah ${saran} supaya kembali di atas ambang`}
          >
            +{saran}
          </Button>
          <Button variant="ghost" size="sm" disabled={sibuk} onClick={() => void tambah(1)}>
            +1
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function FormPergerakan({
  menus,
  actor,
  onRecord,
}: {
  menus: readonly Menu[];
  actor: string;
  onRecord: (input: Omit<StockMovementInput, 'storeId'>) => Promise<{ tertunda: boolean }>;
}): JSX.Element {
  const [menuId, setMenuId] = useState('');
  const [jumlah, setJumlah] = useState('1');
  const [alasan, setAlasan] = useState<StockReason>('restock');
  const [catatan, setCatatan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ nada: 'ok' | 'galat'; teks: string } | null>(null);

  const keluar = alasan === 'sale' || alasan === 'waste';
  const angka = Math.trunc(Number(jumlah));
  const sah = menuId !== '' && Number.isFinite(angka) && angka > 0;

  async function kirim(e: Event): Promise<void> {
    e.preventDefault();
    if (!sah) return;

    setSibuk(true);
    setPesan(null);
    try {
      // Arah ditentukan dari alasannya, bukan diketik terpisah — kalau
      // keduanya bisa diisi sendiri-sendiri, keduanya bisa saling bertentangan.
      const { tertunda } = await onRecord({
        menuId,
        delta: keluar ? -angka : angka,
        reason: alasan,
        note: catatan.trim(),
        actor,
      });
      setPesan({
        nada: 'ok',
        teks: tertunda
          ? 'Tersimpan di perangkat. Akan dikirim saat jaringan kembali.'
          : 'Pergerakan tercatat.',
      });
      setCatatan('');
      setJumlah('1');
    } catch (err) {
      setPesan({ nada: 'galat', teks: err instanceof Error ? err.message : 'Gagal mencatat' });
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Card>
      <h2 class="mb-3 text-base font-bold text-ink-900">Catat pergerakan</h2>

      <form class="space-y-4" onSubmit={(e) => void kirim(e)}>
        <Field label="Menu" forId="stok-menu" hint={menus.length === 0 ? 'Belum ada menu yang dilacak stoknya.' : undefined}>
          <Select
            id="stok-menu"
            value={menuId}
            disabled={menus.length === 0}
            onChange={(e) => setMenuId((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">Pilih menu…</option>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — sisa {m.stock}
              </option>
            ))}
          </Select>
        </Field>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Alasan" forId="stok-alasan">
            <Select
              id="stok-alasan"
              value={alasan}
              onChange={(e) =>
                setAlasan((e.currentTarget as HTMLSelectElement).value as StockReason)
              }
            >
              {STOCK_REASONS.map((r) => (
                <option key={r} value={r}>
                  {stockReasonLabel(r)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Jumlah"
            forId="stok-jumlah"
            hint={keluar ? 'Akan dikurangi dari stok.' : 'Akan ditambahkan ke stok.'}
          >
            <Input
              id="stok-jumlah"
              type="number"
              min="1"
              step="1"
              value={jumlah}
              onInput={(e) => setJumlah((e.currentTarget as HTMLInputElement).value)}
            />
          </Field>
        </div>

        <Field label="Catatan" forId="stok-catatan" hint="Opsional — mis. nomor nota pembelian.">
          <Input
            id="stok-catatan"
            value={catatan}
            maxLength={120}
            placeholder="mis. Belanja pasar pagi"
            onInput={(e) => setCatatan((e.currentTarget as HTMLInputElement).value)}
          />
        </Field>

        {pesan ? (
          <p
            class={[
              'rounded-md px-3 py-2 text-sm font-medium',
              pesan.nada === 'ok'
                ? 'bg-ready/10 text-ready'
                : 'bg-cancelled/10 text-cancelled',
            ].join(' ')}
          >
            {pesan.teks}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth disabled={!sah || sibuk}>
          {sibuk ? 'Menyimpan…' : 'Catat pergerakan'}
        </Button>
      </form>
    </Card>
  );
}
