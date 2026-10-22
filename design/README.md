# Design

## Brand

[`brand/BRAND.md`](brand/BRAND.md) is the Butler 2.0 brand: which Figma pages to use (CURRENT and B2, never LEGACY), the logo masters in [`brand/logo/`](brand/logo/), colours, type, voice and the sticky-note board rules. The tokens are in [`web/src/b2-tokens.css`](../web/src/b2-tokens.css).

## Little Butler

`little-butler/` is Butler's mascot kit (v0.1): a small charcoal shadow butler with a collar and tie. It has 16 poses, 20 animation clips, a web component and an Android sprite view. Its own [README](little-butler/README.md) explains each part, and [BEHAVIOR.md](little-butler/docs/BEHAVIOR.md) covers how it should move and react.

The pets on each device use this art. The GNOME pet copies the frames it needs into `desktop/gnome/butler-pet@anasmasama.dev/pets/` (see `desktop/gnome/update-sprites.py`).

The generated files are left out to keep the repo small: `demo.html`, the animated `.webp` previews, the 240 single-frame PNGs and `CHECKSUMS.json`. Rebuild them from the poses with:

```sh
cd design/little-butler
npm run build:assets   # needs Node.js, and Python 3 with Pillow
npm run build:demo
```
