# Butler 2.0 brand

This is the brand for **Butler 2.0**: the personal assistant with the nonchalant shadow-creature mascot (Little Butler). Read this before you change anything people see.

## Two Butlers live in one Figma file. Use only one.

The Figma file [Butler](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler) holds **two different brands**:

| | Butler 2.0 (this repo) | Old Butler (not this repo) |
|---|---|---|
| Pages | **Butler 2.0 — CURRENT logo masters**, and the pages starting **B2 ·** (00 to 19) | The 14 pages starting **LEGACY ·** |
| Look | Black, white, vermilion. Inter. Shadow-creature mascot with collar and tie. | Gold palette, its own logos, type and components |
| Use here? | **Yes** | **Never.** Don't import its logos, gold, fonts, components or screens. |

Links:

- [Start guide, B2 · 00](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=72-3)
- [Original vectorized brand board](https://www.figma.com/design/69yKESUTEOB9M9YIifeEBp/Butler?node-id=66-19) (reference only; production art is the masters below)
- Logo masters, page `66:2`: Primary `66:111`, App Icon SVG `66:82`, Monochrome `66:83`
- Library and notes: **B2 · 09 Library & command centre** (page `72:301`) and **B2 · 15 Notes & memory** (page `72:592`)
- Handoff and agent rules: **B2 · 19** (page `72:732`)

The B2 pages are editable guides and screen examples, not a published component library. Example text on them ("Interfaces worth keeping", "12 saves") is placeholder content, not a requirement.

There is no "B2 · 20 Sticky-note materials" page in the file (checked 22 October 2026); an attempt to add one wasn't finished. The sticky-note rules below and in [`web/src/b2-tokens.css`](../../web/src/b2-tokens.css) stand in for it.

**The sticky-note board is the one thing that looks like the old Butler and is still correct.** It's in the current live app and Anas wants it kept. That doesn't make anything else from the LEGACY pages valid.

## Logo

The masters are in [`logo/`](logo/), exported straight from the CURRENT page as vectors (byte-for-byte what Figma exports):

| File | Figma node | Use |
|---|---|---|
| [`butler-primary.svg`](logo/butler-primary.svg) | 66:111 | Mascot + "Butler 2.0" lettering. Default on white or paper. |
| [`butler-app-icon.svg`](logo/butler-app-icon.svg) | 66:82 | Mascot face on an ink tile. App icons, favicons, and any dark surface. |
| [`butler-monochrome.svg`](logo/butler-monochrome.svg) | 66:83 | Pure black and white, no red knot. One-colour uses. |

Rules (from B2 · 01 and B2 · 05):

- Use these vectors. Never a screenshot, a small preview export or a redraw.
- The lettering is artwork. Don't set "Butler" in Inter or any look-alike font. "2.0" stays smaller than "Butler".
- Keep the eyes, expression, silhouette, collar and tie exactly. Don't stretch, rotate, crop, recolour, add glows or gradients.
- Dark mark on white or paper. **On dark surfaces use the app tile**; don't just invert the artwork.
- Clear space: 25% of the mascot's head width on every side.
- Minimum sizes: primary 160 px wide; app tile 48 px with full detail; test a simplified export below 32 px.
- App icons: keep a full square source and let each system apply its mask. On Android, test circle, squircle and rounded square, with the face inside the safe zone.
- Exports: SVG for vector use, PNG at 1x/2x/3x. Check transparency on light and dark.
- The tie knot in the masters is `#F73D24` (app icon) and `#F6401C` (primary). Leave those as they are; they're part of the artwork. The UI accent is the token `--b2-vermilion` `#E4462D`.

**The logo and the on-screen pet are different things.** The live pet on phone and laptop uses the sprite animation kit in [`design/little-butler/`](../little-butler/), never a static logo tile.

## Colour

Tokens live in [`web/src/b2-tokens.css`](../../web/src/b2-tokens.css) under `--b2-*`. A test ([`tests/b2tokens.test.ts`](../../tests/b2tokens.test.ts)) checks the values and their contrast.

| Token | Value | Use |
|---|---|---|
| `--b2-ink` | `#111111` | Text, mascot, primary actions |
| `--b2-white` | `#FFFFFF` | Surfaces, inverse text |
| `--b2-paper` | `#F8F7F4` | Page background |
| `--b2-vermilion` | `#E4462D` | The accent: active marks, focus rings, small highlights |
| `--b2-action-red` | `#B83120` | Red buttons and red links that carry small white text |
| `--b2-muted` | `#65625E` | Secondary text |
| `--b2-line` | `#D8D5CF` | Dividers and borders |
| `--b2-dark-surface` | `#191919` | Dark surfaces |

- Mostly neutrals; vermilion on about 10% of a layout at most.
- **No blue or purple brand accents.**
- White small text on `#E4462D` fails contrast (under 4.5:1). Use `#B83120` behind white text, or ink text on vermilion.
- Don't rely on colour alone for state: pair it with a label or icon.

### Sticky-note materials

These are materials for the library board, not brand colours. Observed in the live app (dark mode):

| Token | Value |
|---|---|
| `--b2-material-shell` | `#15131C` (library background) |
| `--b2-material-cork` | `#5D4630` |
| `--b2-material-paper-pink` | `#E9A6C0` |
| `--b2-material-paper-green` | `#ADD58F` |
| `--b2-material-paper-ink` | `#2A2220` (text on paper) |

Live desktop measurements: notes about 220 px wide, headings 22 px bold Caveat, pins 20 px, tape about 92 × 26 px. Adapt them on small screens.

The library rotates six papers per collection: yellow, pink, coral, green, orange and sand (`--n0` to `--n5` in `web/src/style.css`). Anas chose these on 22 October 2026: any paper colour except blue and purple.

Keep on the board: textured brown cork; the paper colours above; translucent tape and red pins; small tilts; paper shadows and curled corners; handwritten headings; saved screenshot and media thumbnails; summary, tags, source and time; collection and tag filters; open and move notes; Similar, Share, Remind and Delete; and a visible wastebin that works with the existing delete and Undo. Give keyboard and touch alternatives to drag and drop. **Never flatten it into a grid of white rounded cards.**

## Type

- **Inter** for the whole interface, self-hosted from [`web/src/fonts.ts`](../../web/src/fonts.ts) (weights 400, 500, 600, 700), with system fallbacks.
- **Caveat** only for handwritten note headings and handwritten notes on the board (weights 500, 700). Body text, tags and controls on notes stay in Inter.
- Scale (size/line height): Display 56/64 bold (36/44 on phones), H1 40/48, H2 28/36, H3 20/28 semibold, Body 16/24, Label 14/20 medium, Caption 12/16.
- Sentence case. Left aligned. Lines 45 to 75 characters.

Both fonts are bundled with the site, so the library makes no font requests to Google. (The public share page, `/s/:token`, still loads Caveat from Google Fonts; move it over when that page is restyled.)

## Space, shape, controls

From B2 · 06: spacing 4 / 8 / 12 / 16 / 24 / 32 / 48; radius 12 for controls and 20 for cards; 1 px lines, icon strokes 1.75 to 2 px; touch targets at least 44 px on the web and 48 dp on Android; a visible 2 px focus ring; buttons show default, hover, pressed, focus, disabled and loading distinctly. Component names use the `B2/` prefix: `B2/Button`, `B2/Field`, `B2/Card`, `B2/Status`, `B2/Device`, `B2/PetBubble`. Respect reduced motion everywhere.

## Voice

Butler is quiet, nonchalant, discreet, loyal, competent and a little mischievous: Alfred's composure and dry wit. It calls Anas "sir" in natural moments, not in every line.

- Useful first. Name the action and the result.
- Teasing is brief, occasional, and can be turned down or off. Never about money worries, health, private messages or mistakes.
- **No jokes** during failures, sensitive tasks or confirmations.
- Be honest about state: queued, working, awaiting review, completed, failed, stopped. Never say something is done before it is.
- Not a children's toy, a gaming mascot, a corporate chatbot or a luxury concierge.

Examples: "Saved, sir. This one might actually leave your bookmarks." / "Your laptop is offline. I'll keep this queued." / "Ready to send. Check the recipient and attachment first." / "That didn't go through. Retry?"

## Behaviour rules for assistant features

- Keep speaker output, microphone input and wake listening as three separate controls.
- Show the target device on every remote action, and keep Stop visible while a task runs.
- Preview recipients, message and attachments before anything is sent.
- Protected actions use real device verification. The mascot is never an authentication method, and credentials are never hard-coded.
- Respect quiet mode, accessibility settings and reduced motion.
