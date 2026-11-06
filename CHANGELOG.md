# Changelog

What changed in each release. Newest first. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## Unreleased

- **Bubbles show the whole answer.** The pet's bubble on the laptop and phone used to show only the first line, cut off after a few words, unless you tapped it. Now the answer wraps under the buttons; a long one shows its start and **Show more**, and scrolls inside the bubble past half the screen. Messages on the website's home also wrap, with Show more. Needs the new APK and `update-pet` (then log out and back in).
- **Butler holds a real conversation.** When what you say isn't a job (a reminder, an email…), Butler now answers in a separate step that reads the whole chat as real back-and-forth turns, what it remembers about you, and saves from your library that look related, on full Gemini Flash rather than Flash-Lite. Before, the answer was a one-line field squeezed out of the action picker. It also remembers the last week (40 turns) instead of two days (20). Server only: no new APK or update-pet needed.
- **Reminders and events ring with mobile data off.** While online, the phone keeps a copy of the next two days of reminders and events (refreshed every 5 minutes while the pet runs, and with each background sync) and sets an alarm for each. If Butler can't reach the phone when the moment comes, the phone shows it by itself. Whichever comes first is shown; the other is skipped. New emails, codes and messages still need internet: those can't be known ahead. Needs the new APK.

## v0.3.1 (2026-11-02)

Email heads-ups now cover any important email, not only the kinds Butler had rules for.

- **Any email that matters.** A flight changed, a parcel that couldn't be delivered, exam results, an answer to an application, a notice from your bank, school or the government: if no rule recognises an email and it isn't plainly noise, the AI decides whether it's worth a text. It's told to be strict, and at most 4 of these go out an hour (`BUTLER_HEADS_UP_OTHER_PER_HOUR`), using their own AI allowance so payments and security alerts are never crowded out.
- Newsletters, digests, sales, receipts, welcomes and social notifications still stay quiet without asking the AI.
- Nothing changes for privacy: login codes and reset links never go to an AI (an email that mentions a code the rules can't read is skipped, not sent), passwords and Wi-Fi keys are blanked, the phishing warning stays, and these heads-ups wait out quiet hours like the rest (only codes, links and security alerts never wait).

### Known limits

- Gmail sync was reported failing on 2026-11-02, so this hasn't been tried on real email yet. It's checked by tests only.

## v0.3.0 (2026-11-02)

Butler now texts you first: email heads-ups, login codes, events before they start and a few daily touches, in the app, on the laptop or in a private Telegram bot. It also remembers your conversation, sends real files between phone and laptop, and organizes saves faster on a CPU-only server.

### Butler texts you first

- **Email heads-ups.** Butler reads new email and texts what matters: login codes and reset links (shown once, never kept, never sent to an AI), failed payments and bills with the pay link, security alerts, deadlines with "want me to put that on your calendar?", people who need an answer, and events an hour before they start with the place and ticket or join link (from email and Google Calendar, told once). Newsletters and receipts stay quiet, phishing that fails Gmail's sender check is called out, and anything that can wait is held overnight.
- **Heads-ups look like texts.** The link's picture and title, a tap to open it, short `/go/` links instead of long tracking ones, and a Copy code button for login codes. Secret links are never shortened or previewed.
- **SMS codes to the laptop.** Switch it on in the phone's Settings and a login code that arrives by text pops up on your laptop, ready to copy, then disappears. Needs the new APK and `update-pet`.
- **Daily touches.** A "did you know" every morning ("want to know more?"), AI headlines after the brief, and a Friday check-in whose answer goes in your library. Each has a switch in Settings.
- **Roast me, research this, read it for me.** A roast built on what Butler knows about you, web research with sources, and an email read for you with its PDF attachment.

### Butler in Telegram

- **Butler in Telegram.** A private Telegram bot that only answers you: talk or send voice notes like Ask Butler, save links, photos, files and forwarded messages to your library, search it with `/find` or `@bot` in any chat, approve emails with a tap, run laptop commands with your secret word (the message is deleted right after), and get reminders (with Snooze), the morning brief and Butler's notes in the chat. Connect it under Integrations; the Butler Library button opens your library inside Telegram. Butler also serves a privacy policy at `/privacy-policy`. See [docs/telegram.md](docs/telegram.md).
- Connect Telegram also offers **Open in Telegram Web** and shows the `/start` code to type yourself, for when the link opens the wrong Telegram.

### Talking to Butler

- **Butler remembers.** Ask Butler sees the last two days of your conversation, so follow-ups like "and tomorrow?" work, and learns lasting facts about you (people, preferences, plans) for every reply. See, add and forget them in Settings → Memory; switch learning off with Learn about me. Passwords, codes and card numbers are never kept.
- **Reply to the pet.** Every answer in the phone and laptop pet's bubble has a reply box under it.
- **Replies follow on.** Butler's own notes (the morning brief, recipes, price drops, cheers) and reminders now join your conversation as they arrive, so "nah", "yes do it" or "later" answers what Butler last said, whether you use the bubble's reply box, Ask Butler or your voice. Replying to an old note works too. A screenshot sent with a reply is only background now, so Butler no longer answers "nah" with what's on your screen.
- **Chat about one save.** Ask Butler about this, on each library card and in the phone app's save screen: questions answered from the save's full content, and orders carried out with it (reminders, events, email, connected apps, renaming it).

### Phone and laptop

- **Send real files between phone and laptop.** Send to phone / Send to laptop now sends the actual file: the photo open in Gallery, files selected in Files on either device, or the file open in a laptop viewer. On the phone the pet presses the app's Share button and picks Butler's new **Send to laptop** for you; on the laptop, right-click → Scripts → Send to phone works too. Files go directly over the same Wi-Fi or hotspot with no internet (encrypted, only your paired laptop), else through your Butler server, resuming after drops. The pet shows a progress bar over its head while files arrive, then where they were saved, with Open folder.
- **File sending fixed.** Send to laptop from the phone's Share menu failed because Android took away the permission to read the files the moment the Share screen closed; the files are now opened before it closes (photos still in the cloud are copied first). Send to phone on the laptop waits longer for Files to copy the selection, gives Files the keyboard first, and says what to try if it still can't see it. Either side now falls back to the Butler server when the Wi-Fi link breaks, and the laptop logs why a send failed in `~/.local/state/butler/link.log`.
- **Laptop control says why.** A command the laptop doesn't pick up in 10 minutes (asleep, locked out, offline) is dropped with a reason on the phone and website, instead of vanishing. Sending to a laptop that hasn't checked in lately warns you straight away, and a running job that goes quiet for 25 minutes is called out. The laptop also retries its final report, waits longer for slow AI answers, and no longer loses commands when a check-in drops halfway.
- **No more black screenshots.** When an app hides its screen (banking, Netflix, private tabs) the phone saves the link alone and says why. On the laptop, a window that comes out empty is taken again from the screen, and see-through edges go white instead of black.
- **Words when the picture is hidden.** If a phone app hides or blacks out its picture, Save this keeps the words on screen with the link. Never from banking or money apps, and never password fields.

### Google

- **Calendar, tasks and email that tell the truth.** When Google fails (expired sign-in, a permission not given, an API switched off) the brief says what went wrong and how to fix it, instead of "nothing on your calendar today". The website shows "Needs you" with a Connect Google again button. The brief now reads every calendar you show in Google Calendar, your Google Tasks (due today and overdue) and unread email, and works for other days ("what's on Friday?"). Ask Butler answers "any important emails?" and "what are my tasks?" from the real thing, and never guesses an empty day. Press Connect Google once more to allow Tasks and all calendars.

### Speed

- **Faster local organizing.** On the CPU-only server the local model writes about 6 tokens a second and reads about 17, so Butler now sends it less to read (long pages, video notes, shared text and collection lists are cut down), caps how much it may write, asks Ollama for one fixed context size so the model is not reloaded between requests, and answers a repeated save from memory instead of asking again.

### License

- Butler is now licensed under AGPL-3.0. The logos and the Little Butler character stay all rights reserved.

### Before you use it

- Install the new APK on the phone and run `update-pet` on the laptop (then log out and back in). SMS codes, file sending and the reply box need both.
- Press **Connect Google** once more to allow Tasks and all calendars.
- For Telegram, press **Connect Telegram** under Integrations and tap Start in the bot.

### Known limits

- Most of this release has only been checked by tests, not yet on a real phone, laptop or Telegram account. Report what breaks.
- The APK is still signed with a debug key, so Android warns before installing it.

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
