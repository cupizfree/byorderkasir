/**
 * Kode QR.
 *
 * Memakai `uqr` (3 KB) alih-alih pustaka QR yang umum dipakai. Pustaka populer
 * untuk keperluan ini biasanya 40–60 KB karena menyertakan banyak mode render
 * — di sini yang dibutuhkan hanya matriks modulnya, jadi SVG-nya digambar
 * sendiri (lihat `domain/qr.ts`). Hasilnya tajam di layar mana pun karena
 * vektor, bukan kanvas, dan bisa diwarnai sesuai tema.
 */

import { useMemo } from 'preact/hooks';

import {
  MIN_QUIET_ZONE,
  QrError,
  qrMatrix,
  qrPathD,
  qrViewBoxSize,
  type EccLevel,
} from '../domain/qr.ts';

export interface QrCodeProps {
  /** Teks yang dikodekan. Kosong = tidak dirender. */
  value: string;
  /** Ukuran sisi dalam piksel CSS. */
  size?: number;
  /** Tingkat koreksi galat. `M` cukup untuk layar bersih. */
  ecc?: EccLevel;
  /** Warna modul gelap. */
  color?: string;
  /** Warna latar. Harus kontras dengan `color`. */
  background?: string;
  /** Lebar zona tenang dalam modul. QRIS mensyaratkan minimal 4. */
  border?: number;
  class?: string;
  label?: string;
}

export function QrCode({
  value,
  size = 256,
  ecc = 'M',
  color = '#0f172a',
  background = '#ffffff',
  border = MIN_QUIET_ZONE,
  class: cls = '',
  label = 'Kode QR',
}: QrCodeProps) {
  const svg = useMemo(() => {
    if (!value) return null;

    try {
      const matrix = qrMatrix(value, ecc);
      return {
        path: qrPathD(matrix, border),
        extent: qrViewBoxSize(matrix, border),
      };
    } catch (err) {
      // Teks terlalu panjang, atau berisi karakter yang tidak didukung. Lebih
      // baik tidak menampilkan apa pun daripada menampilkan QR rusak yang gagal
      // discan pelanggan.
      if (err instanceof QrError) return null;
      throw err;
    }
  }, [value, ecc, border]);

  if (!svg) return null;

  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox={`0 0 ${svg.extent} ${svg.extent}`}
      shape-rendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect width={svg.extent} height={svg.extent} fill={background} />
      <path d={svg.path} fill={color} />
    </svg>
  );
}
