/**
 * Gerbang masuk.
 *
 * Aplikasi lama menyimpan PIN di kode peramban (`getAdminData('123456', …)`),
 * jadi tidak ada autentikasi sungguhan. Di sini login melewati repositori —
 * dan begitu adapter Supabase dipakai, verifikasinya pindah ke server tanpa
 * mengubah satu baris pun di layar ini.
 *
 * Kredensial demo ditampilkan karena mode mock memang untuk dicoba. Di
 * produksi blok itu tidak muncul (lihat `currentAdapter()`).
 */

import { useState } from 'preact/hooks';

import { currentAdapter } from '../../data/index.ts';
import { Button, Field, Input } from '../../ui/components.tsx';
import { Icon } from '../../ui/icons.tsx';
import { messageOf, signIn } from '../../state/store.ts';

const DEMO = { username: 'admin', password: 'admin123', pin: '123456' };

export interface LoginViewProps {
  onMasuk: () => void;
}

export function LoginView({ onMasuk }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [lihat, setLihat] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const lengkap = username.trim() !== '' && password !== '' && pin.length >= 4;
  const demo = currentAdapter() === 'mock';

  async function masuk(e: Event) {
    e.preventDefault();
    if (!lengkap) return;
    setGalat(null);
    setSibuk(true);
    try {
      await signIn(username, password, pin);
      onMasuk();
    } catch (err) {
      setGalat(messageOf(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div class="surface-dark flex min-h-dvh items-center justify-center p-5">
      <div class="w-full max-w-sm">
        {/* Lambang ------------------------------------------------------ */}
        <div class="mb-6 text-center">
          <span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-[0_8px_28px_rgb(234_88_12/0.45)]">
            <Icon name="store" size={26} />
          </span>
          <h1 class="display mt-4 text-3xl text-white">byorderkasir</h1>
          <p class="mt-1 text-sm text-white/50">POS & self-order untuk kafe dan resto</p>
        </div>

        {/* Kartu -------------------------------------------------------- */}
        <form
          onSubmit={(e) => void masuk(e)}
          class="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-pop backdrop-blur-sm"
        >
          <div class="space-y-4">
            <Field label="Nama pengguna">
              <Input
                value={username}
                onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                placeholder="admin"
                autoComplete="username"
                autofocus
              />
            </Field>

            <Field label="Sandi">
              <div class="relative">
                <Input
                  type={lihat ? 'text' : 'password'}
                  value={password}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  class="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setLihat((v) => !v)}
                  aria-label={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                  class="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                >
                  <Icon name={lihat ? 'eye-off' : 'eye'} size={17} />
                </button>
              </div>
            </Field>

            <Field label="PIN" hint="4–6 angka">
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onInput={(e) =>
                  setPin((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="••••••"
                class="num tracking-[0.4em]"
              />
            </Field>
          </div>

          {galat ? (
            <p class="mt-4 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">
              <Icon name="alert" size={15} class="mt-0.5 shrink-0" />
              {galat}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon="lock"
            loading={sibuk}
            disabled={!lengkap}
            class="mt-5 w-full"
          >
            Masuk
          </Button>
        </form>

        {/* Kredensial demo --------------------------------------------- */}
        {demo ? (
          <div class="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p class="flex items-center gap-2 text-xs font-bold tracking-wide text-white/60 uppercase">
              <Icon name="info" size={13} />
              Mode demo
            </p>
            <dl class="mt-2.5 space-y-1 text-sm">
              {(
                [
                  ['Nama pengguna', DEMO.username],
                  ['Sandi', DEMO.password],
                  ['PIN', DEMO.pin],
                ] as const
              ).map(([label, nilai]) => (
                <div key={label} class="flex items-center justify-between gap-3">
                  <dt class="text-white/50">{label}</dt>
                  <dd class="num font-bold text-white">{nilai}</dd>
                </div>
              ))}
            </dl>
            <Button
              variant="outline"
              size="sm"
              icon="sparkles"
              onClick={() => {
                setUsername(DEMO.username);
                setPassword(DEMO.password);
                setPin(DEMO.pin);
              }}
              class="mt-3 w-full"
            >
              Isi otomatis
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
