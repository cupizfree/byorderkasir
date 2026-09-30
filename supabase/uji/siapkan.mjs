// Menyiapkan basis data uji LOKAL: peran Supabase + database kosong.
//
// PERINGATAN: skrip ini MENJATUHKAN database `byorder` dan membuatnya ulang.
// Karena itu ia menolak berjalan kalau hostnya bukan mesin sendiri — kalau
// diarahkan ke proyek Supabase, satu kesalahan ketik akan menghapus data
// sungguhan. Untuk Supabase, jalankan schema.sql dan seed.sql saja; peran
// `anon` dan `authenticated` sudah ada di sana dan tidak perlu dibuat.

import pg from 'pg';
import { KONFIG, LOKAL, label } from './koneksi.mjs';

const { Client } = pg;

if (!LOKAL) {
  console.error(`DITOLAK: skrip ini menjatuhkan database, dan ${label()} bukan mesin lokal.`);
  console.error('Untuk Supabase, cukup jalankan schema.sql lalu seed.sql lewat SQL Editor.');
  process.exit(2);
}

const DB = KONFIG.database;

const klien = new Client({ ...KONFIG, database: 'postgres' });
await klien.connect();
console.log(`Basis data: ${label()}`);

const peran = ['anon', 'authenticated', 'service_role', 'authenticator'];
for (const p of peran) {
  const ada = await klien.query('select 1 from pg_roles where rolname = $1', [p]);
  if (ada.rowCount === 0) {
    await klien.query(`create role ${p} nologin noinherit`);
    console.log(`peran dibuat:  ${p}`);
  } else {
    console.log(`peran ada:     ${p}`);
  }
}

// `realtime` adalah skema milik layanan Realtime Supabase. Skema kita
// memanggil `realtime.send` di dalam blok yang memeriksa keberadaannya, jadi
// ketiadaannya justru menguji jalur cadangan itu.
const adaRealtime = await klien.query("select 1 from pg_namespace where nspname = 'realtime'");
console.log(`skema realtime: ${adaRealtime.rowCount ? 'ada (akan dipakai)' : 'TIDAK ada — jalur cadangan yang diuji'}`);

// Nama database tidak bisa diparameterkan di DDL, jadi ia dirangkai ke dalam
// perintah. Karena itu diperiksa dulu: hanya huruf, angka, dan garis bawah.
if (!/^[a-z_][a-z0-9_]*$/.test(DB)) {
  console.error(`Nama database tidak wajar: ${DB}`);
  process.exit(2);
}

const adaDb = await klien.query('select 1 from pg_database where datname = $1', [DB]);
if (adaDb.rowCount === 0) {
  await klien.query(`create database ${DB}`);
  console.log(`database dibuat: ${DB}`);
} else {
  // Bersihkan supaya penerapan berikutnya mulai dari nol, bukan menumpuk
  // di atas sisa penerapan sebelumnya.
  await klien.query(`drop database if exists ${DB}`);
  await klien.query(`create database ${DB}`);
  console.log(`database dibuat ulang: ${DB}`);
}

await klien.end();
