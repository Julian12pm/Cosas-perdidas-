#!/usr/bin/env node
/**
 * Smoke journey for "Objetos Perdidos ITM" — a real browser, real assertions.
 *
 * The script is deliberately NOT a test runner: it is a plain Node program that
 * walks the whole journey of a student (access → map → report → delivery) in a
 * real Chromium, asserts the invariants that matter, leaves a screenshot per
 * interesting moment for both viewports, and prints a PASS/FAIL report.
 *
 * It never downloads a browser: it drives the system Chromium through
 * playwright-core. It starts the dev server only when nothing answers at
 * APP_URL, and it always stops what it started.
 *
 *   vp exec node scripts/smoke-journey.mjs
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAP_IMAGE, ZONES } from '../src/map/zones.js';

/* ─────────────────────────── Configuración ─────────────────────────── */

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
export const SHOTS_DIR = join(ROOT, '.e2e', 'screenshots');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const SERVER_BOOT_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 15_000;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Los datos de la demo: cuatro pines de arranque (2 perdidos, 2 encontrados). */
const SEED_LOST = 2;
const SEED_FOUND = 2;
const SEED_PINS = 4;

const LOST_ITEM = 'Mochila verde con un sticker de café';
const LOST_DESCRIPTION = 'La dejé en el pasillo del edificio A, junto al banco de la entrada.';
const FOUND_ITEM = 'Botella metálica con grabados';
const FOUND_DESCRIPTION = 'Estaba junto a la fuente del patio central.';
const FOUND_BLIND = 'Verde esmeralda, abolladura en la base, dentro un boleto del cine.';

/** Hallazgos sobre la app que la prueba descubre (no son fallos del recorrido). */
const findings = [];

/* ────────────────────────────── Utilidades ────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ¿Contesta la app en esa URL? */
export async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Devuelve el servidor: el que ya esté corriendo o uno propio.
 * `stop()` sólo mata lo que este proceso arrancó.
 */
export async function ensureServer(url = APP_URL) {
  if (await isUp(url)) {
    return { started: false, stop: async () => {}, log: [] };
  }

  const port = new URL(url).port || '5173';
  const bin = join(ROOT, 'node_modules', '.bin', 'vp');
  const log = [];
  const child = spawn(bin, ['dev', '--port', port], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    log.push(String(chunk));
    if (log.length > 200) log.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const stop = async () => {
    if (child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* el grupo de procesos ya no existe */
    }
    await sleep(1200);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* ya estaba muerto */
    }
  };

  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp(url)) return { started: true, stop, log };
    if (child.exitCode !== null) {
      throw new Error(`El servidor de desarrollo murió:\n${log.join('')}`);
    }
    await sleep(400);
  }

  await stop();
  throw new Error(`El servidor de desarrollo no respondió en ${url}:\n${log.join('')}`);
}

/* ─────────────────────────── Informe de aserciones ─────────────────────────── */

const results = [];
const consoleErrors = [];
const consoleMessages = [];
const findingKeys = new Set();

function record(viewport, name, pass, expected, observed) {
  results.push({ viewport, name, pass: Boolean(pass), expected, observed: String(observed) });
  return Boolean(pass);
}

function finding(where, what) {
  // La clave ignora las medidas: el mismo defecto en dos viewports es un solo hallazgo.
  const key = `${where}|${what.slice(0, 45)}`;
  if (findingKeys.has(key)) return;
  findingKeys.add(key);
  findings.push({ where, what });
}

/* ──────────────────────────── Utilidades de página ──────────────────────────── */

const t = (id) => `[data-testid="${id}"]`;

/** El texto limpio de un elemento (sin espacios dobles). */
async function textOf(page, selector) {
  const raw = await page.locator(selector).first().innerText();
  return raw.replace(/\s+/g, ' ').trim();
}

/** El número de un contador del encabezado ("2 perdidos" → 2). */
async function countOf(page, selector) {
  const raw = await textOf(page, selector);
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

/** El transform del capa del croquis (la que se mueve al hacer zoom o arrastre). */
async function artworkTransform(page) {
  return page.evaluate(() => {
    const listbox = document.querySelector('[data-testid="map"] [role="listbox"]');
    return listbox?.parentElement?.getAttribute('style') ?? null;
  });
}

/** El factor de escala del croquis. */
function scaleOf(transform) {
  const match = transform?.match(/scale\(([\d.]+)\)/);
  return match ? Number(match[1]) : NaN;
}

/** La caja de la capa del artwork (las zonas y los pines): el croquis pintado. */
async function artworkLayerBox(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-testid="map"] [role="listbox"]')?.parentElement;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

/**
 * El raster del croquis: la caja que se ve en la pantalla y el marco de la
 * letterbox sobre su caja de layout (la que el zoom no toca).
 */
async function rasterBox(page) {
  return page.evaluate(() => {
    const img = document.querySelector('[data-testid="map-raster"]');
    if (!img || !img.naturalWidth) return null;
    const style = getComputedStyle(img);
    const local = { width: parseFloat(style.width), height: parseFloat(style.height) };
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    const rect = img.getBoundingClientRect();
    const scale = Math.min(local.width / natural.width, local.height / natural.height);
    const painted = {
      x: (local.width - natural.width * scale) / 2,
      y: (local.height - natural.height * scale) / 2,
      width: natural.width * scale,
      height: natural.height * scale,
    };
    return {
      box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      local,
      painted,
    };
  });
}

/** La caja del artwork tal como la pinta el raster, en la pantalla. */
function paintedArtworkBox(raster) {
  return {
    left: raster.box.left + (raster.painted.x / raster.local.width) * raster.box.width,
    top: raster.box.top + (raster.painted.y / raster.local.height) * raster.box.height,
    width: (raster.painted.width / raster.local.width) * raster.box.width,
    height: (raster.painted.height / raster.local.height) * raster.box.height,
  };
}

/** El punto del artwork (0..1) que el raster pinta bajo un punto de la pantalla. */
function artworkUnder(raster, client) {
  const localX = ((client.x - raster.box.left) / raster.box.width) * raster.local.width;
  const localY = ((client.y - raster.box.top) / raster.box.height) * raster.local.height;
  return {
    x: (localX - raster.painted.x) / raster.painted.width,
    y: (localY - raster.painted.y) / raster.painted.height,
  };
}

/** El punto de la pantalla donde el raster pinta un punto del artwork. */
function screenOfArtwork(raster, artwork) {
  const localX = raster.painted.x + artwork.x * raster.painted.width;
  const localY = raster.painted.y + artwork.y * raster.painted.height;
  return {
    x: raster.box.left + (localX / raster.local.width) * raster.box.width,
    y: raster.box.top + (localY / raster.local.height) * raster.box.height,
  };
}

/** El punto de la pantalla donde la capa de zonas pinta un punto del artwork. */
function screenOfArtworkLayer(layer, artwork) {
  return {
    x: layer.left + artwork.x * layer.width,
    y: layer.top + artwork.y * layer.height,
  };
}

/** El tamaño en pantalla del primer pin del mapa. */
async function pinSize(page) {
  return page.evaluate(() => {
    const pin = document.querySelector('button[aria-label^="Pin "]');
    if (!pin) return null;
    const rect = pin.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

/** Los pines del mapa (los botones con nombre accesible "Pin perdido/encontrado"). */
const pinCount = (page) => page.locator('button[aria-label^="Pin "]').count();

/**
 * Comprueba que la acción principal de un diálogo es alcanzable: visible, dentro
 * del viewport y con un objetivo táctil de 44px de alto.
 */
async function checkPrimaryAction(page, viewport, step, locator, label) {
  const element = locator.first();
  const visible = await element.isVisible();
  await element.scrollIntoViewIfNeeded().catch(() => {});
  // El diálogo se abre con una animación de escala: se mide cuando ya terminó,
  // si no la caja sale más pequeña de lo que es.
  await element
    .evaluate((node) => {
      const scope = node.closest('[role="dialog"]') ?? node;
      const animations = scope.getAnimations({ subtree: true });
      return Promise.race([
        Promise.all(animations.map((animation) => animation.finished.catch(() => {}))),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    })
    .catch(() => {});
  const box = await element.boundingBox();
  const size = page.viewportSize();
  const inside =
    Boolean(box) &&
    box.x >= -1 &&
    box.y >= -1 &&
    box.x + box.width <= size.width + 1 &&
    box.y + box.height <= size.height + 1;
  record(
    viewport,
    `${step}: la acción principal de "${label}" es alcanzable`,
    visible && inside,
    'visible y dentro del viewport',
    `visible=${visible} box=${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'null'} viewport=${size.width}x${size.height}`,
  );
  const height = box?.height ?? 0;
  record(
    viewport,
    `${step}: la acción principal de "${label}" tiene 44px de alto`,
    height >= 44,
    '>= 44px',
    `${Math.round(height)}px`,
  );
}

/** Sin desbordamiento horizontal en la pantalla actual. */
async function checkOverflow(page, viewport, step) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  record(
    viewport,
    `${step}: sin desbordamiento horizontal`,
    scrollWidth <= innerWidth + 1,
    `scrollWidth <= innerWidth + 1 (${innerWidth})`,
    `scrollWidth=${scrollWidth} innerWidth=${innerWidth}`,
  );
}

/** Los estados que la pantalla puede estar pintando, contados por gancho. */
async function stateHooks(page) {
  return page.evaluate(() => ({
    loading: document.querySelectorAll('[data-testid="state-loading"]').length,
    empty: document.querySelectorAll('[data-testid="state-empty"]').length,
    error: document.querySelectorAll('[data-testid="state-error"]').length,
    offline: document.querySelectorAll('[data-testid="state-offline"]').length,
  }));
}

/**
 * Una pantalla no puede estar en dos estados a la vez: el que se pide y el
 * que se avisa. El aviso sin conexión es global (vive en el encabezado) y no
 * cuenta como estado de la pantalla.
 */
async function checkSingleState(page, viewport, step) {
  const hooks = await stateHooks(page);
  const screens = hooks.loading + hooks.empty + hooks.error;
  record(
    viewport,
    `${step}: la pantalla muestra un solo estado`,
    screens <= 1,
    'a lo sumo un estado de pantalla (cargando, vacío o error)',
    JSON.stringify(hooks),
  );
  return hooks;
}

/* ─────────────────────────────── Recorrido ─────────────────────────────── */

async function runJourney(browser, viewport) {
  const { name: vp, width, height } = viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'es-MX',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);

  page.on('console', (message) => {
    const entry = `[${vp}] [${message.type()}] ${message.text()}`;
    consoleMessages.push(entry);
    if (message.type() === 'error') consoleErrors.push(entry);
  });
  page.on('pageerror', (error) => {
    const entry = `[${vp}] [pageerror] ${error.message}`;
    consoleMessages.push(entry);
    consoleErrors.push(entry);
  });

  const screenshots = [];
  const take = async (step, index) => {
    const file = join(SHOTS_DIR, `${String(index).padStart(2, '0')}-${step}-${vp}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
    return file;
  };

  try {
    /* ── 1. La puerta de acceso bloquea la app ───────────────────────── */
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.locator(t('login-email')).waitFor({ state: 'visible' });

    record(
      vp,
      'la puerta de acceso bloquea la app antes de iniciar sesión',
      (await page.locator(t('map')).count()) === 0,
      '0 elementos con data-testid="map"',
      `${await page.locator(t('map')).count()} elementos "map"`,
    );
    record(
      vp,
      'el formulario de acceso pide el correo institucional',
      (await page.locator(t('login-email')).count()) === 1,
      '1 campo login-email',
      `${await page.locator(t('login-email')).count()} campo(s)`,
    );
    await checkOverflow(page, vp, 'login');

    // Un correo que no es del instituto no pasa.
    await page.fill(t('login-email'), 'estudiante@gmail.com');
    await page.click(t('login-submit'));
    await page.locator(`${t('login-status')}[role="alert"]`).waitFor({ state: 'visible' });
    record(
      vp,
      'el acceso rechaza un correo no institucional',
      (await textOf(page, t('login-status'))).includes('morelia.tecnm.mx'),
      'el aviso menciona los dominios institucionales',
      await textOf(page, t('login-status')),
    );
    record(
      vp,
      'un correo no institucional no abre la sesión de demostración',
      (await page.locator(t('login-demo')).count()) === 0,
      '0 botón login-demo',
      `${await page.locator(t('login-demo')).count()} botón(es)`,
    );

    // El correo institucional, en modo demostración.
    await page.fill(t('login-email'), 'L2030451@morelia.tecnm.mx');
    await page.click(t('login-submit'));
    await page.locator(t('login-demo')).waitFor({ state: 'visible' });
    record(
      vp,
      'el modo demostración se anuncia en login-status',
      (await textOf(page, t('login-status'))).includes('Modo demostración'),
      'el aviso dice "Modo demostración"',
      await textOf(page, t('login-status')),
    );
    await take('login', 1);

    await page.click(t('login-demo'));
    await page.locator(t('map')).waitFor({ state: 'visible' });
    record(
      vp,
      'la sesión de demostración deja entrar a la app',
      (await page.locator(t('login-email')).count()) === 0,
      '0 campo login-email (la pantalla de acceso desapareció)',
      `${await page.locator(t('login-email')).count()} campo(s)`,
    );
    record(
      vp,
      'el encabezado ofrece la salida de la sesión',
      (await textOf(page, 'header')).includes('Salir'),
      'el encabezado tiene el botón "Salir"',
      (await textOf(page, 'header')).slice(0, 140),
    );

    // El botón de la bandeja es un inline-flex: cada trozo de texto suelto se
    // vuelve un elemento flexible y su espacio inicial se recorta al pintarse.
    const navGaps = await page.evaluate(() => {
      const button = [...document.querySelectorAll('nav button')].find((node) =>
        node.textContent.includes('Bandeja'),
      );
      if (!button) return null;
      const runs = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const raw = node.nodeValue;
        // El espacio inicial de un trozo puede borrarse al pintarse (un
        // elemento flexible lo recorta), así que el hueco se mide desde el
        // primer carácter visible.
        const visible = raw.replace(/^\s+/, '');
        if (visible.length > 0) {
          const range = document.createRange();
          range.setStart(node, raw.length - visible.length);
          range.setEnd(node, raw.length);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0) {
            runs.push({ raw, visible, left: rect.left, right: rect.right });
          }
        }
        node = walker.nextNode();
      }
      const gaps = [];
      for (let index = 1; index < runs.length; index += 1) {
        const previous = runs[index - 1];
        const current = runs[index];
        gaps.push({
          between: `${JSON.stringify(previous.visible)} y ${JSON.stringify(current.visible)}`,
          gap: Math.round((current.left - previous.right) * 10) / 10,
          // ¿El texto pide un espacio entre estos dos trozos?
          expectsSpace: /\s$/.test(previous.raw) || /^\s/.test(current.raw),
        });
      }
      return { innerText: button.innerText, gaps };
    });
    const glued = navGaps?.gaps.filter((entry) => entry.expectsSpace && entry.gap <= 0) ?? [];
    record(
      vp,
      'los trozos del botón de la bandeja no se pegan entre sí',
      glued.length === 0,
      'ningún espacio del texto se pinta pegado al trozo anterior',
      glued.length === 0 ? JSON.stringify(navGaps?.gaps ?? []) : JSON.stringify(glued),
    );

    const navLabel = navGaps?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    const expectedNav = width < 640 ? 'Bandeja (1)' : 'Bandeja de reclamos (1)';
    record(
      vp,
      'el botón de la bandeja muestra la etiqueta completa con sus espacios',
      navLabel === expectedNav,
      expectedNav,
      navLabel ?? 'no se encontró el botón',
    );

    const navLayout = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const chips = document.querySelector('[data-testid="header-lost-count"]')?.parentElement;
      return {
        nav: nav ? getComputedStyle(nav).flexWrap : null,
        chips: chips ? getComputedStyle(chips).flexWrap : null,
      };
    });
    record(
      vp,
      'la barra de navegación y los contadores se pueden partir en varias líneas',
      navLayout.nav === 'wrap' && navLayout.chips === 'wrap',
      'flex-wrap: wrap en la barra y en los contadores',
      JSON.stringify(navLayout),
    );

    /* ── 2. El mapa: croquis, zonas y los cuatro pines de arranque ───── */
    await page.locator(t('map-raster')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    const naturalWidth = await page.evaluate(
      () => document.querySelector('[data-testid="map-raster"]')?.naturalWidth ?? 0,
    );
    const naturalHeight = await page.evaluate(
      () => document.querySelector('[data-testid="map-raster"]')?.naturalHeight ?? 0,
    );
    record(
      vp,
      'el croquis se descarga y se dibuja',
      naturalWidth === 700 && naturalHeight === 647,
      'naturalWidth=700 y naturalHeight=647',
      `naturalWidth=${naturalWidth}, naturalHeight=${naturalHeight}`,
    );
    const zones = await page.locator('[data-zone-id]').count();
    record(
      vp,
      'el croquis publica sus zonas como opciones',
      zones > 0,
      '> 0 zonas con data-zone-id',
      `${zones} zonas`,
    );
    const seedPins = await pinCount(page);
    record(
      vp,
      'el mapa muestra los cuatro pines de arranque',
      seedPins === SEED_PINS,
      `${SEED_PINS} pines`,
      `${seedPins} pines`,
    );
    const seedLost = await countOf(page, t('header-lost-count'));
    const seedFound = await countOf(page, t('header-found-count'));
    record(
      vp,
      'el encabezado cuenta los pines de arranque',
      seedLost === SEED_LOST && seedFound === SEED_FOUND,
      `${SEED_LOST} perdidos y ${SEED_FOUND} encontrados`,
      `${seedLost} perdidos y ${seedFound} encontrados`,
    );
    record(
      vp,
      'la pantalla nunca cae en un estado de error',
      (await page.locator(t('state-error')).count()) === 0,
      '0 paneles state-error',
      `${await page.locator(t('state-error')).count()} panel(es)`,
    );
    await checkSingleState(page, vp, 'map');
    await checkOverflow(page, vp, 'map');
    await take('map', 2);

    /* ── 2b. El pin se mide contra el croquis que lo sostiene ───────── */
    // La animación de caída dura medio segundo: se mide cuando ya terminó.
    await sleep(800);
    const pinBox = await page.evaluate(() => {
      const pin = document.querySelector('button[aria-label^="Pin "]');
      const map = document.querySelector('[data-testid="map"]');
      if (!pin || !map) return null;
      const pinRect = pin.getBoundingClientRect();
      const mapRect = map.getBoundingClientRect();
      return {
        pinWidth: pinRect.width,
        pinHeight: pinRect.height,
        mapWidth: mapRect.width,
        mapHeight: mapRect.height,
      };
    });
    const maxPinWidth = width < 640 ? 26 : 36;
    record(
      vp,
      'el pin no se traga el edificio que señala',
      pinBox !== null && pinBox.pinWidth <= maxPinWidth,
      `ancho del pin <= ${maxPinWidth}px`,
      pinBox
        ? `${Math.round(pinBox.pinWidth)}x${Math.round(pinBox.pinHeight)}px`
        : 'no se encontró',
    );
    record(
      vp,
      'el pin es una fracción del croquis',
      pinBox !== null && pinBox.pinHeight <= pinBox.mapHeight * 0.12,
      'el alto del pin <= 12% del alto del croquis',
      pinBox
        ? `${Math.round(pinBox.pinHeight)}px de pin sobre ${Math.round(pinBox.mapHeight)}px de croquis (${Math.round((pinBox.pinHeight / pinBox.mapHeight) * 100)}%)`
        : 'no se encontró',
    );

    const touchAction = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="map"]');
      const layer = map?.querySelector('div[style*="scale("]');
      return {
        map: map ? getComputedStyle(map).touchAction : null,
        artwork: layer ? getComputedStyle(layer).touchAction : null,
      };
    });
    record(
      vp,
      'el croquis deja desplazar la página con el dedo',
      touchAction.map === 'pan-y',
      'touch-action: pan-y en el croquis',
      JSON.stringify(touchAction),
    );
    record(
      vp,
      'la capa del artwork sigue guardando el gesto para el croquis',
      touchAction.artwork === 'none',
      'touch-action: none en la capa del artwork',
      JSON.stringify(touchAction),
    );
    const zoneTouch = await page.evaluate(() => {
      const zone = document.querySelector('[data-zone-id]');
      if (!zone) return null;
      // El touch-action no se hereda: el gesto se decide por la intersección
      // del elemento con sus antepasados hasta el que desplaza la página.
      const chain = [];
      for (let node = zone; node && node !== document.body; node = node.parentElement) {
        chain.push(getComputedStyle(node).touchAction);
      }
      return chain;
    });
    if (zoneTouch?.includes('none')) {
      finding(
        'src/components/CampusMap.jsx (capas de zonas y pines)',
        `las zonas y los pines quedan bajo touch-action: none (cadena: ${JSON.stringify(zoneTouch)}): un deslizamiento vertical que empieza sobre una zona mueve el croquis en vez de desplazar la página. Fuera de las zonas el croquis sí deja desplazar`,
      );
    }

    /* ── 3. El croquis se puede acercar con la rueda ──────────────────── */
    // El acercamiento va primero: con el croquis entero dentro de la ventana
    // no hay por dónde arrastrarlo (el transform se queda dentro de los
    // límites), así que el gesto de arrastre sólo existe una vez ampliado.
    const zoomBefore = await artworkTransform(page);
    const mapBox = await page.locator(t('map')).boundingBox();
    const cursor = {
      x: mapBox.x + mapBox.width / 2,
      y: mapBox.y + Math.min(120, mapBox.height / 2),
    };
    await page.mouse.move(cursor.x, cursor.y);
    const rasterBefore = await rasterBox(page);
    const layerBefore = await artworkLayerBox(page);
    const pinBefore = await pinSize(page);
    await page.mouse.wheel(0, -400);
    await sleep(300);
    const zoomAfter = await artworkTransform(page);
    record(
      vp,
      'la rueda del ratón acerca el croquis',
      scaleOf(zoomAfter) > scaleOf(zoomBefore),
      'escala mayor que antes',
      `escala ${scaleOf(zoomBefore)} → ${scaleOf(zoomAfter)}`,
    );

    /* ── 3b. El croquis crece con el zoom, como las zonas y los pines ── */
    const zoomScale = scaleOf(zoomAfter) / scaleOf(zoomBefore);
    const rasterAfter = await rasterBox(page);
    const layerAfter = await artworkLayerBox(page);
    const pinAfter = await pinSize(page);
    const rasterRatio = rasterAfter.box.width / rasterBefore.box.width;
    const layerRatio = layerAfter.width / layerBefore.width;
    const pinRatio = pinAfter.width / pinBefore.width;
    record(
      vp,
      'el croquis crece con el zoom',
      Math.abs(rasterRatio - zoomScale) <= 0.02 * zoomScale,
      `la caja del croquis crece ${zoomScale.toFixed(3)}x`,
      `crece ${rasterRatio.toFixed(3)}x`,
    );
    record(
      vp,
      'las zonas del croquis crecen con el zoom',
      Math.abs(layerRatio - zoomScale) <= 0.02 * zoomScale,
      `la capa de zonas crece ${zoomScale.toFixed(3)}x`,
      `crece ${layerRatio.toFixed(3)}x`,
    );
    record(
      vp,
      'los pines y el croquis crecen juntos',
      Math.abs(pinRatio - rasterRatio) <= 0.03 * zoomScale,
      `el pin y el croquis crecen lo mismo (${zoomScale.toFixed(3)}x)`,
      `pin ${pinRatio.toFixed(3)}x, croquis ${rasterRatio.toFixed(3)}x`,
    );

    // El croquis y las zonas tienen que dibujar el mismo artwork.
    const painted = paintedArtworkBox(rasterAfter);
    const drift = Math.max(
      Math.abs(painted.left - layerAfter.left),
      Math.abs(painted.top - layerAfter.top),
      Math.abs(painted.width - layerAfter.width),
      Math.abs(painted.height - layerAfter.height),
    );
    record(
      vp,
      'el croquis y las zonas dibujan el mismo artwork',
      drift <= 2,
      'las dos cajas del artwork coinciden (2px)',
      `desfase ${drift.toFixed(2)}px`,
    );

    // El artwork bajo el cursor no se mueve: el zoom se ancla en él.
    const anchorBefore = artworkUnder(rasterBefore, cursor);
    const anchorAfter = artworkUnder(rasterAfter, cursor);
    const anchorLayer = {
      x: (cursor.x - layerAfter.left) / layerAfter.width,
      y: (cursor.y - layerAfter.top) / layerAfter.height,
    };
    record(
      vp,
      'el punto del artwork bajo el cursor no se mueve con el zoom',
      Math.abs(anchorAfter.x - anchorBefore.x) <= 0.004 &&
        Math.abs(anchorAfter.y - anchorBefore.y) <= 0.004 &&
        Math.abs(anchorAfter.x - anchorLayer.x) <= 0.004 &&
        Math.abs(anchorAfter.y - anchorLayer.y) <= 0.004,
      'el mismo punto del artwork en el croquis y en las zonas (0.4%)',
      `antes (${anchorBefore.x.toFixed(4)}, ${anchorBefore.y.toFixed(4)}) → croquis (${anchorAfter.x.toFixed(4)}, ${anchorAfter.y.toFixed(4)}) zonas (${anchorLayer.x.toFixed(4)}, ${anchorLayer.y.toFixed(4)})`,
    );

    // Un punto fijo del artwork: el croquis y las zonas lo pintan en el
    // mismo lugar de la pantalla.
    const fixed = { x: 0.5, y: 0.5 };
    const fixedRaster = screenOfArtwork(rasterAfter, fixed);
    const fixedLayer = screenOfArtworkLayer(layerAfter, fixed);
    const fixedGap = Math.hypot(fixedRaster.x - fixedLayer.x, fixedRaster.y - fixedLayer.y);
    record(
      vp,
      'un punto fijo del artwork se dibuja en el mismo lugar en el croquis y en las zonas',
      fixedGap <= 2,
      'el centro del croquis coincide en las dos capas (2px)',
      `croquis (${fixedRaster.x.toFixed(1)}, ${fixedRaster.y.toFixed(1)}) zonas (${fixedLayer.x.toFixed(1)}, ${fixedLayer.y.toFixed(1)})`,
    );
    await checkOverflow(page, vp, 'map-zoom');

    /* ── 3c. Un toque después del zoom cae en la zona que señala ─────── */
    // El catálogo manda: el centro de una zona en píxeles del artwork. El
    // punto de la pantalla lo dice el croquis, así que un toque convierte el
    // zoom en la zona que el dedo señaló.
    //
    // La zona se busca lejos del cursor: junto al ancla del zoom casi no se
    // mueve, y un toque ahí no probaría nada.
    const inside = (point) =>
      point.x > mapBox.x + 4 &&
      point.x < mapBox.x + mapBox.width - 4 &&
      point.y > mapBox.y + 4 &&
      point.y < mapBox.y + mapBox.height - 4;

    const candidates = ZONES.map((zone) => ({
      id: zone.id,
      label: zone.label,
      artwork: {
        x: (zone.box.x + zone.box.width / 2) / MAP_IMAGE.width,
        y: (zone.box.y + zone.box.height / 2) / MAP_IMAGE.height,
      },
    }))
      // Dónde queda la zona con el zoom (lo dice la capa de zonas) y dónde
      // quedaba antes de acercar.
      .map((candidate) => ({
        ...candidate,
        zoomed: screenOfArtworkLayer(layerAfter, candidate.artwork),
        plain: screenOfArtworkLayer(layerBefore, candidate.artwork),
      }))
      .filter((candidate) => inside(candidate.zoomed) && inside(candidate.plain))
      .sort(
        (left, right) =>
          Math.hypot(right.zoomed.x - cursor.x, right.zoomed.y - cursor.y) -
          Math.hypot(left.zoomed.x - cursor.x, left.zoomed.y - cursor.y),
      );

    let target = null;
    for (const candidate of candidates) {
      const hit = await page.evaluate((point) => {
        const element = document.elementFromPoint(point.x, point.y);
        return {
          zoneId: element?.closest('[data-zone-id]')?.getAttribute('data-zone-id') ?? null,
          pin: Boolean(element?.closest('button[aria-label^="Pin "]')),
        };
      }, candidate.zoomed);
      if (hit.zoneId === candidate.id && !hit.pin) {
        target = candidate;
        break;
      }
    }

    record(
      vp,
      'hay una zona del catálogo a la que se puede tocar después del zoom',
      Boolean(target),
      'una zona visible lejos del ancla del zoom',
      target
        ? `${target.id} en (${target.zoomed.x.toFixed(0)}, ${target.zoomed.y.toFixed(0)})`
        : 'ninguna',
    );

    if (target) {
      // El punto de la pantalla lo dice el croquis: si el croquis y las zonas
      // no coinciden, el toque cae en otro edificio.
      const tapPoint = screenOfArtwork(rasterAfter, target.artwork);
      await page.mouse.click(tapPoint.x, tapPoint.y);
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
      const dialogText =
        (await page.locator('[role="dialog"]').count()) > 0
          ? await textOf(page, '[role="dialog"]')
          : '';
      record(
        vp,
        'un toque después del zoom cae en la zona que señala el catálogo',
        dialogText.includes(target.label),
        `el diálogo dice "${target.label}"`,
        dialogText.slice(0, 140) ||
          `no se abrió ningún diálogo (toque en ${tapPoint.x.toFixed(0)}, ${tapPoint.y.toFixed(0)})`,
      );
      await page.keyboard.press('Escape');
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'detached' })
        .catch(() => {});
    }

    /* ── 4. Un arrastre en el croquis NO crea un pin ─────────────────── */
    const freePoint = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="map"]');
      if (!map) return null;
      const rect = map.getBoundingClientRect();
      const top = Math.max(rect.top, 0) + 8;
      const bottom = Math.min(rect.bottom, window.innerHeight) - 8;
      const left = Math.max(rect.left, 0) + 8;
      const right = Math.min(rect.right, window.innerWidth) - 8;
      for (let y = top; y < bottom; y += 9) {
        for (let x = left; x < right; x += 9) {
          const element = document.elementFromPoint(x, y);
          if (!element) continue;
          if (element.closest('[data-zone-id]')) continue;
          if (element.closest('button[aria-label^="Pin "]')) continue;
          if (element.closest('[data-testid="map-raster"]')) return { x, y };
        }
      }
      return null;
    });
    record(
      vp,
      'hay terreno libre en el croquis para arrastrar',
      Boolean(freePoint),
      'un punto sin zona ni pin encima',
      freePoint ? `(${Math.round(freePoint.x)}, ${Math.round(freePoint.y)})` : 'ninguno',
    );

    if (freePoint) {
      const before = await artworkTransform(page);
      const rasterPre = await rasterBox(page);
      const layerPre = await artworkLayerBox(page);
      const pinsBefore = await pinCount(page);
      const lostBefore = await countOf(page, t('header-lost-count'));
      await page.mouse.move(freePoint.x, freePoint.y);
      await page.mouse.down();
      await page.mouse.move(freePoint.x + 70, freePoint.y + 40, { steps: 12 });
      await page.mouse.up();
      await sleep(250);
      const after = await artworkTransform(page);
      const rasterPost = await rasterBox(page);
      const layerPost = await artworkLayerBox(page);
      const pinsAfter = await pinCount(page);
      const lostAfter = await countOf(page, t('header-lost-count'));
      record(
        vp,
        'el arrastre mueve el croquis',
        before !== after,
        'el transform de la capa cambia',
        `antes=${before?.match(/transform: [^;]+/)?.[0] ?? 'null'} después=${after?.match(/transform: [^;]+/)?.[0] ?? 'null'}`,
      );
      const rasterDelta = {
        x: rasterPost.box.left - rasterPre.box.left,
        y: rasterPost.box.top - rasterPre.box.top,
      };
      const layerDelta = {
        x: layerPost.left - layerPre.left,
        y: layerPost.top - layerPre.top,
      };
      record(
        vp,
        'el arrastre mueve el croquis y las zonas juntas',
        Math.abs(rasterDelta.x - layerDelta.x) <= 2 &&
          Math.abs(rasterDelta.y - layerDelta.y) <= 2 &&
          Math.abs(layerDelta.x) + Math.abs(layerDelta.y) > 1,
        'el croquis y la capa se mueven lo mismo (2px)',
        `croquis (${rasterDelta.x.toFixed(1)}, ${rasterDelta.y.toFixed(1)}) zonas (${layerDelta.x.toFixed(1)}, ${layerDelta.y.toFixed(1)})`,
      );
      record(
        vp,
        'el arrastre NO crea un pin',
        pinsAfter === pinsBefore && lostAfter === lostBefore,
        `${pinsBefore} pines y ${lostBefore} perdidos, sin cambios`,
        `${pinsAfter} pines y ${lostAfter} perdidos`,
      );
      record(
        vp,
        'el arrastre NO abre el formulario de reporte',
        (await page.locator('[role="dialog"]').count()) === 0,
        '0 diálogos',
        `${await page.locator('[role="dialog"]').count()} diálogo(s)`,
      );
      await checkOverflow(page, vp, 'map-pan');
    }

    /* ── 5. Recarga: el croquis vuelve a su estado inicial ───────────── */
    await page.reload({ waitUntil: 'commit' });
    await page.locator(t('picker-input')).waitFor({ state: 'attached' });
    const pickerWhileLoading = await page.evaluate(() => ({
      input: Boolean(document.querySelector('[data-testid="picker-input"]')),
      loading: Boolean(document.querySelector('[data-testid="state-loading"]')),
    }));
    record(
      vp,
      'el buscador conserva su campo mientras carga el campus',
      pickerWhileLoading.input && pickerWhileLoading.loading,
      'el campo y el aviso de carga conviven',
      JSON.stringify(pickerWhileLoading),
    );
    await page.locator(t('map')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    record(
      vp,
      'la sesión sobrevive a la recarga (queda dentro de la app)',
      (await page.locator(t('login-email')).count()) === 0,
      '0 campo login-email tras recargar',
      `${await page.locator(t('login-email')).count()} campo(s)`,
    );
    record(
      vp,
      'la recarga devuelve el croquis a los cuatro pines de arranque',
      (await pinCount(page)) === SEED_PINS,
      `${SEED_PINS} pines`,
      `${await pinCount(page)} pines`,
    );

    /* ── 6. Tocar una zona abre el flujo del reporte ─────────────────── */
    const zoneId = 'parking-4';
    await page.locator(t(`zone-${zoneId}`)).click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    record(
      vp,
      'tocar una zona del croquis abre el diálogo del tipo de pin',
      (await page.locator('[role="dialog"]').count()) === 1,
      '1 diálogo abierto',
      `${await page.locator('[role="dialog"]').count()} diálogo(s)`,
    );
    const typeLost = page.getByRole('button', { name: /Perdí algo aquí/ });
    const typeFound = page.getByRole('button', { name: /Encontré algo aquí/ });
    record(
      vp,
      'el diálogo ofrece el pin rojo y el pin verde',
      (await typeLost.count()) === 1 && (await typeFound.count()) === 1,
      '1 botón de pin perdido y 1 de pin encontrado',
      `${await typeLost.count()} rojo(s) y ${await typeFound.count()} verde(s)`,
    );
    record(
      vp,
      'los dos botones del tipo de pin tienen su propio gancho',
      (await page.locator(t('report-type-lost')).count()) === 1 &&
        (await page.locator(t('report-type-found')).count()) === 1,
      '1 botón report-type-lost y 1 botón report-type-found',
      `${await page.locator(t('report-type-lost')).count()} perdido(s) y ${await page.locator(t('report-type-found')).count()} encontrado(s)`,
    );
    await checkPrimaryAction(page, vp, 'choose', typeLost, 'Perdí algo aquí');
    await checkOverflow(page, vp, 'choose');
    await take('choose-type', 3);
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });

    /* ── 7. El buscador de zonas abre el mismo flujo ─────────────────── */
    await page.locator(t('picker-input')).click();
    await page.locator('#zone-picker-listbox').waitFor({ state: 'visible' });

    // La lista de zonas se mide contra la ventana: en una pantalla corta no
    // puede bajar más allá del borde ni esconderse detrás del navegador.
    await page.setViewportSize({ width, height: 400 });
    const shortList = await page.evaluate(() => {
      const list = document.querySelector('#zone-picker-listbox');
      return list ? getComputedStyle(list).maxHeight : null;
    });
    record(
      vp,
      'en una pantalla corta la lista de zonas se acorta',
      shortList !== null && parseFloat(shortList) <= 0.6 * 400 + 1,
      'max-height <= 240px (60dvh de 400px)',
      shortList ?? 'no se encontró la lista',
    );
    await page.setViewportSize({ width, height });
    const listMaxHeight = await page.evaluate(() => {
      const list = document.querySelector('#zone-picker-listbox');
      return list ? getComputedStyle(list).maxHeight : null;
    });
    record(
      vp,
      'la lista de zonas se mide contra la ventana (no con un alto fijo)',
      listMaxHeight !== null && parseFloat(listMaxHeight) <= Math.min(288, 0.6 * height) + 1,
      `max-height <= ${Math.min(288, Math.round(0.6 * height))}px`,
      listMaxHeight ?? 'no se encontró la lista',
    );

    await page.locator(t('picker-option-bldg-a')).click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    record(
      vp,
      'elegir una zona en el buscador abre el flujo del reporte',
      (await page.locator('[role="dialog"]').count()) === 1,
      '1 diálogo abierto',
      `${await page.locator('[role="dialog"]').count()} diálogo(s)`,
    );
    const zoneHint = await textOf(page, '[role="dialog"]');
    record(
      vp,
      'el diálogo dice en qué zona se marcará el pin',
      zoneHint.includes('A · Edificio Administrativo'),
      'menciona "A · Edificio Administrativo"',
      zoneHint.slice(0, 140),
    );

    /* ── 8. El reporte de objeto perdido ─────────────────────────────── */
    await typeLost.click();
    await page.locator(t('report-item')).waitFor({ state: 'visible' });
    record(
      vp,
      'el formulario de reporte pide el objeto',
      (await page.locator(t('report-item')).count()) === 1,
      '1 campo report-item',
      `${await page.locator(t('report-item')).count()} campo(s)`,
    );
    record(
      vp,
      'el pin rojo no pide el dato ciego',
      (await page.locator(t('report-blind-detail')).count()) === 0,
      '0 campo report-blind-detail en el pin rojo',
      `${await page.locator(t('report-blind-detail')).count()} campo(s)`,
    );
    const formText = await textOf(page, '[role="dialog"]');
    record(
      vp,
      'el formulario publica con la identidad institucional de la sesión',
      formText.includes('María Fernanda Ruiz') && formText.includes('L2030451@morelia.tecnm.mx'),
      'el nombre y el correo de la sesión que entró',
      formText.slice(0, 200),
    );
    record(
      vp,
      'el botón de publicar arranca deshabilitado',
      await page.locator(t('report-submit')).isDisabled(),
      'deshabilitado mientras falten datos',
      `disabled=${await page.locator(t('report-submit')).isDisabled()}`,
    );
    await checkOverflow(page, vp, 'report-lost');
    await page.fill(t('report-item'), LOST_ITEM);
    await page.fill(t('report-description'), LOST_DESCRIPTION);
    const submitDisabled = await page.locator(t('report-submit')).isDisabled();
    record(
      vp,
      'el botón de publicar se habilita con objeto y descripción',
      submitDisabled === false,
      'el botón está habilitado',
      `disabled=${submitDisabled}`,
    );
    await checkPrimaryAction(
      page,
      vp,
      'report-lost',
      page.locator(t('report-submit')),
      'Clavar pin rojo',
    );
    await take('report-form-lost', 4);
    await page.click(t('report-submit'));

    /* ── 9. La clave de liberación aparece UNA vez, en un diálogo ─────── */
    await page.locator(t('release-key-dialog')).waitFor({ state: 'visible' });
    const releaseKey = (await textOf(page, t('release-key-value'))).replace(/\s/g, '');
    record(
      vp,
      'la clave de liberación se muestra una sola vez',
      (await page.locator(t('release-key-value')).count()) === 1,
      '1 elemento release-key-value',
      `${await page.locator(t('release-key-value')).count()} elemento(s)`,
    );
    record(
      vp,
      'la clave de liberación son seis dígitos',
      /^\d{6}$/.test(releaseKey),
      '6 dígitos',
      releaseKey,
    );
    const keyOccurrences = await page.evaluate((key) => {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue.includes(key)) hits.push(node.nodeValue.trim());
        node = walker.nextNode();
      }
      return hits;
    }, releaseKey);
    record(
      vp,
      'la clave de liberación no se duplica en la pantalla',
      keyOccurrences.length === 1,
      '1 aparición del texto de la clave',
      `${keyOccurrences.length} aparición(es): ${JSON.stringify(keyOccurrences)}`,
    );
    const dialogRole = await page
      .locator(t('release-key-dialog'))
      .first()
      .evaluate((node) => ({
        role: node.getAttribute('role'),
        modal: node.getAttribute('aria-modal'),
        hasCopy: Boolean(node.querySelector('[data-testid="release-key-copy"]')),
      }));
    record(
      vp,
      'la clave vive en un diálogo modal con botón de copiar',
      dialogRole.role === 'dialog' && dialogRole.modal === 'true' && dialogRole.hasCopy,
      'role=dialog, aria-modal=true y botón release-key-copy',
      JSON.stringify(dialogRole),
    );
    await checkPrimaryAction(
      page,
      vp,
      'release-key',
      page.locator(t('release-key-copy')),
      'Copiar clave',
    );
    await checkOverflow(page, vp, 'release-key');
    await take('release-key', 5);

    await page.click(t('release-key-copy'));
    await sleep(200);
    const copyLabel = await textOf(page, t('release-key-copy'));
    record(
      vp,
      'el botón de copiar confirma que copió la clave',
      copyLabel.includes('copiada'),
      '"Clave copiada"',
      copyLabel,
    );
    const clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    record(
      vp,
      'el portapapeles contiene la clave de liberación',
      clipboard === releaseKey,
      'el portapapeles tiene la clave',
      clipboard === null ? 'no se pudo leer' : clipboard,
    );

    await page.keyboard.press('Escape');
    await page.locator(t('release-key-dialog')).waitFor({ state: 'detached' });
    const keyOnMap = await page.evaluate(
      (key) => document.body.innerText.includes(key),
      releaseKey,
    );
    record(
      vp,
      'el mapa no muestra la clave de liberación',
      keyOnMap === false,
      'la clave no aparece en el mapa',
      keyOnMap ? 'la clave aparece en el mapa' : 'no aparece',
    );

    /* ── 10. El pin nuevo cambia los contadores del encabezado ────────── */
    const lostAfterReport = await countOf(page, t('header-lost-count'));
    const foundAfterReport = await countOf(page, t('header-found-count'));
    const pinsAfterReport = await pinCount(page);
    record(
      vp,
      'el encabezado suma el pin rojo recién clavado',
      lostAfterReport === SEED_LOST + 1,
      `${SEED_LOST + 1} perdidos`,
      `${lostAfterReport} perdidos`,
    );
    record(
      vp,
      'el encabezado no suma ningún pin verde todavía',
      foundAfterReport === SEED_FOUND,
      `${SEED_FOUND} encontrados`,
      `${foundAfterReport} encontrados`,
    );
    record(
      vp,
      'el mapa muestra el pin nuevo',
      pinsAfterReport === SEED_PINS + 1,
      `${SEED_PINS + 1} pines`,
      `${pinsAfterReport} pines`,
    );

    /* ── 11. El reporte verde pide el dato ciego ─────────────────────── */
    await page.locator(t('picker-input')).click();
    await page.locator(t('picker-option-parking-1')).click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    await typeFound.click();
    await page.locator(t('report-blind-detail')).waitFor({ state: 'visible' });
    record(
      vp,
      'el pin verde pide el dato ciego',
      (await page.locator(t('report-blind-detail')).count()) === 1,
      '1 campo report-blind-detail',
      `${await page.locator(t('report-blind-detail')).count()} campo(s)`,
    );
    await page.fill(t('report-item'), FOUND_ITEM);
    await page.fill(t('report-description'), FOUND_DESCRIPTION);
    await page.fill(t('report-blind-detail'), FOUND_BLIND);
    record(
      vp,
      'el pin verde exige los tres campos',
      (await page.locator(t('report-submit')).isDisabled()) === false,
      'el botón está habilitado con los tres campos',
      `disabled=${await page.locator(t('report-submit')).isDisabled()}`,
    );
    await checkPrimaryAction(
      page,
      vp,
      'report-found',
      page.locator(t('report-submit')),
      'Clavar pin verde',
    );
    await checkOverflow(page, vp, 'report-found');
    await take('report-form-found', 6);
    await page.click(t('report-submit'));
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    record(
      vp,
      'el pin verde no abre la clave de liberación',
      (await page.locator(t('release-key-dialog')).count()) === 0,
      '0 diálogo release-key-dialog',
      `${await page.locator(t('release-key-dialog')).count()} diálogo(s)`,
    );
    record(
      vp,
      'el encabezado suma el pin verde',
      (await countOf(page, t('header-found-count'))) === SEED_FOUND + 1,
      `${SEED_FOUND + 1} encontrados`,
      `${await countOf(page, t('header-found-count'))} encontrados`,
    );

    /* ── 12. "Mis reportes" muestra lo que se acaba de publicar ──────── */
    await page.getByRole('button', { name: /^Mis reportes/ }).click();
    await page.locator(t('my-reports')).waitFor({ state: 'visible' });
    const reportId = await page.evaluate((item) => {
      const cards = [...document.querySelectorAll('[data-testid^="my-report-"]')];
      const card = cards.find((node) => node.textContent.includes(item));
      return card ? card.getAttribute('data-testid').replace('my-report-', '') : null;
    }, LOST_ITEM);
    record(
      vp,
      'el reporte recién creado aparece en "Mis reportes"',
      Boolean(reportId),
      'una tarjeta my-report-<id> con el objeto publicado',
      reportId ?? 'no se encontró la tarjeta',
    );
    if (reportId) {
      const cardText = await textOf(page, t(`my-report-${reportId}`));
      record(
        vp,
        'la tarjeta del reporte nuevo lo marca como perdido y abierto',
        cardText.includes('Perdido') && cardText.includes('Abierto'),
        '"Perdido" y "Abierto"',
        cardText.slice(0, 180),
      );
      const cardKey = (cardText.match(/(?<!\d)\d{6}(?!\d)/) ?? [])[0] ?? null;
      record(
        vp,
        'la clave de liberación queda guardada en "Mis reportes"',
        cardKey === releaseKey,
        `la misma clave (${releaseKey})`,
        cardKey ?? 'no se encontró',
      );
    }
    // innerText y no textContent: el textContent pega la clave al texto que la
    // sigue ("483921Copiar clave") y el limite de palabra la pierde.
    const seedKey = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="my-report-pin-1"]');
      if (!card) return null;
      const match = card.innerText.match(/(?<!\d)\d{6}(?!\d)/);
      return match ? match[0] : null;
    });
    record(
      vp,
      'el reporte de arranque conserva su clave de liberación',
      Boolean(seedKey),
      'una clave de 6 dígitos en my-report-pin-1',
      seedKey ?? 'no se encontró',
    );
    const rawEnums = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      let node = walker.nextNode();
      while (node) {
        const text = node.nodeValue.trim();
        if (/^(open|pending_claim|in_custody|resolved|expired|archived)$/.test(text))
          hits.push(text);
        node = walker.nextNode();
      }
      return hits;
    });
    record(
      vp,
      'ningún estado se muestra como enumerador en inglés',
      rawEnums.length === 0,
      '0 enumeradores crudos en pantalla',
      JSON.stringify(rawEnums),
    );
    await checkSingleState(page, vp, 'my-reports');
    await checkOverflow(page, vp, 'my-reports');
    await take('my-reports', 7);

    /* ── 13. La bandeja de reclamos ──────────────────────────────────── */
    await page.getByRole('button', { name: /^Bandeja/ }).click();
    await page.locator(t('inbox')).waitFor({ state: 'visible' });
    record(
      vp,
      'la bandeja de reclamos existe',
      (await page.locator(t('inbox')).count()) === 1,
      '1 sección inbox',
      `${await page.locator(t('inbox')).count()} sección(es)`,
    );
    record(
      vp,
      'la bandeja trae el reclamo recibido contra mi reporte',
      (await page.locator(t('claim-claim-1')).count()) === 1,
      '1 fila claim-claim-1',
      `${await page.locator(t('claim-claim-1')).count()} fila(s)`,
    );
    record(
      vp,
      'un reclamo pendiente se puede aprobar',
      (await page.locator(t('claim-approve')).count()) === 1,
      '1 botón claim-approve',
      `${await page.locator(t('claim-approve')).count()} botón(es)`,
    );
    record(
      vp,
      'cada botón de la bandeja se identifica por su reclamo',
      (await page.locator(t('claim-approve-claim-1')).count()) === 1 &&
        (await page.locator(t('claim-reject-claim-1')).count()) === 1,
      '1 botón claim-approve-claim-1 y 1 botón claim-reject-claim-1',
      `${await page.locator(t('claim-approve-claim-1')).count()} aprobar, ${await page.locator(t('claim-reject-claim-1')).count()} rechazar`,
    );
    await checkSingleState(page, vp, 'inbox');
    await checkOverflow(page, vp, 'inbox');
    await take('inbox', 8);

    /* ── 14. Aprobar el reclamo libera la tarjeta de contacto ─────────── */
    await page.locator(t('claim-approve')).click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    const confirmButton = page.getByRole('button', { name: /Sí, aprobar/ });
    record(
      vp,
      'aprobar un reclamo pide confirmación',
      (await confirmButton.count()) === 1,
      '1 botón "Sí, aprobar"',
      `${await confirmButton.count()} botón(es)`,
    );
    await checkPrimaryAction(page, vp, 'claim-confirm', confirmButton, 'Sí, aprobar');
    await checkOverflow(page, vp, 'claim-confirm');
    await confirmButton.click();
    await page.locator(t('contact-card')).waitFor({ state: 'visible' });
    record(
      vp,
      'aprobar el reclamo libera la tarjeta de contacto',
      (await page.locator(t('contact-card')).count()) === 1,
      '1 tarjeta contact-card',
      `${await page.locator(t('contact-card')).count()} tarjeta(s)`,
    );
    record(
      vp,
      'la tarjeta de contacto se identifica por su reclamo',
      (await page.locator(t('contact-card-claim-1')).count()) === 1 &&
        (await page.locator(t('contact-reveal-claim-1')).count()) === 1,
      '1 tarjeta contact-card-claim-1 y 1 botón contact-reveal-claim-1',
      `${await page.locator(t('contact-card-claim-1')).count()} tarjeta(s), ${await page.locator(t('contact-reveal-claim-1')).count()} botón(es)`,
    );
    const contactText = await textOf(page, t('contact-card'));
    record(
      vp,
      'la tarjeta de contacto no filtra el correo antes de revelarlo',
      !contactText.includes('L1820447@morelia.tecnm.mx'),
      'el correo no aparece hasta revelar',
      contactText.slice(0, 140),
    );
    await page.locator(t('contact-reveal')).click();
    await sleep(150);
    const revealed = await textOf(page, t('contact-card'));
    record(
      vp,
      'revelar el contacto muestra el correo institucional',
      revealed.includes('L1820447@morelia.tecnm.mx'),
      '"L1820447@morelia.tecnm.mx"',
      revealed.slice(0, 180),
    );
    await checkOverflow(page, vp, 'contact');
    await take('contact', 9);

    /* ── 15. La entrega se confirma con la clave del dueño ───────────── */
    await page.getByRole('button', { name: 'Mapa', exact: true }).click();
    await page.locator(t('map')).waitFor({ state: 'visible' });
    await page
      .locator('button[aria-label^="Pin encontrado: Laptop gris con una pegatina"]')
      .click();
    await page.locator(t('release-key-input')).waitFor({ state: 'visible' });
    record(
      vp,
      'el pin verde que reclama abre el diálogo de confirmar la entrega',
      (await page.locator(t('release-key-input')).count()) === 1 &&
        (await page.locator(t('release-key-submit')).count()) === 1,
      '1 campo release-key-input y 1 botón release-key-submit',
      `${await page.locator(t('release-key-input')).count()} campo(s), ${await page.locator(t('release-key-submit')).count()} botón(es)`,
    );
    if (seedKey) {
      await page.fill(t('release-key-input'), seedKey);
      await checkPrimaryAction(
        page,
        vp,
        'delivery',
        page.locator(t('release-key-submit')),
        'Confirmar entrega',
      );
      const unlockButton = await page.locator(t('release-key-submit')).evaluate((node) => ({
        label: node.getAttribute('aria-label'),
        position: getComputedStyle(node.parentElement).position,
      }));
      record(
        vp,
        'el botón de la clave tiene un nombre accesible (no sólo el glifo)',
        typeof unlockButton.label === 'string' && unlockButton.label.length > 0,
        'un aria-label con texto',
        unlockButton.label ?? 'sin aria-label',
      );
      record(
        vp,
        'la acción de la clave se queda pegada al borde del diálogo',
        unlockButton.position === 'sticky',
        'position: sticky en la fila de la clave',
        unlockButton.position,
      );
      await checkOverflow(page, vp, 'delivery');
      await page.click(t('release-key-submit'));
      const resolveButton = page.getByRole('button', { name: /Sí, la entrega se realizó/ });
      await resolveButton.waitFor({ state: 'visible' });
      record(
        vp,
        'la clave correcta pide confirmar la entrega',
        (await resolveButton.count()) === 1,
        '1 botón "Sí, la entrega se realizó"',
        `${await resolveButton.count()} botón(es)`,
      );
      await resolveButton.click();
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    }

    /* ── 16. El mapa después de cerrar el caso ───────────────────────── */
    await page.waitForFunction(
      (expected) => document.querySelectorAll('button[aria-label^="Pin "]').length === expected,
      SEED_PINS,
    );
    const pinsAfterDelivery = await pinCount(page);
    const lostAfterDelivery = await countOf(page, t('header-lost-count'));
    const foundAfterDelivery = await countOf(page, t('header-found-count'));
    record(
      vp,
      'la entrega cerrada saca los dos pines del caso del mapa',
      pinsAfterDelivery === SEED_PINS,
      `${SEED_PINS} pines (el pin rojo y el verde del caso ya no están)`,
      `${pinsAfterDelivery} pines`,
    );
    record(
      vp,
      'el encabezado descuenta el pin rojo entregado',
      lostAfterDelivery === SEED_LOST,
      `${SEED_LOST} perdidos`,
      `${lostAfterDelivery} perdidos`,
    );
    record(
      vp,
      'el encabezado descuenta el pin verde entregado',
      foundAfterDelivery === SEED_FOUND,
      `${SEED_FOUND} encontrados`,
      `${foundAfterDelivery} encontrados`,
    );
    await checkOverflow(page, vp, 'map-after-delivery');
    await take('map-after-delivery', 10);

    /* ── 17. Nada se borra: el caso resuelto sigue en "Mis reportes" ─── */
    await page.getByRole('button', { name: /^Mis reportes/ }).click();
    await page.locator(t('my-reports')).waitFor({ state: 'visible' });
    const resolvedText = await textOf(page, t('my-report-pin-1'));
    record(
      vp,
      'el reporte resuelto sigue en "Mis reportes" (nada se borra)',
      resolvedText.includes('Resuelto'),
      'my-report-pin-1 con estado "Resuelto"',
      resolvedText.slice(0, 140),
    );
    record(
      vp,
      'la app nunca muestra un estado de error en el recorrido',
      (await page.locator(t('state-error')).count()) === 0,
      '0 paneles state-error',
      `${await page.locator(t('state-error')).count()} panel(es)`,
    );
    await checkOverflow(page, vp, 'my-reports-after-delivery');

    /* ── 18. Salir de la sesión borra lo del estudiante anterior ─────── */
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.locator(t('login-email')).waitFor({ state: 'visible' });
    record(
      vp,
      'salir de la sesión devuelve al acceso',
      (await page.locator(t('map')).count()) === 0 &&
        (await page.locator('[data-testid^="my-report-"]').count()) === 0,
      '0 croquis y 0 tarjetas de reporte en pantalla',
      `${await page.locator(t('map')).count()} croquis, ${await page.locator('[data-testid^="my-report-"]').count()} tarjetas`,
    );

    await page.fill(t('login-email'), 'L2030451@morelia.tecnm.mx');
    await page.click(t('login-submit'));
    await page.locator(t('login-demo')).waitFor({ state: 'visible' });
    await page.click(t('login-demo'));
    await page.locator(t('map')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    await page.getByRole('button', { name: /^Mis reportes/ }).click();
    await page.locator(t('my-reports')).waitFor({ state: 'visible' });
    const freshCards = await page.locator('[data-testid^="my-report-"]').allInnerTexts();
    record(
      vp,
      'la sesión nueva no ve lo que publicó el estudiante anterior',
      freshCards.length === 2 && !freshCards.some((text) => text.includes(LOST_ITEM)),
      'sólo los 2 reportes del campus, sin el publicado en este recorrido',
      `${freshCards.length} tarjetas`,
    );

    /* ── 19. Sin conexión: las pantallas lo dicen y no mienten ──────── */
    await context.setOffline(true);
    await page.locator(t('state-offline')).waitFor({ state: 'visible' });
    const offlineHooks = await stateHooks(page);
    record(
      vp,
      'sin señal aparece el aviso de conexión perdida',
      offlineHooks.offline === 1,
      '1 aviso state-offline',
      JSON.stringify(offlineHooks),
    );
    record(
      vp,
      'el aviso de conexión perdida pide los datos del campus',
      (await textOf(page, t('state-offline'))).includes('del campus'),
      'el texto dice "del campus"',
      (await textOf(page, t('state-offline'))).slice(0, 120),
    );

    await page.getByRole('button', { name: 'Mapa', exact: true }).click();
    await page.locator(t('map')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    record(
      vp,
      'sin señal el croquis no se tira: sigue lo último que se cargó',
      (await page.locator(t('map')).count()) === 1 && (await pinCount(page)) > 0,
      '1 croquis con sus pines',
      `${await page.locator(t('map')).count()} croquis, ${await pinCount(page)} pines`,
    );

    await page.getByRole('button', { name: /^Mis reportes/ }).click();
    await page.locator(t('my-reports')).waitFor({ state: 'visible' });
    record(
      vp,
      'sin señal "Mis reportes" muestra el panel, no un cuerpo vacío',
      (await page.locator(t('state-error')).count()) === 1 &&
        (await page.locator('[data-testid^="my-report-"]').count()) === 0,
      '1 panel state-error y 0 tarjetas de reporte',
      `${await page.locator(t('state-error')).count()} panel(es), ${await page.locator('[data-testid^="my-report-"]').count()} tarjetas`,
    );
    await checkSingleState(page, vp, 'my-reports-offline');

    await page.getByRole('button', { name: /^Bandeja/ }).click();
    await page.locator(t('inbox')).waitFor({ state: 'visible' });
    record(
      vp,
      'sin señal la bandeja muestra el panel, no un cuerpo vacío',
      (await page.locator(t('state-error')).count()) === 1 &&
        (await page.locator('[data-testid^="claim-claim-"]').count()) === 0,
      '1 panel state-error y 0 filas de reclamo',
      `${await page.locator(t('state-error')).count()} panel(es), ${await page.locator('[data-testid^="claim-claim-"]').count()} filas`,
    );
    await checkSingleState(page, vp, 'inbox-offline');
    await take('offline-inbox', 11);

    await context.setOffline(false);
    await page.locator(t('state-offline')).waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="claim-claim-"]').length > 0,
    );
    record(
      vp,
      'al volver la señal la bandeja vuelve a mostrar sus reclamos',
      (await page.locator('[data-testid^="claim-claim-"]').count()) >= 1,
      'al menos una fila de reclamo',
      `${await page.locator('[data-testid^="claim-claim-"]').count()} filas`,
    );

    /* ── 20. El croquis que no llega se dice y se puede reintentar ───── */
    // El servidor responde 200 pero con un cuerpo que no es una imagen: el
    // croquis "no llega" sin ensuciar la consola con un error de red.
    await page.route('**/mapa-itm-dark.png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: 'no soy una imagen' }),
    );
    await page.reload({ waitUntil: 'commit' });
    await page.locator(t('state-error')).waitFor({ state: 'visible' });
    record(
      vp,
      'un croquis que no se descarga lo dice y no pinta zonas',
      (await page.locator(t('state-error')).count()) === 1 &&
        (await page.locator('[data-zone-id]').count()) === 0,
      '1 panel state-error y 0 zonas pintadas',
      `${await page.locator(t('state-error')).count()} panel(es), ${await page.locator('[data-zone-id]').count()} zonas`,
    );
    await page.unroute('**/mapa-itm-dark.png');
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-zone-id]').length > 0);
    record(
      vp,
      'tras reintentar el croquis vuelve a medirse y las zonas se pintan',
      (await page.locator('[data-zone-id]').count()) > 0,
      '> 0 zonas con data-zone-id',
      `${await page.locator('[data-zone-id]').count()} zonas`,
    );

    /* ── 21. El campus caído se dice con su reintento ─────────────────── */
    // La demostración sabe caerse: con esta bandera el campus no responde.
    await page.addInitScript(() => {
      window.__campusFailure = true;
    });
    await page.reload({ waitUntil: 'commit' });
    await page.locator(t('state-error')).waitFor({ state: 'visible' });
    record(
      vp,
      'un campus caído se declara caído (no vacío)',
      (await page.locator(t('state-error')).count()) === 1 &&
        (await page.locator(t('state-empty')).count()) === 0 &&
        (await page.locator(t('map')).count()) === 0,
      '1 panel state-error, sin state-empty y sin croquis',
      `${await page.locator(t('state-error')).count()} error(es), ${await page.locator(t('state-empty')).count()} vacío(s), ${await page.locator(t('map')).count()} croquis`,
    );
    record(
      vp,
      'el fallo del campus ofrece reintentar',
      (await page.getByRole('button', { name: 'Reintentar' }).count()) === 1,
      '1 botón "Reintentar"',
      `${await page.getByRole('button', { name: 'Reintentar' }).count()} botón(es)`,
    );
    await take('campus-error', 12);

    // El reintento con el campus de vuelta sí carga el croquis.
    await page.evaluate(() => {
      window.__campusFailure = false;
    });
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await page.locator(t('map')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    record(
      vp,
      'reintentar con el campus de vuelta carga el croquis',
      (await page.locator(t('state-error')).count()) === 0 && (await pinCount(page)) === SEED_PINS,
      `0 paneles state-error y ${SEED_PINS} pines`,
      `${await page.locator(t('state-error')).count()} panel(es), ${await pinCount(page)} pines`,
    );

    return { screenshots };
  } finally {
    await context.close();
  }
}

/* ──────────────────────────────── Informe ──────────────────────────────── */

function printReport() {
  const line = '─'.repeat(78);
  console.log(`\n${line}\nSMOKE JOURNEY — Objetos Perdidos ITM\n${line}`);
  console.log(`app: ${APP_URL}`);
  console.log(`chromium: ${CHROMIUM_PATH}`);
  console.log(`capturas: ${SHOTS_DIR}\n`);

  for (const viewport of VIEWPORTS) {
    const own = results.filter((entry) => entry.viewport === viewport.name);
    const failed = own.filter((entry) => !entry.pass);
    console.log(
      `\n▌ ${viewport.name} (${viewport.width}x${viewport.height}) — ${own.length - failed.length}/${own.length} aserciones OK`,
    );
    for (const entry of own) {
      console.log(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.name}`);
      console.log(`         esperado: ${entry.expected}`);
      console.log(`         observado: ${entry.observed}`);
    }
  }

  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${line}`);
  console.log(`RESUMEN: ${results.length - failed.length}/${results.length} aserciones OK`);
  console.log(`ERRORES DE CONSOLA: ${consoleErrors.length}`);
  for (const entry of consoleErrors) console.log(`  ${entry}`);
  console.log(`HALLAZGOS SOBRE LA APP: ${findings.length}`);
  for (const item of findings) console.log(`  [${item.where}] ${item.what}`);
  console.log(line);
}

/* ─────────────────────────────────── Main ─────────────────────────────────── */

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });

  const server = await ensureServer(APP_URL);
  console.log(
    server.started
      ? `Servidor de desarrollo arrancado por la prueba en ${APP_URL}`
      : `El servidor en ${APP_URL} ya estaba corriendo: la prueba no lo toca`,
  );

  let browser;
  const screenshots = [];
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox'],
    });
    for (const viewport of VIEWPORTS) {
      const outcome = await runJourney(browser, viewport);
      screenshots.push(...outcome.screenshots);
    }
  } finally {
    if (browser) await browser.close();
    await server.stop();
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

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error('\nLa prueba falló antes de terminar:');
    console.error(error);
    printReport();
    process.exitCode = 1;
  });
}
