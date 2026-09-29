/**
 * tools/realtime-server.test.mjs
 * ---------------------------------------------------------------------------
 * Uji perilaku nyata server relai: server benar-benar dijalankan pada port acak,
 * klien WebSocket bawaan Node (globalThis.WebSocket) benar-benar tersambung,
 * dan pesan benar-benar diterima klien lain.
 *
 * Jalankan:  node --test tools/realtime-server.test.mjs
 * ---------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';

import { createRealtimeServer, encodeFrame, FrameParser, OP, resolvePort } from './realtime-server.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- helper: server ---------------------------------------------------------

/**
 * Jalankan server di port acak (port 0) untuk satu tes.
 * @returns {Promise<{server: any, port: number, base: string, logs: string[]}>}
 */
async function startServer(t, options = {}) {
  const logs = [];
  const server = createRealtimeServer({
    pingIntervalMs: options.pingIntervalMs ?? 0, // 0 = detak ping dimatikan kecuali tes khusus
    log: (line) => logs.push(line),
  });
  const addr = await server.listen({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    await server.close();
  });
  return { server, logs, port: addr.port, base: `ws://127.0.0.1:${addr.port}` };
}

// --- helper: klien WebSocket bawaan Node ------------------------------------

/** Klien tipis di atas globalThis.WebSocket dengan antrean pesan + waitFor(). */
function makeClient(url, label = url) {
  const ws = new WebSocket(url);
  const queue = [];
  const pending = new Set();
  let closedInfo = null;

  const parse = (data) => {
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  function dispatch() {
    for (const p of [...pending]) {
      const idx = queue.findIndex(p.predicate);
      if (idx === -1) continue;
      const [msg] = queue.splice(idx, 1);
      clearTimeout(p.timer);
      pending.delete(p);
      p.resolve(msg);
    }
  }

  ws.addEventListener('message', (ev) => {
    queue.push(parse(ev.data));
    dispatch();
  });
  ws.addEventListener('close', (ev) => {
    closedInfo = { code: ev.code, reason: ev.reason };
  });
  ws.addEventListener('error', () => {
    /* diuji lewat open()/waitFor() */
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error(`[${label}] gagal membuka WebSocket`)), { once: true });
    ws.addEventListener('close', () => reject(new Error(`[${label}] ditutup sebelum terbuka`)), { once: true });
  });

  return {
    ws,
    queue,
    opened,
    get closed() {
      return closedInfo;
    },
    send(obj) {
      ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    },
    waitFor(predicate, timeoutMs = 3000, what = 'pesan') {
      return new Promise((resolve, reject) => {
        const p = { predicate, resolve, timer: null };
        p.timer = setTimeout(() => {
          pending.delete(p);
          reject(new Error(`[${label}] timeout ${timeoutMs} ms menunggu ${what}; diterima: ${JSON.stringify(queue)}`));
        }, timeoutMs);
        pending.add(p);
        dispatch();
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* biarkan */
      }
    },
  };
}

/** Sambung klien bawaan Node, tunggu welcome, kembalikan klien. */
async function connect(t, base, storeId) {
  const client = makeClient(`${base}/?storeId=${encodeURIComponent(storeId)}`, storeId);
  t.after(() => client.close());
  await client.opened;
  client.welcome = await client.waitFor((m) => m.type === 'welcome', 3000, 'welcome');
  return client;
}

// --- helper: klien mentah (net) untuk menguji bingkai langsung --------------

/**
 * Klien WebSocket mentah di atas node:net — dipakai untuk mengirim frame yang
 * tidak bisa dibuat klien bawaan: frame terfragmentasi, panjang 126/127,
 * frame tak ter-mask, dan soket yang sengaja tidak menjawab ping.
 */
function rawConnect(port, storeId) {
  const state = {
    socket: null,
    parser: new FrameParser(),
    handshake: '',
    messages: [],
    pings: 0,
    closed: false,
    closeCode: null,
  };
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64');
      socket.write(
        `GET /?storeId=${encodeURIComponent(storeId)} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });

    let buf = Buffer.alloc(0);
    let upgraded = false;

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        state.handshake = buf.subarray(0, idx).toString('latin1');
        buf = buf.subarray(idx + 4);
        upgraded = true;
        state.socket = socket;
        resolve(state);
        if (buf.length === 0) return;
      }
      let frames;
      try {
        frames = state.parser.push(buf);
      } catch {
        socket.destroy();
        return;
      }
      buf = Buffer.alloc(0);
      for (const f of frames) {
        if (f.opcode === OP.CLOSE) {
          state.closed = true;
          if (f.payload.length >= 2) state.closeCode = f.payload.readUInt16BE(0);
        } else if (f.opcode === OP.PING) {
          state.pings++;
        } else if (f.opcode === OP.TEXT) {
          state.messages.push(JSON.parse(f.payload.toString('utf8')));
        }
      }
    });
    socket.on('close', () => {
      state.closed = true;
    });
    socket.on('error', (err) => {
      if (!upgraded) reject(err);
    });
  });
}

/** Kirim pesan teks terfragmentasi (FIN=0 + opcode CONT) dengan kunci mask. */
function sendFragmented(socket, text, pieces = [10, 30]) {
  const body = Buffer.from(text, 'utf8');
  const key = crypto.randomBytes(4);
  let offset = 0;
  const parts = [];
  for (const size of pieces) {
    parts.push(body.subarray(offset, offset + size));
    offset += size;
  }
  parts.push(body.subarray(offset));
  parts.forEach((part, i) => {
    const first = i === 0;
    const last = i === parts.length - 1;
    socket.write(encodeFrame(first ? OP.TEXT : OP.CONT, part, { fin: last, mask: key }));
  });
}

/** Tunggu sampai predikat benar atau waktu habis. */
async function waitUntil(fn, timeoutMs = 2000, step = 10) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await delay(step);
  }
  return fn();
}

// ===========================================================================
// 1. codec frame (tanpa jaringan)
// ===========================================================================

test('codec: encodeFrame/decode untuk panjang 7-bit, 126, dan 127', () => {
  for (const size of [0, 1, 125, 126, 127, 200, 65_535, 65_536, 70_000]) {
    const body = Buffer.alloc(size, 0x41); // 'A'
    for (const mask of [null, crypto.randomBytes(4)]) {
      const frame = encodeFrame(OP.TEXT, body, { mask });
      const [decoded] = new FrameParser().push(frame);
      assert.ok(decoded, `frame ${size}B (mask=${Boolean(mask)}) harus terurai`);
      assert.equal(decoded.opcode, OP.TEXT);
      assert.equal(decoded.masked, Boolean(mask));
      assert.equal(decoded.fin, true);
      assert.equal(decoded.length, size);
      assert.deepEqual(decoded.payload, body, `payload ${size}B harus utuh`);
    }
  }
});

test('codec: parser merakit frame dari chunk yang terpotong sembarang', () => {
  const body = Buffer.from(JSON.stringify({ type: 'publish', scope: 'orders', revision: 12 }), 'utf8');
  const frame = encodeFrame(OP.TEXT, body, { mask: Buffer.from([0x01, 0x02, 0x03, 0x04]) });
  const parser = new FrameParser();
  const frames = [];
  for (let i = 0; i < frame.length; i++) {
    frames.push(...parser.push(frame.subarray(i, i + 1))); // 1 byte per chunk
  }
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].payload, body);
  assert.equal(parser.buffered, 0);
});

test('codec: parser mengurai beberapa frame dalam satu buffer + sisa tak lengkap', () => {
  const a = encodeFrame(OP.TEXT, 'satu', { mask: crypto.randomBytes(4) });
  const b = encodeFrame(OP.PING, Buffer.alloc(0), { mask: crypto.randomBytes(4) });
  const parser = new FrameParser();
  const frames = parser.push(Buffer.concat([a, b, a.subarray(0, 3)]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].payload.toString(), 'satu');
  assert.equal(frames[1].opcode, OP.PING);
  assert.equal(parser.buffered, 3, 'sisa 3 byte harus ditahan');
});

test('codec: resolvePort membaca --port, --port=, dan env PORT', () => {
  assert.equal(resolvePort([], {}), 8787);
  assert.equal(resolvePort(['--port', '9000'], {}), 9000);
  assert.equal(resolvePort(['--port=9100'], {}), 9100);
  assert.equal(resolvePort([], { PORT: '9300' }), 9300);
  assert.equal(resolvePort(['--port', '9000'], { PORT: '9300' }), 9000, 'argumen menang atas env');
});

// ===========================================================================
// 2. handshake + welcome + peer
// ===========================================================================

test('server benar-benar listening dan welcome berisi clientId + peers', async (t) => {
  const { base, port } = await startServer(t);

  const c1 = await connect(t, base, 'store-a');
  assert.equal(typeof c1.welcome.clientId, 'string');
  assert.ok(c1.welcome.clientId.length > 0);
  assert.equal(c1.welcome.peers, 0, 'klien pertama belum punya peer');

  const c2 = await connect(t, base, 'store-a');
  assert.notEqual(c2.welcome.clientId, c1.welcome.clientId);
  assert.equal(c2.welcome.peers, 1, 'klien kedua melihat 1 peer di store yang sama');

  const c3 = await connect(t, base, 'store-b');
  assert.equal(c3.welcome.peers, 0, 'store berbeda tidak dihitung sebagai peer');

  assert.ok(port > 0);
});

test('handshake mengembalikan Sec-WebSocket-Accept yang benar (sha1+GUID)', async (t) => {
  const { port } = await startServer(t);
  const raw = await rawConnect(port, 'store-a');
  t.after(() => raw.socket.destroy());

  assert.match(raw.handshake, /^HTTP\/1\.1 101 Switching Protocols/);
  const key = crypto.randomBytes(16).toString('base64');
  const expected = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  // Ulangi handshake manual dengan key yang kita kendalikan.
  const second = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /?storeId=store-a HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      if (buf.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(buf);
      }
    });
    socket.on('error', reject);
  });
  assert.match(second, new RegExp(`Sec-WebSocket-Accept: ${expected.replace(/[+/=]/g, (c) => '\\' + c)}`));
});

test('permintaan HTTP biasa ditolak 426, /health menjawab JSON', async (t) => {
  const { port } = await startServer(t);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 426);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, clients: 0, stores: 0 });
});

// ===========================================================================
// 3. publish -> signal antar-klien
// ===========================================================================

test('publish dari satu klien diterima klien LAIN di store yang sama', async (t) => {
  const { base, logs } = await startServer(t);
  const tablet = await connect(t, base, 'kafe-1');
  const tv = await connect(t, base, 'kafe-1');

  tablet.send({ type: 'hello', storeId: 'kafe-1' });
  tv.send({ type: 'hello', storeId: 'kafe-1' });

  tablet.send({ type: 'publish', storeId: 'kafe-1', scope: 'orders', revision: 12 });

  const signal = await tv.waitFor((m) => m.type === 'signal', 3000, 'signal di TV antrian');
  assert.deepEqual(signal, {
    type: 'signal',
    scope: 'orders',
    revision: 12,
    from: tablet.welcome.clientId,
  });

  // Pengirim TIDAK menerima sinyalnya sendiri.
  await delay(250);
  assert.equal(
    tablet.queue.filter((m) => m.type === 'signal').length,
    0,
    'pengirim tidak boleh menerima sinyalnya sendiri',
  );

  // Log ringkas memuat sinyal yang disiarkan beserta jumlah peer.
  const line = logs.find((l) => l.includes('→ signal'));
  assert.ok(line, 'harus ada baris log untuk sinyal');
  assert.match(line, /store=kafe-1 scope=orders revision=12/);
  assert.match(line, /peers=1/);
  assert.match(line, /penerima=1/);
});

test('revisi berurutan semuanya tersampaikan dan berurutan', async (t) => {
  const { base } = await startServer(t);
  const a = await connect(t, base, 'kafe-2');
  const b = await connect(t, base, 'kafe-2');

  for (const revision of [1, 2, 3, 4, 5]) {
    a.send({ type: 'publish', scope: 'orders', revision });
    await delay(20);
  }

  const received = [];
  for (let i = 0; i < 5; i++) {
    const m = await b.waitFor((x) => x.type === 'signal', 3000, `signal #${i + 1}`);
    received.push(m.revision);
  }
  assert.deepEqual(received, [1, 2, 3, 4, 5]);
  assert.equal(received[0], 1);
});

test('pesan TIDAK bocor ke storeId yang berbeda', async (t) => {
  const { base } = await startServer(t);
  const storeA = await connect(t, base, 'kafe-a');
  const storeB1 = await connect(t, base, 'kafe-b');
  const storeB2 = await connect(t, base, 'kafe-b');

  storeA.send({ type: 'publish', storeId: 'kafe-a', scope: 'orders', revision: 99 });
  storeB1.send({ type: 'publish', storeId: 'kafe-b', scope: 'queue', revision: 7 });

  // kafe-b saling menerima di dalam roomnya sendiri (queue/7) …
  const own = await storeB2.waitFor((m) => m.type === 'signal', 3000, 'signal internal kafe-b');
  assert.deepEqual(own, { type: 'signal', scope: 'queue', revision: 7, from: storeB1.welcome.clientId });

  // … tapi tidak pernah menerima orders/99 milik kafe-a.
  await delay(300);
  for (const [name, client] of [
    ['kafe-b #1', storeB1],
    ['kafe-b #2', storeB2],
  ]) {
    const leaked = client.queue.filter((m) => m.type === 'signal' && m.scope === 'orders');
    assert.equal(leaked.length, 0, `sinyal kafe-a tidak boleh sampai ke ${name}`);
  }
  assert.equal(
    storeA.queue.filter((m) => m.type === 'signal').length,
    0,
    'kafe-a tidak punya peer, jadi tidak ada sinyal masuk',
  );
});

test('publish dengan storeId yang tidak cocok ditolak dan tidak disiarkan', async (t) => {
  const { base } = await startServer(t);
  const a = await connect(t, base, 'kafe-c');
  const b = await connect(t, base, 'kafe-c');

  a.send({ type: 'publish', storeId: 'kafe-lain', scope: 'orders', revision: 1 });
  const err = await a.waitFor((m) => m.type === 'error', 3000, 'error storeId mismatch');
  assert.match(err.message, /storeId tidak cocok/);

  await delay(200);
  assert.equal(b.queue.filter((m) => m.type === 'signal').length, 0);
});

test('payload cacat dilaporkan sebagai error, bukan mematikan koneksi', async (t) => {
  const { base } = await startServer(t);
  const a = await connect(t, base, 'kafe-d');

  a.send('{ ini bukan json');
  const e1 = await a.waitFor((m) => m.type === 'error', 3000, 'error JSON');
  assert.match(e1.message, /JSON/);

  a.send({ type: 'tidak-dikenal' });
  const e2 = await a.waitFor((m) => m.type === 'error', 3000, 'error tipe');
  assert.match(e2.message, /tidak dikenal/);

  a.send({ type: 'publish', scope: '', revision: 1 });
  const e3 = await a.waitFor((m) => m.type === 'error', 3000, 'error scope');
  assert.match(e3.message, /scope/);

  // Koneksi masih hidup: ping tetap dijawab.
  a.send({ type: 'ping' });
  await a.waitFor((m) => m.type === 'pong', 3000, 'pong');
  assert.equal(a.closed, null, 'koneksi tidak boleh ditutup karena payload cacat');
});

// ===========================================================================
// 4. ping/pong aplikasi & kontrol
// ===========================================================================

test('ping aplikasi dibalas pong', async (t) => {
  const { base } = await startServer(t);
  const c = await connect(t, base, 'kafe-e');
  c.send({ type: 'ping' });
  const pong = await c.waitFor((m) => m.type === 'pong', 3000, 'pong');
  assert.deepEqual(pong, { type: 'pong' });
});

test('ping kontrol (opcode 0x9) dibalas pong kontrol dengan payload sama', async (t) => {
  const { port } = await startServer(t);
  const raw = await rawConnect(port, 'kafe-f');
  t.after(() => raw.socket.destroy());

  const seen = [];
  raw.socket.on('data', () => {});
  raw.socket.write(encodeFrame(OP.PING, Buffer.from('halo'), { mask: crypto.randomBytes(4) }));

  // Parser klien mentah hanya menyimpan pesan teks; baca frame mentah langsung.
  const pong = await new Promise((resolve, reject) => {
    const parser = new FrameParser();
    const timer = setTimeout(() => reject(new Error('tidak ada pong kontrol')), 2000);
    const onData = (chunk) => {
      for (const f of parser.push(chunk)) {
        if (f.opcode === OP.PONG) {
          clearTimeout(timer);
          raw.socket.off('data', onData);
          resolve(f);
        }
        seen.push(f.opcode);
      }
    };
    raw.socket.on('data', onData);
  });
  assert.equal(pong.payload.toString(), 'halo');
});

test('frame close dari klien dibalas close dan soket ditutup', async (t) => {
  const { port } = await startServer(t);
  const raw = await rawConnect(port, 'kafe-g');
  t.after(() => raw.socket.destroy());

  raw.socket.write(encodeFrame(OP.CLOSE, Buffer.from([0x03, 0xe8]), { mask: crypto.randomBytes(4) })); // 1000
  const ok = await waitUntil(() => raw.closed, 2000);
  assert.ok(ok, 'soket harus ditutup setelah frame close');
});

// ===========================================================================
// 5. fragmentasi + panjang 126/127 (klien mentah)
// ===========================================================================

test('pesan terfragmentasi (FIN=0 + CONT) dirakit lalu disiarkan', async (t) => {
  const { base, port } = await startServer(t);
  const tv = await connect(t, base, 'kafe-h');
  const raw = await rawConnect(port, 'kafe-h');
  t.after(() => raw.socket.destroy());

  // Dikirim dalam 4 potongan, termasuk dipecah di tengah string JSON.
  sendFragmented(raw.socket, JSON.stringify({ type: 'publish', scope: 'orders', revision: 31 }), [7, 15, 20]);

  const signal = await tv.waitFor((m) => m.type === 'signal', 3000, 'signal dari frame terfragmentasi');
  assert.equal(signal.scope, 'orders');
  assert.equal(signal.revision, 31);
  assert.equal(signal.from.length > 0, true);
});

test('panjang payload 126 dan 127 dua arah (klien mentah <-> klien bawaan)', async (t) => {
  const { base, port } = await startServer(t);
  const tv = await connect(t, base, 'kafe-i');
  const raw = await rawConnect(port, 'kafe-i');
  t.after(() => raw.socket.destroy());

  // scope 200 byte  -> frame masuk/keluar memakai panjang 126 (16-bit)
  const scope126 = 'o'.repeat(200);
  raw.socket.write(encodeFrame(OP.TEXT, Buffer.from(JSON.stringify({ type: 'publish', scope: scope126, revision: 126 }), 'utf8'), { mask: crypto.randomBytes(4) }));
  const s126 = await tv.waitFor((m) => m.type === 'signal' && m.revision === 126, 3000, 'signal panjang 126');
  assert.equal(s126.scope.length, 200);
  assert.equal(s126.scope, scope126);

  // scope 70.000 byte -> frame masuk/keluar memakai panjang 127 (64-bit)
  const scope127 = 'z'.repeat(70_000);
  raw.socket.write(encodeFrame(OP.TEXT, Buffer.from(JSON.stringify({ type: 'publish', scope: scope127, revision: 127 }), 'utf8'), { mask: crypto.randomBytes(4) }));
  const s127 = await tv.waitFor((m) => m.type === 'signal' && m.revision === 127, 5000, 'signal panjang 127');
  assert.equal(s127.scope.length, 70_000);
  assert.equal(s127.scope, scope127, 'payload besar harus utuh byte-per-byte');

  // Arah sebaliknya: klien bawaan publish scope besar, klien mentah menerimanya.
  tv.send({ type: 'publish', scope: 'y'.repeat(70_000), revision: 128 });
  const ok = await waitUntil(() => raw.messages.some((m) => m.type === 'signal' && m.revision === 128), 3000);
  assert.ok(ok, 'klien mentah harus menerima frame panjang 127 dari server');
  assert.equal(raw.messages.find((m) => m.type === 'signal' && m.revision === 128).scope.length, 70_000);
});

test('frame klien tak ter-mask ditolak dengan close 1002', async (t) => {
  const { port } = await startServer(t);
  const raw = await rawConnect(port, 'kafe-j');
  t.after(() => raw.socket.destroy());

  // Frame teks TANPA mask (pelanggaran RFC 6455 §5.1).
  raw.socket.write(encodeFrame(OP.TEXT, Buffer.from('{"type":"ping"}', 'utf8')));
  const ok = await waitUntil(() => raw.closed, 2000);
  assert.ok(ok, 'soket harus ditutup');
  assert.equal(raw.closeCode, 1002, 'kode close harus 1002 protocol error');
});

// ===========================================================================
// 6. detak ping 30 detik (dipercepat lewat opsi) + pemutusan soket mati
// ===========================================================================

test('detak ping memutus soket yang tidak menjawab', async (t) => {
  const { port, server, logs } = await startServer(t, { pingIntervalMs: 120 });
  const raw = await rawConnect(port, 'kafe-k');
  t.after(() => raw.socket.destroy());

  const ok = await waitUntil(() => raw.closed, 3000);
  assert.ok(ok, 'soket yang tidak menjawab ping harus diputus');
  assert.ok(raw.pings >= 1, 'server harus mengirim minimal satu ping protokol');
  assert.ok(
    logs.some((l) => l.includes('timeout') && l.includes('memutus soket mati')),
    'log harus mencatat pemutusan soket mati',
  );
  assert.equal(server.clientCount, 0, 'klien mati harus dibuang dari daftar');
});

test('klien bawaan Node tetap hidup melewati beberapa detak ping', async (t) => {
  const { base, server } = await startServer(t, { pingIntervalMs: 100 });
  const c = await connect(t, base, 'kafe-l');

  await delay(400); // ~4 detak: klien bawaan otomatis menjawab pong
  assert.equal(c.closed, null, 'klien sehat tidak boleh diputus');
  assert.equal(server.clientCount, 1);

  // Masih bisa bertukar pesan setelah beberapa detak.
  c.send({ type: 'ping' });
  await c.waitFor((m) => m.type === 'pong', 2000, 'pong setelah beberapa detak');
});

// ===========================================================================
// 7. log & pemutusan koneksi
// ===========================================================================

test('log ringkas mencatat koneksi masuk, koneksi putus, dan jumlah peer', async (t) => {
  const { base, logs, server } = await startServer(t);
  const a = await connect(t, base, 'kafe-m');
  const b = await connect(t, base, 'kafe-m');

  assert.ok(logs.some((l) => l.includes('+ connect') && l.includes('peers=0')), 'log koneksi pertama');
  assert.ok(logs.some((l) => l.includes('+ connect') && l.includes('peers=1')), 'log koneksi kedua dengan peers=1');

  b.close();
  const gone = await waitUntil(() => server.clientCount === 1, 2000);
  assert.ok(gone, 'klien yang menutup harus dibuang');
  assert.ok(logs.some((l) => l.includes('- disconnect')), 'log koneksi putus');
  assert.ok(logs.some((l) => l.includes('listening ws://')), 'log saat mulai listening');

  void a;
});

test('close() mematikan server dan semua klien', async (t) => {
  const { base, server } = await startServer(t);
  const a = await connect(t, base, 'kafe-n');
  const b = await connect(t, base, 'kafe-n');

  await server.close();
  const closed = await waitUntil(() => a.closed !== null && b.closed !== null, 2000);
  assert.ok(closed, 'semua klien harus tertutup saat server berhenti');
  assert.equal(server.clientCount, 0);
});
