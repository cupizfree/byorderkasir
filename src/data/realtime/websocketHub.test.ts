/**
 * Uji lintas-perangkat: dua klien sungguhan, satu server sungguhan.
 *
 * Yang diuji di sini bukan potongan fungsi, melainkan janji utamanya: kalau
 * satu perangkat menulis, perangkat lain di toko yang sama ikut tahu — tanpa
 * ada yang menanya berulang kali. Itu yang tidak pernah benar-benar bekerja
 * di aplikasi aslinya.
 *
 * Server dijalankan sebagai proses terpisah (persis seperti saat dipakai
 * sungguhan), dan klien memakai `WebSocket` bawaan Node — jadi jalur yang
 * diuji adalah jalur yang sama dengan yang dipakai peramban.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import type { RealtimeSignal } from '../../domain/types.ts';
import type { ConnectionStatus } from '../repository.ts';
import type { RealtimeSnapshot } from './contract.ts';
import { WebSocketRealtimeHub } from './websocketHub.ts';

const PORT = 8791 + (process.pid % 100);
const URL = `ws://127.0.0.1:${PORT}`;
const TOKO = 'store-demo';

let server: ChildProcess | null = null;
let logServer = '';

/** Menunggu satu peristiwa pada soket, dengan batas waktu. */
function tunggu(target: EventTarget, jenis: string, ms = 4_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const jam = setTimeout(() => reject(new Error(`tidak ada "${jenis}" dalam ${ms} ms`)), ms);
    target.addEventListener(
      jenis,
      (ev) => {
        clearTimeout(jam);
        resolve(ev);
      },
      { once: true },
    );
  });
}

async function serverSiap(port: number, batasMs = 8_000): Promise<void> {
  const batas = Date.now() + batasMs;
  let terakhir: unknown = null;
  while (Date.now() < batas) {
    let uji: WebSocket | null = null;
    try {
      uji = new WebSocket(`ws://127.0.0.1:${port}`);
      await tunggu(uji, 'open', 1_000);
      uji.close();
      return;
    } catch (err) {
      terakhir = err;
      try {
        uji?.close();
      } catch {
        // Sudah tertutup.
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  // Keluaran server ikut ditampilkan: tanpa ini, kegagalan start hanya
  // terlihat sebagai "tidak bisa tersambung" tanpa sebab yang jelas.
  throw new Error(
    `server tidak siap dalam ${batasMs} ms: ${String(terakhir)}\n--- keluaran server ---\n${logServer || '(kosong)'}`,
  );
}

before(async () => {
  server = spawn('node', ['tools/realtime-server.mjs', '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (b: Buffer) => {
    logServer += b.toString('utf8');
  });
  server.stderr?.on('data', (b: Buffer) => {
    logServer += b.toString('utf8');
  });
  server.on('exit', (kode) => {
    logServer += `\n[server keluar dengan kode ${kode}]`;
  });
  await serverSiap(PORT);
});

after(() => {
  server?.kill('SIGTERM');
  server = null;
});

/** Hub yang sudah tersambung dan siap dipakai. */
async function hubTersambung(storeId = TOKO): Promise<WebSocketRealtimeHub> {
  const hub = new WebSocketRealtimeHub({ url: URL, retryDelayMs: 100, maxRetryDelayMs: 400 });
  hub.start(storeId);
  if (hub.status() !== 'live') {
    await new Promise<void>((resolve, reject) => {
      const jam = setTimeout(() => reject(new Error('tidak kunjung live')), 4_000);
      hub.onStatus((s: ConnectionStatus) => {
        if (s === 'live') {
          clearTimeout(jam);
          resolve();
        }
      });
    });
  }
  return hub;
}

const jeda = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
   Sinyal
   ========================================================================= */

test('sinyal dari satu perangkat sampai ke perangkat lain di toko yang sama', async () => {
  const a = await hubTersambung();
  const b = await hubTersambung();

  try {
    const diterima: RealtimeSignal[] = [];
    b.subscribe((s) => diterima.push(s));

    a.publish({ storeId: TOKO, scope: 'orders', revision: 7, at: new Date().toISOString() });
    await jeda(300);

    assert.equal(diterima.length, 1);
    assert.equal(diterima[0]?.scope, 'orders');
    assert.equal(diterima[0]?.revision, 7);
    assert.equal(diterima[0]?.storeId, TOKO);
  } finally {
    a.stop();
    b.stop();
  }
});

test('pengirim tidak menerima gemanya sendiri', async () => {
  // Kalau gema ikut masuk, setiap perubahan lokal akan memicu pemuatan ulang
  // yang tidak perlu — dan pada antrean luring, bisa memicu pengiriman ulang
  // yang tidak berujung.
  const a = await hubTersambung();
  const b = await hubTersambung();

  try {
    const diA: RealtimeSignal[] = [];
    const diB: RealtimeSignal[] = [];
    a.subscribe((s) => diA.push(s));
    b.subscribe((s) => diB.push(s));

    a.publish({ storeId: TOKO, scope: 'menus', revision: 3, at: new Date().toISOString() });
    await jeda(300);

    assert.equal(diA.length, 0, 'pengirim seharusnya tidak menerima gemanya');
    assert.equal(diB.length, 1);
  } finally {
    a.stop();
    b.stop();
  }
});

test('perangkat di toko berbeda tidak menerima apa pun', async () => {
  // Satu server bisa melayani beberapa toko; sinyal tidak boleh bocor antar toko.
  const a = await hubTersambung(TOKO);
  const lain = await hubTersambung('store-lain');

  try {
    const diterima: RealtimeSignal[] = [];
    lain.subscribe((s) => diterima.push(s));

    a.publish({ storeId: TOKO, scope: 'queue', revision: 99, at: new Date().toISOString() });
    await jeda(300);

    assert.equal(diterima.length, 0);
  } finally {
    a.stop();
    lain.stop();
  }
});

/* ==========================================================================
   Snapshot — inti sinkronisasi lintas-perangkat untuk adapter mock
   ========================================================================= */

test('snapshot state penuh sampai ke perangkat lain', async () => {
  const a = await hubTersambung();
  const b = await hubTersambung();

  try {
    const masuk: RealtimeSnapshot[] = [];
    b.onSnapshot((s) => masuk.push(s));

    a.publishSnapshot({
      storeId: TOKO,
      revision: 42,
      state: { menus: [{ id: 'm1', name: 'Espresso' }], orders: [], revision: 42 },
    });
    await jeda(300);

    assert.equal(masuk.length, 1);
    assert.equal(masuk[0]?.revision, 42);
    const state = masuk[0]?.state as { menus: { name: string }[] };
    assert.equal(state.menus[0]?.name, 'Espresso');
  } finally {
    a.stop();
    b.stop();
  }
});

test('snapshot tanpa state ditolak server, bukan diteruskan', async () => {
  const a = await hubTersambung();
  const b = await hubTersambung();

  try {
    const masuk: RealtimeSnapshot[] = [];
    b.onSnapshot((s) => masuk.push(s));

    // Dikirim mentah supaya bisa membentuk pesan yang cacat.
    const cacat = new WebSocket(URL);
    await tunggu(cacat, 'open');
    cacat.send(JSON.stringify({ type: 'hello', storeId: TOKO }));
    await jeda(150);
    cacat.send(JSON.stringify({ type: 'snapshot', storeId: TOKO, revision: 5 }));

    await jeda(300);
    assert.equal(masuk.length, 0, 'snapshot tanpa state tidak boleh diteruskan');
    cacat.close();
  } finally {
    a.stop();
    b.stop();
  }
});

/* ==========================================================================
   Status
   ========================================================================= */

test('status berubah menjadi live setelah tersambung', async () => {
  const hub = new WebSocketRealtimeHub({ url: URL });
  const jejak: ConnectionStatus[] = [];
  hub.onStatus((s) => jejak.push(s));

  hub.start(TOKO);
  await new Promise<void>((resolve) => {
    const jam = setTimeout(resolve, 3_000);
    hub.onStatus((s) => {
      if (s === 'live') {
        clearTimeout(jam);
        resolve();
      }
    });
  });

  try {
    assert.equal(hub.status(), 'live');
    assert.ok(jejak.includes('connecting'), 'harus melewati connecting');
    assert.ok(jejak.includes('live'), 'harus sampai live');
  } finally {
    hub.stop();
  }
});

test('stop() memutus sambungan dan menandai offline', async () => {
  const hub = await hubTersambung();
  hub.stop();
  assert.equal(hub.status(), 'offline');
});
