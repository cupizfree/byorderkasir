/**
 * Bel dan panggilan suara untuk layar antrian.
 *
 * Aplikasi aslinya sudah punya bagian ini dan hasilnya bagus (Web Audio untuk
 * bel, SpeechSynthesis untuk suara), jadi pendekatannya dipertahankan — tapi
 * ada dua perbaikan:
 *
 *  1. **Nomor diucapkan sebagai kata Indonesia.** `SpeechSynthesis` dengan
 *     `lang="id-ID"` membaca "A-01" menjadi "a nol satu" (atau "a kosong satu"
 *     tergantung mesinnya). Di sini nomornya diubah lebih dulu jadi "A satu",
 *     jadi terdengar benar di semua mesin.
 *
 *  2. **Audio dibuka sekali, diingat.** Kebijakan autoplay peramban memblokir
 *     suara sampai ada interaksi pengguna. Statusnya disimpan supaya tombol
 *     "aktifkan suara" tidak muncul lagi setelah ditekan.
 */

const AUDIO_UNLOCK_KEY = 'byorderkasir:audio-unlocked';

/* ==========================================================================
   Angka → kata (Indonesia)
   ========================================================================= */

const SATUAN = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'sebelas',
] as const;

/** 1-999 menjadi kata. Cukup untuk nomor antrian harian. */
export function angkaKeKata(n: number): string {
  const num = Math.abs(Math.floor(n));
  if (num < 12) return SATUAN[num] ?? 'nol';
  if (num < 20) return `${SATUAN[num - 10]} belas`;
  if (num < 100) {
    const puluh = Math.floor(num / 10);
    const sisa = num % 10;
    const depan = puluh === 1 ? 'sepuluh' : `${SATUAN[puluh]} puluh`;
    return sisa === 0 ? depan : `${depan} ${SATUAN[sisa]}`;
  }
  const ratus = Math.floor(num / 100);
  const sisa = num % 100;
  const depan = ratus === 1 ? 'seratus' : `${SATUAN[ratus]} ratus`;
  return sisa === 0 ? depan : `${depan} ${angkaKeKata(sisa)}`;
}

/**
 * "A-07" → "A tujuh". Prefix dibaca sebagai huruf.
 * "B-100" → "B seratus".
 */
export function labelKeUcapan(label: string): string {
  const m = /^\s*([A-Za-z]*)\s*-?\s*(\d+)\s*$/.exec(label);
  if (!m) return label;
  const [, prefix = '', digits = ''] = m;
  const num = Number.parseInt(digits, 10);
  const kata = Number.isFinite(num) ? angkaKeKata(num) : digits;
  return prefix ? `${prefix.toUpperCase()} ${kata}` : kata;
}

/* ==========================================================================
   Audio
   ========================================================================= */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Dipanggil dari gestur pengguna (klik) untuk membuka izin audio. */
export async function unlockAudio(): Promise<boolean> {
  const c = getContext();
  if (!c) return false;
  try {
    if (c.state === 'suspended') await c.resume();
    // Mainkan nada tanpa suara supaya peramban menandai audio sebagai "diizinkan".
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.02);
    localStorage.setItem(AUDIO_UNLOCK_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function isAudioUnlocked(): boolean {
  try {
    return localStorage.getItem(AUDIO_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Bel dua nada (ding-dong) — perhatian sebelum pengumuman. */
export function playChime(): void {
  const c = getContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const now = c.currentTime;
  const notes: [number, number][] = [
    [880, 0], // A5
    [660, 0.28], // E5
  ];

  for (const [freq, offset] of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const t = now + offset;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);

    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.9);
  }
}

/** Nada singkat untuk konfirmasi (mis. pembayaran berhasil). */
export function playSuccessChime(): void {
  const c = getContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const now = c.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.1;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

/* ==========================================================================
   Suara
   ========================================================================= */

let cachedVoices: SpeechSynthesisVoice[] = [];

function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const existing = speechSynthesis.getVoices();
  if (existing.length > 0) {
    cachedVoices = existing;
    return Promise.resolve(existing);
  }
  // Daftar suara dimuat asinkron di sebagian peramban.
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1200);
    speechSynthesis.onvoiceschanged = () => {
      clearTimeout(timer);
      cachedVoices = speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
  });
}

/** Pilih suara Indonesia kalau ada; kalau tidak, pakai suara default. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith('id')) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('ms')) ??
    null
  );
}

export function isSpeechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

export interface AnnounceOptions {
  /** Teks tambahan setelah nomor, mis. "silakan diambil". */
  suffix?: string;
  /** 1 = panggilan pertama, >1 = panggilan ulang. */
  attempt?: number;
  onDone?: () => void;
}

/**
 * Umumkan satu nomor: bel, lalu suara.
 * Mengembalikan Promise yang selesai saat pengumuman selesai.
 */
export async function announceQueue(label: string, options: AnnounceOptions = {}): Promise<void> {
  const { suffix = 'silakan diambil', attempt = 1, onDone } = options;

  playChime();
  // Beri jeda supaya bel tidak menabrak suara.
  await new Promise((r) => setTimeout(r, 900));

  if (!isSpeechSupported()) {
    onDone?.();
    return;
  }

  const voices = cachedVoices.length > 0 ? cachedVoices : await voicesReady();
  const voice = pickVoice(voices);

  const pembuka = attempt > 1 ? 'Panggilan ulang. ' : '';
  const teks = `${pembuka}Nomor antrian ${labelKeUcapan(label)}. ${suffix}.`;

  await new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(teks);
    utter.lang = voice?.lang ?? 'id-ID';
    if (voice) utter.voice = voice;
    utter.rate = 0.92;
    utter.pitch = 1;
    utter.volume = 1;

    let selesai = false;
    const finish = () => {
      if (selesai) return;
      selesai = true;
      onDone?.();
      resolve();
    };

    utter.onend = finish;
    utter.onerror = finish;
    // Jaring pengaman: sebagian mesin tidak pernah memicu onend.
    setTimeout(finish, 8000);

    speechSynthesis.speak(utter);
  });
}

export function cancelSpeech(): void {
  if (isSpeechSupported()) speechSynthesis.cancel();
}
