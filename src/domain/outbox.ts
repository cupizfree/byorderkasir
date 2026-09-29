/**
 * Antrean tulis luring.
 *
 * Kafe kehilangan jaringan lebih sering daripada yang diperkirakan: wifi
 * putus, kuota habis, atau backend sedang mati. Aplikasi aslinya bergantung
 * penuh pada Google Apps Script yang selalu butuh jaringan — begitu koneksi
 * putus, kasir tidak bisa mencatat order sama sekali, dan yang sudah diketik
 * hilang begitu halaman ditutup.
 *
 * Di sini setiap penulisan yang gagal karena jaringan masuk ke antrean, lalu
 * dikirim ulang saat koneksi kembali. Antrean disimpan di penyimpanan lokal
 * supaya tidak hilang saat halaman ditutup atau dimuat ulang.
 *
 * Satu hal yang harus disebut jujur: mengirim ulang penulisan tidak selalu
 * aman. `createOrder` yang diulang bisa menghasilkan dua order. Karena itu
 * setiap entri membawa `clientRef` — penanda unik yang dibuat di sisi klien
 * dan ikut dikirim ke server, sehingga server bisa mengenali kiriman ulang
 * dan mengabaikannya. Tanpa itu, antrean ini justru merusak data alih-alih
 * menyelamatkannya.
 */

export type OutboxStatus = 'pending' | 'sending' | 'failed';

export interface OutboxEntry {
  id: string;
  /** Penanda unik dari sisi klien — kunci idempotensi saat dikirim ulang. */
  clientRef: string;
  /** Nama operasi, mis. 'createOrder'. */
  op: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: OutboxStatus;
}

/**
 * Tempat penyimpanan antrean. Dipisahkan sebagai antarmuka supaya bisa diuji
 * tanpa `localStorage`, dan supaya nanti bisa dititipkan ke penyimpanan lain
 * (IndexedDB) tanpa mengubah logikanya.
 */
export interface OutboxStore {
  read(): OutboxEntry[];
  write(entries: readonly OutboxEntry[]): void;
}

/** Antrean dalam memori — dipakai pengujian. */
export class MemoryOutboxStore implements OutboxStore {
  #entries: OutboxEntry[] = [];

  read(): OutboxEntry[] {
    return this.#entries.map((e) => ({ ...e }));
  }

  write(entries: readonly OutboxEntry[]): void {
    this.#entries = entries.map((e) => ({ ...e }));
  }
}

/** Batas percobaan sebelum entri dianggap gagal permanen dan berhenti dicoba. */
export const MAX_ATTEMPTS = 6;

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Jeda sebelum percobaan berikutnya, bertambah dua kali lipat tiap gagal.
 *
 * Tanpa jeda, antrean yang isinya gagal semua akan menembak backend tanpa
 * henti dan justru memperparah keadaan yang sedang bermasalah.
 */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

/** Apakah entri ini sudah waktunya dicoba lagi? */
export function isDue(entry: OutboxEntry, now: number): boolean {
  if (entry.status === 'failed') return false;
  if (entry.attempts === 0) return true;
  if (entry.lastAttemptAt === null) return true;
  return now >= Date.parse(entry.lastAttemptAt) + retryDelayMs(entry.attempts);
}

function newRef(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Cadangan untuk lingkungan tanpa Web Crypto.
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Outbox {
  #store: OutboxStore;
  #entries: OutboxEntry[];
  #listeners = new Set<() => void>();

  constructor(store: OutboxStore) {
    this.#store = store;
    this.#entries = store.read();
  }

  /** Tambahkan operasi ke antrean. `clientRef` boleh diberikan pemanggil. */
  add(op: string, payload: unknown, clientRef?: string): OutboxEntry {
    const entry: OutboxEntry = {
      id: newRef(),
      clientRef: clientRef ?? newRef(),
      op,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: 'pending',
    };
    this.#entries = [...this.#entries, entry];
    this.#commit();
    return entry;
  }

  all(): OutboxEntry[] {
    return this.#entries.map((e) => ({ ...e }));
  }

  /** Entri yang belum selesai — termasuk yang sedang dikirim. */
  pending(): OutboxEntry[] {
    return this.#entries.filter((e) => e.status !== 'failed').map((e) => ({ ...e }));
  }

  /** Entri yang sudah waktunya dikirim, berurutan sesuai waktu dibuat. */
  due(now: number = Date.now()): OutboxEntry[] {
    return this.#entries
      .filter((e) => isDue(e, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => ({ ...e }));
  }

  size(): number {
    return this.#entries.length;
  }

  has(op: string): boolean {
    return this.#entries.some((e) => e.op === op && e.status !== 'failed');
  }

  markSending(id: string): void {
    this.#update(id, (e) => ({
      ...e,
      status: 'sending',
      attempts: e.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
    }));
  }

  markDone(id: string): void {
    this.#entries = this.#entries.filter((e) => e.id !== id);
    this.#commit();
  }

  markFailed(id: string, error: string): void {
    this.#update(id, (e) => ({
      ...e,
      lastError: error,
      // Habis percobaan: berhenti dicoba, tapi TETAP disimpan. Menghapusnya
      // berarti pekerjaan kasir hilang tanpa jejak — lebih baik terlihat
      // sebagai kegagalan yang bisa ditangani manusia.
      status: e.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    }));
  }

  remove(id: string): void {
    this.#entries = this.#entries.filter((e) => e.id !== id);
    this.#commit();
  }

  clear(): void {
    this.#entries = [];
    this.#commit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #update(id: string, fn: (entry: OutboxEntry) => OutboxEntry): void {
    this.#entries = this.#entries.map((e) => (e.id === id ? fn(e) : e));
    this.#commit();
  }

  #commit(): void {
    this.#store.write(this.#entries);
    for (const l of this.#listeners) l();
  }
}

/**
 * Antrean yang disimpan di `localStorage`.
 *
 * Isi yang rusak (mis. terbaca sebagian saat peramban ditutup paksa)
 * diperlakukan sebagai antrean kosong, bukan dibiarkan melempar galat —
 * kasir harus tetap bisa membuka aplikasinya.
 */
export class LocalStorageOutboxStore implements OutboxStore {
  #key: string;

  constructor(key = 'byorderkasir:outbox') {
    this.#key = key;
  }

  read(): OutboxEntry[] {
    try {
      const raw = globalThis.localStorage?.getItem(this.#key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  write(entries: readonly OutboxEntry[]): void {
    try {
      globalThis.localStorage?.setItem(this.#key, JSON.stringify(entries));
    } catch {
      // Kuota penuh atau mode privat: antrean tetap jalan di memori.
    }
  }
}
