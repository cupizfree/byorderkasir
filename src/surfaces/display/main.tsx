/**
 * Entry Layar Pelanggan.
 *
 * Tanpa autentikasi: layar ini hanya menampilkan pesanan yang sedang aktif di
 * kasir, dan hanya yang sengaja dikirim ke sana oleh kasir.
 */

import { render } from 'preact';
import { useEffect } from 'preact/hooks';

import '../../styles/app.css';
import '../../state/theme.ts';
import { ErrorBlock, LoadingBlock } from '../../ui/components.tsx';
import { loadRepository } from '../../data/load.ts';
import {
  connectRealtime,
  displayOrder,
  lastError,
  loadDisplayOrder,
  loadSettings,
  loading,
  settings,
} from '../../state/store.ts';
import { DisplayBoard } from './DisplayBoard.tsx';

function App() {
  useEffect(() => {
    void loadSettings();
    void loadDisplayOrder();

    return connectRealtime({
      onDisplay: loadDisplayOrder,
      onOrders: loadDisplayOrder,
      onSettings: loadSettings,
    });
  }, []);

  if (loading.value && settings.value === null) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-100">
        <LoadingBlock label="Menyiapkan layar…" />
      </div>
    );
  }

  if (lastError.value && settings.value === null) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-100 p-6">
        <ErrorBlock message={lastError.value} onRetry={() => void loadDisplayOrder()} />
      </div>
    );
  }

  const s = settings.value;
  if (!s) return null;

  return <DisplayBoard order={displayOrder.value} settings={s} />;
}

const root = document.getElementById('app');
if (root) {
  await loadRepository();
  render(<App />, root);
}
