# Butler pet for GNOME

A small charcoal butler that peeks out from the bottom-right corner of your screen. Drag it anywhere you like: it stays where you drop it, and peeks again if you drop it on the bottom edge. Tap it for quick actions:

- **Save this**: saves a screenshot of the window you're in, plus the page's link in a browser or the text you've selected in any other app. On a feed (TikTok For You, the X home page, Instagram and so on), the address bar doesn't hold the post's link, so the pet taps the post's Share button, then Copy link, and saves that link instead.
- **Copy this**: copies what you've selected.
- **Analyze this** and **Solve this**: Butler looks at the window and explains it, or solves the problem on it. The answer shows beside the pet (tap it to close) and is copied so you can paste it.
- **Send to phone**: sends the page you're on (in a browser), the text you've selected, or else a screenshot to your phone.
- **Clipboard history**: everything you copy with Ctrl+C, text or picture (screenshots too), newest first, with when you copied it. Open it with **Super+Shift+V** or from the menu. Click a copy to paste it where you were, search it, pin what you want to keep (★), delete one (bin), or Ctrl+click to select several and pin or delete them together. It stays on this laptop only, in `~/.local/share/butler/clipboard`: copies from password managers are skipped, unpinned copies are forgotten after 30 days (or past 500), and **Pause** stops it keeping anything until you press Resume. Copies from your phone show up here too, marked "phone". To use another shortcut, add `"historyKey": "<Control><Alt>v"` to `pet.json`.
- **Clipboard sync** (off until you press it): whatever you copy on the laptop lands on your phone's clipboard within about 20 seconds, ready to paste. Copies from password managers are skipped, and the server forgets each copy once your phone has it.
- **Ask me anything…**, the box at the top of the menu: click it, type what you want and press Enter, for example "remind me at 3 to call Mum", "add dentist Friday 10am to my calendar", "send what I copied to my phone", "email this to David" or "what does this error mean?". Butler sees the window you're on, so "this" works. Escape or a click outside closes it.
- **Talk to Butler**: say it instead. The pet listens until you tap it (or for 20 seconds), using PipeWire's `pw-record`, which Ubuntu has already.
- Doing things on screen: "search YouTube for jollof rice", "open the first video", "fill this form with my name". The pet takes a screenshot, Butler picks the next click, scroll or typing, the pet does it, and so on, up to 15 steps. Tap the pet to stop it at any time. It stops by itself before anything you should do yourself: paying, sending messages or email, posting, deleting, or typing passwords.
- **Remote control** (off until you set it up): your phone can tell this laptop what to do. See "Control the laptop from your phone" below.
- Messages: "WhatsApp David I'm running late" opens WhatsApp Web with the message typed in, and "send this to David on Telegram" opens Telegram's share page. You press Send. With Google connected, Butler finds David's number in your contacts; a screenshot you wanted sent goes on your clipboard to paste.

The pet keeps a line open to Butler, so reminders and anything your phone sent arrive within a second or two. They arrive as a desktop notification and a note from the pet: copied text goes straight onto your clipboard, links open when you tap the note, and files land in `~/Downloads/Butler`.

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
{ "url": "https://butler.yourdomain.com/api/save", "token": "PASTE-YOUR-BUTLER-TOKEN" }
JSON
chmod 600 ~/.config/butler/pet.json
```

Log out and back in (Wayland only loads new extensions at login), then run:

```sh
gnome-extensions enable butler-pet@anasmasama.dev
```

## Control the laptop from your phone

1. Open **Remote control** from the pet's menu. Type a secret word (one word, 4 letters or more) and press **Save word**, then **Turn on**. Only a scrambled copy of the word is kept, in `~/.config/butler/remote.json`, so write it down somewhere safe.
2. On the phone, tap the pet, then **Tell my laptop**. Type or say a command with your secret word anywhere in it, such as "mango finish the glance project, make the tests pass" or "open YouTube mango".
3. The phone pet's bubble shows what the laptop is doing (updated every 20 seconds or so, while Claude Code works), with **Stop**, and the result when it's done or failed.

What it can do:

- **Claude Code** in a folder under `~/Desktop/Projects` ("in glance, fix the failing test"). It runs `claude -p` in the background, so you don't see a terminal; the phone gets what it's doing ("Editing remote.js") and its final summary. It may edit files but isn't allowed to run commands, so a job that needs them (running tests, installing packages) can fail or stop short, and says why. To allow more, add for example `"claudeArgs": ["--permission-mode", "bypassPermissions"]` to `pet.json`; do that only if you're comfortable with Claude Code running any command unattended.
- **Open** a link or an app.
- **Do things on screen**, the same as Ask Butler on the laptop, up to 30 steps. It stops before anything you should do yourself (sending, paying, deleting, passwords) and when the screen stops changing.

While a job runs, a red banner sits at the bottom of the screen. Press **Esc** or click it to stop the job. On the phone, **Stop** does the same, and **Switch off** turns remote control off; only the laptop can turn it back on.

Rules it keeps:

- A command without the secret word is refused. Three of those in 15 minutes turn remote control off.
- The laptop takes the word out of the command before it reaches the AI or the log. The server only passes the command along and forgets it once the laptop has it.
- One job at a time. Claude Code jobs keep running when the screen locks; screen tasks and opening things need the laptop awake and unlocked.
- Everything it was asked and did is in `~/.local/state/butler/remote-log.jsonl`, and the panel shows the latest.

Settings in `pet.json`: `projects` (the folder Claude Code jobs start from, default `~/Desktop/Projects`), `claude` (the path to `claude`, if Butler can't find it), `claudeArgs`, and `claudeMinutes` (how long a job may run, default 120).

Be honest with yourself about the secret word: it travels with your Butler token, so whoever gets one will often have seen the other (in the phone's text box, for example). It stops someone who has only the token; it isn't a second lock as strong as a separate password app. The lockout, the kill switch, the banner and the log are there for that reason.

## Send real files to your phone

**Send to phone** sends the files you picked, not a screenshot: the ones selected in Files (or
Nemo, Dolphin…), or the file open in a viewer or editor (found by its window title in your
recent files). In Files you can also right-click → **Scripts → Send to phone**. Files from your
phone land in `~/Downloads/Butler`, and the pet offers **Open folder**.

The sending is done by `link.py`, which the pet starts (it needs `python3` and `openssl`, both
on Ubuntu already). On the same Wi-Fi, or with the laptop on your phone's hotspot, files go
straight across with no internet: HTTPS on port 53320 with the laptop's own certificate, whose
fingerprint the phone learns from your Butler server once and then insists on. The laptop calls
out on UDP port 53321 so the phone can find it. If you run a firewall (`ufw` is off on Ubuntu by
default), allow both: `sudo ufw allow 53320/tcp && sudo ufw allow 53321/udp`. Otherwise files go
through your Butler server, resuming after a dropped connection.

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
