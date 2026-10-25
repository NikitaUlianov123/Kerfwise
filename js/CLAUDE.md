# js/ contracts

| File | Role |
|------|------|
| `units.js` | `parseLength(text, unit)` → integer u or null; `formatLength(u, unit)`; `convertText(text, from, to)` |
| `packer.js` | Pure engine. `solve(input, options)`, `packSheet(order, W, H, kerf, choice, split)`, `expandParts`, `validateInput`, `betterSolution`, `mulberry32` |
| `verify.js` | `verifySolution(input, result)` → problem strings (empty = valid); `isGuillotine(rects, kerf)` |
| `paste.js` | `parsePasteLine(line)` → `{length,width,qty,label,grain}` or null |
| `worker.js` | Module worker: `{id,input,options}` → `{id,result,problems}` or `{id,failure}` |
| `render.js` | HTML/SVG strings: `sheetSvg`, `cutTable`, `groupSheets`, `partCounts`, `usefulOffcuts`, `esc`, `partHue` |
| `app.js` | UI state, events, worker lifecycle (terminate on every new input) |

## Conventions

- All geometry is integer u; compare with `===`/`<=`, never epsilons.
- `packSheet` places each part at the top-left of a free rect; the leftover splits into right/bottom rects minus kerf. Cuts are recorded in creation order, which is a valid cut sequence.
- `render.js` converts u → display units before drawing (browsers clamp huge font sizes).
- Project style: curly braces always, no `var`, no `?:`.

## app.js section index

| Section | Line |
|---------|-----:|
| Parts table | 140 |
| Input collection | 172 |
| Solving | 271 |
| Results | 374 |
| Events | 469 |
| Paste import | 597 |
