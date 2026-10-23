#!/usr/bin/env node
/**
 * Comprobación estructural con lightpanda: la accesibilidad que una captura no
 * enseña. Un navegador sin píxeles construye el árbol semántico del DOM, así que
 * se ve qué papel juega cada control y cómo se llama — el diálogo, el listbox de
 * zonas, el combobox del buscador — que es justo lo que un screenshot no prueba.
 *
 * lightpanda NO dibuja: no abre el croquis (el PNG no se decodifica a píxeles),
 * pero sí ejecuta el JavaScript de la app. Para llegar a las pantallas que
 * necesitan un clic se inyecta un guion que interactúa y se espera a que el DOM
 * esté en el estado buscado.
 *
 *   vp exec node scripts/structure-check.mjs
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { APP_URL, ROOT, ensureServer } from './smoke-journey.ts';

const execFileAsync = promisify(execFile);
const OUT_DIR = join(ROOT, '.e2e');
const LIGHTPANDA = process.env.LIGHTPANDA_PATH ?? '/usr/bin/lightpanda';

/** La sesión de demostración, sembrada antes de que arranque la app. */
const SESSION = {
  id: 'usr-demo-01',
  email: 'L2030451@morelia.tecnm.mx',
  displayName: 'María Fernanda Ruiz',
  role: 'student',
};

const INJECT_SESSION = `window.localStorage.setItem("objetos-perdidos:session", ${JSON.stringify(
  JSON.stringify(SESSION),
)});`;

/**
 * El guion inyectado sondea el DOM hasta que el control aparece y entonces lo
 * toca: lightpanda no tiene a nadie que le haga clic, así que el clic lo hace
 * la propia página inyectada.
 */
const INJECT_PICKER = `${INJECT_SESSION}
(function () {
  var t0 = Date.now();
  var id = setInterval(function () {
    if (Date.now() - t0 > 8000) { clearInterval(id); return; }
    var input = document.querySelector('[data-testid="picker-input"]');
    if (!input) return;
    clearInterval(id);
    input.click(); input.focus();
  }, 50);
})();`;

const INJECT_DIALOG = `${INJECT_SESSION}
(function () {
  var t0 = Date.now();
  var id = setInterval(function () {
    if (Date.now() - t0 > 8000) { clearInterval(id); return; }
    var option = document.querySelector('[data-testid="picker-option-bldg-a"]');
    if (option) { clearInterval(id); option.click(); return; }
    var input = document.querySelector('[data-testid="picker-input"]');
    if (input) { input.click(); input.focus(); }
  }, 50);
})();`;

// lightpanda no decodifica el PNG del croquis: el contenedor de las zonas sólo
// se pinta cuando la imagen ya tiene tamaño natural, así que en lightpanda las
// zonas del mapa no existen. El camino accesible a ellas es el buscador, y ahí
// sí se ven todas, con su nombre. La espera mira el buscador, no las zonas.
const WAIT_MAP = `!!document.querySelector('[data-testid="picker-input"]')`;
const WAIT_PICKER = `!!document.querySelector('[data-testid="picker-trigger"] ul[role="listbox"]')`;
const WAIT_DIALOG = `!!document.querySelector('[role="dialog"]')`;

/** Las capturas del árbol semántico que se guardan en .e2e/. */
const DUMPS = [
  {
    name: 'login',
    file: 'lightpanda-login-semantic-tree.txt',
    description: 'la pantalla de acceso, sin sesión',
    args: ['--dump', 'semantic_tree_text', '--wait-until', 'networkidle'],
    wait: null,
    inject: null,
  },
  {
    name: 'map',
    file: 'lightpanda-map-semantic-tree.txt',
    description: 'el croquis con la sesión dentro, con sus zonas como opciones',
    args: ['--dump', 'semantic_tree_text', '--wait-until', 'networkidle'],
    wait: WAIT_MAP,
    inject: INJECT_SESSION,
  },
  {
    name: 'picker',
    file: 'lightpanda-picker-semantic-tree.txt',
    description: 'el buscador de zonas abierto, con su listbox',
    args: ['--dump', 'semantic_tree_text', '--wait-until', 'networkidle'],
    wait: WAIT_PICKER,
    inject: INJECT_PICKER,
  },
  {
    name: 'dialog',
    file: 'lightpanda-dialog-semantic-tree.txt',
    description: 'el diálogo de elegir el tipo de pin',
    args: ['--dump', 'semantic_tree_text', '--wait-until', 'networkidle'],
    wait: WAIT_DIALOG,
    inject: INJECT_DIALOG,
  },
  {
    name: 'markdown',
    file: 'lightpanda-map-markdown.md',
    description: 'el croquis leído como markdown',
    args: ['--dump', 'markdown', '--wait-until', 'networkidle'],
    wait: WAIT_MAP,
    inject: INJECT_SESSION,
  },
];

/** Corre lightpanda y devuelve su salida. */
async function lightpanda(
  args: string[],
  extra: string[],
  url?: string,
): Promise<{ stdout: string; stderr: string }> {
  const full = ['fetch', ...args, ...extra];
  if (url) full.push(url);
  const { stdout, stderr } = await execFileAsync(LIGHTPANDA, full, {
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Los papeles y los nombres que aparecen en el árbol semántico. */
interface TreeAnalysis {
  roles: [string, number][];
  controls: string[];
  named: string[];
  dialogs: string[];
  listboxes: string[];
  options: number;
}

function analyze(tree: string): TreeAnalysis {
  const roles = new Map<string, number>();
  const controls = [];
  const named = [];
  const dialogs = [];
  const listboxes = [];
  let options = 0;

  for (const line of tree.split('\n')) {
    const match = line.match(/^\s*\d+\s+(?:\[i\]\s+)?(\w+)(?:\s+'([^']*)')?\s*$/);
    if (!match) continue;
    const [, role, name] = match;
    roles.set(role, (roles.get(role) ?? 0) + 1);
    if (role === 'option') options += 1;
    if (name === undefined) continue;
    if (role === 'dialog') dialogs.push(name);
    if (role === 'listbox') listboxes.push(name);
    if (['button', 'textbox', 'combobox', 'link'].includes(role)) {
      controls.push(`${role} "${name}"`);
    } else if (!['paragraph'].includes(role)) {
      named.push(`${role} "${name}"`);
    }
  }

  return {
    roles: [...roles.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    controls,
    named,
    dialogs,
    listboxes,
    options,
  };
}

/** Un recorte legible del árbol, sin las líneas de texto sueltas. */
function excerpt(text: string, limit = 60): string {
  return text
    .split('\n')
    .filter((line) => /\[i\]|dialog|listbox|option/.test(line))
    .slice(0, limit)
    .join('\n');
}

/** El trozo del árbol que empieza en el diálogo y sigue hasta el final. */
function dialogExcerpt(text: string, limit = 20): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /dialog '/.test(line));
  if (start === -1) return '(no hay diálogo en este árbol)';
  return lines.slice(start, start + limit).join('\n');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const server = await ensureServer(APP_URL);
  console.log(
    server.started
      ? `Servidor de desarrollo arrancado por la prueba en ${APP_URL}`
      : `El servidor en ${APP_URL} ya estaba corriendo: la prueba no lo toca`,
  );

  const written: { file: string; description: string; bytes: number }[] = [];
  const summaries: (TreeAnalysis & {
    file: string;
    description: string;
    stdout: string;
    stderr: string;
    warning: string | null;
    markdownLines?: number;
  })[] = [];

  try {
    for (const dump of DUMPS) {
      const file = join(OUT_DIR, dump.file);

      const extra = [];
      if (dump.wait) {
        const waitFile = join(OUT_DIR, `lightpanda-wait-${dump.name}.js`);
        await writeFile(waitFile, `${dump.wait}\n`);
        extra.push('--wait-script-file', waitFile);
      }
      if (dump.inject) {
        const injectFile = join(OUT_DIR, `lightpanda-inject-${dump.name}.js`);
        await writeFile(injectFile, `${dump.inject}\n`);
        extra.push('--inject-script-file', injectFile);
      }

      let stdout = '';
      let stderr = '';
      let warning = null;
      try {
        const result = await lightpanda(dump.args, extra, APP_URL);
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error) {
        // lightpanda avisa por stderr y sale con 1 cuando el --wait-script no
        // llegó a cumplirse, pero el volcado sí se escribe: se usa igual.
        const failure = error as { stdout?: string; stderr?: string };
        stdout = failure.stdout ?? '';
        stderr = failure.stderr ?? String(error);
        if (!stdout.trim()) throw error;
        warning = stderr.trim().split('\n').pop() ?? null;
      }

      await writeFile(file, stdout);
      written.push({ file, description: dump.description, bytes: Buffer.byteLength(stdout) });

      const summary: TreeAnalysis & { markdownLines?: number } = dump.args.includes('markdown')
        ? {
            roles: [],
            controls: [],
            named: [],
            dialogs: [],
            listboxes: [],
            options: 0,
            markdownLines: stdout.split('\n').length,
          }
        : analyze(stdout);
      summaries.push({ ...summary, file, description: dump.description, stdout, stderr, warning });
    }
  } finally {
    await server.stop();
  }

  /* ─────────────────────────────── Informe ─────────────────────────────── */
  console.log('\n' + '─'.repeat(78));
  console.log('COMPROBACIÓN ESTRUCTURAL — lightpanda');
  console.log('─'.repeat(78));
  console.log(`app: ${APP_URL}\nlightpanda: ${LIGHTPANDA}\n`);

  for (const item of summaries) {
    console.log(`\n▌ ${item.file}`);
    console.log(`  ${item.description}`);
    if (item.warning) console.log(`  aviso de lightpanda: ${item.warning}`);
    if (item.roles.length > 0) {
      console.log(
        `  papeles presentes: ${item.roles.map(([role, count]) => `${role}×${count}`).join(', ')}`,
      );
      console.log('  controles con nombre accesible:');
      for (const control of item.controls.slice(0, 12)) console.log(`    - ${control}`);
      if (item.controls.length > 12) {
        console.log(`    - … y ${item.controls.length - 12} control(es) más`);
      }
      if (item.named.length > 0) {
        console.log('  otros elementos con nombre:');
        for (const entry of item.named.slice(0, 8)) console.log(`    - ${entry}`);
      }
      console.log(`  opciones de zona expuestas: ${item.options}`);
      if (item.listboxes.length > 0) {
        console.log(`  listbox: ${item.listboxes.map((name) => `"${name}"`).join(', ')}`);
      }
      if (item.dialogs.length > 0) {
        console.log(`  diálogo: ${item.dialogs.map((name) => `"${name}"`).join(', ')}`);
      }
    } else {
      console.log(`  líneas de markdown: ${item.markdownLines}`);
    }
  }

  console.log('\n  ── extracto del árbol semántico (diálogo) ──');
  const dialog = summaries.find((item) => item.file.includes('dialog'));
  if (dialog) {
    console.log(dialogExcerpt(dialog.stdout, 16));
  }

  console.log('\n  ── extracto del árbol semántico (mapa) ──');
  const map = summaries.find((item) => item.file.includes('map-semantic'));
  if (map) {
    console.log(excerpt(map.stdout, 16));
  }

  console.log('\n  ── markdown completo del croquis ──');
  const markdown = summaries.find((item) => item.file.includes('markdown'));
  if (markdown) {
    console.log(markdown.stdout.trimEnd());
  }

  console.log('\nARCHIVOS:');
  for (const item of written) {
    console.log(`  ${item.file} (${item.bytes} bytes) — ${item.description}`);
  }
  console.log('─'.repeat(78));
}

main().catch((error) => {
  console.error('\nLa comprobación estructural falló:');
  console.error(error);
  process.exitCode = 1;
});
