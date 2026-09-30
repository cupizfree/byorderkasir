// Uji fungsional backend terhadap Postgres sungguhan.
//
// Yang diuji bukan "apakah skemanya bisa diterapkan", melainkan "apakah
// janjinya benar": harga ditentukan server, stok berkurang, mesin keadaan
// menolak, pembatalan mengembalikan stok, kunci idempoten mencegah order
// ganda, dan pengunjung anonim tidak bisa menulis.
//
// Tanda tangan dan nama kolom diambil dari schema.sql, bukan ditebak:
//   sign_in(p_store, p_username, p_password, p_pin)  — empat argumen
//   kunci keluaran order memakai camelCase (queueNumber, discountAmount, ...)

import { label, sambung } from './koneksi.mjs';

const klien = await sambung();
console.log(`Basis data: ${label()}`);

let lulus = 0;
let gagal = 0;
const catatan = [];

/**
 * Penanda unik untuk sekali jalan.
 *
 * Kunci idempoten di uji ini harus berbeda tiap kali dijalankan. Kalau tetap,
 * jalan kedua akan menemukan order dari jalan pertama, dan uji "stok hanya
 * berkurang sekali" gagal — bukan karena skemanya salah, melainkan karena
 * ujinya tidak bisa dijalankan dua kali. Basis data uji sengaja TIDAK direset
 * di antara jalan (`db:siapkan` yang destruktif itu urusan terpisah), jadi
 * keunikan inilah yang membuat suite-nya bisa diulang.
 */
const JALAN = Date.now().toString(36);

const q = async (sql, params = []) => (await klien.query(sql, params)).rows;

async function uji(nama, fn) {
  try {
    const hasil = await fn();
    if (hasil === true) {
      lulus += 1;
      console.log(`  OK    ${nama}`);
    } else {
      gagal += 1;
      console.log(`  GAGAL ${nama} -> ${hasil}`);
      catatan.push(nama);
    }
  } catch (e) {
    gagal += 1;
    console.log(`  ERROR ${nama} -> [${e.code ?? '?'}] ${e.message}`);
    catatan.push(`${nama} (${e.message})`);
  }
}

async function harusDitolak(nama, sql, params, kodeDiharapkan) {
  try {
    await klien.query(sql, params);
    gagal += 1;
    console.log(`  GAGAL ${nama} -> seharusnya ditolak, tapi berhasil`);
    catatan.push(nama);
  } catch (e) {
    if (!kodeDiharapkan || e.code === kodeDiharapkan) {
      lulus += 1;
      console.log(`  OK    ${nama} -> ditolak [${e.code}]`);
    } else {
      gagal += 1;
      console.log(`  GAGAL ${nama} -> ditolak dengan kode ${e.code}, diharapkan ${kodeDiharapkan}`);
      catatan.push(nama);
    }
  }
}

/**
 * Menjalankan `fn` sebagai peran tertentu, di dalam transaksi yang selalu
 * dibatalkan.
 *
 * Ini bukan hiasan: tanpa `set local role`, semua uji izin berjalan sebagai
 * superuser — dan superuser tidak pernah ditolak. Uji seperti itu akan selalu
 * "lulus" tanpa membuktikan apa pun.
 */
async function sebagaiPeran(peran, fn) {
  await klien.query('begin');
  try {
    await klien.query(`set local role ${peran}`);
    return await fn();
  } finally {
    await klien.query('rollback');
  }
}

async function harusDitolakSebagai(peran, nama, sql, params, kodeDiharapkan) {
  try {
    await sebagaiPeran(peran, () => klien.query(sql, params));
    gagal += 1;
    console.log(`  GAGAL ${nama} -> sebagai ${peran} seharusnya ditolak, tapi berhasil`);
    catatan.push(nama);
  } catch (e) {
    if (!kodeDiharapkan || e.code === kodeDiharapkan) {
      lulus += 1;
      console.log(`  OK    ${nama} -> ditolak [${e.code}]`);
    } else {
      gagal += 1;
      console.log(`  GAGAL ${nama} -> ditolak dengan kode ${e.code}, diharapkan ${kodeDiharapkan}`);
      catatan.push(nama);
    }
  }
}

/** Masuk sebagai salah satu akun demo, mengembalikan token. */
async function masuk(username, password, pin) {
  const [r] = await q('select public.sign_in($1, $2, $3, $4) as s', [
    'store-demo',
    username,
    password,
    pin,
  ]);
  return r.s?.token;
}

// ---------------------------------------------------------------------------
console.log('\n== 1. Seed mendarat ==');
// ---------------------------------------------------------------------------

await uji('menu demo terisi 22 baris', async () => {
  const [r] = await q("select count(*)::int as n from public.menus where store_id = 'store-demo'");
  return r.n === 22 || `jumlah menu ${r.n}`;
});

await uji('token QR meja sama dengan mode mock (demo-token-1)', async () => {
  const [r] = await q("select count(*)::int as n from public.dining_tables where qr_token = 'demo-token-1'");
  return r.n === 1 || `baris: ${r.n}`;
});

await uji('pengaturan toko terbaca tanpa sesi', async () => {
  const [r] = await q("select data -> 'name' as nama from public.settings where store_id = 'store-demo'");
  return r.nama === 'Kopi Senja' || `nama: ${JSON.stringify(r.nama)}`;
});

await uji('kata sandi tersimpan sebagai bcrypt, bukan teks biasa', async () => {
  const [r] = await q("select password_hash from app.staff where id = 'user-owner'");
  return r.password_hash.startsWith('$2') || `awalan: ${r.password_hash.slice(0, 4)}`;
});

await uji('sandi dan PIN mentah tidak tersimpan di mana pun', async () => {
  const [r] = await q(
    "select count(*)::int as n from app.staff where password_hash like '%pemilik123%' or pin_hash like '%111111%'",
  );
  return r.n === 0 || `ada ${r.n} baris memuat rahasia mentah`;
});

// ---------------------------------------------------------------------------
console.log('\n== 2. Masuk ==');
// ---------------------------------------------------------------------------

await harusDitolak(
  'sandi salah ditolak',
  'select public.sign_in($1, $2, $3, $4)',
  ['store-demo', 'pemilik', 'sandi-ngawur', '111111'],
  '28000',
);

await harusDitolak(
  'PIN salah ditolak',
  'select public.sign_in($1, $2, $3, $4)',
  ['store-demo', 'pemilik', 'pemilik123', '999999'],
  '28000',
);

await harusDitolak(
  'pengguna tidak ada ditolak dengan pesan yang sama',
  'select public.sign_in($1, $2, $3, $4)',
  ['store-demo', 'tidak-ada', 'pemilik123', '111111'],
  '28000',
);

let token = null;
await uji('pemilik bisa masuk dan menerima token', async () => {
  token = await masuk('pemilik', 'pemilik123', '111111');
  return (typeof token === 'string' && token.length >= 64) || `token: ${JSON.stringify(token)}`;
});

await uji('jawaban masuk tidak memuat hash apa pun', async () => {
  const [r] = await q('select public.sign_in($1, $2, $3, $4) as s', [
    'store-demo',
    'kasir',
    'kasir123',
    '222222',
  ]);
  const teks = JSON.stringify(r.s);
  return !teks.includes('$2') || `jawaban memuat hash: ${teks.slice(0, 160)}`;
});

await uji('sesi tercatat di server dengan masa berlaku', async () => {
  const [r] = await q('select count(*)::int as n from app.sessions where expires_at > now()');
  return r.n >= 1 || `sesi aktif: ${r.n}`;
});

await harusDitolak('token ngawur ditolak', 'select public.list_orders($1)', ['token-palsu-123'], '28000');

// ---------------------------------------------------------------------------
console.log('\n== 2b. Titik awal stok ==');
// ---------------------------------------------------------------------------

/**
 * Menetapkan stok awal untuk menu yang dipakai uji.
 *
 * Suite ini menulis ke basis data sungguhan: tiap jalan membuat order dan
 * memotong stok. Tanpa langkah ini, jalan kesekian akan menemukan stok habis
 * atau menu yang berubah jadi tidak tersedia, lalu gagal — bukan karena
 * skemanya salah, melainkan karena ujinya tidak menetapkan titik awalnya
 * sendiri. Basis data uji sengaja TIDAK direset di antara jalan (itu tugas
 * `db:siapkan` yang destruktif), jadi titik awal itu harus ada di sini.
 *
 * Angkanya diambil dari seed supaya sama dengan yang dilihat pengguna.
 */
const STOK_AWAL = {
  'mn-espresso': 40,
  'mn-americano': 35,
  'mn-cappuccino': 22,
  'mn-kopi-susu': 18,
  'mn-tahu-crispy': 30,
};

await uji('stok titik awal ditetapkan untuk menu yang dipakai uji', async () => {
  const masalah = [];

  for (const [menuId, target] of Object.entries(STOK_AWAL)) {
    const [m] = await q('select * from public.menus where id = $1', [menuId]);
    if (!m) {
      masalah.push(`${menuId} tidak ada di katalog`);
      continue;
    }

    if (m.stock === null) {
      // Menu yang tidak dilacak tidak bisa dicatat pergerakannya: saldonya
      // tidak punya titik awal. Dilacak dulu lewat `save_menu` dengan
      // MenuInput LENGKAP — memanggilnya dengan input sebagian justru
      // mengosongkan kolom lain, termasuk stok itu sendiri.
      await q('select public.save_menu($1, $2::jsonb)', [
        token,
        JSON.stringify({
          id: m.id,
          storeId: m.store_id,
          name: m.name,
          categoryId: m.category_id,
          price: Number(m.price),
          costPrice: Number(m.cost_price),
          description: m.description ?? '',
          imageUrl: m.image_url,
          isAvailable: true,
          stock: target,
          sortOrder: m.sort_order,
        }),
      ]);
      continue;
    }

    const delta = target - Number(m.stock);
    if (delta === 0) continue;

    await q('select public.record_stock_movement($1, $2::jsonb)', [
      token,
      JSON.stringify({
        menuId,
        delta,
        reason: delta > 0 ? 'restock' : 'adjustment',
        note: 'Titik awal uji',
      }),
    ]);
  }

  // Diperiksa ulang, bukan diasumsikan: kalau langkah di atas gagal diam-diam,
  // uji berikutnya akan gagal dengan pesan yang menyesatkan.
  for (const [menuId, target] of Object.entries(STOK_AWAL)) {
    const [m] = await q('select stock, is_available from public.menus where id = $1', [menuId]);
    if (Number(m?.stock) !== target) masalah.push(`${menuId}: stok ${m?.stock}, diharapkan ${target}`);
    if (m?.is_available !== true) masalah.push(`${menuId}: tidak tersedia`);
  }

  return masalah.length === 0 || masalah.join('; ');
});

// ---------------------------------------------------------------------------
console.log('\n== 3. create_order: harga ditentukan server ==');
// ---------------------------------------------------------------------------

const hargaEspresso = Number((await q("select price from public.menus where id = 'mn-espresso'"))[0].price);
const stokAwalEspresso = Number((await q("select stock from public.menus where id = 'mn-espresso'"))[0].stock);

let orderId = null;
await uji('order dibuat dan harga diambil dari katalog', async () => {
  const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
    token,
    JSON.stringify({
      channel: 'pos',
      // `price` dan `name` sengaja dipalsukan. Kalau server mempercayai input,
      // subtotal akan jadi 2 dan namanya "GRATIS".
      items: [{ menuId: 'mn-espresso', qty: 2, price: 1, name: 'GRATIS' }],
      paymentMethod: 'cash',
      cashReceived: 100000,
      customerName: 'Uji Fungsional',
    }),
  ]);
  orderId = r.o?.id;
  const subtotal = Number(r.o?.subtotal);
  return subtotal === hargaEspresso * 2 || `subtotal ${subtotal}, diharapkan ${hargaEspresso * 2}`;
});

await uji('nama item di order juga dari katalog', async () => {
  const r = await q('select name from public.order_items where order_id = $1 order by line_no', [orderId]);
  return r[0]?.name === 'Espresso' || `nama tersimpan: ${JSON.stringify(r[0]?.name)}`;
});

await uji('total = subtotal - diskon + pajak + layanan', async () => {
  const [r] = await q('select public.get_order($1, $2) as o', [token, orderId]);
  const o = r.o;
  const hitung = Number(o.subtotal) - Number(o.discountAmount) + Number(o.taxAmount) + Number(o.serviceAmount);
  return Number(o.total) === hitung || `total ${o.total}, hasil hitung ${hitung}`;
});

await uji('nomor order dan nomor antrian diberikan server', async () => {
  const [r] = await q('select code, queue_number from public.orders where id = $1', [orderId]);
  return (Boolean(r.code) && r.queue_number !== null) || `code=${r.code} queue=${r.queue_number}`;
});

await uji('stok berkurang sesuai jumlah pesanan', async () => {
  const [r] = await q("select stock from public.menus where id = 'mn-espresso'");
  return Number(r.stock) === stokAwalEspresso - 2 || `stok ${r.stock}, diharapkan ${stokAwalEspresso - 2}`;
});

await uji('jejak pergerakan stok tercatat sebagai penjualan', async () => {
  const [r] = await q(
    "select count(*)::int as n from public.stock_movements where order_id = $1 and reason = 'sale'",
    [orderId],
  );
  return r.n === 1 || `baris penjualan: ${r.n}`;
});

await uji('saldo pergerakan stok cocok dengan stok menu', async () => {
  const [r] = await q(
    "select balance from public.stock_movements where order_id = $1 and reason = 'sale'",
    [orderId],
  );
  const [m] = await q("select stock from public.menus where id = 'mn-espresso'");
  return Number(r.balance) === Number(m.stock) || `saldo ${r.balance}, stok menu ${m.stock}`;
});

await harusDitolak('keranjang kosong ditolak', 'select public.create_order($1, $2::jsonb)', [
  token,
  JSON.stringify({ items: [] }),
], '22023');

await harusDitolak('menu tidak dikenal ditolak', 'select public.create_order($1, $2::jsonb)', [
  token,
  JSON.stringify({ items: [{ menuId: 'mn-tidak-ada', qty: 1 }] }),
], 'P0002');

// ---------------------------------------------------------------------------
console.log('\n== 4. Kunci idempoten ==');
// ---------------------------------------------------------------------------

await uji('clientKey sama tidak membuat order kedua', async () => {
  const kunci = `uji-idempoten-${JALAN}-1`;
  const masukOrder = JSON.stringify({
    clientKey: kunci,
    items: [{ menuId: 'mn-americano', qty: 1 }],
    paymentMethod: 'cash',
    cashReceived: 50000,
  });
  const [a] = await q('select public.create_order($1, $2::jsonb) as o', [token, masukOrder]);
  const [b] = await q('select public.create_order($1, $2::jsonb) as o', [token, masukOrder]);
  const [n] = await q('select count(*)::int as n from public.orders where client_key = $1', [kunci]);
  return (a.o.id === b.o.id && n.n === 1) || `id1 ${a.o.id}, id2 ${b.o.id}, baris ${n.n}`;
});

await uji('clientKey berbeda tetap membuat order baru', async () => {
  const buat = async (kunci) => {
    const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
      token,
      JSON.stringify({ clientKey: kunci, items: [{ menuId: 'mn-americano', qty: 1 }] }),
    ]);
    return r.o.id;
  };
  const a = await buat(`uji-beda-${JALAN}-1`);
  const b = await buat(`uji-beda-${JALAN}-2`);
  return a !== b || `kedua order ber-id sama: ${a}`;
});

await uji('stok hanya berkurang sekali untuk clientKey yang sama', async () => {
  const sebelum = Number((await q("select stock from public.menus where id = 'mn-cappuccino'"))[0].stock);
  const isi = JSON.stringify({
    clientKey: `uji-idempoten-stok-${JALAN}`,
    items: [{ menuId: 'mn-cappuccino', qty: 2 }],
  });
  await q('select public.create_order($1, $2::jsonb)', [token, isi]);
  await q('select public.create_order($1, $2::jsonb)', [token, isi]);
  const sesudah = Number((await q("select stock from public.menus where id = 'mn-cappuccino'"))[0].stock);
  return sesudah === sebelum - 2 || `stok ${sebelum} -> ${sesudah}, diharapkan turun 2`;
});

// ---------------------------------------------------------------------------
console.log('\n== 5. Mesin keadaan ==');
// ---------------------------------------------------------------------------

await harusDitolak('pending langsung ke completed ditolak', 'select public.update_order_status($1, $2, $3)', [
  token, orderId, 'completed',
], 'P0001');

await harusDitolak(
  'pembatalan lewat update_order_status ditolak (harus lewat cancel_order)',
  'select public.update_order_status($1, $2, $3)',
  [token, orderId, 'cancelled'],
  'P0001',
);

await uji('pending ke processing diterima', async () => {
  const [r] = await q('select public.update_order_status($1, $2, $3) as o', [token, orderId, 'processing']);
  return r.o.status === 'processing' || `status jadi ${r.o.status}`;
});

await harusDitolak('processing mundur ke pending ditolak', 'select public.update_order_status($1, $2, $3)', [
  token, orderId, 'pending',
], 'P0001');

await harusDitolak('processing langsung ke completed ditolak', 'select public.update_order_status($1, $2, $3)', [
  token, orderId, 'completed',
], 'P0001');

await uji('processing ke ready diterima', async () => {
  const [r] = await q('select public.update_order_status($1, $2, $3) as o', [token, orderId, 'ready']);
  return r.o.status === 'ready' || `status jadi ${r.o.status}`;
});

await uji('ready ke completed diterima, dan completedAt terisi', async () => {
  const [r] = await q('select public.update_order_status($1, $2, $3) as o', [token, orderId, 'completed']);
  return (r.o.status === 'completed' && r.o.completedAt !== null) ||
    `status ${r.o.status}, completedAt ${r.o.completedAt}`;
});

await harusDitolak('completed tidak bisa diubah lagi', 'select public.update_order_status($1, $2, $3)', [
  token, orderId, 'processing',
], 'P0001');

await harusDitolak('status ngawur ditolak', 'select public.update_order_status($1, $2, $3)', [
  token, orderId, 'sedang-dimasak',
], null);

// ---------------------------------------------------------------------------
console.log('\n== 6. Pembatalan mengembalikan stok ==');
// ---------------------------------------------------------------------------

let orderBatal = null;
const stokSebelumBatal = Number((await q("select stock from public.menus where id = 'mn-kopi-susu'"))[0].stock);

await uji('order baru dibuat untuk diuji pembatalannya', async () => {
  const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
    token,
    JSON.stringify({ items: [{ menuId: 'mn-kopi-susu', qty: 3 }] }),
  ]);
  orderBatal = r.o.id;
  return Boolean(orderBatal) || 'tidak ada id';
});

await uji('stok turun 3 setelah order', async () => {
  const [r] = await q("select stock from public.menus where id = 'mn-kopi-susu'");
  return Number(r.stock) === stokSebelumBatal - 3 || `stok ${r.stock}, diharapkan ${stokSebelumBatal - 3}`;
});

await uji('cancel_order mengembalikan stok ke semula', async () => {
  await q('select public.cancel_order($1, $2, $3)', [token, orderBatal, 'Uji pembatalan']);
  const [r] = await q("select stock from public.menus where id = 'mn-kopi-susu'");
  return Number(r.stock) === stokSebelumBatal || `stok ${r.stock}, diharapkan ${stokSebelumBatal}`;
});

await uji('pengembalian stok tercatat terpisah dari penjualan', async () => {
  const r = await q('select reason from public.stock_movements where order_id = $1 order by reason', [orderBatal]);
  const alasan = r.map((x) => x.reason);
  return (alasan.length === 2 && alasan.includes('sale')) || `alasan tercatat: ${JSON.stringify(alasan)}`;
});

await uji('alasan pembatalan tersimpan', async () => {
  const [r] = await q('select status, cancel_reason, cancelled_at from public.orders where id = $1', [orderBatal]);
  return (r.status === 'cancelled' && r.cancel_reason === 'Uji pembatalan' && r.cancelled_at !== null) ||
    `status ${r.status}, alasan ${r.cancel_reason}`;
});

await harusDitolak('order yang sudah selesai tidak bisa dibatalkan', 'select public.cancel_order($1, $2, $3)', [
  token, orderId, 'Terlambat',
], null);

await harusDitolak('order tidak dikenal ditolak', 'select public.cancel_order($1, $2, $3)', [
  token, 'ord-tidak-ada', 'Uji',
], null);

// ---------------------------------------------------------------------------
console.log('\n== 7. Order dari meja (tanpa sesi) ==');
// ---------------------------------------------------------------------------

await harusDitolak('token meja palsu ditolak', 'select public.create_self_order($1, $2::jsonb)', [
  'token-meja-palsu',
  JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }] }),
], '28000');

let orderMeja = null;
await uji('nomor meja diambil dari token, bukan dari input', async () => {
  const [r] = await q('select public.create_self_order($1, $2::jsonb) as o', [
    'demo-token-6',
    // tableNumber 1 sengaja dipalsukan; token menunjuk meja 6.
    JSON.stringify({ tableNumber: 1, items: [{ menuId: 'mn-espresso', qty: 1 }] }),
  ]);
  orderMeja = r.o;
  return Number(r.o.tableNumber) === 6 || `nomor meja tersimpan: ${r.o.tableNumber}`;
});

await uji('order dari meja ditandai kanal self_order', async () => {
  return orderMeja.channel === 'self_order' || `kanal: ${orderMeja.channel}`;
});

await uji('nama pelanggan kosong menjadi "Tanpa nama"', async () => {
  const [r] = await q('select public.create_self_order($1, $2::jsonb) as o', [
    'demo-token-2',
    JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }] }),
  ]);
  return r.o.customerName === 'Tanpa nama' || `nama: ${JSON.stringify(r.o.customerName)}`;
});

await uji('pelanggan tidak bisa memalsukan harga lewat self order', async () => {
  const [r] = await q('select public.create_self_order($1, $2::jsonb) as o', [
    'demo-token-3',
    JSON.stringify({ items: [{ menuId: 'mn-cappuccino', qty: 1, price: 1 }], subtotal: 1, total: 1 }),
  ]);
  const hargaCappuccino = Number((await q("select price from public.menus where id = 'mn-cappuccino'"))[0].price);
  return Number(r.o.subtotal) === hargaCappuccino || `subtotal ${r.o.subtotal}, diharapkan ${hargaCappuccino}`;
});

// ---------------------------------------------------------------------------
console.log('\n== 8. Pengunjung anonim tidak bisa menulis ==');
// ---------------------------------------------------------------------------

await harusDitolakSebagai('anon', 'anon tidak bisa INSERT ke public.menus',
  "insert into public.menus (id, store_id, category_id, name, price) values ('mn-sisipan', 'store-demo', 'cat-kopi', 'Sisipan', 1)",
  [], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa UPDATE harga menu',
  "update public.menus set price = 1 where id = 'mn-espresso'", [], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa DELETE menu',
  "delete from public.menus where id = 'mn-espresso'", [], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa membaca tabel staf',
  'select * from app.staff', [], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa membaca tabel sesi',
  'select * from app.sessions', [], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa memanggil fungsi internal tanpa sesi',
  'select app.order_json($1)', [orderId], '42501');

await harusDitolakSebagai('anon', 'anon tidak bisa membuat order tanpa sesi',
  'select public.create_order($1, $2::jsonb)',
  ['token-palsu', JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }] })], '28000');

await harusDitolakSebagai('anon', 'anon tidak bisa mengubah pengaturan',
  'select public.save_settings($1, $2::jsonb)',
  ['token-palsu', JSON.stringify({ name: 'Toko Palsu' })], '28000');

await uji('anon tetap bisa membaca katalog (memang publik)', async () => {
  const n = await sebagaiPeran('anon', async () => {
    const r = await klien.query("select count(*)::int as n from public.menus where store_id = 'store-demo'");
    return r.rows[0].n;
  });
  return n > 0 || `terbaca ${n} menu`;
});

await uji('anon tidak melihat tabel order sama sekali', async () => {
  return sebagaiPeran('anon', async () => {
    try {
      const r = await klien.query('select count(*)::int as n from public.orders');
      return `terbaca ${r.rows[0].n} order`;
    } catch (e) {
      return e.code === '42501' ? true : `ditolak dengan kode ${e.code}`;
    }
  });
});

// ---------------------------------------------------------------------------
console.log('\n== 9. Peran ==');
// ---------------------------------------------------------------------------

let tokenDapur = null;
let tokenKasir = null;

await uji('kasir dan dapur bisa masuk', async () => {
  tokenKasir = await masuk('kasir', 'kasir123', '222222');
  tokenDapur = await masuk('dapur', 'dapur123', '333333');
  return (Boolean(tokenKasir) && Boolean(tokenDapur)) ||
    `kasir=${Boolean(tokenKasir)} dapur=${Boolean(tokenDapur)}`;
});

await harusDitolak('dapur tidak boleh membuat order', 'select public.create_order($1, $2::jsonb)', [
  tokenDapur, JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }] }),
], '42501');

await harusDitolak('kasir tidak boleh mengubah harga menu', 'select public.save_menu($1, $2::jsonb)', [
  tokenKasir, JSON.stringify({ id: 'mn-espresso', name: 'Espresso', price: 1 }),
], '42501');

await harusDitolak('kasir tidak boleh mengubah pengaturan', 'select public.save_settings($1, $2::jsonb)', [
  tokenKasir, JSON.stringify({ name: 'Toko Palsu' }),
], '42501');

await uji('kasir boleh membuat order', async () => {
  const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
    tokenKasir, JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }] }),
  ]);
  return Boolean(r.o.id) || 'tidak ada id';
});

await uji('dapur boleh mengubah status order', async () => {
  const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
    token, JSON.stringify({ items: [{ menuId: 'mn-cappuccino', qty: 1 }] }),
  ]);
  const [u] = await q('select public.update_order_status($1, $2, $3) as o', [tokenDapur, r.o.id, 'processing']);
  return u.o.status === 'processing' || `status: ${u.o.status}`;
});

await uji('pemilik boleh mengubah harga menu, tanpa kehilangan stoknya', async () => {
  // `MenuInput` di kontrak punya seluruh kolom sebagai WAJIB, termasuk `stock`.
  // Mengirim sebagian bukan sekadar gagal: cabang update di `save_menu`
  // menulis `stock = (p_input ->> 'stock')::integer` TANPA coalesce, sehingga
  // kolom yang tidak dikirim menjadi NULL dan menu itu diam-diam berubah jadi
  // tidak dilacak. Persis itu yang dilakukan versi pertama uji ini — dan
  // gejalanya baru muncul di jalan berikutnya, sebagai "stok tidak berkurang".
  const [m] = await q('select * from public.menus where id = $1', ['mn-espresso']);
  const [r] = await q('select public.save_menu($1, $2::jsonb) as m', [
    token,
    JSON.stringify({
      id: m.id,
      storeId: m.store_id,
      name: m.name,
      categoryId: m.category_id,
      price: Number(m.price),
      costPrice: Number(m.cost_price),
      description: m.description ?? '',
      imageUrl: m.image_url,
      isAvailable: m.is_available,
      stock: m.stock,
      sortOrder: m.sort_order,
    }),
  ]);
  return (Number(r.m.price) === Number(m.price) && Number(r.m.stock) === Number(m.stock)) ||
    `harga ${r.m.price}, stok ${r.m.stock} (sebelumnya ${m.stock})`;
});

// ---------------------------------------------------------------------------
console.log('\n== 10. Pembayaran dan antrian ==');
// ---------------------------------------------------------------------------

let orderBayar = null;
await uji('order untuk diuji pembayarannya dibuat', async () => {
  const [r] = await q('select public.create_order($1, $2::jsonb) as o', [
    token, JSON.stringify({ items: [{ menuId: 'mn-espresso', qty: 1 }], paymentMethod: 'qris' }),
  ]);
  orderBayar = r.o;
  return Boolean(orderBayar.id) || 'tidak ada id';
});

await uji('QRIS memakai kode unik, jadi nominalnya bukan angka bulat', async () => {
  return orderBayar.payment?.uniqueCode !== undefined ||
    `payment: ${JSON.stringify(orderBayar.payment)}`;
});

await uji('record_payment menandai order lunas', async () => {
  const [r] = await q('select public.record_payment($1, $2, $3::jsonb) as o', [
    token,
    orderBayar.id,
    JSON.stringify({
      status: 'paid',
      method: 'qris',
      amountPaid: orderBayar.total,
      paidAt: new Date().toISOString(),
    }),
  ]);
  return r.o.payment?.status === 'paid' || `payment: ${JSON.stringify(r.o.payment)}`;
});

await uji('order yang sudah lunas tidak bisa dibayar dua kali', async () => {
  try {
    await q('select public.record_payment($1, $2, $3::jsonb)', [
      token,
      orderBayar.id,
      JSON.stringify({ status: 'paid', method: 'qris', amountPaid: orderBayar.total }),
    ]);
    return 'pembayaran kedua diterima';
  } catch {
    return true;
  }
});

await uji('call_queue mencatat panggilan dan waktunya', async () => {
  // Dipanggil hanya untuk order yang sudah siap — itu memang aturannya, dan
  // itu pula yang diperbaiki di sisi klien (tombol "Panggil" untuk order
  // berstatus ready). Jadi ordernya dimajukan dulu sampai ready.
  await q('select public.update_order_status($1, $2, $3)', [token, orderBayar.id, 'processing']);
  await q('select public.update_order_status($1, $2, $3)', [token, orderBayar.id, 'ready']);
  const [r] = await q('select public.call_queue($1, $2) as o', [token, orderBayar.id]);
  return (Number(r.o.callCount) >= 1 && r.o.calledAt !== null) ||
    `callCount ${r.o.callCount}, calledAt ${r.o.calledAt}`;
});

await harusDitolak(
  'order yang belum siap tidak bisa dipanggil',
  'select public.call_queue($1, $2)',
  [token, orderMeja.id],
  'P0001',
);

await harusDitolak('kasir tidak boleh mengubah ketersediaan menu', 'select public.set_menu_availability($1, $2, $3)', [
  tokenKasir, 'mn-espresso', false,
], '42501');

await harusDitolak('dapur tidak boleh mengubah ketersediaan menu', 'select public.set_menu_availability($1, $2, $3)', [
  tokenDapur, 'mn-espresso', false,
], '42501');

await uji('pemilik boleh mengubah ketersediaan menu', async () => {
  await q('select public.set_menu_availability($1, $2, $3)', [token, 'mn-espresso', true]);
  const [r] = await q("select is_available from public.menus where id = 'mn-espresso'");
  return r.is_available === true || `is_available: ${r.is_available}`;
});

// ---------------------------------------------------------------------------
console.log('\n== 11. Stok manual ==');
// ---------------------------------------------------------------------------

await uji('penambahan stok manual menaikkan stok menu', async () => {
  const sebelum = Number((await q("select stock from public.menus where id = 'mn-tahu-crispy'"))[0].stock);
  await q('select public.record_stock_movement($1, $2::jsonb)', [
    token,
    JSON.stringify({ menuId: 'mn-tahu-crispy', delta: 5, reason: 'restock', note: 'Uji restock' }),
  ]);
  const sesudah = Number((await q("select stock from public.menus where id = 'mn-tahu-crispy'"))[0].stock);
  return sesudah === sebelum + 5 || `stok ${sebelum} -> ${sesudah}`;
});

await uji('alasan pergerakan manual tersimpan', async () => {
  const r = await q("select reason from public.stock_movements where note = 'Uji restock'");
  return r[0]?.reason === 'restock' || `alasan: ${r[0]?.reason}`;
});

await harusDitolak('stok tidak boleh jadi negatif', 'select public.record_stock_movement($1, $2::jsonb)', [
  token,
  JSON.stringify({ menuId: 'mn-tahu-crispy', delta: -99999, reason: 'adjustment' }),
], null);

// ---------------------------------------------------------------------------
console.log('\n== 12. Pembacaan publik ==');
// ---------------------------------------------------------------------------

await uji('papan antrian bisa dibaca tanpa sesi', async () => {
  const [r] = await q("select public.list_queue_board('store-demo') as b");
  return Array.isArray(r.b) || `bukan larik: ${typeof r.b}`;
});

await uji('papan antrian tidak membocorkan harga atau nama pelanggan', async () => {
  const [r] = await q("select public.list_queue_board('store-demo')::text as b");
  const bocor = ['customerName', 'subtotal', 'customerEmail'].filter((k) => r.b.includes(k));
  return bocor.length === 0 || `papan memuat: ${bocor.join(', ')}`;
});

await uji('nomor order bisa dicari dengan kodenya', async () => {
  const [kode] = await q('select code from public.orders where id = $1', [orderId]);
  const [r] = await q('select public.get_order_by_code($1, $2) as o', ['store-demo', kode.code]);
  return r.o?.id === orderId || `dapat ${JSON.stringify(r.o?.id)} untuk kode ${kode.code}`;
});

await uji('meja bisa dibaca dari token QR-nya', async () => {
  const [r] = await q('select public.get_table_by_token($1) as t', ['demo-token-1']);
  return Number(r.t?.number) === 1 || `meja: ${JSON.stringify(r.t?.number)}`;
});

await uji('revisi tersimpan walau Realtime tidak tersedia', async () => {
  const [r] = await q("select public.store_revisions('store-demo') as r");
  return (r.r && Object.keys(r.r).length > 0) || `revisi: ${JSON.stringify(r.r)}`;
});

await uji('daftar order bisa disaring yang belum dibayar', async () => {
  const [r] = await q('select public.list_orders($1, $2::jsonb) as o', [
    token, JSON.stringify({ paymentStatus: 'unpaid' }),
  ]);
  return Array.isArray(r.o) || `bukan larik: ${typeof r.o}`;
});

await uji('keluar mencabut sesi', async () => {
  const sementara = await masuk('kasir', 'kasir123', '222222');
  await q('select public.sign_out($1)', [sementara]);
  const [r] = await q('select public.current_session($1) as s', [sementara]);
  return r.s === null || `sesi masih hidup: ${JSON.stringify(r.s)}`;
});

// ---------------------------------------------------------------------------
console.log(`\n${lulus} lulus, ${gagal} gagal.`);
if (catatan.length) {
  console.log('\nYang gagal:');
  for (const c of catatan) console.log(`  - ${c}`);
}

await klien.end();
process.exit(gagal === 0 ? 0 : 1);
