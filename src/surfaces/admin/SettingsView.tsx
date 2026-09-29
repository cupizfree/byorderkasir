/**
 * Pengaturan toko.
 *
 * Bagian terpenting di sini adalah **QRIS toko**. Pemilik kafe menempelkan
 * teks QRIS statis dari bank/PJSP-nya, dan aplikasi memvalidasinya saat itu
 * juga: kalau CRC-nya tidak sah atau payloadnya tidak terbaca, kasir diberi
 * tahu sebelum pelanggan yang menemukannya di depan meja.
 *
 * Aplikasi lama menyimpan `qris_auto_secret` dengan nilai bawaan yang
 * ditulis di kode peramban, jadi siapa pun bisa mengirim notifikasi pembayaran
 * palsu. Di sini tidak ada kunci rahasia di sisi klien sama sekali — bagian
 * itu pindah ke webhook server (lihat catatan di bawah).
 */

import { useMemo, useState } from 'preact/hooks';

import { formatRupiah, parseRupiah } from '../../domain/money.ts';
import { isValidQris, readQris } from '../../domain/qris.ts';
import type { PaymentChannel, StoreSettings } from '../../domain/types.ts';
import { Badge, Button, Card, Field, Input, Textarea } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';

/* ==========================================================================
   Tampilan
   ========================================================================== */

export interface SettingsViewProps {
  settings: StoreSettings;
  onSimpan: (s: StoreSettings) => Promise<void>;
  onResetDemo: () => void;
}

export function SettingsView({ settings, onSimpan, onResetDemo }: SettingsViewProps) {
  const [draf, setDraf] = useState<StoreSettings>(() => structuredClone(settings));
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  const berubah = useMemo(
    () => JSON.stringify(draf) !== JSON.stringify(settings),
    [draf, settings],
  );

  function ubah<K extends keyof StoreSettings>(kunci: K, nilai: StoreSettings[K]) {
    setDraf((d) => ({ ...d, [kunci]: nilai }));
    setPesan(null);
  }

  async function simpan() {
    setGalat(null);
    setPesan(null);
    setSibuk(true);
    try {
      await onSimpan(draf);
      setPesan('Pengaturan tersimpan.');
      window.setTimeout(() => setPesan(null), 2500);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div class="mx-auto max-w-3xl space-y-4 p-4 pb-28">
      {/* ================================================================ */}
      {/* Identitas                                                        */}
      {/* ================================================================ */}
      <Card>
        <h2 class="display mb-4 text-xl text-ink-900">Identitas toko</h2>
        <div class="space-y-4">
          <Field label="Nama toko">
            <Input
              value={draf.name}
              onInput={(e) => ubah('name', (e.target as HTMLInputElement).value)}
              placeholder="Kopi Senja"
            />
          </Field>
          <Field label="Tagline">
            <Input
              value={draf.tagline}
              onInput={(e) => ubah('tagline', (e.target as HTMLInputElement).value)}
              placeholder="Kopi & Dapur Kecil"
            />
          </Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Telepon">
              <Input
                value={draf.phone}
                onInput={(e) => ubah('phone', (e.target as HTMLInputElement).value)}
                placeholder="021-1234567"
              />
            </Field>
            <Field label="Alamat">
              <Input
                value={draf.address}
                onInput={(e) => ubah('address', (e.target as HTMLInputElement).value)}
                placeholder="Jl. Contoh No. 1, Jakarta"
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* ================================================================ */}
      {/* Pajak & layanan                                                  */}
      {/* ================================================================ */}
      <Card>
        <h2 class="display mb-1 text-xl text-ink-900">Pajak & biaya layanan</h2>
        <p class="mb-4 text-sm text-ink-600">
          Untuk restoran, PB1 biasanya 10% dan dihitung setelah biaya layanan.
        </p>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Pajak" hint="Persen. 0 = tanpa pajak">
            <Input
              inputMode="decimal"
              value={String(draf.tax.percent)}
              onInput={(e) =>
                ubah('tax', {
                  ...draf.tax,
                  percent: Math.max(0, Math.min(50, Number((e.target as HTMLInputElement).value) || 0)),
                })
              }
              class="num text-right font-bold"
            />
          </Field>

          <Field label="Biaya layanan" hint="Rupiah tetap per transaksi">
            <Input
              inputMode="numeric"
              value={draf.serviceFee.amount === 0 ? '' : formatRupiah(draf.serviceFee.amount, false)}
              onInput={(e) =>
                ubah('serviceFee', {
                  ...draf.serviceFee,
                  amount: parseRupiah((e.target as HTMLInputElement).value),
                })
              }
              class="num text-right"
            />
          </Field>
        </div>

        <label class="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
          <input
            type="checkbox"
            checked={draf.serviceFee.enabled}
            onChange={(e) =>
              ubah('serviceFee', { ...draf.serviceFee, enabled: (e.target as HTMLInputElement).checked })
            }
            class="h-4 w-4 accent-brand-700"
          />
          <span class="text-sm font-semibold text-ink-800">Kenakan biaya layanan</span>
        </label>

        {/* Contoh perhitungan ------------------------------------------- */}
        <div class="mt-4 rounded-lg bg-ink-50 p-3">
          <p class="text-xs font-bold tracking-wide text-ink-500 uppercase">Contoh: belanja Rp 100.000</p>
          <dl class="mt-2 space-y-1 text-sm">
            {(() => {
              const sub = 100_000;
              const svc = draf.serviceFee.enabled ? draf.serviceFee.amount : 0;
              const tax = Math.round(((sub + svc) * draf.tax.percent) / 100);
              return (
                <>
                  <Baris label="Subtotal" nilai={formatRupiah(sub)} />
                  {svc > 0 ? <Baris label="Biaya layanan" nilai={formatRupiah(svc)} /> : null}
                  {tax > 0 ? <Baris label={`Pajak ${draf.tax.percent}%`} nilai={formatRupiah(tax)} /> : null}
                  <div class="flex justify-between border-t border-ink-200 pt-1 font-bold text-ink-900">
                    <span>Total</span>
                    <span class="num">{formatRupiah(sub + svc + tax)}</span>
                  </div>
                </>
              );
            })()}
          </dl>
        </div>
      </Card>

      {/* ================================================================ */}
      {/* QRIS toko                                                        */}
      {/* ================================================================ */}
      <Card>
        <h2 class="display mb-1 text-xl text-ink-900">QRIS toko</h2>
        <p class="mb-4 text-sm text-ink-600">
          Tempelkan teks QRIS statis dari bank atau PJSP Anda. Aplikasi akan menyisipkan nominal
          otomatis, jadi pelanggan tidak perlu mengetik dan tidak bisa salah ketik.
        </p>

        <Field label="Payload QRIS" hint="Teks yang dimulai dengan 00020101…">
          <Textarea
            value={draf.payments.qrisStatic.payload ?? ''}
            onInput={(e) =>
              ubah('payments', {
                ...draf.payments,
                qrisStatic: {
                  ...draf.payments.qrisStatic,
                  payload: (e.target as HTMLTextAreaElement).value.trim() || null,
                },
              })
            }
            rows={4}
            placeholder="00020101021126610014ID.CO.QRIS.WWW…"
            class="num text-xs break-all"
          />
        </Field>

        <StatusQris payload={draf.payments.qrisStatic.payload} />

        <label class="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
          <input
            type="checkbox"
            checked={draf.payments.qrisStatic.enabled}
            onChange={(e) =>
              ubah('payments', {
                ...draf.payments,
                qrisStatic: { ...draf.payments.qrisStatic, enabled: (e.target as HTMLInputElement).checked },
              })
            }
            class="h-4 w-4 accent-brand-700"
          />
          <span class="text-sm font-semibold text-ink-800">Terima QRIS toko</span>
        </label>

        <div class="mt-4 rounded-lg border border-pending/30 bg-pending-bg p-3">
          <p class="flex items-start gap-2 text-sm text-pending">
            <Icon name="alert" size={15} class="mt-0.5 shrink-0" />
            <span>
              <strong>Penting:</strong> QRIS toko tidak memberi notifikasi pembayaran. Kasir harus
              menekan “Lunas” setelah memastikan uang masuk. Untuk pelunasan otomatis, pakai
              <strong> QRIS Otomatis</strong> lewat payment gateway — kunci rahasianya disimpan di
              server, bukan di peramban seperti aplikasi lama.
            </span>
          </p>
        </div>

        <label class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
          <input
            type="checkbox"
            checked={draf.payments.qrisGateway.enabled}
            onChange={(e) =>
              ubah('payments', {
                ...draf.payments,
                qrisGateway: { ...draf.payments.qrisGateway, enabled: (e.target as HTMLInputElement).checked },
              })
            }
            class="h-4 w-4 accent-brand-700"
          />
          <span class="text-sm font-semibold text-ink-800">
            Terima QRIS Otomatis
            <span class="ml-2 text-xs font-normal text-ink-500">butuh payment gateway terpasang</span>
          </span>
        </label>
      </Card>

      {/* ================================================================ */}
      {/* Metode bayar lain                                                */}
      {/* ================================================================ */}
      <Card>
        <h2 class="display mb-4 text-xl text-ink-900">Metode bayar</h2>
        <div class="space-y-2">
          {(
            [
              ['cash', 'Tunai', 'Diterima di kasir, kembalian dihitung otomatis'],
              ['debit', 'Kartu debit', 'Lewat mesin EDC'],
              ['split', 'Bayar gabungan', 'Satu order, beberapa metode'],
            ] as const
          ).map(([kunci, judul, ket]) => (
            <label
              key={kunci}
              class="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={draf.payments[kunci].enabled}
                onChange={(e) =>
                  ubah('payments', {
                    ...draf.payments,
                    [kunci]: { ...draf.payments[kunci], enabled: (e.target as HTMLInputElement).checked },
                  })
                }
                class="h-4 w-4 accent-brand-700"
              />
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-ink-800">{judul}</span>
                <span class="block text-xs text-ink-500">{ket}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {/* ================================================================ */}
      {/* Antrian & struk                                                  */}
      {/* ================================================================ */}
      <Card>
        <h2 class="display mb-4 text-xl text-ink-900">Antrian & struk</h2>
        <div class="space-y-4">
          <Field label="Huruf awal nomor antrian" hint="Mis. A → A-01, A-02">
            <Input
              value={draf.queue.prefix}
              onInput={(e) =>
                ubah('queue', {
                  ...draf.queue,
                  prefix: (e.target as HTMLInputElement).value.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase(),
                })
              }
              class="num text-center text-lg font-bold"
            />
          </Field>

          <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={draf.queue.resetDaily}
              onChange={(e) => ubah('queue', { ...draf.queue, resetDaily: (e.target as HTMLInputElement).checked })}
              class="h-4 w-4 accent-brand-700"
            />
            <span class="text-sm font-semibold text-ink-800">
              Reset nomor antrian setiap hari
              <span class="ml-2 text-xs font-normal text-ink-500">pergantian hari waktu toko</span>
            </span>
          </label>

          <Field label="Catatan kaki struk pelanggan">
            <Textarea
              value={draf.receipt.customerFooter}
              onInput={(e) =>
                ubah('receipt', {
                  ...draf.receipt,
                  customerFooter: (e.target as HTMLTextAreaElement).value,
                })
              }
              rows={2}
            />
          </Field>

          <Field label="Catatan kaki tiket dapur">
            <Textarea
              value={draf.receipt.kitchenFooter}
              onInput={(e) =>
                ubah('receipt', {
                  ...draf.receipt,
                  kitchenFooter: (e.target as HTMLTextAreaElement).value,
                })
              }
              rows={2}
            />
          </Field>
        </div>
      </Card>

      {/* ================================================================ */}
      {/* Data demo                                                        */}
      {/* ================================================================ */}
      <Card class="!border-cancelled/30">
        <h2 class="display mb-1 text-xl text-ink-900">Data demo</h2>
        <p class="mb-4 text-sm text-ink-600">
          Menghapus semua order, menu, dan meja dari peramban ini, lalu memuat ulang data contoh.
        </p>
        <Button variant="danger" size="md" icon="trash" onClick={onResetDemo}>
          Reset data demo
        </Button>
      </Card>

      {/* ================================================================ */}
      {/* Bilah simpan                                                     */}
      {/* ================================================================ */}
      <div class="safe-b fixed inset-x-0 bottom-0 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div class="mx-auto flex max-w-3xl items-center gap-3">
          <div class="min-w-0 flex-1 text-sm">
            {galat ? (
              <span class="font-semibold text-cancelled">{galat}</span>
            ) : pesan ? (
              <span class="flex items-center gap-1.5 font-semibold text-done">
                <Icon name="check" size={15} /> {pesan}
              </span>
            ) : berubah ? (
              <span class="text-ink-600">Ada perubahan yang belum disimpan.</span>
            ) : (
              <span class="text-ink-400">Tidak ada perubahan.</span>
            )}
          </div>
          <Button
            variant="outline"
            size="md"
            disabled={!berubah}
            onClick={() => setDraf(structuredClone(settings))}
          >
            Batalkan
          </Button>
          <Button variant="primary" size="md" icon="check" loading={sibuk} disabled={!berubah} onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Status payload QRIS
   ========================================================================== */

function StatusQris({ payload }: { payload: string | null }) {
  if (!payload) {
    return (
      <p class="mt-2 flex items-center gap-2 text-sm text-ink-500">
        <Icon name="info" size={15} />
        Belum diisi. Pelanggan harus mengetik nominal sendiri di aplikasi banknya.
      </p>
    );
  }

  if (!isValidQris(payload)) {
    return (
      <p class="mt-2 flex items-start gap-2 rounded-lg border border-cancelled/30 bg-cancelled-bg px-3 py-2 text-sm font-semibold text-cancelled">
        <Icon name="alert" size={15} class="mt-0.5 shrink-0" />
        <span>
          Payload tidak terbaca atau CRC-nya tidak sah. Salin ulang teks QRIS dari aplikasi bank —
          jangan diketik manual, dan jangan sampai ada spasi di ujungnya.
        </span>
      </p>
    );
  }

  const info = readQris(payload);

  return (
    <div class="mt-2 rounded-lg border border-done/30 bg-done-bg px-3 py-2.5">
      <p class="flex items-center gap-2 text-sm font-bold text-done">
        <Icon name="check" size={15} /> Payload QRIS sah
      </p>
      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt class="text-ink-600">Merchant</dt>
        <dd class="truncate font-semibold text-ink-900">{info.merchantName || '—'}</dd>
        <dt class="text-ink-600">Kota</dt>
        <dd class="font-semibold text-ink-900">{info.merchantCity || '—'}</dd>
        <dt class="text-ink-600">Tipe</dt>
        <dd>
          <Badge tone={info.initiation === 'static' ? 'brand' : 'done'}>
            {info.initiation === 'static'
              ? 'Statis — nominal akan disisipkan'
              : 'Sudah dinamis'}
          </Badge>
        </dd>
        <dt class="text-ink-600">CRC</dt>
        <dd class="num font-semibold text-ink-900">{info.crc}</dd>
      </dl>
    </div>
  );
}

/* ==========================================================================
   Potongan
   ========================================================================= */

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div class="flex justify-between">
      <dt class="text-ink-600">{label}</dt>
      <dd class="num font-semibold text-ink-800">{nilai}</dd>
    </div>
  );
}

/* Dipakai supaya kanal pembayaran yang belum diatur tetap ikut tersimpan. */
export type { PaymentChannel };
