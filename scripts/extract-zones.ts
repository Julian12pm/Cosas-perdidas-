#!/usr/bin/env node
/**
 * Generates the addressable zone catalogue for the campus map from the official
 * raster plan (`public/mapa-itm.png`, 846 x 647 px).
 *
 * The plan is a scanned JPEG, so every colour is noisy: the script classifies
 * pixels into the plan's semantic layers, takes connected components per
 * layer, and then binds the printed codes read off the plan to those boxes.
 *
 * Outputs:
 *   src/map/zones.ts   - the catalogue (deterministic order)
 *   src/map/scene.ts   - the ground of the map: the campus traced from the
 *                         plan's own colour classes, one shape per layer
 *   public/zones-debug.png - the plan with every detected box drawn and labelled
 *
 * Measured on the current raster: 53 orange footprints, of which 52 carry a
 * printed code (the legend declares 52 constructions) and 1 is an unlabelled
 * covered walkway; plus 5 parking lots (declares 5), 11 meeting points
 * (declares 10), 20 internet modules (declares 14) and 1 athletics track. The
 * plan draws more symbols than its own legend counts.
 *
 * Run with: vp exec node scripts/extract-zones.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import type { Zone } from '../src/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = resolve(ROOT, 'public/mapa-itm.png');
const ZONES_OUT = resolve(ROOT, 'src/map/zones.ts');
const SCENE_OUT = resolve(ROOT, 'src/map/scene.ts');
const DEBUG_OUT = resolve(ROOT, 'public/zones-debug.png');

const MAP_WIDTH = 846;
const MAP_HEIGHT = 647;

/*
 * The artwork is the crop of the plan: the legend column, the title card
 * and the crest live past x = 700. The crop starts at x = 0, so the
 * artwork's origin does NOT move — every coordinate of the catalogue and
 * every shape of the scene stays valid and only the canvas width changes.
 */
const CROP_WIDTH = 700;

/* ------------------------------------------------------------------ *
 * Legend of the plan, transcribed from the right-hand panel of the
 * raster (`public/mapa-itm.png`, x 706..846). 52 entries, matching the
 * "52 CONSTRUCCIONES" line of the "DATOS GENERALES" box.
 * ------------------------------------------------------------------ */
const LEGEND = {
  A: 'Edificio Administrativo',
  B: 'Laboratorio de Química Analítica',
  C: 'Coordinación de Inglés',
  CH: 'Deptos. Ing. Industrial e Ing. Bioquímica',
  D: 'Laboratorio de Ingeniería Bioquímica',
  E: 'Aulas y Taller de Dibujo',
  F: 'Sala Audiovisual N° 1 y Aulas',
  G: 'Laboratorio Ing. Mecánica 1 e Ing. Eléctrica',
  H: 'Unidad Deportiva y Tribunas',
  I: 'Depto. de Sistemas y Cómputo',
  J: 'Aulas de Titulación y PRADHE',
  K: 'Aulas y Delegación Sindical',
  L: 'Aulas Licenciatura Administración',
  LL: 'Centro de Negocios',
  M: 'Depto. Económico Administrativo',
  Ñ: 'Laboratorio de Ingeniería Bioquímica',
  N: 'Laboratorio Instrumentación Analítica',
  O: 'Laboratorio Químico Biológico',
  P: 'Laboratorio de Física',
  Q: 'Aulas Electrónica',
  R: 'Cafetería',
  S: 'Depto. de Recursos Materiales y Servicios',
  S1: 'Consejo Estudiantil',
  S2: 'Comedor para trabajadores',
  S3: 'Cátedra Demostrativa (laboratorio)',
  T: 'Laboratorio de Ingeniería Mecánica II',
  U: 'Gimnasio Auditivo',
  V: 'Depto. de Actividades extracurriculares',
  W: 'Editorial',
  X: 'Comedor estudiantil',
  Y: 'Departamento de Electrónica',
  Z: 'Aulas de Eléctrica',
  AA: 'Depto. de Ing. Eléctrica',
  AB: 'Cátedra de Ing. Eléctrica',
  AC: 'Depto. de Ciencias Básicas',
  AD: 'Cátedra para Prof. de Ciencias Básicas',
  AE: 'Laboratorio de Maestría en Electrónica',
  AF: 'Centro de Información (Biblioteca)',
  AG: 'Educ. a Dist., C. Cómputo, Posg. Mecánica',
  AH: 'Departamento de Bioquímica y Laboratorios',
  '2A': 'Depto. Ing. Mecánica y Prog. en Materiales',
  '2B': 'Laboratorio de Fusión al Vacío',
  '2C': 'Almacén de Materias Primas',
  '2D': 'Laboratorio de Fundición y Trat. Térmicos',
  '2E': 'Aula',
  '2F': 'Depto. de Ing. en Materiales',
  '2G': 'Lab. de análisis Químicos y Metalúrgicos',
  '2H': 'Laboratorio de Materiales',
  '2J': 'Laboratorio de Rayos X',
  '2K': 'Aula',
  '3A': 'Laboratorio Posgrado en Eléctrica',
  '3B': 'Cubículos Doctorado en Eléctrica',
};

/* ------------------------------------------------------------------ *
 * Printed code anchors: a point that sits on the code label printed
 * inside the corresponding building, read off the raster by eye. The
 * script cannot read text, so this is the hand-verified bridge between
 * a detected colour blob and its printed code.
 * ------------------------------------------------------------------ */
const PRINTED_CODES: [string, number, number][] = [
  ['2K', 61, 56],
  ['2J', 103, 86],
  ['2G', 141, 112],
  ['2F', 178, 98],
  ['2H', 99, 115],
  ['2E', 166, 140],
  ['2D', 120, 148],
  ['2C', 110, 169],
  ['2B', 128, 173],
  ['2A', 85, 208],
  ['CH', 366, 108],
  ['AG', 472, 125],
  ['B', 327, 137],
  ['C', 384, 135],
  ['A', 285, 188],
  ['D', 368, 162],
  ['H', 480, 230],
  ['E', 352, 198],
  ['G', 400, 230],
  ['S3', 424, 212],
  ['F', 335, 229],
  ['I', 340, 265],
  ['J', 270, 259],
  ['K', 340, 296],
  ['L', 192, 286],
  ['Ñ', 242, 333],
  ['M', 148, 348],
  ['N', 199, 348],
  ['O', 293, 330],
  ['P', 263, 347],
  ['LL', 295, 361],
  ['R', 331, 370],
  ['V', 358, 377],
  ['W', 369, 366],
  ['Q', 461, 335],
  ['Z', 386, 375],
  ['AA', 410, 367],
  ['AF', 549, 391],
  ['AE', 505, 386],
  ['Y', 472, 388],
  ['S', 170, 373],
  ['S1', 184, 398],
  ['S2', 126, 405],
  ['U', 280, 419],
  ['T', 210, 417],
  ['X', 366, 403],
  ['AB', 399, 413],
  ['AH', 417, 454],
  ['AC', 372, 442],
  ['AD', 372, 466],
  ['3A', 576, 555],
  ['3B', 618, 520],
];

/**
 * A printed code label cuts its own construction into separate orange blobs,
 * so a building can arrive as two or three pieces. These fragments carry no
 * code of their own; each belongs to the labelled construction named here.
 * The point sits inside the fragment and was read off the plan by eye.
 */
const BUILDING_FRAGMENTS = [
  { code: '2H', at: [113, 115] },
  { code: 'K', at: [320, 295] },
  { code: 'U', at: [247, 420] },
];

/**
 * Unit bands, derived from the three unit title areas of the plan:
 * "UNIDAD METAL MECÁNICA" (top-left), "UNIDAD CENTRAL" (top-centre) and
 * "UNIDAD POSGRADO EN ELÉCTRICA" (bottom-right).
 */
const UNIT_BANDS = {
  'metal-mecanica': { x: 95, y: 17, maxX: 200, maxY: 240 },
  central: { x: 400, y: 17 },
  posgrado: { x: 625, y: 471, minX: 545, minY: 480 },
};

/**
 * The plan's own "DATOS GENERALES" box: the legend of the plan, printed on
 * the artwork with its own colour samples (52 CONSTRUCCIONES, 5
 * ESTACIONAMIENTOS, 10 PUNTOS DE REUNIÓN, 14 MÓDULOS DE INTERNET).
 *
 * The app has a real legend panel — a searchable list of names — so the
 * printed one would contradict it: two legends, two truths. The generator
 * paints the box over with the ground of the page.
 */
const DATOS_GENERALES_BOX: PixelBox = { x: 45, y: 515, width: 175, height: 95, area: 0 };

/*
 * Las palabras del plano que son lo bastante grandes para ser lineas: los
 * nombres de las unidades en la banda de arriba, la rosa de los vientos y el
 * titulo del posgrado. La app los nombra en su leyenda, asi que el plano
 * no los dice.
 */
const BLANKED_WORDS: PixelBox[] = [
  { x: 0, y: 0, width: 700, height: 33, area: 0 },
  { x: 585, y: 0, width: 80, height: 66, area: 0 },
  { x: 612, y: 410, width: 88, height: 52, area: 0 },
];

/**
 * Regions of the raster that are map furniture, not campus content: the
 * right-hand legend panel, the "DATOS GENERALES" box, the "PLANO GENERAL
 * CAMPUS ITM N°1" card, the ITM logo and the "POZO DE AGUA" callout.
 */
const EXCLUDED_REGIONS = [
  { x: 700, y: 0, width: 146, height: 647 }, // legend panel + title card + logo
  DATOS_GENERALES_BOX, // DATOS GENERALES box (the plan's own legend)
  { x: 258, y: 557, width: 48, height: 25 }, // POZO DE AGUA callout
];

/**
 * Parking lots. The lots are drawn with a stippled/hatched paving texture
 * that is not separable from the street network by colour alone (the street
 * mesh and the western lots share the same grey ramp), so each lot is
 * located by the region it occupies and the box is measured from the paving
 * pixels inside. The eastern lot (3) is drawn with a brick hatch instead,
 * which does not leak into the street mesh: there the box is the biggest
 * patch of brick inside the region.
 */
const PARKING_REGIONS = [
  { code: '1', name: 'Estacionamiento 1', x: 58, y: 74, width: 30, height: 110 },
  { code: '2', name: 'Estacionamiento 2', x: 84, y: 40, width: 92, height: 34 },
  { code: '3', name: 'Estacionamiento 3', x: 620, y: 552, width: 70, height: 48 },
  { code: '4', name: 'Estacionamiento 4', x: 276, y: 460, width: 124, height: 55 },
  { code: '5', name: 'Estacionamiento 5', x: 316, y: 58, width: 168, height: 46 },
];

/* ------------------------------------------------------------------ *
 * Pixel classification
 * ------------------------------------------------------------------ */
const png = PNG.sync.read(readFileSync(MAP_PATH));
if (png.width !== MAP_WIDTH || png.height !== MAP_HEIGHT) {
  throw new Error(`unexpected map size ${png.width}x${png.height}`);
}

/** Una máscara de píxeles: 1 donde el píxel es de la capa, 0 donde no. */
type Mask = Uint8Array;

/** Un píxel del plan, con sus coordenadas. */
type Pixel = [number, number];

/** Los tres canales de un píxel. */
type Rgb = [number, number, number];

/** Una caja en los píxeles del plan, con el área que cubre. */
interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

/** Un componente: los píxeles que lo forman y sus límites. */
interface Component {
  pixels: Pixel[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** La zona que el generador escribe: la del catálogo, con el área de su caja. */
interface GeneratedZone extends Omit<Zone, 'box' | 'polygon' | 'fragments'> {
  box: PixelBox;
  polygon: Pixel[];
  fragments?: Pixel[][];
}

/** Una construcción del catálogo: su caja, su código y las piezas que la forman. */
interface Building extends PixelBox {
  index: number;
  pixels: Pixel[];
  dilated?: Pixel[];
  code: string | null;
  members: Blob[];
}

/** Una mancha de una capa: su caja, sus píxeles y el índice que la nombra. */
interface Blob extends PixelBox {
  index: number;
  pixels: Pixel[];
  dilated?: Pixel[];
}

const { width: W, height: H, data } = png;
const at = (x: number, y: number) => (W * y + x) << 2;
const rgb = (x: number, y: number): Rgb => {
  const i = at(x, y);
  return [data[i], data[i + 1], data[i + 2]];
};

// Orange building fill: the swatch of "52 CONSTRUCCIONES" (249,166,74).
const isBuildingFill = (r: number, g: number, b: number) =>
  r >= 232 && g >= 148 && g <= 186 && b <= 98 && r - b >= 135 && g - b >= 52;

// Tan running-track surface of the athletics oval: (208,171,100).
const isTrackFill = (r: number, g: number, b: number) =>
  r >= 196 && r <= 222 && g >= 158 && g <= 184 && b >= 88 && b <= 116 && r - b >= 70 && g - b >= 42;

// Muted dark green of the "10 PUNTOS DE REUNIÓN" cross: ~(93,129,114).
const isMeetingPoint = (r: number, g: number, b: number) =>
  r >= 80 &&
  r <= 150 &&
  g >= 110 &&
  g <= 160 &&
  b >= 95 &&
  b <= 148 &&
  g - r >= 20 &&
  g - b >= 6 &&
  g - b <= 26;

// Saturated green/teal fill of the "14 MÓDULOS DE INTERNET" squares: the
// plain (0,163,80) blocks and the framed (89,169,136) cores both qualify.
const isInternetModule = (r: number, g: number, b: number) =>
  r <= 130 && g >= 120 && g <= 205 && g - r >= 33 && g - b >= 5;

// Paving: the stipple of the parking lots plus the brick hatching used for
// the eastern lots.
const isPaving = (r: number, g: number, b: number) =>
  (Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 150 && r <= 248) ||
  (r >= 175 && r <= 235 && r - g >= 40 && r - g <= 95 && g - b >= 5 && g - b <= 55);

/* --- the classes of the plan ------------------------------------- *
 * The plan is classified per CLASS, never per pixel: these predicates
 * are the ones that decide which class a pixel belongs to.
 * ------------------------------------------------------------------ */

// The grey half of the paving: the street mesh and the stippled lots.
const isPavingGrey = (r: number, g: number, b: number) =>
  Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 150 && r <= 248;

// The brick half of the paving: the eastern lots and the patios.
const isPavingBrick = (r: number, g: number, b: number) =>
  r >= 175 && r <= 235 && r - g >= 40 && r - g <= 95 && g - b >= 5 && g - b <= 55;

// Any grey linework of the plan, from the darkest street edge to the
// softest hairline: the boundaries, the area outlines and the hatch.
const isGreyLine = (r: number, g: number, b: number) =>
  Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 118 && r <= 248;

// The black of the plan: the printed text, the labels and the drop shadow
// the plan draws under every construction.
const isInk = (r: number, g: number, b: number) =>
  Math.max(r, g, b) < 125 && Math.max(r, g, b) - Math.min(r, g, b) < 45;

// The lawns: the light green fields of the campus.
const isLawnGreen = (r: number, g: number, b: number) =>
  r >= 175 &&
  r <= 235 &&
  g >= 205 &&
  g <= 245 &&
  b >= 170 &&
  b <= 215 &&
  g - r >= 15 &&
  g - b >= 20;

// The sports pitches: the saturated grass of the athletics field and of the
// football pitch, plus the green strips that line the avenues.
const isFieldGreen = (r: number, g: number, b: number) =>
  r >= 100 && r <= 180 && g >= 160 && g <= 225 && b <= 125 && g - r >= 35 && g - b >= 65;

// The warm hatch of the plan: the brick of the eastern lots and patios, the
// salmon frames of the internet modules and the magenta of a few symbols.
const isWarmHatch = (r: number, g: number, b: number) =>
  r >= 140 && r <= 240 && r - g >= 38 && r - g <= 110 && g - b >= -90 && g - b <= 60;

// The cyan of the plan: the turquoise courts and the blue cores of the
// internet module symbols.
const isCyanPaint = (r: number, g: number, b: number) =>
  b >= 180 && b - r >= 40 && g >= 120 && g - b >= -40;

const inExcluded = (x: number, y: number): boolean =>
  EXCLUDED_REGIONS.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

/** True when the point falls inside a rectangle. */
const inBox = (x: number, y: number, box: PixelBox): boolean =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;

/* ------------------------------------------------------------------ *
 * Connected components
 * ------------------------------------------------------------------ */
function dilate(mask: Mask, radius: number): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          out[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
}

function components(mask: Mask): Component[] {
  const seen = new Uint8Array(W * H);
  const found: Component[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || seen[i]) continue;
      const stack: Pixel[] = [[x, y]];
      seen[i] = 1;
      const pixels: Pixel[] = [];
      while (stack.length) {
        const popped = stack.pop();
        if (!popped) break;
        const [cx, cy] = popped;
        pixels.push([cx, cy]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (mask[ni] && !seen[ni]) {
              seen[ni] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }
      const xs = pixels.map((p) => p[0]);
      const ys = pixels.map((p) => p[1]);
      found.push({
        pixels,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      });
    }
  }
  return found;
}

/** Box of the original (undilated) pixels of a component. */
function boxOf(component: Component, mask: Mask): PixelBox | null {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  let area = 0;
  for (const [x, y] of component.pixels) {
    if (!mask[y * W + x]) continue;
    area++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return area > 0
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area }
    : null;
}

/**
 * A building drawn in the plan can be split by its printed code label or by
 * the black drop shadow, so neighbouring blobs of the same colour that almost
 * touch belong to the same construction. A blob is only joined when it carries
 * no printed code of its own and the neighbour does, and the distance is
 * measured between the real pixels: neighbouring buildings have overlapping
 * bounding boxes but are separated by a street.
 */
/**
 * Merge boxes that overlap in both axes: the frame of a symbol and the green
 * core inside it describe the same point of the plan.
 */
function mergeOverlapping(boxes: PixelBox[]): PixelBox[] {
  const list = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (boxOverlap(a, b) <= 0) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        list[i] = {
          x,
          y,
          width: Math.max(a.x + a.width, b.x + b.width) - x,
          height: Math.max(a.y + a.height, b.y + b.height) - y,
          area: a.area + b.area,
        };
        list.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return list;
}

const boxOverlap = (a: PixelBox, b: PixelBox): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/* ------------------------------------------------------------------ *
 * Layer extraction
 * ------------------------------------------------------------------ */

// --- buildings: orange fill -----------------------------------------
const buildingMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isBuildingFill(r, g, b)) buildingMask[y * W + x] = 1;
  }
}
// Dilating by one pixel bridges the one-pixel gaps left by the printed code
// labels without fusing neighbouring constructions.
const buildingBlobs: Blob[] = components(dilate(buildingMask, 1))
  .map((c) => {
    const box = boxOf(c, buildingMask);
    if (!box) return null;
    // `pixels` are the pixels of the orange fill and `dilated` the whole
    // component: the footprint is traced from the second one (the code
    // printed over the construction closes the holes of the first one) and
    // the box is measured on the first one.
    return {
      ...box,
      index: 0,
      pixels: c.pixels.filter(([x, y]) => buildingMask[y * W + x]),
      dilated: c.pixels,
    };
  })
  .filter((b): b is NonNullable<typeof b> => Boolean(b))
  .filter((b) => b.area >= 15 && b.width >= 4 && b.height >= 3)
  .filter((b) => !inExcluded(b.x, b.y) && !inExcluded(b.x + b.width - 1, b.y + b.height - 1))
  .filter((b) => b.x < 700)
  .map((b, index) => ({ ...b, index }));

// The printed code of a building is the anchor that binds it: a blob that
// carries one is a complete construction, a blob without one is a fragment of
// the labelled building it touches.
const codeOfBlob = new Map<number, string>();
const blobOfCode = new Map<string, number>();
const unplacedAnchors: [string, number, number][] = [];
for (const [code, ax, ay] of PRINTED_CODES) {
  const blob = buildingBlobs.find(
    (b) => ax >= b.x && ax < b.x + b.width && ay >= b.y && ay < b.y + b.height,
  );
  if (!blob) {
    unplacedAnchors.push([code, ax, ay]);
    continue;
  }
  if (codeOfBlob.has(blob.index)) continue;
  codeOfBlob.set(blob.index, code);
  blobOfCode.set(code, blob.index);
}

// Fragments join the labelled construction they belong to.
const groups = new Map<number, Blob[]>();
for (const blob of buildingBlobs) {
  if (codeOfBlob.has(blob.index)) groups.set(blob.index, [blob]);
}
const groupBox = (members: Blob[]): PixelBox => {
  const x = Math.min(...members.map((m) => m.x));
  const y = Math.min(...members.map((m) => m.y));
  const right = Math.max(...members.map((m) => m.x + m.width));
  const bottom = Math.max(...members.map((m) => m.y + m.height));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    area: members.reduce((total, m) => total + m.area, 0),
  };
};
for (const fragment of BUILDING_FRAGMENTS) {
  const [fx, fy] = fragment.at;
  const piece = buildingBlobs.find(
    (b) => fx >= b.x && fx < b.x + b.width && fy >= b.y && fy < b.y + b.height,
  );
  const host = buildingBlobs.find((b) => codeOfBlob.get(b.index) === fragment.code);
  if (!piece || !host) {
    unplacedAnchors.push([fragment.code, fx, fy]);
    continue;
  }
  const members = groups.get(host.index);
  if (members && !members.includes(piece)) members.push(piece);
}
// Orange structures the plan does not label stay in the catalogue without a
// code: they are real footprints the legend does not name.
for (const blob of buildingBlobs) {
  if ([...groups.values()].some((members) => members.includes(blob))) continue;
  groups.set(blob.index, [blob]);
}

const buildingBoxes: Building[] = [...groups.values()].map((members) => {
  const box = groupBox(members);
  const coded = members.find((m) => codeOfBlob.has(m.index));
  return {
    ...box,
    index: coded?.index ?? members[0]?.index ?? 0,
    pixels: members.flatMap((m) => m.pixels),
    area: members.reduce((sum, m) => sum + m.area, 0),
    code: coded ? (codeOfBlob.get(coded.index) ?? null) : null,
    // The members carry their pixels: the two safe points are kept out
    // of the ground and the renderer paints them with the brand amber, so
    // the generator needs to know exactly which pixels belong to them.
    members,
  };
});

/* ------------------------------------------------------------------ *
 * Footprints: the shape the plan draws
 *
 * The orange fill of the plan IS the shape of the construction, and
 * the generator already knows which pixel belongs to which building.
 * The footprint is therefore TRACED from those pixels, never drawn by
 * hand: a hand-traced vector was already rejected for this project
 * because it produced an unfaithful redraw.
 *
 * A building is a component of the orange fill DILATED by one pixel:
 * the dilation is what bridges the code the plan prints over the
 * construction, whose strokes are one or two pixels wide. The
 * footprint of that component is:
 *
 *   1. the component with its holes filled: the printed code is a HOLE
 *      of the orange fill and the footprint ignores it, so the shape
 *      the plan draws is the shape the footprint carries,
 *   2. eroded by one pixel, which takes the border back: the outline
 *      lands on the orange and NOT on the anti-aliased rim around it,
 *      which is the trick the boxes of the catalogue already use,
 *   3. traced along the cracks between the pixels and simplified.
 *
 * The drop shadow the plan paints under every construction is black
 * and touches the paper: it is never part of the orange, so it never
 * reaches the footprint.
 *
 * The constructions the plan cuts in half with their own label arrive
 * in pieces: every piece is kept, and the biggest one is the primary
 * shape.
 * ------------------------------------------------------------------ */

/**
 * The tolerance of the simplification, in pixels of the plan.
 *
 * One pixel is the smallest distance the plan can show: it is the
 * width of the printed strokes and the height of the stair-steps of
 * the scan, so a larger tolerance would erase real corners of the
 * buildings and a smaller one would only keep the noise of the JPEG.
 * The vertices of a simplified ring are always vertices of the traced
 * ring, so the simplified shape never leaves the box of its building.
 */
const SIMPLIFY_TOLERANCE = 1;

/** The signed area of a ring; the outline of a shape runs clockwise. */
function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

/**
 * The erosion of a set of pixels by one: the shape without its border.
 * It is what takes the one pixel of dilation back, so the outline lands
 * on the orange and not on the rim the scan paints around it.
 */
function erodePixels(pixels: Pixel[]): Pixel[] {
  const inside = new Set(pixels.map(([x, y]) => `${x},${y}`));
  const out: Pixel[] = [];
  for (const [x, y] of pixels) {
    let solid = true;
    for (let dy = -1; dy <= 1 && solid; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!inside.has(`${x + dx},${y + dy}`)) {
          solid = false;
          break;
        }
      }
    }
    if (solid) out.push([x, y]);
  }
  return out;
}

/** The pixels the outline of a shape closes around: its holes. */
function fillHoles(pixels: Pixel[]): Pixel[] {
  if (!pixels.length) return pixels;
  const inside = new Set(pixels.map(([x, y]) => `${x},${y}`));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pixels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const outside = new Set<string>();
  const stack: Pixel[] = [];
  for (let x = minX; x <= maxX; x++) stack.push([x, minY], [x, maxY]);
  for (let y = minY; y <= maxY; y++) stack.push([minX, y], [maxX, y]);
  while (stack.length) {
    const popped = stack.pop();
    if (!popped) break;
    const [x, y] = popped;
    if (x < minX || y < minY || x > maxX || y > maxY) continue;
    const key = `${x},${y}`;
    if (outside.has(key) || inside.has(key)) continue;
    outside.add(key);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const filled = [...pixels];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      if (!inside.has(key) && !outside.has(key)) filled.push([x, y]);
    }
  }
  return filled;
}

/** The connected pieces of a set of pixels, four neighbours each. */
function connectedPieces(pixels: Pixel[]): Pixel[][] {
  const remaining = new Map<string, Pixel>();
  for (const [x, y] of pixels) remaining.set(`${x},${y}`, [x, y]);
  const pieces: Pixel[][] = [];
  while (remaining.size) {
    const entry = remaining.entries().next().value;
    if (!entry) break;
    const [startKey, start] = entry;
    remaining.delete(startKey);
    const piece: Pixel[] = [start];
    const stack: Pixel[] = [start];
    while (stack.length) {
      const popped = stack.pop();
      if (!popped) break;
      const [x, y] = popped;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const key = `${x + dx},${y + dy}`;
        const next = remaining.get(key);
        if (!next) continue;
        remaining.delete(key);
        piece.push(next);
        stack.push(next);
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

/**
 * The outline of a shape, followed along the cracks between its
 * pixels: the ring is a list of corners, so it lives in the same
 * units as the plan. The interior stays on the right of every edge,
 * so the outline of a shape runs clockwise and its holes the other
 * way.
 */
function traceOutline(mask: Mask): Pixel[][] {
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;

  const outgoing = new Map<number, number[][]>();
  const link = (fromX: number, fromY: number, toX: number, toY: number) => {
    const key = fromY * W + fromX;
    const edge = [toX, toY, toX - fromX, toY - fromY];
    const list = outgoing.get(key);
    if (list) list.push(edge);
    else outgoing.set(key, [edge]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!has(x, y - 1)) link(x, y, x + 1, y);
      if (!has(x + 1, y)) link(x + 1, y, x + 1, y + 1);
      if (!has(x, y + 1)) link(x + 1, y + 1, x, y + 1);
      if (!has(x - 1, y)) link(x, y + 1, x, y);
    }
  }

  const pending = new Map([...outgoing].map(([key, list]) => [key, [...list]]));
  const takeEdge = (key: number, dx: number, dy: number) => {
    const list = pending.get(key);
    if (!list?.length) return null;
    // The interior hugs the right: the sharpest turn to the right comes
    // first, and the corner of a shape that only touches itself in one
    // point is cut instead of crossed.
    const right = [-dy, dx];
    const left = [dy, -dx];
    const order = [right, [dx, dy], left, [-dx, -dy]];
    for (const [ox, oy] of order) {
      const index = list.findIndex((edge) => edge[2] === ox && edge[3] === oy);
      if (index !== -1) return list.splice(index, 1)[0];
    }
    return null;
  };

  const rings: Pixel[][] = [];
  for (const startKey of outgoing.keys()) {
    while (pending.get(startKey)?.length) {
      const first = pending.get(startKey)?.shift();
      if (!first) break;
      const ring: Pixel[] = [];
      let key = startKey;
      let edge: number[] = first;
      for (;;) {
        const atX = key % W;
        const atY = (key - atX) / W;
        ring.push([atX, atY]);
        const next = takeEdge(edge[1] * W + edge[0], edge[2], edge[3]);
        if (!next) break;
        if (next[1] * W + next[0] === startKey) break;
        key = next[1] * W + next[0];
        edge = next;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** The squared distance of a point to a segment. */
function segmentDistance(point: Pixel, start: Pixel, end: Pixel): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  if (length === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  }
  let t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length;
  t = Math.max(0, Math.min(1, t));
  const px = start[0] + t * dx;
  const py = start[1] + t * dy;
  return (point[0] - px) ** 2 + (point[1] - py) ** 2;
}

/** The Douglas-Peucker simplification of an open chain of points. */
function simplifyChain(points: Pixel[], tolerance: number): Pixel[] {
  if (points.length < 3) return [...points];
  const limit = tolerance * tolerance;
  const keep = Array.from({ length: points.length }, () => false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const popped = stack.pop();
    if (!popped) break;
    const [first, last] = popped;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistance(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (worst > limit && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * The simplified outline of a shape. A ring is closed, so it is
 * simplified as two chains between the point and the point of the ring
 * that is the furthest away from it: the ends of a chain drag the
 * shape towards the straight line that joins them.
 */
function simplifyRing(ring: Pixel[], tolerance: number): Pixel[] {
  if (ring.length < 4) return [...ring];
  let far = 1;
  let best = -1;
  for (let index = 1; index < ring.length; index++) {
    const distance = (ring[index][0] - ring[0][0]) ** 2 + (ring[index][1] - ring[0][1]) ** 2;
    if (distance > best) {
      best = distance;
      far = index;
    }
  }
  const first = simplifyChain(ring.slice(0, far + 1), tolerance);
  const second = simplifyChain([...ring.slice(far), ring[0]], tolerance);
  const simplified = [...first, ...second.slice(1, -1)];
  const cleaned = simplified.filter(
    (point, index) =>
      index === 0 || point[0] !== simplified[index - 1][0] || point[1] !== simplified[index - 1][1],
  );
  return cleaned.length >= 3 && Math.abs(ringArea(cleaned)) > 0 ? cleaned : ring;
}

/**
 * The footprint of a construction: the shape the plan draws, cleaned.
 *
 * The plan prints the code of a construction OVER it, so the code is a
 * HOLE of the orange fill, and the plan draws its own offset shadow next
 * to it, so the shadow is a PIECE of the construction's own blobs. A
 * morphological closing of the construction's own blobs removes both in
 * one operation: the strokes of the code and the notches the plan cuts
 * are thinner than the closing's radius, so the closing heals them.
 *
 * The closing runs PER CONSTRUCTION, never over the whole mask, so two
 * buildings that almost touch can never merge. Its radius is a quarter
 * of the construction's own smaller side, capped: a big building gets a
 * wide healing and a small one a narrow one.
 */
const FOOTPRINT_CLOSE_MIN = 1;
const FOOTPRINT_CLOSE_MAX = 5;

/**
 * A fragment smaller than this in its shorter side is not a wing of the
 * building: it is the sliver of the plan's own offset shadow.
 */
const FOOTPRINT_MIN_SIDE = 4;

/** The closing of a set of pixels: dilate by r, then erode by r. */
function closePixels(pixels: Pixel[], radius: number): Pixel[] {
  const grown = new Set<string>();
  for (const [x, y] of pixels) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        grown.add(`${nx},${ny}`);
      }
    }
  }
  const out: Pixel[] = [];
  for (const key of grown) {
    const [x, y] = key.split(',').map(Number);
    let solid = true;
    for (let dy = -radius; dy <= radius && solid; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !grown.has(`${nx},${ny}`)) {
          solid = false;
          break;
        }
      }
    }
    if (solid) out.push([x, y]);
  }
  return out;
}

/** The fragments dropped as slivers, and the printed codes healed. */
let sliversDropped = 0;
let codesHealed = 0;

function footprintOf(host: Building): Pixel[][] {
  const minSide = Math.min(host.width, host.height);
  const radius = Math.max(
    FOOTPRINT_CLOSE_MIN,
    Math.min(FOOTPRINT_CLOSE_MAX, Math.round(minSide / 4)),
  );
  // The construction's own blobs: the orange fill dilated by one pixel,
  // so the code printed over it is still part of the shape.
  const own = host.members.flatMap((member) => member.dilated ?? []);
  // The regions the plan prints inside the construction: the codes the
  // closing heals.
  const inside = new Set(own.map(([x, y]) => `${x},${y}`));
  const holeMask = new Uint8Array(W * H);
  for (const [x, y] of fillHoles(own)) {
    if (!inside.has(`${x},${y}`)) holeMask[y * W + x] = 1;
  }
  codesHealed += components(holeMask).length;
  // The closing heals the code and the notches of the plan.
  const closed = closePixels(own, radius);
  // The erosion takes the dilation of the orange back, so the outline
  // lands on the fill and not on its rim, and the holes are filled.
  const silhouette = erodePixels(fillHoles(closed));
  const rings: { ring: Pixel[]; area: number }[] = [];
  for (const piece of connectedPieces(silhouette)) {
    const box = boxOfPixels(piece);
    // The sliver of the plan's own offset shadow is not a wing.
    if (!box || Math.min(box.width, box.height) < FOOTPRINT_MIN_SIDE) {
      sliversDropped++;
      continue;
    }
    // Only the outer ring: the courtyard of a construction is not a wing.
    const outer = traceOutline(maskOf(piece))
      .map((ring) => ({ ring, area: Math.abs(ringArea(ring)) }))
      .filter((entry) => entry.area > 0)
      .sort((left, right) => right.area - left.area)[0];
    if (outer) rings.push(outer);
  }
  rings.sort((left, right) => right.area - left.area);
  return rings.map((entry) => simplifyRing(entry.ring, SIMPLIFY_TOLERANCE));
}

// --- meeting points: green cross -------------------------------------
const meetingMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isMeetingPoint(r, g, b)) meetingMask[y * W + x] = 1;
  }
}
const meetingBoxes = components(dilate(meetingMask, 2))
  .map((c) => boxOf(c, meetingMask))
  .filter((b): b is PixelBox => Boolean(b))
  .filter((b) => b.area >= 8 && b.width >= 5 && b.width <= 16 && b.height >= 5 && b.height <= 16)
  .filter((b) => !inExcluded(b.x, b.y));

// --- internet modules: saturated green squares ------------------------
// The lawn and the sports pitches are large green areas, so they are detected
// first and excluded: only small isolated green blobs are module symbols.
const looseGreen = (r: number, g: number, b: number) =>
  r <= 150 && g >= 125 && g <= 215 && g - r >= 18 && g - b >= -5;
const looseMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (looseGreen(r, g, b)) looseMask[y * W + x] = 1;
  }
}
const greenFields = components(dilate(looseMask, 4))
  .map((c) => boxOf(c, looseMask))
  .filter((b): b is PixelBox => Boolean(b))
  .filter((b) => b.area >= 700);
const inGreenField = (x: number, y: number): boolean =>
  greenFields.some(
    (f) => x >= f.x - 2 && x <= f.x + f.width + 1 && y >= f.y - 2 && y <= f.y + f.height + 1,
  );

const moduleMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isInternetModule(r, g, b)) moduleMask[y * W + x] = 1;
  }
}
// The symbol is drawn as a small salmon frame around a green/teal rectangle,
// so the frames are detected too and merged with the plain green cores.
const frameMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (r >= 145 && r <= 228 && r - g >= 38 && r - g <= 64 && g - b >= 6 && g - b <= 32) {
      frameMask[y * W + x] = 1;
    }
  }
}
const moduleCores = components(dilate(moduleMask, 2))
  .map((c) => boxOf(c, moduleMask))
  .filter((b): b is PixelBox => Boolean(b))
  .filter((b) => b.area >= 2 && b.width <= 13 && b.height <= 10)
  .filter((b) => !inExcluded(b.x, b.y))
  .filter((b) => !inGreenField(b.x + b.width / 2, b.y + b.height / 2));
const moduleFrames = components(dilate(frameMask, 1))
  .map((c) => boxOf(c, frameMask))
  .filter((b): b is PixelBox => Boolean(b))
  .filter((b) => b.area >= 3 && b.area <= 70 && b.width <= 14 && b.height <= 11)
  .filter((b) => !inExcluded(b.x, b.y))
  .filter((b) => !inGreenField(b.x + b.width / 2, b.y + b.height / 2))
  .filter((b) => {
    for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) {
        const [r, g, b2] = rgb(x, y);
        if (r <= 140 && g >= 128 && g <= 205 && g - r >= 28 && g - b2 >= 4) return true;
      }
    }
    return false;
  });
const moduleBoxes = mergeOverlapping([...moduleCores, ...moduleFrames]).filter(
  (b) =>
    !meetingBoxes.some(
      (m) =>
        b.x < m.x + m.width && m.x < b.x + b.width && b.y < m.y + m.height && m.y < b.y + b.height,
    ),
);

// --- track: tan athletics oval ---------------------------------------
const trackMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isTrackFill(r, g, b)) trackMask[y * W + x] = 1;
  }
}
const trackComponents = components(dilate(trackMask, 2)).filter(
  (component) => (boxOf(component, trackMask)?.area ?? 0) >= 400,
);

/**
 * Un tramo del anillo de la pista.
 *
 * La pista de atletismo es un ovalo: su caja completa incluye el campo de
 * juego y el pasto de dentro, y un pin en el centro de esa caja caeria en el
 * pasto (y la piscina que hay al lado). La caja que se publica es el tramo
 * del anillo, arriba, donde caen el pin y el nombre.
 */
function ringSegment(component: Component): PixelBox | null {
  let topY = Infinity;
  for (const [, y] of component.pixels) if (y < topY) topY = y;
  if (!Number.isFinite(topY)) return null;
  const xs = component.pixels.filter(([, y]) => y === topY).map(([x]) => x);
  if (xs.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return { x: minX, y: topY, width: maxX - minX + 1, height: 4, area: 0 };
}

// --- parking: paving texture inside the five lot regions -------------
const pavingMask = new Uint8Array(W * H);
const greyPavingMask = new Uint8Array(W * H);
const brickPavingMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (!isPaving(r, g, b)) continue;
    pavingMask[y * W + x] = 1;
    if (isPavingBrick(r, g, b)) brickPavingMask[y * W + x] = 1;
    else if (isPavingGrey(r, g, b)) greyPavingMask[y * W + x] = 1;
  }
}
// The brick hatch is a set of discrete patches (the eastern lots and the
// patios of the campus), so a lot drawn with it is one patch, not the whole
// region: the patch is found, the region only says where to look.
const brickPatches = components(brickPavingMask).filter((patch) => patch.pixels.length >= 20);

const boxOfPixels = (pixels: Pixel[]): PixelBox | null => {
  if (!pixels.length) return null;
  const xs = pixels.map((p) => p[0]);
  const ys = pixels.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area: pixels.length,
  };
};

const parkingBoxes = PARKING_REGIONS.map((region) => {
  const inside = (x: number, y: number) =>
    x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;

  let grey = 0;
  let brick = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      if (greyPavingMask[y * W + x]) grey++;
      else if (brickPavingMask[y * W + x]) brick++;
    }
  }

  // The street mesh shares the grey ramp with the stippled lots, so the
  // grey pixels of a region reach beyond the lot. The brick hatch does not
  // leak: when the lot is drawn with brick, the lot is the biggest patch of
  // brick inside the region and nothing else is measured.
  if (brick > grey) {
    let best: Pixel[] = [];
    for (const patch of brickPatches) {
      const within = patch.pixels.filter(([x, y]) => inside(x, y));
      if (within.length > best.length) best = within;
    }
    const box = boxOfPixels(best);
    return {
      code: region.code,
      name: region.name,
      area: best.length,
      box: box ?? { x: region.x, y: region.y, width: region.width, height: region.height },
    };
  }

  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  let area = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      if (!pavingMask[y * W + x]) continue;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    code: region.code,
    name: region.name,
    area,
    box: area
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: region.x, y: region.y, width: region.width, height: region.height },
  };
});

/* ------------------------------------------------------------------ *
 * Code binding
 * ------------------------------------------------------------------ */
const bound = new Map();
for (const box of buildingBoxes) {
  if (box.code && !bound.has(box.code)) bound.set(box.code, box);
}

/* ------------------------------------------------------------------ *
 * The classes of the plan
 *
 * The remap is per classified layer, never a per-pixel filter: every
 * pixel lands in exactly one class and the class decides what it is.
 * The names of the classes are the vocabulary the scene and the
 * catalogue share, and the tones below are the reference of the layers
 * the app paints.
 * ------------------------------------------------------------------ */

/**
 * The palette of the classes. The hexes the app already owns are the
 * app's own tokens; the ones it does not own are picked to sit at the
 * lightness of their neighbours, so the plan reads as one surface.
 */
const DARK_PALETTE = {
  // The paper of the scanned plan is the page ground of the product.
  paper: '#0f1219', // --color-surface-900
  // The streets and the lots: one step above the ground, so the roads read.
  paving: '#161b27', // --color-surface-800
  // The thin outlines of the plan (the campus boundary, the area edges).
  hairline: '#2c3549',
  // The printed text and the street labels.
  ink: '#a1adc6', // --color-surface-300
  // The lawns: a dark, desaturated green that still reads as grass.
  lawn: '#1f3d30',
  // The sports pitches and the green strips of the avenues.
  field: '#2f5738',
  // The constructions: a muted amber, the identity of the plan without glare.
  building: '#a8721a',
  // The two hand-over points, a step brighter than the rest.
  safe: '#f59518', // --color-brand-500
  // The drop shadow the plan draws under every construction.
  shadow: '#3d2a0d',
  // The athletics track: a muted brown.
  track: '#6b5335',
  // The brick hatch of the eastern lots and of the patios.
  brick: '#6e4a3a',
  // The salmon frames and the magenta symbols.
  pink: '#6b4a55',
  // The turquoise courts and the blue cores of the module symbols.
  cyan: '#2f6f8c',
  // The cores of the internet module symbols.
  module: '#2f7d64',
  // The meeting points of the plan.
  meeting: '#2f7d4f',
};

const LAYER_NAMES = Object.keys(DARK_PALETTE);
const LAYER_INDEX = new Map(LAYER_NAMES.map((name, index) => [name, index]));

/** A summed-area table of a mask, so the count inside a window is O(1). */
function summedArea(mask: Mask): Int32Array {
  const table = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      table[(y + 1) * (W + 1) + (x + 1)] =
        table[y * (W + 1) + (x + 1)] +
        table[(y + 1) * (W + 1) + x] -
        table[y * (W + 1) + x] +
        mask[y * W + x];
    }
  }
  return table;
}

/** The fraction of a mask's pixels inside the window around (x, y). */
function density(table: Int32Array, x: number, y: number, radius: number): number {
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(W - 1, x + radius);
  const y1 = Math.min(H - 1, y + radius);
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const sum =
    table[(y1 + 1) * (W + 1) + (x1 + 1)] -
    table[y0 * (W + 1) + (x1 + 1)] -
    table[(y1 + 1) * (W + 1) + x0] +
    table[y0 * (W + 1) + x0];
  return sum / area;
}

// The masks the artwork needs: the orange fill (for the drop shadow) and
// the grey linework (to tell a hairline from a paved area).
const greyLineMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isGreyLine(r, g, b)) greyLineMask[y * W + x] = 1;
  }
}
const orangeTable = summedArea(buildingMask);
const greyTable = summedArea(greyLineMask);

// The two safe points: A (the Edificio Administrativo) and AF (the Centro de
// Información, the campus library). They read a step brighter than the rest.
const safeMask = new Uint8Array(W * H);
for (const code of ['A', 'AF']) {
  const group = bound.get(code);
  if (!group) continue;
  for (const member of group.members) {
    for (const [px, py] of member.pixels) safeMask[py * W + px] = 1;
  }
}

// The black printed inside a construction is a HOLE of the orange fill: it
// cannot be reached from the border without crossing the orange. The drop
// shadow the plan draws under a construction can: it touches the paper. The
// flood fill tells the printed code labels from the shadows. The obstacle is
// the orange dilated by one pixel, so the anti-aliased rim of the orange
// does not open a leak to the label.
const outsideMask = new Uint8Array(W * H);
const flood: Pixel[] = [];
const orangeWall = dilate(buildingMask, 1);
for (let x = 0; x < W; x++) {
  flood.push([x, 0], [x, H - 1]);
}
for (let y = 0; y < H; y++) {
  flood.push([0, y], [W - 1, y]);
}
while (flood.length) {
  const popped = flood.pop();
  if (!popped) break;
  const [x, y] = popped;
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const i = y * W + x;
  if (outsideMask[i] || orangeWall[i]) continue;
  outsideMask[i] = 1;
  flood.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}
const insideConstruction = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!buildingMask[i] && !outsideMask[i]) insideConstruction[i] = 1;
}

// The drop shadow the plan draws under every construction is a solid black
// band that TOUCHES the construction. The printed text of the plan is
// strokes: thin in at least one direction. A black pixel belongs to a
// shadow when the ink runs at least four pixels long in BOTH directions
// (a band) next to a construction; the code label printed inside a
// construction is a hole and is never a shadow.
const inkMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isInk(r, g, b)) inkMask[y * W + x] = 1;
  }
}
/** The length of the ink run through (x, y), capped at the limit. */
const inkRun = (x: number, y: number, dx: number, dy: number, limit: number): number => {
  let n = 1;
  let cx = x + dx;
  let cy = y + dy;
  while (n < limit && cx >= 0 && cy >= 0 && cx < W && cy < H && inkMask[cy * W + cx]) {
    n++;
    cx += dx;
    cy += dy;
  }
  return n;
};
const shadowMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!inkMask[i] || insideConstruction[i]) continue;
    const horizontal = inkRun(x, y, -1, 0, 4) + inkRun(x, y, 1, 0, 4) - 1;
    if (horizontal < 4) continue;
    const vertical = inkRun(x, y, 0, -1, 4) + inkRun(x, y, 0, 1, 4) - 1;
    if (vertical < 4) continue;
    const nearConstruction = density(orangeTable, x, y, 8) > 0;
    if (!nearConstruction) continue;
    shadowMask[i] = 1;
  }
}

// El halo de la tinta: el borde antialiasado de un trazo del plano. Un
// pixel pegado a la tinta es el borde de un glifo (una letra, un numero) y
// no una acera. Fuera de las construcciones, donde las palabras del plano
// estan, ese halo no se pinta.
const inkHalo = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (inkMask[i]) continue;
    if (
      inkMask[i - 1] ||
      inkMask[i + 1] ||
      inkMask[i - W] ||
      inkMask[i + W] ||
      inkMask[i - W - 1] ||
      inkMask[i - W + 1] ||
      inkMask[i + W - 1] ||
      inkMask[i + W + 1]
    ) {
      inkHalo[i] = 1;
    }
  }
}

// Una linea del plano es un trazo largo: una acera, un borde de pasto, el
// eje de una calle. Una letra del plano es un trazo corto. La app imprime
// sus propias claves, asi que las palabras del plano no llegan al arte: solo
// sobreviven los trazos largos.
const greyMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isGreyLine(r, g, b)) greyMask[y * W + x] = 1;
  }
}
/** The length of the grey run through (x, y), capped at the limit. */
const greyRun = (x: number, y: number, dx: number, dy: number, limit: number): number => {
  let n = 1;
  let cx = x + dx;
  let cy = y + dy;
  while (n < limit && cx >= 0 && cy >= 0 && cx < W && cy < H && greyMask[cy * W + cx]) {
    n++;
    cx += dx;
    cy += dy;
  }
  return n;
};
const lineMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!greyMask[i]) continue;
    const horizontal = greyRun(x, y, -1, 0, 17) + greyRun(x, y, 1, 0, 17) - 1;
    if (horizontal >= 17) {
      lineMask[i] = 1;
      continue;
    }
    const vertical = greyRun(x, y, 0, -1, 17) + greyRun(x, y, 0, 1, 17) - 1;
    if (vertical >= 17) lineMask[i] = 1;
  }
}

const darkLayer = new Uint8Array(W * H);
const layerCounts = new Map();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const [r, g, b] = rgb(x, y);
    let layer;

    if (isInk(r, g, b)) {
      // The black of the plan is three things: the drop shadow it draws
      // under every construction, the code printed INSIDE a construction, and
      // the plan's own words (the codes by the doors, the street names, the
      // compass). The app prints its own keys, so the words are erased: the
      // code inside a construction is filled with the construction's own
      // colour, and the rest is paper.
      if (shadowMask[i]) layer = 'shadow';
      else if (insideConstruction[i]) layer = safeMask[i] ? 'safe' : 'building';
      else layer = 'paper';
    } else if (inkHalo[i] && !insideConstruction[i]) {
      // El borde de una palabra del plano: no se pinta.
      layer = 'paper';
    } else if (isBuildingFill(r, g, b)) {
      layer = safeMask[i] ? 'safe' : 'building';
    } else if (isTrackFill(r, g, b)) {
      layer = 'track';
    } else if (isCyanPaint(r, g, b)) {
      layer = 'cyan';
    } else if (isFieldGreen(r, g, b)) {
      layer = 'field';
    } else if (isMeetingPoint(r, g, b)) {
      layer = 'meeting';
    } else if (isInternetModule(r, g, b)) {
      layer = 'module';
    } else if (isWarmHatch(r, g, b)) {
      layer = b >= g ? 'pink' : 'brick';
    } else if (isLawnGreen(r, g, b)) {
      layer = 'lawn';
    } else if (isGreyLine(r, g, b)) {
      // A grey pixel surrounded by grey is the texture of a street or of a
      // lot; a grey pixel alone on the paper is one of the thin outlines.
      // A grey pixel with NO neighbour is a mote: the raster's noise, not a
      // kerb. And a grey pixel that does not run long enough to be a line
      // is a letter of the plan, and the app prints its own keys.
      if (!lineMask[i]) layer = 'paper';
      else if (density(greyTable, x, y, 1) < 0.22) layer = 'paper';
      else layer = density(greyTable, x, y, 4) < 0.45 ? 'hairline' : 'paving';
    } else {
      layer = 'paper';
    }

    // Las palabras del plano no se llevan al arte: la app tiene su propio
    // panel de nombres, y el recuadro con las muestras de color se
    // contradice con él. Se tapan con el fondo de la página.
    if (inBox(x, y, DATOS_GENERALES_BOX)) layer = 'paper';
    if (BLANKED_WORDS.some((box) => inBox(x, y, box))) layer = 'paper';

    const index = LAYER_INDEX.get(layer);
    if (index !== undefined) darkLayer[i] = index;
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  }
}

/* ------------------------------------------------------------------ *
 * The scene: the ground of the map
 *
 * The map is not a picture of the plan any more: the plan's own colour
 * classes are traced into rings and the renderer paints them. The
 * classification is the SAME one the catalogue uses, so the ground and
 * the catalogue can never disagree about where the campus is.
 *
 * Every mask of the scene is cleaned the same way:
 *
 *   1. the components under a threshold are dropped: the plan is full of
 *      isolated motes of dust,
 *   2. the mask is closed (dilated by r and eroded by r): the 1px noise
 *      and the bites the printed text takes out of the shapes disappear,
 *   3. the surface fills every hole it has: the courtyards, the printed
 *      text and the area of the constructions are all ground,
 *   4. the outer contour is traced and the rings that pierce it are kept:
 *      the athletics track is an annulus and its infield is a hole,
 *   5. the ring is simplified with the Douglas-Peucker of the catalogue.
 * ------------------------------------------------------------------ */

/** The layers of the scene, back to front: the painter's order. */
const SCENE_LAYERS = ['surface', 'green', 'track', 'court', 'lot'] as const;

type SceneLayer = (typeof SCENE_LAYERS)[number];

/**
 * Which layer of the scene each class of the plan paints. The classes
 * that are not listed are the surface: the streets, the hairline
 * outlines, the printed text, the plan's own drop shadows and the small
 * symbols. The paper, the amber of the constructions and the two safe
 * points are not ground at all.
 */
const SCENE_CLASS: Record<string, SceneLayer | 'none'> = {
  paper: 'none',
  building: 'none',
  safe: 'none',
  lawn: 'green',
  field: 'green',
  track: 'track',
  cyan: 'court',
  brick: 'lot',
};

/**
 * The cleaning of each layer: the radius of the closing and the size
 * under which a component is a speck. The surface is the campus: its
 * radius is the reference value and it is wide, because a bite in the
 * silhouette of the campus is a hole in the ground.
 */
const SCENE_CLEAN: Record<SceneLayer, { close: number; minPixels: number }> = {
  surface: { close: 3, minPixels: 600 },
  green: { close: 2, minPixels: 600 },
  track: { close: 2, minPixels: 600 },
  court: { close: 2, minPixels: 60 },
  lot: { close: 2, minPixels: 60 },
};

/** The tolerance of the simplification of the scene's rings, in pixels. */
const SCENE_TOLERANCE = 1.5;

/**
 * The mask of the pixels of one layer of the scene.
 *
 * The surface is the UNION of every class but the paper and the
 * constructions: the ground the campus stands on. The layers above it
 * are painted over it, so they are also part of the surface.
 *
 * The scene is the crop of the plan: the legend column, the title card
 * and the crest live past x = 700 and are not ground.
 */
function sceneMask(layer: SceneLayer): Mask {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < CROP_WIDTH; x++) {
      const name = LAYER_NAMES[darkLayer[y * W + x]];
      const target = SCENE_CLASS[name] ?? 'surface';
      if (target === 'none') continue;
      if (layer === 'surface' || target === layer) mask[y * W + x] = 1;
    }
  }
  return mask;
}

/** A mask with the given pixels in it. */
function maskOf(pixels: Pixel[]): Mask {
  const mask = new Uint8Array(W * H);
  for (const [x, y] of pixels) mask[y * W + x] = 1;
  return mask;
}

/** The pieces of a mask, four neighbours each: the shapes it is made of. */
function maskPieces(mask: Mask): Pixel[][] {
  const seen = new Uint8Array(W * H);
  const pieces: Pixel[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const piece: Pixel[] = [];
    while (stack.length) {
      const index = stack.pop();
      if (index === undefined) break;
      const x = index % W;
      const y = (index - x) / W;
      piece.push([x, y]);
      const visit = (nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
        const ni = ny * W + nx;
        if (!mask[ni] || seen[ni]) return;
        seen[ni] = 1;
        stack.push(ni);
      };
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }
    pieces.push(piece);
  }
  return pieces;
}

/** The box of the pixels of a mask. */
function maskBox(mask: Mask): PixelBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return area ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area } : null;
}

/** The erosion of a mask by a square window. */
function erodeMask(mask: Mask, radius: number): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      let solid = true;
      for (let dy = -radius; dy <= radius && solid; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !mask[ny * W + nx]) {
            solid = false;
            break;
          }
        }
      }
      if (solid) out[y * W + x] = 1;
    }
  }
  return out;
}

/** The closing of a mask: dilate by r, then erode by r. */
function closeMask(mask: Mask, radius: number): Mask {
  return radius <= 0 ? mask : erodeMask(dilate(mask, radius), radius);
}

/**
 * The holes of a mask filled: the regions the shape closes around. The
 * flood starts from the border of the box of the shape, so what it
 * reaches is the outside and what it does not is a hole.
 */
function fillMaskHoles(mask: Mask): Mask {
  const box = maskBox(mask);
  if (!box) return mask;
  const out = new Uint8Array(mask);
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (x: number, y: number): void => {
    if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) return;
    const index = y * W + x;
    if (outside[index] || mask[index]) return;
    outside[index] = 1;
    stack.push(index);
  };
  for (let x = box.x; x < box.x + box.width; x++) {
    visit(x, box.y);
    visit(x, box.y + box.height - 1);
  }
  for (let y = box.y; y < box.y + box.height; y++) {
    visit(box.x, y);
    visit(box.x + box.width - 1, y);
  }
  while (stack.length) {
    const index = stack.pop();
    if (index === undefined) break;
    const x = index % W;
    const y = (index - x) / W;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const index = y * W + x;
      if (!mask[index] && !outside[index]) out[index] = 1;
    }
  }
  return out;
}

/** One shape of the ground: an outer ring and the rings that pierce it. */
interface SceneShapeLiteral {
  layer: SceneLayer;
  rings: Pixel[][];
}

/** The components dropped as specks, per layer. */
const specksDropped = new Map<SceneLayer, number>();

/**
 * The shapes of one layer of the scene: every component that survives
 * the cleaning, with its outline traced and simplified.
 */
function sceneShapes(layer: SceneLayer): SceneShapeLiteral[] {
  const { close, minPixels } = SCENE_CLEAN[layer];
  // 1. the specks are dropped.
  const pieces = maskPieces(sceneMask(layer));
  const kept = new Uint8Array(W * H);
  let keptPieces = 0;
  for (const piece of pieces) {
    if (piece.length < minPixels) continue;
    keptPieces++;
    for (const [x, y] of piece) kept[y * W + x] = 1;
  }
  specksDropped.set(layer, pieces.length - keptPieces);
  // 2. the closing.
  const closed = closeMask(kept, close);
  const shapes: SceneShapeLiteral[] = [];
  for (const piece of maskPieces(closed)) {
    // 3. the surface fills every hole; the layers above it keep the
    //    rings that pierce them (the infield of the athletics track).
    const shape = layer === 'surface' ? fillMaskHoles(maskOf(piece)) : maskOf(piece);
    // 4. the outline is traced: the outer ring first, then the holes.
    const rings = traceOutline(shape)
      .map((ring) => ({ ring, area: Math.abs(ringArea(ring)) }))
      .filter((entry) => entry.area > 0)
      .sort((left, right) => right.area - left.area);
    if (!rings.length) continue;
    // 5. the rings are simplified.
    shapes.push({
      layer,
      rings: rings.map((entry) => simplifyRing(entry.ring, SCENE_TOLERANCE)),
    });
  }
  return shapes;
}

const scene: SceneShapeLiteral[] = SCENE_LAYERS.flatMap((layer) => sceneShapes(layer));

const units = {
  'metal-mecanica': 'metal-mecanica',
  central: 'central',
  posgrado: 'posgrado',
};

function unitOf(box: PixelBox): string {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const mm = UNIT_BANDS['metal-mecanica'];
  const pg = UNIT_BANDS.posgrado;
  if (cx < mm.maxX && cy < mm.maxY) return units['metal-mecanica'];
  if (cx >= pg.minX && cy >= pg.minY) return units.posgrado;
  return units.central;
}

const zones: GeneratedZone[] = [];
const usedBoxes = new Set<PixelBox>();

/** The corners of a box, the shape a zone has when nothing was traced. */
const boxRing = (box: PixelBox): Pixel[] => [
  [box.x, box.y],
  [box.x + box.width, box.y],
  [box.x + box.width, box.y + box.height],
  [box.x, box.y + box.height],
];

for (const [code, host] of bound) {
  usedBoxes.add(host);
  const unit = unitOf(host);
  const name = LEGEND[code as keyof typeof LEGEND] ?? `Edificio ${code}`;
  // safePoint: the hand-over points of the product spec ("la Biblioteca o la
  // Jefatura"). The official plan never prints the word "Biblioteca", but its
  // legend names AF as the "Centro de Información" — which is the campus
  // library — and A as the "Edificio Administrativo", where a Dean's office
  // sits. Both readings come from the plan, magnified 4x.
  const safePoint = code === 'A' || code === 'AF';
  // The footprint: the outline of every piece the plan draws of this
  // construction, the biggest one first. The box stays as it was: it is the
  // hit area and the keyboard reading order depend on it.
  const fragments = footprintOf(host);
  zones.push({
    id: `bldg-${slug(code)}`,
    code,
    name,
    unit,
    kind: 'building',
    safePoint,
    label: `${code} · ${name}`,
    box: {
      x: host.x,
      y: host.y,
      width: host.width,
      height: host.height,
      area: host.area ?? 0,
    },
    polygon: fragments[0] ?? boxRing(host),
    fragments,
  });
}

// Buildings detected but without a readable printed code stay in the
// catalogue with a null code so the map never loses a footprint.
const unknownBuildings = buildingBoxes.filter((host) => !usedBoxes.has(host));
unknownBuildings.forEach((host, index) => {
  const fragments = footprintOf(host);
  zones.push({
    id: `bldg-unknown-${String(index + 1).padStart(2, '0')}`,
    code: null,
    name: 'Edificio sin código legible',
    unit: unitOf(host),
    kind: 'building',
    safePoint: false,
    label: 'Edificio sin código legible',
    box: {
      x: host.x,
      y: host.y,
      width: host.width,
      height: host.height,
      area: host.area ?? 0,
    },
    polygon: fragments[0] ?? boxRing(host),
    fragments,
  });
});

const meetingSorted = [...meetingBoxes].sort((a, b) => a.y - b.y || a.x - b.x);
meetingSorted.forEach((box, index) => {
  const code = `PR-${String(index + 1).padStart(2, '0')}`;
  zones.push({
    id: `pr-${String(index + 1).padStart(2, '0')}`,
    code,
    name: `Punto de reunión ${index + 1}`,
    unit: unitOf(box),
    kind: 'meeting_point',
    safePoint: false,
    label: `Punto de reunión ${index + 1}`,
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      area: box.area ?? 0,
    },
    polygon: boxRing(box as PixelBox),
  });
});

const moduleSorted = [...moduleBoxes].sort((a, b) => a.y - b.y || a.x - b.x);
moduleSorted.forEach((box, index) => {
  zones.push({
    id: `net-${String(index + 1).padStart(2, '0')}`,
    code: `NET-${String(index + 1).padStart(2, '0')}`,
    name: `Módulo de internet ${index + 1}`,
    unit: unitOf(box),
    kind: 'internet_module',
    safePoint: false,
    label: `Módulo de internet ${index + 1}`,
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      area: box.area ?? 0,
    },
    polygon: boxRing(box),
  });
});

for (const lot of parkingBoxes) {
  zones.push({
    id: `parking-${lot.code}`,
    code: `ESTACIONAMIENTO ${lot.code}`,
    name: lot.name,
    unit: 'campus',
    kind: 'parking',
    safePoint: false,
    label: `Estacionamiento ${lot.code}`,
    box: lot.box as PixelBox,
    polygon: boxRing(lot.box as PixelBox),
  });
}

// La pista de atletismo: el óvalo del plano. Su catálogo guarda la CAJA que
// lo envuelve, no el óvalo: un óvalo no es un polígono y el renderer no
// puede pintar una zona plana con la caja, porque borraría el pasto de
// dentro. El óvalo lo dibuja la escena, que lo traza como un anillo.
for (const [index, component] of trackComponents.entries()) {
  const segment = ringSegment(component);
  if (!segment) continue;
  zones.push({
    id: `track-${index + 1}`,
    code: 'PISTA DE ATLETISMO',
    name: 'Pista de Atletismo',
    unit: 'campus',
    kind: 'track',
    safePoint: false,
    label: 'Pista de Atletismo',
    box: segment,
    polygon: boxRing(segment),
  });
}

const uncertainCodes = [
  ...unplacedAnchors.map(([code]) => code),
  ...zones.filter((z) => z.kind === 'building' && z.code === null).map((z) => z.id),
];

const KIND_ORDER: Record<string, number> = {
  building: 0,
  parking: 1,
  meeting_point: 2,
  internet_module: 3,
  track: 4,
};
const UNIT_ORDER: Record<string, number> = {
  'metal-mecanica': 0,
  central: 1,
  posgrado: 2,
  campus: 3,
};
zones.sort(
  (a, b) =>
    UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit] ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.box.y - b.box.y ||
    a.box.x - b.box.x ||
    a.id.localeCompare(b.id),
);

function slug(code: string): string {
  return code
    .toLowerCase()
    .replace(/ñ/g, 'ny')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');
}

/* ------------------------------------------------------------------ *
 * Emit src/map/zones.ts
 * ------------------------------------------------------------------ */
const quote = (value: unknown): string =>
  `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A ring of the catalogue: the corners of a shape, in the units of the plan. */
const ringLiteral = (ring: Pixel[]): string =>
  `[${ring.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`;

const zoneLiteral = (zone: GeneratedZone): string => {
  const { x, y, width, height } = zone.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const lines = [
    '  {',
    `    id: ${quote(zone.id)},`,
    `    code: ${zone.code === null ? 'null' : quote(zone.code)},`,
    `    name: ${quote(zone.name)},`,
    `    unit: ${quote(zone.unit)},`,
    `    kind: ${quote(zone.kind)},`,
    `    safePoint: ${zone.safePoint},`,
    `    label: ${quote(zone.label)},`,
    `    box: { x: ${x}, y: ${y}, width: ${width}, height: ${height} },`,
    `    polygon: ${ringLiteral(zone.polygon)},`,
  ];
  // A construction that the plan draws in one piece needs no fragments: its
  // polygon IS the shape. The fragments are only published when the plan
  // draws the construction in more than one piece, so the catalogue never
  // carries the same ring twice.
  if (zone.fragments && zone.fragments.length > 1) {
    lines.push(`    fragments: [${zone.fragments.map(ringLiteral).join(', ')}],`);
  }
  lines.push('  },');
  return lines.join('\n');
};

const zonesTs = `// Generated by scripts/extract-zones.ts from public/mapa-itm.png — do not edit by hand.
//
// The catalogue lives in the coordinate space of the CROP of the official
// "PLANO GENERAL CAMPUS ITM N°1": the legend column, its title card and
// its crest live past x = 700, so the artwork is ${CROP_WIDTH} x ${MAP_HEIGHT} px. The crop starts
// at x = 0, so the origin does not move and every zone stays in the
// coordinate space of the original plan.
//
// The ground the zones sit on is the SCENE (src/map/scene.ts): the same
// generator, the same classification of the plan, traced into rings.
//
// The catalogue is typed: the annotation checks the DATA (a zone without a
// box, or with a polygon of the wrong shape, does not compile) instead of
// merely describing it.

import type { MapImage, Zone } from '../types.ts';

export const MAP_IMAGE: MapImage = { src: '/mapa-itm-dark.png', width: ${CROP_WIDTH}, height: ${MAP_HEIGHT} };

export const ZONES: Zone[] = [
${zones.map(zoneLiteral).join('\n')}
];

export const ZONE_BY_ID: Map<string, Zone> = new Map(ZONES.map((zone) => [zone.id, zone]));

export const UNCERTAIN_CODES: string[] = [${uncertainCodes.map((code) => quote(code)).join(', ')}];
`;

writeFileSync(ZONES_OUT, zonesTs);

/* ------------------------------------------------------------------ *
 * Emit src/map/scene.ts
 * ------------------------------------------------------------------ */
const sceneLiteral = (shape: SceneShapeLiteral): string => {
  const lines = ['  {', `    layer: ${quote(shape.layer)},`, '    rings: ['];
  for (const ring of shape.rings) lines.push(`      ${ringLiteral(ring)},`);
  lines.push('    ],', '  },');
  return lines.join('\n');
};

const sceneTs = `// Generated by scripts/extract-zones.ts from public/mapa-itm.png — do not edit by hand.
//
// The SCENE is the ground of the interactive map: the campus traced from
// the plan's own colour classes, in the coordinate space of the official
// "PLANO GENERAL CAMPUS ITM N°1" (${CROP_WIDTH} x ${MAP_HEIGHT} px, the crop that cuts
// the legend column away). The origin does not move, so the shapes of the
// scene and the zones of the catalogue live in the same space.
//
// The shapes are painted in the order of the array, back to front: the
// surface is the campus's own silhouette and the layers above it are its
// lawns, its athletics track, its courts and its brick lots. A shape with
// more than one ring is a ring with holes: the outer ring first, then the
// rings that pierce it.
//
// The scene is typed: the annotation checks the DATA (a shape without a
// layer, or with a ring of the wrong shape, does not compile) instead of
// merely describing it.

import type { Polygon } from '../types.ts';

/** The layers the ground is drawn in, back to front. */
export type SceneLayer = 'surface' | 'green' | 'track' | 'court' | 'lot';

/** One shape of the ground: an outer ring and the rings that pierce it. */
export interface SceneShape {
  layer: SceneLayer;
  rings: Polygon[];
}

/** The campus, drawn. The renderer paints these in array order. */
export const SCENE: SceneShape[] = [
${scene.map(sceneLiteral).join('\n')}
];
`;

writeFileSync(SCENE_OUT, sceneTs);

/* ------------------------------------------------------------------ *
 * Emit public/zones-debug.png
 * ------------------------------------------------------------------ */
const FONT: Record<string, string> = {
  A: '111101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '101111111111101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  0: '111101101101111',
  1: '010110010010111',
  2: '110001010100111',
  3: '110001010001110',
  4: '101101111001001',
  5: '111100110001110',
  6: '011100110101010',
  7: '111001010010010',
  8: '010101010101010',
  9: '010101011001110',
  '-': '000000111000000',
  ' ': '000000000000000',
  '~': '101010000000000',
};
const GLYPH_W = 3;
const GLYPH_H = 5;

const debug = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  debug.data[i * 4] = data[i * 4];
  debug.data[i * 4 + 1] = data[i * 4 + 1];
  debug.data[i * 4 + 2] = data[i * 4 + 2];
  debug.data[i * 4 + 3] = 255;
}
const setPixel = (x: number, y: number, r: number, g: number, b: number): void => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = at(x, y);
  debug.data[i] = r;
  debug.data[i + 1] = g;
  debug.data[i + 2] = b;
};
const COLORS = {
  building: [220, 0, 0],
  parking: [0, 70, 220],
  meeting_point: [190, 0, 190],
  internet_module: [0, 150, 60],
  track: [230, 120, 0],
};
const drawRect = (box: PixelBox, color: number[]): void => {
  const [r, g, b] = color;
  for (let x = box.x; x < box.x + box.width; x++) {
    setPixel(x, box.y, r, g, b);
    setPixel(x, box.y + box.height - 1, r, g, b);
  }
  for (let y = box.y; y < box.y + box.height; y++) {
    setPixel(box.x, y, r, g, b);
    setPixel(box.x + box.width - 1, y, r, g, b);
  }
};
const drawText = (text: string, x0: number, y0: number): number => {
  let cx = x0;
  for (const raw of text.toUpperCase().replace(/Ñ/g, 'N~')) {
    const glyph = FONT[raw] ?? FONT[' '] ?? '';
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (glyph[row * GLYPH_W + col] === '1') setPixel(cx + col, y0 + row, 0, 0, 0);
      }
    }
    cx += GLYPH_W + 1;
  }
  return cx - x0 - 1;
};
// Building codes are drawn last so their labels stay readable on top of the
// smaller symbols that share the same patch of plan.
const drawOrder = [...zones].sort((a, b) => KIND_ORDER[b.kind] - KIND_ORDER[a.kind]);
for (const zone of drawOrder) {
  const color = COLORS[zone.kind];
  drawRect(zone.box, color);
  const label = zone.code ?? '??';
  const textW = label.length * (GLYPH_W + 1) - 1;
  let tx = zone.box.x;
  let ty = zone.box.y - GLYPH_H - 1;
  if (ty < 0) ty = zone.box.y + zone.box.height + 1;
  if (tx + textW > W - 1) tx = W - textW - 1;
  // white halo so the code stays readable over the artwork
  for (let dy = -1; dy <= GLYPH_H; dy++) {
    for (let dx = -1; dx <= textW + 1; dx++) setPixel(tx + dx, ty + dy, 255, 255, 255);
  }
  drawText(label, tx, ty);
}
writeFileSync(DEBUG_OUT, PNG.sync.write(debug));

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const count = (kind: string): number => zones.filter((z) => z.kind === kind).length;
const report = {
  building: count('building'),
  parking: count('parking'),
  meeting_point: count('meeting_point'),
  internet_module: count('internet_module'),
  track: count('track'),
};
console.log('zone catalogue written to src/map/zones.ts');
console.log('scene written to src/map/scene.ts');
console.log('debug overlay written to public/zones-debug.png');
console.log('per-layer counts:', JSON.stringify(report));
console.log(
  'plan per-class counts:',
  JSON.stringify(Object.fromEntries(LAYER_NAMES.map((name) => [name, layerCounts.get(name) ?? 0]))),
);
console.log(
  'scene per-layer shapes:',
  JSON.stringify(
    Object.fromEntries(
      SCENE_LAYERS.map((layer) => [layer, scene.filter((shape) => shape.layer === layer).length]),
    ),
  ),
);
console.log(
  'scene per-layer vertices:',
  JSON.stringify(
    Object.fromEntries(
      SCENE_LAYERS.map((layer) => [
        layer,
        scene
          .filter((shape) => shape.layer === layer)
          .reduce((sum, shape) => sum + shape.rings.reduce((n, ring) => n + ring.length, 0), 0),
      ]),
    ),
  ),
);
console.log(
  'specks dropped per layer:',
  JSON.stringify(
    Object.fromEntries(SCENE_LAYERS.map((layer) => [layer, specksDropped.get(layer) ?? 0])),
  ),
);
console.log(
  'surface shapes:',
  scene
    .filter((shape) => shape.layer === 'surface')
    .map(
      (shape) =>
        `${shape.rings.length} ring(s), ${shape.rings[0]?.length ?? 0} vertices, ${Math.round(
          Math.abs(ringArea(shape.rings[0] ?? [])),
        )} px, box ${JSON.stringify(maskBox(maskOf(shape.rings[0] ?? [])))}`,
    )
    .join(' | '),
);
console.log(
  `codes assigned ${bound.size}/${PRINTED_CODES.length}, uncertain: ${
    uncertainCodes.length ? uncertainCodes.join(', ') : 'none'
  }`,
);
const fragmented = zones.filter((zone) => (zone.fragments?.length ?? 0) > 1);
console.log(
  `footprints: ${zones.filter((zone) => zone.fragments).length} constructions traced at ${SIMPLIFY_TOLERANCE}px, ${sliversDropped} slivers dropped, ${codesHealed} printed codes healed by the closing`,
);
console.log(
  'buildings with more than one fragment:',
  fragmented.length
    ? fragmented
        .map(
          (zone) =>
            `${zone.code ?? zone.id}=${(zone.fragments ?? []).length}[${(zone.fragments ?? [])
              .map((ring) => Math.round(Math.abs(ringArea(ring))))
              .join(',')}]`,
        )
        .join(' ')
    : 'none',
);
console.log(
  'internet module boxes:',
  moduleBoxes.map((b) => `${b.x},${b.y},${b.width}x${b.height}`).join(' '),
);
if (unplacedAnchors.length) {
  console.log('anchors without a host box:', JSON.stringify(unplacedAnchors));
}
const unlabelledBuildings = zones.filter((z) => z.kind === 'building' && z.code === null);
if (unlabelledBuildings.length) {
  console.log(
    'buildings without a printed code:',
    unlabelledBuildings.map((z) => `${z.id}@${z.box.x},${z.box.y}`).join(' '),
  );
}
