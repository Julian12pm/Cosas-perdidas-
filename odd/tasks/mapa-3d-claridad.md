# El croquis 3D de verdad — letras dentro, sin ruido y con cada edificio en su sitio

**Objective:** que el mapa se vea como un mapa 3D: cada edificio es un volumen con su clave
encajada dentro, el fondo no tiene ruido de píxeles ni de palabras, y cada pin y cada nombre caen
sobre la construcción que nombran.
**Branch:** `feature/objetos-perdidas-itm` (SAME BRANCH).
**Delivery strategy:** one branch, one PR, reviewed per work-unit commit. Four work units.
**Test runner:** `vp test` (366 unit/integration tests) · `vp exec node scripts/smoke-journey.ts`
(the demo journey, 366 browser assertions, 2 viewports) · `vp exec node scripts/smoke-api.ts` (the
full-stack journey, 26 assertions) · `vp check` · `vp build`.

**Status: PLANNED. Nothing of this phase has been built yet.**

---

## Why this phase exists

The user looked at the map and said what is missing: progress and clarity. The words "letters inside
the buildings", "no visual noise of pixels nor letters" and "the locations are not centred on the
buildings". Five images, and they are all true.

An audit of the pipeline (the generator that reads the official plan, the catalogue it writes, the
SVG that draws the relief) found the causes:

| #   | What the user sees                                                            | Cause                                                                                                    | Where                                             |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | The plan's own words in the background ("2C", "ESTACIONAMIENTO", the compass) | every dark pixel is painted as `ink` (bright `#a1adc6`); the printed text IS dark pixels                 | `scripts/extract-zones.ts:1316-1320`, `isInk:347` |
| 2   | Speckles of one or two pixels on the pavement and the grass                   | the painter is per pixel and has no notion of an isolated pixel                                          | `scripts/extract-zones.ts:1308-1354`              |
| 3   | The roof of a small building slides off it and leaves a slab over the grass   | the wall is a fixed height in SCREEN pixels while the footprint is 5-12 units; the roof slides `h/scale` | `src/map/geometry.ts:786-803`                     |
| 4   | The key of a building is printed outside its footprint                        | the key is anchored to the roof's centroid, and the roof is the base displaced towards the light         | `src/components/CampusMap.tsx:545,750-763`        |
| 5   | The volumes cover each other the wrong way round                              | the painter's order is descending: the near volumes are painted first and the far ones over them         | `src/components/CampusMap.tsx:559`                |
| 6   | Big translucent rectangles over the map                                       | the parkings are painted twice: the raster already has them, the SVG fills them again                    | `src/components/CampusMap.tsx:702-715`            |
| 7   | A huge brown mass where the safe points are                                   | the amber ramp's roof/base jump is 7.5:1 and the safe point `AF` is the tallest volume                   | `src/index.css:114-128`                           |
| 8   | A black tooltip over the map with the plan's title                            | the SVG carries a `<title>`, so the browser paints its own tooltip                                       | `src/components/CampusMap.tsx:700`                |
| 9   | The pin of the athletics track points at the swimming pool                    | the track's geometry is the BOX around the oval, and the label is anchored to the centre of that box     | `scripts/extract-zones.ts:1519-1542`              |
| 10  | The pin of the cafeteria is on the lawn                                       | the demo pins carry hardcoded percentages that the generator's re-tracing left behind                    | `src/data.ts` (MOCK_PINS)                         |

---

## Specs

### S1 — El fondo no tiene palabras

The plan's printed text, street names, the compass and the title card are NOT in the artwork the app
draws: the app prints its own keys.
Scope: the generator's painting loop.
Acceptance: the dark artwork contains no glyph of the original plan; the keys the app prints are the
only letters on the map.
Checks: the regenerated artwork, the journey's screenshots, and a diff of the artwork's pixels.

### S2 — El fondo no tiene píxeles huérfanos

No isolated pixel survives in the artwork: a lone dark pixel is not a line, and a lone grey pixel is
not a kerb.
Scope: the generator's painting loop.
Acceptance: the artwork's isolated specks are gone and the pavement, the kerbs and the street mesh
survive.
Checks: the regenerated artwork (before/after) and the screenshots.

### S3 — El tejado se queda en su edificio

A building's roof may never slide off its own footprint: the wall's height is the family's height,
capped by the building's own size.
Scope: `extrudePolygon` and the scene's heights.
Acceptance: for every construction, the roof overlaps its own base.
Checks: the geometry's tests (a new invariant), the journey's wall assertion.

### S4 — La clave cabe dentro de su edificio

The key is printed on the roof, sized to the building: never larger than the building, and only
drawn when it is legible.
Scope: the scene's code size and anchor.
Acceptance: the key's box is inside the building's footprint, and the key is at least 7 px when it is
drawn.
Checks: a new journey assertion (the key is inside its building) and the screenshots.

### S5 — Los volúmenes se pintan de atrás hacia delante

The far volumes are painted first, so the near ones (and their roofs) cover them.
Scope: the scene's sort.
Acceptance: the order is the painter's order for a light from the upper left.
Checks: the screenshots (a near building's roof is never covered by a far one).

### S6 — El mapa no se pinta dos veces

The SVG does not fill the areas the raster already draws (the parkings).
Scope: the scene's flats.
Acceptance: the flats are not filled over the artwork.
Checks: the screenshots (no translucent rectangle over the map).

### S7 — El relieve se lee: los tonos no son un salto

The relief's ramp keeps its ratios (the roof reads against the wall, the wall against the base) but
the mass of the roof against the base is not a black cliff.
Scope: `src/index.css`'s relief tokens (and the safe points' ramp).
Acceptance: the ramp's documented ratios still hold and the roof/base mass is not the loudest
contrast on the map.
Checks: the journey's contrast assertions, the screenshots.

### S8 — Ni el navegador ni el mapa hablan de más

The SVG carries no `<title>` (the browser's tooltip is not the app's), and the zone's label is a
quiet chip, not a black slab.
Scope: the SVG and the zone's label.
Acceptance: no native tooltip over the map; the label reads without covering the building.
Checks: the screenshots.

### S9 — Cada pin y cada nombre caen sobre lo que nombran

The demo's pins are derived from the catalogue (not hardcoded percentages), and the athletics
track's geometry is its ring (not the box around it).
Scope: `src/data.ts` and the generator's track.
Acceptance: every demo pin sits on the building it names; the track's label and pin sit on the
track.
Checks: a journey assertion (the pin of each seeded report is inside its zone's footprint), the
screenshots.

---

## Invariants (what must NOT break)

| #   | Invariant                                                                      | Where it is asserted              |
| --- | ------------------------------------------------------------------------------ | --------------------------------- |
| I1  | The 366 unit tests, the demo journey (366) and the API journey (26) stay green | every gate                        |
| I2  | "What you see is what you touch": a tap on the roof resolves that building     | the journey's roof and base taps  |
| I3  | The relief keeps its three tones and its documented ratios                     | the journey's contrast assertions |
| I4  | A building is still a volume, not a slab: the wall is visible                  | the journey's wall assertion      |
| I5  | The zone listbox keeps one tab stop, its 90 named options and its live region  | the journey, lightpanda's tree    |
| I6  | The API contract, the domain rules and the catalogue's schema are untouched    | the API's own tests               |
| I7  | The app still builds with the same dependencies: no runtime package is added   | `vp build`                        |
| I8  | The demo mode and the API mode keep producing the same interface               | both journeys                     |

---

## Decisions locked

| Question                 | Decision                                                                               | Why                                                             |
| ------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| The keys' size           | Proportional to the building, capped at 13 screen px, and drawn only when it is ≥ 7 px | a key that does not fit is not a key; the legend names the rest |
| The keys' anchor         | The roof's centroid, and the roof no longer leaves the building (S3)                   | the key is printed on the face the student sees                 |
| The wall's height        | The family's height, capped by the building's own size (S3)                            | a wall taller than the building reads as a slab                 |
| The painter's order      | The far volumes first (ascending depth)                                                | the roof of a near building must cover the one behind it        |
| The parkings             | Not filled by the SVG                                                                  | the raster already draws them; painting twice is the noise      |
| The plan's words         | Erased from the artwork                                                                | the app prints its own keys                                     |
| The demo pins' positions | Derived from the catalogue                                                             | the catalogue moves when the plan is re-traced                  |
| The track                | Its ring, not the box around it                                                        | a pin on the infield points at the pool                         |

---

## Tasks

| ID  | Specs          | Work                                                                                                                           | Route  | Status  | Verification                                  |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | --------------------------------------------- |
| T1  | S1, S2         | The generator's painting loop: the plan's words out, the orphan pixels out, the kerbs in.                                      | inline | done | the regenerated artwork + the journey (366/366) + the unit tests |
| T2  | S3, S5         | The roof stays on its building (the wall capped by the size) and the painter's order is the right way round.                   | inline | planned | the geometry's tests + the journey            |
| T3  | S4, S6, S7, S8 | The key fits its building, the map is not painted twice, the relief's tones stop shouting, no native tooltip, a quieter label. | inline | planned | the journey's new assertions + the shots      |
| T4  | S9             | The demo's pins come from the catalogue and the track is its ring.                                                             | inline | planned | the journey + the screenshots                 |

### Risks

| Task | Risk                                                                                   | Mitigation                                                                     |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| T1   | Erasing the ink also erases the plan's outlines (the campus's edge, the area lines)    | the long runs stay as `hairline` (the conservative variant)                    |
| T1   | The isolated-grey filter erases a one-pixel kerb                                       | the pavement is a dense area (density ≥ 0.45) and a line has neighbours        |
| T2   | Capping the wall breaks the previous phase's "the wall is a constant in screen pixels" | the cap only bites the buildings that are smaller than the wall                |
| T2   | The painter's order changes what the screenshots show                                  | the journey's screenshots are the evidence; the order is argued from the light |
| T3   | A key that is proportional is unreadable on a phone at 1×                              | the key is only drawn when it is ≥ 7 px; the legend names the rest             |
| T3   | Softening the relief's ramp breaks the documented contrast ratios                      | the journey asserts the ratios; the tokens are the only thing that changes     |
| T4   | The demo's pins move, so the journey's pin coordinates change                          | the journey asserts the pins are inside their zone's footprint                 |

---

## Log

**L1 — 2026-10-23 — The request (verbatim):**

> "Al mapa le falta mucho progreso además de mayor claridad, quitar palabras, encajar palabras
> dentro de los edificios, mejorar píxeles huérfanos y claridad. Piensa de manera más profunda y ODD
> el mejoramiento del mapa para que se vea un mapa 3D, con las letras bien encajas en cada edificio,
> sin ruido visual de píxeles ni letras. [...] También parece que las ubicaciones están mal centradas
> según los edificios: [...] Dice pista de atletismo pero señala la alberca de natación. Apóyate
> fuertemente de Codegraph como buscador e indexador de código, además de usar subagentes."

**L2 — 2026-10-23 — What the audit found.** Ten causes, listed in the table above. The three that
matter most: the wall's height is a constant in screen pixels while the footprints are 5-12 units
(the roof slides further than the building is big, so the key falls outside and the volume reads as
a slab); the painter's order is descending, which is the wrong way round for a light from the
upper left; and the demo's pins carry hardcoded percentages that the generator's re-tracing left
behind (the pin of the cafeteria is on the lawn).

**L3 — 2026-10-23 — The invariants this phase breaks on purpose.** The previous phase decided that
the key is at least 11 screen pixels (`scripts/smoke-journey.ts`) and that the wall is at least
7 pixels (`MIN_WALL_PX`). Both are incompatible with "the key fits inside its building" on a phone
at 1×, where the smallest building is 3.6 pixels tall. The product decision is the user's: the key
fits, and a key that cannot be read is not drawn (the legend names every zone anyway). The journey's
assertions change with it.

**L4 — 2026-10-23 — The words of the plan are grey, not black.** The first attempt assumed the
printed text was ink (the black of the plan) and erased it. It did not work, and the reason is worth
remembering: the plan is a photocopy, and its TITLES are printed in LIGHT GREY (the samples around
"UNIDAD METAL-MECANICA" are 181-236, not 0-40), so they never reach the `ink` branch at all. They
reach the `hairline` branch, together with the plan's real lines.

So the discriminator is not the colour but the SHAPE: a line of the plan (a kerb, the edge of a lawn,
the axis of a street) is a long continuous run, and a letter is a short stroke. A grey pixel that
runs seventeen pixels or more is a line and survives; anything shorter is a letter and does not reach
the artwork. On top of that, the black codes printed over the coloured areas leave a coloured halo
(the antialiasing of a black stroke over orange is not grey), and that halo is recognised by being
touching the ink.

What is left of the plan in the artwork: the buildings, the lawns, the pitches, the paths, the
track, the pool and the two hand-over points. The artwork went from 110 KB to 51 KB and the words of
the plan are gone: the titles of the units, the compass, the codes by the doors, the street names and
the "DATOS GENERALES" box.