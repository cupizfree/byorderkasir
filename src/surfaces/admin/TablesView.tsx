/**
 * Kelola meja & QR pesan-sendiri.
 *
 * Yang ini fitur yang tidak ada di aplikasi lama: QR meja dibangkitkan di sini
 * dan bisa langsung dicetak. Aplikasi lama hanya menyimpan tautan mentah di
 * sel spreadsheet, jadi pemilik kafe harus membuat QR sendiri di situs lain —
 * dan itu berarti token meja mereka lewat pihak ketiga.
 *
 * QR di sini dibuat lokal (lihat `domain/qr.ts`), jadi token tidak pernah
 * keluar dari sistem.
 */

import { useMemo, useState } from 'preact/hooks';

import type { TableInput } from '../../data/repository.ts';
import { qrMatrix, qrPathD, qrViewBoxSize } from '../../domain/qr.ts';
import type { DiningTable, ID } from '../../domain/types.ts';
import { Badge, Button, Card, EmptyState, Field, Input } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { QrCode } from '../../ui/QrCode.tsx';

/* ==========================================================================
   Alamat dasar
   ========================================================================== */

/**
 * Alamat yang dikodekan ke dalam QR. Diambil dari lokasi halaman supaya QR
 * yang dicetak menunjuk ke host yang benar-benar dipakai — kalau aplikasi
 * dipasang di domain sendiri, QR-nya otomatis ikut.
 */
function alamatDasar(): string {
  return `${window.location.origin}/order/`;
}

function tautanMeja(t: DiningTable): string {
  return `${alamatDasar()}?t=${encodeURIComponent(t.qrToken)}`;
}

/* ==========================================================================
   Tampilan
   ========================================================================== */

export interface TablesViewProps {
  storeId: ID;
  tables: readonly DiningTable[];
  storeName: string;
  onSimpan: (input: TableInput) => Promise<void>;
  onHapus: (id: ID) => Promise<void>;
}

export function TablesView(p: TablesViewProps) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [edit, setEdit] = useState<TableInput | null>(null);
  const [hapus, setHapus] = useState<DiningTable | null>(null);
  const [qrUntuk, setQrUntuk] = useState<DiningTable | null>(null);

  const daftar = useMemo(
    () => [...p.tables].sort((a, b) => a.number - b.number),
    [p.tables],
  );

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

  function mejaBaru() {
    const berikut = daftar.length ? Math.max(...daftar.map((t) => t.number)) + 1 : 1;
    setEdit({
      storeId: p.storeId,
      number: berikut,
      name: `Meja ${berikut}`,
      capacity: 4,
      status: 'available',
    });
  }

  /* --- Cetak QR --------------------------------------------------------- */

  function cetakQr(meja: DiningTable[]): void {
    const wadah = document.createElement('div');
    wadah.id = 'byorder-print';

    const kartu = meja
      .map(
        (t) => `
        <div class="kartu-qr">
          <div class="nama-meja">${t.name || `Meja ${t.number}`}</div>
          <div class="nama-toko">${p.storeName}</div>
          <div class="petunjuk">Scan untuk memesan dari HP</div>
          <div class="qr-slot" data-token="${t.qrToken}"></div>
          <div class="nomor">${t.number}</div>
        </div>`,
      )
      .join('');

    wadah.innerHTML = `<div class="lembar-qr">${kartu}</div>`;
    document.body.appendChild(wadah);

    // Isi slot QR dengan SVG asli (dibuat lewat komponen yang sama).
    for (const slot of wadah.querySelectorAll<HTMLElement>('.qr-slot')) {
      const token = slot.dataset.token ?? '';
      const url = `${alamatDasar()}?t=${encodeURIComponent(token)}`;
      slot.innerHTML = svgQr(url, 200);
    }

    const judulLama = document.title;
    document.title = `QR Meja — ${p.storeName}`;
    const bersihkan = () => {
      document.title = judulLama;
      document.getElementById('byorder-print')?.remove();
      window.removeEventListener('afterprint', bersihkan);
    };
    window.addEventListener('afterprint', bersihkan);
    window.print();
    window.setTimeout(bersihkan, 4000);
  }

  /* --- Render ----------------------------------------------------------- */

  return (
    <div class="space-y-4 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="display text-xl text-ink-900">Meja</h2>
          <p class="text-sm text-ink-600">
            {daftar.length} meja · tiap meja punya token sendiri, jadi orang tidak bisa memesan
            ke meja lain hanya dengan menebak angka.
          </p>
        </div>
        <div class="flex gap-2">
          {daftar.length > 0 ? (
            <Button variant="outline" size="md" icon="printer" onClick={() => cetakQr(daftar)}>
              Cetak semua QR
            </Button>
          ) : null}
          <Button variant="primary" size="md" icon="plus" onClick={mejaBaru}>
            Meja baru
          </Button>
        </div>
      </div>

      {galat ? (
        <p class="rounded-lg border border-cancelled/30 bg-cancelled-bg px-3 py-2 text-sm font-semibold text-cancelled">
          {galat}
        </p>
      ) : null}

      {daftar.length === 0 ? (
        <Card>
          <EmptyState
            icon="table"
            title="Belum ada meja"
            description="Tambahkan meja, lalu cetak QR-nya untuk ditempel."
          />
        </Card>
      ) : (
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {daftar.map((t) => (
            <Card key={t.id} class="!p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h3 class="font-bold text-ink-900">{t.name || `Meja ${t.number}`}</h3>
                  <p class="text-xs text-ink-500">
                    No. {t.number} · {t.capacity} orang
                  </p>
                </div>
                <Badge tone={t.status === 'available' ? 'done' : t.status === 'occupied' ? 'pending' : 'neutral'}>
                  {t.status === 'available' ? 'Kosong' : t.status === 'occupied' ? 'Terisi' : 'Nonaktif'}
                </Badge>
              </div>

              {/* Pratinjau QR ------------------------------------------- */}
              <button
                type="button"
                onClick={() => setQrUntuk(t)}
                class="mt-3 flex w-full items-center justify-center rounded-lg border border-ink-200 bg-white p-3 transition hover:border-brand-400 hover:bg-brand-50"
                aria-label={`Lihat QR ${t.name}`}
              >
                <QrCode value={tautanMeja(t)} size={104} label={`QR ${t.name}`} />
              </button>

              <div class="mt-3 flex gap-1.5">
                <Button variant="outline" size="sm" icon="qr" onClick={() => setQrUntuk(t)} class="flex-1">
                  QR
                </Button>
                <Button variant="outline" size="sm" icon="printer" onClick={() => cetakQr([t])} aria-label="Cetak QR" />
                <Button
                  variant="outline"
                  size="sm"
                  icon="settings"
                  onClick={() =>
                    setEdit({
                      id: t.id,
                      storeId: t.storeId,
                      number: t.number,
                      name: t.name,
                      capacity: t.capacity,
                      status: t.status,
                    })
                  }
                  aria-label="Ubah meja"
                />
                <Button variant="ghost" size="sm" icon="trash" onClick={() => setHapus(t)} aria-label="Hapus meja" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {edit ? (
        <FormMeja
          nilai={edit}
          sibuk={sibuk}
          onUbah={setEdit}
          onTutup={() => setEdit(null)}
          onSimpan={() =>
            void jalankan(async () => {
              await p.onSimpan(edit);
              setEdit(null);
            })
          }
        />
      ) : null}

      {qrUntuk ? (
        <ModalQr meja={qrUntuk} storeName={p.storeName} onTutup={() => setQrUntuk(null)} onCetak={() => cetakQr([qrUntuk])} />
      ) : null}

      {hapus ? (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4" onClick={() => setHapus(null)}>
          <Card class="anim-pop w-full max-w-sm" onClick={(e: Event) => e.stopPropagation()}>
            <h3 class="font-bold text-ink-900">Hapus {hapus.name}?</h3>
            <p class="mt-1 text-sm text-ink-600">
              QR yang sudah dicetak untuk meja ini tidak akan berlaku lagi.
            </p>
            <div class="mt-4 flex gap-2">
              <Button variant="outline" size="md" onClick={() => setHapus(null)} class="flex-1">
                Batal
              </Button>
              <Button
                variant="danger"
                size="md"
                icon="trash"
                loading={sibuk}
                onClick={() =>
                  void jalankan(async () => {
                    await p.onHapus(hapus.id);
                    setHapus(null);
                  })
                }
                class="flex-1"
              >
                Hapus
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Modal QR
   ========================================================================= */

function ModalQr({
  meja,
  storeName,
  onTutup,
  onCetak,
}: {
  meja: DiningTable;
  storeName: string;
  onTutup: () => void;
  onCetak: () => void;
}) {
  const [salin, setSalin] = useState(false);
  const url = tautanMeja(meja);

  async function salinTautan() {
    try {
      await navigator.clipboard.writeText(url);
      setSalin(true);
      window.setTimeout(() => setSalin(false), 1800);
    } catch {
      // Clipboard diblokir (bukan HTTPS / izin ditolak) — tidak fatal.
    }
  }

  return (
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/60 p-4" onClick={onTutup}>
      <Card class="anim-pop w-full max-w-sm text-center" onClick={(e: Event) => e.stopPropagation()}>
        <p class="text-xs font-bold tracking-wide text-ink-500 uppercase">{storeName}</p>
        <h3 class="display mt-1 text-2xl text-ink-900">{meja.name || `Meja ${meja.number}`}</h3>
        <p class="mt-1 text-sm text-ink-600">Scan untuk memesan dari HP</p>

        <div class="mt-4 flex justify-center rounded-xl border border-ink-200 bg-white p-4">
          <QrCode value={url} size={220} label={`QR ${meja.name}`} />
        </div>

        <p class="num mt-3 text-5xl font-black text-brand-700">{meja.number}</p>

        <div class="mt-4 flex gap-2">
          <Button variant="outline" size="md" icon={salin ? 'check' : 'tag'} onClick={() => void salinTautan()} class="flex-1">
            {salin ? 'Tersalin' : 'Salin tautan'}
          </Button>
          <Button variant="primary" size="md" icon="printer" onClick={onCetak} class="flex-1">
            Cetak
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={onTutup} class="mt-2 w-full">
          Tutup
        </Button>
      </Card>
    </div>
  );
}

/* ==========================================================================
   Form meja
   ========================================================================= */

function FormMeja({
  nilai,
  sibuk,
  onUbah,
  onTutup,
  onSimpan,
}: {
  nilai: TableInput;
  sibuk: boolean;
  onUbah: (v: TableInput) => void;
  onTutup: () => void;
  onSimpan: () => void;
}) {
  return (
    <div class="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/55 sm:items-center sm:p-4" onClick={onTutup}>
      <Card
        class="anim-sheet max-h-[92dvh] w-full max-w-md overflow-y-auto !rounded-b-none sm:!rounded-b-xl"
        onClick={(e: Event) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="display text-xl text-ink-900">{nilai.id ? 'Ubah meja' : 'Meja baru'}</h3>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
          >
            <Icon name="x" size={19} />
          </button>
        </div>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <Field label="Nomor">
              <Input
                inputMode="numeric"
                value={String(nilai.number)}
                onInput={(e) =>
                  onUbah({ ...nilai, number: Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0 })
                }
                class="num text-right font-bold"
                autofocus
              />
            </Field>
            <Field label="Kapasitas">
              <Input
                inputMode="numeric"
                value={String(nilai.capacity)}
                onInput={(e) =>
                  onUbah({ ...nilai, capacity: Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0 })
                }
                class="num text-right"
              />
            </Field>
          </div>

          <Field label="Nama" hint="Boleh dikosongkan">
            <Input
              value={nilai.name}
              onInput={(e) => onUbah({ ...nilai, name: (e.target as HTMLInputElement).value })}
              placeholder="Meja Teras 1"
            />
          </Field>

          <Field label="Status">
            <select
              value={nilai.status}
              onChange={(e) => onUbah({ ...nilai, status: (e.target as HTMLSelectElement).value as DiningTable['status'] })}
              class="w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="available">Kosong</option>
              <option value="occupied">Terisi</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </Field>
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
            disabled={nilai.number <= 0}
            onClick={onSimpan}
            class="flex-1"
          >
            Simpan
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ==========================================================================
   SVG QR untuk pencetakan
   ========================================================================== */

/**
 * Versi string dari komponen `QrCode`, dipakai saat mencetak.
 *
 * Komponen Preact tidak bisa dirender ke string tanpa mesin render tambahan,
 * dan menambahkan itu hanya demi satu halaman cetak tidak sepadan. Jadi di
 * sini matriksnya dibangun langsung — memakai fungsi murni yang sama
 * (`qrMatrix`, `qrPathD`), sehingga hasilnya identik dengan yang di layar.
 */
function svgQr(teks: string, ukuran: number): string {
  const m = qrMatrix(teks, 'M');
  const extent = qrViewBoxSize(m, 4);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ukuran}" height="${ukuran}" ` +
    `viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges">` +
    `<rect width="${extent}" height="${extent}" fill="#ffffff"/>` +
    `<path d="${qrPathD(m, 4)}" fill="#000000"/></svg>`
  );
}
