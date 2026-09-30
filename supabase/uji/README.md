# Uji backend

Skrip di folder ini menjalankan `../schema.sql` dan `../seed.sql` terhadap
Postgres **sungguhan**, lalu memanggil fungsinya satu per satu. Parser SQL
hanya bisa membuktikan sebuah berkas *bisa diurai*; hanya basis data yang
sungguhan bisa membuktikan ia *berjalan*.

Bedanya bukan teoretis. Uji inilah yang menemukan lima cacat pada skema ini
yang tidak terlihat oleh parser mana pun — termasuk satu klausa `on conflict`
yang kolomnya tidak cocok dengan indeks uniknya, sehingga **setiap**
pembuatan order gagal, dan dua fungsi yang dipanggil tapi tidak pernah
didefinisikan, sehingga pemilik tidak bisa menyimpan menu sama sekali.

## Menjalankannya

Butuh Node 22+ dan satu Postgres yang bisa dihubungi. Sambungannya dibaca dari
variabel standar libpq, jadi skrip yang sama bisa diarahkan ke Postgres lokal
maupun ke proyek Supabase tanpa diubah.

```bash
cd supabase/uji
npm install
```

### Ke Postgres lokal

Cara termudah: pakai `embedded-postgres`, yang menaruh biner Postgres asli di
`node_modules` — tanpa root, tanpa Docker.

```bash
npm install embedded-postgres
PGBIN=node_modules/@embedded-postgres/linux-x64/native/bin
export LD_LIBRARY_PATH=$PWD/node_modules/@embedded-postgres/linux-x64/native/lib

$PGBIN/initdb -D pgdata -U "$(whoami)" --encoding=UTF8 --locale=C
$PGBIN/pg_ctl -D pgdata -l pg.log \
  -o "-p 5599 -k $PWD/sock -c listen_addresses=127.0.0.1 -c fsync=off" start
```

`fsync=off` dan hanya `127.0.0.1`: ini basis data sekali pakai untuk pengujian,
bukan untuk produksi.

Lalu, dengan `PGHOST=127.0.0.1 PGPORT=5599` (nilai bawaan skrip):

```bash
npm run parse     # parser PostgreSQL asli, termasuk isi tubuh PL/pgSQL
npm run siapkan   # peran anon/authenticated + database kosong
npm run jalan     # terapkan schema.sql lalu seed.sql
npm run uji       # 81 uji fungsional
```

`siapkan` **menjatuhkan** database `byorder` dan membuatnya ulang. Karena itu
ia menolak berjalan kalau hostnya bukan mesin sendiri.

### Ke proyek Supabase

```bash
export PGHOST=db.<proyek>.supabase.co
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=<sandi-basis-data>
export PGDATABASE=postgres

npm run jalan     # JANGAN `siapkan` — perannya sudah ada, dan ia menjatuhkan database
npm run uji
```

Koneksi **langsung**, bukan pooler: uji di sini memakai transaksi,
`set local role`, dan fungsi `security definer`, yang semuanya butuh sesi
basis data yang sesungguhnya. Pooler mode transaksi memutus sesi itu di antara
pernyataan.

Uji ini menulis ke basis data. Arahkan ke proyek kosong, bukan ke proyek yang
sudah dipakai.

## Berkasnya

| Berkas | Gunanya |
|---|---|
| `koneksi.mjs` | Satu tempat untuk urusan sambungan, dibaca dari variabel libpq |
| `parse-sql.mjs` | Periksa sintaks dengan parser PostgreSQL asli, termasuk tubuh PL/pgSQL |
| `siapkan.mjs` | Peran Supabase + database kosong. **Lokal saja** |
| `jalan-sql.mjs` | Terapkan berkas SQL per-pernyataan, tunjuk yang gagal dengan barisnya |
| `uji-fungsi.mjs` | 81 uji fungsional: harga, stok, mesin keadaan, peran, izin |

## Yang diuji `uji-fungsi.mjs`

- **Harga ditentukan server.** Client mengirim `price: 1` dan `name: 'GRATIS'`;
  yang tersimpan tetap harga katalog. Sama untuk order dari meja.
- **Stok.** Berkurang sesuai pesanan, saldo pergerakannya cocok, dan
  pembatalan mengembalikan tepat sejumlah semula.
- **Kunci idempoten.** `clientKey` yang sama tidak membuat order kedua dan
  tidak memotong stok dua kali — jalur yang terjadi saat koneksi putus setelah
  order tersimpan tetapi sebelum jawabannya sampai.
- **Mesin keadaan.** Lompat ke `completed`, mundur ke `pending`, dan
  `completed` yang diubah lagi semuanya ditolak.
- **Peran.** Kasir tidak bisa mengubah harga atau pengaturan; dapur tidak bisa
  membuat order; kasir dan dapur tidak bisa mengubah ketersediaan menu.
- **Pengunjung anonim.** Tidak bisa menulis ke tabel mana pun, tidak bisa
  membaca tabel staf atau sesi, tidak bisa memanggil fungsi internal.

Uji izin berjalan dengan `set local role` di dalam transaksi yang dibatalkan.
Tanpa itu semuanya berjalan sebagai superuser — dan superuser tidak pernah
ditolak, sehingga setiap uji izin akan "lulus" tanpa membuktikan apa pun.
