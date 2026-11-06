# Butler pet for Windows

Little Butler for Windows 10 and 11: the same pet as on the GNOME laptop and the phone. It peeks from the bottom-right corner of your screen; drag it anywhere and it stays there. Click it for the menu.

> **Status: built, not yet tried on a real Windows computer.** CI tests it and builds the installer on every change, but nobody has run it on Windows yet. Please report what breaks.

## What it does

- **Act on this**: reads your screen and offers what it asks of you (a reminder, an event, a task, a check). Nothing happens until you press **Do it**.
- **Draft a reply**: click into a chat's message box first, then tap this. Butler reads the chat and pastes a reply where your cursor is (also on your clipboard). It never presses Enter.
- **Save this**: a screenshot plus whatever text you've selected. Windows doesn't let apps read a browser's address, so to save a page's link, select the address bar first (Ctrl+L) and then Save this.
- **Copy this**, **Analyze this**, **Solve this**, **Translate this**.
- **Ask me anything…** at the top of the menu, or **Talk to Butler** with your microphone. Answers show whole in the bubble; long ones show six lines and **Show more**. Reply in the bubble to follow on.
- **Send to phone** (the selection, or a screenshot), **Send files to phone** (pick any files; they go through your Butler server), **Ring my phone**.
- Reminders, notes, links, login codes and files from your phone arrive as a Windows notification and a note from the pet. Files land in `Downloads\Butler`. If your phone rings this computer, tap the pet to stop it.
- **Clipboard sync** (off until you turn it on): what you copy here lands on your phone's clipboard. For clipboard history, use Windows' own **Win+V**.

Not on Windows yet: doing things on screen for you, remote control from your phone (Claude Code), and sending files directly over Wi-Fi without the server. See [docs/platforms.md](../../docs/platforms.md).

## Install

1. Download `butler-<version>-windows-setup.exe` from the latest release (or from the **butler-windows-installer** artifact of a CI run) and open it. Windows SmartScreen may warn because the installer isn't code-signed: choose **More info → Run anyway**.
2. Butler opens its settings: paste your Butler address (like `https://butler.yourdomain.com`) and the same token as your phone app. If you also run the GNOME pet, name this computer `windows` so the two don't share a name.
3. The pet appears in the bottom-right corner, and Butler starts with Windows from then on. Its tray icon (by the clock) has Show, Hide, Clipboard sync, Settings, Check for updates and Quit.

Settings live in `%APPDATA%\Butler\pet.json`, only readable by your Windows account.

## Update

- The installed app checks for a new release every 6 hours and installs it the next time it closes. This works once the repository is public; while it's private, use the next way.
- From a copy of the code (Git and Node.js 22 needed): `powershell -ExecutionPolicy Bypass -File desktop\windows\update-pet.ps1`. It pulls the latest code, builds the installer and installs it, like `update-pet` on Linux.

## Develop

```powershell
cd desktop\windows
npm ci
npm test        # the server client, settings, messages and file transfer
npm start       # runs the pet from the code, with the GNOME pet's sprites
npm run dist    # builds dist\butler-<version>-windows-setup.exe
```

It's an Electron app: `src/main.js` runs the pet (screenshots, clipboard, keys, the inbox), `src/pet.html` and `src/pet.js` draw it, and `src/preload.cjs` is the only bridge between them. Copy and paste are pressed with Windows' SendKeys through PowerShell (`src/keys.js`), which only ever sends fixed shortcuts. The sprites come from `desktop/gnome/butler-pet@anasmasama.dev/pets`, so both pets always match.
