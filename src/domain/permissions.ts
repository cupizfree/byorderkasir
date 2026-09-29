/**
 * Peran pengguna dan izinnya.
 *
 * Aplikasi aslinya hanya punya satu peran: siapa pun yang tahu PIN bisa
 * membuka semua layar, termasuk HPP dan margin yang seharusnya hanya untuk
 * pemilik. Juru masak pun tidak punya batas sendiri — padahal tidak ada
 * gunanya melihat omzet dari balik kompor.
 *
 * Di sini izin dinyatakan sebagai DATA, bukan disebar sebagai pemeriksaan
 * `if` di dalam tiap komponen. Satu tempat, bisa diuji, dan tidak ada layar
 * yang bisa lupa memeriksanya — karena yang menggambar tab adalah shell, dan
 * shell membaca daftar ini.
 */

import type { UserRole } from './types.ts';

/** Layar di dalam panel admin. Urutan di sini menentukan urutan tab. */
export type AdminView =
  | 'kasir'
  | 'dapur'
  | 'order'
  | 'menu'
  | 'meja'
  | 'stok'
  | 'analitik'
  | 'pengaturan';

export const ALL_VIEWS: readonly AdminView[] = [
  'kasir',
  'dapur',
  'order',
  'menu',
  'meja',
  'stok',
  'analitik',
  'pengaturan',
];

/**
 * Izin membuka layar diturunkan dari nama layarnya, supaya menambah layar
 * baru tidak bisa lupa menambah izinnya.
 */
export type ViewPermission = `view:${AdminView}`;

export type Permission =
  | ViewPermission
  /** Membuat order baru dari kasir. */
  | 'order:create'
  /** Memajukan tahap: mulai masak, siap diambil, sudah diserahkan. */
  | 'order:advance'
  | 'order:cancel'
  /** Mencatat uang masuk — termasuk menandai lunas tanpa gateway. */
  | 'order:pay'
  /** Menambah, mengubah, menghapus menu dan kategori (termasuk HPP). */
  | 'menu:write'
  /** Menambah, mengubah, menghapus meja dan mencetak QR-nya. */
  | 'table:write'
  /** Mencatat pergerakan stok: restock, susut, penyesuaian. */
  | 'stock:adjust'
  /** Mengubah pajak, biaya layanan, QRIS, dan pengaturan struk. */
  | 'settings:write'
  /** Mengunduh laporan. */
  | 'report:export';

/**
 * Pemilik: semua layar, semua izin.
 *
 * HPP, margin, pajak, dan kredensial QRIS ada di sini. Kalau izin ini
 * diberikan ke peran lain, rahasia dagang kafe ikut terbuka.
 */
const OWNER: readonly Permission[] = [
  ...ALL_VIEWS.map((v): ViewPermission => `view:${v}`),
  'order:create',
  'order:advance',
  'order:cancel',
  'order:pay',
  'menu:write',
  'table:write',
  'stock:adjust',
  'settings:write',
  'report:export',
];

/**
 * Kasir: melayani transaksi, mengurus meja, dan mencatat stok.
 *
 * Sengaja TIDAK diberi `menu:write` dan `settings:write` — kasir mengubah
 * harga atau pajak akan membuat laporan tidak bisa dipercaya. Layar Menu dan
 * Pengaturan juga tidak muncul, jadi tidak ada tombol yang bisa ditekan
 * untuk mencobanya.
 */
const CASHIER: readonly Permission[] = [
  'view:kasir',
  'view:order',
  'view:meja',
  'view:stok',
  'order:create',
  'order:advance',
  'order:cancel',
  'order:pay',
  'stock:adjust',
];

/**
 * Dapur: hanya papan kerja dan riwayat stok.
 *
 * Boleh memajukan tahap (itu pekerjaannya) dan mencatat susut bahan, tapi
 * tidak boleh membatalkan order — pembatalan menyangkut uang, dan itu kasir
 * atau pemilik.
 */
const KITCHEN: readonly Permission[] = [
  'view:dapur',
  'view:order',
  'view:stok',
  'order:advance',
  'stock:adjust',
];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: OWNER,
  cashier: CASHIER,
  kitchen: KITCHEN,
};

export function permissionsOf(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Layar yang boleh dibuka peran ini, dalam urutan tab. */
export function viewsOf(role: UserRole): AdminView[] {
  return ALL_VIEWS.filter((v) => can(role, `view:${v}`));
}

export function canView(role: UserRole, view: AdminView): boolean {
  return can(role, `view:${view}`);
}

/**
 * Layar pertama yang dibuka setelah masuk.
 *
 * Untuk dapur, membuka layar Kasir berarti menampilkan sesuatu yang tidak
 * boleh dilihat sekaligus tidak berguna — jadi langsung ke papan kerja.
 */
export function homeViewOf(role: UserRole): AdminView {
  return role === 'kitchen' ? 'dapur' : 'kasir';
}

/** Layar pertama yang MASIH boleh dibuka. Dipakai saat peran berubah. */
export function firstAllowedView(role: UserRole, ingin: AdminView): AdminView {
  return canView(role, ingin) ? ingin : (viewsOf(role)[0] ?? homeViewOf(role));
}

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Pemilik',
  cashier: 'Kasir',
  kitchen: 'Dapur',
};

/** Keterangan singkat peran — ditampilkan di halaman masuk. */
export const ROLE_TAGLINE: Record<UserRole, string> = {
  owner: 'Semua layar: kasir, menu, analitik, dan pengaturan',
  cashier: 'Layani transaksi dan kelola meja',
  kitchen: 'Papan kerja dapur dan catatan stok',
};
