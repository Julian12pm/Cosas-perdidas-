# Objetos Perdidos ITM — Architecture & Delivery Plan

**Objective:** turn the 906-line visual prototype into a real campus lost & found: institutional identity, a genuinely interactive campus croquis, and a server-side claim protocol that actually protects students.
**Branch:** `feature/objetos-perdidos-itm` (from `main` @ `9472461`)
**Delivery strategy:** `single-pr` per phase — one branch, one PR, reviewed per work-unit commit. Forecast ~2 400 authored changed lines for the whole plan, so phase boundaries are the PR slices.
**Test runner:** `vp test` (Vitest through Vite+) for unit/component, `vp check` (Oxfmt + Oxlint + `tsc`) for static gates, `@playwright/test` for the end-to-end journey.
**Toolchain:** Vite+ (`vp` v1.3.0) with **pnpm** as the package manager; Node **24.22.1** (LTS) pinned through `devEngines.runtime`; `packageManager: pnpm@12.14.0`.

---

## Specs

### S1 — Institutional access only

> "Acceso institucional: Para evitar el anonimato y ahuyentar a los oportunistas, el inicio de sesión está restringido exclusivamente al uso del correo institucional (@morelia.tecnm.mx)."

Scope: sign-up accepts only addresses under an allow-listed institutional domain, the mailbox must be proven by a magic link, and the session is a server-side opaque session. No anonymous reporting path exists in the product.
Acceptance: a non-allow-listed domain cannot create an account; an unverified mailbox cannot open a session; the session cookie is `__Host-`, `httpOnly`, `secure`, `sameSite=Lax`.
Checks: unit test on the domain rule; unit test on session creation/verification; e2e login journey.

### S2 — Interactive croquis, no GPS, tap to place

> "Croquis interactivo (Sin GPS): La aplicación no utiliza GPS debido a su imprecisión dentro de las aulas; en su lugar, emplea un mapa ilustrado en 2D del campus."
> "Pines manuales: Los usuarios tocan directamente el edificio o área en el croquis para colocar un marcador con la ubicación exacta."

Scope: a vector croquis of the campus where the reporter picks a point directly on the artwork. The croquis is the single source of spatial truth; there is no geolocation, no lat/lon and no tile server.
Acceptance: a pin placed by tapping lands on the artwork the user tapped, on any viewport, with no letterbox drift; every pin is addressable to a named zone.
Checks: unit test on the geometry helpers (client→content→percent conversions, containment fitting); e2e test that taps a known zone and asserts the created pin resolves to that zone id.

### S3 — Dual color coding

> "Código de colores dual: El sistema se basa en dos marcadores visuales instantáneos: un pin rojo que significa 'Perdí algo aquí' y un pin verde que avisa 'Encontré esto, ¿de quién es?'."

Scope: two pin types, red for `lost` and green for `found`, distinguished by shape, color and icon — never by color alone.
Acceptance: every pin renders its type in text and icon as well as color.
Checks: component test asserting the type label and icon per pin type.

### S4 — Blind report (green pin)

> "Reporte Ciego (Pin Verde): Cuando alguien encuentra un objeto, publica el hallazgo pero oculta intencionalmente detalles clave (como la marca, el color o qué hay dentro)."

Scope: a `found` report publishes a sanitized description and keeps the identifying details in a private field visible only to the report owner (and to admins).
Acceptance: the public payload of a `found` report never contains the blind detail; the owner can read it in "my reports".
Checks: unit test on the public serializer (blind field absent from the public shape).

### S5 — Ownership verification

> "Comprobación de propiedad: La persona que reclama el objeto debe demostrar que es suyo a través de una bandeja de solicitudes o chat interno, proporcionando el 'dato ciego' oculto o demostrando el método de desbloqueo."

Scope: a claim request is filed against a `found` report with the claimant's description of the object and the blind datum. The finder reviews it in a claim inbox and approves or rejects.
Acceptance: a claim cannot be auto-approved; approval is an explicit action by the report owner; every decision is written to the audit log.
Checks: unit test on the claim state machine; e2e test of file → claim → approve.

### S6 — Release key confirms the delivery

> "Clave de Liberación (Candado digital): Funciona con una lógica similar a la de Uber Eats. El pin no desaparece del mapa hasta que el estudiante que tiene físicamente el objeto ingresa en su aplicación una clave numérica que le dicta el dueño, confirmando así que la entrega fue exitosa."

Scope: the **owner of the lost report** generates a numeric release key and dictates it to the finder; the finder types it into their own app; the server validates it and closes the case, removing the pins from the map.
Acceptance: the key is never shown publicly, never stored in plaintext, is single-use, expires with the report, and is rate-limited per (key, finder) and per IP. Wrong attempts never lock the key itself (that would be a denial-of-service against the owner).
Checks: unit test on the key policy (hash compare, single use, expiry, attempts, lockout scope); e2e test report → claim → approve → key → pin removed.

### S7 — Safe points as a custody route

> "Puntos Seguros (Ruta de escape): Si el estudiante que encontró el objeto sospecha de un impostor o no tiene tiempo de coordinar la entrega, puede dejar el artículo en un lugar físico seguro, como la Biblioteca o la Jefatura. Al hacerlo, ingresa su clave para deslindarse y el mapa se actualiza indicando que el objeto ahora está en resguardo."

Scope: safe points are zones of kind `safe_point` (Biblioteca, Jefatura). Depositing an item moves the report to `in_custody` at that zone and the map shows it as "in custody" there.
Acceptance: custody is an auditable event, not a silent update; the pin visibly moves to the safe point.
Checks: unit test on the custody transition; component test on the custody pin variant.

### S8 — Strikes for impostors

> "Penalizaciones (Strikes): Si el que reclama resulta ser un impostor, el estudiante que tiene el objeto puede presionar 'Rechazar entrega', lo que le genera un 'strike' al impostor y puede llevar a su bloqueo definitivo de la plataforma."

Scope: rejecting a delivery records a strike against the claimant. A strike is an **accusation**, not a verdict: bans are applied by an admin after review, and a finder cannot emit unbounded strikes.
Acceptance: every strike records who issued it, against whom and why; per-week issuance is capped; bans are reversible and logged.
Checks: unit test on the strike policy (cap, threshold, admin-only ban).

### S9 — Automatic expiry

> "Caducidad Automática: Para evitar que el mapa se convierta en un caos visual, los pines se eliminan de forma automática a las 48 o 72 horas."

Scope: reports expire automatically so the map stays readable. Expiry removes the pin from the map but never deletes the row.
Acceptance: an `open` report with no claim and no custody event expires at 72 h; a report `in_custody` (object physically deposited) does **not** expire at 72 h — it keeps a 30-day retention; `resolved` reports are archived and their PII is purged at 90 days.
Checks: unit test on the retention policy per status.

### S10 — Contact card instead of internal chat

> "3) Descarta chats interno a favor de coordinación de WhatsApp, correo o Teams mediante una tarjeta de presentación el cual aparecerá al momento de poner el cursor o darle click para ver su nombre y correo institucional"

Scope: **no internal chat**. After a claim is approved, the two parties coordinate outside the platform (WhatsApp, email, Teams). The app exposes a contact card with the name and institutional email, revealed on hover or click.
Acceptance: the contact card never leaks contact data before a claim is approved; hover and click both reveal it; no message tables, no chat UI, no realtime chat transport.
Checks: component test asserting the card is hidden before approval and shows name + institutional email after.

### S11 — Institutional email is the identity

> "2) Con el correo institucional basta"

Scope: the verified institutional mailbox **is** the account identity. No student id, no matrícula, no extra form field.
Acceptance: the account is keyed on the verified email; strikes follow that account.
Consequence (documented risk): TecNM student mailboxes follow the `L<número_control>@…` pattern and shared/role mailboxes exist, so the domain rule is a barrier, not proof of personhood. The domain allow-list must also cover `@itmorelia.edu.mx`.

### S12 — Toolchain: Vite+ with pnpm

> "Me gustaría usar vite+ (vp) que ya está en el repositorio con pnpm como package manager"

Scope: all dependency management and task running goes through Vite+ (`vp install`, `vp dev`, `vp build`, `vp test`, `vp check`), with pnpm as the package manager. `package-lock.json` is removed; `pnpm-lock.yaml` is the only lockfile.
Acceptance: `packageManager` and `devEngines.runtime` are pinned; `vp install --frozen-lockfile` succeeds; the npm lockfile is gone.

### S13 — README covering everything essential

> "Realiza un README.md que abarque todo lo esencial del proyecto"

Scope: the README documents what the product is, the stack, install/run/build/test commands, the architecture, the data model, the claim protocol, the map model, security and privacy rules, and the roadmap.
Acceptance: a newcomer can clone → install → run → understand the architecture without asking anything.

### S14 — ODD planning covering the final stack

> "Realiza una planeación ODD donde se abarque el stack final del proyecto, normativas, arquitectura, lenguaje y demás"

Scope: this document. It fixes the final stack, the norms (code style, naming, commits, testing discipline, security rules, artifact language, accessibility baseline), the architecture and the language choice, and decomposes the work into tasks.
Acceptance: every task names its specs, its route and its verification command.

### S15 — Build, do not only plan

> "Nada de construir solo planeación."

Scope: the plan is executed, starting with the toolchain migration, the repository hygiene pass and the map coordinate fix.
Acceptance: every checked task carries observed evidence (command + result) and a commit id.

---

## Final stack

| Layer               | Choice                                                  | Version                 | Why this one                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build / task runner | **Vite+ (`vp`)**                                        | 1.3.0                   | One tool for install, dev, build, lint (Oxlint), format (Oxfmt), test (Vitest) and type check. The user asked for it; it also removes the need for a separate ESLint + Prettier pair. |
| Package manager     | **pnpm**                                                | 12.14.0                 | Requested; `vp` is pnpm-compatible, `vp install --frozen-lockfile` works in CI.                                                                                                       |
| Runtime             | **Node LTS**                                            | 24.22.1                 | Node 26 is `Current`, not LTS. Docker images pin `node:24-alpine`.                                                                                                                    |
| Frontend            | **React + Vite**                                        | 19.3 / 8.3              | Keep the 906 working lines. No framework rewrite before a backend exists.                                                                                                             |
| Styling             | **Tailwind CSS**                                        | 4.3.3                   | Already configured CSS-first (`@theme` in `src/index.css`). Keep.                                                                                                                     |
| Server              | **Hono** on `@hono/node-server`                         | 4.13.13 / 2.1.5         | Tiny typed API; `hono/cookie` signed sessions, `hono/streaming` SSE, `hono/validator`. Hono 5 is still RC — stay on 4.x.                                                              |
| Contracts           | **Zod**                                                 | 4.6.7                   | Shared between web and API; one source of truth for request/response shapes.                                                                                                          |
| Database            | **PostgreSQL**                                          | 16 (stock image)        | Real relations, `jsonb` for polygons, audit-friendly. `pg_cron` is NOT in the stock image — do not add it.                                                                            |
| ORM                 | **Drizzle**                                             | 0.45.4 / kit 0.31.11    | Typed SQL, versioned migrations, no runtime magic.                                                                                                                                    |
| Auth                | **argon2** + opaque sessions                            | 0.45.1                  | Hand-rolled: one domain rule does not justify a full auth framework.                                                                                                                  |
| Realtime            | **SSE** (`hono/streaming`) + polling                    | 4.13.13                 | SSE for the claim inbox, `refetchInterval` for map pins. No WebSocket (`@hono/node-ws` is deprecated), no Redis.                                                                      |
| Scheduler           | **node-cron** in the API process                        | 4.6.0                   | `node:cron` does not exist in Node 22–26; `pg_cron` needs a custom image. Both jobs run inside the API.                                                                               |
| Email               | **Resend** or the institute's existing MailSend/Mailjet | 6.34.1                  | `tecnm.mx` SPF already includes `mailersend.net` and `mailjet.com`. **Open decision** (see Log L5).                                                                                   |
| Photos              | **file-type** + **sharp**                               | 22.2.0 / 0.35.5         | Magic-byte sniffing, then re-encode. `sharp` drops EXIF/GPS/ICC on re-encode, so no EXIF library is needed.                                                                           |
| Tests               | **Vitest** + **Testing Library** + **Playwright**       | 5.0.5 / 16.3.3 / 1.64.1 | Run through `vp test`.                                                                                                                                                                |
| Deploy              | **Docker Compose** (postgres + api + web)               | —                       | Self-hosted at the institute; no PaaS lock-in.                                                                                                                                        |

## Language choice

**TypeScript everywhere.** The API, the domain model and the contracts are TypeScript; the existing frontend stays JavaScript for now and is migrated file by file with `// @ts-check` and `checkJs` enabled per file. Rationale: Zod contracts are shared in both directions with no codegen step, one Dockerfile covers the whole backend, and the deployment footprint stays small enough for a student to maintain. Python (FastAPI) was the runner-up and is rejected because it introduces a second language and a second type system for one domain; Go is rejected for the same reason plus hand-written types.

## Norms

1. **Artifact language** — code, comments, commits, README and this document are English. User-facing UI copy stays Spanish (the product's audience) and keeps `lang="es"`.
2. **Commits** — Conventional Commits. One work unit ≈ ≤400 authored changed lines. Tests and docs ride with the behavior they cover.
3. **Tests first** — a new rule gets a RED test before the implementation, then GREEN, then refactor. Pure logic (geometry, key policy, retention, claim state machine) is unit tested; anything DOM-bound is component tested; the delivery journey is e2e.
4. **No dead code** — a symbol that nothing imports does not ship. `src/CampusSVG.jsx` is either wired or deleted; it is currently dead.
5. **No false security** — never render a secret in the UI, never store a secret in plaintext, never describe an unverified mechanism as a protection. The current `"Código demo: {unlockCode}"` string is a defect, not a feature.
6. **Privacy by default** — public payloads carry type, sanitized title, zone, alias and age only. Contact data is released once, through one endpoint, after a valid claim. Photos are re-encoded without metadata. IPs are stored hashed. Retention purges PII.
7. **Accessibility baseline** — modals are dialogs (`role="dialog"`, `aria-modal`, focus trap, Escape), every control has an accessible name, labels are associated with inputs, the map is operable from the keyboard, and `prefers-reduced-motion` is respected.
8. **Comments** — only the _why_, one line, never the obvious.
9. **Locks** — `vp check` (format + lint + type check) and `vp test` must pass before a commit lands.

## Architecture

```
web/     React 19 SPA — croquis (SVG viewBox space), zone picker, claim inbox,
         contact card. Server state through TanStack Query (polling + optimistic).
api/     Hono + Zod. Routes: /auth/*, /zones, /reports, /claims, /keys, /admin.
         Owns sessions, the key policy, the claim state machine, the scheduler.
db/      PostgreSQL 16 + Drizzle migrations.
storage/ Item photos (re-encoded, no metadata) on local disk or S3/MinIO.
mail/    Magic links, claim notifications, strike notices.
```

### Domain model

```
users(id, email uniq, email_verified_at, password_hash, role[student|staff|admin],
      suspended_at, created_at)
zones(id, code uniq, name, unit, kind[building|parking|track|safe_point|facility],
      polygon jsonb, centroid_x, centroid_y)
reports(id, kind[lost|found], owner_id, title, public_description, blind_detail,
        status[open|pending_claim|in_custody|resolved|expired|archived],
        zone_id, safe_point_zone_id, map_x, map_y, reporter_alias,
        contact_email, contact_phone, contact_visible,
        created_at, expires_at, claimed_at, resolved_at, archived_at)
report_matches(id, lost_report_id, found_report_id, status, decided_by, decided_at)
claim_requests(id, report_id, claimant_id, provided_blind_detail, message,
                status[pending|approved|rejected|expired], decided_by, decided_at)
release_keys(id, report_id, key_hash, created_by, used_by, used_at,
             attempts, max_attempts, expires_at)
custody_events(id, report_id, actor_id, action[deposit|pickup], safe_point_zone_id, created_at)
strikes(id, user_id, given_by, report_id, reason, created_at, active)
bans(id, user_id, until, reason, created_by)
audit_log(id, actor_id, action, entity_type, entity_id, meta jsonb, created_at)
notifications(id, user_id, report_id, type, payload jsonb, read_at, created_at)
```

### Report state machine

```
open ──claim──> pending_claim ──reject──> open (+1 strike to the claimant)
                    │
                    ├──approve + release key──> resolved ──> archived
                    └──deposit at safe point──> in_custody ──> resolved/archived
open ──72 h idle──> expired        (row kept, pin removed from the map)
in_custody ──30 d idle──> archived
```

### Map model

One coordinate space: the croquis' `viewBox` (1600 × 1000 user units). Pins, zone polygons, hit-testing and pan/zoom all live in those units; the renderer projects them to pixels. Percentage-of-container math (the current implementation) is removed, because it drifts whenever the artwork is letterboxed. Zone polygons become the addressable locations, so a report references a `zone_id` instead of free coordinates.

## Tasks

| ID  | Specs      | Work                                                                                                                                                  | Route  | Status  | Evidence                                                                                                                                                                                    |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S12, S15   | Migrate to Vite+ (`vp`), pin pnpm + Node 24 LTS, drop the npm lockfile                                                                                | inline | done    | `packageManager: pnpm@12.14.0`, `.node-version` -> `24.22.1`, `pnpm-lock.yaml` (41 packages), `package-lock.json` deleted; `vp migrate` rewrote `vite.config.js` on the `vite-plus` catalog |
| T2  | S14, S13   | Write this plan; mirror to Engram                                                                                                                     | inline | done    | this file + Engram topic `odd/objetos-perdidos-itm/tasks`                                                                                                                                   |
| T3  | S15        | Repository hygiene: `tsconfig.json` (`allowJs`+`jsx`+`noEmit`) so `tsc` means something, `.gitignore` (`.env`, `.codegraph/`), `LICENSE`, real README | inline | done    | `tsc --noEmit` exits 0 (it exited 1 with no tsconfig); `.gitignore` covers `.env*` and `.codegraph/`; MIT `LICENSE` added                                                                   |
| T4  | S15        | Remove the false security affordance: delete `"Código demo"`; relabel the key as the release key the owner dictates                                   | inline | done    | `App.jsx`: demo line deleted, panel renamed to "Clave de Liberacion" with the "el dueno te la dicta" explanation, action is "Confirmar entrega"                                             |
| T5  | S2, S15    | Extract the map geometry into pure functions (`src/map/geometry.js`) and fix the letterbox drift so taps and pins land on the artwork                 | inline | done    | `fitContain` / `clientToArtwork` / `artworkToPercent`; pins live in a layer sized to the painted area; clicks on the padding are rejected instead of creating a misplaced pin               |
| T6  | S15        | Unit tests for the geometry, key policy, retention and claim state machine (`vp test`)                                                                | inline | partial | `vp test` -> 11 tests pass (geometry only). Key policy, retention and claim-machine tests belong to T11-T15                                                                                 |
| T7  | S2, S3     | Zone catalogue: extract the 52 buildings from the croquis into `src/map/zones.js` + `zones.json`, with `id`, `code`, `unit`, `kind`, polygon          | inline | pending | —                                                                                                                                                                                           |
| T8  | S2, S5     | Zone picker (combobox) + pin creation by zone; render the croquis SVG as the live map                                                                 | inline | pending | —                                                                                                                                                                                           |
| T9  | S15        | API skeleton: Hono + Zod contracts + Drizzle migrations + Compose (postgres, api, web)                                                                | inline | pending | —                                                                                                                                                                                           |
| T10 | S1, S11    | Auth: magic link, domain allow-list, argon2, opaque sessions, `hono/cookie`                                                                           | inline | pending | —                                                                                                                                                                                           |
| T11 | S4, S5, S6 | Blind report, claim requests, claim inbox, approval/rejection                                                                                         | inline | pending | —                                                                                                                                                                                           |
| T12 | S6         | Release key policy: generation, hashing, single use, expiry, attempt lockout                                                                          | inline | partial | Client side done: `generateUnlockCode()` uses `crypto.getRandomValues` with rejection sampling, 6 digits, distinct mock keys. Server side (hash, single use, expiry, lockout) is T12 proper |
| T13 | S7         | Safe points and custody events                                                                                                                        | inline | pending | —                                                                                                                                                                                           |
| T14 | S8         | Strikes, admin review, bans                                                                                                                           | inline | pending | —                                                                                                                                                                                           |
| T15 | S9         | Retention policy and the expiry/purge scheduler (`node-cron`)                                                                                         | inline | pending | —                                                                                                                                                                                           |
| T16 | S10        | Contact card (name + institutional email) revealed on hover/click; no chat                                                                            | inline | pending | —                                                                                                                                                                                           |
| T17 | S15        | Photos: upload validation, `sharp` re-encode without metadata, storage                                                                                | inline | pending | —                                                                                                                                                                                           |
| T18 | S15        | CI: `vp check` + `vp test` + `vp build` on every push; Playwright journey                                                                             | inline | pending | —                                                                                                                                                                                           |
| T19 | S3, S10    | Accessibility pass: dialogs, focus trap, labels, reduced motion, keyboard map operation                                                               | inline | pending | —                                                                                                                                                                                           |
| T20 | S13        | README refresh with the final architecture and commands                                                                                               | inline | done    | `README.md` rewritten: product, stack, commands, coordinate model, conventions, license                                                                                                     |

## Work units landed (branch `feature/objetos-perdidas-itm`)

| Commit    | Work unit                                        | Tasks                  |
| --------- | ------------------------------------------------ | ---------------------- |
| `0d723e4` | chore(toolchain): migrate to Vite+ with pnpm     | T1                     |
| `e3b4803` | style: apply Oxfmt formatting                    | T1 (formatter basline) |
| `370989a` | chore(repo): add tsconfig, license and ODD plan  | T2, T3                 |
| `8cf5e61` | feat(map): add letterbox-aware geometry helpers  | T5, T6 (partial)       |
| `37d1efe` | fix(app): anchor pins to artwork, drop demo code | T4, T12 (partial)      |
| `8ead4a2` | docs: document the project in the README         | T13, T20               |

## Log

**L1 — 2026-10-21 — Product concept (verbatim):**

> "Concepto Principal: La aplicación es una plataforma centralizada para la comunidad estudiantil del Tecnológico de Morelia, diseñada para funcionar sin depender de redes sociales externas. 1. Interfaz y Sistema de Ubicación * Croquis interactivo (Sin GPS): La aplicación no utiliza GPS debido a su imprecisión dentro de las aulas; en su lugar, emplea un mapa ilustrado en 2D del campus. * Pines manuales: Los usuarios tocan directamente el edificio o área en el croquis para colocar un marcador con la ubicación exacta. * Código de colores dual: El sistema se basa en dos marcadores visuales instantáneos: un pin rojo que significa 'Perdí algo aquí' y un pin verde que avisa 'Encontré esto, ¿de quién es?'. 2. Sistema de Reporte y Validación * Acceso institucional: Para evitar el anonimato y ahuyentar a los oportunistas, el inicio de sesión está restringido exclusivamente al uso del correo institucional (@morelia.tecnm.mx). * Reporte Ciego (Pin Verde): Cuando alguien encuentra un objeto, publica el hallazgo pero oculta intencionalmente detalles clave (como la marca, el color o qué hay dentro). * Comprobación de propiedad: La persona que reclama el objeto debe demostrar que es suyo a través de una bandeja de solicitudes o chat interno, proporcionando el 'dato ciego' oculto o demostrando el método de desbloqueo. 3. Cierre del Caso y Entregas * Clave de Liberación (Candado digital): Funciona con una lógica similar a la de Uber Eats. El pin no desaparece del mapa hasta que el estudiante que tiene físicamente el objeto ingresa en su aplicación una clave numérica que le dicta el dueño, confirmando así que la entrega fue exitosa. * Puntos Seguros (Ruta de escape): Si el estudiante que encontró el objeto sospecha de un impostor o no tiene tiempo de coordinar la entrega, puede dejar el artículo en un lugar físico seguro, como la Biblioteca o la Jefatura. Al hacerlo, ingresa su clave para deslindarse y el mapa se actualiza indicando que el objeto ahora está en resguardo. * Penalizaciones (Strikes): Si el que reclama resulta ser un impostor, el estudiante que tiene el objeto puede presionar 'Rechazar entrega', lo que le genera un 'strike' al impostor y puede llevar a su bloqueo definitivo de la plataforma. * Caducidad Automática: Para evitar que el mapa se convierta en un caos visual, los pines se eliminan de forma automática a las 48 o 72 horas."

**L2 — 2026-10-21 — Open decisions answered by the user:**

> "1) Pendiente a decidir" — mail provider and sending domain.
> "2) Con el correo institucional basta" — the verified institutional mailbox is the identity; no student id.
> "3) Descarta chats interno a favor de coordinación de WhatsApp, correo o Teams mediante una tarjeta de presentación el cual aparecerá al momento de poner el cursor o darle click para ver su nombre y correo institucional" — no internal chat; a contact card with name + institutional email, revealed on hover or click.

**L3 — 2026-10-21 — Execution instructions (verbatim):**

> "- Realiza un README.md que abarque todo lo esencial del proyecto
>
> - Realiza una planeación ODD donde se abarque el stack final del proyecto, normativas, arquitectura, lenguaje y demás
> - Me gustaría usar vite+ (vp) que ya está en el repositorio con pnpm como package manager
> - Nada de construir solo planeación."

**L4 — 2026-10-21 — Analysis.** The repository was scraped before planning (4 read-only subagents, CodeGraph + rg/fd/sqlite). Findings that shaped this plan: the build script `tsc && vite build` had no `tsconfig.json` and no TypeScript sources, so `tsc` exited 1 and `vite build` never ran; `node_modules` was absent (9/9 deps unmet); `src/CampusSVG.jsx` (279 lines, 52 buildings) was imported by nothing while the live map was a 658 KB raster; `App.jsx:301` printed the unlock code in the UI; `App.jsx:337` deleted the pin on unlock; the app had zero persistence, zero tests, zero CI and a 17-byte README. CodeGraph index was in sync with HEAD (5 files, 43 nodes, 80 edges).

**L5 — 2026-10-21 — Institutional mail facts (verified via public DNS).** `tecnm.mx` MX → `tecnm-mx.mail.protection.outlook.com`; SPF → `include:_spf.mailersend.net include:spf.mailjet.com include:spf.protection.outlook.com -all`; `morelia.tecnm.mx` resolves to `74.208.99.211`. Consequences: the institute already trusts MailSend and Mailjet, but `-all` means a third-party sender needs a delegated subdomain with its own SPF/DKIM; the allow-list must also cover `@itmorelia.edu.mx`; shared/role mailboxes pass a domain-only rule. Mail provider remains **undecided** (L2.1).

**L6 — 2026-10-21 — Decision: keep the croquis vector, drop the raster as the default.** The croquis in `src/CampusSVG.jsx` matches the official plan's building count (52) but is a stylized redraw: it lacks building `2I` and `Estacionamiento 1`, and names the diagonal street differently from the PNG. Therefore the raster stays available as an optional reference underlay until the vector is validated against it, and the coordinate fix (T5) makes pins land correctly on whichever artwork is displayed.

**L7 — 2026-10-21 — Decision: expiry is status-conditional.** S9 ("48 o 72 horas") applies to `open` reports only. A report `in_custody` holds a physically deposited object and keeps 30 days; `resolved` reports are archived with PII purged at 90 days. Rows are never deleted.

**L8 — 2026-10-21 — Decision: no internal chat.** Removed from scope. The claim inbox plus the contact card (S10) carry the coordination; realtime shrinks to SSE for the inbox and polling for the map, so no WebSocket, no Redis, no message tables.

**L9 — 2026-10-21 — Vite+ migration and the `devEngines` landmine.** `vp migrate --no-interactive --no-agent --no-editor --no-hooks` rewrote `vite.config.js` onto the `vite-plus` catalog (`vite: catalog:` → `@voidzero-dev/vite-plus-core@1.3.0`) and set the scripts to `vp dev` / `tsc && vp build` / `vp preview`. `vp env pin lts` wrote `devEngines.runtime` (node 24.22.1); against the system Node 26.11.1 that made **every** `npm` command inside the repo fail with `EBADDEVENGINES` (proved in place: `npm info react version` failed with the field, worked after removing it). This repeats the defect already recorded for the `portfolio` project, so the field was deleted and the Node pin moved to `.node-version`; only the top-level `packageManager` field stays.

**L10 — 2026-10-21 — Vite+ facts confirmed from the local knowledge base and from the toolchain itself.** Bundled in vp 1.3.0: Vite 8.3.4, Vitest 5.0.5, Oxlint 1.88.0, Oxfmt 0.73.0, Rolldown and tsdown — so `vp test` runs Vitest with **no** extra dependency. `vp build` does not type check, therefore the `tsc` prefix in the build script is load-bearing and must stay. `vp env current` reports the resolved environment while `vp env list` can disagree with it, and `vp env which npm` is known to lie. Upstream defects filed earlier from this machine: #3092 (Nushell `env.nu` parse bug — not triggered here, the vendor autoload file is absent) and #3093 (`vp env exec` / `vp node` ignore `system_first` — so only `vp exec` is used, never `vp env exec`). Sources: Engram `#2527`, `#2528`, `#2533`, `#2538` (project `dotfiles`) and Context7 `/websites/viteplus_dev_guide`.

**L11 — 2026-10-21 — Toolchain gates.** `vp check` → format ✔, lint ✔, type ✔. `vp test` → 11 tests pass. `vpr build` (`tsc && vp build`) → 2/2 successful, `dist/` emitted. Before this turn `tsc` exited 1 and no test existed.
