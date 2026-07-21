import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const copyAppIcon = () => ({
  name: 'copy-app-icon',
  closeBundle() {
    const source = resolve(process.cwd(), 'favicon.png');
    const outputDirectory = resolve(process.cwd(), 'dist');
    if (existsSync(source)) {
      mkdirSync(outputDirectory, { recursive: true });
      copyFileSync(source, resolve(outputDirectory, 'favicon.png'));
    }
  },
});

export default defineConfig({
  plugins: [react(), copyAppIcon()],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
