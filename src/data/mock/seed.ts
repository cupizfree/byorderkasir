/**
 * Data awal untuk adapter mock.
 *
 * Dipakai saat aplikasi dijalankan tanpa Supabase (mode demo / pengembangan
 * frontend). Isinya sengaja dibuat realistis untuk kafe Indonesia — harga,
 * HPP, dan margin yang masuk akal — supaya tampilan dan perhitungan bisa
 * dinilai dengan angka yang benar, bukan lorem ipsum.
 */

import type {
  Category,
  DiningTable,
  ID,
  Menu,
  StoreSettings,
  UserRole,
} from '../../domain/types.ts';

export const DEMO_STORE_ID = 'store-demo';

export const seedSettings: StoreSettings = {
  storeId: DEMO_STORE_ID,
  name: 'Kopi Senja',
  tagline: 'Kopi & Dapur Kecil',
  address: 'Jl. Barista No. 1, Jakarta Timur',
  phone: '0812-3456-789',
  logoUrl: null,
  currency: 'Rp',

  tax: { percent: 10, channels: [] },
  serviceFee: { enabled: false, amount: 0, channels: [] },

  payments: {
    qrisGateway: { enabled: true, channels: ['pos', 'qr'] },
    qrisStatic: {
      enabled: true,
      channels: ['pos', 'qr'],
      imageUrl: null,
      // QRIS statis contoh. Nominalnya disisipkan saat menampilkan QR, jadi
      // pelanggan tidak mengetik apa pun. Ganti dengan QRIS toko sebenarnya.
      payload:
        '00020101021126660014ID.CO.QRIS.WWW01189360091400000000000215ID10200000000000303UMI' +
        '5204581253033605802ID5910KOPI SENJA6007JAKARTA6105121906304A4A4',
    },
    cash: { enabled: true, channels: ['pos'] },
    debit: { enabled: true, channels: ['pos'], provider: '' },
    transfer: {
      enabled: false,
      channels: ['pos', 'qr'],
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolder: 'Kopi Senja',
    },
    split: { enabled: true, channels: ['pos'] },
    uniqueCodeEnabled: true,
    uniqueCodeRange: [1, 999],
  },

  receipt: {
    customerFooter: 'Terima kasih atas kunjungan Anda!\nInstagram: @kopisenja',
    kitchenFooter: 'Mohon segera dimasak & disajikan',
  },

  queue: { prefix: 'A', resetDaily: true },

  stock: {
    // 5 dipilih karena untuk kafe, stok di bawah lima porsi berarti
    // kemungkinan besar habis sebelum restock berikutnya.
    lowStockThreshold: 5,
  },
};

export const seedCategories: Category[] = [
  { id: 'cat-kopi', storeId: DEMO_STORE_ID, name: 'Kopi', icon: 'coffee', sortOrder: 1, isActive: true },
  { id: 'cat-nonkopi', storeId: DEMO_STORE_ID, name: 'Non-Kopi', icon: 'cup', sortOrder: 2, isActive: true },
  { id: 'cat-makanan', storeId: DEMO_STORE_ID, name: 'Makanan', icon: 'bowl', sortOrder: 3, isActive: true },
  { id: 'cat-snack', storeId: DEMO_STORE_ID, name: 'Snack', icon: 'cookie', sortOrder: 4, isActive: true },
  { id: 'cat-dessert', storeId: DEMO_STORE_ID, name: 'Dessert', icon: 'ice-cream', sortOrder: 5, isActive: true },
];

interface SeedMenu {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  costPrice: number;
  description: string;
  stock: number | null;
  isAvailable?: boolean;
}

// Seluruh menu dilacak stoknya, dan sebagian sengaja sudah menipis di bawah
// ambang (5). Kalau hanya beberapa yang dilacak — apalagi kalau menu teratas
// di layar kasir bukan salah satunya — orang yang mencoba aplikasinya tidak
// akan pernah melihat peringatan bahan maupun riwayat stok dari penjualan
// biasa. Fiturnya ada, tapi tidak terlihat.
const rawMenus: SeedMenu[] = [
  { id: 'mn-espresso', name: 'Espresso', categoryId: 'cat-kopi', price: 18000, costPrice: 6000, description: 'Single shot, biji house blend', stock: 40},
  { id: 'mn-americano', name: 'Americano', categoryId: 'cat-kopi', price: 22000, costPrice: 6500, description: 'Espresso + air panas', stock: 35},
  { id: 'mn-kopi-susu', name: 'Kopi Susu Senja', categoryId: 'cat-kopi', price: 25000, costPrice: 9000, description: 'Signature, susu segar', stock: 18},
  { id: 'mn-cappuccino', name: 'Cappuccino', categoryId: 'cat-kopi', price: 28000, costPrice: 9500, description: 'Dengan foam lembut', stock: 22},
  { id: 'mn-latte', name: 'Caffè Latte', categoryId: 'cat-kopi', price: 28000, costPrice: 9500, description: 'Espresso + susu steamed', stock: 20},
  { id: 'mn-coldbrew', name: 'Cold Brew', categoryId: 'cat-kopi', price: 32000, costPrice: 11000, description: 'Diseduh dingin 12 jam', stock: 8},

  { id: 'mn-matcha', name: 'Matcha Latte', categoryId: 'cat-nonkopi', price: 30000, costPrice: 12000, description: 'Matcha Jepang grade premium', stock: 4},
  { id: 'mn-chocolate', name: 'Dark Chocolate', categoryId: 'cat-nonkopi', price: 28000, costPrice: 10000, description: 'Cokelat 70%', stock: 14},
  { id: 'mn-teh', name: 'Teh Melati', categoryId: 'cat-nonkopi', price: 12000, costPrice: 3000, description: 'Teh tubruk melati', stock: 30},
  { id: 'mn-air', name: 'Air Mineral', categoryId: 'cat-nonkopi', price: 6000, costPrice: 2500, description: 'Botol 600ml', stock: 48},
  { id: 'mn-lemon-tea', name: 'Lemon Tea', categoryId: 'cat-nonkopi', price: 20000, costPrice: 6000, description: 'Teh + lemon segar', stock: 16},

  { id: 'mn-nasgor', name: 'Nasi Goreng Senja', categoryId: 'cat-makanan', price: 32000, costPrice: 15000, description: 'Telur mata sapi, kerupuk', stock: 9},
  { id: 'mn-mie-goreng', name: 'Mie Goreng Spesial', categoryId: 'cat-makanan', price: 28000, costPrice: 12000, description: 'Ayam, telur, sayur', stock: 7},
  { id: 'mn-ayam-geprek', name: 'Ayam Geprek', categoryId: 'cat-makanan', price: 30000, costPrice: 14000, description: 'Level 1-5, sambal bawang', stock: 11},
  { id: 'mn-nasi-ayam', name: 'Nasi Ayam Bakar', categoryId: 'cat-makanan', price: 35000, costPrice: 16000, description: 'Dengan lalapan', stock: 12},
  { id: 'mn-kentang', name: 'Kentang Goreng', categoryId: 'cat-makanan', price: 22000, costPrice: 8000, description: 'Porsi sedang, saus mayo', stock: 24},

  { id: 'mn-pisang', name: 'Pisang Goreng Keju', categoryId: 'cat-snack', price: 20000, costPrice: 7000, description: '3 potong, keju cheddar', stock: 3},
  { id: 'mn-roti-bakar', name: 'Roti Bakar Cokelat', categoryId: 'cat-snack', price: 18000, costPrice: 6000, description: 'Dengan susu kental manis', stock: 10},
  { id: 'mn-tahu-crispy', name: 'Tahu Crispy', categoryId: 'cat-snack', price: 16000, costPrice: 5500, description: 'Sambal kecap', stock: 20},

  { id: 'mn-brownies', name: 'Brownies Fudge', categoryId: 'cat-dessert', price: 26000, costPrice: 10000, description: 'Satu potong, hangat', stock: 6},
  { id: 'mn-cheesecake', name: 'Cheesecake Slice', categoryId: 'cat-dessert', price: 34000, costPrice: 14000, description: 'New York style', stock: 4},
  { id: 'mn-puding', name: 'Puding Karamel', categoryId: 'cat-dessert', price: 15000, costPrice: 5000, description: 'Dingin, homemade', stock: 2},
];

export const seedMenus: Menu[] = rawMenus.map((m, i) => ({
  id: m.id,
  storeId: DEMO_STORE_ID,
  name: m.name,
  categoryId: m.categoryId,
  price: m.price,
  costPrice: m.costPrice,
  description: m.description,
  // Foto contoh untuk mode demo, diambil dari Wikimedia Commons (lisensi
  // bebas, keterangan lengkap di public/menu/KREDIT.json). Nama berkasnya
  // sama dengan id menu, jadi tidak ada tabel pemetaan yang bisa basi.
  //
  // Toko sungguhan mengunggah fotonya sendiri lewat Pengaturan → Menu. Kalau
  // `imageUrl` kosong atau berkasnya hilang, MenuThumb otomatis kembali ke
  // gambar bawaan (gradien + ikon) — daftar menu tidak pernah menampilkan
  // kotak rusak.
  imageUrl: `/menu/${m.id}.webp`,
  isAvailable: m.isAvailable ?? true,
  stock: m.stock,
  sortOrder: i + 1,
}));

export const seedTables: DiningTable[] = Array.from({ length: 8 }, (_, i) => ({
  id: `tbl-${i + 1}`,
  storeId: DEMO_STORE_ID,
  number: i + 1,
  name: `Meja ${i + 1}`,
  capacity: i < 4 ? 2 : 4,
  status: 'available' as const,
  qrToken: `demo-token-${i + 1}`,
}));

/**
 * Akun demo — satu per peran.
 *
 * Aplikasi aslinya hanya punya satu akun tanpa peran, dan PIN-nya ikut
 * terkirim ke peramban sehingga bisa dibaca siapa saja. Di sini peran melekat
 * pada akunnya, jadi izin sudah bisa ditentukan sebelum satu layar pun dibuka.
 *
 * Ini akun DEMO untuk mode tanpa backend, dan sengaja bukan kredensial
 * aplikasi mana pun yang sudah ada. Di Supabase, akun disimpan di server dan
 * kata sandinya di-hash.
 */
export interface DemoAccount {
  userId: ID;
  username: string;
  password: string;
  pin: string;
  role: UserRole;
  displayName: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    userId: 'user-owner',
    username: 'pemilik',
    password: 'pemilik123',
    pin: '111111',
    role: 'owner',
    displayName: 'Bu Sari',
  },
  {
    userId: 'user-cashier',
    username: 'kasir',
    password: 'kasir123',
    pin: '222222',
    role: 'cashier',
    displayName: 'Andi',
  },
  {
    userId: 'user-kitchen',
    username: 'dapur',
    password: 'dapur123',
    pin: '333333',
    role: 'kitchen',
    displayName: 'Dewi',
  },
];

/** Akun pemilik — dipakai tombol "Isi otomatis" sebagai pilihan pertama. */
export const DEMO_CREDENTIALS = {
  username: DEMO_ACCOUNTS[0]!.username,
  password: DEMO_ACCOUNTS[0]!.password,
  pin: DEMO_ACCOUNTS[0]!.pin,
} as const;

/** Nilai yang dipakai untuk kunci penyimpanan di localStorage. */
export const STORAGE_KEY = 'byorderkasir:mock:v1';

export function isDemoMenu(id: ID): boolean {
  return seedMenus.some((m) => m.id === id);
}
