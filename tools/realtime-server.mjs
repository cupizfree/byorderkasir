#!/usr/bin/env node
/**
 * tools/realtime-server.mjs
 * ---------------------------------------------------------------------------
 * Server relai WebSocket TANPA dependensi npm untuk sinkronisasi antar-perangkat
 * (tablet display, TV antrian, ponsel pelanggan) pada aplikasi POS byorderkasir.
 *
 * Alat ini dijalankan sendiri oleh operator (self-hosted) — BUKAN bagian dari
 * bundel yang dikirim ke peramban — sehingga boleh memakai API Node, tetapi
 * handshake (RFC 6455 §4) dan pembingkaian frame (§5) ditulis sendiri di atas
 * `node:http` + `node:crypto`. Tidak ada satu pun `import` dari node_modules.
 *
 * Protokol aplikasi (teks JSON, satu pesan per frame teks):
 *   klien -> server : { "type": "hello",   "storeId": "..." }
 *   klien -> server : { "type": "publish", "storeId": "...", "scope": "orders", "revision": 12 }
 *   klien -> server : { "type": "ping" }
 *   server -> klien : { "type": "welcome", "clientId": "...", "peers": N }
 *   server -> klien : { "type": "signal",  "scope": "orders", "revision": 12, "from": "<clientId>" }
 *   server -> klien : { "type": "pong" }
 *
 * Yang diimplementasikan:
 *   - handshake Sec-WebSocket-Accept = base64(sha1(key + GUID))
 *   - frame teks/biner, ping/pong, close (opcode 0x0/0x1/0x2/0x8/0x9/0xA)
 *   - frame klien yang selalu ter-mask, frame server tak ter-mask
 *   - panjang payload 7-bit / 126 (16-bit) / 127 (64-bit)
 *   - frame terfragmentasi (FIN=0 + opcode CONT)
 *   - detak ping tiap 30 detik; soket yang tidak menjawab diputus
 *   - port dari env PORT atau argumen --port (bawaan 8787)
 *   - mati rapi pada SIGINT/SIGTERM
 *
 * Jalankan:  node tools/realtime-server.mjs [--port 8787]
 * ---------------------------------------------------------------------------
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// --- konstanta protokol -----------------------------------------------------

/** Magic GUID dari RFC 6455 §1.3. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Batas ukuran satu pesan `snapshot` (state penuh adapter mock).
 * 1 MB cukup untuk ribuan order; lebih dari itu berarti ada yang salah.
 */
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** Opcode frame (RFC 6455 §5.2). */
export const OP = Object.freeze({
  CONT: 0x0,
  TEXT: 0x1,
  BIN: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
});

/** Kode status penutupan yang dipakai server. */
export const CLOSE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
});

const DEFAULT_PORT = 8787;
const DEFAULT_PING_INTERVAL_MS = 30_000;
/** Batas kewarasan agar satu klien nakal tidak menghabiskan memori. */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

// --- codec frame ------------------------------------------------------------

/**
 * Menyusun satu frame WebSocket.
 *
 * @param {number} opcode
 * @param {Buffer|string} [payload]
 * @param {{ fin?: boolean, mask?: Buffer|boolean|null }} [opts]
 *        `mask` null/undefined => frame tak ter-mask (yang dikirim server).
 *        `mask` Buffer(4) atau `true` => frame ter-mask (dipakai klien/tes).
 * @returns {Buffer}
 */
export function encodeFrame(opcode, payload = Buffer.alloc(0), opts = {}) {
  const { fin = true, mask = null } = opts;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  const maskBit = mask ? 0x80 : 0x00;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = maskBit | len;
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);

  if (!mask) return Buffer.concat([header, body]);

  const key = Buffer.isBuffer(mask) ? mask : crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = body[i] ^ key[i & 3];
  return Buffer.concat([header, key, masked]);
}

/**
 * Membaca satu frame dari awal buffer.
 * @returns {{ frame: {fin:boolean, opcode:number, masked:boolean, length:number, payload:Buffer}, consumed:number } | null}
 *          `null` bila data belum lengkap (tunggu chunk berikutnya).
 * @throws {Error} pada pelanggaran protokol yang fatal (RSV, panjang > 2^53).
 */
function parseFrame(buf) {
  if (buf.length < 2) return null;

  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  const opcode = b0 & 0x0f;
  if (rsv !== 0) throw new Error(`RSV bits tidak didukung (0x${rsv.toString(16)})`);

  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('panjang payload melebihi batas aman');
    length = Number(big);
    offset = 10;
  }

  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + length) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + length));
  if (maskKey) {
    for (let i = 0; i < length; i++) payload[i] ^= maskKey[i & 3];
  }
  return { frame: { fin, opcode, masked, length, payload }, consumed: offset + length };
}

/**
 * Parser frame bertahap: tahan sisa byte yang belum lengkap di antara chunk TCP.
 */
export class FrameParser {
  #buffer = Buffer.alloc(0);

  /** Jumlah byte yang masih menunggu dilengkapi. */
  get buffered() {
    return this.#buffer.length;
  }

  /**
   * Masukkan potongan data mentah; kembalikan semua frame yang sudah utuh.
   * @param {Buffer} chunk
   * @returns {Array<{fin:boolean, opcode:number, masked:boolean, length:number, payload:Buffer}>}
   */
  push(chunk) {
    const part = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk);
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, part]) : part;

    const frames = [];
    for (;;) {
      const parsed = parseFrame(this.#buffer);
      if (!parsed) break;
      this.#buffer = this.#buffer.subarray(parsed.consumed);
      frames.push(parsed.frame);
    }
    return frames;
  }

  reset() {
    this.#buffer = Buffer.alloc(0);
  }
}

/** Payload frame close: 2 byte kode + alasan (maks 123 byte). */
function closePayload(code, reason = '') {
  const text = Buffer.from(String(reason), 'utf8').subarray(0, 123);
  const buf = Buffer.alloc(2 + text.length);
  buf.writeUInt16BE(code, 0);
  text.copy(buf, 2);
  return buf;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- server -----------------------------------------------------------------

/**
 * Membuat server relai (belum listening).
 *
 * @param {object} [options]
 * @param {number} [options.pingIntervalMs=30000] detak ping; 0 = nonaktifkan.
 * @param {(line: string) => void} [options.log] penulis log (bawaan console.log).
 * @param {number} [options.maxMessageBytes]
 */
export function createRealtimeServer(options = {}) {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
  const rawLog = options.log ?? ((line) => console.log(line));
  const stamp = () => new Date().toISOString().slice(11, 19);
  const log = (line) => rawLog(`[realtime ${stamp()}] ${line}`);

  /** @type {Map<string, any>} clientId -> client */
  const clients = new Map();
  /** @type {Set<import('node:net').Socket>} semua soket yang sudah upgrade */
  const sockets = new Set();
  let heartbeat = null;

  // -- util ------------------------------------------------------------------

  function countPeers(storeId, excludeId) {
    let n = 0;
    for (const c of clients.values()) {
      if (c.storeId === storeId && c.id !== excludeId) n++;
    }
    return n;
  }

  function sendFrame(client, opcode, payload) {
    if (client.closed || client.socket.destroyed) return false;
    try {
      client.socket.write(encodeFrame(opcode, payload));
      return true;
    } catch {
      dropClient(client, 'gagal menulis ke soket', { destroy: true });
      return false;
    }
  }

  function send(client, obj) {
    return sendFrame(client, OP.TEXT, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  function sendError(client, message) {
    log(`  ! ${client.id}: ${message}`);
    return send(client, { type: 'error', message });
  }

  /** Siarkan ke klien LAIN di storeId yang sama. @returns {number} jumlah penerima */
  function broadcast(storeId, message, exceptId) {
    const frame = encodeFrame(OP.TEXT, Buffer.from(JSON.stringify(message), 'utf8'));
    let delivered = 0;
    for (const c of clients.values()) {
      if (c.id === exceptId || c.storeId !== storeId || c.closed || c.socket.destroyed) continue;
      try {
        c.socket.write(frame);
        delivered++;
      } catch {
        /* dibersihkan oleh handler 'close' */
      }
    }
    return delivered;
  }

  function dropClient(client, reason, { destroy = false } = {}) {
    if (!clients.has(client.id)) return;
    clients.delete(client.id);
    sockets.delete(client.socket);
    client.closed = true;
    log(`- disconnect client=${client.id} store=${client.storeId ?? '-'} peers=${countPeers(client.storeId, client.id)} (${reason})`);
    if (destroy) {
      try {
        client.socket.destroy();
      } catch {
        /* sudah mati */
      }
    }
  }

  /** Kirim frame close lalu tutup soket dengan sopan (destroy sebagai jaring pengaman). */
  function closeSocket(client, code, reason) {
    if (client.socket.destroyed) return;
    try {
      client.socket.write(encodeFrame(OP.CLOSE, closePayload(code, reason)));
    } catch {
      /* biarkan */
    }
    try {
      client.socket.end();
    } catch {
      /* biarkan */
    }
    const t = setTimeout(() => {
      try {
        client.socket.destroy();
      } catch {
        /* biarkan */
      }
    }, 200);
    t.unref?.();
  }

  function protocolError(client, reason) {
    log(`  ! protocol error client=${client.id}: ${reason}`);
    closeSocket(client, CLOSE.PROTOCOL_ERROR, reason);
    dropClient(client, `protocol error: ${reason}`);
  }

  // -- pemrosesan frame ------------------------------------------------------

  function handleFrame(client, frame) {
    if (client.closed) return;
    const { fin, opcode, masked, payload } = frame;

    // Semua frame dari klien WAJIB ter-mask (RFC 6455 §5.1).
    if (!masked) return protocolError(client, 'frame klien tidak ter-mask');

    // Frame kontrol tidak boleh terfragmentasi dan payloadnya <= 125 byte.
    if (opcode >= 0x8 && (!fin || payload.length > 125)) {
      return protocolError(client, 'frame kontrol tidak valid (FIN/payload)');
    }

    switch (opcode) {
      case OP.CONT: {
        if (client.fragmentOpcode === null) return protocolError(client, 'frame continuation tanpa awal pesan');
        client.fragments.push(payload);
        client.fragmentBytes += payload.length;
        if (client.fragmentBytes > maxMessageBytes) return protocolError(client, 'pesan terfragmentasi terlalu besar');
        if (fin) {
          const data = Buffer.concat(client.fragments);
          const first = client.fragmentOpcode;
          client.fragments = [];
          client.fragmentOpcode = null;
          client.fragmentBytes = 0;
          deliver(client, first, data);
        }
        break;
      }
      case OP.TEXT:
      case OP.BIN: {
        if (client.fragmentOpcode !== null) return protocolError(client, 'frame data baru di tengah pesan terfragmentasi');
        if (payload.length > maxMessageBytes) return protocolError(client, 'frame terlalu besar');
        if (fin) {
          deliver(client, opcode, payload);
        } else {
          client.fragmentOpcode = opcode;
          client.fragments = [payload];
          client.fragmentBytes = payload.length;
        }
        break;
      }
      case OP.CLOSE: {
        let code = CLOSE.NORMAL;
        let reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString('utf8');
        }
        log(`  close dari client=${client.id} code=${code}${reason ? ` reason="${reason}"` : ''}`);
        // Balas frame close dengan kode yang sama, lalu tutup.
        if (!client.socket.destroyed) {
          try {
            client.socket.write(encodeFrame(OP.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : closePayload(CLOSE.NORMAL)));
          } catch {
            /* biarkan */
          }
          try {
            client.socket.end();
          } catch {
            /* biarkan */
          }
        }
        dropClient(client, 'klien menutup koneksi');
        break;
      }
      case OP.PING:
        // Ping tingkat protokol: balas pong dengan payload identik.
        sendFrame(client, OP.PONG, payload);
        break;
      case OP.PONG:
        client.alive = true;
        break;
      default:
        protocolError(client, `opcode tidak didukung: 0x${opcode.toString(16)}`);
    }
  }

  function handleData(client, chunk) {
    if (client.closed) return;
    // Aktivitas apa pun menandakan soket masih hidup.
    client.alive = true;
    let frames;
    try {
      frames = client.parser.push(chunk);
    } catch (err) {
      return protocolError(client, err.message);
    }
    for (const frame of frames) handleFrame(client, frame);
  }

  /** Pesan utuh dari klien (setelah fragmentasi dirakit). */
  function deliver(client, opcode, payload) {
    if (opcode !== OP.TEXT) {
      log(`  · binary ${payload.length}B dari client=${client.id} diabaikan`);
      return;
    }

    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      return sendError(client, 'payload bukan JSON yang sah');
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return sendError(client, 'pesan harus berupa objek JSON');
    }

    switch (msg.type) {
      case 'hello': {
        if (typeof msg.storeId === 'string' && msg.storeId.length > 0) {
          const previous = client.storeId;
          client.storeId = msg.storeId;
          log(
            `  hello client=${client.id} store=${client.storeId}` +
              (previous && previous !== client.storeId ? ` (pindah dari ${previous})` : '') +
              ` peers=${countPeers(client.storeId, client.id)}`,
          );
        } else {
          log(`  hello client=${client.id} store=${client.storeId ?? '-'} (tanpa storeId baru) peers=${countPeers(client.storeId, client.id)}`);
        }
        return;
      }

      case 'publish': {
        const storeId = client.storeId;
        if (!storeId) return sendError(client, 'belum terhubung ke storeId mana pun');
        if (typeof msg.storeId === 'string' && msg.storeId !== storeId) {
          return sendError(client, `storeId tidak cocok: klien terhubung ke "${storeId}"`);
        }
        if (typeof msg.scope !== 'string' || msg.scope.length === 0) {
          return sendError(client, 'publish.scope harus string tidak kosong');
        }
        if (typeof msg.revision !== 'number' || !Number.isFinite(msg.revision)) {
          return sendError(client, 'publish.revision harus angka');
        }

        const signal = { type: 'signal', scope: msg.scope, revision: msg.revision, from: client.id };
        const delivered = broadcast(storeId, signal, client.id);
        // `peers` = klien LAIN di store yang sama (definisi yang sama dengan welcome.peers).
        log(
          `→ signal store=${storeId} scope=${msg.scope} revision=${msg.revision} ` +
            `from=${client.id} peers=${countPeers(storeId, client.id)} penerima=${delivered}`,
        );
        return;
      }

      case 'snapshot': {
        // Snapshot hanya dipakai adapter tanpa backend, di mana tiap perangkat
        // menyimpan datanya sendiri. Backend sungguhan tidak memakainya karena
        // di sana datanya memang satu, di server.
        const storeId = client.storeId;
        if (!storeId) return sendError(client, 'belum terhubung ke storeId mana pun');
        if (typeof msg.storeId === 'string' && msg.storeId !== storeId) {
          return sendError(client, `storeId tidak cocok: klien terhubung ke "${storeId}"`);
        }
        if (typeof msg.revision !== 'number' || !Number.isFinite(msg.revision)) {
          return sendError(client, 'snapshot.revision harus angka');
        }
        if (msg.state === undefined) {
          return sendError(client, 'snapshot.state wajib ada');
        }

        // Batas ukuran: snapshot adalah state penuh, dan satu klien yang
        // mengirim state raksasa akan membebani semua peer sekaligus.
        const encoded = JSON.stringify({
          type: 'snapshot',
          revision: msg.revision,
          state: msg.state,
          from: client.id,
        });
        if (Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) {
          return sendError(
            client,
            `snapshot terlalu besar (>${Math.round(MAX_SNAPSHOT_BYTES / 1024)} KB)`,
          );
        }

        const delivered = broadcast(storeId, JSON.parse(encoded), client.id);
        log(
          `→ snapshot store=${storeId} revision=${msg.revision} ` +
            `from=${client.id} peers=${countPeers(storeId, client.id)} penerima=${delivered}`,
        );
        return;
      }

      case 'ping':
        send(client, { type: 'pong' });
        return;

      default:
        return sendError(client, `tipe pesan tidak dikenal: ${JSON.stringify(msg.type)}`);
    }
  }

  // -- handshake -------------------------------------------------------------

  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url || '/', 'http://placeholder');
    const upgradeHeader = String(req.headers.upgrade || '').toLowerCase();
    const version = String(req.headers['sec-websocket-version'] || '');
    const key = req.headers['sec-websocket-key'];

    if (upgradeHeader !== 'websocket' || version !== '13' || typeof key !== 'string' || key.length === 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );
    socket.setNoDelay(true);

    const storeId = url.searchParams.get('storeId');
    const client = {
      id: crypto.randomBytes(9).toString('base64url'),
      socket,
      storeId,
      parser: new FrameParser(),
      fragments: [],
      fragmentOpcode: null,
      fragmentBytes: 0,
      alive: true,
      closed: false,
    };

    clients.set(client.id, client);
    sockets.add(client.socket);

    const peers = countPeers(storeId, client.id);
    log(`+ connect client=${client.id} store=${storeId ?? '-'} peers=${peers}`);
    send(client, { type: 'welcome', clientId: client.id, peers });

    // Byte yang datang bersama handshake ikut diproses.
    if (head && head.length > 0) handleData(client, head);

    socket.on('data', (chunk) => handleData(client, chunk));
    socket.on('error', () => {
      /* 'close' yang membersihkan */
    });
    socket.on('end', () => {
      /* 'close' yang membersihkan */
    });
    socket.on('close', () => dropClient(client, 'soket ditutup'));
  }

  // -- detak ping ------------------------------------------------------------

  function startHeartbeat() {
    if (heartbeat || !(pingIntervalMs > 0)) return;
    heartbeat = setInterval(() => {
      for (const client of [...clients.values()]) {
        if (!client.alive) {
          log(`! timeout client=${client.id} store=${client.storeId ?? '-'} peers=${countPeers(client.storeId, client.id)} — memutus soket mati`);
          dropClient(client, 'tidak menjawab ping', { destroy: true });
          continue;
        }
        client.alive = false;
        sendFrame(client, OP.PING, Buffer.alloc(0));
      }
    }, pingIntervalMs);
    heartbeat.unref?.();
  }

  // -- http ------------------------------------------------------------------

  const httpServer = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, clients: clients.size, stores: countStores() }));
      return;
    }
    res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Upgrade Required: endpoint ini berbicara WebSocket (ws://host:PORT/?storeId=<id>).\n');
  });
  httpServer.on('upgrade', handleUpgrade);
  httpServer.on('clientError', (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* biarkan */
    }
  });

  function countStores() {
    const stores = new Set();
    for (const c of clients.values()) if (c.storeId) stores.add(c.storeId);
    return stores.size;
  }

  // -- api publik ------------------------------------------------------------

  /**
   * Mulai mendengarkan.
   * @param {{ port?: number, host?: string }} [opts]
   * @returns {Promise<import('node:net').AddressInfo>}
   */
  function listen(opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    const host = opts.host ?? '0.0.0.0';
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      httpServer.once('error', onError);
      httpServer.listen(port, host, () => {
        httpServer.removeListener('error', onError);
        const addr = httpServer.address();
        const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
        log(`listening ws://${shown}:${addr.port}/?storeId=<id>  (detak ping ${pingIntervalMs} ms, tanpa dependensi)`);
        startHeartbeat();
        resolve(addr);
      });
    });
  }

  /** Tutup server + semua klien dengan rapi. */
  async function close() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    const bye = encodeFrame(OP.CLOSE, closePayload(CLOSE.GOING_AWAY, 'server berhenti'));
    for (const client of clients.values()) {
      try {
        client.socket.write(bye);
      } catch {
        /* biarkan */
      }
    }
    if (clients.size > 0) await delay(30);
    for (const socket of [...sockets]) {
      try {
        socket.destroy();
      } catch {
        /* biarkan */
      }
    }
    clients.clear();
    sockets.clear();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 500);
      t.unref?.();
      httpServer.close(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  return {
    listen,
    close,
    httpServer,
    get clientCount() {
      return clients.size;
    },
    /** @internal untuk pengujian */
    _clients: clients,
    _sockets: sockets,
  };
}

// --- entry point ------------------------------------------------------------

/** Tentukan port: --port N / --port=N / env PORT / bawaan 8787. */
export function resolvePort(argv = [], env = {}) {
  const eq = argv.find((a) => a.startsWith('--port='));
  if (eq) return Number(eq.slice('--port='.length));
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1] !== undefined) return Number(argv[i + 1]);
  if (env.PORT !== undefined && env.PORT !== '') return Number(env.PORT);
  return DEFAULT_PORT;
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`port tidak sah: ${port} (harus bilangan bulat 0-65535)`);
  }
  return port;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  let server;
  try {
    const port = validatePort(resolvePort(args, process.env));
    const pingIntervalMs = Number(process.env.WS_PING_INTERVAL_MS) > 0 ? Number(process.env.WS_PING_INTERVAL_MS) : DEFAULT_PING_INTERVAL_MS;
    const host = process.env.HOST || '0.0.0.0';
    server = createRealtimeServer({ pingIntervalMs });
    await server.listen({ port, host });
  } catch (err) {
    console.error(`[realtime] gagal start: ${err.message}`);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[realtime] ${signal} diterima — mematikan dengan rapi…`);
    await server.close();
    console.log('[realtime] berhenti.');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
