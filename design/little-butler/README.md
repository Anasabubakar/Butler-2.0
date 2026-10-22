# Little Butler · usable mascot kit v0.1

> This is the animated pet. It is not the logo: logos, colours and type are in [`../brand/BRAND.md`](../brand/BRAND.md) (Butler 2.0 only, never the LEGACY Figma pages).

A tiny, nonchalant charcoal shadow butler, based on the approved soft 3D concept.
This archive contains real transparent art, playable animations and working UI source.

## Try it immediately

Double-click **demo.html**. It is self-contained, needs no install, and works offline.
Use the mascot at the bottom corner. Tap/click to open; hold/right-click for actions;
drag to change corners; Esc hides it. The page also has buttons for every animation.

For module development, install Node.js and run `npm start`, then open
http://127.0.0.1:4173. No `npm install` is necessary for the web kit.

## What's included

| File | Purpose |
| --- | --- |
| `assets/poses/*.png` | 16 baseline-aligned RGBA poses, 256 × 320 each |
| `assets/butler-atlas.png` | Transparent 2304 × 4800 sprite atlas: 20 rows, 12 frames per row |
| `assets/butler-atlas.json` | Exact frame rectangles, timing, looping and next-state metadata |
| `assets/animations/*.png` | 20 horizontal animation strips, 2304 × 240 each |
| `assets/animations/<state>/*.png` | 240 individual frames at 192 × 240 |
| `assets/animations/*.webp` | Animated transparent previews |
| `assets/motion.json` | Editable sampled motion parameters |
| `src/motion.js` | Pure motion curves and state definitions |
| `src/index.js` | Animated web component plus compact controls |
| `src/index.d.ts` | TypeScript API declarations |
| `integrations/android/ButlerSpriteView.kt` | Native Android sprite playback view |
| `docs/BEHAVIOR.md` | Interaction, voice, docking and personality specification |
| `docs/INTEGRATION.md` | Event contract and platform integration boundaries |
| `reference/source-atlas.png` | Original generated transparent source art |
| `tools/` | Reproducible export, packing, standalone demo and local server scripts |

The artwork is **pre-rendered soft 3D in 2D sprites**, not an editable 3D mesh or rig.
The animation engine combines 16 distinct key poses with breathing, tilt, bounce,
translation and squash/stretch. The 240 exported frames are sampled from those
curves, rather than 240 independently sculpted character poses.

## Add to a web / Electron / Tauri frontend

Copy `src/` and `assets/` together, preserving their relative paths.

```html
<script type="module" src="./little-butler/src/index.js"></script>
<little-butler id="pet"></little-butler>
```

```js
const pet = document.querySelector('#pet');
await pet.ready;
pet.setDevices([
  { id: 'phone', name: 'Android phone', online: true },
  { id: 'linux', name: 'Linux laptop', online: true }
]);

pet.addEventListener('butler:command', async ({detail}) => {
  pet.setState('think');
  // Implement in YOUR app: send detail.text and detail.deviceId to your backend.
});

pet.addEventListener('butler:action', ({detail}) => {
  // detail.action: save | screenshot | record | remind | clipboard | more
});

pet.addEventListener('butler:stop', () => {
  // Cancel the actual request/recording/tool execution in YOUR app.
});

pet.setState('work', {progress: 0.4});
pet.say('Handling it.');
pet.setState('success');
```

For relocated images use `<little-butler assets="/your/poses/"></little-butler>`.
Provide a trailing slash. Set this before attaching the element to the document.
If your bundler relocates assets, explicitly copy them and configure this attribute.

### Approvals

```js
const approved = await pet.confirm({
  title: 'Send screenshot?',
  description: 'Send the current screenshot by email.',
  recipient: 'David · david@example.com',
  device: 'Android phone',
  attachment: 'screenshot.png'
});
if (approved) {
  // Run your host biometric/system verification here if required.
  // Then call your real send implementation.
}
```

`confirm()` returns a UI decision only. It is not identity verification. The kit
does not store passwords or provide a biometric implementation.

### Voice

`pet.setVoice(true)` enables browser speech output for `pet.say('…')` where
supported. Voice input, wake-name recognition and microphone acquisition are host
integrations: handle `butler:talkrequest` and `butler:preference` events. Muting
speech output does not change the microphone preference. No microphone is opened
by this kit. Browser speech voice availability varies by device and installed voices.

## Use just the sprites in another engine

Read `assets/butler-atlas.json`: `frames[name].frame` is a top-left pixel rectangle.
Each clip in `animations` gives ordered frame keys, total duration in milliseconds,
looping behavior, and a next state for one-shot animations. All frames are untrimmed
with straight alpha; source pivot is bottom-center (0.5, 0.95).

For Android, see `integrations/android/README.md`. Unity, Godot, Flutter and native
desktop renderers can consume the PNG strips or JSON atlas without the web component.

## Verify and rebuild

`npm test` checks valid poses, animation seams, reduced motion, state transitions,
and atlas bounds. `npm run build:assets` requires Python 3 with Pillow; the web
runtime has no third-party dependencies. `npm run build:demo` regenerates demo.html.

The source atlas is included for art provenance; the normalized individual poses
are the editable inputs used by the build script. Replacing those poses and rerunning
the build updates the exported animation assets.

## Scope

This is the visual and interaction layer. It includes no AI model, cloud server,
cross-device synchronization, email/chat integration, remote terminal, screen capture,
clipboard service, authentication, installed app or native always-on-top window.
Those connect through the documented events. Browser content alone cannot place a
pet above other apps. Linux compositor behavior, Windows desktop overlays and Android
overlay permissions require native host work. No platform installation is claimed.

Validation in this environment: source syntax and automated motion/atlas checks;
all exported PNGs checked for transparency and dimensions. Browser execution could
not be verified here because local server/browser access was restricted. The Android
adapter is supplied as integration source and has not been compiled on a device.

This is your project asset kit. No third-party character assets, web fonts, external
CDN scripts or tracking are included. No third-party exclusivity claim is made for
generated artwork.
