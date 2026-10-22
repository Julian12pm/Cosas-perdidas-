# Objetos Perdidos ITM

A campus lost & found for Instituto Tecnológico de Morelia. Students report what they lost
(🔴 red pin) and what they found (🟢 green pin) directly on an interactive croquis of the
campus, and the two sides are matched through a claim inbox with a release key that closes
the case.

> **Status: the backend is real, the web app is not wired to it yet.** The API, the database schema and
> the domain rules are built and covered by tests, including an end-to-end journey. The browser app
> still runs on mock data: it needs the institutional login and the live pins (plan task T21). The
> full architecture is specified in
> [`odd/tasks/objetos-perdidas-itm.md`](odd/tasks/objetos-perdidas-itm.md).

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
| Language        | JavaScript today, TypeScript by migration (`tsconfig.json` with `allowJs` + `jsx`)                           |
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

## The map coordinate model

The artwork is an `<img>` that the browser letterboxes inside its own box (`object-contain`
plus a max-height), so a percentage of the box is **not** a percentage of the artwork.

`src/map/geometry.js` owns the fix:

```
fitContain(box, natural)      → painted content box of the artwork
clientToArtwork(client, ...)  → artwork pixels, or null for a click on the padding
artworkToPercent(point, ...)  → the percentage format pins are stored in
```

Pins live in a layer that covers only the painted area, so a tap and the pin it creates land
on the same pixel of the plan at any viewport size. The next step (plan task T7) replaces the
raster with the vector croquis and a `zones` catalogue, so a report can reference a named
building instead of a free coordinate.

## Conventions

- **Artifact language**: code, comments, commits and docs are English. UI copy stays Spanish
  — the audience is the campus.
- **Commits**: Conventional Commits, one reviewable work unit per commit.
- **Tests first**: a new rule gets a failing test, then the implementation, then a refactor.
- **No dead code**: nothing ships that nothing imports.
- **No false security**: never render a secret in the UI, never describe an unverified
  mechanism as a protection. The prototype used to print the release code on screen; that is
  gone, and the key is generated with `crypto.getRandomValues`.
- **Privacy by default**: public payloads carry type, sanitized title, zone, alias and age.
  Contact data is released once, after a valid claim. Photos are re-encoded without metadata.

---

## License

MIT — see [`LICENSE`](LICENSE).
