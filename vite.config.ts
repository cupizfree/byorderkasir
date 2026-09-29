import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Multi-page build.
 *
 * Empat surface punya entry HTML sendiri supaya tiap surface hanya mengunduh
 * kode yang dia pakai. Aplikasi aslinya mengirim satu bundel 1,05 MB ke semua
 * orang — halaman customer ikut memuat kode admin. Di sini halaman customer
 * tidak akan pernah menyentuh modul kasir.
 */
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
    // Minifier bawaan (esbuild) — tidak perlu menambah dependensi.
    // lightningcss akan memberi output beberapa persen lebih kecil, tapi
    // menambah satu paket native hanya untuk itu tidak sepadan.
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
        order: resolve(import.meta.dirname, 'order/index.html'),
        display: resolve(import.meta.dirname, 'display/index.html'),
        queue: resolve(import.meta.dirname, 'queue/index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('node_modules/preact') || id.includes('node_modules/@preact')) {
            return 'vendor-preact';
          }
          return undefined;
        },
      },
    },
    reportCompressedSize: true,
  },
  server: {
    host: true,
    port: 5173,
    // Diperlukan saat aplikasi dibuka lewat tunnel (mis. cloudflared), karena
    // Host header-nya bukan localhost. Vite menolak host tak dikenal secara
    // bawaan; ini hanya untuk pengembangan.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
