#!/usr/bin/env node
/**
 * Full-stack smoke journey for "Objetos Perdidos ITM": the REAL stack.
 *
 * The demo journey (`scripts/smoke-journey.mjs`) walks the product on the mock
 * data; this one walks the same product against a Postgres 16 in a container,
 * the Hono API, and the web app with `VITE_API_URL` pointing at it, all driven
 * by the system Chromium (no browser is ever downloaded).
 *
 * Two students live the whole protocol: the owner of a lost object and the
 * finder who claims it. The magic link comes from the API's own log (the
 * console mail transport), the session cookie is minted by the API, and the
 * pins come from the database — the last proof that the journey is real.
 *
 * The script leaves nothing behind: it stops the servers it started and the
 * container it woke up (the volume stays).
 *
 * The database is the one it is told to use: with `DATABASE_URL` in the
 * environment the journey walks against that Postgres as it is — no podman,
 * no container — and empties its own tables before it starts, so a second run
 * starts from the same state. Without it, the journey brings up the Postgres 16
 * of the compose file and stops it when it is done.
 *
 * The web port is not 5173: on this machine that one belongs to another
 * project. The journey picks a free port of its own (override it with
 * APP_URL) and it makes sure the server it drives is THIS app before it
 * starts the journey.
 *
 *   vp exec node scripts/smoke-api.mjs
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { servesOurApp } from './smoke-journey.mjs';

/* ─────────────────────────── Configuración ─────────────────────────── */

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_URL = process.env.APP_URL ?? 'http://localhost:5199';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
/**
 * El Postgres que camina el viaje.
 *
 * Con `DATABASE_URL` en el entorno ésa es la base de datos de alguien más (el
 * servicio de CI, la del propio desarrollador): el viaje la usa tal cual y no
 * toca ningún contenedor. Sin ella, el viaje levanta la de Compose.
 */
const EXTERNAL_DATABASE = Boolean(process.env.DATABASE_URL);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/objetos_perdidos';
const SHOTS_DIR = join(ROOT, '.e2e', 'screenshots');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const VP = join(ROOT, 'node_modules', '.bin', 'vp');
const STEP_TIMEOUT_MS = 20_000;
const BOOT_TIMEOUT_MS = 120_000;

const OWNER_EMAIL = 'L2030451@morelia.tecnm.mx';
const FINDER_EMAIL = 'L7654321@morelia.tecnm.mx';
const OWNER_ITEM = 'Laptop HP gris con sticker de React';
const OWNER_DESCRIPTION = 'Se me olvidó en el pasillo del edificio E, segundo piso.';
const FINDER_ITEM = 'Computadora gris abandonada';
const FINDER_DESCRIPTION = 'Estaba junto a la ventana del pasillo del edificio E.';
const FINDER_BLIND = 'HP Pavilion gris, tapa verde, sticker de React y una mochila azul.';

/* ──────────────────────────── Utilidades ──────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const t = (id) => `[data-testid="${id}"]`;

/** Corre un comando y devuelve su código y su salida. */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, ...options });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => resolve({ code: 1, output: String(error) }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** ¿Contesta el API en esa URL? */
async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/* ────────────────────────────── La base de datos ────────────────────────────── */

/**
 * La conexión al Postgres que camina el viaje.
 *
 * El mismo `pg` que usa el API: sin podman y sin `psql` dentro de un
 * contenedor, así que la base de datos del desarrollador y el servicio de CI
 * se tratan igual.
 */
let pool = null;

function db() {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
    // Un cliente ocioso que muere no debe tumbar el proceso.
    pool.on('error', (error) => console.error('Postgres pool error:', error.message));
  }
  return pool;
}

/** Espera a que la base de datos acepte conexiones. */
async function waitForDatabase(timeout = BOOT_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await db().query('select 1');
      return true;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`La base de datos ${DATABASE_URL} no aceptó conexiones a tiempo`);
}

/* ──────────────────────────── El stack ──────────────────────────── */

/**
 * La imagen de Postgres 16.
 *
 * `podman-compose` no resuelve el nombre corto, así que la imagen se trae
 * con su nombre completo y se etiqueta en local: el `docker-compose.yml` del
 * repositorio no se toca.
 */
async function ensureImage() {
  const full = 'docker.io/library/postgres:16';
  const exists = await run('podman', ['image', 'exists', full]);
  if (exists.code !== 0) {
    const pull = await run('podman', ['pull', full]);
    if (pull.code !== 0) {
      throw new Error(`No se pudo traer la imagen de Postgres:\n${pull.output}`);
    }
  }
  await run('podman', ['tag', full, 'postgres:16']);
}

/** El nombre del contenedor de la base de datos, el que dejó Compose. */
async function dbContainerName() {
  const listed = await run('podman', ['ps', '--format', '{{.Names}}']);
  const names = listed.output
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  return names.find((name) => name.endsWith('db_1') || name.endsWith('-db-1')) ?? null;
}

/** Levanta la base de datos y espera a que acepte conexiones. */
async function startDatabase() {
  const up = await run('podman', ['compose', 'up', '-d', 'db']);
  if (up.code !== 0) {
    throw new Error(`La base de datos nolevantó:\n${up.output}`);
  }

  const name = await dbContainerName();
  if (!name) throw new Error('No se encontró el contenedor de la base de datos');

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await run('podman', [
      'exec',
      name,
      'pg_isready',
      '-U',
      'postgres',
      '-d',
      'objetos_perdidos',
    ]);
    if (ready.code === 0) return name;
    await sleep(500);
  }
  throw new Error('El Postgres no aceptó conexiones a tiempo');
}

/** Aplica las migraciones sobre la base de datos real. */
async function runMigrations() {
  const result = await run(VP, ['exec', 'node', 'api/src/db/migrate.ts'], {
    env: { ...process.env, DATABASE_URL },
  });
  if (result.code !== 0) {
    throw new Error(`Las migraciones fallaron:\n${result.output}`);
  }
  return result.output.trim();
}

/**
 * La base de datos empieza limpia: el volumen sobrevive a las corridas y un
 * recorrido que encuentra los pines de la corrida anterior no prueba nada.
 * El catálogo de zonas se queda: lo siembra el API desde el archivo generado.
 *
 * La misma limpieza sirve para la base de datos ajena (la del servicio de CI):
 * el viaje vacía sus propias tablas y nada más, así que la segunda corrida
 * empieza desde el mismo estado.
 */
async function resetDatabase() {
  try {
    await db().query(
      'truncate reports, claim_requests, report_matches, custody_events, strikes, bans, audit_log, notifications, sessions, magic_links, users restart identity cascade;',
    );
  } catch (error) {
    throw new Error(`No se pudo limpiar la base de datos: ${error.message}`);
  }
}

/**
 * Arranca el API y guarda su salida: el enlace mágico se imprime ahí.
 *
 * `PUBLIC_URL` es el origen de la app web: el enlace llega a la web y la
 * web reenvía la ruta al API, que es quien acuña la cookie de sesión.
 */
function startApi() {
  const log = [];
  const child = spawn(VP, ['exec', 'node', 'api/src/server.ts'], {
    cwd: ROOT,
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: '3001',
      PUBLIC_URL: APP_URL,
      WEB_ORIGIN: APP_URL,
      RELEASE_KEY_PEPPER: 'pepper-de-la-prueba',
      MAIL_TRANSPORT: 'console',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const collect = (chunk) => {
    const text = String(chunk);
    log.push(text);
    if (log.length > 400) log.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const stop = async () => {
    if (child.exitCode !== null) return;
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* el grupo ya no existe */
    }
    await sleep(800);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* ya estaba muerto */
    }
  };

  return { child, log, stop };
}

/** Arranca el servidor de la web con el API configurado. */
function startWeb() {
  const log = [];
  const port = new URL(APP_URL).port || '5173';
  // `--strictPort`: si el puerto está ocupado, el servidor muere en vez de
  // mudarse a otro y dejar la prueba conduciendo la app equivocada.
  const child = spawn(VP, ['dev', '--port', port, '--strictPort'], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, VITE_API_URL: API_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const collect = (chunk) => {
    const text = String(chunk);
    log.push(text);
    if (log.length > 400) log.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const stop = async () => {
    if (child.exitCode !== null) return;
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* el grupo ya no existe */
    }
    await sleep(800);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* ya estaba muerto */
    }
  };

  return { child, log, stop };
}

/* ──────────────────────────── Aserciones ──────────────────────────── */

const results = [];
const consoleErrors = [];
const consoleMessages = [];
// La app pregunta quién es al arrancar: un 401 ahí es la respuesta, no un
// fallo. La prueba los cuenta aparte y verifica que no haya otro 401.
const sessionProbes = [];
const unauthorized = [];

function record(name, pass, expected, observed) {
  results.push({ name, pass: Boolean(pass), expected, observed: String(observed) });
  return Boolean(pass);
}

/** Espera a que un texto aparezca en un elemento. */
async function waitForText(page, selector, needle, timeout = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => '');
    if (text.includes(needle)) return text;
    await sleep(150);
  }
  return null;
}

/** El texto de un elemento, o una cadena vacía. */
async function textOf(page, selector) {
  return page
    .locator(selector)
    .first()
    .innerText()
    .catch(() => '');
}

/** Los pines que hay en el mapa. */
const pinCount = (page) => page.locator('button[aria-label^="Pin "]').count();

/** Los grupos del mapa: un marcador por zona con más de un reporte. */
const clusterCount = (page) => page.locator('button[data-testid^="pin-cluster-marker-"]').count();

/** Los marcadores del mapa: los pines sueltos y los grupos. */
const markerCount = (page) =>
  page.locator('button[aria-label^="Pin "], button[data-testid^="pin-cluster-marker-"]').count();

/** Espera a que el mapa tenga ese número de grupos (un grupo por zona con varios reportes). */
async function waitForClusters(page, expected, timeout = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let seen = 0;
  while (Date.now() < deadline) {
    seen = await clusterCount(page);
    if (seen === expected) return seen;
    await sleep(150);
  }
  return seen;
}

/** Espera a que el mapa tenga ese número de marcadores. */
async function waitForMarkers(page, expected, timeout = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let seen = 0;
  while (Date.now() < deadline) {
    seen = await markerCount(page);
    if (seen === expected) return seen;
    await sleep(150);
  }
  return seen;
}

/** El número del encabezado: los perdidos y los encontrados. */
async function headerCounts(page) {
  const lost = await textOf(page, t('header-lost-count'));
  const found = await textOf(page, t('header-found-count'));
  return { lost: lost.trim(), found: found.trim() };
}

/* ──────────────────────────── La jornada ──────────────────────────── */

/**
 * El enlace mágico que el API imprimió en su consola.
 *
 * El transporte de correo sin dominio dedicado imprime el mensaje: ahí está
 * el token, y el enlace apunta a la app web. La salida del proceso llega con
 * un pelo de retraso, así que la prueba la espera.
 */
async function magicTokenFrom(log, email, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = log.join('');
    const blocks = text.split('[mail] to=');
    for (const block of blocks.reverse()) {
      // El API normaliza el buzón a minúsculas antes de enviarlo.
      if (!block.toLowerCase().startsWith(email.toLowerCase())) continue;
      const match = block.match(/\/auth\/magic-link\/([a-f0-9]{16,})/);
      if (match) return match[1];
    }
    await sleep(200);
  }
  return null;
}

/**
 * Entra con el enlace mágico: lo pide, lo lee del log del API y lo abre en
 * el navegador. La web reenvía la ruta al API, el API acuña la cookie y
 * manda al estudiante de vuelta a la web.
 */
async function signIn(context, apiLog, email, label) {
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on('console', (message) => {
    const entry = `[${label}] [${message.type()}] ${message.text()}`;
    consoleMessages.push(entry);
    if (message.type() !== 'error') return;
    // El 401 de la sonda de sesión es la respuesta del API, no un error.
    if (/status of 401/.test(message.text())) {
      sessionProbes.push(entry);
      return;
    }
    consoleErrors.push(entry);
  });
  page.on('response', (response) => {
    if (response.status() === 401) unauthorized.push(response.url());
  });
  page.on('pageerror', (error) => {
    const entry = `[${label}] [pageerror] ${error.message}`;
    consoleMessages.push(entry);
    consoleErrors.push(entry);
  });

  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.locator(t('login-email')).fill(email);
  await page.locator(t('login-submit')).click();

  const sent = await waitForText(page, t('login-status'), 'Enviamos el enlace');
  record(
    `${label}: el acceso pide el enlace al API`,
    Boolean(sent),
    'el estado dice que el enlace fue enviado',
    sent ?? (await textOf(page, t('login-status'))),
  );

  const token = await magicTokenFrom(apiLog, email);
  record(
    `${label}: el API imprimió el enlace mágico`,
    Boolean(token),
    'un token en el log del API',
    token ?? 'no hay token en el log',
  );
  if (!token) return page;

  // La ruta llega a la web (así la manda el correo) y la web la reenvía al
  // API, que es quien puede escribir la cookie de sesión.
  await page.goto(`${APP_URL}/auth/magic-link/${token}`, { waitUntil: 'load' });

  const opened = await waitForText(page, 'header', 'Mis reportes');
  record(
    `${label}: el enlace mágico abre la sesión`,
    Boolean(opened),
    'la app web entra con la sesión del API',
    opened ? 'el encabezado con la sesión' : await page.url(),
  );

  return page;
}

/** Publica un reporte con el formulario de la app. */
async function publishReport(page, { kind, item, description, blindDetail, zoneId }) {
  await page.locator(t('picker-input')).click();
  await page.locator(t(`picker-option-${zoneId}`)).click();
  await page.locator(t('picker-input')).blur();

  await page
    .getByRole('button', { name: kind === 'lost' ? /Perdí algo aquí/ : /Encontré algo aquí/ })
    .click();

  await page.locator(t('report-item')).fill(item);
  await page.locator(t('report-description')).fill(description);
  if (blindDetail) await page.locator(t('report-blind-detail')).fill(blindDetail);
  await page.locator(t('report-submit')).click();
}

/** Lo que el API tiene en la base de datos, como texto. */
async function query(sql) {
  const result = await db().query(sql);
  return result.rows.map((row) => Object.values(row).join(' | ')).join('\n');
}

/* ───────────────────────────────── Main ───────────────────────────────── */

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });

  // El puerto del API: si ya contesta algo, no es el API de esta prueba y la
  // journey mediría otra cosa.
  if (await isUp(`${API_URL}/health`)) {
    throw new Error(
      `El puerto del API (${API_URL}) ya lo ocupa otro servidor. ` +
        'Corre la prueba con API_URL=http://localhost:3002.',
    );
  }

  console.log('▌ Levantando el stack real: Postgres 16, el API y la web…');
  if (EXTERNAL_DATABASE) {
    // La base de datos es de alguien más (el servicio de CI): se usa tal
    // cual y no se levanta ningún contenedor.
    console.log(`  · Base de datos de fuera (${DATABASE_URL}): sin contenedores`);
    await waitForDatabase();
  } else {
    await ensureImage();
    const container = await startDatabase();
    console.log(`  · Postgres arriba en ${container}`);
  }
  const migrations = await runMigrations();
  console.log(`  · Migraciones: ${migrations}`);
  await resetDatabase();
  console.log('  · Base de datos limpia (el catálogo de zonas se queda)');

  const api = startApi();
  const web = startWeb();
  const screenshots = [];

  try {
    const apiUp = await (async () => {
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isUp(`${API_URL}/health`)) return true;
        await sleep(400);
      }
      return false;
    })();
    record('el API contesta en su puerto', apiUp, `${API_URL}/health responde`, apiUp);

    // El API siembra su catálogo de zonas desde el mismo archivo generado que
    // usa la web (la web nunca lo pide por red): una llamada lo despierta.
    const catalogue = await fetch(`${API_URL}/zones`)
      .then((response) => response.json())
      .catch(() => []);
    record(
      'el API siembra el catálogo de zonas desde el archivo generado',
      Array.isArray(catalogue) && catalogue.length > 50,
      'más de 50 zonas en la tabla',
      `${Array.isArray(catalogue) ? catalogue.length : 0} zonas`,
    );

    const webUp = await (async () => {
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isUp(APP_URL)) return true;
        await sleep(400);
      }
      return false;
    })();
    record('la web contesta con el API configurado', webUp, `${APP_URL} responde`, webUp);

    const ours = await servesOurApp(APP_URL);
    if (!ours) {
      throw new Error(
        `El puerto de ${APP_URL} no lo sirve esta app (puede estarlo otra aplicación): ` +
          'corre la prueba con APP_URL=http://localhost:5199 o con otro puerto libre.',
      );
    }

    const browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox'],
    });

    try {
      const ownerContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'es-MX',
      });
      const finderContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'es-MX',
      });

      record(
        'el único 401 es la sonda de sesión del arranque',
        unauthorized.every((url) => url.endsWith('/auth/me')),
        'sólo GET /auth/me contesta 401',
        unauthorized.length === 0 ? 'ninguno' : unauthorized.join(', '),
      );

      /* ── 1. El dueño entra y publica el objeto perdido ─────────────── */
      const owner = await signIn(ownerContext, api.log, OWNER_EMAIL, 'dueño');
      if (!owner) throw new Error('El dueño no pudo abrir su sesión');
      screenshots.push(join(SHOTS_DIR, 'api-01-owner-session.png'));
      await owner.screenshot({ path: screenshots.at(-1) });

      await publishReport(owner, {
        kind: 'lost',
        item: OWNER_ITEM,
        description: OWNER_DESCRIPTION,
        zoneId: 'bldg-e',
      });

      await owner.locator(t('release-key-dialog')).waitFor({ state: 'visible' });
      const releaseKey = (await textOf(owner, t('release-key-value'))).replace(/\s/g, '');
      record(
        'el reporte perdido devuelve su clave de liberación una sola vez',
        /^\d{6}$/.test(releaseKey),
        'una clave de 6 dígitos',
        releaseKey,
      );
      screenshots.push(join(SHOTS_DIR, 'api-02-release-key.png'));
      await owner.screenshot({ path: screenshots.at(-1) });
      await owner.keyboard.press('Escape');
      await owner.locator(t('release-key-dialog')).waitFor({ state: 'detached' });

      const ownerPins = await pinCount(owner);
      record(
        'el pin del reporte perdido aparece en el mapa',
        ownerPins === 1,
        '1 pin en el mapa del dueño',
        `${ownerPins} pin(es)`,
      );

      /* ── 2. El que lo encontró entra y ve el pin del campus ──────────── */
      const finder = await signIn(finderContext, api.log, FINDER_EMAIL, 'quien encontró');
      if (!finder) throw new Error('El estudiante que encontró el objeto no pudo entrar');
      screenshots.push(join(SHOTS_DIR, 'api-03-finder-session.png'));
      await finder.screenshot({ path: screenshots.at(-1) });

      const finderSees = await pinCount(finder);
      record(
        'el pin del campus llega desde la base de datos',
        finderSees === 1,
        '1 pin en el mapa del que encontró',
        `${finderSees} pin(es)`,
      );

      const finderCounts = await headerCounts(finder);
      record(
        'el encabezado cuenta el pin perdido',
        finderCounts.lost.startsWith('1'),
        '1 perdido en el encabezado',
        finderCounts.lost,
      );

      /* ── 3. El que lo encontró publica su reporte de hallazgo ────────── */
      await publishReport(finder, {
        kind: 'found',
        item: FINDER_ITEM,
        description: FINDER_DESCRIPTION,
        blindDetail: FINDER_BLIND,
        zoneId: 'bldg-e',
      });

      await finder.locator(t('release-key-dialog')).waitFor({ state: 'detached' });
      const finderMarkers = await waitForMarkers(finder, 1);
      const finderClusters = await waitForClusters(finder, 1);
      record(
        'el reporte de hallazgo se publica y se agrupa con el otro de su zona',
        finderMarkers === 1 && finderClusters === 1,
        '1 marcador (un grupo) en el mapa',
        `${finderMarkers} marcador(es), ${finderClusters} grupo(s)`,
      );
      const clusterMarker = finder.locator('button[data-testid^="pin-cluster-marker-"]');
      const clusterName = await clusterMarker.getAttribute('aria-label');
      record(
        'el grupo tiene un nombre accesible que dice cuántos y dónde',
        clusterName === '2 objetos reportados en E · Aulas y Taller de Dibujo',
        '"2 objetos reportados en E · Aulas y Taller de Dibujo"',
        clusterName ?? 'sin nombre accesible',
      );
      const clusterBadge = await finder.locator(t('pin-cluster-count')).innerText();
      record(
        'el grupo lleva la cuenta de sus reportes',
        clusterBadge.trim() === '2',
        'la cuenta "2"',
        clusterBadge.trim(),
      );
      screenshots.push(join(SHOTS_DIR, 'api-04-found-report.png'));
      await finder.screenshot({ path: screenshots.at(-1) });

      /* ── 4. El reclamo: el dato ciego y el enlace con el hallazgo ─────── */
      // Los dos reportes viven en la misma zona, así que el mapa los muestra
      // como un solo marcador con la cuenta: el grupo se abre y cada reporte
      // se alcanza con el ratón.
      await clusterMarker.click();
      await finder.locator(t('pin-cluster-dialog')).waitFor({ state: 'visible' });
      const clusterEntries = finder.locator('[data-testid^="pin-cluster-entry-"]');
      record(
        'el grupo abre la lista de los dos reportes',
        (await clusterEntries.count()) === 2,
        '2 entradas en la lista',
        `${await clusterEntries.count()} entrada(s)`,
      );
      screenshots.push(join(SHOTS_DIR, 'api-04c-cluster-list.png'));
      await finder.screenshot({ path: screenshots.at(-1) });
      await clusterEntries.filter({ hasText: OWNER_ITEM }).click();
      await finder.locator(t('claim-open')).waitFor({ state: 'visible' });
      screenshots.push(join(SHOTS_DIR, 'api-05-claim-open.png'));
      await finder.screenshot({ path: screenshots.at(-1) });

      await finder.locator(t('claim-open')).click();
      await finder.locator(t('claim-modal')).waitFor({ state: 'visible' });
      await finder.locator(t('claim-blind-detail')).fill(FINDER_BLIND);
      await finder
        .locator(t('claim-message'))
        .fill('Lo encontré junto a la ventana del segundo piso.');
      const linkedOption = await finder.locator(t('claim-found-report')).inputValue();
      record(
        'el reclamo ofrece enlazar el reporte de hallazgo',
        Boolean(linkedOption),
        'el reporte de hallazgo queda elegido',
        linkedOption || 'sin opciones',
      );
      screenshots.push(join(SHOTS_DIR, 'api-06-claim-form.png'));
      await finder.screenshot({ path: screenshots.at(-1) });

      await finder.locator(t('claim-submit')).click();
      await finder
        .locator(t('claim-modal'))
        .waitFor({ state: 'detached', timeout: STEP_TIMEOUT_MS });
      const claimError = await textOf(finder, t('claim-error'));
      record(
        'el reclamo se envía al API sin errores',
        claimError.trim() === '',
        'ningún error en el formulario del reclamo',
        claimError.trim() || 'sin errores',
      );

      /* ── 5. El dueño recibe el reclamo y lo aprueba ──────────────────── */
      // La bandeja no hace polling todavía: el dueño recarga y el reclamo
      // que le enviaron aparece con el resto del campus.
      await owner.reload({ waitUntil: 'load' });
      await owner.locator('header').waitFor({ state: 'visible' });
      await owner.getByRole('button', { name: /^Bandeja/ }).click();
      await owner.locator(t('inbox')).waitFor({ state: 'visible' });
      const incoming = await owner.locator('li[data-testid^="claim-"]').count();
      record(
        'el reclamo llega a la bandeja del dueño',
        incoming === 1,
        '1 reclamo recibido',
        `${incoming} reclamo(s)`,
      );
      screenshots.push(join(SHOTS_DIR, 'api-07-inbox.png'));
      await owner.screenshot({ path: screenshots.at(-1) });

      await owner.locator(t('claim-approve')).click();
      await owner.getByRole('button', { name: /Sí, aprobar/ }).click();
      await owner.locator(t('contact-card')).waitFor({ state: 'visible' });
      // La tarjeta se abre al apretarla: antes de eso no dice ni el nombre.
      await owner.locator(t('contact-reveal')).click();
      const card = await textOf(owner, t('contact-card'));
      record(
        'aprobar el reclamo libera la tarjeta de contacto',
        card.toLowerCase().includes(FINDER_EMAIL.toLowerCase()),
        `la tarjeta muestra ${FINDER_EMAIL}`,
        card.replace(/\s+/g, ' ').slice(0, 140),
      );
      screenshots.push(join(SHOTS_DIR, 'api-08-contact-card.png'));
      await owner.screenshot({ path: screenshots.at(-1) });

      /* ── 6. La entrega: la clave que dictó el dueño ──────────────────── */
      await finder.getByRole('button', { name: 'Mapa', exact: true }).click();
      // Los dos reportes viven en la misma zona: el mapa los muestra como un
      // marcador con la cuenta, y el del hallazgo se alcanza con el ratón a
      // través de la lista del grupo.
      await finder.locator('button[data-testid^="pin-cluster-marker-"]').click();
      await finder.locator(t('pin-cluster-dialog')).waitFor({ state: 'visible' });
      await finder.locator('[data-testid^="pin-cluster-entry-"]', { hasText: FINDER_ITEM }).click();
      await finder.locator(t('release-key-input')).waitFor({ state: 'visible' });
      await finder.locator(t('release-key-input')).fill(releaseKey);
      screenshots.push(join(SHOTS_DIR, 'api-09-release-key-input.png'));
      await finder.screenshot({ path: screenshots.at(-1) });
      await finder.locator(t('release-key-submit')).click();

      await owner.waitForTimeout(500);
      await finder.waitForTimeout(500);
      await finder.reload({ waitUntil: 'load' });
      await finder.locator('header').waitFor({ state: 'visible' });
      const afterPins = await pinCount(finder);
      const afterMarkers = await markerCount(finder);
      record(
        'los pines salen del mapa cuando la entrega se confirma',
        afterPins === 0 && afterMarkers === 0,
        '0 pines y 0 grupos en el mapa',
        `${afterPins} pin(es), ${afterMarkers} marcador(es)`,
      );
      screenshots.push(join(SHOTS_DIR, 'api-10-after-delivery.png'));
      await finder.screenshot({ path: screenshots.at(-1) });

      /* ── 7. Lo que quedó en la base de datos ─────────────────────────── */
      const reports = await query(
        'select kind, title, status, zone_id, map_x, map_y, (release_key_hash is not null) as con_clave from reports order by created_at;',
      );
      record(
        'la base de datos tiene los dos reportes resueltos',
        (reports.match(/resolved/g) ?? []).length === 2,
        '2 reportes con estado resolved',
        reports.replace(/\n/g, ' | '),
      );
      console.log(`\n▌ REPORTES EN LA BASE DE DATOS\n${reports}\n`);

      const claims = await query(
        'select status, provided_blind_detail, decided_by is not null as decidido from claim_requests;',
      );
      record(
        'el reclamo quedó aprobado en la base de datos',
        claims.includes('approved'),
        'un reclamo con estado approved',
        claims.replace(/\n/g, ' | '),
      );
      console.log(`▌ RECLAMOS EN LA BASE DE DATOS\n${claims}\n`);

      const matches = await query(
        'select lost_report_id, found_report_id, status from report_matches;',
      );
      record(
        'el enlace entre los dos reportes quedó confirmado',
        matches.includes('confirmed'),
        'un enlace con estado confirmed',
        matches.replace(/\n/g, ' | '),
      );
      console.log(`▌ ENLACES EN LA BASE DE DATOS\n${matches}\n`);

      const audit = await query('select action from audit_log order by created_at;');
      console.log(`▌ AUDITORÍA\n${audit}\n`);

      await ownerContext.close();
      await finderContext.close();
    } finally {
      await browser.close();
    }
  } finally {
    await web.stop();
    await api.stop();
    // El contenedor se detiene; el volumen se queda. La base de datos de
    // fuera se deja como estaba: sólo se vaciaron sus tablas al empezar.
    if (!EXTERNAL_DATABASE) {
      await run('podman', ['compose', 'stop', 'db']);
    }
    await pool?.end();
  }

  printReport();

  console.log('\nCAPTURAS:');
  for (const file of screenshots) console.log(`  ${file}`);

  const failed = results.filter((entry) => !entry.pass);
  if (failed.length > 0 || consoleErrors.length > 0) {
    console.log('\nRESULTADO: FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('\nRESULTADO: PASS');
}

function printReport() {
  const line = '─'.repeat(72);
  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${line}`);
  for (const entry of results) {
    console.log(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.name}`);
    console.log(`         esperado: ${entry.expected}`);
    console.log(`         observado: ${entry.observed}`);
  }
  console.log(`\n${line}`);
  console.log(`RESUMEN: ${results.length - failed.length}/${results.length} aserciones OK`);
  console.log(`ERRORES DE CONSOLA: ${consoleErrors.length}`);
  for (const entry of consoleErrors) console.log(`  ${entry}`);
  console.log(`SONDAS DE SESIÓN (401 esperados): ${sessionProbes.length}`);
  for (const entry of sessionProbes) console.log(`  ${entry}`);
  console.log(line);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch(async (error) => {
    console.error('\nLa prueba falló antes de terminar:');
    console.error(error);
    printReport();
    // La conexión se cierra aquí también: un fallo temprano no debe dejar al
    // proceso esperando a la base de datos.
    await pool?.end();
    process.exitCode = 1;
  });
}
