import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'child_process';

// Commit embutido no bundle: o aviso de atualização compara com o commit do version.json.
const appCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
})();

export default defineConfig(() => {
    return {
      define: {
        __APP_COMMIT__: JSON.stringify(appCommit),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) {
                return undefined;
              }

              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }

              if (id.includes('recharts') || id.includes('d3-')) {
                return 'vendor-charts';
              }

              if (id.includes('jspdf-autotable')) {
                return 'vendor-pdf-table';
              }

              if (id.includes('jspdf')) {
                return 'vendor-pdf';
              }

              if (id.includes('html2canvas')) {
                return 'vendor-canvas';
              }

              if (id.includes('dompurify')) {
                return 'vendor-sanitize';
              }

              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }

              if (id.includes('react') || id.includes('scheduler')) {
                return 'vendor-react';
              }

              return undefined;
            }
          }
        }
      }
    };
});
