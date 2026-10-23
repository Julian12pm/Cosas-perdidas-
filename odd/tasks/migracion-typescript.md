# De JS a TS — la migración total

**Objective:** leave the repository with no JavaScript left in it — the app, the scripts and the
config are TypeScript — and with the type check as a real gate: `strict`, no `any`, no escapes, and
the types of the app taken from the contracts the API already validates.
**Branch:** `feature/objetos-perdidas-itm` (SAME BRANCH).
**Delivery strategy:** one branch, one PR, reviewed per work-unit commit. Eight work units; the PR
is the user's call.
**Test runner:** `vp test` (366 unit/integration tests) · `vp exec node scripts/smoke-journey.ts`
(the demo journey, 366 browser assertions) · `vp exec node scripts/smoke-api.ts` (the full-stack
journey, 26 assertions) · `vp check` (format + lint + types) · `tsc --noEmit` (the build's type
step).

**Status: PLANNED. Nothing of this phase has been built yet.**

---

## Why this phase exists

The repository is half TypeScript: the API (≈ 4 000 lines under `api/`) is strict TS with zod
contracts, and the part a user actually touches — the app (≈ 9 000 lines), the journeys (≈ 5 900
lines) and the config — is JavaScript with `allowJs: true` and `checkJs: false`. The type check
therefore passes over the browser bundle without looking at it: `vp check` reports "no type errors"
about a codebase whose domain is untyped.

The cost is not the missing types, it is what they hide: the shapes the API returns, the shapes the
map draws, and the props the components take are only described in prose.

---

## The scope, counted

| Area                      | Files | Lines | Today          |
| ------------------------- | ----- | ----- | -------------- |
| `src/` (the app)          | 15    | 8 978 | `.js` / `.jsx` |
| `scripts/` (the journeys) | 4     | 5 877 | `.mjs`         |
| `vite.config.js`          | 1     | 26    | `.js`          |
| `api/`                    | 21    | 4 000 | **already TS** |

**Nothing is left behind:** no `.js`, no `.jsx`, no `.mjs`, no `allowJs`, no `checkJs`.

---

## Specs

### S1 — No JavaScript left

Every `.js`, `.jsx` and `.mjs` in the repository becomes `.ts` or `.tsx`: the app, the four
scripts, the vite config.
Scope: the file extensions and every import specifier that points at them.
Acceptance: `find . -name '*.js' -o -name '*.jsx' -o -name '*.mjs'` (outside `node_modules`) is
empty; `tsconfig.json` has no `allowJs` and no `checkJs`.
Checks: a grep gate, plus the build and the journeys.

### S2 — The type check is the gate, and it is strict

`strict` is already on; the migration adds what it needs to mean something: `noUncheckedIndexedAccess`
is **off** (the catalogue indexes by id and a miss is normal), `verbatimModuleSyntax` and
`erasableSyntaxOnly` are **on** (the scripts run under Node's type stripping, so the code must be
erasable: no enums, no namespaces, no parameter properties).
Scope: `tsconfig.json` and the `vp check` configuration.
Acceptance: `tsc --noEmit` passes over the whole repository; `vp check` reports no type error.
Checks: the build (`tsc && vp build`) and `vp check`.

### S3 — The API's contracts are the app's types

The API already validates every payload with zod (`api/src/contracts.ts`). The app must not
re-describe those shapes: it imports the types (`import type`, so nothing lands in the bundle) and
inherits the contract.
Scope: `src/api.ts` and the app's domain types.
Acceptance: `src/api.ts` types every response from the API's own contracts; a change in
`api/src/contracts.ts` that the app does not follow breaks the app's type check.
Checks: the type check.

### S4 — The app's own vocabulary is named and shared

The app draws its own projection of a report (`type`, `x`, `y`, `item`, `zoneLabel`…) and its own
claim. Those shapes live in ONE module (`src/types.ts`) and every component imports them.
Scope: `src/types.ts` and its use.
Acceptance: no component declares a report/claim/session shape inline; there is exactly one
definition of each.
Checks: a grep gate for the local re-declarations, plus the type check.

### S5 — No escapes

No explicit `any`, no `@ts-ignore`, no `@ts-expect-error` without a written reason, and no `as` that
hides a real mismatch.
Scope: the whole repository.
Acceptance: the greps for `any`, `@ts-ignore` and `@ts-expect-error` come back empty (the word
"any" in prose and in identifiers such as `company` does not count).
Checks: the greps.

### S6 — The behaviour does not change

This is a translation, not a redesign: the same interface, the same texts, the same journeys, the
same `data-testid` contract.
Scope: everything.
Acceptance: the 366 unit tests, the 366-assertion demo journey and the 26-assertion API journey
stay green, and the journey's screenshots do not change.
Checks: the three gates plus the screenshots.

### S7 — The code stays erasable

Node runs the `.ts` scripts directly (Node 24 strips the types), so the code must only use syntax
that can be erased: `import type` for the type-only imports, no `enum`, no `namespace`, no
parameter properties, no `const enum`.
Scope: the scripts and the app.
Acceptance: `node scripts/smoke-journey.ts` runs without a loader.
Checks: the journeys run as they are.

### S8 — The config is TypeScript

`vite.config.js` becomes `vite.config.ts`, and its `test.include` pattern follows the new
extensions.
Scope: the config and the test runner's patterns.
Acceptance: `vp test` finds the same 366 tests (and no `.js` test).
Checks: `vp test`.

### S9 — The CI and the docs tell the truth

The workflow runs the `.ts` scripts, the package.json points at the `.ts` files, and the README says
what the project is written in.
Scope: `.github/workflows/ci.yml`, `package.json`, `README.md`.
Acceptance: the CI's commands match the files that exist.
Checks: reading them, and a local run of each command.

---

## Invariants (what must NOT break)

| #   | Invariant                                                                              | Where it is asserted                 |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| I1  | The 366 unit tests, the demo journey (366) and the API journey (26) stay green         | every gate                           |
| I2  | The interface is identical: the same texts, the same tests hooks, the same screenshots | the journey's screenshots            |
| I3  | The API contract, the domain rules and the catalogue are untouched                     | the API's own tests                  |
| I4  | The demo mode and the API mode keep producing the same interface                       | both journeys                        |
| I5  | The `data-testid` contract does not change                                             | the journey                          |
| I6  | The app still builds with the same dependencies: no runtime package is added           | `vp build` and `package.json`        |
| I7  | The generated catalogue (`src/map/zones.ts`) is still generated, never hand-edited     | the generator's header + the journey |
| I8  | The zone listbox keeps its single tab stop, its 90 named options and its live region   | the journey, lightpanda's tree       |

---

## Decisions locked

| Question                | Decision                                                                | Why                                                                |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| How strict?             | `strict` on; `noUncheckedIndexedAccess` **off**                         | the catalogue indexes by id and a miss is a normal case, not a bug |
| Type-only imports       | `verbatimModuleSyntax` + `erasableSyntaxOnly` on                        | Node strips the types: the code has to be erasable                 |
| Import specifiers       | explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`)       | one rule for the bundler and for Node; no extensionless guessing   |
| The API's shapes        | inherited from `api/src/contracts.ts` with `import type`                | one source of truth: the zod schema the API validates              |
| The app's shapes        | one module, `src/types.ts`                                              | the app's projection of a report is not the API's report           |
| The `any` escapes       | none                                                                    | an `any` is a hole in the gate                                     |
| The scripts             | `.ts`, run by Node's type stripping                                     | one language in the repository                                     |
| The generated catalogue | the generator writes `.ts` with the type of the zone                    | the file is generated: the generator has to keep it honest         |
| The order               | leaves first (client → map → data → components → app → tests → scripts) | every commit keeps the type check green                            |

---

## Tasks

| ID  | Specs      | Work                                                                                                                     | Route  | Status  | Verification                                                           |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | ---------------------------------------------------------------------- |
| T1  | S2, S3, S4 | `src/types.ts` (the vocabulary) and `src/api.ts` (the client, typed with the API's contracts); the tsconfig's new flags. | inline | done    | `tsc --noEmit` + `vp check` + `vp test` (366) + the demo journey (366) |
| T2  | S1, S7     | `src/map/zones.ts` and `src/map/geometry.ts`: the catalogue and the geometry, typed.                                     | inline | done    | `tsc --noEmit` + `vp test` (366) + both journeys (366 + 26)            |
| T3  | S1, S4     | `src/data.ts`: the demo data and the projections, typed with the vocabulary.                                             | inline | done | `tsc --noEmit` + `vp test` (366) + the demo journey (366) |
| T4  | S1, S4, S5 | The twelve components: `.tsx`, typed props, typed state.                                                                 | inline | planned | the type check + the journey                                           |
| T5  | S1, S4, S5 | `src/App.tsx`: the app's state machine, typed.                                                                           | inline | planned | the type check + the journey                                           |
| T6  | S1, S8     | The four test files: `.ts`, typed.                                                                                       | inline | planned | `vp test` + the type check                                             |
| T7  | S1, S7     | The four scripts: `.ts`, typed; the generator keeps writing a typed catalogue.                                           | inline | planned | the journeys + the type check                                          |
| T8  | S2, S5, S9 | The tightening: `allowJs` off, the greps of S5 clean, the CI, the package.json, the README.                              | inline | planned | the greps + the three gates                                            |

### Risks

| Task | Risk                                                                                        | Mitigation                                                                       |
| ---- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T1   | The vocabulary is guessed wrong and every component inherits the mistake                    | it comes from the API's contracts and from the demo data, not from imagination   |
| T2   | The catalogue is 2 439 lines of literal: a wrong type there breaks everything that reads it | `satisfies` on the literal, so the type checks the data instead of describing it |
| T4   | Twelve components at once is a wide diff                                                    | one commit per area, and the journey's 366 assertions are the gate               |
| T5   | `App.tsx` is 1 770 lines and holds the whole state machine                                  | the vocabulary lands first, so the file is mostly annotation                     |
| T6   | The tests type the mocks, and a wrong mock hides a wrong type                               | the tests keep asserting the same things, only typed                             |
| T7   | The scripts run under Node's type stripping: the code has to be erasable                    | `erasableSyntaxOnly` makes the compiler say no                                   |
| T8   | The last commit removes `allowJs` and touches every file at once                            | by then there is no `.js` left to exclude                                        |

---

## Log

**L1 — 2026-10-23 — The request (verbatim):**

> "Migremos de JS a TS de manera total y completa. Planea ODD y procede. Creo que oxc tiene una
> herramientas de migración de JS -> TS pero igual dime cómo vas a proceder."

**L2 — 2026-10-23 — What oxc does and does not do.** Oxc has the parser, the transformer, the
linter (oxlint), the formatter (oxfmt) and the type checker (tsgolint, which `vp check` already
runs). It does **not** have a JavaScript-to-TypeScript migration that writes the types: the
mechanical part (renaming the files and rewriting the import specifiers) is a script's job, and the
semantic part (writing the types) is the migration itself. What oxc gives us is the gate:
`vp check`'s type-aware linting through tsgolint, which reads the TypeScript program the same way
`tsc` does.
