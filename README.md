# PU Toolset

Base optimization and production planning for *Prosperous Universe*, in one app.

This is the consolidation of two earlier tools: a base-layout optimizer and a production/material planner. Both were Next.js apps backed by Prisma — the planner needed a hosted Postgres database. Neither is true here any more.

## How it works

**There is no backend.** The app is a static bundle that runs entirely in the browser. All your data lives in a single JSON file that you own and carry around. Open it, work, save it. Copy it to another machine and carry on.

That means it runs two ways from the same build:

- **Desktop (.exe)** — Electron loads the bundle straight from disk and uses native save/open dialogs.
- **GitHub Pages** — the same bundle, served statically. Chromium browsers can save back to the file you opened; Firefox and Safari fall back to upload-to-open and download-to-save.

Game data (materials, buildings, recipes, workforce needs) comes from the FIO REST API, called directly from the browser and cached in IndexedDB. After one online run the app works offline.

## Development

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Typecheck, then build the static bundle into `dist/` |
| `npm test` | Run the test suite |
| `npm run desktop:dev` | Run the Electron shell against the dev server |
| `npm run desktop:build` | Build the Windows installer and portable .exe into `release/` |

## Layout

```
src/
  schema/     The save-file data model: types, validation, migrations, cloning
  storage/    Reading and writing that file, per runtime target
  store/      The single in-memory copy of the file and everything that edits it
  provider/   FIO game data, with a persistent cache
  optimizer/  The base-layout solver
  planner/    Material planning: turns a package into a shopping list
  routes/     Screens
electron/     Desktop shell (main + preload)
```

### The save file

`src/schema/types.ts` is the source of truth for the shape, and one of those objects *is* the file on disk. It carries a `schemaVersion`; `src/schema/migrate.ts` upgrades older files on load, and `src/schema/validate.ts` rejects anything malformed with a message naming the offending field rather than failing deep inside a screen.

Two deliberate differences from the Prisma schemas this replaces:

- Arrays and records are real JSON. The old `selectedWorkforceInHouseResources String @default("[]")` only existed because SQLite has no array type.
- Children are nested under their owner instead of held in flat tables with foreign keys, so deleting an owner drops its children and each planet's collections feed the planner calculations directly.

Market prices and FIO reference data are deliberately **not** in the save file — they are replaceable cache, and keeping them out means the file stays small and stays about your plans.

### Adding a field

Add it to `types.ts`, then to the matching zod object in `validate.ts` with a `.default(...)`. Old files load unchanged because the default fills the gap — no migration needed. Write a migration in `migrate.ts` only when existing data has to move or be reinterpreted.

### Optimizer to shopping list

The reason the two old tools are one app: a generated base layout can be sent
straight to the material planner as a list of buildings, which then expands into
the materials to buy.

A building costs its bill of materials *plus* whatever the destination planet's
environment demands — MCG on rocky planets, AEF on gaseous ones, and extra
materials for pressure, gravity and temperature extremes. Those rules live in
`src/planner/materials.ts`. They are game rules rather than anything FIO reports
per building, and they dominate the real cost: a 490-area base on a rocky planet
needs 1,960 MCG on top of a few hundred units of everything else. A shopping
list with no target planet set leaves them out and says so.

### Looking things up

A planet's Natural resources section shows what it yields, with FIO's material
ids resolved to tickers and each type mapped to the building that extracts it.

Systems can be looked up by name or natural id to add their planets in one go.
FIO has no endpoint listing a system's planets, and the one response carrying
system ids is 35MB, so this uses the fact that a planet's natural id is its
system's plus a letter: `OT-580b` is the second planet of `OT-580`. The match
requires the remainder to be letters only, so `OT-58` cannot claim `OT-580b`.

### Per-planet production

A planet's Production, Resource balance and To buy sections live on the planet
screen rather than as separate pages, because they are three views of the same
planet and get read together.

Output comes from batch size, batch time and factory efficiency, over the slots
a product actually gets. A production order runs whole batches, so a part-full
final order still costs the time of every batch in it — which is also where the
reported overbuild comes from.

The balance then nets production against recipe demand, workforce consumption
and trade routes in both directions. That last part is the point: a material
arriving from another planet is supply, so it stops appearing as something to
buy.

**A building is a production slot.** Two farms give two farm slots, so a
planet's slot count for a building type is simply how many of it stand there.
Nothing separate needs recording, and FIO does not publish a slot count anyway.

### Prices

A shopping list can be costed against any of the six commodity exchanges,
picked per list or inherited from the target planet's buy exchange. Prices come
from `/exchange/all`, which covers every material on every exchange in one
cached request.

The **ask** is used, because that is what buying right now actually costs. About
a quarter of FIO's exchange records have no ask at all — nobody is selling — and
substituting the recent average there would invent a price you cannot trade at.
Those rows are listed as unpriced and named under the total, so a cheap-looking
estimate is never hiding the materials it could not cost. A row needing more
units than the exchange has listed is flagged too.

## Desktop specifics

The window will not close silently on unsaved work: the main process intercepts
`close` and shows Save / Don't save / Cancel. "Save" runs the renderer's normal
save and only closes once the write actually happened, so backing out of the
file dialog leaves the window open rather than discarding the work.

The bundle is served over a custom `app://` scheme rather than `file://`.
`file://` is not a real origin, and `indexedDB.open()` there accepts the call
and then never fires any event — which hung the app on startup, since boot waits
on it. The custom scheme gives the renderer a proper secure origin. As a second
line of defence, the IndexedDB layer treats a stalled open as "no storage
available" instead of waiting forever.

## Routing

The app uses hash routing (`#/optimizer`). It is the one mode that works unchanged both on GitHub Pages, where there is no server to rewrite deep links, and under Electron's `file://` protocol. Combined with Vite's relative `base`, one build works in both places with no per-target configuration.
