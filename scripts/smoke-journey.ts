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
 * The port is not 5173: on this machine that one belongs to another project.
 * The journey picks a free port of its own (override it with APP_URL) and,
 * before it drives a server it did not start, it makes sure the server is
 * THIS app: a port served by another project is an error, not a journey.
 *
 *   vp exec node scripts/smoke-journey.mjs
 */

import { chromium, type Browser, type CDPSession, type Locator, type Page } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LIGHT,
  artworkToPercent,
  codeSizePx,
  extrudePolygon,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonPath,
  wallHeightPx,
  zoneAtPoint,
} from '../src/map/geometry.ts';
import { MAP_SPACE, ZONE_BY_ID, ZONES } from '../src/map/zones.ts';
import type { Box, Polygon, Zone } from '../src/types.ts';

/* ─────────────────────────── Configuración ─────────────────────────── */

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const APP_URL = process.env.APP_URL ?? 'http://localhost:5199';
export const SHOTS_DIR = join(ROOT, '.e2e', 'screenshots');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const SERVER_BOOT_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 15_000;

/**
 * La huella de esta app en el HTML que sirve el servidor de desarrollo.
 *
 * El 5173 de esta máquina lo tiene otro proyecto: sin esta comprobación la
 * prueba mediría la app ajena y reportaría unjourney vacío.
 */
const APP_MARKERS = ['Objetos Perdidos ITM', '/src/main.jsx'];

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

/** Los dos reportes que se apilan en la misma zona (T24). */
const CLUSTER_LOST_ITEM = 'Estuche de lápices de la clase de dibujo';
const CLUSTER_LOST_DESCRIPTION = 'Lo dejé en el banco de la entrada del edificio A.';
const CLUSTER_FOUND_ITEM = 'Termo de acero con una calcomanía';
const CLUSTER_FOUND_DESCRIPTION = 'Estaba encima de una mesa del pasillo del edificio A.';
const CLUSTER_FOUND_BLIND = 'Acero gris, calcomanía verde en un lado, tapa con una rayadura.';

/** Hallazgos sobre la app que la prueba descubre (no son fallos del recorrido). */
/** La caja que el navegador dibuja: con `left` y `top`, como el DOM. */
interface DomBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** El artwork del croquis: su caja, la de su layout y la que se pinta. */
interface Raster {
  box: DomBox;
  local: { width: number; height: number };
  painted: { x: number; y: number; width: number; height: number };
}

/** La caja que devuelve el navegador: con `x` y `y`, como el DOM. */
interface PlaywrightBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** El viewport que se recorre: su nombre y su tamaño. */
interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** Un punto de la pantalla. */
interface Spot {
  x: number;
  y: number;
}

const findings: string[] = [];

/* ────────────────────────────── Utilidades ────────────────────────────── */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** ¿Contesta la app en esa URL? */
export async function isUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * ¿El que contesta en esa URL es esta app?
 *
 * El puerto puede estarlo otro proyecto: la prueba lo dice en vez de medir la
 * app equivocada.
 */
export async function servesOurApp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const html = await response.text();
    return APP_MARKERS.every((marker) => html.includes(marker));
  } catch {
    return false;
  }
}

/**
 * Devuelve el servidor: el que ya esté corriendo o uno propio.
 * `stop()` sólo mata lo que este proceso arrancó.
 */
export async function ensureServer(
  url = APP_URL,
): Promise<{ started: boolean; stop: () => Promise<void>; log: string[] }> {
  if (await isUp(url)) {
    // Un servidor que ya estaba puede ser el de otro proyecto: la prueba
    // reúsa el suyo, pero nunca mide el de otro.
    if (!(await servesOurApp(url))) {
      throw new Error(
        `El puerto de ${url} no lo sirve esta app (puede estarlo otra aplicación). ` +
          'Corre la prueba con APP_URL=http://localhost:5199 o con otro puerto libre.',
      );
    }
    return { started: false, stop: async () => {}, log: [] };
  }

  const port = new URL(url).port || '5173';
  const bin = join(ROOT, 'node_modules', '.bin', 'vp');
  const log: string[] = [];
  // `--strictPort`: si el puerto está ocupado, el servidor muere en vez de
  // mudarse a otro y dejar la prueba conduciendo la app equivocada.
  const child = spawn(bin, ['dev', '--port', port, '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer) => {
    log.push(String(chunk));
    if (log.length > 200) log.shift();
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
      /* el grupo de procesos ya no existe */
    }
    await sleep(1200);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* ya estaba muerto */
    }
  };

  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp(url)) {
      if (!(await servesOurApp(url))) {
        await stop();
        throw new Error(
          `El puerto de ${url} no lo sirve esta app (puede estarlo otra aplicación).`,
        );
      }
      return { started: true, stop, log };
    }
    if (child.exitCode !== null) {
      throw new Error(`El servidor de desarrollo murió:\n${log.join('')}`);
    }
    await sleep(400);
  }

  await stop();
  throw new Error(`El servidor de desarrollo no respondió en ${url}:\n${log.join('')}`);
}

/* ─────────────────────────── Informe de aserciones ─────────────────────────── */

const results: {
  viewport: string;
  name: string;
  pass: boolean;
  expected: string;
  observed: string;
}[] = [];
const consoleErrors: string[] = [];
const consoleMessages: string[] = [];
const findingKeys = new Set();

function record(
  viewport: string,
  name: string,
  pass: unknown,
  expected: string,
  observed: unknown,
): boolean {
  results.push({ viewport, name, pass: Boolean(pass), expected, observed: String(observed) });
  return Boolean(pass);
}

function finding(where: string, what: string): void {
  // La clave ignora las medidas: el mismo defecto en dos viewports es un solo hallazgo.
  const key = `${where}|${what.slice(0, 45)}`;
  if (findingKeys.has(key)) return;
  findingKeys.add(key);
  findings.push(`${where}: ${what}`);
}

/* ──────────────────────────── Utilidades de página ──────────────────────────── */

const t = (id: string) => `[data-testid="${id}"]`;

/** El texto limpio de un elemento (sin espacios dobles). */
async function textOf(page: Page, selector: string): Promise<string> {
  const raw = await page.locator(selector).first().innerText();
  return raw.replace(/\s+/g, ' ').trim();
}

/** El número de un contador del encabezado ("2 perdidos" → 2). */
async function countOf(page: Page, selector: string): Promise<number> {
  const raw = await textOf(page, selector);
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

/** El transform del capa del croquis (la que se mueve al hacer zoom o arrastre). */
async function artworkTransform(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const listbox = document.querySelector('[data-testid="map"] [role="listbox"]');
    return listbox?.parentElement?.getAttribute('style') ?? null;
  });
}

/** El factor de escala del croquis. */
function scaleOf(transform: string | null): number {
  const match = transform?.match(/scale\(([\d.]+)\)/);
  return match ? Number(match[1]) : NaN;
}

/** La traslación del croquis: cuánto se movió el artwork en la pantalla. */
function translationOf(transform: string | null): Spot | null {
  const match = transform?.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** La caja de la capa del artwork (las zonas y los pines): el croquis pintado. */
async function artworkLayerBox(page: Page): Promise<DomBox | null> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-testid="map"] [role="listbox"]')?.parentElement;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

/**
 * La rueda acerca el croquis hasta una escala dada, con el cursor como ancla
 * (el artwork que está bajo el cursor se queda donde está).
 */
async function zoomTo(page: Page, target: number, cursor: Spot): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = scaleOf((await artworkTransform(page)) ?? '');
    if (!Number.isFinite(current) || current <= 0) return;
    if (Math.abs(current - target) <= 0.05) return;
    const delta = (-Math.log(target / current) / 0.0015) * 0.98;
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, delta);
    await sleep(200);
  }
}

/**
 * El artwork del croquis: la caja que se ve en la pantalla y el marco de la
 * letterbox sobre su caja de layout (la que el zoom no toca). El artwork ya
 * no es un mapa de bits sino un <svg>: su tamaño natural es el viewBox.
 */
async function rasterBox(page: Page): Promise<Raster | null> {
  return page.evaluate(() => {
    const artwork = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
    const viewBox = artwork?.viewBox?.baseVal;
    if (!artwork || !viewBox || !(viewBox.width > 0)) return null;
    const style = getComputedStyle(artwork);
    const local = { width: parseFloat(style.width), height: parseFloat(style.height) };
    const natural = { width: viewBox.width, height: viewBox.height };
    const rect = artwork.getBoundingClientRect();
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
function paintedArtworkBox(raster: Raster): DomBox {
  return {
    left: raster.box.left + (raster.painted.x / raster.local.width) * raster.box.width,
    top: raster.box.top + (raster.painted.y / raster.local.height) * raster.box.height,
    width: (raster.painted.width / raster.local.width) * raster.box.width,
    height: (raster.painted.height / raster.local.height) * raster.box.height,
  };
}

/** El punto del artwork (0..1) que el raster pinta bajo un punto de la pantalla. */
function artworkUnder(raster: Raster, client: Spot): Spot {
  const localX = ((client.x - raster.box.left) / raster.box.width) * raster.local.width;
  const localY = ((client.y - raster.box.top) / raster.box.height) * raster.local.height;
  return {
    x: (localX - raster.painted.x) / raster.painted.width,
    y: (localY - raster.painted.y) / raster.painted.height,
  };
}

/** El artwork medido: la prueba no sigue sin medidas. */
async function rasterOf(page: Page): Promise<Raster> {
  const raster = await rasterBox(page);
  if (!raster) throw new Error('no se pudo medir el artwork del croquis');
  return raster;
}

/** La capa del artwork medida: la prueba no sigue sin medidas. */
async function layerOf(page: Page): Promise<DomBox> {
  const layer = await artworkLayerBox(page);
  if (!layer) throw new Error('no se pudo medir la capa del croquis');
  return layer;
}

/** El punto de la pantalla donde el raster pinta un punto del artwork. */
function screenOfArtwork(raster: Raster, artwork: Spot): Spot {
  const localX = raster.painted.x + artwork.x * raster.painted.width;
  const localY = raster.painted.y + artwork.y * raster.painted.height;
  return {
    x: raster.box.left + (localX / raster.local.width) * raster.box.width,
    y: raster.box.top + (localY / raster.local.height) * raster.box.height,
  };
}

/** El punto de la pantalla donde la capa de zonas pinta un punto del artwork. */
function screenOfArtworkLayer(layer: DomBox, artwork: Spot): Spot {
  return {
    x: layer.left + artwork.x * layer.width,
    y: layer.top + artwork.y * layer.height,
  };
}

/** El tamaño en pantalla del primer pin del mapa. */
async function pinSize(page: Page): Promise<PlaywrightBox> {
  return page.evaluate(() => {
    const pin = document.querySelector<HTMLElement>('button[aria-label^="Pin "]');
    if (!pin) return { x: 0, y: 0, width: 0, height: 0 };
    const rect = pin.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

/**
 * La escala pintada del croquis: píxeles de pantalla por unidad del artwork.
 * El croquis publica la suya (`data-scale`), que es la misma que usa para
 * extruir los volúmenes; sin ella se mide sobre el <svg> pintado.
 */
async function paintedScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
    const declared = Number(svg?.dataset?.scale);
    if (Number.isFinite(declared) && declared > 0) return declared;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return rect.width / vb.width;
  });
}

/**
 * La pared que se ve de un edificio: el desplazamiento entre su base y su
 * tejado, en píxeles de pantalla. Es lo que decide si el relieve se lee como
 * un volumen o como una mancha del plano.
 */
async function visibleWall(
  page: Page,
  buildingId: string,
): Promise<{ dx: number; dy: number } | null> {
  const units = await page.evaluate((id) => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
    const group = svg?.querySelector(`[data-building="${id}"]`);
    const base = group?.querySelector<SVGGraphicsElement>('[data-shape="base"]');
    const top = group?.querySelector<SVGGraphicsElement>('[data-shape="top"]');
    if (!base || !top) return null;
    const b = base.getBBox();
    const t = top.getBBox();
    return { dx: b.x - t.x, dy: b.y - t.y };
  }, buildingId);
  if (!units) return null;
  const scale = await paintedScale(page);
  return { dx: units.dx * scale, dy: units.dy * scale };
}

/** El contraste de dos colores, con la fórmula de WCAG. */
function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const value = String(hex).replace('#', '').trim();
    const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c: number) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Un deslizamiento con el dedo: el navegador decide si la página se desplaza
 * o el croquis se mueve, según el `touch-action` de la capa que hay bajo el
 * dedo.
 */
async function swipe(client: CDPSession, from: Spot, deltaY: number): Promise<void> {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let step = 1; step <= 10; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x, y: from.y + (deltaY * step) / 10, id: 1 }],
    });
    await sleep(30);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

/** El punto está dentro del recuadro del croquis que se ve en la pantalla. */
function within(point: Spot, box: DomBox): boolean {
  return (
    point.x > box.left + 4 &&
    point.x < box.left + box.width - 4 &&
    point.y > box.top + 4 &&
    point.y < box.top + box.height - 4
  );
}

/**
 * El centro del tejado de un edificio: la cara que el dedo toca. El tejado es
 * la base desplazada hacia la luz, así que el punto cae fuera de la base.
 */
function roofCenter(zone: Zone, scale: number): Spot | null {
  const shapes = zone.fragments?.length ? zone.fragments : [zone.polygon ?? []];
  const shape = shapes.reduce(
    (best, candidate) => (polygonArea(candidate) > polygonArea(best) ? candidate : best),
    shapes[0],
  );
  const roof = extrudePolygon(shape, wallHeightPx(zone, shape, scale), scale, LIGHT).top;
  return polygonCentroid(roof);
}

/**
 * Un punto de la BASE de un edificio: la huella que asoma debajo del volumen.
 * Está fuera de todos los tejados, así que el toque sólo puede resolverlo la
 * base.
 *
 * El punto se mide donde CAE el dedo: el navegador redondea las coordenadas
 * de pantalla al píxel entero, así que el punto que se toca no es el que se
 * calculó. El punto de la base es el que sobrevive a ese redondeo.
 */
function baseSpot(
  zones: Zone[],
  scale: number,
  raster: Raster,
): { zone: Zone; point: Spot; client: Spot } | null {
  for (const zone of zones.filter((entry) => entry.kind === 'building')) {
    const shapes = zone.fragments?.length ? zone.fragments : [zone.polygon ?? []];
    const shape = shapes.reduce(
      (best, candidate) => (polygonArea(candidate) > polygonArea(best) ? candidate : best),
      shapes[0],
    );
    const bounds = polygonBounds(shape);
    if (!bounds) continue;
    for (let fx = 0.2; fx <= 0.951; fx += 0.15) {
      for (let fy = 0.2; fy <= 0.951; fy += 0.15) {
        const point = {
          x: bounds.minX + (bounds.maxX - bounds.minX) * fx,
          y: bounds.minY + (bounds.maxY - bounds.minY) * fy,
        };
        if (!pointInPolygon(point, shape)) continue;
        const landed = landedPoint(raster, point);
        if (!pointInPolygon(landed.artwork, shape)) continue;
        const covered = zones
          .filter((other) => other.kind === 'building')
          .some((other) =>
            (other.fragments?.length ? other.fragments : [other.polygon ?? []]).some((candidate) =>
              pointInPolygon(
                landed.artwork,
                extrudePolygon(candidate, wallHeightPx(other, candidate, scale), scale, LIGHT).top,
              ),
            ),
          );
        if (covered) continue;
        if (zoneAtPoint(landed.artwork, zones, { scale })?.id !== zone.id) continue;
        return { zone, point: landed.artwork, client: landed.client };
      }
    }
  }
  return null;
}

/**
 * El punto donde cae el dedo: el navegador redondea a píxel entero, así que
 * el punto real es el que sobrevive al redondeo.
 */
function landedPoint(raster: Raster, artworkPoint: Spot): { client: Spot; artwork: Spot } {
  const spot = screenOfArtwork(raster, {
    x: artworkPoint.x / MAP_SPACE.width,
    y: artworkPoint.y / MAP_SPACE.height,
  });
  const client = { x: Math.floor(spot.x), y: Math.floor(spot.y) };
  const under = artworkUnder(raster, client);
  return {
    client,
    artwork: { x: under.x * MAP_SPACE.width, y: under.y * MAP_SPACE.height },
  };
}

/** Los pines del mapa (los botones con nombre accesible "Pin perdido/encontrado"). */
const pinCount = (page: Page): Promise<number> =>
  page.locator('button[aria-label^="Pin "]').count();

/** Los grupos del mapa: un marcador por zona con más de un reporte. */
const clusterCount = (page: Page): Promise<number> =>
  page.locator('button[data-testid^="pin-cluster-marker-"]').count();

/** Los marcadores del mapa: los pines sueltos y los grupos. */
const markerCount = (page: Page): Promise<number> =>
  page.locator('button[aria-label^="Pin "], button[data-testid^="pin-cluster-marker-"]').count();

/**
 * Comprueba que la acción principal de un diálogo es alcanzable: visible, dentro
 * del viewport y con un objetivo táctil de 44px de alto.
 */
async function checkPrimaryAction(
  page: Page,
  viewport: string,
  step: string,
  locator: Locator,
  label: string,
): Promise<void> {
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
  if (!box || !size) return;
  const inside =
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
async function checkOverflow(page: Page, viewport: string, step: string): Promise<void> {
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
async function stateHooks(page: Page): Promise<{
  loading: number;
  empty: number;
  error: number;
  offline: number;
}> {
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
async function checkSingleState(page: Page, viewport: string, step: string): Promise<void> {
  const hooks = await stateHooks(page);
  const screens = hooks.loading + hooks.empty + hooks.error;
  record(
    viewport,
    `${step}: la pantalla muestra un solo estado`,
    screens <= 1,
    'a lo sumo un estado de pantalla (cargando, vacío o error)',
    JSON.stringify(hooks),
  );
}

/* ─────────────────────────────── Recorrido ─────────────────────────────── */

async function runJourney(
  browser: Browser,
  viewport: Viewport,
): Promise<{ screenshots: string[] }> {
  const { name: vp, width, height } = viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'es-MX',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  // El canal del navegador: los gestos del dedo entran por aquí, como entran
  // de un dedo de verdad.
  const client = await context.newCDPSession(page);

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

  const screenshots: string[] = [];
  const take = async (step: string, index: number): Promise<string> => {
    const file = join(SHOTS_DIR, `${String(index).padStart(2, '0')}-${step}-${vp}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
    return file;
  };
  const takeClip = async (
    step: string,
    index: number,
    clip: { x: number; y: number; width: number; height: number },
  ): Promise<string> => {
    const file = join(SHOTS_DIR, `${String(index).padStart(2, '0')}-${step}-${vp}.png`);
    await page.screenshot({ path: file, clip });
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
        const raw = node.nodeValue ?? '';
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
      return { innerText: (button as HTMLElement).innerText, gaps };
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
    await page.locator(t('map-artwork')).waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('button[aria-label^="Pin "]').length > 0,
    );
    const artworkBox = await page.evaluate(() => {
      const node = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
      const box = node?.viewBox?.baseVal;
      return {
        tag: node?.tagName ?? '',
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      };
    });
    record(
      vp,
      'el croquis se dibuja como vector y no como mapa de bits',
      artworkBox.tag === 'svg' && artworkBox.width === 700 && artworkBox.height === 647,
      'un <svg> con un viewBox de 700 x 647',
      `<${artworkBox.tag}> viewBox=${artworkBox.width}x${artworkBox.height}`,
    );
    const zones = await page.locator('[data-zone-id]').count();
    record(
      vp,
      'el croquis publica sus zonas como opciones',
      zones > 0,
      '> 0 zonas con data-zone-id',
      `${zones} zonas`,
    );

    /* ── 2b. El contrato accesible del croquis ───────────────────────── */
    const a11y = await page.evaluate(() => {
      const options = [...document.querySelectorAll('[data-testid="map"] [role="option"]')];
      let smallest = Infinity;
      for (const option of options) {
        const rect = option.getBoundingClientRect();
        smallest = Math.min(smallest, rect.width, rect.height);
      }
      const listbox = document.querySelector('[data-testid="map"] [role="listbox"]');
      return {
        options: options.length,
        smallest,
        active: listbox?.getAttribute('aria-activedescendant') ?? null,
        tabStops: options.filter((option) => option.getAttribute('tabindex') === '0').length,
        live: Boolean(document.querySelector('[data-testid="map"] [role="status"]')),
      };
    });
    record(
      vp,
      'el croquis conserva sus 90 opciones y su único punto de tabulación',
      a11y.options === 90 && a11y.tabStops === 1 && a11y.active !== null && a11y.live,
      '90 opciones, un tab stop, aria-activedescendant y la región viva',
      JSON.stringify(a11y),
    );
    record(
      vp,
      'las zonas del croquis tienen un objetivo táctil de 44 px',
      a11y.smallest >= 44 - 0.5,
      'ningún lado por debajo de 44px (el navegador redondea el reparto en porcentajes)',
      `el lado más pequeño mide ${a11y.smallest.toFixed(2)}px`,
    );

    /* ── 2c. La escena: las construcciones de pie y los puntos seguros ── */
    const scene = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
      if (!svg) return null;
      const group = svg.querySelector('[data-volume="bldg-2k-0"]');
      const paths = (name: string) =>
        [...(group?.querySelectorAll(`[data-shape="${name}"]`) ?? [])].map((node) =>
          node.getAttribute('d'),
        );
      return {
        volumes: svg.querySelectorAll('[data-layer="volumes"] [data-building]').length,
        top: paths('top'),
        sides: paths('side'),
        shadow: paths('shadow'),
        safeFill:
          svg.querySelector('[data-building="bldg-a"] [data-shape="top"]')?.getAttribute('fill') ??
          null,
        plainFill:
          svg.querySelector('[data-volume="bldg-2k-0"] [data-shape="top"]')?.getAttribute('fill') ??
          null,
        safeMarks: svg.querySelectorAll('[data-shape="safe-mark"]').length,
      };
    });

    const scaleAtOne = await paintedScale(page);
    const sample = ZONE_BY_ID.get('bldg-2k');
    if (!sample) throw new Error('el catálogo no tiene la zona bldg-2k');
    const volume = extrudePolygon(
      sample.polygon ?? [],
      wallHeightPx(sample, sample.polygon ?? [], scaleAtOne),
      scaleAtOne,
      LIGHT,
    );
    const expectedVolumes = ZONES.filter((zone) => zone.kind === 'building').reduce(
      (total, zone) => total + (zone.fragments?.length ?? 1),
      0,
    );
    record(
      vp,
      'las construcciones se dibujan como volúmenes (cara, paredes y sombra)',
      scene?.top?.[0] === polygonPath(volume.top) &&
        scene?.sides?.[0] === polygonPath(volume.sides[0]) &&
        scene?.shadow?.[0] === polygonPath(volume.shadow),
      'la cara, la primera pared y la sombra de 2K con la geometría del catálogo',
      `cara=${scene?.top?.[0]?.slice(0, 32)} paredes=${scene?.sides?.length ?? 0} sombra=${scene?.shadow?.[0]?.slice(0, 32)}`,
    );
    // El tejado se solapa con su propia base: un tejado que se va del
    // edificio deja una losa pegada al pasto. La clave se imprime en el
    // centro de la base, sobre una chapa, y se lee igual.
    const roofOverlaps = volume.top.some(([x, y]) =>
      pointInPolygon({ x, y }, sample.polygon ?? []),
    );
    record(
      vp,
      'el tejado se solapa con su propia base',
      roofOverlaps,
      'una esquina del tejado dentro de la base de la construcción',
      roofOverlaps ? 'el tejado cubre parte de su base' : 'el tejado se fue del edificio',
    );
    record(
      vp,
      'todas las piezas de las construcciones se dibujan',
      scene?.volumes === expectedVolumes,
      `${expectedVolumes} volúmenes (uno por fragmento del catálogo)`,
      `${scene?.volumes} volúmenes`,
    );
    record(
      vp,
      'los puntos de entrega seguros se pintan con el color de la marca',
      scene?.safeFill === 'var(--color-relief-safe-roof)' &&
        (await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-relief-safe-roof')
            .trim(),
        )) ===
          (await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--color-brand-400').trim(),
          )),
      'la cara de A con el ámbar de la marca',
      scene?.safeFill ?? 'no se encontró',
    );
    record(
      vp,
      'las construcciones corriente no se pintan con el color de la marca',
      typeof scene?.plainFill === 'string' && !scene.plainFill.includes('brand'),
      'la cara de 2K sin el color de la marca',
      scene?.plainFill ?? 'no se encontró',
    );
    record(
      vp,
      'los puntos de entrega seguros llevan su marca',
      scene?.safeMarks === 2,
      '2 marcas (A y AF)',
      `${scene?.safeMarks} marca(s)`,
    );

    /* ── 2c-bis. El relieve se ve: la pared, los tonos y el código ───── */
    // La pared del edificio más pequeño: si el edificio más chiquito no
    // tiene pared, el campus entero se aplana contra el plano.
    const smallestBuilding = ZONES.filter((zone) => zone.kind === 'building').reduce(
      (best, zone) =>
        polygonArea(zone.polygon ?? []) < polygonArea(best.polygon ?? []) ? zone : best,
    );
    const wallAtOne = await visibleWall(page, smallestBuilding.id);
    record(
      vp,
      'la pared del edificio más pequeño se ve a 1×',
      wallAtOne !== null && wallAtOne.dy >= 1,
      'al menos 1px de pared (un edificio de 4px no puede tener una pared de 7)',
      wallAtOne
        ? `${wallAtOne.dy.toFixed(2)}px de pared en ${smallestBuilding.id} (${scaleAtOne.toFixed(3)} px por unidad)`
        : 'no se encontró el edificio',
    );

    // Los tonos del relieve: la cara, las dos paredes y el suelo que pisan.
    const rasterAtOne = await rasterOf(page);
    const mapBoxAtOne = await page.locator(t('map')).boundingBox();
    if (!mapBoxAtOne) throw new Error('no se pudo medir el croquis en pantalla');
    const tones = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(name).trim();
      return {
        roof: read('--color-relief-roof'),
        side: read('--color-relief-wall-side'),
        down: read('--color-relief-wall-down'),
        base: read('--color-relief-base'),
        code: read('--color-relief-code'),
      };
    });
    const ratios = {
      roofSide: contrastRatio(tones.roof, tones.side),
      sideDown: contrastRatio(tones.side, tones.down),
      wallBase: contrastRatio(tones.down, tones.base),
      codeRoof: contrastRatio(tones.code, tones.roof),
    };
    record(
      vp,
      'los tres tonos del relieve se distinguen entre sí',
      ratios.roofSide >= 1.6 && ratios.sideDown >= 1.6,
      'techo/pared >= 1.6:1 y pared/pared >= 1.6:1',
      `techo ${tones.roof} / pared ${tones.side} = ${ratios.roofSide.toFixed(2)}:1, pared ${tones.side} / pared ${tones.down} = ${ratios.sideDown.toFixed(2)}:1`,
    );
    record(
      vp,
      'la pared se separa del suelo que pisa',
      ratios.wallBase >= 1.3,
      '>= 1.3:1',
      `pared ${tones.down} / suelo ${tones.base} = ${ratios.wallBase.toFixed(2)}:1`,
    );
    record(
      vp,
      'el código se lee sobre el techo',
      ratios.codeRoof >= 4.5,
      '>= 4.5:1 (WCAG AA)',
      `código ${tones.code} / techo ${tones.roof} = ${ratios.codeRoof.toFixed(2)}:1`,
    );

    // El código del edificio: un tamaño de pantalla, no de unidades del plano.
    const codeLabel = await page.evaluate(() => {
      const text = document.querySelector('[data-building="bldg-2k"] [data-shape="code"]');
      if (!text) return null;
      const rect = text.getBoundingClientRect();
      return {
        height: rect.height,
        fontSize: parseFloat(getComputedStyle(text).fontSize),
      };
    });
    // La clave se imprime en el centro de la base del edificio: ese punto
    // esta dentro siempre, y el tejado lo tapa.
    const codeSpot = await page.evaluate(() => {
      const text = document.querySelector('[data-building="bldg-2k"] [data-shape="code"]');
      if (!text) return null;
      return { x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')) };
    });
    const expectedCode = codeSizePx(sample.polygon ?? [], scaleAtOne, sample.code);
    record(
      vp,
      'la clave se imprime dentro de su edificio',
      codeSpot === null ? expectedCode === 0 : pointInPolygon(codeSpot, sample.polygon ?? []),
      'la clave dentro de la base de la construcción (o sin clave si no cabe)',
      codeSpot
        ? `${codeSpot.x.toFixed(1)}, ${codeSpot.y.toFixed(1)}`
        : 'el edificio es demasiado pequeño para una letra',
    );

    // La clave no necesita una chapa detrás: el color sigue a la superficie
    // en la que cae (el tejado claro o la base oscura).
    const plate = await page.evaluate(() => {
      const group = document.querySelector('[data-building="bldg-2k"] [data-shape="code"]');
      return group ? group.querySelectorAll('rect').length : 0;
    });
    record(
      vp,
      'la clave no lleva chapa detrás',
      plate === 0,
      '0 rectángulos detrás de la clave',
      `${plate} rectángulo(s)`,
    );

    // La clave cabe en su edificio: si no cabe, no se dibuja. Un edificio
    // de cuatro pixeles no tiene sitio para una letra de trece.
    record(
      vp,
      'el código del edificio se dibuja solo si cabe y se lee',
      expectedCode === 0
        ? codeLabel === null
        : codeLabel !== null && codeLabel.height <= expectedCode + 1,
      expectedCode === 0
        ? 'sin código: el edificio es demasiado pequeño para una letra'
        : `una clave de ${expectedCode.toFixed(1)}px, como mucho`,
      codeLabel
        ? `${codeLabel.height.toFixed(1)}px de alto (fuente ${codeLabel.fontSize}px)`
        : 'no se encontró el código',
    );

    // Un primer plano del relieve: la misma esquina del campus a 1× y a 3×,
    // para que se vea el volumen con los ojos y no sólo con las medidas.
    // El ratón se aparta: su etiqueta tapa justo lo que se quiere ver.
    const closeUpArtwork = { x: 0.25, y: 0.15 };
    const closeUpAnchor = screenOfArtwork(rasterAtOne, closeUpArtwork);
    const sizeAtOne = page.viewportSize();
    if (!sizeAtOne) throw new Error('el navegador no dice el tamaño del viewport');
    await page.mouse.move(4, 4);
    await sleep(250);
    await takeClip('relief-1x', 21, {
      x: Math.max(0, Math.min(closeUpAnchor.x - 130, sizeAtOne.width - 260)),
      y: Math.max(0, Math.min(closeUpAnchor.y - 100, sizeAtOne.height - 200)),
      width: 260,
      height: 200,
    });

    /* ── 2c-ter. El dedo toca el tejado, y el tejado abre su edificio ── */
    // Lo que se ve es lo que se toca: el tejado es la base desplazada hacia
    // la luz, así que el punto del tejado NO está en la base de nadie.
    let roofTap = null;
    for (const zone of ZONES.filter((entry) => entry.kind === 'building')) {
      const center = roofCenter(zone, scaleAtOne);
      if (!center) continue;
      const landed = landedPoint(rasterAtOne, center);
      if (
        !within(landed.client, {
          left: mapBoxAtOne.x,
          top: mapBoxAtOne.y,
          width: mapBoxAtOne.width,
          height: mapBoxAtOne.height,
        })
      )
        continue;
      // El tejado tiene que resolver SU edificio y no estar en la base de
      // nadie: si no, el toque probaría la base y no el tejado.
      if (zoneAtPoint(landed.artwork, ZONES, { scale: scaleAtOne })?.id !== zone.id) continue;
      if (zoneAtPoint(landed.artwork, ZONES)) continue;
      const hit = await page.evaluate((spot) => {
        const element = document.elementFromPoint(spot.x, spot.y);
        return {
          pin: Boolean(element?.closest('button[aria-label^="Pin "]')),
        };
      }, landed.client);
      if (hit.pin) continue;
      roofTap = { zone, point: landed.client, artwork: landed.artwork };
      break;
    }
    record(
      vp,
      'hay un tejado visible al que se puede tocar',
      Boolean(roofTap),
      'el tejado de un edificio, en pantalla',
      roofTap
        ? `${roofTap.zone.id} en (${roofTap.point.x.toFixed(0)}, ${roofTap.point.y.toFixed(0)})`
        : 'ninguno',
    );

    if (roofTap) {
      record(
        vp,
        'el punto del tejado no está en la base de ningún edificio',
        zoneAtPoint(roofTap.artwork, ZONES, { scale: scaleAtOne })?.id === roofTap.zone.id &&
          !zoneAtPoint(roofTap.artwork, ZONES),
        'el tejado sólo existe si el volumen está extruido',
        `el tejado de ${roofTap.zone.id} resuelve ${
          zoneAtPoint(roofTap.artwork, ZONES, { scale: scaleAtOne })?.id ?? 'nada'
        } y su base no resuelve nada`,
      );

      await page.mouse.click(roofTap.point.x, roofTap.point.y);
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
      const roofDialog =
        (await page.locator('[role="dialog"]').count()) > 0
          ? await textOf(page, '[role="dialog"]')
          : '';
      record(
        vp,
        'un toque en el tejado abre ese edificio',
        roofDialog.includes(roofTap.zone.label),
        `el diálogo dice "${roofTap.zone.label}"`,
        roofDialog.slice(0, 140) ||
          `no se abrió ningún diálogo (toque en ${roofTap.point.x.toFixed(0)}, ${roofTap.point.y.toFixed(0)})`,
      );

      // El edificio que se acaba de tocar dice su nombre en el croquis: en
      // un teléfono nadie pasa el cursor por encima del plano.
      await page
        .waitForFunction(
          (id) => {
            const chip = document.querySelector(`[data-testid="zone-name-${id}"]`);
            return chip ? Number(getComputedStyle(chip).opacity) > 0.9 : false;
          },
          roofTap.zone.id,
          { timeout: 3000 },
        )
        .catch(() => {});
      const roofChip = await page.evaluate((id) => {
        const chip = document.querySelector(`[data-testid="zone-name-${id}"]`);
        return chip ? getComputedStyle(chip).opacity : '';
      }, roofTap.zone.id);
      record(
        vp,
        'al tocar una zona, el croquis dice su nombre',
        Number(roofChip) > 0.9,
        `el nombre de "${roofTap.zone.label}" a la vista`,
        `opacidad ${roofChip || 'nula'}`,
      );

      await page.keyboard.press('Escape');
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'detached' })
        .catch(() => {});
    }

    /* ── 2c-quater. La base también abre su edificio ─────────────────── */
    // La huella que asoma debajo del volumen es del mismo edificio, y no de
    // la vecina: el punto está fuera de todos los tejados.
    const base = baseSpot(ZONES, scaleAtOne, rasterAtOne);
    record(
      vp,
      'hay una base de edificio visible al que se puede tocar',
      Boolean(base),
      'un punto de la base fuera de todos los tejados',
      base
        ? `${base.zone.id} en (${base.point.x.toFixed(1)}, ${base.point.y.toFixed(1)})`
        : 'ninguno',
    );

    if (base) {
      await page.mouse.click(base.client.x, base.client.y);
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
      const baseDialog =
        (await page.locator('[role="dialog"]').count()) > 0
          ? await textOf(page, '[role="dialog"]')
          : '';
      record(
        vp,
        'un toque en la base abre ese edificio y no la vecina',
        baseDialog.includes(base.zone.label),
        `el diálogo dice "${base.zone.label}"`,
        baseDialog.slice(0, 140) || 'no se abrió ningún diálogo',
      );
      await page.keyboard.press('Escape');
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'detached' })
        .catch(() => {});
    }

    /* ── 2c-quinquies. El dedo vertical desplaza la página ───────────── */
    // El croquis sin ampliar cede el eje vertical a la página: un
    // deslizamiento que empieza sobre una zona desplaza la página, no el
    // croquis.
    await page.evaluate(() => window.scrollTo(0, 0));
    const zoneSpot = await page.evaluate(() => {
      const zone = document.querySelector<HTMLElement>('[data-zone-id="bldg-2k"]');
      if (!zone) return { x: 0, y: 0 };
      const rect = zone.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const pinsBeforeSwipe = await pinCount(page);
    await swipe(client, zoneSpot, -180);
    const scrollAfterSwipe = await page.evaluate(() => window.scrollY);
    record(
      vp,
      'un deslizamiento vertical sobre una zona desplaza la página',
      scrollAfterSwipe > 20,
      'la página se desplaza más de 20px',
      `scrollY=${scrollAfterSwipe}`,
    );
    record(
      vp,
      'el deslizamiento sobre una zona no crea un pin',
      (await pinCount(page)) === pinsBeforeSwipe,
      `${pinsBeforeSwipe} pines, sin cambios`,
      `${await pinCount(page)} pines`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));

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

    // La sombra del pin tiene que caer hacia abajo a la derecha: la misma
    // dirección en la que cae la sombra de los volúmenes del croquis.
    const pinShadow = await page.evaluate(() => {
      const pin = document.querySelector('button[aria-label^="Pin "]');
      const shadow = pin?.querySelector('[data-testid="pin-shadow"]');
      if (!pin || !shadow) return null;
      const pinBox = pin.getBoundingClientRect();
      const shadowBox = shadow.getBoundingClientRect();
      return {
        dx: shadowBox.left + shadowBox.width / 2 - (pinBox.left + pinBox.width / 2),
        dy: shadowBox.top + shadowBox.height / 2 - pinBox.bottom,
        radius: shadowBox.height / 2,
      };
    });
    record(
      vp,
      'la sombra del pin cae hacia abajo a la derecha, como la de los volúmenes',
      pinShadow !== null && pinShadow.dx > 0 && pinShadow.dy > 0 && pinShadow.radius > 0,
      'la sombra del pin a la derecha y debajo de la punta',
      pinShadow
        ? `dx=${pinShadow.dx.toFixed(1)} dy=${pinShadow.dy.toFixed(1)} radio=${pinShadow.radius.toFixed(1)}`
        : 'no se encontró la sombra',
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
      'la capa del artwork cede el gesto vertical a la página sin ampliar',
      touchAction.artwork === 'pan-y',
      'touch-action: pan-y en la capa del artwork',
      JSON.stringify(touchAction),
    );
    const zoneTouch = await page.evaluate(() => {
      const zone = document.querySelector('[data-zone-id]');
      if (!zone) return null;
      // El touch-action no se hereda: el gesto se decide por la intersección
      // del elemento con sus antepasados hasta el que desplaza la página.
      const chain: string[] = [];
      for (
        let node: Element | null = zone;
        node && node !== document.body;
        node = node.parentElement
      ) {
        chain.push(getComputedStyle(node).touchAction);
      }
      return chain;
    });
    if (zoneTouch?.includes('none')) {
      finding(
        'src/components/CampusMap.jsx (capas de zonas y pines)',
        `las zonas y los pines quedan bajo touch-action: none (cadena: ${JSON.stringify(zoneTouch)}): un deslizamiento vertical que empieza sobre una zona se lo traga el croquis en vez de desplazar la página`,
      );
    }

    /* ── 2d. La leyenda del campus: el panel que sustituye al plano ──── */
    // El plano oficial traía su leyenda impresa en la propia imagen (y su
    // columna, la que la app ya no muestra): la app la tiene como panel, con
    // su encabezado, su buscador y el enlace al plano original.
    const legendToggle = page.locator(t('zone-legend-toggle'));
    if (await legendToggle.isVisible()) await legendToggle.click();

    const legend = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="zone-legend"]');
      const heading = panel?.querySelector('h2');
      const search = panel?.querySelector('[data-testid="zone-legend-search"]');
      const searchLabel = search ? document.querySelector(`label[for="${search.id}"]`) : null;
      const link = panel?.querySelector('[data-testid="original-plan-link"]');
      return {
        exists: Boolean(panel),
        heading: heading?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        search: Boolean(search),
        searchLabel: searchLabel?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        link: Boolean(link),
        linkHref: link?.getAttribute('href') ?? '',
        linkText: link?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    record(
      vp,
      'el croquis tiene su panel de nombres',
      legend.exists,
      '1 panel zone-legend',
      legend.exists ? 'el panel está' : 'no se encontró el panel',
    );
    record(
      vp,
      'el panel de nombres tiene su encabezado',
      legend.heading === 'Nombres del campus',
      '"Nombres del campus"',
      legend.heading || 'sin encabezado',
    );
    record(
      vp,
      'el panel de nombres tiene su buscador con su etiqueta',
      legend.search && legend.searchLabel.length > 0,
      'un campo zone-legend-search con etiqueta',
      `campo=${legend.search} etiqueta="${legend.searchLabel}"`,
    );
    record(
      vp,
      'el panel de nombres ofrece el plano original',
      legend.link && legend.linkHref === '/mapa-itm.png',
      'un enlace original-plan-link a /mapa-itm.png',
      `enlace=${legend.link} href=${legend.linkHref || 'ninguno'}`,
    );
    record(
      vp,
      'el enlace al plano original se lee como una referencia',
      legend.linkText.toLowerCase().includes('plano original'),
      '"plano original"',
      legend.linkText || 'sin texto',
    );

    // La leyenda dice lo que el croquis NO dibuja: las calles vienen del
    // plano oficial y los nombres viven aquí.
    const legendText = await textOf(page, t('zone-legend'));
    record(
      vp,
      'la leyenda dice lo que el croquis no dibuja',
      /calles/i.test(legendText) && /nombres/i.test(legendText),
      'menciona las calles y los nombres',
      legendText.slice(0, 200),
    );

    // El buscador de la leyenda: "cafetería" deja una sola fila.
    await page.locator(t('zone-legend-search')).fill('cafetería');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="zone-legend"] li').length === 1,
    );
    const legendRows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="zone-legend"] li')].map((row) => ({
        id: row.querySelector('button')?.getAttribute('data-testid') ?? '',
        text: row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })),
    );
    record(
      vp,
      'buscar "cafetería" deja sólo la fila de la cafetería',
      legendRows.length === 1 && legendRows[0].id === 'zone-legend-bldg-r',
      '1 fila: zone-legend-bldg-r',
      JSON.stringify(legendRows),
    );
    record(
      vp,
      'la fila que sobrevive a la búsqueda es la de R',
      legendRows[0]?.text.includes('Cafetería'),
      'la fila menciona "Cafetería"',
      legendRows[0]?.text ?? 'ninguna fila',
    );
    await page.locator(t('zone-legend-search')).fill('');
    await take('legend', 13);
    // La leyenda está más abajo que el croquis: al leerla la página se
    // desplazó, y el croquis tiene que volver a su sitio para que el ratón
    // lo alcance.
    await page.evaluate(() => window.scrollTo(0, 0));

    /* ── 2e. El croquis se dibuja: no es una foto del plano ────────── */
    // El artwork no tiene ninguna imagen: el suelo es la escena que el
    // generador trazó desde los colores del plano oficial y los volúmenes
    // se levantan encima. El recuadro "DATOS GENERALES" del plano no puede
    // aparecer, porque no hay ninguna foto que lo traiga.
    const artworkIsVector = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
      if (!svg) return false;
      return (
        svg.querySelector('image') === null && svg.querySelectorAll('[data-ground]').length > 0
      );
    });
    record(
      vp,
      'el croquis se dibuja: el artwork no tiene ninguna imagen',
      artworkIsVector,
      '0 imágenes y el suelo de la escena presente',
      `${await page.evaluate(() => document.querySelectorAll('[data-testid="map-artwork"] image').length)} imágenes`,
    );

    /* ── 3. El croquis se puede acercar con la rueda ──────────────────── */
    // El acercamiento va primero: con el croquis entero dentro de la ventana
    // no hay por dónde arrastrarlo (el transform se queda dentro de los
    // límites), así que el gesto de arrastre sólo existe una vez ampliado.
    const zoomBefore = await artworkTransform(page);
    const mapBox = await page.locator(t('map')).boundingBox();
    if (!mapBox) throw new Error('no se pudo medir el croquis en pantalla');
    const cursor = {
      x: mapBox.x + mapBox.width / 2,
      y: mapBox.y + Math.min(120, mapBox.height / 2),
    };
    await page.mouse.move(cursor.x, cursor.y);
    const rasterBefore = await rasterOf(page);
    const layerBefore = await layerOf(page);
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
    const rasterAfter = await rasterOf(page);
    const layerAfter = await layerOf(page);
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
    const inside = (point: Spot) =>
      point.x > mapBox.x + 4 &&
      point.x < mapBox.x + mapBox.width - 4 &&
      point.y > mapBox.y + 4 &&
      point.y < mapBox.y + mapBox.height - 4;

    const candidates = ZONES.flatMap((zone) =>
      zone.box
        ? [
            {
              id: zone.id,
              label: zone.label,
              artwork: {
                x: (zone.box.x + zone.box.width / 2) / MAP_SPACE.width,
                y: (zone.box.y + zone.box.height / 2) / MAP_SPACE.height,
              },
            },
          ]
        : [],
    )
      // Dónde queda la zona con el zoom (lo dice la capa de zonas) y dónde
      // quedaba antes de acercar.
      .map((candidate) => ({
        ...candidate,
        zoomed: screenOfArtworkLayer(layerAfter, candidate.artwork),
        plain: screenOfArtworkLayer(layerBefore, candidate.artwork),
        // El toque lo resuelve la geometría del catálogo, así que sólo vale
        // una zona cuyo centro de caja cae de verdad dentro de su forma.
        resolved: zoneAtPoint(
          {
            x: candidate.artwork.x * MAP_SPACE.width,
            y: candidate.artwork.y * MAP_SPACE.height,
          },
          ZONES,
        )?.id,
      }))
      .filter(
        (candidate) =>
          candidate.resolved === candidate.id &&
          inside(candidate.zoomed) &&
          inside(candidate.plain),
      )
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
          if (element.closest('[data-testid="map-artwork"]')) return { x, y };
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
      const rasterPre = await rasterOf(page);
      const layerPre = await layerOf(page);
      const pinsBefore = await pinCount(page);
      const lostBefore = await countOf(page, t('header-lost-count'));
      await page.mouse.move(freePoint.x, freePoint.y);
      await page.mouse.down();
      await page.mouse.move(freePoint.x + 70, freePoint.y + 40, { steps: 12 });
      await page.mouse.up();
      await sleep(250);
      const after = await artworkTransform(page);
      const rasterPost = await rasterOf(page);
      const layerPost = await layerOf(page);
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

    /* ── 4b. El relieve ampliado: la pared no se aplana ───────────────── */
    // A 6× la pared del edificio tiene que medir lo mismo que a 1×: si el
    // desplazamiento se midiera en unidades del plano, el tejado se iría
    // lejos de su huella y lo que se ve dejaría de ser lo que se toca.
    const deepCursor = screenOfArtwork(await rasterOf(page), closeUpArtwork);
    await zoomTo(page, 3, deepCursor);
    const atThree = scaleOf(await artworkTransform(page));
    const rasterAtThree = await rasterOf(page);
    const anchorAtThree = screenOfArtwork(rasterAtThree, closeUpArtwork);
    const size = page.viewportSize();
    if (!size) throw new Error('el navegador no dice el tamaño del viewport');
    // El ratón se aparta: su etiqueta tapa justo lo que se quiere ver.
    await page.mouse.move(4, 4);
    await sleep(250);
    await takeClip('relief-3x', 22, {
      x: Math.max(0, Math.min(anchorAtThree.x - 130, size.width - 260)),
      y: Math.max(0, Math.min(anchorAtThree.y - 100, size.height - 200)),
      width: 260,
      height: 200,
    });
    record(
      vp,
      'el croquis llega a 3×',
      Math.abs(atThree - 3) <= 0.1,
      'escala 3',
      `escala ${atThree}`,
    );

    await zoomTo(page, 6, deepCursor);
    const wallAtSix = await visibleWall(page, smallestBuilding.id);
    record(
      vp,
      'la pared crece con el zoom',
      wallAtSix !== null && wallAtOne !== null && wallAtSix.dy > wallAtOne.dy,
      'más pared que a 1× (la pared está acotada por el tamaño del edificio)',
      wallAtSix && wallAtOne
        ? `${wallAtOne.dy.toFixed(2)}px a 1× → ${wallAtSix.dy.toFixed(2)}px a 6×`
        : 'no se encontró el edificio',
    );
    const codeAtSix = await page.evaluate(() => {
      const text = document.querySelector('[data-building="bldg-2k"] [data-shape="code"]');
      if (!text) return null;
      return text.getBoundingClientRect().height;
    });
    record(
      vp,
      'el código del edificio se lee a 6× también',
      codeAtSix !== null && codeAtSix >= 11,
      '>= 11px de alto en pantalla',
      codeAtSix === null ? 'no se encontró el código' : `${codeAtSix.toFixed(1)}px de alto`,
    );

    // Ampliado, el croquis guarda el gesto: un dedo lo mueve en los dos ejes.
    const zoomedTouch = await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="map"] [role="listbox"]')?.parentElement;
      return layer ? getComputedStyle(layer).touchAction : null;
    });
    record(
      vp,
      'ampliado, el croquis guarda el gesto',
      zoomedTouch === 'none',
      'touch-action: none en la capa del artwork',
      String(zoomedTouch),
    );

    const dragSpot = await page.evaluate(() => {
      const map = document
        .querySelector<HTMLElement>('[data-testid="map"]')
        ?.getBoundingClientRect();
      if (!map) return null;
      for (const zone of document.querySelectorAll<HTMLElement>('[data-zone-id]')) {
        const rect = zone.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        // El dedo tiene que caer dentro del croquis (donde vive la capa que
        // guarda el gesto) y no sobre un pin.
        if (x < map.left + 8 || x > map.right - 8 || y < map.top + 8 || y > map.bottom - 8) {
          continue;
        }
        const element = document.elementFromPoint(x, y);
        if (!element) continue;
        if (element.closest('button[aria-label^="Pin "]')) continue;
        return { x, y };
      }
      return null;
    });
    const beforeDrag = translationOf(await artworkTransform(page));
    if (dragSpot) await swipe(client, dragSpot, -140);
    const afterDrag = translationOf(await artworkTransform(page));
    record(
      vp,
      'un dedo mueve el croquis en vertical con el croquis ampliado',
      beforeDrag !== null && afterDrag !== null && Math.abs(afterDrag.y - beforeDrag.y) > 5,
      'el croquis se desplaza más de 5px en vertical',
      `y ${beforeDrag?.y ?? 'n/d'} → ${afterDrag?.y ?? 'n/d'}`,
    );
    record(
      vp,
      'el dedo no crea un pin al mover el croquis ampliado',
      (await pinCount(page)) === SEED_PINS,
      `${SEED_PINS} pines`,
      `${await pinCount(page)} pines`,
    );

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

    /* ── 6b. Un toque en la forma real resuelve su construcción ─────── */
    // El croquis se dibuja con las formas trazadas del plano, no con las
    // cajas: una construcción cuya forma no es su caja (una L, un patio)
    // tiene que resolver a sí misma cuando se la toca, aunque el botón de
    // su vecina la tape.
    //
    // Lo decide el catálogo: las áreas de toque de la pantalla son cajas
    // de 44px que se solapan entre sí (una construcción pequeña se
    // traga la de al lado), y sólo serán las formas de verdad cuando el
    // croquis se dibuje en SVG.
    const shaped = ZONES.filter(
      (zone): zone is Zone & { polygon: Polygon; box: Box } =>
        zone.kind === 'building' && Boolean(zone.polygon) && Boolean(zone.box),
    )
      .map((zone) => {
        const centroid = polygonCentroid(zone.polygon);
        return {
          zone,
          centroid,
          inside: centroid ? pointInPolygon(centroid, zone.polygon) : false,
          offBox: polygonArea(zone.polygon) < zone.box.width * zone.box.height,
        };
      })
      .find((entry) => entry.centroid && entry.inside && entry.offBox);
    const shapedPoint = shaped?.centroid ?? null;
    const shapedResolved = shapedPoint ? zoneAtPoint(shapedPoint, ZONES) : null;
    record(
      vp,
      'un toque en la forma real de una construcción la resuelve',
      Boolean(shaped) && shapedResolved?.id === shaped?.zone.id,
      `el toque en la forma de "${shaped?.zone.id ?? '?'}" lo resuelve`,
      shapedResolved ? `${shapedResolved.id} · ${shapedResolved.label}` : 'nada',
    );

    /* ── 6c. El toque de verdad, en el navegador ────────────────────── */
    // El botón del DOM es sólo un área de toque de 44 px y se solapa con el
    // de sus vecinos: el toque lo resuelve la geometría, así que aquí tiene
    // que salir la construcción cuya forma se tocó.
    if (!shapedPoint) throw new Error('el catálogo no tiene una construcción con forma');
    // El croquis puede venir ampliado de otra prueba: se vuelve a 1× para
    // que la construcción que se toque esté a la vista.
    await zoomTo(page, 1, deepCursor);
    await sleep(300);
    await page.locator('[data-testid="map-artwork"]').scrollIntoViewIfNeeded();
    await sleep(150);
    // La posición en pantalla sale de la matriz del propio SVG: el croquis
    // puede estar ampliado cuando se toca, y la matriz es la que sabe dónde
    // está cada punto del artwork.
    const shapedScreen = await page.evaluate(
      ([x, y]) => {
        const svg = document.querySelector<SVGSVGElement>('[data-testid="map-artwork"]');
        const matrix = svg?.getScreenCTM();
        if (!matrix) return null;
        const point = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      },
      [shapedPoint.x, shapedPoint.y],
    );
    if (!shapedScreen) throw new Error('no se pudo medir la forma en pantalla');
    await page.mouse.click(shapedScreen.x, shapedScreen.y);
    await page
      .locator('[role="dialog"]')
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    const shapedDialog =
      (await page.locator('[role="dialog"]').count()) > 0
        ? await textOf(page, '[role="dialog"]')
        : '';
    record(
      vp,
      'un toque en la forma abre el diálogo de esa construcción (no el de la vecina)',
      shapedDialog.includes(shaped?.zone.label ?? ''),
      `el diálogo dice "${shaped?.zone.label ?? ''}"`,
      shapedDialog.slice(0, 140) ||
        `no se abrió ningún diálogo (toque en ${shapedScreen.x.toFixed(0)}, ${shapedScreen.y.toFixed(0)})`,
    );
    await page.keyboard.press('Escape');
    await page
      .locator('[role="dialog"]')
      .waitFor({ state: 'detached' })
      .catch(() => {});

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
        const text = node.nodeValue ?? '';
        if (text.includes(key)) hits.push(text.trim());
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
      const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="my-report-"]')];
      const card = cards.find((node) => node.textContent?.includes(item));
      const testid = card?.getAttribute('data-testid');
      return testid ? testid.replace('my-report-', '') : null;
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
      const card = document.querySelector<HTMLElement>('[data-testid="my-report-pin-1"]');
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
        const text = (node.nodeValue ?? '').trim();
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
      const unlockButton = await page.locator(t('release-key-submit')).evaluate((node) => {
        const element = node as HTMLElement;
        return {
          label: element.getAttribute('aria-label'),
          position: getComputedStyle(element.parentElement as HTMLElement).position,
        };
      });
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

    /* ── 20. El croquis no se descarga: se dibuja ───────────────────── */
    // El croquis viaja dentro del paquete: no hay ninguna foto que pueda
    // no llegar. Si el servidor se niega a servir el raster, el mapa ni lo
    // pide y sigue en pie.
    let rasterAsked = 0;
    await page.route('**/mapa-itm-dark.png', async (route) => {
      rasterAsked += 1;
      await route.abort();
    });
    await page.reload({ waitUntil: 'commit' });
    await page.locator(t('map')).waitFor({ state: 'visible' });
    record(
      vp,
      'el croquis no pide ninguna foto y se dibuja igual',
      rasterAsked === 0 &&
        (await page.locator('[data-zone-id]').count()) > 0 &&
        (await page.locator('[data-ground]').count()) > 0 &&
        (await page.locator(t('state-error')).count()) === 0,
      '0 peticiones de fotos, > 0 zonas, > 0 formas del suelo y ningún error',
      `${rasterAsked} peticiones, ${await page.locator('[data-zone-id]').count()} zonas, ${await page.locator('[data-ground]').count()} formas, ${await page.locator(t('state-error')).count()} errores`,
    );
    await page.unroute('**/mapa-itm-dark.png');

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

    /* ── 22. Dos reportes en la misma zona: un marcador con la cuenta ── */
    // Los pines de una zona se apilan en su centro: el último pintado tapa
    // al otro y el ratón sólo alcanza a uno. Una zona con más de un reporte
    // se dibuja como UN marcador con la cuenta, y la lista de sus reportes
    // se abre y se recorre con el ratón.
    const clusterZone = ZONE_BY_ID.get('bldg-a');
    if (!clusterZone?.polygon) throw new Error('el catálogo no tiene la zona bldg-a');
    const centroid = polygonCentroid(clusterZone.polygon);
    if (!centroid) throw new Error('la zona bldg-a no tiene centro');
    const expected = artworkToPercent(centroid, MAP_SPACE);

    const publishInClusterZone = async (kind: 'lost' | 'found') => {
      await page.locator(t('picker-input')).click();
      await page.locator(t('picker-option-bldg-a')).click();
      await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
      await page
        .getByRole('button', { name: kind === 'lost' ? /Perdí algo aquí/ : /Encontré algo aquí/ })
        .click();
      await page.locator(t('report-item')).waitFor({ state: 'visible' });
      await page
        .locator(t('report-item'))
        .fill(kind === 'lost' ? CLUSTER_LOST_ITEM : CLUSTER_FOUND_ITEM);
      await page
        .locator(t('report-description'))
        .fill(kind === 'lost' ? CLUSTER_LOST_DESCRIPTION : CLUSTER_FOUND_DESCRIPTION);
      if (kind === 'found') await page.locator(t('report-blind-detail')).fill(CLUSTER_FOUND_BLIND);
      await page.locator(t('report-submit')).click();
      await page
        .locator(t('release-key-dialog'))
        .waitFor({ state: 'visible' })
        .catch(() => {});
      await page.keyboard.press('Escape');
      await page
        .locator(t('release-key-dialog'))
        .waitFor({ state: 'detached' })
        .catch(() => {});
    };

    await publishInClusterZone('lost');
    record(
      vp,
      'un reporte en una zona se dibuja como un pin suelto',
      (await clusterCount(page)) === 0 && (await pinCount(page)) === SEED_PINS + 1,
      '0 grupos y 5 pines',
      `${await clusterCount(page)} grupo(s), ${await pinCount(page)} pine(s)`,
    );

    await publishInClusterZone('found');
    const clusterMarkers = page.locator('button[data-testid^="pin-cluster-marker-"]');
    const clusterMarkersCount = await clusterMarkers.count();
    record(
      vp,
      'una zona con dos reportes se dibuja con UN marcador',
      clusterMarkersCount === 1,
      '1 marcador de grupo',
      `${clusterMarkersCount} marcador(es)`,
    );
    record(
      vp,
      'los dos reportes de la zona no se apilan en dos pines',
      (await pinCount(page)) === SEED_PINS && (await markerCount(page)) === SEED_PINS + 1,
      `${SEED_PINS} pines y ${SEED_PINS + 1} marcadores`,
      `${await pinCount(page)} pine(s), ${await markerCount(page)} marcador(es)`,
    );

    if (clusterMarkersCount === 1) {
      const clusterName = await clusterMarkers.first().getAttribute('aria-label');
      record(
        vp,
        'el marcador del grupo tiene un nombre accesible',
        clusterName === '2 objetos reportados en A · Edificio Administrativo',
        '"2 objetos reportados en A · Edificio Administrativo"',
        clusterName ?? 'sin nombre accesible',
      );
      const clusterBadge = await page.locator(t('pin-cluster-count')).innerText();
      record(
        vp,
        'el marcador del grupo lleva la cuenta de sus reportes',
        clusterBadge.trim() === '2',
        'la cuenta "2"',
        clusterBadge.trim(),
      );
      const clusterSpot = await clusterMarkers.first().evaluate((node) => ({
        left: node.style.left,
        top: node.style.top,
      }));
      record(
        vp,
        'el marcador del grupo se queda en el centro de la zona',
        Math.abs(parseFloat(clusterSpot.left) - expected.x) <= 0.05 &&
          Math.abs(parseFloat(clusterSpot.top) - expected.y) <= 0.05,
        `(${expected.x.toFixed(2)}%, ${expected.y.toFixed(2)}%)`,
        `(${clusterSpot.left}, ${clusterSpot.top})`,
      );

      // La lista del grupo: se abre con el ratón y cada reporte se alcanza
      // con el ratón.
      await clusterMarkers.first().click();
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'visible' });
      const clusterEntries = page.locator('[data-testid^="pin-cluster-entry-"]');
      record(
        vp,
        'el grupo abre la lista de sus reportes',
        (await clusterEntries.count()) === 2,
        '2 entradas en la lista',
        `${await clusterEntries.count()} entrada(s)`,
      );
      const clusterListText = (await textOf(page, t('pin-cluster-dialog'))).replace(/\s+/g, ' ');
      record(
        vp,
        'la lista dice el objeto, el tipo y la antigüedad de cada reporte',
        clusterListText.includes(CLUSTER_LOST_ITEM) &&
          clusterListText.includes(CLUSTER_FOUND_ITEM) &&
          /Perdido/.test(clusterListText) &&
          /Encontrado/.test(clusterListText) &&
          /Hace/.test(clusterListText),
        'los dos objetos, "Perdido", "Encontrado" y "Hace ..."',
        clusterListText.slice(0, 200),
      );
      await take('cluster', 14);

      await clusterEntries.filter({ hasText: CLUSTER_LOST_ITEM }).click();
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'detached' });
      await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
      const clusterDetail = await textOf(page, '[role="dialog"]');
      record(
        vp,
        'un reporte del grupo se abre con el ratón',
        clusterDetail.includes(CLUSTER_LOST_ITEM),
        `el diálogo dice "${CLUSTER_LOST_ITEM}"`,
        clusterDetail.slice(0, 140),
      );
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' });

      await clusterMarkers.first().click();
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'visible' });
      await clusterEntries.filter({ hasText: CLUSTER_FOUND_ITEM }).click();
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'detached' });
      await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
      const clusterDetail2 = await textOf(page, '[role="dialog"]');
      record(
        vp,
        'el otro reporte del grupo también se abre con el ratón',
        clusterDetail2.includes(CLUSTER_FOUND_ITEM),
        `el diálogo dice "${CLUSTER_FOUND_ITEM}"`,
        clusterDetail2.slice(0, 140),
      );
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' });

      // Y la lista se alcanza con el teclado: el foco entra en ella.
      await clusterMarkers.first().focus();
      await page.keyboard.press('Enter');
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'visible' });
      const focusedEntry = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      );
      record(
        vp,
        'la lista del grupo se alcanza con el teclado',
        focusedEntry.startsWith('pin-cluster-entry-'),
        'el foco entra en la primera entrada',
        focusedEntry || 'el foco no está en la lista',
      );
      await page.keyboard.press('Escape');
      await page.locator(t('pin-cluster-dialog')).waitFor({ state: 'detached' });
    }

    /* ── 23. El diálogo se va antes de desmontarse ──────────────────── */
    // La salida se alarga a propósito: si el panel se borrara de golpe, el
    // diálogo desaparecería en el mismo cuadro y esta comprobación no
    // tendría nada que mirar.
    await page.addStyleTag({
      content: '.animate-modal-out { animation-duration: 2s !important; }',
    });
    await page.locator('button[data-testid^="pin-cluster-marker-"]').first().click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    const entrance = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? getComputedStyle(dialog).animationName : '';
    });
    record(
      vp,
      'el diálogo entra con su animación',
      entrance.includes('modal-in'),
      'modal-in',
      entrance || 'sin animación',
    );
    await page.keyboard.press('Escape');
    await sleep(150);
    const leaving = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return 'desmontado';
      const style = getComputedStyle(dialog);
      return `${style.animationName} (${style.animationDuration})`;
    });
    record(
      vp,
      'el diálogo se va antes de desmontarse',
      leaving.includes('modal-out'),
      'modal-out',
      leaving,
    );
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    record(
      vp,
      'el diálogo se desmonta cuando termina la salida',
      true,
      'el diálogo desapareció',
      'desapareció',
    );

    /* ── 24. Con movimiento reducido el diálogo se abre y se cierra ──── */
    // El bloque de prefers-reduced-motion neutraliza todas las animaciones:
    // el diálogo entra y sale igual, pero sin duración.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('button[data-testid^="pin-cluster-marker-"]').first().click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    const reducedOpened = (await page.locator('[role="dialog"]').count()) === 1;
    const reducedDuration = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? getComputedStyle(dialog).animationDuration : '';
    });
    await take('reduced-motion', 24);
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    record(
      vp,
      'con movimiento reducido el diálogo se abre y se cierra',
      reducedOpened,
      '1 diálogo abierto y cerrado',
      reducedOpened ? `se abrió y se cerró (${reducedDuration})` : 'no se abrió',
    );
    await page.emulateMedia({ reducedMotion: null });

    /* ── 3c. Las etiquetas del croquis no crecen con el zoom ───────── */
    // El nombre del pin y el de la zona son etiquetas, no arte: si crecen
    // con el croquis, una etiqueta acaba siendo una losa que tapa el mapa.
    const pinLabel = page.locator('[data-testid="pin-label"]').first();
    const labelBefore = await pinLabel.boundingBox();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('el navegador no dice el tamaño del viewport');
    const zoomCursor = { x: viewport.width / 2, y: viewport.height / 2 };
    await zoomTo(page, 4, zoomCursor);
    const labelAfter = await pinLabel.boundingBox();
    record(
      vp,
      'la etiqueta del pin no crece con el zoom',
      labelBefore !== null &&
        labelAfter !== null &&
        Math.abs(labelAfter.width - labelBefore.width) <= 1,
      'el mismo ancho a 1x y a 4x',
      labelBefore && labelAfter
        ? `${labelBefore.width.toFixed(1)}px → ${labelAfter.width.toFixed(1)}px`
        : 'no se encontró la etiqueta',
    );
    // Y la etiqueta se dobla antes de salirse: no hay una losa que cruce
    // el borde de la ventana.
    const labelWidth = await page.evaluate(() => {
      const label = document.querySelector('[data-testid="pin-label"]');
      return label ? label.getBoundingClientRect().width : 0;
    });
    record(
      vp,
      'la etiqueta del pin no es más ancha que la ventana',
      labelWidth > 0 && labelWidth <= Math.min(720, 0.72 * viewport.width) + 1,
      `<= ${Math.min(720, Math.round(0.72 * viewport.width))}px`,
      `${labelWidth.toFixed(1)}px`,
    );
    await zoomTo(page, 1, zoomCursor);

    /* ── 3d. Con un diálogo abierto el croquis no se mueve ──────────── */
    // El detalle de un pin es un diálogo: mientras está abierto, la rueda
    // belongs to the dialog, not to the map behind it.
    await page.locator('button[aria-label^="Pin "]').first().click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
    const scaleWithDialog = scaleOf(await artworkTransform(page));
    await page.mouse.move(zoomCursor.x, zoomCursor.y);
    await page.mouse.wheel(0, -400);
    await sleep(300);
    const scaleAfterWheel = scaleOf(await artworkTransform(page));
    record(
      vp,
      'con un diálogo abierto el croquis no se amplía',
      Math.abs(scaleAfterWheel - scaleWithDialog) <= 0.01,
      'la escala no cambia',
      `${scaleWithDialog.toFixed(2)} → ${scaleAfterWheel.toFixed(2)}`,
    );
    await page.keyboard.press('Escape');
    await page
      .locator('[role="dialog"]')
      .waitFor({ state: 'detached' })
      .catch(() => {});

    return { screenshots };
  } finally {
    await context.close();
  }
}

/* ──────────────────────────────── Informe ──────────────────────────────── */

function printReport(): void {
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
  for (const item of findings) console.log(`  ${item}`);
  console.log(line);
}

/* ─────────────────────────────────── Main ─────────────────────────────────── */

async function main(): Promise<void> {
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
