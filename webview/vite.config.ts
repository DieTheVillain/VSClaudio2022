/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const CSP =
  "default-src 'self'; img-src 'self' data:; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'";

// Build only: the dev server relies on inline HMR scripts that this policy would block.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  build: { outDir: '../vsix/web', emptyOutDir: true },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
