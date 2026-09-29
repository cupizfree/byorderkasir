/**
 * QRIS — baca, validasi, dan ubah QRIS statis jadi QRIS dinamis.
 *
 * QRIS mengikuti standar EMVCo: rangkaian TLV (tag–length–value) berisi teks,
 * diakhiri CRC16. Toko biasanya hanya diberi **QRIS statis** dari bank/PJSP —
 * nominalnya harus diketik pelanggan, dan itu sumber dua masalah nyata:
 *
 *   1. pelanggan salah ketik nominal (kurang bayar),
 *   2. kasir tidak bisa mencocokkan pembayaran dengan order.
 *
 * Menambahkan nominal ke payload statis menghasilkan **QRIS dinamis**: aplikasi
 * e-wallet pelanggan menerima nominalnya sudah terisi, tidak bisa diubah.
 *
 * Cara kerjanya: sisipkan tag 54 (transaction amount), ubah tag 01 dari `11`
 * (statis) jadi `12` (dinamis), lalu hitung ulang CRC di tag 63. CRC harus
 * dihitung ulang karena CRC menutupi seluruh payload — kalau lupa, aplikasi
 * pelanggan akan menolak QR-nya.
 *
 * Tidak ada dependensi: seluruhnya dihitung di sini.
 */

import { formatRupiah } from './money.ts';

/* ==========================================================================
   Tipe
   ========================================================================= */

export interface QrisTag {
  tag: string;
  value: string;
}

export interface QrisInfo {
  /** `11` = statis, `12` = dinamis. */
  initiation: 'static' | 'dynamic' | 'unknown';
  merchantName: string;
  merchantCity: string;
  currency: string | null;
  /** Nominal yang sudah tertanam, kalau ada. */
  amount: number | null;
  /** CRC yang tertulis di payload. */
  crc: string;
  /** Hasil hitung ulang — harus sama dengan `crc` agar payload sah. */
  crcValid: boolean;
}

/* ==========================================================================
   CRC16 — CCITT-FALSE
   ========================================================================= */

/**
 * CRC16/CCITT-FALSE: polinomial 0x1021, nilai awal 0xFFFF, tanpa pembalikan
 * bit, tanpa XOR akhir. Ini varian yang dipakai EMVCo.
 *
 * Nilai uji baku: `crc16('123456789')` harus `29B1`.
 */
export function crc16(input: string): string {
  let crc = 0xffff;

  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;

    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/* ==========================================================================
   TLV
   ========================================================================= */

/** Urai payload jadi daftar tag. Toleran terhadap data cacat. */
export function parseTlv(payload: string): QrisTag[] {
  const tags: QrisTag[] = [];
  let i = 0;

  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const lenRaw = payload.slice(i + 2, i + 4);

    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenRaw)) break;

    const len = Number(lenRaw);
    const value = payload.slice(i + 4, i + 4 + len);

    // Nilai terpotong = payload cacat; berhenti daripada menebak.
    if (value.length < len) break;

    tags.push({ tag, value });
    i += 4 + len;
  }

  return tags;
}

/** Susun ulang daftar tag jadi payload. */
export function buildTlv(tags: readonly QrisTag[]): string {
  return tags
    .map(({ tag, value }) => {
      const len = value.length;
      if (len > 99) throw new QrisError(`Nilai tag ${tag} terlalu panjang (${len} karakter)`);
      return `${tag}${String(len).padStart(2, '0')}${value}`;
    })
    .join('');
}

export class QrisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrisError';
  }
}

/* ==========================================================================
   Baca
   ========================================================================= */

function first(tags: readonly QrisTag[], tag: string): string | null {
  return tags.find((t) => t.tag === tag)?.value ?? null;
}

/** Ambil isi payload tanpa bagian CRC. */
function payloadWithoutCrc(payload: string): string {
  const idx = payload.lastIndexOf('6304');
  return idx >= 0 ? payload.slice(0, idx) : payload;
}

/**
 * Baca dan periksa sebuah payload QRIS.
 *
 * `crcValid` adalah pemeriksaan yang sebenarnya penting: kalau false, payload
 * sudah rusak atau diubah tanpa menghitung ulang CRC, dan aplikasi pelanggan
 * akan menolaknya.
 */
export function readQris(payload: string): QrisInfo {
  const tags = parseTlv(payload);

  const initRaw = first(tags, '01');
  const amountRaw = first(tags, '54');
  const crc = first(tags, '63') ?? '';

  const tanpaCrc = payloadWithoutCrc(payload);
  const crcValid = crc.length === 4 && crc16(`${tanpaCrc}6304`) === crc;

  return {
    initiation: initRaw === '11' ? 'static' : initRaw === '12' ? 'dynamic' : 'unknown',
    merchantName: first(tags, '59') ?? '',
    merchantCity: first(tags, '60') ?? '',
    currency: first(tags, '53'),
    amount: amountRaw !== null && amountRaw !== '' ? Number(amountRaw) : null,
    crc,
    crcValid,
  };
}

/** Benar kalau payload bisa dipakai (struktur terbaca dan CRC cocok). */
export function isValidQris(payload: string): boolean {
  if (!payload || payload.length < 8) return false;
  const info = readQris(payload);
  return info.crcValid && info.merchantName !== '';
}

/* ==========================================================================
   Ubah jadi dinamis
   ========================================================================= */

export interface QrisWithAmountResult {
  /** Payload QRIS dinamis, siap ditampilkan sebagai QR. */
  payload: string;
  /** Nominal yang tertanam. */
  amount: number;
  merchantName: string;
}

/**
 * Sisipkan nominal ke QRIS statis → QRIS dinamis.
 *
 * Tag 54 ditambahkan (atau diganti kalau sudah ada), tag 01 jadi `12`, dan CRC
 * dihitung ulang. Urutan tag dipertahankan supaya payload tetap rapi dan
 * mirip aslinya.
 *
 * @throws {QrisError} kalau payload tidak terbaca atau nominal tidak masuk akal.
 */
export function qrisWithAmount(
  staticPayload: string,
  amount: number,
): QrisWithAmountResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new QrisError(`Nominal harus bilangan bulat positif, diterima: ${amount}`);
  }
  if (amount > 9_999_999_999_999) {
    throw new QrisError('Nominal melebihi batas 13 digit QRIS');
  }

  const bersih = staticPayload.trim();
  const tags = parseTlv(bersih);

  if (tags.length === 0) {
    throw new QrisError('Payload QRIS tidak terbaca (bukan rangkaian TLV)');
  }

  // Buang tag 63 (CRC) dan 54 (nominal lama) — keduanya akan ditulis ulang.
  const isi = tags.filter((t) => t.tag !== '63' && t.tag !== '54');

  // Tag 01 wajib ada di QRIS yang sah; kalau hilang, tambahkan di depan.
  const adaInit = isi.some((t) => t.tag === '01');
  if (!adaInit) isi.unshift({ tag: '01', value: '12' });
  else for (const t of isi) if (t.tag === '01') t.value = '12';

  // Tag 54 disisipkan sebelum tag 58 (country code) agar urutannya wajar.
  const idx58 = isi.findIndex((t) => t.tag === '58');
  const tag54: QrisTag = { tag: '54', value: String(amount) };
  if (idx58 >= 0) isi.splice(idx58, 0, tag54);
  else isi.push(tag54);

  const tanpaCrc = buildTlv(isi);
  const payload = `${tanpaCrc}6304${crc16(`${tanpaCrc}6304`)}`;

  const info = readQris(payload);
  if (!info.crcValid) {
    throw new QrisError('CRC hasil perhitungan tidak konsisten — payload dibatalkan');
  }

  return { payload, amount, merchantName: info.merchantName };
}

/**
 * Ringkasan nominal QRIS untuk ditampilkan ke kasir.
 * Dipakai di layar pelanggan dan di halaman pelanggan.
 */
export function describeQrisAmount(payload: string): string {
  const info = readQris(payload);
  if (info.amount === null) return 'Nominal diisi pelanggan';
  return formatRupiah(info.amount);
}
