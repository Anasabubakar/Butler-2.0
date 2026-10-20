# Butler pet for GNOME

A small charcoal butler that peeks out from the bottom-right corner of your screen. Tap it and it hops up out of the way, with quick actions:

- **Save this**: in a browser it saves the page's link to Butler. In any other app it saves the text you've selected.
- **Copy this**: copies what you've selected.
- **Analyze this** and **Solve this**: coming next, once there's a vision model to read the screen.

It runs as a GNOME Shell extension (GNOME 46 to 48). Living inside the desktop is what lets it stay on top of every window and press keys for you on Wayland.

## Install

```sh
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r desktop/gnome/butler-pet@anasmasama.dev ~/.local/share/gnome-shell/extensions/
```

Tell it where Butler is, using the same save URL and token as the phone app:

```sh
mkdir -p ~/.config/butler
cat > ~/.config/butler/pet.json <<'JSON'
{ "url": "https://butler.anasmasama.dev/api/save", "token": "PASTE-YOUR-BUTLER-TOKEN" }
JSON
chmod 600 ~/.config/butler/pet.json
```

Log out and back in (Wayland only loads new extensions at login), then run:

```sh
gnome-extensions enable butler-pet@anasmasama.dev
```

## Try it without logging out

This opens a separate GNOME desktop in a window, with the pet in it:

```sh
dbus-run-session -- gnome-shell --nested --wayland
```

Inside it, run `gnome-extensions enable butler-pet@anasmasama.dev`, then open a browser and tap the pet.

## Change how it looks

The pet is the Little Butler from `design/little-butler/`. Its frames live in `pets/`: one folder per animation (summon, idle, blink, think, work, success, error, hide), plus `peek.png` for the still pose it shows while peeking. `pets/clips.json` holds each animation's frame count, timing and the clip that plays next.

After changing the kit, copy the frames again (needs `python3-pil`):

```sh
python3 desktop/gnome/update-sprites.py
```
