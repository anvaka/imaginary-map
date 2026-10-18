import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build works at the site root and under pr-preview/pr-<N>/
  base: './',
  server: { port: 5174, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        architecture: 'architecture/index.html',
        architectureList: 'architecture/List.html',
        cyberpunk: 'cyberpunk/index.html'
      }
    }
  },
  plugins: [{
    // The site's front page is this README, which GitHub Pages renders with Jekyll
    name: 'readme',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'README.md', source: readFileSync('README.md', 'utf8') });
    }
  }]
});
