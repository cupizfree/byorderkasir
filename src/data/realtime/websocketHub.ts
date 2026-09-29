/**
 * Kanal realtime lintas-perangkat.
 *
 * Aplikasi aslinya "real-time" lewat polling: layar pelanggan menembak Apps
 * Script tiap 1,2 detik, TV antrian tiap 3,5 detik, admin tiap 6 detik. Selain
 * boros, itu menabrak plafon Google (30 eksekusi bersamaan, dan satu layar
 * pelanggan saja sudah ±72.000 permintaan per hari) — dan begitu plafonnya
 * kena, seluruh sistem berhenti melayani, bukan sekadar melambat.
 *
 * Di sini perubahan **didorong**, bukan ditanya: perangkat yang menulis
 * mengirim sinyal, server meneruskannya ke perangkat lain di toko yang sama.
 * Tidak ada satu pun permintaan saat tidak ada yang berubah.
 *
 * Satu hal yang mudah salah: sinyal `revision` saja tidak cukup
 * antar-perangkat. Dua perangkat menyimpan datanya masing-masing, jadi
 * perangkat kedua tidak akan menemukan apa pun pada revisi itu. Karena itu
 * adapter mock juga mengirim snapshot state penuh — lihat `publishSnapshot`.
 */

import type { ID, RealtimeSignal } from '../../domain/types.ts';
import type { ConnectionStatus } from '../repository.ts';
import type { PublishingRealtimeHub, RealtimeSnapshot } from './contract.ts';

/** Sesuai `WebSocket.OPEN`. Konstanta ditulis sendiri agar tidak butuh DOM. */
const SOCKET_OPEN = 1;
const SOCKET_CONNECTING = 0;

/**
 * Bagian dari WebSocket yang benar-benar dipakai.
 *
 * Ditulis sebagai antarmuka sendiri supaya kanal ini bisa diuji tanpa
 * soket sungguhan — dan supaya modul ini tidak menyeret tipe DOM ke
 * lingkungan Node.
 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, handler: (ev: never) => void): void;
}

export interface WebSocketHubOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  /** Bisa diganti saat pengujian supaya jeda tidak perlu ditunggu sungguhan. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Sumber acak untuk jitter; bisa dipatok saat pengujian. */
  random?: () => number;
}

export class WebSocketRealtimeHub implements PublishingRealtimeHub {
  #url: string;
  #socket: SocketLike | null = null;
  #listeners = new Set<(s: RealtimeSignal) => void>();
  #statusListeners = new Set<(s: ConnectionStatus) => void>();
  #snapshotListeners = new Set<(s: RealtimeSnapshot) => void>();
  #status: ConnectionStatus = 'offline';
  #storeId: ID | null = null;
  #stopped = true;
  #attempt = 0;
  #timer: unknown = null;

  #createSocket: (url: string) => SocketLike;
  #baseDelay: number;
  #maxDelay: number;
  #setTimer: (fn: () => void, ms: number) => unknown;
  #clearTimer: (id: unknown) => void;
  #random: () => number;

  constructor(options: WebSocketHubOptions) {
    this.#url = options.url;
    this.#baseDelay = options.retryDelayMs ?? 1_000;
    this.#maxDelay = options.maxRetryDelayMs ?? 30_000;
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.#random = options.random ?? Math.random;

    this.#createSocket =
      options.createSocket ??
      ((url) => {
        const Ctor = (globalThis as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
        if (!Ctor) throw new Error('WebSocket tidak tersedia di lingkungan ini');
        return new Ctor(url);
      });
  }

  /* --- Siklus hidup ------------------------------------------------------ */

  start(storeId: ID): void {
    this.#storeId = storeId;
    this.#stopped = false;
    this.#attempt = 0;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket?.close();
    } catch {
      // Sudah tertutup — tidak ada yang perlu dilakukan.
    }
    this.#setStatus('offline');
  }

  status(): ConnectionStatus {
    return this.#status;
  }

  subscribe(listener: (s: RealtimeSignal) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  onSnapshot(listener: (s: RealtimeSnapshot) => void): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  /* --- Kirim ------------------------------------------------------------- */

  publish(signal: RealtimeSignal): void {
    this.#send({
      type: 'publish',
      storeId: signal.storeId,
      scope: signal.scope,
      revision: signal.revision,
    });
  }

  publishSnapshot(snapshot: RealtimeSnapshot): void {
    this.#send({
      type: 'snapshot',
      storeId: snapshot.storeId,
      revision: snapshot.revision,
      state: snapshot.state,
    });
  }

  #send(obj: unknown): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      // Tidak ada yang diantrekan di sini. Kalau pengiriman gagal, yang
      // menanganinya adalah antrean tulis (`domain/outbox.ts`) yang punya
      // aturan percobaan ulang dan penanda anti-ganda. Menyimpan antrean
      // kedua di lapisan ini hanya akan membuat dua kebenaran.
      return;
    }
    try {
      socket.send(JSON.stringify(obj));
    } catch (err) {
      console.warn('[realtime] gagal mengirim', err);
    }
  }

  /* --- Sambungan --------------------------------------------------------- */

  #open(): void {
    if (this.#stopped) return;
    const ada = this.#socket;
    if (ada && (ada.readyState === SOCKET_OPEN || ada.readyState === SOCKET_CONNECTING)) return;

    this.#setStatus('connecting');

    let socket: SocketLike;
    try {
      socket = this.#createSocket(this.#url);
    } catch (err) {
      // Lingkungan tanpa WebSocket: tidak ada gunanya mencoba lagi.
      console.warn('[realtime] WebSocket tidak bisa dibuat', err);
      this.#setStatus('offline');
      return;
    }
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#setStatus('live');
      this.#send({ type: 'hello', storeId: this.#storeId });
    });

    socket.addEventListener('message', (ev: never) => {
      this.#handle(ev as unknown as { data?: unknown });
    });

    socket.addEventListener('close', () => {
      this.#socket = null;
      this.#setStatus('offline');
      this.#scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // `close` menyusul setelah ini, jadi penjadwalan ulang ada di sana.
      this.#setStatus('offline');
    });
  }

  #handle(ev: { data?: unknown }): void {
    const raw = typeof ev.data === 'string' ? ev.data : null;
    if (raw === null) return;

    let msg: { type?: unknown; [k: string]: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'welcome':
        this.#setStatus('live');
        return;

      case 'signal': {
        const scope = msg.scope;
        const revision = msg.revision;
        if (typeof scope !== 'string' || typeof revision !== 'number') return;
        if (!this.#storeId) return;
        this.#emit({
          storeId: this.#storeId,
          scope: scope as RealtimeSignal['scope'],
          revision,
          at: new Date().toISOString(),
        });
        return;
      }

      case 'snapshot': {
        const revision = msg.revision;
        if (typeof revision !== 'number' || !this.#storeId) return;
        this.#emitSnapshot({
          storeId: this.#storeId,
          revision,
          state: msg.state,
        });
        return;
      }

      case 'error':
        console.warn('[realtime] server menolak pesan:', msg.message);
        return;

      default:
        return;
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    if (this.#timer !== null) return;

    this.#attempt += 1;

    // Jeda bertambah dua kali lipat, lalu diberi jitter.
    //
    // Tanpa jitter, semua perangkat yang terputus bersamaan (mis. server
    // baru saja dijalankan ulang) akan menyambung lagi pada milidetik yang
    // sama dan menghantam server berulang kali.
    const dasar = Math.min(this.#baseDelay * 2 ** (this.#attempt - 1), this.#maxDelay);
    const jeda = Math.round(dasar * (0.5 + this.#random() * 0.5));

    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      this.#open();
    }, jeda);
  }

  #emit(signal: RealtimeSignal): void {
    if (this.#storeId && signal.storeId !== this.#storeId) return;
    for (const l of this.#listeners) {
      try {
        l(signal);
      } catch (err) {
        console.error('[realtime] pendengar sinyal gagal', err);
      }
    }
  }

  #emitSnapshot(snapshot: RealtimeSnapshot): void {
    if (this.#storeId && snapshot.storeId !== this.#storeId) return;
    for (const l of this.#snapshotListeners) {
      try {
        l(snapshot);
      } catch (err) {
        console.error('[realtime] pendengar snapshot gagal', err);
      }
    }
  }

  #setStatus(s: ConnectionStatus): void {
    if (this.#status === s) return;
    this.#status = s;
    for (const l of this.#statusListeners) l(s);
  }
}
