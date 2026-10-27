# Changelog

What changed in each release. Newest first. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## Unreleased

- Butler is now licensed under AGPL-3.0. The logos and the Little Butler character stay all rights reserved.
- **Butler remembers.** Ask Butler sees the last two days of your conversation, so follow-ups like "and tomorrow?" work, and learns lasting facts about you (people, preferences, plans) for every reply. See, add and forget them in Settings → Memory; switch learning off with Learn about me. Passwords, codes and card numbers are never kept.
- **Reply to the pet.** Every answer in the phone and laptop pet's bubble has a reply box under it.
- **Send real files between phone and laptop.** Send to phone / Send to laptop now sends the actual file: the photo open in Gallery, files selected in Files on either device, or the file open in a laptop viewer. On the phone the pet presses the app's Share button and picks Butler's new **Send to laptop** for you; on the laptop, right-click → Scripts → Send to phone works too. Files go directly over the same Wi-Fi or hotspot with no internet (encrypted, only your paired laptop), else through your Butler server, resuming after drops. The pet shows a progress bar over its head while files arrive, then where they were saved, with Open folder.
- **Chat about one save.** Ask Butler about this, on each library card and in the phone app's save screen: questions answered from the save's full content, and orders carried out with it (reminders, events, email, connected apps, renaming it).

## v0.2.0 (2026-10-26)

The first tagged release. Everything built so far, in one place.

### Save and find anything

- **Save from any app.** Share → Save to Butler on Android, or tap the pet on the GNOME desktop. Links, text, screenshots, pictures and files.
- **Organized for you.** AI writes a title, summary and tags, and files each save in a collection named for what it's really about ("AI CRM", not "GitHub"). It reads the page, a repo's README, or what's said in a YouTube video.
- **Search by meaning**, find similar saves, and ask your library questions ("what was that jollof recipe?").
- **Video notes** with key points, **price watch** with drop alerts, **dead-link rescue** through the Wayback Machine, and **share a note** by secret link.

### A companion on every device

- **Little Butler**, an animated pet that peeks from the screen edge on Android and GNOME, with Save, Copy, Analyze, Solve and Translate this.
- **Ask Butler** by typing or talking: reminders, calendar events, email drafts, spending log, focus timer, and step-by-step actions on the phone screen.
- **Devices talk to each other:** send links, text and files between phone and laptop, clipboard sync both ways, clipboard history on the laptop, ring my phone / ring my laptop.
- **Control the laptop from the phone** (off by default, secret word, kill switch).

### Automate

- **Connections (MCP):** plug in Zapier, Notion, GitHub or any MCP server. Anything that sends, changes or deletes waits for your yes.
- **Recipes and automations:** saved instructions that run by name, on a schedule, on new email, or from a secret webhook link.
- **Morning brief** and **weekly recap**, with streaks and milestones.

### Apps

- **Website:** new Bento-style home, library, Ask Butler, recipes, automations, integrations, inbox, devices and settings, in light and dark.
- **Android:** a native app with its own offline copy of the library. Saves and deletes made offline sync when the internet comes back.
- **GNOME (Linux):** desktop pet extension for GNOME Shell 46 to 48.

### Self-hosting

- One `docker compose up` on any Linux server: Postgres, the server, HTTPS through Caddy, nightly database backups, and copies to Google Drive.
- AI through Gemini with fallbacks (OpenRouter, Groq, OpenAI), Claude, or a local model with Ollama.

### Known limits

- The APK is signed with a debug key, so Android warns before installing it. Not on the Play Store yet.
- Tested on one Android phone and one GNOME laptop. No iPhone, macOS or Windows app yet.
