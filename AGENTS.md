# Notes for AI agents working on Butler 2.0

## Brand: read this before touching anything visual

The Figma file [Butler](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler) contains **two different brands**. This repository is **Butler 2.0** only.

- **Use:** the page **"Butler 2.0 — CURRENT logo masters"** and pages starting **"B2 ·"** (00 to 19). Start at [B2 · 00](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=72-3). Vectorized reference board: [node 66:19](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=66-19).
- **Never use:** the 14 pages starting **"LEGACY ·"**. They are an older Butler. Don't bring in their logos, gold palette, typography, components or screens.
- **The exception:** the library's sticky-note board (cork, paper notes, tape, pins, wastebin) is current Butler 2.0 and must be kept, even though it resembles the old project. Don't flatten it into white rounded cards.

The full rules are in [`design/brand/BRAND.md`](design/brand/BRAND.md). In short:

- Logos: use the vector masters in [`design/brand/logo/`](design/brand/logo/). Never screenshots, previews or redraws. Never set the "Butler" wordmark in a font. Keep "2.0" smaller. On dark surfaces use the app tile, don't invert.
- The animated pet uses the sprite kit in [`design/little-butler/`](design/little-butler/), not a logo.
- Colours and type come from [`web/src/b2-tokens.css`](web/src/b2-tokens.css) (`--b2-*`). Black and white lead, vermilion `#E4462D` is the accent, `#B83120` behind small white text. No blue or purple brand accents. Inter for the interface; Caveat only for note headings on the board.
- New tokens, styles and components use the `B2` / `b2-` namespace.
- Voice: quiet, dry, competent; "sir" now and then; no jokes in failures, sensitive tasks or confirmations; never claim something finished before it is.

## Git rules for this repository

- Commit and push as **Anasabubakar**. No co-author or session trailers.
- Many very small commits, one change each.
- Track everything except secrets (build output such as `node_modules/` and `dist/` stays ignored).
- Push as soon as each task is done.

## Where things are

See the table in [`README.md`](README.md). Server: Deno (`server/`), tests in `tests/` (`deno test --allow-read --allow-net --allow-env tests/`). Library website: Vite + TypeScript in `web/` (`npm run build`). Android app in `android/` (built by CI). GNOME pet in `desktop/gnome/`.
