// Satu tempat untuk urusan sambungan basis data.
//
// Membaca variabel standar libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD,
// PGDATABASE), jadi skrip di folder ini bisa diarahkan ke Postgres lokal
// maupun ke proyek Supabase tanpa diubah:
//
//   # Postgres lokal (lihat README.md di folder ini)
//   node uji-fungsi.mjs
//
//   # Proyek Supabase — koneksi LANGSUNG, bukan pooler
//   PGHOST=db.<proyek>.supabase.co PGPORT=5432 PGUSER=postgres \
//   PGPASSWORD=<sandi-basis-data> PGDATABASE=postgres \
//   node uji-fungsi.mjs
//
// Koneksi langsung, bukan pooler: uji di sini memakai transaksi, `set local
// role`, dan fungsi `security definer` — semuanya butuh sesi basis data yang
// sesungguhnya. Pooler mode transaksi memutus sesi itu di antara pernyataan.
//
// Catatan TLS: kalau hostnya bukan localhost dan PGSSLMODE tidak diset, TLS
// dinyalakan dengan `rejectUnauthorized: false`. Itu pilihan sadar untuk
// skrip uji yang menyambung ke basis data milik Anda sendiri, tetapi bukan
// yang Anda inginkan di jalur produksi.

import pg from 'pg';

const { Client } = pg;

export const KONFIG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5599),
  user: process.env.PGUSER ?? process.env.USER ?? 'hermes',
  database: process.env.PGDATABASE ?? 'byorder',
};

if (process.env.PGPASSWORD) KONFIG.password = process.env.PGPASSWORD;

/** Apakah sambungan ini ke mesin sendiri. Dipakai untuk memutuskan TLS. */
export const LOKAL = ['127.0.0.1', 'localhost', '::1'].includes(KONFIG.host);

const modeSsl = process.env.PGSSLMODE ?? (LOKAL ? 'disable' : 'require');
if (modeSsl !== 'disable') KONFIG.ssl = { rejectUnauthorized: false };

export async function sambung() {
  const klien = new Client(KONFIG);
  await klien.connect();
  return klien;
}

/** Alamat yang sedang dipakai, untuk dicetak di awal supaya tidak salah arah. */
export function label() {
  return `${KONFIG.host}:${KONFIG.port}/${KONFIG.database}`;
}
