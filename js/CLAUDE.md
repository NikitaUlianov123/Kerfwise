# js/ contracts

| File | Role |
|------|------|
| `units.js` | `parseLength(text, unit)` → integer u or null; `formatLength(u, unit)`; `convertText(text, from, to)` |
| `packer.js` | Pure engine. `solve(input, options)`, `packSheet(order, W, H, kerf, choice, split)`, `expandParts`, `validateInput`, `betterSolution`, `mulberry32` |
| `verify.js` | `verifySolution(input, result)` → problem strings (empty = valid); `isGuillotine(rects, kerf)`; `checkCutSequence(region, placements, cuts, kerf)` replays the cut list |
| `recut.js` | `recut(placements, W, H, kerf, maxNodes)` → `{count, length, cuts, offcuts}` or null; fewest through cuts for fixed positions, sorted into stages |
| `paste.js` | `parsePasteLine(line)` → `{length,width,qty,label,grain,material}` or null |
| `store.js` | Project/store shapes, v1 migration (`normalizeProject`), `serializeProject/Store`, `cloneAsNew`, `uniqueName`, `makeFile`/`parseFile`, `fileName` |
| `worker.js` | Module worker: `{id,jobs:[{materialId,input}],options}` → `{id,results:[{materialId,result,problems}]}` or `{id,failure}` |
| `render.js` | HTML/SVG strings: `sheetSvg`, `borderMarks`, `cutTable`, `groupSheets`, `partCounts`, `usefulOffcuts`, `esc`, `partHue` |
| `app.js` | UI for the current project, project menu, one solver job per material, worker lifecycle (terminate on every new input) |

## Conventions

- All geometry is integer u; compare with `===`/`<=`, never epsilons.
- `packSheet` places each part at the top-left of a free rect; the leftover splits into right/bottom rects minus kerf. Cuts are recorded in creation order, which is a valid cut sequence.
- `render.js` converts u → display units before drawing (browsers clamp huge font sizes).
- Border marks: crosscut positions on the top edge, rip positions on the left edge; overall size on the bottom and right edges.
- Edit files with UTF-8 (`PYTHONUTF8=1` for Python): the sources contain ×, →, ▾.
- Project style: curly braces always, no `var`, no `?:`.

## app.js section index

| Section | Line |
|---------|-----:|
| Storage and share links | 40 |
| Projects | 110 |
| Materials | 233 |
| Parts table | 329 |
| Input collection | 463 |
| Solving | 576 |
| Results | 690 |
| Settings and units | 848 |
| Paste import | 903 |
| Top bar and page | 972 |
