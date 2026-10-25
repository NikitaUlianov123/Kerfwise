# Kerfwise

A web app that fits a list of rectangular parts on the fewest stock sheets (default 4 ft × 8 ft plywood).

## Features

- **Fewest sheets.** Guillotine packer with many heuristics and a timed random search. It shows the area minimum, so you can see when the plan is optimal.
- **Every plan can be cut on a table saw or panel saw.** All cuts go edge to edge. The app lists the cuts in order for each sheet.
- **Blade width (kerf).** Every cut removes the blade width. Exact fits are exact: integer math, no rounding drift.
- **Grain direction.** Set "Grain" on a part to keep its length along the sheet length. Clear "Sheet has grain" to let all parts turn.
- **Edge trim** on each side of the sheet.
- **Inches with fractions** (`23 1/2`, `23-1/2`, `1' 11 1/2"`) or millimeters.
- **Layout check.** A separate checker tests every result (overlaps, kerf gaps, grain, sheet bounds, cut paths, part counts). If a check fails, the app shows an error, not a plan.
- Identical sheets are grouped. Paste a parts list. Share link. Print view. Saves your list in the browser.

## Run locally

No build step. Serve the folder with any static server, for example:

```sh
npm run serve        # http://localhost:8080
```

Opening `index.html` as a file does not work: browsers block module workers on `file://`.

## Tests

```sh
npm test
```

## Deploy

`.github/workflows/pages.yml` runs the tests and deploys the site to GitHub Pages on each push to `main`.
