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
 *   src/map/zones.js   - the catalogue (deterministic order)
 *   public/mapa-itm-dark.png - the interactive artwork: the same masks
 *                              remapped to the app's palette and cropped to
 *                              the campus (the legend column is cut away)
 *   public/zones-debug.png - the plan with every detected box drawn and labelled
 *
 * Measured on the current raster: 53 orange footprints, of which 52 carry a
 * printed code (the legend declares 52 constructions) and 1 is an unlabelled
 * covered walkway; plus 5 parking lots (declares 5), 11 meeting points
 * (declares 10), 20 internet modules (declares 14) and 1 athletics track. The
 * plan draws more symbols than its own legend counts.
 *
 * Run with: vp exec node scripts/extract-zones.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = resolve(ROOT, 'public/mapa-itm.png');
const DARK_MAP_PATH = resolve(ROOT, 'public/mapa-itm-dark.png');
const ZONES_OUT = resolve(ROOT, 'src/map/zones.js');
const DEBUG_OUT = resolve(ROOT, 'public/zones-debug.png');

const MAP_WIDTH = 846;
const MAP_HEIGHT = 647;

/*
 * The interactive artwork is the dark crop of the plan: the legend column,
 * the title card and the crest live past x = 700. The crop starts at x = 0,
 * so the artwork's origin does NOT move — every coordinate of the catalogue
 * stays valid and only the canvas width changes.
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
const PRINTED_CODES = [
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
 * Regions of the raster that are map furniture, not campus content: the
 * right-hand legend panel, the "DATOS GENERALES" box, the "PLANO GENERAL
 * CAMPUS ITM N°1" card, the ITM logo and the "POZO DE AGUA" callout.
 */
const EXCLUDED_REGIONS = [
  { x: 700, y: 0, width: 146, height: 647 }, // legend panel + title card + logo
  { x: 45, y: 515, width: 175, height: 95 }, // DATOS GENERALES box
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
const { width: W, height: H, data } = png;
const at = (x, y) => (W * y + x) << 2;
const rgb = (x, y) => {
  const i = at(x, y);
  return [data[i], data[i + 1], data[i + 2]];
};

// Orange building fill: the swatch of "52 CONSTRUCCIONES" (249,166,74).
const isBuildingFill = (r, g, b) =>
  r >= 232 && g >= 148 && g <= 186 && b <= 98 && r - b >= 135 && g - b >= 52;

// Tan running-track surface of the athletics oval: (208,171,100).
const isTrackFill = (r, g, b) =>
  r >= 196 && r <= 222 && g >= 158 && g <= 184 && b >= 88 && b <= 116 && r - b >= 70 && g - b >= 42;

// Muted dark green of the "10 PUNTOS DE REUNIÓN" cross: ~(93,129,114).
const isMeetingPoint = (r, g, b) =>
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
const isInternetModule = (r, g, b) => r <= 130 && g >= 120 && g <= 205 && g - r >= 33 && g - b >= 5;

// Paving: the stipple of the parking lots plus the brick hatching used for
// the eastern lots.
const isPaving = (r, g, b) =>
  (Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 150 && r <= 248) ||
  (r >= 175 && r <= 235 && r - g >= 40 && r - g <= 95 && g - b >= 5 && g - b <= 55);

/* --- the layers of the dark artwork ------------------------------- *
 * The artwork is remapped per CLASSIFIED LAYER, never per pixel: these
 * predicates are the ones that decide which layer a pixel belongs to.
 * ------------------------------------------------------------------ */

// The grey half of the paving: the street mesh and the stippled lots.
const isPavingGrey = (r, g, b) =>
  Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 150 && r <= 248;

// The brick half of the paving: the eastern lots and the patios.
const isPavingBrick = (r, g, b) =>
  r >= 175 && r <= 235 && r - g >= 40 && r - g <= 95 && g - b >= 5 && g - b <= 55;

// Any grey linework of the plan, from the darkest street edge to the
// softest hairline: the boundaries, the area outlines and the hatch.
const isGreyLine = (r, g, b) =>
  Math.abs(r - g) <= 14 && Math.abs(g - b) <= 16 && r >= 118 && r <= 248;

// The black of the plan: the printed text, the labels and the drop shadow
// the plan draws under every construction.
const isInk = (r, g, b) => Math.max(r, g, b) < 125 && Math.max(r, g, b) - Math.min(r, g, b) < 45;

// The lawns: the light green fields of the campus.
const isLawnGreen = (r, g, b) =>
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
const isFieldGreen = (r, g, b) =>
  r >= 100 && r <= 180 && g >= 160 && g <= 225 && b <= 125 && g - r >= 35 && g - b >= 65;

// The warm hatch of the plan: the brick of the eastern lots and patios, the
// salmon frames of the internet modules and the magenta of a few symbols.
const isWarmHatch = (r, g, b) =>
  r >= 140 && r <= 240 && r - g >= 38 && r - g <= 110 && g - b >= -90 && g - b <= 60;

// The cyan of the plan: the turquoise courts and the blue cores of the
// internet module symbols.
const isCyanPaint = (r, g, b) => b >= 180 && b - r >= 40 && g >= 120 && g - b >= -40;

const inExcluded = (x, y) =>
  EXCLUDED_REGIONS.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

/* ------------------------------------------------------------------ *
 * Connected components
 * ------------------------------------------------------------------ */
function dilate(mask, radius) {
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

function components(mask) {
  const seen = new Uint8Array(W * H);
  const found = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || seen[i]) continue;
      const stack = [[x, y]];
      seen[i] = 1;
      const pixels = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
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
function boxOf(component, mask) {
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
function mergeOverlapping(boxes) {
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

const boxOverlap = (a, b) => {
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
const buildingBlobs = components(dilate(buildingMask, 1))
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
  .filter((b) => b && b.area >= 15 && b.width >= 4 && b.height >= 3)
  .filter((b) => !inExcluded(b.x, b.y) && !inExcluded(b.x + b.width - 1, b.y + b.height - 1))
  .filter((b) => b.x < 700)
  .map((b, index) => ({ ...b, index }));

// The printed code of a building is the anchor that binds it: a blob that
// carries one is a complete construction, a blob without one is a fragment of
// the labelled building it touches.
const codeOfBlob = new Map();
const blobOfCode = new Map();
const unplacedAnchors = [];
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
const groups = new Map();
for (const blob of buildingBlobs) {
  if (codeOfBlob.has(blob.index)) groups.set(blob.index, [blob]);
}
const groupBox = (members) => {
  const x = Math.min(...members.map((m) => m.x));
  const y = Math.min(...members.map((m) => m.y));
  const right = Math.max(...members.map((m) => m.x + m.width));
  const bottom = Math.max(...members.map((m) => m.y + m.height));
  return { x, y, width: right - x, height: bottom - y };
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

const buildingBoxes = [...groups.values()].map((members) => {
  const box = groupBox(members);
  const coded = members.find((m) => codeOfBlob.has(m.index));
  return {
    ...box,
    area: members.reduce((sum, m) => sum + m.area, 0),
    code: coded ? codeOfBlob.get(coded.index) : null,
    // The members carry their pixels: the dark artwork paints the two safe
    // points with the brand amber and needs to know exactly which pixels
    // belong to them.
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
function ringArea(ring) {
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
function erodePixels(pixels) {
  const inside = new Set(pixels.map(([x, y]) => `${x},${y}`));
  const out = [];
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
function fillHoles(pixels) {
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
  const outside = new Set();
  const stack = [];
  for (let x = minX; x <= maxX; x++) stack.push([x, minY], [x, maxY]);
  for (let y = minY; y <= maxY; y++) stack.push([minX, y], [maxX, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
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
function connectedPieces(pixels) {
  const remaining = new Map();
  for (const [x, y] of pixels) remaining.set(`${x},${y}`, [x, y]);
  const pieces = [];
  while (remaining.size) {
    const [startKey, start] = remaining.entries().next().value;
    remaining.delete(startKey);
    const piece = [start];
    const stack = [start];
    while (stack.length) {
      const [x, y] = stack.pop();
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
function traceOutline(pixels) {
  const inside = new Set(pixels.map(([x, y]) => `${x},${y}`));
  const has = (x, y) => inside.has(`${x},${y}`);

  const outgoing = new Map();
  const link = (fromX, fromY, toX, toY) => {
    const key = `${fromX},${fromY}`;
    const edge = [toX, toY, toX - fromX, toY - fromY];
    const list = outgoing.get(key);
    if (list) list.push(edge);
    else outgoing.set(key, [edge]);
  };
  for (const [x, y] of pixels) {
    if (!has(x, y - 1)) link(x, y, x + 1, y);
    if (!has(x + 1, y)) link(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) link(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) link(x, y + 1, x, y);
  }

  const pending = new Map([...outgoing].map(([key, list]) => [key, [...list]]));
  const takeEdge = (key, dx, dy) => {
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

  const rings = [];
  for (const startKey of outgoing.keys()) {
    while (pending.get(startKey)?.length) {
      const first = pending.get(startKey).shift();
      const ring = [];
      let key = startKey;
      let edge = first;
      for (;;) {
        const [atX, atY] = key.split(',');
        ring.push([Number(atX), Number(atY)]);
        const next = takeEdge(`${edge[0]},${edge[1]}`, edge[2], edge[3]);
        if (!next) break;
        if (`${next[0]},${next[1]}` === startKey) break;
        key = `${next[0]},${next[1]}`;
        edge = next;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** The squared distance of a point to a segment. */
function segmentDistance(point, start, end) {
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
function simplifyChain(points, tolerance) {
  if (points.length < 3) return [...points];
  const limit = tolerance * tolerance;
  const keep = Array.from({ length: points.length }, () => false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
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
function simplifyRing(ring, tolerance) {
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
 * The footprint of a construction: the outline of every piece of it the
 * plan draws, the biggest one first.
 *
 * A speck of the scan is not a wing of a building, so a piece that is
 * smaller than a tenth of the biggest one is dropped: the printed
 * labels cut the constructions in pieces, and those pieces are kept,
 * but the dust of the JPEG is not.
 */
const FRAGMENT_SHARE = 0.1;

function footprintOf(host) {
  const rings = [];
  for (const member of host.members) {
    // The holes of the component are the printed codes, and the
    // footprint ignores them. The erosion takes the dilation back, so
    // the outline lands on the orange fill and not on its rim.
    const silhouette = erodePixels(fillHoles(member.dilated));
    for (const piece of connectedPieces(silhouette)) {
      for (const ring of traceOutline(piece)) {
        const area = Math.abs(ringArea(ring));
        if (area > 0) rings.push({ ring, area });
      }
    }
  }
  rings.sort((left, right) => right.area - left.area);
  const biggest = rings[0]?.area ?? 0;
  return rings
    .filter((entry) => entry.area >= biggest * FRAGMENT_SHARE)
    .map((entry) => simplifyRing(entry.ring, SIMPLIFY_TOLERANCE));
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
  .filter(
    (b) => b && b.area >= 8 && b.width >= 5 && b.width <= 16 && b.height >= 5 && b.height <= 16,
  )
  .filter((b) => !inExcluded(b.x, b.y));

// --- internet modules: saturated green squares ------------------------
// The lawn and the sports pitches are large green areas, so they are detected
// first and excluded: only small isolated green blobs are module symbols.
const looseGreen = (r, g, b) => r <= 150 && g >= 125 && g <= 215 && g - r >= 18 && g - b >= -5;
const looseMask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (looseGreen(r, g, b)) looseMask[y * W + x] = 1;
  }
}
const greenFields = components(dilate(looseMask, 4))
  .map((c) => boxOf(c, looseMask))
  .filter((b) => b && b.area >= 700);
const inGreenField = (x, y) =>
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
  .filter((b) => b && b.area >= 2 && b.width <= 13 && b.height <= 10)
  .filter((b) => !inExcluded(b.x, b.y))
  .filter((b) => !inGreenField(b.x + b.width / 2, b.y + b.height / 2));
const moduleFrames = components(dilate(frameMask, 1))
  .map((c) => boxOf(c, frameMask))
  .filter((b) => b && b.area >= 3 && b.area <= 70 && b.width <= 14 && b.height <= 11)
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
const trackBoxes = components(dilate(trackMask, 2))
  .map((c) => boxOf(c, trackMask))
  .filter((b) => b && b.area >= 400);

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

const boxOfPixels = (pixels) => {
  if (!pixels.length) return null;
  const xs = pixels.map((p) => p[0]);
  const ys = pixels.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const parkingBoxes = PARKING_REGIONS.map((region) => {
  const inside = (x, y) =>
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
    let best = [];
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
 * The dark artwork
 *
 * The interactive map must stop being a bright slab of scanned paper in a
 * dark product, so the same masks that produce the catalogue produce a
 * SECOND raster: the plan's layers remapped to the app's palette and the
 * legend column cut away. The remap is per classified layer, never a
 * per-pixel filter: every pixel lands in exactly one layer and the layer
 * decides the colour.
 * ------------------------------------------------------------------ */

/**
 * The palette of the dark artwork. The hexes the app already owns are the
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
function summedArea(mask) {
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
function density(table, x, y, radius) {
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
const flood = [];
const orangeWall = dilate(buildingMask, 1);
for (let x = 0; x < W; x++) {
  flood.push([x, 0], [x, H - 1]);
}
for (let y = 0; y < H; y++) {
  flood.push([0, y], [W - 1, y]);
}
while (flood.length) {
  const [x, y] = flood.pop();
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
const inkRun = (x, y, dx, dy, limit) => {
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

const darkLayer = new Uint8Array(W * H);
const layerCounts = new Map();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const [r, g, b] = rgb(x, y);
    let layer;

    if (isInk(r, g, b)) {
      // The black of the plan is either the printed ink (the code label
      // printed inside a construction, the text of the plan) or the drop
      // shadow the plan draws under every construction.
      layer = shadowMask[i] ? 'shadow' : 'ink';
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
      layer = density(greyTable, x, y, 4) < 0.45 ? 'hairline' : 'paving';
    } else {
      layer = 'paper';
    }

    darkLayer[i] = LAYER_INDEX.get(layer);
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  }
}

const DARK_RGB = Object.fromEntries(
  Object.entries(DARK_PALETTE).map(([name, hex]) => [
    name,
    [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
  ]),
);

const dark = new PNG({ width: CROP_WIDTH, height: MAP_HEIGHT });
for (let y = 0; y < MAP_HEIGHT; y++) {
  for (let x = 0; x < CROP_WIDTH; x++) {
    const [r, g, b] = DARK_RGB[LAYER_NAMES[darkLayer[y * W + x]]];
    const i = (y * CROP_WIDTH + x) * 4;
    dark.data[i] = r;
    dark.data[i + 1] = g;
    dark.data[i + 2] = b;
    dark.data[i + 3] = 255;
  }
}
writeFileSync(DARK_MAP_PATH, PNG.sync.write(dark));

const units = {
  'metal-mecanica': 'metal-mecanica',
  central: 'central',
  posgrado: 'posgrado',
};

function unitOf(box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const mm = UNIT_BANDS['metal-mecanica'];
  const pg = UNIT_BANDS.posgrado;
  if (cx < mm.maxX && cy < mm.maxY) return units['metal-mecanica'];
  if (cx >= pg.minX && cy >= pg.minY) return units.posgrado;
  return units.central;
}

const zones = [];
const usedBoxes = new Set();

/** The corners of a box, the shape a zone has when nothing was traced. */
const boxRing = (box) => [
  [box.x, box.y],
  [box.x + box.width, box.y],
  [box.x + box.width, box.y + box.height],
  [box.x, box.y + box.height],
];

for (const [code, host] of bound) {
  usedBoxes.add(host);
  const unit = unitOf(host);
  const name = LEGEND[code] ?? `Edificio ${code}`;
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
    box: { x: host.x, y: host.y, width: host.width, height: host.height },
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
    box: { x: host.x, y: host.y, width: host.width, height: host.height },
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
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    polygon: boxRing(box),
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
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
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
    box: lot.box,
    polygon: boxRing(lot.box),
  });
}

for (const [index, box] of trackBoxes.entries()) {
  zones.push({
    id: `track-${index + 1}`,
    code: 'PISTA DE ATLETISMO',
    name: 'Pista de Atletismo',
    unit: 'campus',
    kind: 'track',
    safePoint: false,
    label: 'Pista de Atletismo',
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    polygon: boxRing(box),
  });
}

const uncertainCodes = [
  ...unplacedAnchors.map(([code]) => code),
  ...zones.filter((z) => z.kind === 'building' && z.code === null).map((z) => z.id),
];

const KIND_ORDER = { building: 0, parking: 1, meeting_point: 2, internet_module: 3, track: 4 };
const UNIT_ORDER = { 'metal-mecanica': 0, central: 1, posgrado: 2, campus: 3 };
zones.sort(
  (a, b) =>
    UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit] ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.box.y - b.box.y ||
    a.box.x - b.box.x ||
    a.id.localeCompare(b.id),
);

function slug(code) {
  return code
    .toLowerCase()
    .replace(/ñ/g, 'ny')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');
}

/* ------------------------------------------------------------------ *
 * Emit src/map/zones.js
 * ------------------------------------------------------------------ */
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A ring of the catalogue: the corners of a shape, in the units of the plan. */
const ringLiteral = (ring) => `[${ring.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`;

const zoneLiteral = (zone) => {
  const { x, y, width, height } = zone.box;
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
  // Only the constructions carry fragments: the other zones keep the shape
  // of their box, and a zone without fragments keeps working as it did.
  if (zone.fragments) {
    lines.push(`    fragments: [${zone.fragments.map(ringLiteral).join(', ')}],`);
  }
  lines.push('  },');
  return lines.join('\n');
};

const zonesJs = `// Generated by scripts/extract-zones.mjs from public/mapa-itm.png — do not edit by hand.
//
// The interactive artwork is the DARK CROP of the official "PLANO GENERAL
// CAMPUS ITM N°1": public/mapa-itm-dark.png (${CROP_WIDTH} x ${MAP_HEIGHT} px), the plan
// remapped to the app's palette with its legend column, its title card and
// its crest cut away. The crop starts at x = 0, so the origin does not move
// and every zone stays in the coordinate space of the original plan.

export const MAP_IMAGE = { src: '/mapa-itm-dark.png', width: ${CROP_WIDTH}, height: ${MAP_HEIGHT} };

export const ZONES = [
${zones.map(zoneLiteral).join('\n')}
];

export const ZONE_BY_ID = new Map(ZONES.map((zone) => [zone.id, zone]));

export const UNCERTAIN_CODES = [${uncertainCodes.map((code) => quote(code)).join(', ')}];
`;

writeFileSync(ZONES_OUT, zonesJs);

/* ------------------------------------------------------------------ *
 * Emit public/zones-debug.png
 * ------------------------------------------------------------------ */
const FONT = {
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
const setPixel = (x, y, r, g, b) => {
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
const drawRect = (box, color) => {
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
const drawText = (text, x0, y0) => {
  let cx = x0;
  for (const raw of text.toUpperCase().replace(/Ñ/g, 'N~')) {
    const glyph = FONT[raw] ?? FONT[' '];
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
const count = (kind) => zones.filter((z) => z.kind === kind).length;
const report = {
  building: count('building'),
  parking: count('parking'),
  meeting_point: count('meeting_point'),
  internet_module: count('internet_module'),
  track: count('track'),
};
console.log('zone catalogue written to src/map/zones.js');
console.log('debug overlay written to public/zones-debug.png');
console.log('dark artwork written to public/mapa-itm-dark.png');
console.log('per-layer counts:', JSON.stringify(report));
console.log(
  'dark artwork per-layer counts:',
  JSON.stringify(Object.fromEntries(LAYER_NAMES.map((name) => [name, layerCounts.get(name) ?? 0]))),
);
console.log(
  `codes assigned ${bound.size}/${PRINTED_CODES.length}, uncertain: ${
    uncertainCodes.length ? uncertainCodes.join(', ') : 'none'
  }`,
);
const fragmented = zones.filter((zone) => (zone.fragments?.length ?? 0) > 1);
console.log(
  `footprints: ${zones.filter((zone) => zone.fragments).length} constructions traced at ${SIMPLIFY_TOLERANCE}px`,
);
console.log(
  'buildings with more than one fragment:',
  fragmented.length
    ? fragmented
        .map(
          (zone) =>
            `${zone.code ?? zone.id}=${zone.fragments.length}[${zone.fragments
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
