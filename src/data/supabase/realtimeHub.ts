/**
 * Kanal realtime lintas-perangkat lewat Supabase Realtime.
 *
 * Yang diangkut hanya SINYAL — "cakupan orders berubah, revisi 12" — bukan
 * datanya. Client lalu mengambil ulang lewat fungsi yang sudah memeriksa sesi.
 *
 * Ini penting untuk keamanan: kalau barisnya yang disiarkan (mode
 * `postgres_changes`), setiap orang yang punya kunci anon bisa mendengarkan
 * seluruh order yang lewat — lengkap dengan nama dan surel pelanggan. Sinyal
 * revisi tidak membocorkan apa pun.
 *
 * Tidak seperti adapter mock, kanal ini TIDAK mengirim salinan state penuh:
 * di sini datanya memang satu, di server. Salinan penuh justru menjadi sumber
 * kebenaran kedua yang bisa saling bertentangan.
 */

import type { ID, RealtimeSignal } from '../../domain/types.ts';
import type { ConnectionStatus } from '../repository.ts';
import type { RealtimeHub } from '../repository.ts';
import { getClient } from './client.ts';

/** Topik siaran per toko — sama dengan yang dipakai `app.bump` di schema.sql. */
export function topicFor(storeId: ID): string {
  return `store:${storeId}`;
}

/**
 * Terjemahkan status kanal Supabase ke status yang dipahami aplikasi.
 *
 * `polling` sengaja dipakai untuk kegagalan kanal, bukan `offline`: artinya
 * "sambungan langsung tidak jalan, tapi datanya masih bisa diambil" — dan
 * dengan status itu, pengaman polling di `state/store.ts` ikut menyala.
 * `offline` disimpan untuk keadaan benar-benar tanpa sambungan.
 */
function mapStatus(status: string): ConnectionStatus {
  switch (status) {
    case 'SUBSCRIBED':
      return 'live';
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
      return 'polling';
    default:
      return 'offline';
  }
}

export class SupabaseRealtimeHub implements RealtimeHub {
  #listeners = new Set<(s: RealtimeSignal) => void>();
  #statusListeners = new Set<(s: ConnectionStatus) => void>();
  #status: ConnectionStatus = 'connecting';
  #storeId: ID | null = null;
  #channel: ReturnType<ReturnType<typeof getClient>['channel']> | null = null;

  start(storeId: ID): void {
    this.#storeId = storeId;
    this.#setStatus('connecting');

    try {
      const sb = getClient();
      const topik = topicFor(storeId);

      this.#channel = sb
        .channel(topik, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'signal' }, (pesan) => {
          const isi = pesan?.payload as Partial<RealtimeSignal> | undefined;
          if (!isi || typeof isi.revision !== 'number' || typeof isi.scope !== 'string') return;
          this.#emit({
            storeId,
            revision: isi.revision,
            scope: isi.scope as RealtimeSignal['scope'],
            at: typeof isi.at === 'string' ? isi.at : new Date().toISOString(),
          });
        })
        .subscribe((status) => this.#setStatus(mapStatus(status)));
    } catch (err) {
      // Kredensial belum diisi, atau Realtime tidak bisa dijangkau. Bukan
      // kegagalan fatal: pengaman polling di store akan mengambil alih.
      console.warn('[realtime] kanal Supabase tidak bisa dibuka', err);
      this.#setStatus('polling');
    }
  }

  stop(): void {
    const kanal = this.#channel;
    this.#channel = null;
    if (kanal) {
      void getClient().removeChannel(kanal).catch(() => {
        // Sudah tertutup, atau kliennya sudah tidak ada. Tidak ada yang perlu
        // dibereskan.
      });
    }
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

  status(): ConnectionStatus {
    return this.#status;
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

  #setStatus(s: ConnectionStatus): void {
    if (this.#status === s) return;
    this.#status = s;
    for (const l of this.#statusListeners) l(s);
  }
}
