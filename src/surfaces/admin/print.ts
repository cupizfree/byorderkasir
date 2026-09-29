/**
 * Cetak struk thermal 80mm dan tiket dapur.
 *
 * Pendekatannya: bangun DOM tersembunyi di dalam halaman, lalu panggil
 * `window.print()`. CSS cetak di `styles/app.css` yang menyembunyikan sisanya.
 *
 * Kenapa bukan membuka jendela baru: banyak peramban memblokir `window.open`
 * di luar gestur pengguna, dan tablet kasir sering memasang pemblokir popup.
 * Mencetak dari halaman yang sama selalu berhasil.
 *
 * Lebar 80mm = 72mm area cetak. Semua ukuran memakai `mm` supaya hasilnya sama
 * di printer mana pun.
 *
 * Catatan tata letak (semua ini dari melihat hasil cetak sungguhan, bukan
 * menebak dari kode):
 *  - ada padding kiri-kanan 3mm; sebelumnya teks menempel tepi kertas dan
 *    karakter terakhir sering terpotong oleh head printer
 *  - blok identitas memakai satu kolom `label : nilai`, bukan dua kolom yang
 *    saling menjauh sampai pasangan label-nilainya tidak lagi terbaca sebagai
 *    satu pasangan
 *  - kolom uang rata kanan pada digit terakhir, dan `Rp` hanya muncul sekali
 *    di baris terakhir supaya angkanya tidak bergeser antar baris
 */

import { formatRupiah } from '../../domain/money.ts';
import { qrMatrix, qrPathD, qrViewBoxSize } from '../../domain/qr.ts';
import { qrisWithAmount } from '../../domain/qris.ts';
import { formatDateLong, formatTime } from '../../domain/time.ts';
import type { Order, StoreSettings } from '../../domain/types.ts';

const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_gateway: 'QRIS Otomatis',
  qris_static: 'QRIS Toko',
  transfer: 'Transfer',
  debit: 'Debit',
  split: 'Gabungan',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Jam khusus struk, dengan titik dua.
 *
 * `formatTime` mengikuti locale Indonesia dan menghasilkan `21.05`. Di layar
 * itu benar, tapi di atas kertas — tempat pemisah ribuan juga titik — `21.05`
 * terbaca seperti nominal. Titik dua menghilangkan keraguan itu.
 */
function jamStruk(at: Date | string): string {
  return formatTime(at).replace('.', ':');
}

/** Hanya angka, tanpa "Rp". Dipakai di kolom uang supaya digitnya lurus. */
function angka(nilai: number): string {
  return formatRupiah(nilai, false);
}

/* ==========================================================================
   QR untuk struk
   ========================================================================= */

/**
 * QR sebagai SVG inline — printer thermal tidak bisa mengambil gambar dari
 * jaringan, jadi tidak boleh memakai `<img src>`.
 */
function qrSvg(payload: string, sisiMm: number): string {
  try {
    const m = qrMatrix(payload, 'M');
    const d = qrPathD(m);
    const vb = qrViewBoxSize(m);
    return `<svg class="qr-svg" viewBox="0 0 ${vb} ${vb}" width="${sisiMm}mm" height="${sisiMm}mm" shape-rendering="crispEdges"><rect width="${vb}" height="${vb}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch {
    // QR gagal dibangun (payload rusak). Struk tetap harus tercetak — lebih
    // baik tanpa QR daripada tidak tercetak sama sekali.
    return '';
  }
}

/**
 * QRIS dinamis untuk struk yang belum dibayar.
 *
 * Ini yang paling berguna dari struk: pelanggan bisa langsung memindai dan
 * membayar nominal yang sudah tertanam, tanpa mengetik ulang.
 */
function blokQris(order: Order, settings: StoreSettings): string {
  if (order.payment.status === 'paid') return '';
  if (order.payment.method !== 'qris_static') return '';

  const statis = settings.payments.qrisStatic.payload;
  if (!statis) return '';

  try {
    const { payload } = qrisWithAmount(statis, order.payment.amountDue);
    return `
      <div class="pisah"></div>
      <div class="qr-label">Pindai untuk membayar</div>
      <div class="qr-kotak">${qrSvg(payload, 42)}</div>
      <div class="qr-label kecil">${esc(LABEL_METODE.qris_static ?? 'QRIS')} · ${esc(formatRupiah(order.payment.amountDue))}</div>`;
  } catch {
    return '';
  }
}

/* ==========================================================================
   Kerangka
   ========================================================================= */

function cetak(judul: string, isi: string): void {
  const lama = document.getElementById('byorder-print');
  lama?.remove();

  const wadah = document.createElement('div');
  wadah.id = 'byorder-print';
  wadah.setAttribute('aria-hidden', 'true');
  wadah.innerHTML = isi;
  document.body.appendChild(wadah);

  // Judul dokumen dipakai peramban sebagai nama berkas kalau "simpan PDF".
  const judulLama = document.title;
  document.title = judul;

  const bersihkan = () => {
    document.title = judulLama;
    document.getElementById('byorder-print')?.remove();
    window.removeEventListener('afterprint', bersihkan);
  };
  window.addEventListener('afterprint', bersihkan);

  window.print();

  // Sebagian peramban tidak memicu `afterprint`. Bersihkan juga setelah jeda,
  // supaya struk lama tidak menumpuk di DOM.
  window.setTimeout(bersihkan, 3000);
}

/** Satu baris `label : nilai`. Nilai boleh kosong → baris dilewati. */
function meta(label: string, nilai: string | null | undefined): string {
  if (!nilai) return '';
  return `<div class="meta-baris"><span class="meta-label">${esc(label)}</span><span class="meta-nilai">${esc(nilai)}</span></div>`;
}

/** Baris uang: label kiri, nominal rata kanan pada digit terakhir. */
function uang(label: string, nilai: number, kelas = ''): string {
  return `<div class="uang-baris ${kelas}"><span>${esc(label)}</span><span class="uang-nilai">${esc(angka(nilai))}</span></div>`;
}

/* ==========================================================================
   Struk pelanggan
   ========================================================================= */

export function printReceipt(order: Order, settings: StoreSettings): void {
  const lunas = order.payment.status === 'paid';

  const item = order.items
    .map(
      (it) => `
      <div class="item-baris">
        <span class="item-qty">${it.qty}×</span>
        <span class="item-nama">${esc(it.name)}${
          it.notes ? `<span class="item-catatan">${esc(it.notes)}</span>` : ''
        }</span>
        <span class="item-harga">${esc(angka(it.price * it.qty))}</span>
      </div>`,
    )
    .join('');

  // Rincian di atas garis tebal: yang membentuk `order.total`.
  const rincian = [
    uang('Subtotal', order.subtotal),
    ...(order.discountAmount > 0 ? [uang('Diskon', -order.discountAmount)] : []),
    ...(order.serviceAmount > 0 ? [uang('Biaya layanan', order.serviceAmount)] : []),
    ...(order.taxAmount > 0 ? [uang(`Pajak ${order.taxPercent}%`, order.taxAmount)] : []),
  ].join('');

  // Di bawah garis tebal: yang benar-benar dibayar pelanggan.
  const penutup = [
    uang('Total', order.total),
    ...(order.payment.uniqueCode > 0 ? [uang('Kode unik', order.payment.uniqueCode)] : []),
  ].join('');

  const isi = `
    <div class="struk">
      <div class="kop">
        <div class="toko">${esc(settings.name)}</div>
        ${settings.tagline ? `<div class="tagline">${esc(settings.tagline)}</div>` : ''}
        ${settings.address ? `<div class="alamat">${esc(settings.address)}</div>` : ''}
        ${settings.phone ? `<div class="alamat">${esc(settings.phone)}</div>` : ''}
      </div>

      <div class="pisah"></div>

      <div class="meta">
        ${meta('No. Order', order.code)}
        ${meta('Waktu', `${formatDateLong(order.createdAt)} · ${jamStruk(order.createdAt)}`)}
        ${meta('Kasir', order.cashierName)}
        ${meta('Pelanggan', order.customerName)}
        ${meta('Meja', order.tableNumber === null ? 'Kasir' : String(order.tableNumber))}
      </div>

      ${
        order.queueNumber
          ? `<div class="kotak-antrian"><span class="antrian-label">No. Antrian</span><span class="antrian-nomor">${esc(order.queueNumber)}</span></div>`
          : ''
      }

      <div class="pisah"></div>

      <div class="item">${item}</div>

      <div class="pisah"></div>

      <div class="uang">${rincian}</div>

      <div class="pisah-tebal"></div>

      <div class="uang">${penutup}</div>

      <div class="bayar">
        <span>${lunas ? 'SUDAH DIBAYAR' : 'HARUS DIBAYAR'}</span>
        <span class="bayar-nilai">Rp&nbsp;${esc(angka(order.payment.amountDue))}</span>
      </div>

      <div class="pisah"></div>

      <div class="metode">
        ${meta('Metode', LABEL_METODE[order.payment.method] ?? order.payment.method)}
        ${meta('Status', lunas ? 'LUNAS' : 'BELUM BAYAR')}
        ${
          order.payment.method === 'cash' && order.payment.cashReceived > 0
            ? meta('Tunai diterima', angka(order.payment.cashReceived)) +
              meta('Kembalian', angka(order.payment.cashChange))
            : ''
        }
      </div>

      ${blokQris(order, settings)}

      ${
        order.customerNotes
          ? `<div class="pisah"></div><div class="catatan">Catatan: ${esc(order.customerNotes)}</div>`
          : ''
      }

      <div class="pisah"></div>
      <div class="kaki">
        ${settings.receipt.customerFooter ? `<div>${esc(settings.receipt.customerFooter)}</div>` : ''}
        <div class="kecil">byorderkasir</div>
      </div>
    </div>`;

  cetak(`Struk ${order.code}`, isi);
}

/* ==========================================================================
   Tiket dapur
   ========================================================================= */

export function printKitchenTicket(order: Order, settings: StoreSettings): void {
  const item = order.items
    .map(
      (it) => `
      <div class="dapur-item">
        <span class="dapur-qty">${it.qty}×</span>
        <span class="dapur-nama">${esc(it.name)}${
          it.notes ? `<span class="dapur-catatan">${esc(it.notes)}</span>` : ''
        }</span>
      </div>`,
    )
    .join('');

  const isi = `
    <div class="struk dapur">
      <div class="dapur-kop">
        <span class="dapur-judul">TIKET DAPUR</span>
        <span class="dapur-waktu">${esc(jamStruk(order.createdAt))}</span>
      </div>

      <div class="pisah-tebal"></div>

      <div class="dapur-kepala">
        <span class="dapur-nomor">${esc(order.queueNumber ?? order.code)}</span>
        <span class="dapur-meja">${order.tableNumber === null ? 'KASIR' : `MEJA ${order.tableNumber}`}</span>
      </div>

      <div class="pisah-tebal"></div>

      <div class="dapur-daftar">${item}</div>

      ${
        order.customerNotes
          ? `<div class="pisah-tebal"></div><div class="dapur-catatan-pesanan">${esc(order.customerNotes)}</div>`
          : ''
      }

      <div class="pisah"></div>
      <div class="kaki kecil">${esc(settings.receipt.kitchenFooter)}</div>
    </div>`;

  cetak(`Tiket ${order.code}`, isi);
}
