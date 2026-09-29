/**
 * Kelola menu & kategori.
 *
 * Satu layar, dua panel: kategori di kiri (ringkas), menu di kanan (tabel).
 * Aplikasi lama memisahkannya jadi beberapa tab dengan banyak lapisan
 * `!important`; di sini semuanya satu alur — tambah, ubah, hapus — tanpa
 * berpindah layar.
 *
 * HPP (harga pokok) ikut ditampilkan karena itu dasar perhitungan laba di
 * analitik. Aplikasi lama menyimpannya di kolom terpisah yang tidak pernah
 * terlihat di UI.
 */

import { useMemo, useState } from 'preact/hooks';

import type { CategoryInput, MenuInput } from '../../data/repository.ts';
import { formatRupiah, parseRupiah } from '../../domain/money.ts';
import type { Category, ID, Menu } from '../../domain/types.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Money, Textarea } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { MenuThumb } from '../../ui/MenuThumb.tsx';

/* ==========================================================================
   Ikon kategori
   ========================================================================= */

const IKON_KATEGORI = ['coffee', 'cup', 'bowl', 'cookie', 'ice-cream', 'utensils', 'flame'] as const;

/* ==========================================================================
   Tampilan
   ========================================================================= */

export interface MenuViewProps {
  storeId: ID;
  categories: readonly Category[];
  menus: readonly Menu[];
  onSimpan: (input: MenuInput) => Promise<void>;
  onHapus: (id: ID) => Promise<void>;
  onKetersediaan: (id: ID, tersedia: boolean) => Promise<void>;
  onSimpanKategori: (input: CategoryInput) => Promise<void>;
  onHapusKategori: (id: ID) => Promise<void>;
}

export function MenuView(p: MenuViewProps) {
  const [kategoriAktif, setKategoriAktif] = useState<ID | 'semua'>('semua');
  const [cari, setCari] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const [menuEdit, setMenuEdit] = useState<MenuInput | null>(null);
  const [kategoriEdit, setKategoriEdit] = useState<CategoryInput | null>(null);
  const [hapusMenu, setHapusMenu] = useState<Menu | null>(null);
  const [hapusKategori, setHapusKategori] = useState<Category | null>(null);

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return p.menus
      .filter((m) => (kategoriAktif === 'semua' ? true : m.categoryId === kategoriAktif))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [p.menus, kategoriAktif, cari]);

  const namaKategori = useMemo(
    () => new Map(p.categories.map((c) => [c.id, c.name])),
    [p.categories],
  );

  const ringkas = useMemo(() => {
    const denganHpp = p.menus.filter((m) => m.costPrice > 0);
    const margin = denganHpp.length
      ? Math.round(
          (denganHpp.reduce((s, m) => s + (m.price - m.costPrice) / m.price, 0) / denganHpp.length) * 1000,
        ) / 10
      : 0;
    return {
      total: p.menus.length,
      habis: p.menus.filter((m) => !m.isAvailable).length,
      tanpaHpp: p.menus.filter((m) => m.costPrice === 0).length,
      margin,
    };
  }, [p.menus]);

  /* --- Aksi ------------------------------------------------------------- */

  async function jalankan(fn: () => Promise<void>) {
    setGalat(null);
    setSibuk(true);
    try {
      await fn();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSibuk(false);
    }
  }

  function menuBaru() {
    setMenuEdit({
      storeId: p.storeId,
      name: '',
      categoryId: p.categories[0]?.id ?? '',
      price: 0,
      costPrice: 0,
      description: '',
      imageUrl: null,
      isAvailable: true,
      stock: null,
      sortOrder: p.menus.length + 1,
    });
  }

  function kategoriBaru() {
    setKategoriEdit({
      storeId: p.storeId,
      name: '',
      icon: 'coffee',
      sortOrder: p.categories.length + 1,
      isActive: true,
    });
  }

  /* --- Render ----------------------------------------------------------- */

  return (
    <div class="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
      {/* ================================================================ */}
      {/* Kategori                                                         */}
      {/* ================================================================ */}
      <aside class="space-y-3">
        <Card class="!p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink-800">Kategori</h2>
            <Button variant="ghost" size="sm" icon="plus" onClick={kategoriBaru} aria-label="Kategori baru" />
          </div>

          <ul class="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => setKategoriAktif('semua')}
                class={[
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition',
                  kategoriAktif === 'semua'
                    ? 'bg-brand-700 text-white shadow-card'
                    : 'text-ink-700 hover:bg-ink-100',
                ].join(' ')}
              >
                Semua
                <span class="num text-xs opacity-70">{p.menus.length}</span>
              </button>
            </li>
            {p.categories.map((c) => {
              const jumlah = p.menus.filter((m) => m.categoryId === c.id).length;
              const aktif = kategoriAktif === c.id;
              return (
                <li key={c.id} class="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setKategoriAktif(c.id)}
                    class={[
                      'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
                      aktif ? 'bg-brand-700 text-white shadow-card' : 'text-ink-700 hover:bg-ink-100',
                    ].join(' ')}
                  >
                    <Icon name={c.icon as 'coffee'} size={15} class="shrink-0" />
                    <span class="truncate">{c.name}</span>
                    {!c.isActive ? (
                      <span class="text-[10px] opacity-60">nonaktif</span>
                    ) : null}
                    <span class="num ml-auto text-xs opacity-70">{jumlah}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setKategoriEdit({
                        id: c.id,
                        storeId: c.storeId,
                        name: c.name,
                        icon: c.icon,
                        sortOrder: c.sortOrder,
                        isActive: c.isActive,
                      })
                    }
                    aria-label={`Ubah ${c.name}`}
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-ink-100 hover:text-ink-700"
                  >
                    <Icon name="settings" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card class="!p-4">
          <h3 class="mb-2 text-xs font-bold tracking-wide text-ink-500 uppercase">Ringkas</h3>
          <dl class="space-y-1.5 text-sm">
            <BarisRingkas label="Total menu" nilai={String(ringkas.total)} />
            <BarisRingkas label="Sedang habis" nilai={String(ringkas.habis)} tone="pending" />
            <BarisRingkas label="Belum ada HPP" nilai={String(ringkas.tanpaHpp)} tone="pending" />
            <BarisRingkas label="Margin rata-rata" nilai={`${ringkas.margin}%`} tone="done" />
          </dl>
          {ringkas.tanpaHpp > 0 ? (
            <p class="mt-2 text-xs text-ink-500">
              Menu tanpa HPP tidak ikut dihitung labanya di analitik.
            </p>
          ) : null}
        </Card>
      </aside>

      {/* ================================================================ */}
      {/* Menu                                                             */}
      {/* ================================================================ */}
      <section class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-[200px] flex-1">
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
              class="w-full rounded-lg border border-ink-200 bg-white py-2.5 pr-3 pl-9 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <Button variant="primary" size="md" icon="plus" onClick={menuBaru} disabled={p.categories.length === 0}>
            Menu baru
          </Button>
        </div>

        {galat ? (
          <p class="rounded-lg border border-cancelled/30 bg-cancelled-bg px-3 py-2 text-sm font-semibold text-cancelled">
            {galat}
          </p>
        ) : null}

        {p.categories.length === 0 ? (
          <Card>
            <EmptyState
              icon="coffee"
              title="Buat kategori dulu"
              description="Menu harus punya kategori. Tambahkan minimal satu lewat panel kiri."
            />
          </Card>
        ) : daftar.length === 0 ? (
          <Card>
            <EmptyState icon="search" title="Tidak ada menu" description="Coba ubah kata kunci atau kategori." />
          </Card>
        ) : (
          <Card class="!p-0">
            {/* Satu grid tetap untuk judul kolom dan tiap baris, supaya semua
                kolom benar-benar lurus — sebelumnya tiap baris menyusun
                dirinya sendiri dengan `flex-wrap`, jadi harga dan stok
                bergeser-geser mengikuti panjang deskripsi.
                Kolom aksi lebarnya dipatok, bukan `auto`: dengan `auto` tiap
                baris menghitung lebarnya sendiri dari isinya, jadi judul
                kolom dan isinya tidak pernah benar-benar sejajar. */}
            <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_7rem_5rem_13rem] items-center gap-3 border-b border-ink-200 px-4 py-2 text-[11px] font-bold tracking-wide text-ink-500 uppercase">
              <span />
              <span>Menu</span>
              <span class="text-right">Harga</span>
              <span class="text-center">Stok</span>
              <span class="text-right">Aksi</span>
            </div>

            <ul class="divide-y divide-ink-100">
              {daftar.map((m) => (
                <li
                  key={m.id}
                  class="grid grid-cols-[2.75rem_minmax(0,1fr)_7rem_5rem_13rem] items-center gap-3 px-4 py-3 transition hover:bg-ink-50"
                >
                  {/* Gambar ------------------------------------------- */}
                  <MenuThumb
                    name={m.name}
                    imageUrl={m.imageUrl}
                    category={namaKategori.get(m.categoryId)}
                    size="sm"
                  />

                  {/* Nama & keterangan ---------------------------------- */}
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="truncate font-bold text-ink-900">{m.name}</span>
                      {!m.isAvailable ? <Badge tone="cancelled">Habis</Badge> : null}
                      {m.costPrice === 0 ? <Badge tone="pending">Tanpa HPP</Badge> : null}
                    </div>
                    <p class="mt-0.5 truncate text-xs text-ink-600">
                      {namaKategori.get(m.categoryId) ?? '—'}
                      {m.description ? ` · ${m.description}` : ''}
                    </p>
                  </div>

                  {/* Harga --------------------------------------------- */}
                  <div class="text-right">
                    <Money value={m.price} class="block font-bold text-ink-900" />
                    {m.costPrice > 0 ? (
                      <span class="num block text-xs text-ink-600">
                        margin{' '}
                        <span class="font-bold text-done">
                          {Math.round(((m.price - m.costPrice) / m.price) * 100)}%
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Stok ---------------------------------------------- */}
                  <div class="flex justify-center">
                    {m.stock === null ? (
                      <span
                        class="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-bold text-ink-600"
                        title="Stok tidak dilacak"
                      >
                        Bebas
                      </span>
                    ) : (
                      <span
                        class={[
                          'num rounded-md px-2 py-0.5 text-xs font-bold',
                          m.stock <= 0
                            ? 'bg-cancelled-bg text-cancelled'
                            : m.stock <= 5
                              ? 'bg-pending-bg text-pending'
                              : 'bg-done-bg text-done',
                        ].join(' ')}
                      >
                        {m.stock} sisa
                      </span>
                    )}
                  </div>

                  {/* Aksi ---------------------------------------------- */}
                  <div class="flex items-center justify-end gap-2">
                    <Button
                      variant={m.isAvailable ? 'outline' : 'primary'}
                      size="sm"
                      icon={m.isAvailable ? 'eye-off' : 'eye'}
                      loading={sibuk}
                      onClick={() => void jalankan(() => p.onKetersediaan(m.id, !m.isAvailable))}
                    >
                      {m.isAvailable ? 'Habiskan' : 'Tersedia'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      icon="settings"
                      onClick={() =>
                        setMenuEdit({
                          id: m.id,
                          storeId: m.storeId,
                          name: m.name,
                          categoryId: m.categoryId,
                          price: m.price,
                          costPrice: m.costPrice,
                          description: m.description,
                          imageUrl: m.imageUrl,
                          isAvailable: m.isAvailable,
                          stock: m.stock,
                          sortOrder: m.sortOrder,
                        })
                      }
                      aria-label={`Ubah ${m.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      onClick={() => setHapusMenu(m)}
                      aria-label={`Hapus ${m.name}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ================================================================ */}
      {/* Dialog                                                           */}
      {/* ================================================================ */}
      {menuEdit ? (
        <FormMenu
          nilai={menuEdit}
          categories={p.categories}
          sibuk={sibuk}
          onUbah={setMenuEdit}
          onTutup={() => setMenuEdit(null)}
          onSimpan={() =>
            void jalankan(async () => {
              await p.onSimpan(menuEdit);
              setMenuEdit(null);
            })
          }
        />
      ) : null}

      {kategoriEdit ? (
        <FormKategori
          nilai={kategoriEdit}
          sibuk={sibuk}
          onUbah={setKategoriEdit}
          onTutup={() => setKategoriEdit(null)}
          onSimpan={() =>
            void jalankan(async () => {
              await p.onSimpanKategori(kategoriEdit);
              setKategoriEdit(null);
            })
          }
          onHapus={
            kategoriEdit.id
              ? () => {
                  const c = p.categories.find((x) => x.id === kategoriEdit.id);
                  if (c) setHapusKategori(c);
                }
              : undefined
          }
        />
      ) : null}

      {hapusMenu ? (
        <KonfirmasiHapus
          judul={`Hapus ${hapusMenu.name}?`}
          pesan="Menu akan hilang dari daftar. Order lama tetap menyimpan nama dan harganya."
          sibuk={sibuk}
          onBatal={() => setHapusMenu(null)}
          onHapus={() =>
            void jalankan(async () => {
              await p.onHapus(hapusMenu.id);
              setHapusMenu(null);
            })
          }
        />
      ) : null}

      {hapusKategori ? (
        <KonfirmasiHapus
          judul={`Hapus kategori ${hapusKategori.name}?`}
          pesan={
            p.menus.some((m) => m.categoryId === hapusKategori.id)
              ? 'Kategori ini masih dipakai menu. Pindahkan menunya dulu.'
              : 'Kategori akan dihapus.'
          }
          sibuk={sibuk}
          onBatal={() => setHapusKategori(null)}
          onHapus={() =>
            void jalankan(async () => {
              await p.onHapusKategori(hapusKategori.id);
              setHapusKategori(null);
              setKategoriEdit(null);
            })
          }
        />
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Form menu
   ========================================================================= */

function FormMenu({
  nilai,
  categories,
  sibuk,
  onUbah,
  onTutup,
  onSimpan,
}: {
  nilai: MenuInput;
  categories: readonly Category[];
  sibuk: boolean;
  onUbah: (v: MenuInput) => void;
  onTutup: () => void;
  onSimpan: () => void;
}) {
  const sah = nilai.name.trim() !== '' && nilai.categoryId !== '' && nilai.price > 0;
  const margin =
    nilai.price > 0 && nilai.costPrice > 0
      ? Math.round(((nilai.price - nilai.costPrice) / nilai.price) * 100)
      : null;

  return (
    <Lembar judul={nilai.id ? 'Ubah menu' : 'Menu baru'} onTutup={onTutup}>
      <div class="space-y-4">
        <Field label="Nama menu">
          <Input
            value={nilai.name}
            onInput={(e) => onUbah({ ...nilai, name: (e.target as HTMLInputElement).value })}
            placeholder="Kopi Susu Senja"
            autofocus
          />
        </Field>

        <Field label="Kategori">
          <select
            value={nilai.categoryId}
            onChange={(e) => onUbah({ ...nilai, categoryId: (e.target as HTMLSelectElement).value })}
            class="w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Harga jual">
            <Input
              inputMode="numeric"
              value={nilai.price === 0 ? '' : formatRupiah(nilai.price, false)}
              onInput={(e) => onUbah({ ...nilai, price: parseRupiah((e.target as HTMLInputElement).value) })}
              placeholder="25.000"
              class="num text-right font-bold"
            />
          </Field>
          <Field label="HPP" hint="Modal per porsi">
            <Input
              inputMode="numeric"
              value={nilai.costPrice === 0 ? '' : formatRupiah(nilai.costPrice, false)}
              onInput={(e) =>
                onUbah({ ...nilai, costPrice: parseRupiah((e.target as HTMLInputElement).value) })
              }
              placeholder="12.000"
              class="num text-right"
            />
          </Field>
        </div>

        {margin !== null ? (
          <p class="rounded-lg bg-done-bg px-3 py-2 text-sm font-semibold text-done">
            Margin {margin}% · laba {formatRupiah(nilai.price - nilai.costPrice)} per porsi
          </p>
        ) : null}

        <Field label="Keterangan">
          <Textarea
            value={nilai.description}
            onInput={(e) => onUbah({ ...nilai, description: (e.target as HTMLTextAreaElement).value })}
            rows={2}
            placeholder="Signature, susu segar"
          />
        </Field>

        {/* Gambar menu. Pratinjaunya langsung berubah, jadi pemilik toko tahu
            persis apa yang akan dilihat pelanggan. */}
        <Field label="Gambar" hint="Kosongkan untuk memakai gambar otomatis">
          <div class="flex items-center gap-3">
            <MenuThumb
              name={nilai.name || 'Menu'}
              imageUrl={nilai.imageUrl}
              category={categories.find((c) => c.id === nilai.categoryId)?.name}
              size="md"
            />
            <Input
              value={nilai.imageUrl ?? ''}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.trim();
                onUbah({ ...nilai, imageUrl: v === '' ? null : v });
              }}
              placeholder="https://…/foto-menu.jpg"
              class="flex-1"
            />
          </div>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Stok" hint="Kosong = tidak dilacak">
            <Input
              inputMode="numeric"
              value={nilai.stock === null ? '' : String(nilai.stock)}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.replace(/\D/g, '');
                onUbah({ ...nilai, stock: v === '' ? null : Number(v) });
              }}
              placeholder="∞"
              class="num text-right"
            />
          </Field>
          <Field label="Urutan">
            <Input
              inputMode="numeric"
              value={String(nilai.sortOrder)}
              onInput={(e) =>
                onUbah({ ...nilai, sortOrder: Number((e.target as HTMLInputElement).value) || 0 })
              }
              class="num text-right"
            />
          </Field>
        </div>

        <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
          <input
            type="checkbox"
            checked={nilai.isAvailable}
            onChange={(e) => onUbah({ ...nilai, isAvailable: (e.target as HTMLInputElement).checked })}
            class="h-4 w-4 accent-brand-700"
          />
          <span class="text-sm font-semibold text-ink-800">Tersedia — bisa dipesan</span>
        </label>
      </div>

      <div class="mt-5 flex gap-2">
        <Button variant="outline" size="md" onClick={onTutup} class="flex-1">
          Batal
        </Button>
        <Button
          variant="primary"
          size="md"
          icon="check"
          loading={sibuk}
          disabled={!sah}
          onClick={onSimpan}
          class="flex-1"
        >
          Simpan
        </Button>
      </div>
    </Lembar>
  );
}

/* ==========================================================================
   Form kategori
   ========================================================================= */

function FormKategori({
  nilai,
  sibuk,
  onUbah,
  onTutup,
  onSimpan,
  onHapus,
}: {
  nilai: CategoryInput;
  sibuk: boolean;
  onUbah: (v: CategoryInput) => void;
  onTutup: () => void;
  onSimpan: () => void;
  onHapus?: () => void;
}) {
  return (
    <Lembar judul={nilai.id ? 'Ubah kategori' : 'Kategori baru'} onTutup={onTutup}>
      <div class="space-y-4">
        <Field label="Nama kategori">
          <Input
            value={nilai.name}
            onInput={(e) => onUbah({ ...nilai, name: (e.target as HTMLInputElement).value })}
            placeholder="Kopi"
            autofocus
          />
        </Field>

        <Field label="Ikon">
          <div class="flex flex-wrap gap-1.5">
            {IKON_KATEGORI.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => onUbah({ ...nilai, icon: ic })}
                aria-label={ic}
                class={[
                  'flex h-11 w-11 items-center justify-center rounded-lg border transition',
                  nilai.icon === ic
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-ink-200 text-ink-500 hover:bg-ink-100',
                ].join(' ')}
              >
                <Icon name={ic} size={19} />
              </button>
            ))}
          </div>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Urutan">
            <Input
              inputMode="numeric"
              value={String(nilai.sortOrder)}
              onInput={(e) =>
                onUbah({ ...nilai, sortOrder: Number((e.target as HTMLInputElement).value) || 0 })
              }
              class="num text-right"
            />
          </Field>
          <label class="flex cursor-pointer items-center gap-3 self-end rounded-lg border border-ink-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={nilai.isActive}
              onChange={(e) => onUbah({ ...nilai, isActive: (e.target as HTMLInputElement).checked })}
              class="h-4 w-4 accent-brand-700"
            />
            <span class="text-sm font-semibold text-ink-800">Aktif</span>
          </label>
        </div>
      </div>

      <div class="mt-5 flex gap-2">
        {onHapus ? (
          <Button variant="ghost" size="md" icon="trash" onClick={onHapus} aria-label="Hapus kategori" />
        ) : null}
        <Button variant="outline" size="md" onClick={onTutup} class="flex-1">
          Batal
        </Button>
        <Button
          variant="primary"
          size="md"
          icon="check"
          loading={sibuk}
          disabled={nilai.name.trim() === ''}
          onClick={onSimpan}
          class="flex-1"
        >
          Simpan
        </Button>
      </div>
    </Lembar>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

function Lembar({
  judul,
  onTutup,
  children,
}: {
  judul: string;
  onTutup: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <div class="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/55 p-0 sm:items-center sm:p-4" onClick={onTutup}>
      <Card
        class="anim-sheet max-h-[92dvh] w-full max-w-lg overflow-y-auto !rounded-b-none sm:!rounded-b-xl"
        onClick={(e: Event) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="display text-xl text-ink-900">{judul}</h3>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
          >
            <Icon name="x" size={19} />
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

function KonfirmasiHapus({
  judul,
  pesan,
  sibuk,
  onBatal,
  onHapus,
}: {
  judul: string;
  pesan: string;
  sibuk: boolean;
  onBatal: () => void;
  onHapus: () => void;
}) {
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4" onClick={onBatal}>
      <Card class="anim-pop w-full max-w-sm" onClick={(e: Event) => e.stopPropagation()}>
        <h3 class="font-bold text-ink-900">{judul}</h3>
        <p class="mt-1 text-sm text-ink-600">{pesan}</p>
        <div class="mt-4 flex gap-2">
          <Button variant="outline" size="md" onClick={onBatal} class="flex-1">
            Batal
          </Button>
          <Button variant="danger" size="md" icon="trash" loading={sibuk} onClick={onHapus} class="flex-1">
            Hapus
          </Button>
        </div>
      </Card>
    </div>
  );
}

function BarisRingkas({
  label,
  nilai,
  tone = 'neutral',
}: {
  label: string;
  nilai: string;
  tone?: 'neutral' | 'pending' | 'done';
}) {
  const warna = { neutral: 'text-ink-900', pending: 'text-pending', done: 'text-done' }[tone];
  return (
    <div class="flex items-baseline justify-between">
      <dt class="text-ink-600">{label}</dt>
      <dd class={['num font-bold', warna].join(' ')}>{nilai}</dd>
    </div>
  );
}
