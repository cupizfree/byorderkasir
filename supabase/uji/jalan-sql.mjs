// Menerapkan berkas SQL ke Postgres lokal, satu pernyataan pada satu waktu.
//
// Kenapa per-pernyataan: kalau seluruh berkas dikirim sebagai satu query,
// Postgres menghentikan semuanya di galat pertama dan posisi yang dilaporkan
// sering tidak ada (bergantung jenis galat). Dengan memotong lebih dulu, tiap
// pernyataan bisa dijalankan sendiri, dan yang gagal bisa ditunjuk lengkap:
// nomor baris, jenis pernyataan, nama objeknya, dan teksnya.
//
// Pemotongannya memakai `libpg-query` — parser PostgreSQL yang sama dengan
// yang dipakai server — jadi `$$`, tanda kutip, dan komentar tidak perlu
// dipahami sendiri. Perhatikan: `stmt_location` dan `stmt_len` adalah offset
// BYTE, bukan karakter, jadi pemotongan dilakukan pada Buffer.

import { readFileSync } from 'node:fs';
import pkg from 'libpg-query';
import { label, sambung } from './koneksi.mjs';

const { parse } = pkg;

const berkas = process.argv.slice(2);
if (berkas.length === 0) {
  console.error('pakai: node jalan-sql.mjs <berkas.sql> ...');
  process.exit(2);
}

/** Nama objek yang sedang dibuat, untuk laporan galat yang berguna. */
function namaObjek(stmt) {
  // Semuanya dibungkus try: ini hanya untuk mempercantik laporan galat, dan
  // alat yang mati karena tidak bisa memberi nama objek lebih buruk daripada
  // alat yang melaporkan galat tanpa nama objek.
  try {
    if (stmt.CreateFunctionStmt) {
      return stmt.CreateFunctionStmt.funcname.map((n) => n.String?.sval ?? '?').join('.');
    }
    if (stmt.CreateStmt) {
      return [stmt.CreateStmt.relation.schemaname, stmt.CreateStmt.relation.relname]
        .filter(Boolean)
        .join('.');
    }
    if (stmt.IndexStmt) return stmt.IndexStmt.idxname;
    if (stmt.CreatePolicyStmt) {
      return `${stmt.CreatePolicyStmt.policy_name} on ${stmt.CreatePolicyStmt.table.relname}`;
    }
    if (stmt.AlterTableStmt) return stmt.AlterTableStmt.relation.relname;
    if (stmt.InsertStmt) return stmt.InsertStmt.relation.relname;
    if (stmt.DropStmt) {
      // Bentuk node-nya berbeda-beda: kadang array, kadang simpul List dengan
      // isinya di `.items`.
      const daftar = stmt.DropStmt.objects ?? [];
      const nama = daftar.map((o) => {
        const bagian = Array.isArray(o?.List) ? o.List : (o?.List?.items ?? []);
        return bagian.map((x) => x?.String?.sval ?? x?.String?.sval ?? '?').join('.');
      });
      return nama.filter(Boolean).join(', ');
    }
  } catch {
    return '';
  }
  return '';
}

const klien = await sambung();
console.log(`Basis data: ${label()}`);

let gagal = 0;
let total = 0;

for (const f of berkas) {
  const buf = readFileSync(f);
  const sql = buf.toString('utf8');
  const potong = (loc, len) => buf.subarray(loc, len ? loc + len : undefined).toString('utf8');
  const barisDari = (loc) => sql.slice(0, loc).split('\n').length;

  let hasil;
  try {
    hasil = await parse(sql);
  } catch (e) {
    console.log(`GAGAL  ${f} — tidak bisa diurai: ${e.message}`);
    gagal += 1;
    continue;
  }

  let gagalDiSini = 0;
  const mulai = Date.now();

  for (const s of hasil.stmts) {
    let teks = potong(s.stmt_location, s.stmt_len).trim();
    if (!teks) continue;
    if (!teks.endsWith(';')) teks += ';';

    const baris = barisDari(s.stmt_location);
    const nama = namaObjek(s.stmt);
    total += 1;

    try {
      await klien.query(teks);
    } catch (e) {
      gagalDiSini += 1;
      gagal += 1;
      console.log(`GAGAL  ${f}:${baris}  [${e.code ?? '?'}] ${e.message}`);
      if (nama) console.log(`       objek: ${nama}`);
      if (e.hint) console.log(`       petunjuk: ${e.hint}`);
      if (e.detail) console.log(`       detail: ${e.detail}`);
      const ringkas = teks.split('\n').slice(0, 12).join('\n         ');
      console.log(`       teks:\n         ${ringkas}${teks.split('\n').length > 12 ? '\n         ...' : ''}`);
      // Satu berkas gagal → berhenti; sisanya pasti ikut gagal karena
      // ketergantungan, dan galat berikutnya hanya mengaburkan yang pertama.
      break;
    }
  }

  if (gagalDiSini === 0) {
    console.log(`LOLOS  ${f} — ${hasil.stmts.length} pernyataan, ${Date.now() - mulai} ms`);
  }
}

console.log(`\n${total} pernyataan dijalankan, ${gagal} gagal.`);
await klien.end();
process.exit(gagal === 0 ? 0 : 1);
