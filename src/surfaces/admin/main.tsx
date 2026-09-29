/**
 * Entry layar kasir & admin.
 */

import { render } from 'preact';

import '../../styles/app.css';
import { AdminShell } from './AdminShell.tsx';

const root = document.getElementById('app');
if (root) render(<AdminShell />, root);
