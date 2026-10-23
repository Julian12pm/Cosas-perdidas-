import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';

/*
 * La puerta del sistema de superficies.
 *
 * El producto tiene UNA receta de panel (relleno, borde, radio, elevación) y
 * un papel por cada sitio donde vive una superficie. Estas pruebas son el
 * grep que el plan exige: los tokens existen y ningún componente vuelve a
 * declarar los suyos.
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** Los archivos que declaran superficies: los componentes de la app. */
function componentFiles() {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.jsx')) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));
  return files.map((file) => ({
    file: file.slice(ROOT.length + 1),
    source: readFileSync(file, 'utf8'),
  }));
}

const COMPONENTS = componentFiles();

describe('el sistema de superficies', () => {
  it('declara los tokens de la receta de superficie', () => {
    for (const token of [
      '--radius-panel',
      '--radius-row',
      '--radius-inset',
      '--color-panel',
      '--color-panel-border',
      '--color-panel-row',
      '--color-panel-inset',
      '--color-accent',
      '--color-accent-border',
      '--shadow-panel',
    ]) {
      expect(CSS, `falta el token ${token}`).toContain(token);
    }
  });

  it('declara una clase por papel de superficie', () => {
    for (const role of ['surface-panel', 'surface-row', 'surface-inset', 'surface-accent']) {
      expect(CSS, `falta el papel ${role}`).toContain(`.${role}`);
    }
  });

  it('ningún componente declara su propia elevación', () => {
    for (const { file, source } of COMPONENTS) {
      expect(source, `${file} declara una elevación propia`).not.toMatch(/shadow-(lg|xl|2xl)\b/);
    }
  });

  it('ningún componente declara su propio relleno de panel', () => {
    for (const { file, source } of COMPONENTS) {
      expect(source, `${file} declara su propio relleno de panel`).not.toMatch(/bg-surface-800/);
    }
  });

  it('ningún componente declara su propio borde de superficie', () => {
    // El borde de un control es surface-600/60 y sólo ése; los demás son de
    // superficie, y ésos los trae el papel.
    for (const { file, source } of COMPONENTS) {
      for (const match of source.matchAll(/border-surface-600\/(\d+)/g)) {
        expect(match[1], `${file} declara un borde de superficie`).toBe('60');
      }
    }
  });

  it('los dos hermanos que muestran lo mismo se parecen', () => {
    // "Mis reportes" y "Bandeja" muestran el mismo tipo de cosa: la tarjeta
    // del reporte y la del reclamo son el mismo papel, con el mismo radio,
    // el mismo relleno y la misma elevación.
    const cards = [
      readFileSync(join(ROOT, 'src/components/MyReports.jsx'), 'utf8'),
      readFileSync(join(ROOT, 'src/components/ClaimInbox.jsx'), 'utf8'),
    ];
    for (const source of cards) {
      expect(source, 'la tarjeta no usa el papel de panel').toMatch(/className="surface-panel/);
    }
  });
});
