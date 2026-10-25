# Kerfwise — quick reference

Static site (no build). Vanilla ES modules. Tests: `npm test` (node:test). Deploy: GitHub Actions → Pages on push to `main`.

## Key constants

| Name | Value | Where |
|------|-------|-------|
| Inch scale | 1 in = 64000 u (1/64" = 1000 u) | `js/units.js` `UNITS` |
| mm scale | 1 mm = 1000 u | `js/units.js` `UNITS` |
| Effort budgets | quick 400 ms, normal 2000 ms, thorough 8000 ms | `js/packer.js` `EFFORT_MS` |
| At lower bound | random phase gets 15% of budget | `js/packer.js` `solve` |
| Max total quantity | 5000 | `js/app.js` `MAX_ITEMS` |
| Input debounce | 350 ms | `js/app.js` `DEBOUNCE_MS` |
| localStorage key | `kerfwise-v2` (all projects); `kerfwise-v1` read once for migration | `js/store.js` |
| Project file | `{format:'kerfwise', version:2, projects:[...]}`, name `<project>.kerfwise.json` | `js/store.js` `makeFile` |
| Share link | `#s=<base64url project JSON>`; always opens as a NEW project, then the hash is cleared | `js/app.js` `importShareLink` |
| Budget per material | effort budget ÷ materials with parts (min 150 ms) | `js/app.js` `runSolve` |
| Default RNG seed | 12345 | `js/packer.js` `solve` |

## Geometry conventions

| Item | Meaning |
|------|---------|
| x | along sheet length (= grain direction) |
| y | along sheet width |
| Part `length` | along x when not rotated |
| `rotated: true` | part length along y; never for grain-locked parts when `sheetGrain` |
| Cut `axis: 'h'` | rip (line parallel to x) at `y = pos`, from x=`from` to `to` |
| Cut `axis: 'v'` | crosscut at `x = pos`, from y=`from` to `to` |
| Cut `thickness` | `min(kerf, room left)` — kerf is on the + side of `pos` |
| Coordinates in results | include edge trim offset |

## Data shapes

| Shape | Fields |
|-------|--------|
| solve input | `{ sheet:{length,width}, kerf, trim, sheetGrain, parts:[{id,label,length,width,qty,grain}] }` (all lengths in u) |
| solve options | `{ effort, timeLimitMs, maxTrials, seed }` |
| Project (store.js) | `{ id, name, unit, effort, kerf, materials:[{id,name,length,width,trim,grain}], parts:[{id,label,length,width,qty,grain,material}] }` — lengths are typed TEXT; part `id` is runtime only |
| Store | `{ currentId, projects:[Project] }` |
| solve result | `{ sheets:[{placements,cuts,offcuts,usedArea}], unplaced:[{partId,label,count,reason}], stats }` or `{ errors:[] }` |
| stats | `sheetCount, lowerBound, placedCount, partArea, sheetArea, efficiency, cutCount, cutLength, trials, elapsedMs` |

## Packer heuristic tables

| Kind | Values |
|------|--------|
| ORDERS | area, long, short, x, y, perim |
| CHOICES | baf (best area), bssf, blsf, tl (top-left), lt (left-top) |
| SPLITS | sla, lla, minas, maxas, sa, la, h (rip first), v (crosscut first) |
| Solution rank | fewer sheets → smaller least-used sheet → fewer cuts |

## Where to find X

| Task | Files (in order) |
|------|------------------|
| Change packing algorithm | `js/packer.js` → `test/packer.test.js` |
| Add a layout check | `js/verify.js` → `test/packer.test.js` (verifySolution test) |
| Change unit parsing/format | `js/units.js` → `test/units.test.js` |
| Change paste format | `js/paste.js` → `test/paste.test.js` → hint in `index.html` dialog |
| Change sheet drawing / cut table | `js/render.js` → `css/style.css` |
| Add a project field | `js/store.js` (blankProject, normalizeProject, serializeProject) → `test/store.test.js` → `index.html` → `js/app.js` (renderProject, bind*, collectJobs) |
| Add a material field | `js/store.js` (defaultMaterial, normalizeMaterial, serializeProject) → `js/app.js` (renderMaterials, collectJobs, changeUnit) |
| Change border dimension marks | `js/render.js` `borderMarks`, `sheetSvg` → `test/render.test.js` |
| Change deploy | `.github/workflows/pages.yml` |

## Session Cost Log

| Date | Task | Mode | Tokens (est.) | Notes |
|------|------|------|:-------------:|-------|
| 2026-10-25 | Build app, tests, docs, Pages workflow | inline | ~160K | One-time setup; includes browser screenshot checks |
| 2026-10-25 | Rename to Kerfwise, commit, repo, deploy | inline | ~10K | |
| 2026-10-25 | Action bump; projects + materials + file save; border dimension marks | inline | ~65K | Red flag over 50K: app.js rewrite + browser flow scripts. Lookups now covered by this file |
