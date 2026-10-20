# Butler pet for GNOME

A small charcoal butler that peeks out from the bottom-right corner of your screen. Drag it anywhere you like: it stays where you drop it, and peeks again if you drop it on the bottom edge. Tap it for quick actions:

- **Save this**: saves a screenshot of the window you're in, plus the page's link in a browser or the text you've selected in any other app. On a feed (TikTok For You, the X home page, Instagram and so on), the address bar doesn't hold the post's link, so the pet taps the post's Share button, then Copy link, and saves that link instead.
- **Copy this**: copies what you've selected.
- **Analyze this** and **Solve this**: Butler looks at the window and explains it, or solves the problem on it. The answer shows beside the pet (tap it to close) and is copied so you can paste it.
- **Send to phone**: sends the page you're on (in a browser), the text you've selected, or else a screenshot to your phone.
- **Clipboard sync** (off until you press it): whatever you copy on the laptop lands on your phone's clipboard within about 20 seconds, ready to paste. Copies from password managers are skipped, and the server forgets each copy once your phone has it.
- **Ask me anything…**, the box at the top of the menu: click it, type what you want and press Enter, for example "remind me at 3 to call Mum", "add dentist Friday 10am to my calendar", "send what I copied to my phone", "email this to David" or "what does this error mean?". Butler sees the window you're on, so "this" works. Escape or a click outside closes it.
- **Talk to Butler**: say it instead. The pet listens until you tap it (or for 20 seconds), using PipeWire's `pw-record`, which Ubuntu has already.
- Doing things on screen: "search YouTube for jollof rice", "open the first video", "fill this form with my name". The pet takes a screenshot, Butler picks the next click, scroll or typing, the pet does it, and so on, up to 15 steps. Tap the pet to stop it at any time. It stops by itself before anything you should do yourself: paying, sending messages or email, posting, deleting, or typing passwords.
- Messages: "WhatsApp David I'm running late" opens WhatsApp Web with the message typed in, and "send this to David on Telegram" opens Telegram's share page. You press Send. With Google connected, Butler finds David's number in your contacts; a screenshot you wanted sent goes on your clipboard to paste.

Every 20 seconds the pet checks for reminders and anything your phone sent. They arrive as a desktop notification and a note from the pet: copied text goes straight onto your clipboard, links open when you tap the note, and files land in `~/Downloads/Butler`.

Share, Analyze, Solve and Ask Butler need a Gemini key on the server (`GEMINI_API_KEY` in `deploy/butler.env`). The key stays on the server: the pet sends the screenshot to Butler, and Butler asks Gemini.

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

## Update it

Install the `update-pet` command once, from the repo folder:

```sh
mkdir -p ~/.local/bin && ln -sf "$PWD/desktop/gnome/update-pet.sh" ~/.local/bin/update-pet
```

After that, run `update-pet` whenever the pet changes, then log out and back in.

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
