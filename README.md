# Objetos Perdidos ITM

A campus lost & found for Instituto Tecnológico de Morelia. Students report what they lost
(🔴 red pin) and what they found (🟢 green pin) directly on an interactive croquis of the
campus, and the two sides are matched through a claim inbox with a release key that closes
the case.

> **Status: the product works end to end.** The API, the database, the domain rules, the vector
> croquis and the web app are built and covered by tests: 350 unit tests plus two browser journeys
> (the demo mode and the full stack against a real Postgres). The institutional login still uses the
> console transport until the institute delegates a sending domain. The full architecture is
> specified in [`odd/tasks/objetos-perdidas-itm.md`](odd/tasks/objetos-perdidas-itm.md).

---

## The product

| Mechanic                 | What it means                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Croquis, no GPS**      | GPS is useless inside classrooms, so the campus is drawn in 2D and the reporter taps the exact spot on the artwork.                                                   |
| **Dual colour code**     | 🔴 red = "I lost something here", 🟢 green = "I found this, whose is it?".                                                                                            |
| **Institutional access** | Sign-up is restricted to `@morelia.tecnm.mx` (and `@itmorelia.edu.mx`) mailboxes, verified by magic link. No anonymous reports.                                       |
| **Blind report**         | A green pin publishes a sanitized description only. The identifying details stay private to the reporter.                                                             |
| **Ownership check**      | The claimant proves ownership by describing the object and giving the blind datum, through the claim inbox.                                                           |
| **Release key**          | The owner of the lost item dictates a numeric key to the student who physically holds the object. That student enters it, the case closes and the pins leave the map. |
| **Safe points**          | The finder can deposit the object at a safe point (Library, Dean's office). The map then shows it _in custody_ there.                                                 |
| **Strikes**              | Rejecting a delivery gives the claimant a strike. A strike is an accusation: bans are applied by an admin after review.                                               |
| **Automatic expiry**     | `open` pins expire after 72 h so the map stays readable. A case _in custody_ keeps 30 days — the object is physically somewhere.                                      |

There is **no internal chat**. Once a claim is approved, both sides coordinate over WhatsApp,
email or Teams using a contact card that reveals the name and institutional email on hover or
click.

---

## Stack

| Layer           | Choice                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Toolchain       | **Vite+ (`vp`)** 1.3.0 — install, dev, build, lint (Oxlint), format (Oxfmt), type check and test in one tool |
| Package manager | **pnpm** 12.14.0 (pinned through `packageManager`)                                                           |
| Runtime         | **Node 24.22.1** LTS (pinned through `.node-version`)                                                        |
| UI              | React 19, Vite 8, Tailwind CSS 4 (CSS-first `@theme` in `src/index.css`)                                     |
| Language        | **TypeScript** everywhere (strict), from the browser bundle to the scripts                                   |
| Tests           | Vitest 5 (bundled with Vite+) via `vp test`                                                                  |

**Backend** (built): Hono 4.13 + Zod 4.6 contracts, PostgreSQL 16 with Drizzle 0.45 (12 tables, generated
migrations), argon2-ready password hashing, opaque sessions, SSE for the inbox, `node-cron` for expiry and
PII purging, `sharp` planned for photos.

---

## The API

The server lives in `api/` inside the same package — one lockfile, one test runner, one CI. It runs on
Node 24's native TypeScript execution (no build step) and is type-checked by the root `tsc --noEmit`.

```bash
vp run db:up        # postgres:16 in Docker Compose
vp run api:migrate  # apply the generated migrations
vp run api          # http://localhost:3001
curl localhost:3001/health
```

| Route                                   | What it does                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/magic-link`                 | Requests the institutional magic link. Always answers **202** — it never reveals whether the address is registered.         |
| `GET /auth/magic-link/:token`           | Consumes the single-use token, creates the session, sets the `op_session` cookie.                                           |
| `POST /auth/logout` · `GET /auth/me`    | Ends the session · returns the current user.                                                                                |
| `GET /zones`                            | The campus catalogue (seeded from the generated `src/map/zones.js`).                                                        |
| `GET /reports`                          | The pins for the map, public projection only.                                                                               |
| `POST /reports`                         | Creates a report. A `lost` report returns the **release key once**; a `found` report keeps its identifying details private. |
| `POST /reports/:id/matches` · `/claims` | Links a lost report with a found one · files a claim with the blind datum.                                                  |
| `POST /claims/:id/decide`               | The report owner approves (releases the contact) or rejects (a strike against the claimant).                                |
| `POST /reports/:id/release-key`         | The holder confirms the delivery with the key the owner dictated. Wrong key → 422, exhausted budget → 429, replay → 409.    |
| `POST /reports/:id/custody`             | Deposits the object at a safe point or picks it up.                                                                         |
| `GET /reports/:id/contact`              | The contact card of the **other** party, only after an approved claim.                                                      |
| `GET /inbox` · `GET /events`            | The claim inbox · the SSE stream of notifications.                                                                          |

### Environment

Copy `api/.env.example` to `api/.env`. `DATABASE_URL`, `PORT`, `PUBLIC_URL`, `RELEASE_KEY_PEPPER` and
`SESSION_SECRET` come from the environment, never from the repository. `MAIL_TRANSPORT` is `console`
until the institute delegates a sending domain: the magic link is printed to the server log.

### How it is tested

`api/src/test/db.ts` boots **PGlite** — a real Postgres, in process — and applies the generated
migrations verbatim, so the routes run against actual SQL semantics without a container.
`api/src/e2e/claim-flow.test.ts` walks the whole journey: report → blind claim → approval → release key
→ the pins leave the map and the contact card appears.

---

## Requirements

- Node 24 LTS (the repo pins `24.22.1`; `vp` downloads it if missing)
- [Vite+](https://viteplus.dev) (`vp`) on `PATH`
- pnpm (Vite+ installs it if missing)

## Getting started

```bash
vp install        # install dependencies with pnpm (writes pnpm-lock.yaml)
vp dev            # dev server
vp build          # production build into dist/
vp preview        # serve the production build
vp test           # run the unit tests
vp check          # format + lint + type check
vp fmt --write    # format the sources
```

`vp` exposes the same tasks as package scripts, so `pnpm run build` also works — it runs
`tsc && vp build`, and `tsc` is what keeps the type gate honest (`vp build` alone does not
type check).

---

## CI

Every push and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml). A red
step fails the build: there is no `continue-on-error` anywhere.

| Step         | What it proves                                                         |
| ------------ | ---------------------------------------------------------------------- |
| `vp check`   | format, lint and types                                                 |
| `vp test`    | the 350 unit tests                                                     |
| `vp build`   | the production bundle                                                  |
| Demo journey | the browser walkthrough on the mock data (`scripts/smoke-journey.mjs`) |
| API journey  | the whole stack against a real Postgres 16 (`scripts/smoke-api.mjs`)   |

Two things the CI does **not** do: it downloads no browser (the journeys drive the Chrome the
runner already ships, through `CHROMIUM_PATH`) and it starts no container (the API journey walks
against the `postgres:16` **service** of the workflow, with the migrations applied against it
before the journey starts).

The same scripts run on a laptop, unchanged:

```bash
vp exec node scripts/smoke-journey.mjs   # demo mode, mock data
vp exec node scripts/smoke-api.mjs       # the whole stack (podman Postgres 16)
```

`CHROMIUM_PATH` says where the browser is (`/usr/bin/chromium` by default) and `DATABASE_URL` says
which Postgres the API journey uses: without it the journey brings up the container of the compose
file, with it the journey uses that database as it is and empties its own tables before it starts,
so a second run begins from the same state.

---

## Project layout

```
src/
  main.jsx          mount point (React.StrictMode)
  App.jsx           all UI: croquis, pin modals, claim inbox entry points
  data.js           mock pins, release-key generation, timestamp formatting
  index.css         Tailwind v4 theme tokens + keyframes
  map/
    geometry.js     pure coordinate helpers (letterbox-aware)
    geometry.test.js
public/
  mapa-itm.png      the official campus plan (846x647)
  favicon.svg
odd/tasks/
  objetos-perdidos-itm.md   the ODD plan: specs, stack, norms, architecture, tasks
```

## The map

The croquis is **drawn by the app**: an inline `<svg viewBox="0 0 700 647">` whose ground layer is
the official raster re-themed in the app's dark palette (`public/mapa-itm-dark.png`, written by the
generator), with every building standing on it as an extruded volume — a top face, the two walls
that face away from one light and a cast shadow.

The footprints are **traced from the raster's own pixels** (the plan prints each code over its
orange fill, so the holes are filled and the shape is eroded one pixel before the contour is
traced), and the heights come from the use the plan's own legend declares: a block of classrooms is
low, a workshop or a laboratory is medium, a gymnasium or the library is tall. Nothing is invented.

```
scripts/extract-zones.mjs   -> classifies the plan, paints the dark artwork, traces the
                               footprints and writes src/map/zones.js
src/map/zones.js            -> the catalogue: 90 zones with their code, name, unit, kind,
                               safe point, box and traced fragments
src/map/geometry.js         -> the pure maths: the coordinate model, the extrusion, the
                               hit testing and the zone search
```

The names are NOT drawn in the picture: the plan's baked legend was a lossy photograph of the
table the app already holds, so it became an HTML panel (`ZoneLegend`), searchable, with the
official plan in colour still reachable as a reference.

A tap resolves the **real shape** (`zoneAtPoint` over the traced fragments), not the button's box,
so tapping the wing of a building opens that building. Reports of the same zone are grouped in one
marker with a count, so nothing hides under the finger.

## The interface system

The interface has **one** surface recipe and **one** motion scale, declared once in
`src/index.css` and enforced by `src/design-system.test.js`.

**Surfaces.** A surface names its role and nothing else:

| Role   | Class            | Fill             | Radius | Elevation |
| ------ | ---------------- | ---------------- | ------ | --------- |
| panel  | `surface-panel`  | `surface-800`    | 16 px  | one       |
| row    | `surface-row`    | `surface-700/40` | 12 px  | none      |
| inset  | `surface-inset`  | `surface-800/70` | 8 px   | none      |
| accent | `surface-accent` | `brand-500/10`   | 8 px   | none      |

A component never declares its own border, fill, shadow or radius — the gate fails the build if
it does. The map frame, the legend, the report card, the claim card, the state panels, the picker
dropdown, the modal, the cluster entries and the login card are all the same recipe.

**Motion.** Four durations and two curves, and every transition names the property it animates:
`--duration-fast` (150 ms), `--duration-base` (200 ms), `--duration-slow` (300 ms),
`--duration-entrance` (500 ms), `--ease-entrance` and `--ease-exit`. `transition-all` is banned: it
fought the pin's pulse over `box-shadow` and the pin's hover shadow never showed.

**Cross-cutting rules.** Two of them live in `src/index.css` on purpose, because they belong to the
product and not to a component: the tap highlight is transparent everywhere, and no text is painted
below 12 px.

**Nothing depends on a hover.** The zone that was tapped says its name on the croquis, the pin's
name answers to focus and to the pressure of the finger, and the legend lights the zone with a tap.
A phone has no cursor, and the map has to work without one.

## Conventions

- **Artifact language**: code, comments, commits and docs are English. UI copy stays Spanish
  — the audience is the campus.
- **Commits**: Conventional Commits, one reviewable work unit per commit.
- **Tests first**: a new rule gets a failing test, then the implementation, then a refactor.
- **Types**: everything is TypeScript and strict — the browser bundle, the API and the scripts. The app's
  own shapes live in `src/types.ts`; the ones the API already validates are inherited from its zod
  contracts, so a contract change breaks the app's type check. No `any`, no `@ts-ignore`, no
  `as unknown as`. Node runs the `.ts` scripts with its own type stripping, so the code has to stay
  erasable.
- **No dead code**: nothing ships that nothing imports.
- **No false security**: never render a secret in the UI, never describe an unverified
  mechanism as a protection. The prototype used to print the release code on screen; that is
  gone, and the key is generated with `crypto.getRandomValues`.
- **Privacy by default**: public payloads carry type, sanitized title, zone, alias and age.
  Contact data is released once, after a valid claim. Photos are re-encoded without metadata.

---

## License

MIT — see [`LICENSE`](LICENSE).
