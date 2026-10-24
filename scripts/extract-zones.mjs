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
const ZONES_OUT = resolve(ROOT, 'src/map/zones.js');
const DEBUG_OUT = resolve(ROOT, 'public/zones-debug.png');

const MAP_WIDTH = 846;
const MAP_HEIGHT = 647;

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
 * mesh and the lots share the same grey ramp), so each lot is located by the
 * region it occupies and the box is measured from the paving pixels inside.
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
    return { ...box, index: 0, pixels: c.pixels.filter(([x, y]) => buildingMask[y * W + x]) };
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
  };
});

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
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(x, y);
    if (isPaving(r, g, b)) pavingMask[y * W + x] = 1;
  }
}
const parkingBoxes = PARKING_REGIONS.map((region) => {
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
  zones.push({
    id: `bldg-${slug(code)}`,
    code,
    name,
    unit,
    kind: 'building',
    safePoint,
    label: `${code} · ${name}`,
    box: { x: host.x, y: host.y, width: host.width, height: host.height },
  });
}

// Buildings detected but without a readable printed code stay in the
// catalogue with a null code so the map never loses a footprint.
const unknownBuildings = buildingBoxes.filter((host) => !usedBoxes.has(host));
unknownBuildings.forEach((host, index) => {
  zones.push({
    id: `bldg-unknown-${String(index + 1).padStart(2, '0')}`,
    code: null,
    name: 'Edificio sin código legible',
    unit: unitOf(host),
    kind: 'building',
    safePoint: false,
    label: 'Edificio sin código legible',
    box: { x: host.x, y: host.y, width: host.width, height: host.height },
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
    `    polygon: [[${x}, ${y}], [${x + width}, ${y}], [${x + width}, ${y + height}], [${x}, ${y + height}]],`,
    '  },',
  ];
  return lines.join('\n');
};

const zonesJs = `// Generated by scripts/extract-zones.mjs from public/mapa-itm.png — do not edit by hand.
//
// The raster is the official "PLANO GENERAL CAMPUS ITM N°1" (846 x 647 px).
// Every zone is a detected, addressable footprint in that pixel space.

export const MAP_IMAGE = { src: '/mapa-itm.png', width: ${MAP_WIDTH}, height: ${MAP_HEIGHT} };

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
console.log('per-layer counts:', JSON.stringify(report));
console.log(
  `codes assigned ${bound.size}/${PRINTED_CODES.length}, uncertain: ${
    uncertainCodes.length ? uncertainCodes.join(', ') : 'none'
  }`,
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
