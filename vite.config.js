import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  fmt: { singleQuote: true, semi: true },
  test: { include: ['src/**/*.test.js', 'api/**/*.test.ts'] },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  // Los iconos de Solar entran por paquete nativo (@solar-icons/react): sus SVG
  // se compilan al bundle sin pedir nada a la red.
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
});
