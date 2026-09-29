/**
 * Kanal realtime antar-tab.
 *
 * Ini yang membuat kasir, layar pelanggan, dan TV antrian tetap sinkron saat
 * dibuka di beberapa tab peramban yang sama — tanpa server apa pun. Di
 * aplikasi aslinya, tiga tab itu justru saling menembak endpoint Apps Script
 * setiap 1,2–6 detik.
 *
 * Dua jalur dipakai sekaligus karena keduanya punya lubang yang berbeda:
 *
 *  - `BroadcastChannel` — cepat, tapi tidak ada di peramban lama.
 *  - event `storage` — bekerja di mana saja, termasuk saat kuota penyimpanan
 *    penuh sehingga `setItem` gagal.
 *
 * Urutannya penting: penulis menyimpan ke localStorage **sebelum** mengirim
 * pesan, karena penerima akan memuat ulang state dari sana. Kalau pesannya
 * tiba lebih dulu, penerima membaca data lama.
 */

import type { ID, RealtimeSignal } from '../../domain/types.ts';
import type { ConnectionStatus } from '../repository.ts';
import type { PublishingRealtimeHub, RealtimeSnapshot } from './contract.ts';

export const CHANNEL_NAME = 'byorderkasir:realtime';
export const SIGNAL_KEY = `${CHANNEL_NAME}:signal`;
export const SNAPSHOT_KEY = `${CHANNEL_NAME}:snapshot`;

export class BroadcastRealtimeHub implements PublishingRealtimeHub {
  #channel: BroadcastChannel | null = null;
  #listeners = new Set<(s: RealtimeSignal) => void>();
  #statusListeners = new Set<(s: ConnectionStatus) => void>();
  #snapshotListeners = new Set<(s: RealtimeSnapshot) => void>();
  #status: ConnectionStatus = 'offline';
  #storeId: ID | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.#onStorage);
    }
  }

  #onStorage = (e: StorageEvent): void => {
    if (!e.newValue) return;
    try {
      if (e.key === SIGNAL_KEY) {
        this.#emit(JSON.parse(e.newValue) as RealtimeSignal);
      } else if (e.key === SNAPSHOT_KEY) {
        this.#emitSnapshot(JSON.parse(e.newValue) as RealtimeSnapshot);
      }
    } catch {
      // Pesan rusak diabaikan; pembacaan berikutnya akan menyusul.
    }
  };

  start(storeId: ID): void {
    this.#storeId = storeId;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.#channel?.close();
        this.#channel = new BroadcastChannel(CHANNEL_NAME);
        this.#channel.onmessage = (ev: MessageEvent) => {
          const data = ev.data as RealtimeSignal | RealtimeSnapshot | { kind?: string };
          if (data && typeof data === 'object' && 'state' in data) {
            this.#emitSnapshot(data as RealtimeSnapshot);
          } else {
            this.#emit(data as RealtimeSignal);
          }
        };
        this.#setStatus('live');
        return;
      } catch {
        this.#channel = null;
      }
    }

    // Tanpa BroadcastChannel, event `storage` tetap membawa perubahan antar-tab.
    this.#setStatus('live');
  }

  stop(): void {
    this.#channel?.close();
    this.#channel = null;
    this.#setStatus('offline');
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

  status(): ConnectionStatus {
    return this.#status;
  }

  publish(signal: RealtimeSignal): void {
    this.#emit(signal);

    // Simpan dulu, baru kirim — lihat catatan di kepala berkas.
    try {
      localStorage.setItem(SIGNAL_KEY, JSON.stringify(signal));
    } catch {
      // Kuota penuh / mode privat: BroadcastChannel sudah cukup.
    }

    this.#channel?.postMessage(signal);
  }

  publishSnapshot(snapshot: RealtimeSnapshot): void {
    // Tab lain di peramban ini sudah berbagi localStorage yang sama, jadi
    // snapshot tidak perlu dikirim ke mereka.
    void snapshot;
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
