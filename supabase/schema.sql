-- ============================================================================
-- byorderkasir — skema backend Supabase
--
-- Cara pakai: buka SQL Editor di dasbor Supabase, tempel seluruh berkas ini,
-- jalankan. Lalu jalankan supabase/seed.sql untuk data demo.
--
-- Prinsip yang dipegang (sama dengan lapisan domain, tapi sekarang ditegakkan
-- di tempat yang tidak bisa dibaca dari DevTools):
--
--  1. **Harga ditentukan server.** `create_order` mencari harga dari tabel
--     `menus`, bukan dari yang dikirim client. Aplikasi aslinya menghitung
--     total di browser lalu menyimpannya — artinya harga bisa diubah dari
--     konsol peramban sebelum order dikirim.
--  2. **Tidak ada PIN atau kata sandi di dalam kode yang dikirim ke browser.**
--     Verifikasi terjadi di fungsi `sign_in` (security definer), dan yang
--     tersimpan hanya hash bcrypt.
--  3. **Penulisan hanya lewat fungsi.** Tidak ada satu pun policy INSERT /
--     UPDATE / DELETE di skema `public`. Kunci anon yang bocor tidak bisa
--     menulis apa pun — sedangkan di aplikasi aslinya endpoint admin terbuka.
--  4. **Mesin keadaan order ditegakkan di sini.** `update_order_status`
--     menolak transisi yang tidak sah, termasuk jalur yang datang dari antrean
--     luring yang dikirim ulang.
--
-- Skema `app` sengaja TIDAK diekspos PostgREST. Tabel staf, sesi, penghitung
-- nomor, dan revisi realtime hidup di sana dan tidak bisa dibaca lewat API
-- walau dengan kunci anon.
-- ============================================================================

create extension if not exists pgcrypto;
create schema if not exists app;

-- ============================================================================
-- Tabel internal (tidak diekspos API)
-- ============================================================================

create table if not exists app.staff (
  id            text primary key,
  store_id      text not null,
  username      text not null,
  display_name  text not null,
  role          text not null check (role in ('owner', 'cashier', 'kitchen')),
  password_hash text not null,
  pin_hash      text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create unique index if not exists staff_username_uniq
  on app.staff (store_id, lower(username));

create table if not exists app.sessions (
  token        text primary key,
  staff_id     text not null references app.staff(id) on delete cascade,
  store_id     text not null,
  role         text not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists sessions_expires_idx on app.sessions (expires_at);

-- Penghitung nomor urut harian. Dipisah per jenis (`order_seq`, `queue`) dan
-- per tanggal lokal toko, supaya reset harian tidak butuh timer apa pun —
-- kalau server sempat mati semalaman, nomor tetap benar saat hidup lagi.
create table if not exists app.counters (
  store_id   text not null,
  kind       text not null,
  date_key   text not null,
  last_value integer not null default 0,
  primary key (store_id, kind, date_key)
);

-- Revisi per cakupan, satu baris per (toko, cakupan). Naik setiap ada
-- perubahan; nilainya disiarkan lewat Realtime sebagai SINYAL — client lalu
-- mengambil ulang datanya lewat pembacaan biasa. Inilah yang menggantikan
-- polling 1,2 detik di aplikasi aslinya.
create table if not exists app.store_revision (
  store_id text not null,
  scope    text not null,
  revision bigint not null default 0,
  at       timestamptz not null default now(),
  primary key (store_id, scope)
);

-- ============================================================================
-- Tabel yang diekspos (dibaca client, ditulis hanya lewat fungsi)
-- ============================================================================

create table if not exists public.stores (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Pengaturan bersarang dalam satu kolom jsonb. Aplikasi aslinya menyimpan 46
-- kunci datar dengan duplikat yang saling menimpa (`tax_percent` vs
-- `tax_percent_pos` vs `tax_percent_qr`) — di sini setiap konsep punya satu
-- tempat, dan bentuknya persis sama dengan tipe `StoreSettings` di klien.
create table if not exists public.settings (
  store_id   text primary key references public.stores(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id         text primary key,
  store_id   text not null references public.stores(id) on delete cascade,
  name       text not null,
  icon       text not null default 'box',
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

create index if not exists categories_store_idx on public.categories (store_id, sort_order);

create table if not exists public.menus (
  id           text primary key,
  store_id     text not null references public.stores(id) on delete cascade,
  category_id  text references public.categories(id) on delete set null,
  name         text not null,
  price        integer not null check (price >= 0),
  cost_price   integer not null default 0 check (cost_price >= 0),
  description  text not null default '',
  image_url    text,
  is_available boolean not null default true,
  -- `null` = tidak dilacak. Aplikasi aslinya memakai string kosong "" untuk
  -- kasus ini, yang ambigu dengan "stok habis". Di sini dibedakan tegas, dan
  -- CHECK di bawah menjamin stok tidak pernah bisa jadi minus.
  stock        integer check (stock is null or stock >= 0),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists menus_store_idx on public.menus (store_id, sort_order);
create index if not exists menus_low_stock_idx on public.menus (store_id, stock)
  where stock is not null;

create table if not exists public.dining_tables (
  id       text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  number   integer not null,
  name     text not null,
  capacity integer not null default 4 check (capacity > 0),
  status   text not null default 'available'
             check (status in ('available', 'occupied', 'reserved')),
  -- Token acak untuk URL QR meja. Tanpa ini, siapa pun bisa memesan ke meja
  -- orang lain hanya dengan menebak nomor meja.
  qr_token text not null unique
);

create unique index if not exists tables_number_uniq
  on public.dining_tables (store_id, number);

create table if not exists public.orders (
  id             text primary key,
  store_id       text not null references public.stores(id) on delete cascade,
  code           text not null,
  channel        text not null check (channel in ('pos', 'self_order')),
  queue_number   text,
  table_number   integer,
  customer_name  text not null default '',
  customer_email text not null default '',
  customer_notes text not null default '',
  cashier_name   text not null default '',

  subtotal        integer not null check (subtotal >= 0),
  discount_type   text not null default 'none'
                    check (discount_type in ('none', 'amount', 'percent')),
  discount_value  integer not null default 0,
  discount_amount integer not null default 0 check (discount_amount >= 0),
  tax_percent     numeric(5, 2) not null default 0,
  tax_amount      integer not null default 0 check (tax_amount >= 0),
  service_amount  integer not null default 0 check (service_amount >= 0),
  total           integer not null check (total >= 0),
  total_cost      integer not null default 0 check (total_cost >= 0),

  payment jsonb not null,
  status  text not null default 'pending'
            check (status in ('pending', 'processing', 'ready', 'completed', 'cancelled')),

  called_at    timestamptz,
  call_count   integer not null default 0 check (call_count >= 0),

  -- Kunci idempoten dari client. Antrean tulis luring mengirim ulang tulisan
  -- yang gagal; tanpa kunci ini, kiriman ulang membuat order kedua yang
  -- sebenarnya tidak pernah terjadi. Indeks unik di bawah yang menjaganya.
  client_key text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text
);

create unique index if not exists orders_code_uniq on public.orders (store_id, code);

create unique index if not exists orders_client_key_uniq
  on public.orders (store_id, client_key) where client_key is not null;

create index if not exists orders_store_created_idx
  on public.orders (store_id, created_at desc);

create index if not exists orders_board_idx
  on public.orders (store_id, status) where queue_number is not null;

-- Nama, harga, dan HPP disalin saat order dibuat. Menu bisa diganti nama,
-- diubah harganya, atau dihapus nanti — riwayat transaksi tidak boleh ikut
-- berubah karenanya. Aplikasi aslinya menyimpan baris item sebagai STRING JSON
-- di dalam satu sel, lalu mengurai ulang di client.
create table if not exists public.order_items (
  id         bigserial primary key,
  order_id   text not null references public.orders(id) on delete cascade,
  line_no    integer not null default 0,
  menu_id    text not null,
  name       text not null,
  price      integer not null check (price >= 0),
  qty        integer not null check (qty > 0),
  notes      text not null default '',
  cost_price integer not null default 0 check (cost_price >= 0)
);

create index if not exists order_items_order_idx on public.order_items (order_id, line_no);

create table if not exists public.stock_movements (
  id        text primary key,
  store_id  text not null references public.stores(id) on delete cascade,
  menu_id   text not null,
  menu_name text not null,
  delta     integer not null check (delta <> 0),
  balance   integer not null check (balance >= 0),
  reason    text not null
              check (reason in ('sale', 'restock', 'waste', 'adjustment', 'return')),
  note      text not null default '',
  actor     text not null default '',
  -- Diisi bila pergerakan ini akibat sebuah order. Indeks uniknya membuat
  -- penjualan yang sama tidak pernah tercatat dua kali walau order dikirim ulang.
  order_id  text references public.orders(id) on delete set null,
  at        timestamptz not null default now()
);

create index if not exists stock_movements_store_idx
  on public.stock_movements (store_id, at desc);

create unique index if not exists stock_movements_sale_uniq
  on public.stock_movements (order_id, menu_id, reason) where order_id is not null;

-- Order yang sedang ditampilkan di layar pelanggan. Satu baris per toko.
create table if not exists public.display_state (
  store_id   text primary key references public.stores(id) on delete cascade,
  order_id   text references public.orders(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Fungsi bantu
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identitas, waktu, penghitung
-- ---------------------------------------------------------------------------

-- Id berawalan supaya jenis barisnya bisa dikenali mata dari nilai id-nya.
create or replace function app.new_id(p_prefix text)
returns text
language sql volatile
as $$
  select p_prefix || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

-- Zona waktu toko. Belum ada di `StoreSettings`, jadi selalu jatuh ke WIB —
-- tapi dibaca dari pengaturan supaya toko di zona lain tidak perlu mengubah
-- fungsi mana pun.
create or replace function app.store_tz(p_store text)
returns text
language sql stable security definer set search_path = app, public
as $$
  select coalesce(s.data ->> 'timezone', 'Asia/Jakarta')
    from public.settings s where s.store_id = p_store;
$$;

-- Kunci tanggal lokal toko, "2026-09-29". Nomor antrian dan laporan harian
-- direset per hari kalender TOKO, bukan hari UTC — aplikasi aslinya memakai
-- tanggal UTC, sehingga order pukul 23:30 WIB masuk ke laporan hari berikutnya.
create or replace function app.today_key(p_store text)
returns text
language sql stable security definer set search_path = app, public
as $$
  select to_char(now() at time zone app.store_tz(p_store), 'YYYY-MM-DD');
$$;

-- Pengambil nomor urut berikutnya. Satu pernyataan INSERT ... ON CONFLICT,
-- jadi dua kasir yang menekan "bayar" pada detik yang sama tetap mendapat
-- nomor berbeda — bukan nomor yang sama seperti pada penghitung di client.
create or replace function app.next_counter(p_store text, p_kind text, p_date_key text)
returns integer
language sql volatile security definer set search_path = app, public
as $$
  insert into app.counters (store_id, kind, date_key, last_value)
  values (p_store, p_kind, p_date_key, 1)
  on conflict (store_id, kind, date_key)
  do update set last_value = app.counters.last_value + 1
  returning last_value;
$$;

-- Naikkan revisi satu cakupan, lalu siarkan sinyalnya.
--
-- Yang dikirim hanya "ada yang berubah di cakupan X, revisi N" — bukan isi
-- perubahannya. Client lalu mengambil ulang lewat pembacaan biasa. Inilah yang
-- membuat pengganti polling 1,2 detik jadi murah.
create or replace function app.bump(p_store text, p_scope text)
returns bigint
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_rev bigint;
begin
  insert into app.store_revision (store_id, scope, revision, at)
  values (p_store, p_scope, 1, now())
  on conflict (store_id, scope)
  do update set revision = app.store_revision.revision + 1, at = now()
  returning revision into v_rev;

  -- Siaran Realtime dibungkus: kalau `realtime.send` belum ada (mis. Postgres
  -- lokal untuk pengujian), sinyal tetap tersimpan di app.store_revision dan
  -- client jatuh ke mode polling. Skema tidak boleh gagal hanya karena
  -- Realtime belum diaktifkan.
  begin
    perform realtime.send(
      jsonb_build_object(
        'storeId', p_store,
        'revision', v_rev,
        'scope', p_scope,
        'at', app.iso(now())
      ),
      'signal',
      'store:' || p_store,
      false
    );
  exception when others then
    null;
  end;

  return v_rev;
end $$;

-- ---------------------------------------------------------------------------
-- Waktu & uang
-- ---------------------------------------------------------------------------

-- ISO-8601 UTC dengan akhiran "Z", persis seperti yang dihasilkan
-- `new Date().toISOString()` di klien.
create or replace function app.iso(ts timestamptz)
returns text
language sql immutable
as $$
  select case when ts is null then null
    else to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
$$;

-- Hitung seluruh komponen biaya satu order.
--
-- Ini reproduksi `computeTotals` di src/domain/money.ts, dan urutannya
-- adalah spesifikasinya:
--   1. subtotal      = Σ harga × qty
--   2. diskon        = dari subtotal, dibatasi ≤ subtotal
--   3. netSubtotal   = subtotal − diskon
--   4. serviceAmount = biaya tetap (bukan persen)
--   5. taxAmount     = round((netSubtotal + service) × persen / 100)
--   6. total         = netSubtotal + service + tax
--
-- Setiap komponen dibulatkan SEBELUM dijumlahkan, supaya totalnya selalu
-- cocok dengan yang tercetak di struk.
--
-- Catatan pembulatan: `round()` Postgres membulatkan setengah menjauhi nol,
-- `Math.round()` JavaScript membulatkan setengah ke atas. Untuk nilai tidak
-- negatif — dan semua nilai uang di sini tidak negatif — keduanya identik.
create or replace function app.compute_totals(
  p_items jsonb,
  p_discount_type text,
  p_discount_value numeric,
  p_tax_percent numeric,
  p_service_amount integer
)
returns jsonb
language plpgsql immutable
as $$
declare
  v_subtotal  integer;
  v_cost      integer;
  v_discount  integer;
  v_net       integer;
  v_service   integer;
  v_tax_pct   numeric;
  v_tax       integer;
begin
  select coalesce(sum((it ->> 'price')::integer * (it ->> 'qty')::integer), 0),
         coalesce(sum((it ->> 'costPrice')::integer * (it ->> 'qty')::integer), 0)
    into v_subtotal, v_cost
    from jsonb_array_elements(p_items) as it;

  -- Keranjang kosong tidak boleh menghasilkan tagihan. Tanpa penjaga ini,
  -- biaya layanan dan pajak tetap dikenakan pada subtotal 0.
  if v_subtotal <= 0 then
    return jsonb_build_object(
      'subtotal', 0, 'discountAmount', 0, 'netSubtotal', 0,
      'serviceAmount', 0, 'taxPercent', 0, 'taxAmount', 0,
      'total', 0, 'totalCost', v_cost
    );
  end if;

  if p_discount_type = 'amount' then
    v_discount := round(p_discount_value)::integer;
  elsif p_discount_type = 'percent' then
    v_discount := round(v_subtotal * least(greatest(p_discount_value, 0), 100) / 100)::integer;
  else
    v_discount := 0;
  end if;
  v_discount := least(greatest(v_discount, 0), v_subtotal);

  v_net     := v_subtotal - v_discount;
  v_service := greatest(0, round(p_service_amount)::integer);
  v_tax_pct := least(greatest(p_tax_percent, 0), 100);
  v_tax     := greatest(0, round((v_net + v_service) * v_tax_pct / 100)::integer);

  return jsonb_build_object(
    'subtotal',       v_subtotal,
    'discountAmount', v_discount,
    'netSubtotal',    v_net,
    'serviceAmount',  v_service,
    'taxPercent',     v_tax_pct,
    'taxAmount',      v_tax,
    'total',          v_net + v_service + v_tax,
    'totalCost',      v_cost
  );
end $$;

-- Kode unik nominal, diturunkan dari nomor urut order — bukan acak — supaya
-- nilainya stabil saat dihitung ulang dan unik dalam satu hari.
create or replace function app.unique_code(p_sequence integer, p_range integer[])
returns integer
language sql immutable
as $$
  select case
    when coalesce(array_length(p_range, 1), 0) < 2 then 0
    when (p_range[2] - p_range[1] + 1) <= 0 then 0
    else p_range[1] + mod(mod(p_sequence - 1, p_range[2] - p_range[1] + 1)
                          + (p_range[2] - p_range[1] + 1),
                          (p_range[2] - p_range[1] + 1))
  end;
$$;

-- Kode unik berguna HANYA saat pemasukan di mutasi bank harus dicocokkan
-- dengan satu order. Tunai dan kartu debit diselesaikan kasir di tempat, jadi
-- menambahkan kode unik di situ justru membuat kembalian tidak bulat.
create or replace function app.needs_unique_code(p_method text)
returns boolean
language sql immutable
as $$
  select p_method in ('qris_static', 'qris_gateway', 'transfer');
$$;

-- ---------------------------------------------------------------------------
-- Verifikasi sesi
--
-- Peran datang dari akun, bukan pilihan di layar masuk. Kalau pengguna bisa
-- memilih sendiri "masuk sebagai pemilik", pemisahan peran tidak ada gunanya.
-- ---------------------------------------------------------------------------

create or replace function app.require_session(p_token text)
returns app.sessions
language plpgsql stable security definer set search_path = app, public
as $$
declare
  v app.sessions;
begin
  if p_token is null or p_token = '' then
    raise exception 'Sesi tidak ditemukan' using errcode = '28000';
  end if;

  select * into v from app.sessions where token = p_token;
  if not found then
    raise exception 'Sesi tidak ditemukan' using errcode = '28000';
  end if;

  if v.expires_at <= now() then
    delete from app.sessions where token = p_token;
    raise exception 'Sesi sudah kedaluwarsa' using errcode = '28000';
  end if;

  return v;
end $$;

create or replace function app.require_role(p_token text, p_roles text[])
returns app.sessions
language plpgsql stable security definer set search_path = app, public
as $$
declare
  v app.sessions;
begin
  v := app.require_session(p_token);
  if not (v.role = any(p_roles)) then
    raise exception 'Peran % tidak berhak melakukan ini', v.role using errcode = '42501';
  end if;
  return v;
end $$;

-- Peran yang boleh mengubah katalog: pemilik dan kasir. Dapur tidak — dapur
-- mengubah status pesanan, bukan harga menu.
create or replace function app.can_edit_catalog(p_role text)
returns boolean
language sql immutable
as $$
  select p_role in ('owner', 'cashier');
$$;

-- ---------------------------------------------------------------------------
-- Pemetaan baris → bentuk yang dipakai klien
--
-- Nama kolom di Postgres memakai snake_case; kontrak `Repository` memakai
-- camelCase. Pemetaan ditulis eksplisit di sini supaya perubahan nama kolom
-- tidak diam-diam mengubah bentuk data yang diterima UI.
--
-- Katalog (menu, kategori, pengaturan) TIDAK dipetakan di sini: barisnya
-- dibaca langsung lewat PostgREST dengan RLS yang menjaga, dan pemetaannya
-- dikerjakan di sisi klien supaya bisa diuji tanpa basis data. Yang dipetakan
-- di SQL adalah bentuk yang tidak boleh bervariasi — order dan pergerakan
-- stok — karena di situlah kesalahan pemetaan paling mahal.
-- ---------------------------------------------------------------------------

create or replace function app.table_json(t public.dining_tables)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'id',       t.id,
    'storeId',  t.store_id,
    'number',   t.number,
    'name',     t.name,
    'capacity', t.capacity,
    'status',   t.status,
    'qrToken',  t.qr_token
  );
$$;

create or replace function app.movement_json(s public.stock_movements)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'id',       s.id,
    'storeId',  s.store_id,
    'menuId',   s.menu_id,
    'menuName', s.menu_name,
    'delta',    s.delta,
    'balance',  s.balance,
    'reason',   s.reason,
    'note',     s.note,
    'actor',    s.actor,
    'at',       app.iso(s.at)
  );
$$;

-- `security definer` karena `order_items` tidak punya policy RLS: barisnya
-- hanya boleh keluar lewat fungsi ini, yang sudah memeriksa sesi lebih dulu.
create or replace function app.order_json(p_order_id text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select jsonb_build_object(
    'id',            o.id,
    'storeId',       o.store_id,
    'code',          o.code,
    'channel',       o.channel,
    'queueNumber',   o.queue_number,
    'tableNumber',   o.table_number,
    'customerName',  o.customer_name,
    'customerEmail', o.customer_email,
    'customerNotes', o.customer_notes,
    'cashierName',   o.cashier_name,
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'menuId',    i.menu_id,
                 'name',      i.name,
                 'price',     i.price,
                 'qty',       i.qty,
                 'notes',     i.notes,
                 'costPrice', i.cost_price
               ) order by i.line_no
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb),
    'subtotal',       o.subtotal,
    'discountType',   o.discount_type,
    'discountValue',  o.discount_value,
    'discountAmount', o.discount_amount,
    'taxPercent',     o.tax_percent,
    'taxAmount',      o.tax_amount,
    'serviceAmount',  o.service_amount,
    'total',          o.total,
    'totalCost',      o.total_cost,
    'payment',        o.payment,
    'status',         o.status,
    'calledAt',       app.iso(o.called_at),
    'callCount',      o.call_count,
    'createdAt',      app.iso(o.created_at),
    'updatedAt',      app.iso(o.updated_at),
    'completedAt',    app.iso(o.completed_at),
    'cancelledAt',    app.iso(o.cancelled_at),
    'cancelReason',   o.cancel_reason
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- Versi ringkas untuk papan antrian TV. Papan ini memang publik — ia
-- ditampilkan di layar yang dilihat pelanggan — tapi alamat surel pelanggan
-- tidak punya kegunaan apa pun di sana, jadi tidak ikut dikirim.
create or replace function app.board_order_json(p_order_id text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select app.order_json(p_order_id) || jsonb_build_object('customerEmail', '');
$$;

-- ============================================================================
-- Penulisan order
-- ============================================================================

-- Inti pembuatan order, dipakai bersama oleh kasir (lewat sesi) dan
-- pelanggan (lewat token meja).
--
-- Yang TIDAK diambil dari input client: harga, HPP, nama menu, subtotal,
-- diskon, pajak, total, kode order, nomor antrian, kode unik. Semua dihitung
-- di sini dari katalog dan pengaturan toko. Client hanya mengirim NIAT:
-- menu apa, berapa banyak, catatan apa.
--
-- Aplikasi aslinya mengirim seluruh hasil hitungan dari browser, sehingga
-- total dan harga bisa diubah dari konsol peramban sebelum disimpan.
create or replace function app.create_order_impl(
  p_store    text,
  p_channel  text,
  p_actor    text,
  p_table    integer,
  p_input    jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_settings    jsonb;
  v_items       jsonb := '[]'::jsonb;
  v_row         record;
  v_menu        public.menus;
  v_qty         integer;
  v_totals      jsonb;
  v_tax_pct     numeric;
  v_service     integer;
  v_date_key    text;
  v_seq         integer;
  v_queue       integer;
  v_prefix      text;
  v_code        text;
  v_label       text;
  v_method      text;
  v_unique      integer;
  v_amount_due  integer;
  v_cash        integer;
  v_lunas       boolean;
  v_payment     jsonb;
  v_order_id    text;
  v_client_key  text;
  v_existing    text;
  v_customer    text;
begin
  if p_channel not in ('pos', 'self_order') then
    raise exception 'Kanal order tidak dikenal: %', p_channel using errcode = '22023';
  end if;

  select s.data into v_settings from public.settings s where s.store_id = p_store;
  if v_settings is null then
    raise exception 'Toko % belum diatur', p_store using errcode = 'P0002';
  end if;

  -- Kiriman ulang dari antrean luring: kalau kunci ini sudah pernah dipakai,
  -- kembalikan order yang sudah ada, jangan buat yang kedua. Tanpa penjaga
  -- ini, koneksi yang putus setelah order tersimpan tapi sebelum jawabannya
  -- sampai akan menghasilkan dua pesanan untuk satu niat.
  v_client_key := nullif(btrim(coalesce(p_input ->> 'clientKey', '')), '');
  if v_client_key is not null then
    select o.id into v_existing
      from public.orders o
     where o.store_id = p_store and o.client_key = v_client_key;
    if v_existing is not null then
      return app.order_json(v_existing);
    end if;
  end if;

  if jsonb_typeof(p_input -> 'items') <> 'array'
     or jsonb_array_length(p_input -> 'items') = 0 then
    raise exception 'Keranjang kosong' using errcode = '22023';
  end if;

  -- 1. Resolusi harga dari katalog internal.
  for v_row in
    select it.value as item
      from jsonb_array_elements(p_input -> 'items') as it(value)
  loop
    select m.* into v_menu
      from public.menus m
     where m.id = v_row.item ->> 'menuId' and m.store_id = p_store;

    if not found then
      raise exception 'Menu tidak ditemukan: %', v_row.item ->> 'menuId' using errcode = 'P0002';
    end if;
    if not v_menu.is_available then
      raise exception '% sedang tidak tersedia', v_menu.name using errcode = 'P0001';
    end if;

    v_qty := greatest(1, floor(coalesce((v_row.item ->> 'qty')::numeric, 1))::integer);

    v_items := v_items || jsonb_build_object(
      'menuId',    v_menu.id,
      'name',      v_menu.name,
      'price',     v_menu.price,
      'qty',       v_qty,
      'notes',     coalesce(v_row.item ->> 'notes', ''),
      'costPrice', v_menu.cost_price
    );
  end loop;

  -- 2. Pajak & biaya layanan dari pengaturan toko.
  v_tax_pct := coalesce((v_settings -> 'tax' ->> 'percent')::numeric, 0);
  v_service := case
    when coalesce((v_settings -> 'serviceFee' ->> 'enabled')::boolean, false)
      then coalesce((v_settings -> 'serviceFee' ->> 'amount')::integer, 0)
    else 0
  end;

  -- Diskon dari client dibatasi di dalam compute_totals, jadi nilai yang
  -- keterlaluan tidak bisa membuat total negatif.
  v_totals := app.compute_totals(
    v_items,
    coalesce(p_input -> 'discount' ->> 'type', 'none'),
    coalesce((p_input -> 'discount' ->> 'value')::numeric, 0),
    v_tax_pct,
    v_service
  );

  -- 3. Nomor urut harian, kode order, dan nomor antrian.
  v_date_key := app.today_key(p_store);
  v_seq      := app.next_counter(p_store, 'order_seq', v_date_key);
  v_queue    := app.next_counter(p_store, 'queue', v_date_key);
  v_prefix   := coalesce(v_settings -> 'queue' ->> 'prefix', 'A');

  v_code  := case when p_channel = 'pos' then 'ORD' else 'WEB' end
             || '-' || substr(replace(v_date_key, '-', ''), 3)
             || '-' || lpad(v_seq::text, 4, '0');
  v_label := case when v_prefix = '' then lpad(v_queue::text, 2, '0')
                  else v_prefix || '-' || lpad(v_queue::text, 2, '0') end;

  -- 4. Kode unik hanya untuk metode yang perlu dicocokkan ke mutasi bank.
  v_method := coalesce(p_input ->> 'paymentMethod', 'cash');
  v_unique := case
    when coalesce((v_settings -> 'payments' ->> 'uniqueCodeEnabled')::boolean, false)
     and app.needs_unique_code(v_method)
    then app.unique_code(
           v_seq,
           array(select (jsonb_array_elements_text(
             coalesce(v_settings -> 'payments' -> 'uniqueCodeRange', '[1,999]'::jsonb)
           ))::integer)
         )
    else 0
  end;

  v_amount_due := (v_totals ->> 'total')::integer + greatest(0, v_unique);
  v_cash       := greatest(0, round(coalesce((p_input ->> 'cashReceived')::numeric, 0))::integer);

  v_lunas := v_method in ('cash', 'debit')
             or (v_method = 'split'
                 and jsonb_typeof(p_input -> 'splits') = 'array'
                 and jsonb_array_length(p_input -> 'splits') > 0);

  v_payment := jsonb_build_object(
    'method',       v_method,
    'status',       case when v_lunas then 'paid' else 'unpaid' end,
    'uniqueCode',   v_unique,
    'amountDue',    v_amount_due,
    'amountPaid',   case when v_lunas then v_amount_due else 0 end,
    'cashReceived', case when v_method = 'cash' then v_cash else 0 end,
    'cashChange',   case when v_method = 'cash' and v_cash >= v_amount_due
                         then v_cash - v_amount_due else 0 end,
    'reference',    '',
    'paidAt',       case when v_lunas then app.iso(now()) else null end,
    'splits',       coalesce(p_input -> 'splits', '[]'::jsonb)
  );

  v_customer := coalesce(nullif(btrim(coalesce(p_input ->> 'customerName', '')), ''), 'Tanpa nama');

  -- 5. Simpan order.
  v_order_id := app.new_id('ord');

  insert into public.orders (
    id, store_id, code, channel, queue_number, table_number,
    customer_name, customer_email, customer_notes, cashier_name,
    subtotal, discount_type, discount_value, discount_amount,
    tax_percent, tax_amount, service_amount, total, total_cost,
    payment, status, client_key
  ) values (
    v_order_id, p_store, v_code, p_channel, v_label, p_table,
    v_customer,
    btrim(coalesce(p_input ->> 'customerEmail', '')),
    btrim(coalesce(p_input ->> 'customerNotes', '')),
    btrim(coalesce(p_input ->> 'cashierName', '')),
    (v_totals ->> 'subtotal')::integer,
    coalesce(p_input -> 'discount' ->> 'type', 'none'),
    coalesce((p_input -> 'discount' ->> 'value')::numeric, 0)::integer,
    (v_totals ->> 'discountAmount')::integer,
    (v_totals ->> 'taxPercent')::numeric,
    (v_totals ->> 'taxAmount')::integer,
    (v_totals ->> 'serviceAmount')::integer,
    (v_totals ->> 'total')::integer,
    (v_totals ->> 'totalCost')::integer,
    v_payment, 'pending', v_client_key
  );

  insert into public.order_items (order_id, line_no, menu_id, name, price, qty, notes, cost_price)
  select v_order_id,
         it.ordinality::integer,
         it.value ->> 'menuId',
         it.value ->> 'name',
         (it.value ->> 'price')::integer,
         (it.value ->> 'qty')::integer,
         coalesce(it.value ->> 'notes', ''),
         (it.value ->> 'costPrice')::integer
    from jsonb_array_elements(v_items) with ordinality as it(value, ordinality);

  -- 6. Potong stok untuk menu yang dilacak, dan catat pergerakannya.
  --
  --    Stok dijepit di 0, bukan ditolak: pesanannya sudah terjadi dan dapur
  --    tetap harus membuatnya. Yang penting saldo tidak pernah minus — CHECK
  --    di tabel menus yang menjaminnya — dan menu otomatis disembunyikan
  --    saat stoknya habis.
  --
  --    Catatan pergerakan inilah yang menjawab pertanyaan yang tidak bisa
  --    dijawab aplikasi aslinya: "kenapa stok berkurang 5 padahal penjualan
  --    hanya 3?"
  with dipakai as (
    select oi.menu_id, sum(oi.qty)::integer as qty
      from public.order_items oi
     where oi.order_id = v_order_id
     group by oi.menu_id
  ),
  diubah as (
    update public.menus m
       set stock        = greatest(0, m.stock - d.qty),
           is_available = case when greatest(0, m.stock - d.qty) = 0
                               then false else m.is_available end,
           updated_at   = now()
      from dipakai d
     where m.id = d.menu_id
       and m.stock is not null
    returning m.id, m.name, m.stock, d.qty
  )
  insert into public.stock_movements (
    id, store_id, menu_id, menu_name, delta, balance, reason, note, actor, order_id
  )
  select app.new_id('sm'), p_store, u.id, u.name, -u.qty, u.stock, 'sale',
         'Order ' || v_code, coalesce(nullif(p_actor, ''), 'Pesan sendiri'), v_order_id
    from diubah u
  on conflict (order_id, menu_id) where order_id is not null do nothing;

  perform app.bump(p_store, 'orders');
  perform app.bump(p_store, 'menus');
  perform app.bump(p_store, 'stock');

  return app.order_json(v_order_id);
end $$;

-- Order dari kasir. Peran yang boleh: pemilik dan kasir. Dapur tidak menagih.
create or replace function public.create_order(p_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_role(p_token, array['owner', 'cashier']);

  return app.create_order_impl(
    v_sesi.store_id,
    coalesce(p_input ->> 'channel', 'pos'),
    v_sesi.display_name,
    nullif(p_input ->> 'tableNumber', '')::integer,
    p_input
  );
end $$;

-- Order dari pelanggan lewat QR meja. Tidak butuh sesi — yang dibutuhkan
-- token meja, dan token itu yang menentukan meja mana yang dipesan.
--
-- Nomor meja diambil DARI TOKEN, bukan dari input: kalau diambil dari input,
-- pelanggan bisa memesan ke meja orang lain hanya dengan mengubah satu angka.
create or replace function public.create_self_order(p_table_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_meja public.dining_tables;
begin
  select t.* into v_meja
    from public.dining_tables t
   where t.qr_token = p_table_token;

  if not found then
    raise exception 'Token meja tidak dikenal' using errcode = '28000';
  end if;

  return app.create_order_impl(
    v_meja.store_id,
    'self_order',
    'Pesan sendiri',
    v_meja.number,
    p_input
  );
end $$;

-- ============================================================================
-- Siklus hidup order
-- ============================================================================

-- Mesin keadaan order. Ini reproduksi `TRANSITIONS` di src/domain/orders.ts.
--
-- Di client, aturan ini hanya memutuskan tombol mana yang tampil. Di sini ia
-- MENOLAK. Itu bedanya: aplikasi aslinya menyimpan status sebagai string bebas
-- dan memutuskan transisi di client, sehingga order bisa melompat dari
-- "Pending" langsung ke "Completed" tanpa pernah masuk dapur.
create or replace function app.can_transition(p_from text, p_to text)
returns boolean
language sql immutable
as $$
  select case
    when p_from = 'pending'    then p_to in ('processing', 'cancelled')
    when p_from = 'processing' then p_to in ('ready', 'cancelled')
    when p_from = 'ready'      then p_to in ('completed', 'cancelled')
    else false
  end;
$$;

create or replace function public.update_order_status(
  p_token  text,
  p_id     text,
  p_status text
)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_order public.orders;
begin
  v_sesi := app.require_session(p_token);

  select o.* into v_order
    from public.orders o
   where o.id = p_id and o.store_id = v_sesi.store_id;

  if not found then
    raise exception 'Order tidak ditemukan' using errcode = 'P0002';
  end if;

  -- Pembatalan punya jalurnya sendiri, karena ia harus mengembalikan stok.
  -- Kalau boleh lewat sini, stok akan hilang tanpa jejak — dan itulah bentuk
  -- kerusakan yang paling sulit dilacak saat operasional.
  if p_status = 'cancelled' then
    raise exception 'Pembatalan harus lewat cancel_order supaya stok dikembalikan'
      using errcode = 'P0001';
  end if;

  if not app.can_transition(v_order.status, p_status) then
    raise exception 'Tidak bisa mengubah status dari % ke %', v_order.status, p_status
      using errcode = 'P0001';
  end if;

  update public.orders
     set status       = p_status,
         updated_at   = now(),
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = p_id;

  perform app.bump(v_sesi.store_id, 'orders');
  if p_status = 'completed' then
    perform app.bump(v_sesi.store_id, 'queue');
  end if;

  return app.order_json(p_id);
end $$;

create or replace function public.cancel_order(
  p_token  text,
  p_id     text,
  p_reason text
)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_order public.orders;
begin
  -- Dapur tidak membatalkan pesanan; itu keputusan kasir atau pemilik.
  v_sesi := app.require_role(p_token, array['owner', 'cashier']);

  select o.* into v_order
    from public.orders o
   where o.id = p_id and o.store_id = v_sesi.store_id;

  if not found then
    raise exception 'Order tidak ditemukan' using errcode = 'P0002';
  end if;

  if v_order.status in ('completed', 'cancelled') then
    raise exception 'Order ini sudah tidak bisa dibatalkan' using errcode = 'P0001';
  end if;

  update public.orders
     set status        = 'cancelled',
         cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Tanpa alasan'),
         cancelled_at  = now(),
         updated_at    = now()
   where id = p_id;

  -- Kembalikan stok, DAN catat pergerakannya.
  --
  -- Adapter mock mengembalikan saldo tanpa meninggalkan jejak, sehingga
  -- pertanyaan "kenapa stok naik 2 padahal tidak ada restock" tidak bisa
  -- dijawab. Di sini jejaknya ada.
  with isi as (
    select oi.menu_id, sum(oi.qty)::integer as qty
      from public.order_items oi
     where oi.order_id = p_id
     group by oi.menu_id
  ),
  diubah as (
    update public.menus m
       set stock        = m.stock + i.qty,
           is_available = true,
           updated_at   = now()
      from isi i
     where m.id = i.menu_id
       and m.stock is not null
    returning m.id, m.name, m.stock, i.qty
  )
  insert into public.stock_movements (
    id, store_id, menu_id, menu_name, delta, balance, reason, note, actor, order_id
  )
  select app.new_id('sm'), v_sesi.store_id, u.id, u.name, u.qty, u.stock, 'return',
         'Batal ' || v_order.code, v_sesi.display_name, p_id
    from diubah u
  on conflict (order_id, menu_id, reason) where order_id is not null do nothing;

  perform app.bump(v_sesi.store_id, 'orders');
  perform app.bump(v_sesi.store_id, 'menus');
  perform app.bump(v_sesi.store_id, 'stock');
  perform app.bump(v_sesi.store_id, 'queue');

  return app.order_json(p_id);
end $$;

create or replace function public.record_payment(
  p_token   text,
  p_id      text,
  p_payment jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_order public.orders;
begin
  v_sesi := app.require_role(p_token, array['owner', 'cashier']);

  select o.* into v_order
    from public.orders o
   where o.id = p_id and o.store_id = v_sesi.store_id;

  if not found then
    raise exception 'Order tidak ditemukan' using errcode = 'P0002';
  end if;

  if v_order.payment ->> 'status' = 'paid' then
    raise exception 'Order ini sudah lunas' using errcode = 'P0001';
  end if;

  update public.orders
     set payment    = p_payment
                      || jsonb_build_object('status', 'paid', 'paidAt', app.iso(now())),
         updated_at = now()
   where id = p_id;

  perform app.bump(v_sesi.store_id, 'orders');
  return app.order_json(p_id);
end $$;

-- ============================================================================
-- Antrian & layar pelanggan
-- ============================================================================

-- Panggilan tercatat di data, bukan hanya disiarkan sesaat. Dengan begitu TV
-- yang baru dinyalakan — atau yang sempat putus jaringan — tetap tahu nomor
-- mana yang terakhir dipanggil. Aplikasi aslinya hanya menyiarkan event
-- sesaat, sehingga TV yang baru dibuka tidak menampilkan apa pun.
create or replace function public.call_queue(p_token text, p_id text)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_order public.orders;
begin
  v_sesi := app.require_session(p_token);

  select o.* into v_order
    from public.orders o
   where o.id = p_id and o.store_id = v_sesi.store_id;

  if not found then
    raise exception 'Order tidak ditemukan' using errcode = 'P0002';
  end if;

  -- Hanya order yang sudah SIAP yang boleh dipanggil — itulah saat pelanggan
  -- memang perlu dipanggil. Memanggil order yang masih dimasak hanya membuat
  -- pelanggan menunggu di depan meja.
  if v_order.status <> 'ready' then
    raise exception 'Hanya order yang sudah siap bisa dipanggil' using errcode = 'P0001';
  end if;

  update public.orders
     set called_at  = now(),
         call_count = call_count + 1,
         updated_at = now()
   where id = p_id;

  perform app.bump(v_sesi.store_id, 'queue');
  perform app.bump(v_sesi.store_id, 'orders');

  return app.order_json(p_id);
end $$;

create or replace function public.set_display_order(p_token text, p_order_id text)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_order public.orders;
begin
  v_sesi := app.require_session(p_token);

  if p_order_id is not null then
    select o.* into v_order
      from public.orders o
     where o.id = p_order_id and o.store_id = v_sesi.store_id;

    if not found then
      raise exception 'Order tidak ditemukan' using errcode = 'P0002';
    end if;

    -- Order yang dibatalkan atau selesai tidak boleh dikirim ke layar
    -- pelanggan. Kalau lolos, layar akan menampilkan QR pembayaran untuk
    -- pesanan yang sudah tidak ada.
    if v_order.status = 'cancelled' then
      raise exception 'Order yang dibatalkan tidak bisa dikirim ke layar pelanggan'
        using errcode = 'P0001';
    end if;
    if v_order.status = 'completed' then
      raise exception 'Order yang sudah selesai tidak bisa dikirim ke layar pelanggan'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.display_state (store_id, order_id, updated_at)
  values (v_sesi.store_id, p_order_id, now())
  on conflict (store_id)
  do update set order_id = excluded.order_id, updated_at = now();

  perform app.bump(v_sesi.store_id, 'display');
end $$;

-- ============================================================================
-- Pembacaan
-- ============================================================================

-- Versi ringkas untuk yang diakses TANPA sesi (pelanggan memeriksa status
-- pesanannya sendiri lewat kode). Surel dan catatan pelanggan tidak ikut:
-- keduanya tidak punya kegunaan di layar status, dan kode order berpola urut
-- sehingga bisa ditebak.
create or replace function app.public_order_json(p_order_id text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select app.order_json(p_order_id)
         || jsonb_build_object('customerEmail', '', 'customerNotes', '');
$$;

-- Cari meja dari token di URL QR. Inilah satu-satunya jalan masuk tanpa sesi
-- yang boleh membaca data meja — daftar seluruh token tidak pernah dikirim.
create or replace function public.get_table_by_token(p_token text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select app.table_json(t)
    from public.dining_tables t
   where t.qr_token = p_token;
$$;

create or replace function public.get_order_by_code(p_store text, p_code text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select app.public_order_json(o.id)
    from public.orders o
   where o.store_id = p_store
     and (upper(o.code) = upper(btrim(p_code)) or o.queue_number = upper(btrim(p_code)))
   limit 1;
$$;

-- Papan antrian TV: publik, memang untuk dilihat pelanggan.
create or replace function public.list_queue_board(p_store text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select coalesce(jsonb_agg(app.board_order_json(o.id) order by o.created_at), '[]'::jsonb)
    from public.orders o
   where o.store_id = p_store
     and o.queue_number is not null
     and o.status <> 'cancelled'
     and (o.created_at at time zone app.store_tz(p_store))::date
         = (now() at time zone app.store_tz(p_store))::date;
$$;

create or replace function public.get_display_order(p_store text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select app.public_order_json(d.order_id)
    from public.display_state d
   where d.store_id = p_store and d.order_id is not null;
$$;

create or replace function public.list_orders(p_token text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_cari  text;
begin
  v_sesi := app.require_session(p_token);
  v_cari := nullif(btrim(coalesce(p_filter ->> 'search', '')), '');

  return coalesce((
    select jsonb_agg(app.order_json(sub.id) order by sub.created_at desc)
      from (
        select o.id, o.created_at
          from public.orders o
         where o.store_id = v_sesi.store_id
           and (p_filter ->> 'from' is null
                or o.created_at >= (p_filter ->> 'from')::timestamptz)
           and (p_filter ->> 'to' is null
                or o.created_at <= (p_filter ->> 'to')::timestamptz)
           and (jsonb_typeof(p_filter -> 'status') <> 'array'
                or o.status in (select jsonb_array_elements_text(p_filter -> 'status')))
           and (p_filter ->> 'channel' is null
                or o.channel = p_filter ->> 'channel')
           and (v_cari is null
                or o.code ilike '%' || v_cari || '%'
                or o.customer_name ilike '%' || v_cari || '%'
                or coalesce(o.queue_number, '') ilike '%' || v_cari || '%'
                or coalesce(o.table_number::text, '') like '%' || v_cari || '%')
         order by o.created_at desc
         limit coalesce((p_filter ->> 'limit')::integer, 2147483647)
      ) sub
  ), '[]'::jsonb);
end $$;

create or replace function public.get_order(p_token text, p_id text)
returns jsonb
language plpgsql stable security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_session(p_token);
  return (select app.order_json(o.id)
            from public.orders o
           where o.id = p_id and o.store_id = v_sesi.store_id);
end $$;

create or replace function public.list_stock_movements(p_token text, p_menu_id text default null)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select coalesce(jsonb_agg(app.movement_json(s) order by s.at desc), '[]'::jsonb)
    from public.stock_movements s
   where s.store_id = app.require_session(p_token).store_id
     and (p_menu_id is null or s.menu_id = p_menu_id);
$$;

create or replace function public.list_tables(p_token text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select coalesce(jsonb_agg(app.table_json(t) order by t.number), '[]'::jsonb)
    from public.dining_tables t
   where t.store_id = app.require_session(p_token).store_id;
$$;

-- Daftar revisi per cakupan, dipakai saat Realtime tidak tersedia sehingga
-- client perlu menyegarkan diri secara berkala.
create or replace function public.store_revisions(p_store text)
returns jsonb
language sql stable security definer set search_path = app, public
as $$
  select coalesce(jsonb_object_agg(r.scope, r.revision), '{}'::jsonb)
    from app.store_revision r
   where r.store_id = p_store;
$$;

-- ============================================================================
-- Sesi masuk
-- ============================================================================

-- Verifikasi kredensial terjadi DI SINI, di server. Tidak ada satu pun PIN
-- atau kata sandi di dalam kode yang dikirim ke browser — yang tersimpan
-- hanya hash bcrypt, dan yang dikembalikan hanya token sesi.
--
-- Inilah perbaikan dari aplikasi aslinya, yang menaruh
-- `.getAdminData('123456', ...)` langsung di dalam JavaScript client.
create or replace function public.sign_in(
  p_store    text,
  p_username text,
  p_password text,
  p_pin      text
)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_staff app.staff;
  v_token text;
  v_exp   timestamptz;
begin
  select s.* into v_staff
    from app.staff s
   where s.store_id = p_store
     and lower(s.username) = lower(btrim(p_username))
     and s.is_active;

  -- Semua kegagalan memakai pesan yang SAMA. Membedakan "nama pengguna tidak
  -- ada" dari "PIN salah" justru memberi tahu penyerang bagian mana yang
  -- sudah benar.
  if not found then
    raise exception 'Nama pengguna, sandi, atau PIN salah' using errcode = '28000';
  end if;

  if v_staff.password_hash <> crypt(p_password, v_staff.password_hash) then
    raise exception 'Nama pengguna, sandi, atau PIN salah' using errcode = '28000';
  end if;

  if v_staff.pin_hash <> crypt(coalesce(p_pin, ''), v_staff.pin_hash) then
    raise exception 'Nama pengguna, sandi, atau PIN salah' using errcode = '28000';
  end if;

  v_exp   := now() + interval '12 hours';
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into app.sessions (token, staff_id, store_id, role, display_name, expires_at)
  values (v_token, v_staff.id, v_staff.store_id, v_staff.role, v_staff.display_name, v_exp);

  delete from app.sessions where expires_at <= now();

  return jsonb_build_object(
    'userId',      v_staff.id,
    'storeId',     v_staff.store_id,
    'role',        v_staff.role,
    'displayName', v_staff.display_name,
    'expiresAt',   app.iso(v_exp),
    'token',       v_token
  );
end $$;

create or replace function public.current_session(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = app, public
as $$
declare
  v app.sessions;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  select * into v from app.sessions where token = p_token and expires_at > now();
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'userId',      v.staff_id,
    'storeId',     v.store_id,
    'role',        v.role,
    'displayName', v.display_name,
    'expiresAt',   app.iso(v.expires_at)
  );
end $$;

create or replace function public.sign_out(p_token text)
returns void
language sql volatile security definer set search_path = app, public
as $$
  delete from app.sessions where token = p_token;
$$;

-- ============================================================================
-- Katalog
-- ============================================================================

create or replace function public.save_settings(p_token text, p_data jsonb)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_role(p_token, array['owner']);

  -- Pajak dijepit di sini, bukan di tampilan. Kalau penjepitan hanya ada di
  -- layar, jalur lain (mis. impor atau kiriman ulang luring) bisa menembusnya.
  p_data := jsonb_set(
    p_data,
    '{tax,percent}',
    to_jsonb(least(greatest(coalesce((p_data -> 'tax' ->> 'percent')::numeric, 0), 0), 100))
  );

  insert into public.settings (store_id, data, updated_at)
  values (v_sesi.store_id, p_data, now())
  on conflict (store_id) do update set data = excluded.data, updated_at = now();

  perform app.bump(v_sesi.store_id, 'settings');
end $$;

create or replace function public.save_category(p_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
  v_id   text;
  v_row  public.categories;
begin
  v_sesi := app.require_session(p_token);
  if not app.can_edit_catalog(v_sesi.role) then
    raise exception 'Peran % tidak berhak mengubah katalog', v_sesi.role using errcode = '42501';
  end if;

  if btrim(coalesce(p_input ->> 'name', '')) = '' then
    raise exception 'Nama kategori tidak boleh kosong' using errcode = '22023';
  end if;

  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '');

  if v_id is null then
    v_id := app.new_id('cat');
    insert into public.categories (id, store_id, name, icon, sort_order, is_active)
    values (v_id, v_sesi.store_id, btrim(p_input ->> 'name'),
            coalesce(p_input ->> 'icon', 'box'),
            coalesce((p_input ->> 'sortOrder')::integer, 0),
            coalesce((p_input ->> 'isActive')::boolean, true));
  else
    update public.categories
       set name       = btrim(p_input ->> 'name'),
           icon       = coalesce(p_input ->> 'icon', icon),
           sort_order = coalesce((p_input ->> 'sortOrder')::integer, sort_order),
           is_active  = coalesce((p_input ->> 'isActive')::boolean, is_active)
     where id = v_id and store_id = v_sesi.store_id;

    if not found then
      raise exception 'Kategori tidak ditemukan' using errcode = 'P0002';
    end if;
  end if;

  select c.* into v_row from public.categories c where c.id = v_id;
  perform app.bump(v_sesi.store_id, 'menus');
  return app.category_json(v_row);
end $$;

-- Menu yang kategorinya dihapus tidak ikut terhapus: kuncinya ON DELETE SET
-- NULL, jadi menunya hanya kehilangan kategori. Menghapus menu satu per satu
-- adalah keputusan sadar, bukan efek samping.
create or replace function public.delete_category(p_token text, p_id text)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_session(p_token);
  if not app.can_edit_catalog(v_sesi.role) then
    raise exception 'Peran % tidak berhak mengubah katalog', v_sesi.role using errcode = '42501';
  end if;

  delete from public.categories where id = p_id and store_id = v_sesi.store_id;
  perform app.bump(v_sesi.store_id, 'menus');
end $$;

create or replace function public.save_menu(p_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
  v_id   text;
  v_row  public.menus;
begin
  v_sesi := app.require_session(p_token);
  if not app.can_edit_catalog(v_sesi.role) then
    raise exception 'Peran % tidak berhak mengubah katalog', v_sesi.role using errcode = '42501';
  end if;

  if btrim(coalesce(p_input ->> 'name', '')) = '' then
    raise exception 'Nama menu tidak boleh kosong' using errcode = '22023';
  end if;
  if coalesce((p_input ->> 'price')::integer, 0) < 0 then
    raise exception 'Harga tidak boleh negatif' using errcode = '22023';
  end if;

  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '');

  if v_id is null then
    v_id := app.new_id('mn');
    insert into public.menus (
      id, store_id, category_id, name, price, cost_price,
      description, image_url, is_available, stock, sort_order
    ) values (
      v_id, v_sesi.store_id,
      nullif(p_input ->> 'categoryId', ''),
      btrim(p_input ->> 'name'),
      coalesce((p_input ->> 'price')::integer, 0),
      coalesce((p_input ->> 'costPrice')::integer, 0),
      coalesce(p_input ->> 'description', ''),
      nullif(p_input ->> 'imageUrl', ''),
      coalesce((p_input ->> 'isAvailable')::boolean, true),
      -- Tidak adanya kunci `stock` berarti menu ini tidak dilacak — bukan
      -- berarti stoknya nol. Bedanya penting: nol berarti habis.
      (p_input ->> 'stock')::integer,
      coalesce((p_input ->> 'sortOrder')::integer, 0)
    );
  else
    update public.menus
       set category_id  = nullif(p_input ->> 'categoryId', ''),
           name         = btrim(p_input ->> 'name'),
           price        = coalesce((p_input ->> 'price')::integer, price),
           cost_price   = coalesce((p_input ->> 'costPrice')::integer, cost_price),
           description  = coalesce(p_input ->> 'description', description),
           image_url    = nullif(p_input ->> 'imageUrl', ''),
           is_available = coalesce((p_input ->> 'isAvailable')::boolean, is_available),
           stock        = (p_input ->> 'stock')::integer,
           sort_order   = coalesce((p_input ->> 'sortOrder')::integer, sort_order),
           updated_at   = now()
     where id = v_id and store_id = v_sesi.store_id;

    if not found then
      raise exception 'Menu tidak ditemukan' using errcode = 'P0002';
    end if;
  end if;

  select m.* into v_row from public.menus m where m.id = v_id;
  perform app.bump(v_sesi.store_id, 'menus');
  return app.menu_json(v_row);
end $$;

-- Menu dihapus dari katalog, tapi riwayat transaksinya tetap utuh:
-- `order_items` menyimpan nama dan harga sendiri dan tidak memakai kunci asing
-- ke `menus`. Struk lama tidak boleh berubah karena menu dihapus.
create or replace function public.delete_menu(p_token text, p_id text)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_session(p_token);
  if not app.can_edit_catalog(v_sesi.role) then
    raise exception 'Peran % tidak berhak mengubah katalog', v_sesi.role using errcode = '42501';
  end if;

  delete from public.menus where id = p_id and store_id = v_sesi.store_id;
  perform app.bump(v_sesi.store_id, 'menus');
end $$;

create or replace function public.set_menu_availability(
  p_token       text,
  p_id          text,
  p_is_available boolean
)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_session(p_token);

  update public.menus
     set is_available = p_is_available, updated_at = now()
   where id = p_id and store_id = v_sesi.store_id;

  if not found then
    raise exception 'Menu tidak ditemukan' using errcode = 'P0002';
  end if;

  perform app.bump(v_sesi.store_id, 'menus');
end $$;

create or replace function public.save_table(p_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
  v_id   text;
  v_row  public.dining_tables;
begin
  v_sesi := app.require_role(p_token, array['owner']);

  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '');

  if v_id is null then
    v_id := app.new_id('tbl');
    insert into public.dining_tables (id, store_id, number, name, capacity, status, qr_token)
    values (
      v_id, v_sesi.store_id,
      coalesce((p_input ->> 'number')::integer, 1),
      coalesce(nullif(btrim(coalesce(p_input ->> 'name', '')), ''),
               'Meja ' || coalesce((p_input ->> 'number')::integer, 1)),
      coalesce((p_input ->> 'capacity')::integer, 4),
      coalesce(p_input ->> 'status', 'available'),
      -- Token dibuat di server. Kalau client boleh mengirim tokennya sendiri,
      -- token itu tidak lagi jadi rahasia.
      encode(gen_random_bytes(9), 'hex')
    );
  else
    update public.dining_tables
       set number   = coalesce((p_input ->> 'number')::integer, number),
           name     = coalesce(nullif(btrim(coalesce(p_input ->> 'name', '')), ''), name),
           capacity = coalesce((p_input ->> 'capacity')::integer, capacity),
           status   = coalesce(p_input ->> 'status', status)
     where id = v_id and store_id = v_sesi.store_id;

    if not found then
      raise exception 'Meja tidak ditemukan' using errcode = 'P0002';
    end if;
  end if;

  select t.* into v_row from public.dining_tables t where t.id = v_id;
  perform app.bump(v_sesi.store_id, 'menus');
  return app.table_json(v_row);
end $$;

create or replace function public.delete_table(p_token text, p_id text)
returns void
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi app.sessions;
begin
  v_sesi := app.require_role(p_token, array['owner']);

  delete from public.dining_tables where id = p_id and store_id = v_sesi.store_id;
  perform app.bump(v_sesi.store_id, 'menus');
end $$;

-- ============================================================================
-- Stok
-- ============================================================================

-- Saldo tidak boleh jadi negatif, dan yang menolaknya adalah fungsi ini —
-- bukan tampilan. Kalau pemeriksaannya ditaruh di layar, jalur lain (mis.
-- antrean luring yang dikirim ulang) bisa menembusnya dan meninggalkan stok
-- minus.
create or replace function public.record_stock_movement(p_token text, p_input jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_sesi  app.sessions;
  v_menu  public.menus;
  v_delta integer;
  v_saldo integer;
  v_id    text;
begin
  -- Semua peran yang sudah masuk boleh mencatat stok: mencatat susut (waste)
  -- adalah pekerjaan dapur, dan memaksa kasir mencatatkannya hanya membuat
  -- catatannya jadi tidak jujur.
  v_sesi := app.require_session(p_token);

  select m.* into v_menu
    from public.menus m
   where m.id = p_input ->> 'menuId' and m.store_id = v_sesi.store_id;

  if not found then
    raise exception 'Menu tidak ditemukan' using errcode = 'P0002';
  end if;

  -- Menu tanpa pelacakan tidak bisa dicatat pergerakannya: saldonya tidak
  -- punya titik awal, jadi hasilnya tampak seperti stok yang muncul dari udara.
  if v_menu.stock is null then
    raise exception 'Menu ini tidak dilacak stoknya' using errcode = '22023';
  end if;

  v_delta := coalesce((p_input ->> 'delta')::integer, 0);
  if v_delta = 0 then
    raise exception 'Jumlah pergerakan harus bilangan bulat bukan nol' using errcode = '22023';
  end if;

  v_saldo := v_menu.stock + v_delta;
  if v_saldo < 0 then
    raise exception 'Stok tidak cukup: tersisa %, diminta %',
      v_menu.stock, abs(v_delta) using errcode = 'P0001';
  end if;

  update public.menus
     set stock        = v_saldo,
         -- Stok yang kembali terisi otomatis bisa dijual lagi.
         is_available = case when v_saldo > 0 then true else is_available end,
         updated_at   = now()
   where id = v_menu.id;

  v_id := app.new_id('sm');
  insert into public.stock_movements (
    id, store_id, menu_id, menu_name, delta, balance, reason, note, actor
  ) values (
    v_id, v_sesi.store_id, v_menu.id, v_menu.name, v_delta, v_saldo,
    coalesce(p_input ->> 'reason', 'adjustment'),
    coalesce(p_input ->> 'note', ''),
    coalesce(nullif(btrim(coalesce(p_input ->> 'actor', '')), ''), v_sesi.display_name)
  );

  perform app.bump(v_sesi.store_id, 'stock');
  perform app.bump(v_sesi.store_id, 'menus');

  return (select app.movement_json(s) from public.stock_movements s where s.id = v_id);
end $$;

-- ============================================================================
-- Keamanan: siapa boleh membaca apa
-- ============================================================================

alter table public.stores          enable row level security;
alter table public.settings        enable row level security;
alter table public.categories      enable row level security;
alter table public.menus           enable row level security;
alter table public.dining_tables   enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.stock_movements enable row level security;
alter table public.display_state   enable row level security;

-- Katalog dan pengaturan boleh dibaca siapa saja — halaman pesan-sendiri dan
-- layar pelanggan memang menampilkannya tanpa login, dan datanya memang
-- dimaksudkan untuk pelanggan (nama menu, harga, teks QRIS, nomor rekening).
drop policy if exists katalog_baca on public.categories;
drop policy if exists menu_baca    on public.menus;
drop policy if exists setelan_baca on public.settings;
drop policy if exists toko_baca    on public.stores;

create policy katalog_baca on public.categories for select using (true);
create policy menu_baca    on public.menus      for select using (true);
create policy setelan_baca on public.settings   for select using (true);
create policy toko_baca    on public.stores     for select using (true);

-- ---------------------------------------------------------------------------
-- Sisanya sengaja TIDAK punya policy sama sekali.
--
-- Dengan RLS menyala dan tanpa policy, tabel itu tidak bisa dibaca maupun
-- ditulis lewat API — bahkan oleh pemilik sesi yang sah. Itu disengaja:
--
--   * `orders` dan `order_items` berisi nama, surel, dan catatan pelanggan.
--     Yang boleh keluar hanya lewat fungsi yang sudah memeriksa sesi, dan
--     lewat papan antrian publik yang menyembunyikan surel.
--   * `dining_tables` berisi token QR. Kalau daftarnya bisa dibaca, siapa pun
--     bisa memesan ke meja orang lain.
--   * `stock_movements` memuat nama pelaku, dan tidak ada urusan bagi publik.
--
-- Lebih penting lagi: TIDAK ADA policy INSERT / UPDATE / DELETE di mana pun
-- di berkas ini. Artinya kunci anon — yang memang ikut terkirim ke peramban
-- setiap pengunjung — tidak bisa mengubah apa pun. Seluruh penulisan harus
-- lewat fungsi, dan setiap fungsi memeriksa sesi serta peran lebih dulu.
--
-- Bandingkan dengan aplikasi aslinya, yang endpoint admin-nya terbuka: siapa
-- pun yang tahu alamatnya bisa membaca dan mengubah data tanpa masuk.
-- ---------------------------------------------------------------------------

-- Skema `app` tidak diekspos PostgREST, jadi tabel staf, sesi, penghitung,
-- dan revisi tidak bisa dijangkau lewat API. Izin di bawah menutup pintu
-- belakangnya sekaligus: kalau suatu saat PostgREST dikonfigurasi untuk ikut
-- mengekspos `app`, fungsi internal seperti `app.order_json` — yang
-- mengembalikan order lengkap TANPA memeriksa sesi — tidak boleh bisa
-- dipanggil langsung oleh pengunjung anonim.
revoke all on schema app from public;
revoke all on all functions in schema app from public;

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.settings, public.categories, public.menus
  to anon, authenticated;

-- Fungsi `public.*` memang untuk dipanggil: yang butuh sesi memeriksa tokennya
-- sendiri, dan yang tanpa sesi hanya mengembalikan data yang memang publik.
grant execute on all functions in schema public to anon, authenticated;

-- ============================================================================
-- Realtime
-- ============================================================================
--
-- Sengaja TIDAK memakai `postgres_changes`. Yang dikirim hanya SINYAL —
-- "cakupan X berubah, revisi N" — bukan barisnya, karena barisnya akan
-- membocorkan data pelanggan ke setiap pendengar, dan mengirim seluruh baris
-- yang berubah justru lebih mahal daripada polling untuk tabel sebesar ini.
--
-- Dengan `realtime.send(..., private => false)`, siarannya lewat kanal publik
-- `store:<id>`. Isi siarannya cuma nomor revisi dan nama cakupan, jadi tidak
-- ada yang perlu disembunyikan di situ; client lalu mengambil ulang datanya
-- lewat fungsi yang sudah memeriksa sesi.
--
-- Kalau Realtime tidak tersedia, `app.bump` tetap menaikkan revisi di
-- `app.store_revision`, dan client bisa membandingkan lewat `store_revisions`.
-- Aplikasi tetap jalan — hanya kehilangan kesegaran instan.
--
-- Kalau kamu ingin tetap memakai postgres_changes untuk tabel tertentu,
-- tambahkan di sini dan buat policy SELECT-nya. Ingat: policy SELECT untuk
-- `orders` berarti seluruh isi order bisa dibaca anon.

-- ============================================================================
-- Selesai.
--
-- Setelah ini jalankan supabase/seed.sql untuk mengisi toko demo.
--
-- Untuk mengaktifkan di aplikasi, isi berkas .env:
--   VITE_DATA_ADAPTER=supabase
--   VITE_SUPABASE_URL=https://<proyek>.supabase.co
--   VITE_SUPABASE_ANON_KEY=<kunci anon>
-- ============================================================================

