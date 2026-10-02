/**
 * Gambar menu.
 *
 * Aplikasi aslinya hanya menampilkan daftar teks — tidak ada gambar sama
 * sekali, sehingga daftar menu panjang sulit dipindai dan salah pilih menu
 * gampang terjadi. Di sini setiap menu punya gambar.
 *
 * Dua sumber:
 *  1. `imageUrl` — foto yang diunggah pemilik toko. Kalau ada, itu yang dipakai.
 *  2. Kalau belum ada gambar, dibangkitkan sendiri: gradien + ikon sesuai jenis
 *     menu. Bukan kotak abu-abu bertuliskan "tidak ada gambar" — daftar tetap
 *     enak dilihat sebelum pemilik sempat mengunggah apa pun.
 *
 * Warna diambil dari **kategori**, bukan dari nama menu. Sebelumnya warna
 * di-hash dari nama, dan hasilnya justru menyesatkan: Matcha Latte dapat
 * oranye, Dark Chocolate dapat biru, Cappuccino dapat ungu. Warna yang tidak
 * mewakili apa pun lebih buruk daripada tidak ada warna. Sekarang seluruh
 * minuman kopi bernuansa cokelat, non-kopi hijau teh, makanan oranye, dan
 * seterusnya — jadi warnanya ikut membantu mengenali kelompok menu sekilas.
 *
 * Baik warna maupun ikonnya hanya bergantung pada kategori dan nama, jadi satu
 * menu selalu tampil sama setiap kali dirender — tidak berkedip berubah saat
 * realtime menyegarkan daftar.
 */

import { useState } from 'preact/hooks';

import { Icon, type IconName } from './icons.tsx';

/* ==========================================================================
   Warna per kategori
   ========================================================================= */

/**
 * Satu keluarga warna per kategori. Ujung bawah tiap gradien cukup gelap
 * supaya ikon putih tetap terbaca di atasnya.
 */
const PALET_KATEGORI: readonly (readonly [readonly string[], readonly [string, string]])[] = [
  [['kopi', 'coffee', 'espresso'], ['#b45309', '#78350f']],
  [['non-kopi', 'nonkopi', 'teh', 'tea', 'jus', 'juice', 'soda'], ['#0d9488', '#115e59']],
  [['makanan', 'main', 'food', 'berat'], ['#ea580c', '#9a3412']],
  [['snack', 'cemilan', 'camilan'], ['#ca8a04', '#854d0e']],
  [['dessert', 'pencuci', 'kue', 'manis'], ['#db2777', '#9d174d']],
  [['minuman', 'drink'], ['#0284c7', '#075985']],
];

/** Dipakai kalau nama kategorinya tidak dikenali sama sekali. */
const PALET_CADANGAN: readonly (readonly [string, string])[] = [
  ['#d97706', '#92400e'],
  ['#059669', '#065f46'],
  ['#0284c7', '#075985'],
  ['#c026d3', '#86198f'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function gradien(kategori: string, nama: string): string {
  const k = kategori.toLowerCase();
  for (const [kata, warna] of PALET_KATEGORI) {
    if (kata.some((x) => k.includes(x))) {
      return `linear-gradient(140deg, ${warna[0]}, ${warna[1]})`;
    }
  }
  // Kategori belum dikenal. Warna tetap harus sama setiap kali dirender, jadi
  // ditentukan dari nama kategorinya — bukan dari nama menunya.
  const [a, b] = PALET_CADANGAN[hash(kategori || nama) % PALET_CADANGAN.length]!;
  return `linear-gradient(140deg, ${a}, ${b})`;
}

/* ==========================================================================
   Ikon per jenis menu
   ========================================================================= */

/**
 * Urutan penting: yang lebih spesifik diperiksa lebih dulu. Minuman dingin
 * harus kena sebelum "kopi", kalau tidak Cold Brew akan dapat ikon cangkir
 * beruap — panas — padahal isinya es.
 */
const IKON: readonly (readonly [readonly string[], IconName])[] = [
  [['es ', 'ice', 'dingin', 'cold', 'frozen'], 'cup'],
  [['kopi', 'coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'brew', 'mocha'], 'coffee'],
  [['teh', 'tea', 'matcha', 'jus', 'juice', 'soda', 'air', 'lemon', 'susu', 'milk'], 'cup'],
  [['nasi', 'rice', 'mie', 'noodle', 'bakso', 'soto', 'sup', 'bubur', 'ramen'], 'bowl'],
  [['ayam', 'chicken', 'geprek', 'ikan', 'sate', 'steak', 'bakar', 'daging'], 'utensils'],
  [['kentang', 'pisang', 'tahu', 'roti', 'goreng', 'fries', 'snack'], 'cookie'],
  [['cake', 'kue', 'brownies', 'dessert', 'puding', 'donat', 'es krim'], 'cookie'],
];

function ikonUntuk(nama: string): IconName {
  // Spasi di kiri-kanan supaya kata kunci pendek seperti "es " tidak cocok
  // di tengah kata lain.
  const n = ` ${nama.toLowerCase()} `;
  for (const [kata, ikon] of IKON) {
    if (kata.some((k) => n.includes(k))) return ikon;
  }
  return 'utensils';
}

/* ==========================================================================
   Komponen
   ========================================================================= */

export type ThumbSize = 'sm' | 'md' | 'lg' | 'tile' | 'tile-lg';

const UKURAN: Record<ThumbSize, { kotak: string; ikon: number }> = {
  sm: { kotak: 'h-11 w-11', ikon: 22 },
  md: { kotak: 'h-16 w-16', ikon: 30 },
  lg: { kotak: 'h-24 w-24', ikon: 44 },
  // Memenuhi lebar induknya, tapi tingginya dijaga tetap — kartu menu di layar
  // kasir. Kalau tingginya ikut rasio gambar, kartunya jadi terlalu tinggi dan
  // harga antar-kartu tidak lagi sebaris.
  tile: { kotak: 'h-20 w-full', ikon: 30 },
  // Varian untuk tema Fokus. Kasir memilih sambil melayani antrean, jadi foto
  // yang cukup besar untuk dikenali sekilas jauh lebih berguna daripada kartu
  // kecil yang rapat.
  'tile-lg': { kotak: 'h-32 w-full', ikon: 44 },
};

export interface MenuThumbProps {
  name: string;
  imageUrl?: string | null;
  /** Nama kategori — menentukan warnanya. */
  category?: string;
  size?: ThumbSize;
  /** Sudut membulat; kelas Tailwind, mis. `rounded-xl`. */
  rounded?: string;
  class?: string;
}

export function MenuThumb({
  name,
  imageUrl,
  category = '',
  size = 'md',
  rounded = 'rounded-lg',
  class: cls = '',
}: MenuThumbProps) {
  // Kalau tautan gambarnya mati (salah ketik, atau berkasnya sudah dihapus),
  // jatuh kembali ke gambar otomatis. Foto rusak di daftar menu lebih buruk
  // daripada tidak ada foto sama sekali.
  const [gagalMuat, setGagalMuat] = useState(false);

  const { kotak, ikon } = UKURAN[size];
  const dasar = ['shrink-0 overflow-hidden', kotak, rounded, cls].filter(Boolean).join(' ');

  if (imageUrl && !gagalMuat) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setGagalMuat(true)}
        class={[dasar, 'bg-ink-100 object-cover'].join(' ')}
      />
    );
  }

  return (
    <div
      class={[dasar, 'flex items-center justify-center'].join(' ')}
      style={{ backgroundImage: gradien(category, name) }}
      // Dekoratif: nama menu sudah ada sebagai teks di sebelahnya.
      aria-hidden="true"
    >
      <Icon name={ikonUntuk(name)} size={ikon} class="text-white/90" strokeWidth={1.7} />
    </div>
  );
}
