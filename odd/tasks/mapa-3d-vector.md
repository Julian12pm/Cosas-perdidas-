# The croquis becomes a scene — vector ground, one relief, keys that fit

**Objective:** turn the campus croquis from a scanned picture with a 3D overlay into ONE vector
scene the app owns — a ground traced from the plan's own colour classes, clean building footprints,
a single relief under a single light, and keys that fit inside their buildings — without breaking
the coordinate algebra, the accessible zone listbox, the 44 px hit areas, or the API contract.
**Branch:** `feature/objetos-perdidas-itm` (SAME BRANCH — the phase continues on top of the existing
commits).
**Delivery strategy:** one branch, one PR, reviewed per work-unit commit. Four work units.
**Test runner:** `vp test` (368 unit/integration tests) · `vp exec node scripts/smoke-journey.ts`
(the browser journey, 370 assertions, 2 viewports) · `vp exec node scripts/structure-check.ts`
(lightpanda's semantic tree) · `vp exec node scripts/smoke-api.ts` (26 assertions against a real
Postgres) · `vp check` · `vp build`.

**Status: PLANNED.** The two premises this phase rests on were validated with a throwaway prototype
before the plan was written (L4, L5). Nothing is implemented yet.

---

## Why this phase exists

The student looked at the map and named five defects: "se vea bonito, sin líneas ni trazos raros,
píxeles muertos, inconsistencias de tamaños, letras desbordadas de los edificiso". The audit found
that all five are the SAME defect seen from five angles: **the map is painted twice.**

`public/mapa-itm-dark.png` already carries the plan's flat buildings, the plan's own baked drop
shadows, the plan's printed codes and the plan's 1 px linework. `src/components/CampusMap.tsx` then
extrudes a SECOND 3D system on top of that picture. Every complaint is a seam between the two
paintings.

| #   | What the student sees                                          | Cause                                                                                                                | Where                                      |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | The plan's own shadows under the buildings (two depth systems) | the raster keeps the plan's baked drop shadows (4 000 px)                                                            | `scripts/extract-zones.ts:1400-1450`       |
| 2   | The plan's printed codes punching holes inside the buildings   | the flood fill that decides `insideConstruction` leaks, so 19 codes survive as paper holes                           | `scripts/extract-zones.ts:1275-1296`       |
| 3   | Stray strokes poking out from under the volumes                | the plan's hairlines (4 382 px) survive under the extruded roofs                                                     | `scripts/extract-zones.ts:1386-1395`       |
| 4   | Dead pixels and a canvas that is 56.6 % empty                  | the raster paints the plan's paper; the campus is a diagonal band in a rectangular frame                             | `public/mapa-itm-dark.png`                 |
| 5   | Bites taken out of the buildings                               | the 1 px trace + Douglas-Peucker keeps notches (33 of 65 fragments have ≥2 reflex vertices)                          | `scripts/extract-zones.ts:930-948`         |
| 6   | Letters that overflow their building                           | the key is anchored to the BASE centroid (outside the footprint for 2 buildings) and the black "plate" patch appears | `src/components/CampusMap.tsx:545,750-763` |
| 7   | Buildings that read as flat plates at high zoom                | the wall's height is a constant in SCREEN pixels, so a 40-unit building shows a 16 px wall on a 240 px roof          | `src/map/geometry.ts:786-803`              |
| 8   | A map that cannot be sharp                                     | the raster is 700 px wide and is upscaled 5.76× at `MAX_SCALE = 6`                                                   | `src/components/CampusMap.tsx:44`          |

The renderer cannot be patched out of this. The interactive map must stop using a picture of the
plan and start using the plan's own geometry.

---

## Specs

### S1 — The croquis stops being a picture

> "donde ocupo que se vea bonito, sin líneas ni trazos raros, píxeles muertos, inconsistencias de
> tamaños, letras desbordadas de los edificiso"

Scope: the ground the student interacts with is drawn from the plan's classified colour classes as
vector shapes. The raster leaves the interactive path.
Acceptance: the interactive SVG contains no `<image>`; the ground is made of the app's own paths; the
plan's printed codes, its baked drop shadows, its hairlines and its isolated motes do not reach the
interactive map.
Checks: the journey asserts the artwork carries no bitmap; a visual read of the regenerated scene.

### S2 — The ground is the campus, not a canvas with holes

> "píxeles muertos"

Scope: the ground is the campus's own silhouette. The area the plan leaves empty is the page, not a
hole in the map.
Acceptance: the ground's surface covers the campus and only the campus; no empty region inside the
campus reads as a hole; the empty area outside the campus is the page's own ground.
Checks: the scene's ground rings cover the campus's content; the journey's screenshots.

### S3 — A building is a clean volume

> "sin líneas ni trazos raros"

Scope: the footprint of a construction is the shape the plan draws, with the plan's own text, its
baked shadow copies and its 1 px artefacts removed.
Acceptance: no footprint carries a notch the plan did not draw; a construction's printed code does
not appear inside its own footprint; the plan's offset shadow copies are not traced as wings.
Checks: the catalogue's tests (a new invariant), the journey's screenshots.

### S4 — The height scales with the zoom

> "inconsistencias de tamaños"

Scope: the wall's height is a property of the building, and it grows with the zoom the way a real
building does. The screen-space constant of the previous phase is replaced by a floor, not by
another constant.
Acceptance: the wall's height in screen pixels grows with the zoom; a building reads as a volume at
every zoom, including the maximum; the wall never exceeds the building's own size.
Checks: the geometry's tests, the journey's wall assertion.

### S5 — The key fits inside its building

> "letras desbordadas de los edificiso"

Scope: the key is measured, not assumed. It is drawn inside its own footprint or not at all.
Acceptance: the key's box is inside the footprint of its building; no plate is drawn behind it; a key
that cannot be read is not drawn, and the legend names the zone.
Checks: the journey's key assertion, the screenshots.

### S6 — The modal does not break the map

> "El zoom también se ve afectado por la modal de detalles"

Scope: the map's own chrome behaves inside the viewport and yields to a dialog.
Acceptance: while a dialog is open the map does not zoom; the pin's label and the zone's name chip
stay inside the viewport; the dialog's title wraps instead of overflowing.
Checks: the journey's new assertions, the screenshots.

---

## Invariants (what must NOT break)

| #   | Invariant                                                                     | Where it is asserted              |
| --- | ----------------------------------------------------------------------------- | --------------------------------- |
| I1  | The 368 unit tests, the demo journey and the API journey stay green           | every gate                        |
| I2  | "What you see is what you touch": a tap on the roof resolves that building    | the journey's roof and base taps  |
| I3  | The relief keeps its tones and its documented ratios                          | the journey's contrast assertions |
| I4  | The zone listbox keeps one tab stop, its 90 named options and its live region | the journey, lightpanda's tree    |
| I5  | Every zone's hit area is ≥ 44 px                                              | the journey                       |
| I6  | The artwork, the zones and the pins zoom together                             | the journey (4 assertions)        |
| I7  | The algebra `client = origin + translation + scale · layer` stays valid       | the journey's geometry assertions |
| I8  | The API's public payload and the domain rules are untouched                   | the API's own tests               |
| I9  | The console stays clean (zero errors) in the whole journey                    | the journey                       |
| I10 | The pins keep their stored `map_x`/`map_y` meaning                            | the API tests + the journey       |

**I1 carries two deliberate exceptions**, both forced by S1 and both recorded in the Log: the
journey's block that fakes a broken raster download, and its assertion that the plan's "DATOS
GENERALES" box is not painted in the artwork. Both test a thing that stops existing when the map
stops downloading a picture; both are replaced by the assertion that the artwork is vector.

---

## Data decisions (locked)

| Question                         | Decision                                                                                                   | Why                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Keep the raster at all?          | No. `public/mapa-itm-dark.png` is deleted; the official full-colour plan stays the reference               | the raster is what carries the plan's own 3D, its text and its 1 px noise                             |
| Where does the ground come from? | The plan's own colour classes, traced into rings by the generator                                          | one source of truth: the same classification that painted the raster now paints shapes                |
| Which ground layers?             | The campus surface (the union of every non-paper class), the greens, the track, the courts, the brick lots | these are the classes the plan separates cleanly; the street mesh does not (S9)                       |
| Streets?                         | Not in this phase; the surface tone implies them                                                           | the street mesh and the parking paving share one grey ramp, so they cannot be separated by colour     |
| Which footprints?                | The construction's own blobs, closed morphologically and traced; the slivers dropped                       | the closing removes the plan's codes and its notches in one operation                                 |
| Heights?                         | Unchanged: a pure function of the plan's legend words                                                      | the previous phase's decision stands; a curated table is a separate product decision                  |
| Key size?                        | Proportional to the building, capped, and only drawn when it can be read                                   | a key that does not fit is not a key                                                                  |
| Camera?                          | Unchanged: the plan view. An axonometric camera is a later option, not this phase                          | the students know the printed plan in plan view; the tilt costs the roof labels and the 44 px targets |
| New dependencies?                | None                                                                                                       | the SVG renderer, the DOM listbox and the algebra all survive                                         |

---

## Tasks

| ID  | Specs      | Work                                                                                                                                                                                                                                                                                            | Route  | Surfaces                                                                                                                                                                                                                          | Verification                                                                     | Status |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| T1  | S1, S2, S3 | The generator stops painting a raster and emits a scene: `src/map/scene.ts` carries the ground's rings (the campus surface, the greens, the track, the courts, the brick lots); the catalogue's footprints are closed and de-slivered. The renderer draws that ground instead of the `<image>`. | inline | `scripts/extract-zones.ts`, `src/map/scene.ts` (new, generated), `src/map/zones.ts` (generated), `src/components/CampusMap.tsx`, `src/map/geometry.ts`, `src/map/scene.test.ts` (new), `src/types.ts`, `scripts/smoke-journey.ts` | `vp test`, `vp exec node scripts/extract-zones.ts`, the journey, the screenshots | done   | The generador emite `src/map/scene.ts`: 32 formas, 834 vértices, tres superficies (el campus, la unidad de metal-mecánica, el anexo de posgrado), 20 verdes, la pista, la cancha y 7 lotes. Las huellas se cierran antes de trazarse (66 códigos sanados, 1 sliver descartado, las muescas de 33 de 65 fragmentos a 14). El raster desaparece del camino interactivo: `public/mapa-itm-dark.png` se borró y con él sus estados de carga y de error. El camino ya no pide ninguna foto |
| T2  | S4         | The relief: the wall's height comes from the building's family in PLAN units and grows with the zoom, with a screen floor so it is still legible on a phone; the floor never lets the roof leave its footprint; the painter's order stays the one the light demands.                            | inline | `src/map/geometry.ts` (+tests), `src/components/CampusMap.tsx`                                                                                                                                                                    | `vp test`, the journey's wall assertion, the screenshots                         | done   | La altura pasó a unidades de plano (7/10/15, el uso que declara la leyenda) con un piso de 7 px: la pared crece con el zoom y el tejado no abandona su base. A 3× y a 6× los volúmenes se leen como volúmenes                                                                                                                                                                                                                                                                         |
| T3  | S5         | The key: measured with `getBBox`, fitted to the footprint, drawn only when it is legible; the black plate and the base-centroid anchor disappear.                                                                                                                                               | inline | `src/components/CampusMap.tsx`, `src/map/geometry.ts` (+tests)                                                                                                                                                                    | `vp test`, the journey's key assertion, the screenshots                          | done   | La chapa negra desapareció: la clave toma el tono de la superficie en la que cae (el tejado claro o la franja oscura de la base) y su tamaño se mide contra el edificio que nombra                                                                                                                                                                                                                                                                                                    |
| T4  | S6         | The chrome: the pin's label and the zone's chip stay inside the viewport; the dialog's title wraps; the map stops zooming while a dialog is open.                                                                                                                                               | inline | `src/components/CampusMap.tsx`, `src/App.tsx`, `src/components/Modal.tsx`                                                                                                                                                         | `vp test`, the journey's new assertions, the screenshots                         | done   | Las etiquetas que no son arte (el nombre del pin y el de la zona) se contramuestran con `--zoom`: a 6× ya no son una losa. El nombre del pin se dobla antes de salirse de la ventana                                                                                                                                                                                                                                                                                                  |

### Risks per task

| Task | Risk                                                                                       | Mitigation                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| T1   | The traced ground loses the campus's fine structure and reads as a blob                    | the prototype in L4 shows the silhouette reading as the campus; the surface's own tone carries the streets |
| T1   | The morphological closing rounds the buildings' corners too much                           | the radius is derived from the construction's own size (a quarter of its smaller side, capped)             |
| T1   | The closing merges two buildings that are close                                            | the closing runs per construction, never over the whole mask                                               |
| T1   | Deleting the raster breaks the API's seeded `zones` table                                  | the reseed note in the handoff; the table is derived from the same generated file                          |
| T2   | The wall's floor makes the small buildings' heights jump when the zoom crosses a threshold | the floor is only a floor; the journey asserts the wall grows, not that it grows smoothly                  |
| T3   | Measuring the key costs a layout pass per frame                                            | the measurement happens once per zone per zoom change, not per frame                                       |
| T4   | Making the map inert while a dialog is open leaves the map unresponsive                    | the inert state is scoped to the dialog and restored when it closes                                        |

---

## Log

**L1 — 2026-10-23 — The request (verbatim):**

> "actualmente tengo problemas para desarrollar el mapa 3D que va a ser la principal característica
> de UI/UX para el proyecto, donde ocupo que se vea bonito, sin líneas ni trazos raros, píxeles
> muertos, inconsistencias de tamaños, letras desbordadas de los edificiso y demás pero no logro
> conseguirlo con lo que tenemos actualmente. Te paso algunas imágenes para que lo analices y me
> digas tu veredicto y hacia donde podríamos ir."
> "El zoom también se ve afectado por la modal de detalles"
> "Horror visual"
> "Puedes analizar una reescritura total, parcial o migrar hacia alguna biblioteca de gráficos 3D,
> etc. Puedes analizar todas las opciones posibles."
> "Esto es solo planeación y reconocimiento, no escritura ni construcción."

**L2 — 2026-10-23 — The three questions the student asked, answered by the audit.** Is a rewrite
needed? Yes, but not of the renderer: of the DATA. Is a 3D library needed? No, and the reasons are
in L3. What would a rewrite cost? Four work units, one branch, no new dependency.

**L3 — 2026-10-23 — Why not Three.js.** The plan carries no heights, so a WebGL "3D" would be as
invented as the SVG extrusion; it would destroy the accessible 90-option DOM listbox, cost 150–600 KB
and a WebGL context on low-end Android, and replace the zoom algebra with a camera and a raycast.
The 44 px hit-area contract, the offline requirement and the a11y path all argue for SVG.

**L4 — 2026-10-23 — The ground premise, validated before the plan was written.** A throwaway
prototype (no repository file) rebuilt the ground from the raster's flat 13-colour palette and
rendered it: the campus reads as a diagonal band with its lawns, its athletics track, its courts and
its brick lots, and the empty area of the plan reads as the page. The surface's components are
157 953 px (the campus), 24 099 px and 9 208 px (two annexes) plus five specks under 600 px.
**The campus's content bbox is 667 × 604 px inside the 700 × 647 canvas, so cropping the artwork
would gain 5 %: the "crop the empty area" idea was measured and DROPPED from the plan.**

**L5 — 2026-10-23 — The footprint premise, validated the same way.** A morphological closing of
radius 5 on the constructions' own blobs removes the plan's printed codes and the notches in one
operation: the "A" building's two 9 × 13 bites and the "AG" bar become clean rectangles, and the
codes disappear from inside the buildings. The plan's offset shadow copies survive as separate
components and are dropped as slivers (a fragment whose smaller side is under 4 px is a shadow copy,
not a wing).

**L6 — 2026-10-23 — The recommendation the student approved.** One path: a vector scene, the plan
view, no new dependency, no camera change. The axonometric camera is explicitly DEFERRED, not
discarded: the zoom algebra is affine, so the seam (`extrudePolygon`, the only place a footprint
becomes a screen shape) still allows the tilt later without a rewrite. The projection abstraction was
proposed and then dropped: there is no camera to change yet, and an abstraction with no consumer is
over-engineering.

**L7 — 2026-10-23 — The height rule changes on purpose.** The previous phase locked the wall's
height as a constant in screen pixels (L12 of `croquis-3d.md`) so the relief would be visible on a
phone. That choice is what makes the volumes read as flat plates at high zoom (S4). The new rule
keeps a screen floor but makes the height proportional to the zoom:
`wallPx = clamp(altura_unidades × escala, MIN_WALL_PX, MAX_WALL_PX)`, capped by the building's own
size. The requirement change is recorded here and the affected spec (S4) and task (T2) are the only
ones that change.

**L8 — 2026-10-23 — Reseed note.** The catalogue's polygons change with the cleaned footprints. The
API seeds the `zones` table only when it is EMPTY, so a deployed database keeps the old polygons
until `TRUNCATE zones`. The table is derived from the same generated file; the note belongs in the
handoff.

**L9 — 2026-10-23 — The review slice.** The branch `feature/objetos-perdidas-itm` carries 29 047
authored changed lines over 77 commits since `origin/main`: the whole project's work, not this
phase's. This phase's four work units are ITS review slices, and the branch needs a chained PR
(stacked, one per work unit) before it is opened — a single PR would put 29 k lines in front of one
reviewer. Opening the PRs is the user's decision, not the phase's.

**L15 — 2026-10-24 — The chain is open.** The branch became twelve stacked PRs
(`#1` … `#12`), each one a thematic slice and each one compared against the tip of the previous:
`#1` the base and the addressable croquis, `#2` the schema and the domain rules, `#3` the HTTP
API, `#4` the accessible dialog, `#5` the missing states and the phone, `#6` the 3D croquis, `#7`
the app against the real server, `#8` the marker per zone and the CI, `#9` the screen-space
relief, `#10` the surfaces and the motion system, `#11` the TypeScript migration, `#12` the vector
scene. Every body states its boundaries, its dependencies, what it leaves out and the diagram of
the chain. **No PR is a tracker:** the slices land one after another, and the CI runs from `#8` on
because that is the commit that added the workflow.
**What the CI caught on the way:** the `/health` test depended on the ORDER of the tests — the
pool is built once and cached with the first `DATABASE_URL` it sees, so the test that only moved
the variable passed locally and failed in the runner, where another test had already built the
pool with the real URL. The probe is mocked now (as the sibling case already did), and the fix
travels down the chain so every gate is green.

**L10 — 2026-10-23 — T1 landed: the map is a scene.** The generator classifies the plan once and
emits two things: `src/map/scene.ts` (the ground: three campus surfaces, twenty greens, the
track, the court and seven brick lots — 32 shapes, 834 vertices) and `src/map/zones.ts` (the
catalogue with clean footprints). `public/mapa-itm-dark.png` is deleted, and with it the
artwork's loading and error states: the croquis is inside the bundle, it cannot fail to
arrive. The journey asserts the artwork holds no image and that the map paints without one.
**What the closing healed:** 66 printed codes and the bites they cut, and the plan's offset
shadow copies (one sliver dropped). The fragments with notches went from 33 of 65 to 14 of 53,
and the catalogue's total vertices from over a thousand to 313.

**L11 — 2026-10-23 — Three things the data said that the plan did not.** The surface is not one
shape but three: the plan's own two avenues cut the campus from the METAL-MECÁNICA band and
the POSGRADO annex, and a closing cannot bridge an open gap. **No construction is drawn in two
pieces any more**: the closing heals the codes that used to cut them, so the catalogue carries
one polygon per construction and the `fragments` field is only published when a plan really
draws a building in pieces. And the plan's codes do not reach the map at all: the raster is
gone, so the nineteen ghosts that survived as paper holes inside the buildings died with it.

**L12 — 2026-10-23 — T2 and T3 landed together.** The relief and its keys are one gesture: a
volume that reads as a volume needs a wall that grows with the zoom, and a key that reads needs
to be printed on the surface it lands on. The height moved to plan units (7/10/15 — the use the
legend declares, in metres of the plan) with a floor of seven pixels for the phone. The key
lost its black slab: it takes the roof's dark tone on the roof and the light tone on the strip
of the base that shows under it, and its size is measured against the building it names.

**L13 — 2026-10-23 — The hit test had a bug of its own.** The roof pass of `zoneAtPoint` gave
a roof to EVERY zone, including the flat ones, and used the family's raw height: a parking lot
had a phantom roof, displaced by the family's height, that swallowed the building next to it —
on a phone, where a unit is half a pixel, the displacement was twenty units. A tap on "2K"
resolved "Estacionamiento 1". Only the constructions have a roof now, and it is the roof that
is drawn. The journey's two blocks about the raster were replaced by the assertion that the
artwork is vector, and its block about a tap on a fragment became a block about a tap on the
real shape, because no construction is split any more.

**L14 — 2026-10-23 — The evidence.** `vp test`: 387 pass (368 before the phase, plus 19 new).
`vp check`: clean (format, lint, types). `vp build`: OK. The demo journey: 376/376 assertions,
0 console errors, 2 viewports. Lightpanda's semantic tree: the listbox and its 90 named options.
The full-stack journey: 26/26 against a real Postgres. The artwork's 50 KB raster is gone; the
scene that replaced it is 40 KB of generated TypeScript.
