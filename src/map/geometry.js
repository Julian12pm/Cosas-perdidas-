/**
 * Geometry helpers for the campus croquis.
 *
 * The artwork is an <img> that the browser letterboxes inside its own box
 * (`object-contain` plus a max-height), so a click on the padding is not a
 * click on the map and a percentage of the box is not a percentage of the
 * artwork. Every conversion between client pixels and artwork pixels goes
 * through the painted content box computed here.
 */

/** Painted content box of an artwork centred inside its element box. */
export function fitContain(box, natural) {
  const boxWidth = box?.width ?? 0;
  const boxHeight = box?.height ?? 0;
  const naturalWidth = natural?.width ?? 0;
  const naturalHeight = natural?.height ?? 0;
  if (!(boxWidth > 0 && boxHeight > 0 && naturalWidth > 0 && naturalHeight > 0)) return null;

  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height, scale };
}

/** Client point to artwork point; null when the point falls outside the artwork. */
export function clientToArtwork(clientX, clientY, origin, fit, natural) {
  if (!fit) return null;

  const x = (clientX - origin.left - fit.x) / fit.scale;
  const y = (clientY - origin.top - fit.y) / fit.scale;
  if (x < 0 || y < 0 || x > natural.width || y > natural.height) return null;

  return { x, y };
}

/** Artwork point to the percentage format pins are stored in. */
export function artworkToPercent(point, natural) {
  return { x: (point.x / natural.width) * 100, y: (point.y / natural.height) * 100 };
}
