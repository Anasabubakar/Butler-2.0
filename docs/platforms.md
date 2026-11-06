# Which feature works where

Butler has three kinds of parts:

- **The server and website.** Anything you do on the website (library, recipes, connections, OAuth, Telegram, settings) or that Butler does by itself (morning brief, heads-ups, price watch) works the same from any computer with a browser: Windows, Linux or Mac. Nothing to install.
- **The phone pet** (Android app).
- **The laptop pet.** On Linux it's a GNOME Shell extension (`desktop/gnome`). On Windows it's a separate desktop app (`desktop/windows`). They talk to the same server in the same way, so a phone can't tell them apart.

This table covers what needs the pet on the device itself. Last checked 2026-11-06.

✅ built · 🧪 built but not yet tried on a real device · 🟡 partly · ❌ not built · ➖ doesn't apply

| Feature | Android | Linux (GNOME) | Windows |
|---|---|---|---|
| Pet that peeks from the screen edge, drag anywhere | ✅ | ✅ | 🧪 |
| Save this (screenshot + link or selection) | ✅ share sheet and pet | ✅ | 🧪 screenshot + selected text; link only if you copy it |
| Save a link from a feed by pressing Share → Copy link | ✅ | ✅ | ❌ |
| Copy this | ✅ | ✅ | 🧪 |
| Analyze / Solve / Translate this | ✅ | ✅ | 🧪 |
| Act on this (reads the screen, offers the reminders, events and tasks in it) | 🧪 | 🧪 | 🧪 |
| Draft a reply into the chat box | 🧪 types it in | 🧪 pastes into the box you clicked | 🧪 pastes into the box you clicked |
| Ask Butler by typing, reply in the bubble | ✅ | ✅ | 🧪 |
| Talk to Butler (voice) | ✅ | ✅ | 🧪 |
| Bubble shows the whole answer, Show more | ✅ | ✅ | 🧪 |
| Doing things on screen ("open the first video") | ✅ | ✅ | ❌ |
| Reminders, notes, links and codes arrive on the pet | ✅ | ✅ | 🧪 |
| Ring my phone / ring this device | ✅ | ✅ | 🧪 |
| Clipboard sync laptop → phone | ➖ | ✅ | 🧪 |
| Clipboard sync phone → laptop | ✅ sends | ✅ receives | 🧪 receives |
| Clipboard history | ➖ | ✅ Super+Shift+V | ➖ use Windows' own Win+V |
| Send to phone: text, link, screenshot | ✅ | ✅ | 🧪 |
| Send real files between devices (through the server) | ✅ | ✅ | 🧪 send and receive |
| Send files directly over Wi-Fi with no internet | ✅ | ✅ (`link.py`) | ❌ goes through the server |
| Files arrive in Downloads/Butler | ✅ | ✅ | 🧪 |
| Remote control: phone tells the laptop what to do (Claude Code) | ✅ sends | ✅ | ❌ |
| SMS login codes shown on the laptop | ✅ sends | ✅ | 🧪 |
| Offline reminders with mobile data off | 🧪 | ➖ | ➖ |
| Offline library | ✅ | ➖ (website) | ➖ (website) |
| Updates | new APK from Releases | `update-pet` | installer from Releases, or `update-pet.ps1` |

## Why two laptop pets instead of one

On Ubuntu with Wayland, an ordinary app can't stay on top of every window, take a screenshot without asking each time, or press keys in another app. Only something inside GNOME Shell can, which is why the Linux pet is an extension. Windows has none of these limits for ordinary apps, so the Windows pet is a normal desktop app built with Electron. Electron was chosen over Tauri because the pet is already JavaScript, Electron has screenshots, clipboard, tray, notifications and see-through always-on-top windows built in, and electron-builder makes the installer and auto-update with no extra language (Tauri would need Rust code for most of these).

## Known gaps on Windows

- Not tried on a real Windows computer yet: everything marked 🧪 is checked by tests and by CI building the installer, nothing more.
- Saving a page's link: Windows gives no app the browser's address. Copy the link first (Ctrl+L, Ctrl+C) and Save this keeps it.
- No "doing things on screen", remote control from the phone, or direct Wi-Fi file sending yet. Files go through the server instead.
- The installer isn't code-signed, so Windows SmartScreen warns the first time ("More info → Run anyway").
