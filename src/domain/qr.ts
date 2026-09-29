/**
 * Geometri kode QR.
 *
 * Dipisahkan dari komponen supaya bisa diuji tanpa peramban. Semua fungsi di
 * sini murni: masukan teks, keluaran matriks atau potongan path SVG.
 *
 * Catatan penting soal `uqr`: `encode().data` **menyertakan zona tenang 1 modul**
 * di sekeliling matriks. Jadi untuk payload yang menghasilkan QR versi 6,
 * `data.length` = 43 sementara ukuran QR sebenarnya 41. Kalau angka 43 dipakai
 * langsung sebagai ukuran modul, kita menggambar satu cincin kosong ekstra dan
 * zona tenang jadi 5 modul, bukan 4 seperti yang diminta. Fungsi di sini
 * membuang cincin bawaan itu lebih dulu.
 */

import { encode } from 'uqr';

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** Lebar zona tenang minimum menurut spesifikasi QR. */
export const MIN_QUIET_ZONE = 4;

export class QrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrError';
  }
}

export interface QrMatrix {
  /** Sisi matriks dalam modul (tanpa zona tenang). Selalu 21, 25, 29, … */
  size: number;
  /** `true` = modul gelap. `data[y][x]`. */
  data: boolean[][];
}

/**
 * Bangkitkan matriks QR dari teks.
 *
 * @throws {QrError} kalau teks terlalu panjang atau tidak bisa dikodekan.
 */
export function qrMatrix(value: string, ecc: EccLevel = 'M'): QrMatrix {
  if (!value) throw new QrError('Teks kosong tidak bisa dikodekan');

  let raw: boolean[][];
  try {
    raw = encode(value, { ecc }).data;
  } catch (err) {
    throw new QrError(
      `Tidak bisa mengkodekan QR (${value.length} karakter, ECC ${ecc}): ${(err as Error).message}`,
    );
  }

  // Buang zona tenang bawaan uqr.
  const size = raw.length - 2;
  if (size < 21) throw new QrError(`Ukuran matriks tidak masuk akal: ${size}`);

  // Ukuran QR yang sah selalu 21 + 4k.
  if ((size - 21) % 4 !== 0) {
    throw new QrError(`Ukuran matriks bukan ukuran QR yang sah: ${size}`);
  }

  const data: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row = raw[y + 1]!;
    const out: boolean[] = [];
    for (let x = 0; x < size; x++) out.push(row[x + 1] === true);
    data.push(out);
  }

  return { size, data };
}

/**
 * Ubah matriks jadi potongan `d` untuk `<path>`, dengan zona tenang `border`
 * modul di sekelilingnya. Satu modul = satu satuan, jadi `viewBox` cukup
 * `0 0 (size + 2*border) (size + 2*border)`.
 */
export function qrPathD(matrix: QrMatrix, border = MIN_QUIET_ZONE): string {
  const { size, data } = matrix;
  const parts: string[] = [];

  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; x++) {
      if (row[x]) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }

  return parts.join('');
}

/** Sisi viewBox untuk matriks dan zona tenang tertentu. */
export function qrViewBoxSize(matrix: QrMatrix, border = MIN_QUIET_ZONE): number {
  return matrix.size + border * 2;
}
