-- ============================================================================
-- byorderkasir — data demo untuk backend Supabase
--
-- Jalankan SETELAH supabase/schema.sql, di SQL Editor yang sama.
--
-- Id-nya sengaja SAMA PERSIS dengan src/data/mock/seed.ts (mn-espresso,
-- tbl-1, demo-token-1, …). Dengan begitu demo berjalan identik di kedua
-- adapter — termasuk tautan QR meja yang sama — dan tidak ada perbedaan
-- perilaku yang cuma muncul karena datanya beda.
--
-- Berkas ini aman dijalankan berulang: setiap INSERT memakai ON CONFLICT.
--
-- ⚠  GANTI KATA SANDI DAN PIN SEBELUM DIPAKAI SUNGGUHAN.
--    Tiga akun di bawah adalah akun DEMO dengan kredensial yang sudah
--    tertulis terbuka di repositori ini dan di README. Selama masih begitu,
--    siapa pun yang pernah membaca repo ini bisa masuk sebagai pemilik.
--    Cara menggantinya ada di komentar di bagian "Akun demo" di bawah.
-- ============================================================================

-- ============================================================================
-- Toko & pengaturan
-- ============================================================================

insert into public.stores (id, name)
values ('store-demo', 'Kopi Senja')
on conflict (id) do update set name = excluded.name;

-- Pengaturan bersarang, bentuknya sama dengan tipe `StoreSettings` di klien.
-- Aplikasi aslinya menyimpan 46 kunci datar dengan duplikat yang saling
-- menimpa (`tax_percent` vs `tax_percent_pos` vs `tax_percent_qr`); di sini
-- setiap konsep punya satu tempat.
insert into public.settings (store_id, data)
values (
  'store-demo',
  jsonb_build_object(
    'name',      'Kopi Senja',
    'tagline',   'Kopi & Dapur Kecil',
    'address',   'Jl. Barista No. 1, Jakarta Timur',
    'phone',     '0812-3456-789',
    'logoUrl',   null,
    'currency',  'Rp',
    -- Belum ada di StoreSettings, tapi dibaca `app.store_tz`. Nomor antrian
    -- dan laporan harian direset per hari kalender TOKO, bukan hari UTC.
    'timezone',  'Asia/Jakarta',

    'tax', jsonb_build_object('percent', 10, 'channels', '[]'::jsonb),
    'serviceFee', jsonb_build_object('enabled', false, 'amount', 0, 'channels', '[]'::jsonb),

    'payments', jsonb_build_object(
      'qrisGateway', jsonb_build_object('enabled', true, 'channels', '["pos","qr"]'::jsonb),
      'qrisStatic', jsonb_build_object(
        'enabled', true,
        'channels', '["pos","qr"]'::jsonb,
        'imageUrl', null,
        -- QRIS statis contoh. Nominalnya disisipkan saat QR ditampilkan, jadi
        -- pelanggan tidak mengetik apa pun dan tidak bisa salah ketik.
        -- Ganti dengan QRIS toko sebenarnya.
        'payload',
          '00020101021126660014ID.CO.QRIS.WWW01189360091400000000000215ID10200000000000303UMI'
          '5204581253033605802ID5910KOPI SENJA6007JAKARTA6105121906304A4A4'
      ),
      'cash',    jsonb_build_object('enabled', true, 'channels', '["pos"]'::jsonb),
      'debit',   jsonb_build_object('enabled', true, 'channels', '["pos"]'::jsonb, 'provider', ''),
      'transfer', jsonb_build_object(
        'enabled', false,
        'channels', '["pos","qr"]'::jsonb,
        'bankName', 'BCA',
        'accountNumber', '1234567890',
        'accountHolder', 'Kopi Senja'
      ),
      'split',   jsonb_build_object('enabled', true, 'channels', '["pos"]'::jsonb),
      'uniqueCodeEnabled', true,
      'uniqueCodeRange', '[1,999]'::jsonb
    ),

    'receipt', jsonb_build_object(
      'customerFooter', E'Terima kasih atas kunjungan Anda!\nInstagram: @kopisenja',
      'kitchenFooter',  'Mohon segera dimasak & disajikan'
    ),

    'queue', jsonb_build_object('prefix', 'A', 'resetDaily', true),

    -- 5 dipilih karena untuk kafe, stok di bawah lima porsi berarti
    -- kemungkinan besar habis sebelum restock berikutnya.
    'stock', jsonb_build_object('lowStockThreshold', 5)
  )
)
on conflict (store_id) do update set data = excluded.data, updated_at = now();

-- ============================================================================
-- Kategori
-- ============================================================================

insert into public.categories (id, store_id, name, icon, sort_order, is_active) values
  ('cat-kopi',    'store-demo', 'Kopi',     'coffee',    1, true),
  ('cat-nonkopi', 'store-demo', 'Non-Kopi', 'cup',       2, true),
  ('cat-makanan', 'store-demo', 'Makanan',  'bowl',      3, true),
  ('cat-snack',   'store-demo', 'Snack',    'cookie',    4, true),
  ('cat-dessert', 'store-demo', 'Dessert',  'ice-cream', 5, true)
on conflict (id) do update set
  name = excluded.name, icon = excluded.icon,
  sort_order = excluded.sort_order, is_active = excluded.is_active;

-- ============================================================================
-- Menu
-- ============================================================================
--
-- Seluruh menu dilacak stoknya, dan sebagian sengaja sudah menipis di bawah
-- ambang (5). Kalau hanya beberapa yang dilacak — apalagi kalau menu teratas
-- di layar kasir bukan salah satunya — orang yang mencoba aplikasinya tidak
-- akan pernah melihat peringatan bahan maupun riwayat stok dari penjualan
-- biasa. Fiturnya ada, tapi tidak terlihat.

insert into public.menus (
  id, store_id, category_id, name, price, cost_price, description, sort_order, stock
) values
  ('mn-espresso',   'store-demo', 'cat-kopi',    'Espresso',           18000,  6000, 'Single shot, biji house blend',      1, 40),
  ('mn-americano',  'store-demo', 'cat-kopi',    'Americano',          22000,  6500, 'Espresso + air panas',               2, 35),
  ('mn-kopi-susu',  'store-demo', 'cat-kopi',    'Kopi Susu Senja',    25000,  9000, 'Signature, susu segar',              3, 18),
  ('mn-cappuccino', 'store-demo', 'cat-kopi',    'Cappuccino',         28000,  9500, 'Dengan foam lembut',                 4, 22),
  ('mn-latte',      'store-demo', 'cat-kopi',    'Caffè Latte',        28000,  9500, 'Espresso + susu steamed',            5, 20),
  ('mn-coldbrew',   'store-demo', 'cat-kopi',    'Cold Brew',          32000, 11000, 'Diseduh dingin 12 jam',              6,  8),

  ('mn-matcha',     'store-demo', 'cat-nonkopi', 'Matcha Latte',       30000, 12000, 'Matcha Jepang grade premium',        7,  4),
  ('mn-chocolate',  'store-demo', 'cat-nonkopi', 'Dark Chocolate',     28000, 10000, 'Cokelat 70%',                        8, 14),
  ('mn-teh',        'store-demo', 'cat-nonkopi', 'Teh Melati',         12000,  3000, 'Teh tubruk melati',                  9, 30),
  ('mn-air',        'store-demo', 'cat-nonkopi', 'Air Mineral',         6000,  2500, 'Botol 600ml',                       10, 48),
  ('mn-lemon-tea',  'store-demo', 'cat-nonkopi', 'Lemon Tea',          20000,  6000, 'Teh + lemon segar',                 11, 16),

  ('mn-nasgor',     'store-demo', 'cat-makanan', 'Nasi Goreng Senja',  32000, 15000, 'Telur mata sapi, kerupuk',          12,  9),
  ('mn-mie-goreng', 'store-demo', 'cat-makanan', 'Mie Goreng Spesial', 28000, 12000, 'Ayam, telur, sayur',                13,  7),
  ('mn-ayam-geprek','store-demo', 'cat-makanan', 'Ayam Geprek',        30000, 14000, 'Level 1-5, sambal bawang',          14, 11),
  ('mn-nasi-ayam',  'store-demo', 'cat-makanan', 'Nasi Ayam Bakar',    35000, 16000, 'Dengan lalapan',                    15, 12),
  ('mn-kentang',    'store-demo', 'cat-makanan', 'Kentang Goreng',     22000,  8000, 'Porsi sedang, saus mayo',           16, 24),

  ('mn-pisang',     'store-demo', 'cat-snack',   'Pisang Goreng Keju', 20000,  7000, '3 potong, keju cheddar',            17,  3),
  ('mn-roti-bakar', 'store-demo', 'cat-snack',   'Roti Bakar Cokelat', 18000,  6000, 'Dengan susu kental manis',          18, 10),
  ('mn-tahu-crispy','store-demo', 'cat-snack',   'Tahu Crispy',        16000,  5500, 'Sambal kecap',                      19, 20),

  ('mn-brownies',   'store-demo', 'cat-dessert', 'Brownies Fudge',     26000, 10000, 'Satu potong, hangat',               20,  6),
  ('mn-cheesecake', 'store-demo', 'cat-dessert', 'Cheesecake Slice',   34000, 14000, 'New York style',                    21,  4),
  ('mn-puding',     'store-demo', 'cat-dessert', 'Puding Karamel',     15000,  5000, 'Dingin, homemade',                  22,  2)
on conflict (id) do update set
  name = excluded.name, price = excluded.price, cost_price = excluded.cost_price,
  description = excluded.description, category_id = excluded.category_id,
  sort_order = excluded.sort_order, stock = excluded.stock,
  updated_at = now();

-- ============================================================================
-- Meja
-- ============================================================================
--
-- Token QR-nya sama dengan mode mock (demo-token-1 …), jadi tautan
-- `/order/?t=demo-token-1` berfungsi di kedua adapter.

insert into public.dining_tables (id, store_id, number, name, capacity, status, qr_token) values
  ('tbl-1', 'store-demo', 1, 'Meja 1', 2, 'available', 'demo-token-1'),
  ('tbl-2', 'store-demo', 2, 'Meja 2', 2, 'available', 'demo-token-2'),
  ('tbl-3', 'store-demo', 3, 'Meja 3', 2, 'available', 'demo-token-3'),
  ('tbl-4', 'store-demo', 4, 'Meja 4', 2, 'available', 'demo-token-4'),
  ('tbl-5', 'store-demo', 5, 'Meja 5', 4, 'available', 'demo-token-5'),
  ('tbl-6', 'store-demo', 6, 'Meja 6', 4, 'available', 'demo-token-6'),
  ('tbl-7', 'store-demo', 7, 'Meja 7', 4, 'available', 'demo-token-7'),
  ('tbl-8', 'store-demo', 8, 'Meja 8', 4, 'available', 'demo-token-8')
on conflict (id) do update set
  number = excluded.number, name = excluded.name,
  capacity = excluded.capacity, status = excluded.status;

-- ============================================================================
-- Akun demo — ⚠ GANTI SEBELUM DIPAKAI SUNGGUHAN
-- ============================================================================
--
-- Satu akun per peran. Peran melekat pada akunnya, bukan dipilih di layar
-- masuk: kalau pengguna bisa memilih sendiri "masuk sebagai pemilik",
-- pemisahan peran tidak ada gunanya.
--
-- Aplikasi aslinya hanya punya satu akun tanpa peran, dan PIN-nya ikut
-- terkirim ke peramban sehingga bisa dibaca siapa saja. Di sini yang tersimpan
-- hanya hash bcrypt, dan verifikasinya terjadi di fungsi `sign_in` —
-- tidak ada satu pun kredensial di dalam kode yang dikirim ke browser.
--
-- CARA MENGGANTI (jalankan di SQL Editor, ganti nilai di dalam tanda kutip):
--
--   update app.staff
--      set password_hash = crypt('sandi-baru-anda', gen_salt('bf', 10)),
--          pin_hash      = crypt('482913',          gen_salt('bf', 10))
--    where store_id = 'store-demo' and username = 'pemilik';
--
--   -- tambahkan akun baru:
--   insert into app.staff (id, store_id, username, display_name, role,
--                          password_hash, pin_hash)
--   values ('user-baru', 'store-demo', 'nama', 'Nama Tampilan', 'cashier',
--           crypt('sandi', gen_salt('bf', 10)),
--           crypt('123456', gen_salt('bf', 10)));
--
-- `gen_salt('bf', 10)` memakai bcrypt dengan 10 putaran — sama seperti yang
-- dipakai fungsi `crypt` saat memverifikasi, jadi tidak ada yang perlu
-- disetel di sisi aplikasi.

insert into app.staff (id, store_id, username, display_name, role, password_hash, pin_hash) values
  ('user-owner',   'store-demo', 'pemilik', 'Bu Sari', 'owner',
   crypt('pemilik123', gen_salt('bf', 10)), crypt('111111', gen_salt('bf', 10))),
  ('user-cashier', 'store-demo', 'kasir',   'Andi',    'cashier',
   crypt('kasir123',   gen_salt('bf', 10)), crypt('222222', gen_salt('bf', 10))),
  ('user-kitchen', 'store-demo', 'dapur',   'Dewi',    'kitchen',
   crypt('dapur123',   gen_salt('bf', 10)), crypt('333333', gen_salt('bf', 10)))
on conflict (id) do update set
  username = excluded.username, display_name = excluded.display_name,
  role = excluded.role;

-- ============================================================================
-- Catatan
-- ============================================================================
--
-- Order TIDAK diisi di sini, dan itu disengaja.
--
-- Adapter mock punya `seedDemoOrders()`, tapi di sana ordernya dibuat di dalam
-- proses yang sama dengan yang menghitung harganya. Di sini order yang disisipkan
-- lewat INSERT akan melewati `create_order` — fungsi yang justru menentukan
-- harga, nomor antrian, kode unik, dan pemotongan stok. Order hasil seed seperti
-- itu tidak membuktikan apa pun tentang jalur yang sebenarnya dipakai kasir.
--
-- Jadi: buat order lewat aplikasinya. Butuh sekitar sepuluh detik, dan sekaligus
-- menguji seluruh jalur — dari layar kasir sampai papan antrian TV.
