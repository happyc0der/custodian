import { build } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV === 'development';

await build({
  configFile: false,
  root,
  logLevel: 'info',
  plugins: [preact(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: !dev,
    cssMinify: !dev,
    sourcemap: dev ? 'inline' : false,
    rollupOptions: { input: path.join(root, 'app.html') },
  },
});
