# Notes for AI agents working on Butler 2.0

## Brand: read this before touching anything visual

The Figma file [Butler](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler) contains **two different brands**. This repository is **Butler 2.0** only.

- **Use:** the page **"Butler 2.0 — CURRENT logo masters"** and pages starting **"B2 ·"** (00 to 19). Start at [B2 · 00](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=72-3). Vectorized reference board: [node 66:19](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=66-19).
- **Never use:** the 14 pages starting **"LEGACY ·"**. They are an older Butler. Don't bring in their logos, gold palette, typography, components or screens.
- **The website's look was reset on 2026-10-26** (Anas chose a "total reset"): only the logo carries over from the B2 pages. The website no longer follows the B2 colours, type or components, and the sticky-note board is gone. The B2 pages still apply to the logos, the pet and the voice.

The full rules are in [`design/brand/BRAND.md`](design/brand/BRAND.md). In short:

- Logos: use the vector masters in [`design/brand/logo/`](design/brand/logo/). Never screenshots, previews or redraws. Never set the "Butler" wordmark in a font. Keep "2.0" smaller. On dark surfaces use the app tile, don't invert.
- The animated pet uses the sprite kit in [`design/little-butler/`](design/little-butler/), not a logo.
- Website colours, radii and shadows come from [`web/src/theme.css`](web/src/theme.css): calm neutral surfaces, Bento tiles with soft tints, one violet accent, light and dark modes. `tests/theme.test.ts` checks contrast in both modes; keep it passing when you change a colour. Inter for the interface, Instrument Serif for big page titles.
- Layout: a sidebar on wide screens, an icon rail on tablets, a top bar plus a bottom tab bar on phones. Every page has to work from 320 px up with no sideways scrolling.
- Voice: set by [`server/persona.md`](server/persona.md), Anas's Gen Z persona word for word (never edit that part; `tests/persona.test.ts` checks it) plus a butler layer. Every AI call where Butler writes to Anas passes it as the system prompt (`voiceRules` in `server/lib/persona.ts`). No jokes in failures, sensitive tasks or confirmations; never claim something finished before it is.

## Git rules for this repository

- Commit and push as **Anasabubakar**. No co-author or session trailers.
- Many very small commits, one change each.
- Track everything except secrets (build output such as `node_modules/` and `dist/` stays ignored).
- Push as soon as each task is done.

## Where things are

See the table in [`README.md`](README.md). Server: Deno (`server/`), tests in `tests/` (`deno test --allow-read --allow-net --allow-env tests/`). Library website: Vite + TypeScript in `web/` (`npm run build`). Android app in `android/` (built by CI). GNOME pet in `desktop/gnome/`.
