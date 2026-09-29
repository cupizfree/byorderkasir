/**
 * Entry layar kasir & admin.
 */

import { render } from 'preact';

import '../../styles/app.css';
import { loadRepository } from '../../data/load.ts';
import { AdminShell } from './AdminShell.tsx';

// Adapter data disiapkan sebelum render. Untuk adapter mock ini tidak
// melakukan apa-apa; untuk Supabase ia memuat SDK-nya secara dinamis —
// sehingga bundel demo tidak ikut membawanya.
await loadRepository();

const root = document.getElementById('app');
if (root) render(<AdminShell />, root);
