import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  fmt: { singleQuote: true, semi: true },
  // Hasta que cada prueba esté en TypeScript, el patrón acepta las dos
  // extensiones: cuando termine la migración, aquí sólo queda `.ts`.
  test: { include: ['src/**/*.test.{js,ts}', 'api/**/*.test.ts'] },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  // Los iconos de Solar entran por paquete nativo (@solar-icons/react): sus SVG
  // se compilan al bundle sin pedir nada a la red.
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
});
