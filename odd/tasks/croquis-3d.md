# Croquis 3D — el mapa como geometría, no como fotografía

**Objective:** convert the campus croquis from a raster picture into data the app owns — a dark, cropped artwork plus a real zone catalogue with true footprints, rendered as a vector scene with extruded buildings — without breaking the coordinate algebra, the accessible zone listbox, or the browser journey.
**Branch:** `feature/objetos-perdidas-itm` (SAME BRANCH — the user asked for this phase to land here, on top of the 30 existing commits).
**Delivery strategy:** one branch, one PR, reviewed per work-unit commit. Forecast ≈ 900 authored changed lines over 6 work units.
**Test runner:** `vp test` (Vitest, 286 unit/integration tests) · `vp exec node scripts/smoke-journey.mjs` (the real browser, 260 assertions) · `vp check` (format + lint + type).
**Toolchain:** Vite+ (`vp`) 1.3.0 · pnpm 12.14.0 · Node 24.22.1 · React 19 · Tailwind 4.

---

## Specs

### S1 — The croquis stops being a PNG

> "Me gustaría refactorizar todo el mapa para que deje de ser un PNG y se vea más 3D e integrado con todo el proyecto"

Scope: the map the student interacts with is rendered from the app's own data — its own dark palette, its own legend, its own geometry. The raster survives only as the optional "plano original" reference.
Acceptance: the interactive map renders no bitmap of the plan; every visible element is drawn by the app; the plan's own white paper and its baked legend column are gone from the interactive view.
Checks: the built bundle contains no `mapa-itm.png` reference on the interactive path; the smoke journey asserts the artwork element is a vector, not an image.

### S2 — The map looks 3D and belongs to the product

> "...y se vea más 3D e integrado con todo el proyecto"

Scope: the buildings read as volumes (a top face plus two lit side faces plus a cast shadow) and the pins read as markers standing on the ground, both in the app's palette (`surface-*`, `brand-*`, `pin-red`, `pin-green`).
Acceptance: no white paper anywhere in the map; the extrusion uses ONE light direction for the whole campus; the pins cast a shadow consistent with that light.
Checks: the journey asserts the SVG carries one light vector and that every building shape has a top face and a shadow; a visual review of the regenerated screenshots.

### S3 — The zoom bug stays fixed

> "al hacer zoom solo se incrementa la vista de los puntos pero no del mapa"

Scope: the artwork, the zone overlay and the pins move as ONE thing at any zoom.
Acceptance: the artwork's rendered size grows by the same factor as the layer's transform; the drift between the artwork and the zone overlay stays under 0.5 px; the point under the cursor stays under the cursor; a tap after a zoom still resolves the right zone.
Checks: the journey already asserts all four (260/260 green today). They must stay green through every task of this phase.

### S4 — The icons stay native Solar

> "En vez de usar emojis como íconos usemos Solar Icons"
> "Está de forma nativa, no uses iconify, verifica su SKILL para usarlo de manera correcta usando sus paquetes nativos"

Scope: the icon family stays `@solar-icons/react` (per-file kebab-case imports, inlined in the bundle). No Iconify, no `unplugin-icons`, no `@iconify-json/*`.
Acceptance: `package.json` declares no Iconify packages; `grep "~icons/" src/` is empty; every icon is `aria-hidden` and inherits `currentColor`.
Checks: a grep gate in the task's verification.

### S5 — The accessible zone path survives

Scope: the 90 zones stay reachable as a single-tab-stop spatial `listbox` with `aria-activedescendant`, a live region, 44 px minimum hit areas, and the keyboard navigation of `zoneReadingOrder` / `nextZoneInDirection`.
Acceptance: no regression in the semantic tree that lightpanda dumps; the zone buttons keep their `data-testid="zone-<zoneId>"` and their `role="option"`.
Checks: `scripts/structure-check.mjs` (lightpanda) must still show `listbox` + 90 named `option`s; the journey's keyboard assertions.

### S6 — The crop is a coordinate migration, done deliberately

Scope: dropping the raster's legend column (x 700..846) shrinks the artwork's canvas from 846 to 700 px wide. The crop starts at x = 0, so the ORIGIN DOES NOT MOVE: every existing coordinate stays valid and only the canvas width changes. **This must be verified, not assumed** — if any zone reaches past x = 700, the crop has to be wider and the migration becomes a real origin shift.
Acceptance: the catalogue is regenerated with the new canvas width; `zones.test.js` asserts the new bounds and that no zone crosses the canvas edge; the API re-seeds (or a migration re-seeds) the `zones` table; the stored `map_x`/`map_y` stay in the same space.
Checks: the unit tests of the catalogue; a reseed note in the task's handoff; the journey's geometry assertions.

### S7 — The shapes are derived, never traced by hand

Scope: the building footprints come from the masks the generator already computes. Hand-tracing is out of scope — it was already rejected for this project because it produced an unfaithful redraw.
Acceptance: `polygon` is the real contour of the detected component (not its bounding box); the fragmented buildings keep all their fragments; the simplification is documented with its tolerance.
Checks: the catalogue test asserts that a polygon is not simply its box for the known non-rectangular buildings; the visual review against `public/zones-debug.png`.

### S8 — The heights are not invented

Scope: the raster carries no height, so the extrusion uses ONE constant height for every building, and a taller volume only for the two safe points (a product decision, not geometry).
Acceptance: no per-building height table exists in the data; the safe points are visibly taller and are marked as such in the code.
Checks: a unit test asserting every building shares the same height except the safe points.

### S9 — The streets are honest about their cost

Scope: the street mesh and the parking paving share the same grey ramp in the raster, so they cannot be separated by colour. The first vector phase ships WITHOUT street lines; the buildings, the greens and the track carry the plan, and the zone listbox carries the names. Street polylines are a later, hand-authored step.
Acceptance: no invented street geometry is committed; the omission is stated in the UI copy and in this document.
Checks: a visual review — the plan must still be recognisable.

### S10 — The official plan stays reachable

Scope: the original full-colour plan (with its crest and its printed title) remains available as a reference for the students who want it.
Acceptance: a link opens the untouched original; the interactive map never shows the baked legend column.
Checks: the link exists and resolves.

---

## Invariants (what must NOT break)

These are asserted by `scripts/smoke-journey.mjs` and `scripts/structure-check.mjs`. Any task that breaks one is not done.

| #   | Invariant                                                                                                                         | Where it is asserted                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| I1  | The artwork layer is a `<div>` carrying the inline `transform`, with the zone listbox as its direct child                         | the journey reads the transform from the listbox's parent |
| I2  | `data-testid="map"`, `map-raster` (or its vector successor), `zone-<id>`, and the whole `data-testid` contract                    | the journey, 260 assertions                               |
| I3  | `role="listbox"` + 90 `role="option"` with `aria-activedescendant` and the live region                                            | lightpanda's semantic tree                                |
| I4  | Every zone's hit area is ≥ 44 px                                                                                                  | the journey                                               |
| I5  | The keyboard path moves between zones in reading order and selects with Enter                                                     | the journey                                               |
| I6  | The artwork, the zones and the pins zoom together (S3)                                                                            | the journey (4 assertions)                                |
| I7  | `zone.box` survives in the catalogue even when `polygon` becomes the true shape                                                   | the keyboard path reads `box`                             |
| I8  | The algebra `client = origin + translation + scale · layer` stays valid; the measurement comes from a never-transformed reference | the journey's geometry assertions                         |
| I9  | The console stays clean (zero errors) in the whole journey                                                                        | the journey                                               |
| I10 | The API's public report payload still carries `map_x`/`map_y` in the CURRENT artwork space                                        | the API tests + the journey                               |

---

## Data decisions (locked)

| Question                                  | Decision                                                                                      | Why                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Keep the raster at all?                   | Yes, as the optional "plano original" reference; the interactive map is vector                | the official plan's crest and title carry trust; the interactive map must be ours         |
| Where does the legend go?                 | An HTML panel fed by `ZONES` (the names are already data)                                     | the raster's legend column is 17 % of the width and a lossy copy of our own table         |
| Where does the crop start?                | x = 0..700 of the 846 px raster (the legend column, the plan title and the crest are outside) | the campus ends before x = 690                                                            |
| What does the crop do to the coordinates? | Everything shifts by the crop origin; the catalogue is regenerated in the new space           | a crop is a migration, not a CSS trick                                                    |
| Building footprints?                      | Contour tracing over the undilated masks the generator already computes + Douglas-Peucker     | faithful by construction; hand-tracing was rejected (L12)                                 |
| Fragmented buildings?                     | Multi-polygon, with the fragments joined where the plan draws them joined                     | 2H, K and U are cut by their own code label                                               |
| Heights?                                  | One constant for all 52; the two safe points taller                                           | the raster has no heights; inventing per-building storeys is a design lie dressed as data |
| Streets?                                  | Not in this phase; the omission is stated in the copy                                         | the street mesh and the parking paving share one grey ramp                                |
| Greens / track / boundary?                | Derived from the masks that already exist (the greens are currently computed and thrown away) | same machine, same faithfulness                                                           |
| 3D technique?                             | SVG extrusion: top face + two side faces + a ground shadow, one light vector                  | zero dependencies, exact hit-testing, the accessible DOM survives                         |
| Tilted camera?                            | Out of scope                                                                                  | a projective transform replaces the algebra and turns a readable plan into a scene        |

---

## Tasks

| ID  | Specs       | Work                                                                                                                                                                                                                                                                                                                                                          | Route  | Surfaces                                                                                          | Verification                                                                         | Status  |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------- |
| T1  | S1, S2, S6  | The generator emits a **dark cropped raster** (`public/mapa-itm-dark.png`) next to the original: the legend column removed and the palette remapped to the app's tokens, using the classification masks it already computes. The crop shifts the artwork origin, so the catalogue is regenerated in the new space and `parking-3`'s un-measured box is fixed. | inline | `scripts/extract-zones.mjs`, `src/map/zones.js` (generated), `src/map/zones.test.js`, `public/`   | `vp test`, `vp exec node scripts/extract-zones.mjs`, a visual read of the new raster | pending |
| T2  | S1, S10     | The HTML legend panel: the 52 names (and the other zones) as a real, searchable panel fed by `ZONES`, with the "plano original" link. The interactive map stops showing the baked legend column.                                                                                                                                                              | inline | `src/components/ZoneLegend.jsx` (new), `src/components/CampusMap.jsx`, `src/App.jsx`              | the journey, lightpanda's tree, a visual read                                        | pending |
| T3  | S7          | The contour tracer: real footprints for every building, multi-polygon for the fragmented ones, simplification with a documented tolerance. `polygon` stops being the box's corners.                                                                                                                                                                           | inline | `scripts/extract-zones.mjs`, `src/map/zones.js`, `src/map/zones.test.js`                          | the unit tests + a visual read against `public/zones-debug.png`                      | pending |
| T4  | S1, S5, S6  | The renderer swaps the `<img>` for an inline `<svg viewBox="0 0 700 647">` that draws the campus from the data: the zones as real shapes, the greens, the track, the boundary. The hit-testing follows the shapes; `zone.box` stays for the keyboard and the hit areas.                                                                                       | inline | `src/components/CampusMap.jsx`, `src/map/geometry.js` (+tests)                                    | the journey (all 260), lightpanda                                                    | pending |
| T5  | S2, S8      | The extrusion: every building becomes a prism (top face + two side faces under one light) with a ground shadow; the pins become markers with a real cast shadow; the safe points stand taller.                                                                                                                                                                | inline | `src/components/CampusMap.jsx`, `src/components/MapPin.jsx` (new), `src/map/geometry.js` (+tests) | the journey + a visual read                                                          | pending |
| T6  | S4, S9, S10 | The finishing pass: the copy that admits what the map does not show, the reference link, the final visual review of the 24 screenshots, and the plan's own log.                                                                                                                                                                                               | inline | `src/App.jsx`, `src/components/*.jsx`, `odd/tasks/croquis-3d.md`                                  | the journey, lightpanda, the visual review                                           | pending |

### Risks per task

| Task | Risk                                                                                                                        | Mitigation                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| T1   | The crop moves every coordinate: the catalogue, the stored `map_x`/`map_y` and the API's seeded `zones` table desynchronise | regenerate in the same run; the API re-seeds the table from the same file; the reseed is in the handoff |
| T1   | A palette remap can destroy the plan's legibility (the streets vanish into the background)                                  | the remap is per classified layer, not per pixel; the visual read is the gate                           |
| T3   | The code labels cut their own buildings in half → a contour that follows the label's gap                                    | trace the UNDILATED mask (the generator already uses that trick) and join the fragments explicitly      |
| T3   | Simplification that is too aggressive merges neighbours                                                                     | a documented tolerance, verified against `zones-debug.png`                                              |
| T4   | The raster's error/retry state dies with the `<img>`                                                                        | the failure moves to the campus data load (the API), which can fail honestly                            |
| T4   | The a11y layer must not depend on the raster                                                                                | the listbox is already DOM; the map becomes SVG with its own `<title>`                                  |
| T5   | The extrusion shifts the hit-testing (the top face is offset)                                                               | test the TOP face polygon: one constant offset before `pointInPolygon`                                  |

---

## Log

**L1 — 2026-10-22 — The request (verbatim):**

> "Planea ODD la siguiente fase del proyecto para integrar el mapa 3D en esta misma rama."

**L2 — 2026-10-22 — The three asks that produced this phase (verbatim):**

> "- Me gustaría refactorizar todo el mapa para que deje de ser un PNG y se vea más 3D e integrado con todo el proyecto, analiza y dame ideas de cómo poder realizarlo"
> "- Como bug detecté que al hacer zoom solo se incrementa la vista de los puntos pero no del mapa, con la refactorización anterior también resolveríamos esto"
> "- En vez de usar emojis como íconos usemos Solar Icons"

**L3 — 2026-10-22 — Where the phase starts from.** The zoom bug is already fixed (commit `660b59a`): the raster now carries the same transform as the artwork layer, anchored at the painted artwork's top-left, and the letterbox fit is measured from a never-transformed stage. The icons are already native Solar (`3714d5c`). This phase therefore starts from a working, tested map and changes its NATURE, not its correctness.

**L4 — 2026-10-22 — The verdict this plan implements.** The map must become geometry, not a picture: 17 % of the raster's width is a lossy photograph of the `LEGEND` table the app already holds, its text is sub-pixel on a phone, and no CSS can re-theme or extrude a PNG. The 3D comes from SVG extrusion under one fixed light, with a constant height (the raster has no heights) — no engine, no tilted camera, and the accessible DOM listbox survives.
