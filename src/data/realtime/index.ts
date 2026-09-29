/**
 * Kanal realtime gabungan — dua jalur sekaligus.
 *
 *  - **Antar-tab** (`BroadcastChannel` + event `storage`). Selalu ada, tidak
 *    butuh server. Ini yang membuat kasir, layar pelanggan, dan TV antrian
 *    sinkron saat dibuka di peramban yang sama.
 *  - **Lintas-perangkat** (WebSocket ke `tools/realtime-server.mjs`). Ini yang
 *    membuat tablet di meja, TV di dinding, dan ponsel pelanggan ikut bergerak
 *    saat kasir menekan tombol.
 *
 * Keduanya dinyalakan bersama, bukan dipilih salah satu, karena keduanya
 * menutup lubang yang berbeda: tanpa server, sinkronisasi antar-tab tetap
 * jalan penuh; dengan server, jangkauannya meluas ke perangkat lain.
 *
 * Status koneksi yang dilaporkan adalah milik WebSocket, karena hanya jalur
 * itu yang bisa gagal. UI perlu membedakan "tidak ada server realtime" dari
 * "server sedang mati", dan itu tugas `transport()`.
 */

import type { ID, RealtimeSignal } from '../../domain/types.ts';
import type { ConnectionStatus } from '../repository.ts';
import { BroadcastRealtimeHub } from './broadcastHub.ts';
import type { PublishingRealtimeHub, RealtimeSnapshot } from './contract.ts';
import { WebSocketRealtimeHub } from './websocketHub.ts';

/** Jalur yang sedang dipakai, untuk memilih kata yang tepat di layar. */
export type RealtimeTransport = 'tab' | 'websocket';

export class HybridRealtimeHub implements PublishingRealtimeHub {
  #local: PublishingRealtimeHub;
  #remote: PublishingRealtimeHub | null;
  #listeners = new Set<(s: RealtimeSignal) => void>();
  #statusListeners = new Set<(s: ConnectionStatus) => void>();
  #snapshotListeners = new Set<(s: RealtimeSnapshot) => void>();
  #unsubs: Array<() => void> = [];
  #status: ConnectionStatus = 'offline';
  #started = false;

  constructor(local: PublishingRealtimeHub, remote: PublishingRealtimeHub | null) {
    this.#local = local;
    this.#remote = remote;
  }

  start(storeId: ID): void {
    if (this.#started) this.stop();
    this.#started = true;

    this.#local.start(storeId);
    this.#unsubs.push(this.#local.subscribe((s) => this.#emit(s)));
    this.#unsubs.push(this.#local.onSnapshot((s) => this.#emitSnapshot(s)));

    if (this.#remote) {
      this.#remote.start(storeId);
      this.#unsubs.push(this.#remote.subscribe((s) => this.#emit(s)));
      this.#unsubs.push(this.#remote.onSnapshot((s) => this.#emitSnapshot(s)));
      this.#unsubs.push(this.#remote.onStatus((s) => this.#setStatus(s)));
      this.#setStatus(this.#remote.status());
    } else {
      // Tanpa server, antar-tab adalah seluruh jalur yang ada — dan itu
      // memang bekerja, jadi jangan dilaporkan sebagai terputus.
      this.#unsubs.push(this.#local.onStatus((s) => this.#setStatus(s)));
      this.#setStatus(this.#local.status());
    }
  }

  stop(): void {
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#local.stop();
    this.#remote?.stop();
    this.#started = false;
    this.#setStatus('offline');
  }

  status(): ConnectionStatus {
    return this.#status;
  }

  /** Jalur mana yang sedang aktif — dipakai UI untuk memilih kalimatnya. */
  transport(): RealtimeTransport {
    return this.#remote ? 'websocket' : 'tab';
  }

  /** Apakah ada server lintas-perangkat yang dikonfigurasi sama sekali. */
  hasRemote(): boolean {
    return this.#remote !== null;
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

  publish(signal: RealtimeSignal): void {
    this.#local.publish(signal);
    this.#remote?.publish(signal);
  }

  publishSnapshot(snapshot: RealtimeSnapshot): void {
    // Hanya jalur lintas-perangkat yang butuh ini; tab lain di peramban yang
    // sama sudah berbagi penyimpanan yang sama.
    this.#remote?.publishSnapshot(snapshot);
  }

  #emit(signal: RealtimeSignal): void {
    for (const l of this.#listeners) {
      try {
        l(signal);
      } catch (err) {
        console.error('[realtime] pendengar sinyal gagal', err);
      }
    }
  }

  #emitSnapshot(snapshot: RealtimeSnapshot): void {
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

/**
 * URL server realtime.
 *
 * Bisa ditimpa lewat `globalThis.__REALTIME_URL` supaya bisa dicoba dari
 * konsol peramban tanpa membangun ulang.
 */
export function realtimeUrl(): string {
  const timpa = (globalThis as { __REALTIME_URL?: unknown }).__REALTIME_URL;
  if (typeof timpa === 'string') return timpa.trim();

  const raw = import.meta.env?.VITE_REALTIME_URL;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Buat kanal sesuai konfigurasi.
 *
 * Tanpa `VITE_REALTIME_URL`, hanya kanal antar-tab yang dinyalakan — aplikasi
 * tetap berfungsi penuh, hanya tidak lintas-perangkat.
 */
export function createRealtimeHub(url = realtimeUrl()): HybridRealtimeHub {
  const local = new BroadcastRealtimeHub();
  const remote = url ? new WebSocketRealtimeHub({ url }) : null;
  return new HybridRealtimeHub(local, remote);
}

export { BroadcastRealtimeHub } from './broadcastHub.ts';
export { WebSocketRealtimeHub } from './websocketHub.ts';
export type { PublishingRealtimeHub, RealtimeSnapshot } from './contract.ts';
export type { SocketLike, WebSocketHubOptions } from './websocketHub.ts';
