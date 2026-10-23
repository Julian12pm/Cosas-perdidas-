# Superficies y movimiento — un solo sistema para toda la app

**Objective:** collapse the interface's improvised surfaces into ONE declared recipe and give the motion layer a scale, so the app reads as one product instead of five ideas — and so nothing on the screen depends on a hover a phone can never produce.
**Branch:** `feature/objetos-perdidas-itm` (SAME BRANCH — the user asked for the next step to be recorded here; this phase is PLANNED, not built).
**Delivery strategy:** one branch, one PR, reviewed per work-unit commit. Forecast ≈ 350 authored changed lines over 6 work units.
**Test runner:** `vp test` (356 unit/integration tests) · `vp exec node scripts/smoke-journey.mjs` (the demo journey, 356 browser assertions) · `vp exec node scripts/smoke-api.mjs` (the full-stack journey, 26 assertions) · `vp check` (format + lint + types).

**Status: PLANNED. Nothing in this phase has been built yet.**

---

## Why this phase exists

A read-only UI audit scored the four dimensions the user asked about and found the seams:

| Dimension        | Score | The finding                                                                                                                                                                                                         |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3D modelling     | 2/5   | the relief was invisible at phone size (fixed in the previous phase)                                                                                                                                                |
| Touch            | 2/5   | the vertical swipe was swallowed (fixed in the previous phase)                                                                                                                                                      |
| Motion           | 3/5   | a real token layer and a correct `prefers-reduced-motion`, but no scale, no exit, five infinite loops, one dead keyframe, and three hover-only transitions                                                          |
| Cards & surfaces | 3/5   | ONE neutral recipe shipped with three elevations, four border opacities and six fills; the map frame broke the family; "Mis reportes" and "Bandeja" — two sibling list views — disagreed on radius, fill and shadow |

This phase closes the last two.

---

## Specs

### S1 — One neutral panel recipe, declared as tokens

The same neutral recipe (`border-surface-600/50` + `bg-surface-800`) currently ships with `shadow-lg`, with `shadow-2xl` and with **no shadow at all**. Elevation stops being a signal when everything is raised differently.
Scope: the recipe and its variations live in `src/index.css` as `@theme` tokens (`--radius-panel`, `--color-panel`, `--color-panel-border`, `--shadow-panel`, plus the raised-row and inset variants). Every top-level surface in the app uses them.
Acceptance: no component declares a panel's own border/fill/shadow/radius; the map frame, the legend panel, the report card, the claim row, the state panels, the picker dropdown, the modal, the cluster entries and the login card all resolve to the same recipe.
Checks: a grep gate proving the surfaces no longer hardcode their own `border-surface-600/…`, `bg-surface-800…` or `shadow-*`; the journey's screenshots.

### S2 — The surface roles are named

Scope: the app needs three named roles, not six improvised fills:

- **panel** — a top-level container (the report card, the modal, the legend, the map frame, the login card);
- **row** — a raised list item inside a panel (the claim row, the cluster entry, the legend row);
- **inset** — a quiet block inside a row or panel (the blind detail, the release-key block).
  The accent recipe (`border-brand-500/30` + `bg-brand-500/10`) stays as a fourth role, used only for the contact card and the release key.
  Acceptance: every surface in the app maps to exactly one role.
  Checks: the audit's grep of the fill/border/shadow/radius sites shows one value per role.

### S3 — The map frame stops breaking the family

Scope: the croquis frame is the biggest surface on the screen and the only one with a 2 px border, a `surface-700` border and radius 12 where every sibling panel is 16.
Acceptance: the map frame uses the panel recipe like every other container.
Checks: the visual review of the screenshots.

### S4 — The two sibling views agree

Scope: "Mis reportes" and "Bandeja" show the same kind of data (a report and its state) and must look like the same kind of thing.
Acceptance: same radius, same fill, same elevation, same internal rhythm (a title row, a muted metadata row, a status chip).
Checks: the visual review; the journey's screenshots.

### S5 — The motion layer gets a scale

Scope: five durations (150/200/300/400/500 ms) and four timing idioms exist with no rule behind the choice.
Decision: publish `--duration-fast` (150 ms), `--duration-base` (200 ms), `--duration-slow` (300 ms), `--duration-entrance` (500 ms) and `--ease-entrance` (`cubic-bezier(.34,1.56,.64,1)`, the one easing already used consistently) plus `--ease-exit`.
Acceptance: every `transition-*`/`duration-*` in the components picks from the scale; no literal duration remains.
Checks: a grep gate for the literal `duration-150|200|300`.

### S6 — The modal has an exit

Scope: `Modal.jsx` returns `null` the instant `open` turns false, so the panel scales in over 0.3 s and vanishes in one frame.
Acceptance: the dialog plays an exit on the same bezier family before it unmounts, and `prefers-reduced-motion` still neutralises it.
Checks: the journey's screenshots with the reduced-motion emulation.

### S7 — The infinite loops are bounded

Scope: five infinite animations run at once — two pin pulses, two decorative header dots, one pending-marker ping.
Decision: the pin pulse STAYS infinite (it is the product's "this pin is live" signal); the two header dots become static (they carry no information and they pulse on every screen forever); the pending marker keeps its ping.
Acceptance: at most one infinite animation per screen, and it is meaningful.
Checks: a grep of the infinite animations with their usage count.

### S8 — The abrupt changes get transitions

Scope: switching views ("Mapa" → "Mis reportes"), collapsing the legend and opening the picker dropdown all happen in one frame.
Acceptance: the view switch cross-fades; the collapse animates its height; the dropdown scales in.
Checks: the journey's screenshots.

### S9 — Nothing depends on a hover

Scope: three affordances are desktop-only — the pin's tooltip (item + zone), the croquis's zone-name chip, and the legend→croquis highlight (advertised in the copy as "Pasa el cursor por una fila…"). On a phone the map carries no readable building name at all.
Acceptance: each of them also answers to press/tap/focus; the legend's copy stops promising a cursor.
Checks: the journey asserts the zone name appears after a TAP on a zone.

### S10 — The system, not patches

Scope: `-webkit-tap-highlight-color: transparent` and the 12 px text floor are currently global patches in `src/index.css` that override components.
Acceptance: they stay (they are the right place for cross-cutting rules) and are documented as such.
Checks: the review of `src/index.css`.

---

## Invariants (what must NOT break)

| #   | Invariant                                                                                                      | Where it is asserted               |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| I1  | The zone listbox keeps ONE tab stop, 90 named options, `aria-activedescendant` and the live region             | the journey, lightpanda's tree     |
| I2  | Every interactive control keeps a ≥ 44 px target and a visible focus ring                                      | the journey                        |
| I3  | The dialog keeps `role="dialog"`, `aria-modal`, the focus trap, Escape and the focus restore                   | the journey, the a11y pass         |
| I4  | The relief keeps its screen-space wall (10 px at 1× and 6×), its three tone ratios and the roof-first hit test | the journey's 36 relief assertions |
| I5  | The vertical swipe scrolls the page at 1× and pans the map when zoomed                                         | the journey                        |
| I6  | The 350+ unit tests, the demo journey (356) and the API journey (26) stay green                                | every gate                         |
| I7  | The API contract, the domain rules and the catalogue are untouched                                             | the API's own tests                |
| I8  | The demo mode and the API mode keep producing the same interface                                               | both journeys                      |

---

## Decisions locked

| Question             | Decision                                                                                              | Why                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| How many elevations? | **One** (`--shadow-panel`) for panels, none for rows and insets                                       | elevation must carry hierarchy, not decoration          |
| Panel radius?        | `2xl` (16) everywhere, `xl` (12) for rows, `lg` (8) for insets                                        | one ladder, used by role                                |
| Panel border?        | `border-surface-600/50` everywhere                                                                    | the app already had four opacities                      |
| Panel fill?          | `bg-surface-800` for panels, `bg-surface-700/40` for rows, `bg-surface-800/70` for insets             | three roles, three values                               |
| Durations?           | fast 150 / base 200 / slow 300 / entrance 500 ms                                                      | the four that already existed, named                    |
| Easings?             | `--ease-entrance` (`cubic-bezier(.34,1.56,.64,1)`) and `--ease-exit`                                  | the entrance bezier is the one thing already consistent |
| The pin pulse?       | Stays infinite                                                                                        | it is the product's "live pin" signal                   |
| The header dots?     | Become static                                                                                         | they carry no information and pulse forever             |
| `transition-all`?    | Replaced by the explicit property (`transition-colors`, `transition-transform`, `transition-opacity`) | `transition-all` fights the pulse over `box-shadow`     |
| Hover affordances?   | They also answer to press/tap/focus                                                                   | on a phone the map currently carries no readable name   |

---

## Tasks

| ID  | Specs      | Work                                                                                                                                                                                       | Route  | Status  | Verification                                              |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | --------------------------------------------------------- |
| T1  | S1, S2     | Declare the surface tokens in `src/index.css` (`--radius-*`, `--color-panel*`, `--shadow-panel`) and the three roles.                                                                      | inline | planned | the token grep + the visual review                        |
| T2  | S1, S3, S4 | Apply the recipe to every surface: the map frame, the legend panel, the report card, the claim row, the state panels, the picker dropdown, the modal, the cluster entries, the login card. | inline | planned | the visual review of both journeys' screenshots           |
| T3  | S5         | Publish the motion scale and move every literal duration/easing to it; replace `transition-all` with explicit properties.                                                                  | inline | planned | the duration grep                                         |
| T4  | S6, S7, S8 | The modal's exit, the bounded loops, the cross-fade on the view switch, the animated collapse and dropdown.                                                                                | inline | planned | the journey's screenshots (including with reduced motion) |
| T5  | S9         | The hover-only affordances answer to press/tap/focus; the legend's copy stops promising a cursor.                                                                                          | inline | planned | the journey asserts the zone name after a TAP             |
| T6  | S10        | The cross-cutting rules documented; the whole visual review, screenshot by screenshot.                                                                                                     | inline | planned | the full review                                           |

### Risks

| Task | Risk                                                                                                           | Mitigation                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T2   | Touching every surface is a wide diff and can break the journey's selectors                                    | the journey's 356 assertions are the gate; the `data-testid` contract does not change |
| T2   | The accent recipe (the contact card, the release key) is a FOURTH role and could drift back into improvisation | the role is declared and its two usages are pinned by the review                      |
| T4   | An exit animation means the modal stays mounted briefly → the focus restore must happen at the right moment    | the restore stays on unmount; the journey's keyboard assertions cover it              |
| T4   | `prefers-reduced-motion` must neutralise the new exit too                                                      | the reduced-motion block stays global and is re-verified                              |
| T5   | A press state on touch can stick after the tap                                                                 | the press state is time-boxed or released on `pointerup` outside                      |

---

## Log

**L1 — 2026-10-23 — The decision (verbatim):**

> "T19: un sistema de superficies y de movimiento"

**L2 — 2026-10-23 — Context.** The previous phase closed the croquis (T1–T6) and the screen-space relief. The UI audit then scored the app 2/5 on the 3D, 2/5 on touch, 3/5 on motion and 3/5 on cards; the first two were fixed, and this phase takes the last two. Nothing of this phase has been built: it is the recorded NEXT STEP.

**L3 — 2026-10-23 — What the audit found, in its own words.** One recipe with three elevations; the map frame breaking the family; "Mis reportes" and "Bandeja" disagreeing on radius, fill and shadow; six fills for the "raised row" role and five border opacities; the report card's internal hierarchy inverted (the container is quieter than the panels inside it); text at 10 px and 11 px; a modal with an entrance and no exit; five durations with no rule behind them; five infinite loops; one dead keyframe; three hover-only transitions.
