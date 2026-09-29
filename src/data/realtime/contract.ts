/**
 * Kontrak kanal realtime.
 *
 * `RealtimeHub` (di `data/repository.ts`) sengaja hanya tahu cara
 * *mendengarkan*. Yang menulis perubahan adalah repositori, dan repositori
 * butuh cara mengirim juga — itulah `PublishingRealtimeHub`.
 *
 * Dipisah dari implementasinya supaya kanal antar-tab dan kanal lintas-perangkat
 * bisa digabung tanpa saling mengimpor.
 */

import type { ID, RealtimeSignal } from '../../domain/types.ts';
import type { RealtimeHub } from '../repository.ts';

/**
 * Salinan state penuh dari perangkat lain.
 *
 * Kenapa perlu, padahal sudah ada sinyal `revision`: dua perangkat menyimpan
 * datanya sendiri-sendiri. Sinyal "revisi 12" tidak berarti apa-apa di
 * perangkat yang belum pernah melihat revisi 1–11. Untuk adapter mock, satu-
 * satunya cara perangkat kedua ikut sinkron adalah menerima datanya.
 *
 * Backend sungguhan tidak butuh ini — di sana datanya memang satu, di server.
 */
export interface RealtimeSnapshot {
  storeId: ID;
  revision: number;
  /** Bentuknya milik adapter, bukan milik kanal. Kanal hanya mengangkut. */
  state: unknown;
}

export interface PublishingRealtimeHub extends RealtimeHub {
  /** Siarkan sinyal perubahan ke semua perangkat. */
  publish(signal: RealtimeSignal): void;
  /** Siarkan state penuh (dipakai adapter mock agar lintas-perangkat benar-benar sinkron). */
  publishSnapshot(snapshot: RealtimeSnapshot): void;
  /** Terima state penuh dari perangkat lain. */
  onSnapshot(listener: (snapshot: RealtimeSnapshot) => void): () => void;
}
