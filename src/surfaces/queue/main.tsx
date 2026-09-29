/**
 * Entry layar antrian TV.
 *
 * Halaman ini tidak butuh autentikasi — dia hanya menampilkan nomor yang
 * dipanggil, dan itu memang informasi publik di dalam ruangan.
 */

import { render } from 'preact';
import { useEffect } from 'preact/hooks';

import '../../styles/app.css';
import { ErrorBlock, LoadingBlock } from '../../ui/components.tsx';
import { loadRepository } from '../../data/load.ts';
import {
  connectRealtime,
  lastError,
  loadQueueBoard,
  loadSettings,
  loading,
  queueBoard,
  realtimeStatus,
  settings,
} from '../../state/store.ts';
import { QueueBoard } from './QueueBoard.tsx';

function App() {
  useEffect(() => {
    void loadSettings();
    void loadQueueBoard();

    return connectRealtime({
      onQueue: loadQueueBoard,
      onOrders: loadQueueBoard,
      onSettings: loadSettings,
    });
  }, []);

  if (loading.value && settings.value === null) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-950">
        <LoadingBlock label="Menyiapkan layar antrian…" />
      </div>
    );
  }

  if (lastError.value && settings.value === null) {
    return (
      <div class="flex min-h-dvh items-center justify-center bg-ink-950 p-6">
        <ErrorBlock message={lastError.value} onRetry={() => void loadQueueBoard()} />
      </div>
    );
  }

  return (
    <QueueBoard
      orders={queueBoard.value}
      storeName={settings.value?.name ?? 'Layar Antrian'}
      tagline={settings.value?.tagline || undefined}
      infoText={settings.value?.receipt.customerFooter || undefined}
      status={realtimeStatus.value}
    />
  );
}

const root = document.getElementById('app');
if (root) {
  await loadRepository();
  render(<App />, root);
}
