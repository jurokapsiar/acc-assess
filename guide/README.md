# Guide

A static, self-contained HTML guide to the accessibility skill suite. It covers the workflow, each skill, the interaction modalities, the reports, example issues and the full criteria catalog. Open `index.html` directly from disk; it needs no server.

## Build

```sh
node guide/build-guide.mjs            # from the repo root
node guide/build-guide.mjs --root <repo>
```

Rebuild whenever rules, criteria or coverage change. Counts and the catalog are never hard-coded.

## Inputs

The rules and coverage are read from:

- `rules.md`
- `skills/accessibility-assessment/references/criteria-coverage.md`
- `skills/accessibility-assessment/knowledge/wcag/criteria.json`
- `skills/accessibility-assessment/knowledge/apg/index.md`
- `skills/accessibility-assessment/scripts/lib/modality-rules.mjs`
- `skills/screen-reader-validation/scripts/lib/rules.mjs`

The build warns about any missing source and skips it.

## Outputs

- `index.html`: the guide.
- `catalog.json`: the parsed catalog of rules, criteria, APG patterns and counts.

## Layout

- `build-guide.mjs`: the entry point.
- `lib/data.mjs`: parses the sources and computes the summary.
- `lib/sections-*.mjs`: the page content.
- `lib/css.mjs`, `lib/client.mjs`: styles (theme tokens are CSS custom properties at the top of `css.mjs`), and a small vanilla script for the tabs and filters.
- `lib/charts.mjs`: the SVG half-donuts and bars.
- `assets/`: screenshots taken from sample report outputs.
- `assets/icon.svg`: the project icon. A red capital A (failure) is overlapped by a green small a
  (fix). The glyphs are Inter ExtraBold converted to paths, so the file needs no font. The PNGs are
  rendered from it:
  ```sh
  magick -background none -density 300 guide/assets/icon.svg -resize 1024x1024 -depth 8 .claude-plugin/icon.png
  magick -background none -density 300 guide/assets/icon.svg -resize 180x180 -depth 8 guide/assets/icon-180.png
  magick -background none guide/assets/icon.svg -resize 32x32 -depth 8 guide/assets/icon-32.png
  ```
