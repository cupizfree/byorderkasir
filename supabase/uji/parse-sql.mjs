// Memeriksa berkas SQL dengan parser PostgreSQL 18 yang asli (libpg-query).
//
// Dua lapis pemeriksaan:
//   1. Seluruh berkas diurai sebagai SQL biasa — menangkap `$$` yang tidak
//      tertutup, tanda kurung yang kurang, `create policy` yang salah bentuk.
//   2. Setiap fungsi PL/pgSQL diurai lagi ISI TUBUHNYA oleh parser plpgsql
//      milik Postgres — menangkap `end if;` yang hilang, `:=` yang salah,
//      variabel yang tidak dideklarasikan, dan sejenisnya. Ini yang paling
//      berguna, karena di situlah kesalahan biasanya bersembunyi.
//
// Yang TIDAK bisa ditangkap di sini adalah kesalahan semantik — kolom yang
// tidak ada, tipe yang tidak cocok, fungsi yang belum dibuat. Itu butuh server
// Postgres sungguhan.
import { readFileSync } from 'node:fs';
import pkg from 'libpg-query';
const { parse, parsePlPgSQL } = pkg;

const berkas = process.argv.slice(2);
if (berkas.length === 0) {
  console.error('pakai: node parse-sql.mjs <berkas.sql> ...');
  process.exit(2);
}

const label = (stmt) => {
  const s = stmt ?? {};
  if (s.CreateFunctionStmt) return 'fungsi';
  if (s.CreateStmt) return 'tabel';
  if (s.IndexStmt) return 'indeks';
  if (s.CreatePolicyStmt) return 'policy';
  if (s.AlterTableStmt) return 'alter';
  if (s.InsertStmt) return 'insert';
  if (s.GrantStmt) return 'grant';
  if (s.DropStmt) return 'drop';
  if (s.CreateSchemaStmt) return 'skema';
  if (s.CreateExtensionStmt) return 'ekstensi';
  if (s.DoStmt) return 'do';
  return 'lain';
};

let gagal = 0;

for (const f of berkas) {
  const sql = readFileSync(f, 'utf8');
  // `stmt_location` dan `stmt_len` dari libpg_query adalah offset BYTE, bukan
  // offset karakter. Berkas ini memuat banyak karakter multibyte (tanda pisah,
  // tanda kutip lengkung), jadi memotong string JavaScript dengan angka itu
  // akan meleset makin jauh di makin banyak pernyataan. Karena itu potongannya
  // diambil dari Buffer, lalu baru diterjemahkan ke teks.
  const buf = readFileSync(f);
  const potong = (loc, len) => buf.subarray(loc, len ? loc + len : undefined).toString('utf8');
  let hasil;
  try {
    hasil = await parse(sql);
  } catch (e) {
    gagal += 1;
    console.log(`GAGAL  ${f}  (SQL utama)`);
    console.log(`       ${e.message}`);
    if (e.cursorPosition) {
      const pos = Number(e.cursorPosition);
      console.log(`       di sekitar: ...${sql.slice(Math.max(0, pos - 120), pos + 120).replace(/\n/g, ' ')}...`);
    }
    continue;
  }

  const jenis = {};
  for (const s of hasil.stmts) {
    const t = label(s.stmt);
    jenis[t] = (jenis[t] ?? 0) + 1;
  }

  // Lapis kedua: urai isi tubuh setiap fungsi PL/pgSQL.
  let diperiksa = 0;
  const gagalFungsi = [];
  for (const s of hasil.stmts) {
    const fn = s.stmt?.CreateFunctionStmt;
    if (!fn) continue;

    const nama = fn.funcname?.map((n) => n.String?.sval ?? '?').join('.') ?? '?';
    // Parser plpgsql libpg-query menerima pernyataan CREATE FUNCTION yang utuh,
    // bukan hanya isi antara $$.
    let teks = potong(s.stmt_location, s.stmt_len);
    if (!teks.trimEnd().endsWith(';')) teks += ';';

    // Hanya fungsi plpgsql yang bisa diurai parser plpgsql. Fungsi `language sql`
    // sudah tercakup pemeriksaan lapis pertama.
    if (!/language\s+plpgsql/i.test(teks)) continue;

    diperiksa += 1;
    try {
      await parsePlPgSQL(teks);
    } catch (e) {
      gagalFungsi.push(`${nama}: ${e.message}`);
    }
  }

  if (gagalFungsi.length === 0) {
    console.log(`LOLOS  ${f}`);
    console.log(`       ${hasil.stmts.length} pernyataan ${JSON.stringify(jenis)}`);
    console.log(`       ${diperiksa} tubuh fungsi PL/pgSQL diurai, semua bersih`);
  } else {
    gagal += 1;
    console.log(`GAGAL  ${f}`);
    console.log(`       ${gagalFungsi.length} dari ${diperiksa} tubuh fungsi bermasalah:`);
    for (const g of gagalFungsi) console.log(`         - ${g}`);
  }
}

process.exit(gagal === 0 ? 0 : 1);
