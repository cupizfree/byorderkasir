import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QrisError,
  buildTlv,
  crc16,
  describeQrisAmount,
  isValidQris,
  parseTlv,
  qrisWithAmount,
  readQris,
} from './qris.ts';

/**
 * Fixture ini dibangkitkan oleh implementasi CRC16 independen (Python), bukan
 * oleh kode di modul ini — supaya pengujiannya bukan kode menguji dirinya
 * sendiri. Strukturnya meniru QRIS statis sungguhan dari PJSP.
 */
const STATIC_QRIS =
  '00020101021126660014ID.CO.QRIS.WWW01189360091400000000000215ID10200000000000303UMI' +
  '5204581253033605802ID5910KOPI SENJA6007JAKARTA6105121906304A4A4';

/* ==========================================================================
   CRC16
   ========================================================================= */

test('crc16 cocok dengan nilai uji baku CRC-16/CCITT-FALSE', () => {
  // Vektor uji yang ditetapkan untuk varian ini. Kalau ini gagal, seluruh
  // payload QRIS yang kita hasilkan akan ditolak aplikasi pelanggan.
  assert.equal(crc16('123456789'), '29B1');
});

test('crc16 selalu 4 digit heksadesimal huruf besar', () => {
  for (const s of ['', 'A', 'hello world', '0002010102']) {
    assert.match(crc16(s), /^[0-9A-F]{4}$/);
  }
});

test('crc16 mengembalikan nilai awal untuk masukan kosong', () => {
  assert.equal(crc16(''), 'FFFF');
});

/* ==========================================================================
   TLV
   ========================================================================= */

test('parseTlv mengurai tag bersarang', () => {
  const tags = parseTlv(STATIC_QRIS);
  const map = new Map(tags.map((t) => [t.tag, t.value]));

  assert.equal(map.get('00'), '01');
  assert.equal(map.get('01'), '11');
  assert.equal(map.get('59'), 'KOPI SENJA');
  assert.equal(map.get('60'), 'JAKARTA');
  assert.equal(map.get('63'), 'A4A4');
});

test('parseTlv berhenti dengan aman pada payload terpotong', () => {
  const penuh = parseTlv(STATIC_QRIS);
  const potong = parseTlv(STATIC_QRIS.slice(0, 40));
  assert.ok(potong.length < penuh.length);
  assert.ok(potong.length > 0);
});

test('parseTlv mengembalikan daftar kosong untuk sampah', () => {
  assert.deepEqual(parseTlv('bukan-qris-sama-sekali'), []);
});

test('buildTlv(parseTlv(x)) mengembalikan x apa adanya', () => {
  assert.equal(buildTlv(parseTlv(STATIC_QRIS)), STATIC_QRIS);
});

test('buildTlv menolak nilai yang melebihi panjang field', () => {
  assert.throws(() => buildTlv([{ tag: '59', value: 'x'.repeat(100) }]), QrisError);
});

/* ==========================================================================
   Baca
   ========================================================================= */

test('readQris membaca QRIS statis dengan benar', () => {
  const info = readQris(STATIC_QRIS);

  assert.equal(info.initiation, 'static');
  assert.equal(info.merchantName, 'KOPI SENJA');
  assert.equal(info.merchantCity, 'JAKARTA');
  assert.equal(info.currency, '360');
  assert.equal(info.amount, null, 'QRIS statis tidak punya nominal');
  assert.equal(info.crcValid, true);
});

test('readQris menandai CRC tidak sah kalau payload diubah', () => {
  // Ubah satu karakter di nama merchant tanpa menghitung ulang CRC.
  const dirusak = STATIC_QRIS.replace('KOPI SENJA', 'KOPI SENJU');

  assert.equal(readQris(dirusak).crcValid, false);
  assert.equal(isValidQris(dirusak), false);
});

test('isValidQris menerima payload yang sah', () => {
  assert.equal(isValidQris(STATIC_QRIS), true);
});

test('isValidQris menolak masukan kosong dan pendek', () => {
  assert.equal(isValidQris(''), false);
  assert.equal(isValidQris('6304'), false);
});

/* ==========================================================================
   Statis → dinamis
   ========================================================================= */

test('qrisWithAmount menghasilkan QRIS dinamis dengan nominal tertanam', () => {
  const hasil = qrisWithAmount(STATIC_QRIS, 35210);

  assert.equal(hasil.amount, 35210);
  assert.equal(hasil.merchantName, 'KOPI SENJA');

  const info = readQris(hasil.payload);
  assert.equal(info.initiation, 'dynamic', 'tag 01 harus jadi 12');
  assert.equal(info.amount, 35210);
  assert.equal(info.crcValid, true, 'CRC harus dihitung ulang');
});

test('qrisWithAmount mempertahankan seluruh tag lain', () => {
  const asal = new Map(parseTlv(STATIC_QRIS).map((t) => [t.tag, t.value]));
  const baru = new Map(parseTlv(qrisWithAmount(STATIC_QRIS, 15000).payload).map((t) => [t.tag, t.value]));

  for (const [tag, value] of asal) {
    if (tag === '63' || tag === '01' || tag === '54') continue;
    assert.equal(baru.get(tag), value, `tag ${tag} berubah`);
  }
  assert.equal(baru.get('59'), 'KOPI SENJA');
  assert.equal(baru.get('26'), asal.get('26'), 'info akun merchant harus utuh');
});

test('qrisWithAmount menaruh tag 54 sebelum tag 58', () => {
  const payload = qrisWithAmount(STATIC_QRIS, 1000).payload;
  assert.ok(payload.indexOf('5404') < payload.indexOf('5802ID'), 'urutan tag 54 tidak wajar');
});

test('qrisWithAmount mengganti nominal kalau tag 54 sudah ada', () => {
  const sekali = qrisWithAmount(STATIC_QRIS, 1000).payload;
  const duaKali = qrisWithAmount(sekali, 25000).payload;

  assert.equal(readQris(duaKali).amount, 25000);
  assert.equal(parseTlv(duaKali).filter((t) => t.tag === '54').length, 1, 'tag 54 harus tunggal');
});

test('qrisWithAmount menghasilkan CRC berbeda untuk nominal berbeda', () => {
  const a = qrisWithAmount(STATIC_QRIS, 1000).payload;
  const b = qrisWithAmount(STATIC_QRIS, 2000).payload;
  assert.notEqual(a, b);
});

test('qrisWithAmount menolak nominal tidak sah', () => {
  assert.throws(() => qrisWithAmount(STATIC_QRIS, 0), QrisError);
  assert.throws(() => qrisWithAmount(STATIC_QRIS, -5000), QrisError);
  assert.throws(() => qrisWithAmount(STATIC_QRIS, 1500.5), QrisError);
});

test('qrisWithAmount menolak payload yang tidak terbaca', () => {
  assert.throws(() => qrisWithAmount('bukan-qris', 1000), QrisError);
});

test('describeQrisAmount menerjemahkan nominal jadi rupiah', () => {
  assert.equal(describeQrisAmount(qrisWithAmount(STATIC_QRIS, 35210).payload), 'Rp 35.210');
  assert.equal(describeQrisAmount(STATIC_QRIS), 'Nominal diisi pelanggan');
});
