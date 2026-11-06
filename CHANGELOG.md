# Changelog

What changed in each release. Newest first. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## Unreleased

## v0.4.0 (2026-11-06)

Butler comes to Windows, acts on what's on your screen, drafts replies right in the chat box, signs in to connections with OAuth, and finally talks like a real conversation.

- **Butler on Windows.** A new Windows 10 and 11 app (`desktop/windows`) with the same Little Butler: Act on this, Draft a reply, Save, Copy, Analyze, Solve, Translate, Ask and Talk, Send to phone and real files both ways, Ring my phone, clipboard sync, and everything your phone sends. It installs from `butler-<version>-windows-setup.exe` on the release, starts with Windows, and updates itself from new releases (once the repository is public) or with `update-pet.ps1`. Built and tested by CI only: nobody has run it on a real Windows PC yet. Not on Windows yet: doing things on screen, remote control from the phone, and direct Wi-Fi file sending.
- **Act on this and Draft a reply on the Linux laptop.** The GNOME pet's menu gets both. Draft a reply pastes the draft where your cursor is (click the chat's box first); it never presses Enter. Needs `update-pet`, then log out and back in.
- **Which feature works where**: [docs/platforms.md](docs/platforms.md) lists every device feature on Android, Linux and Windows.
- **Butler's whole reply, every time.** The phone pet's bubble, the laptop bubble, the Ask sheet and Butler's messages on Home used to cut long answers to their first few words. They now wrap the whole answer, with **Show more** for long ones, scroll instead of cutting off, and stay up longer so you can read them. Needs the new APK and `update-pet`.
- **Butler talks properly now.** Chat replies used to be a one-line side note of the step that picks an action, written by the fastest, smallest model with thinking off, in under 120 words, from a squashed copy of the last two days of chat. Now a conversation gets its own reply from a smarter model that reads the last week of chat as real turns, digs up older chat that matches what you said, uses what it remembers about you, can search Google, offers what it can do, and says as much as the answer needs. It also learns new facts about you after each chat, in the background. Sample conversations to check it: `deno task eval-chat`. Server only: no new APK needed.
- **Connections show their real logo.** Instead of the first letter of its name, each connection card now shows the service's own logo, found on its website when you connect it and looked up again every week (and on **Check again**) so it stays current. The letter is still there until a logo is found. Website and server only: no new APK needed.
- **Draft a reply, right in the chat.** In WhatsApp, Telegram, Messages, Instagram, Gmail or any app with a message box, tap the pet and pick **Draft a reply**, or hold it and type "help me respond", "draft a reply" or "refine this message". Butler reads the chat (scrolling up for older messages if it needs them, then back), writes the message as you, in the chat's own language and tone, and types it into the app's box in place of what was there. It never presses Send by itself: you read it and send it, or tap **Send it** on the bubble. Reply to the bubble with "shorter", "more casual", "say no politely" or "in pidgin" and it rewrites what's in the box. If an app won't let it type, the draft goes on your clipboard. Needs the new APK.
- **Act on this can use anything Butler can do.** Besides reminders, events, tasks and your connections' tools, Act on this can now pick any of Butler's own commands as a step ("send this link to my laptop", "log 2500 on suya", "focus for 25 minutes", "open YouTube and search for…"), run on Do it exactly as if you'd asked. When someone in the chat is waiting on an answer, it types a reply into the box for you to check. Writes still wait for Do it; typing a draft doesn't, since nothing leaves the phone until you send it.
- **Act on this.** Tap the pet, then Act on this, while a chat or any screen is showing. Butler reads it and finds what needs doing: "call me in 2 hours" becomes a reminder, "let's talk tomorrow at 3" a calendar event, "send the deck by Friday" a Google Task, and "did CI pass?" or "is the Vercel build green?" is checked right away with your connections. If it can't tell, it scrolls up for more of the chat (5 views at most, then scrolls back), and if it still can't, it asks you one question in the bubble; reply there and it carries on. Anything that changes something waits for Do it. It never sends a message for you. Google Tasks needs Connect Google again (new write permission); until then tasks become Butler reminders. Phone only for now; needs the new APK.
- **Sign in to connections with OAuth.** When you add an MCP connection you can now pick **Sign in (OAuth)** instead of pasting a key: Butler finds the service's sign-in page, sends you there to allow it, and keeps the tokens encrypted and fresh. It signs up by itself where the service allows it, uses its client document (`/oauth/client.json`) where the service reads those, and takes your own app's client ID and secret for services like GitHub that need one. When a sign-in runs out for good the connection shows **Reconnect**. Key connections work as before. Website and server only: no new APK needed.
- **Recipes can read your Google calendar, tasks and email.** A recipe like "Morning check" had no way to look at your calendar or Google Tasks (only your connections, like Apollo, whose tasks call failed), so it guessed and said your day was clear. Recipes now get three read-only tools, `Google/calendar`, `Google/tasks` and `Google/email`, read the same way the morning brief reads them, even when a recipe is limited to certain connections. Recipes are also told to say plainly when they couldn't check something instead of calling it empty. Server only: no new APK needed.
- **Reminders and events ring with mobile data off.** While online, the phone keeps a copy of the next two days of reminders and events (refreshed every 5 minutes while the pet runs, and with each background sync) and sets an alarm for each. If Butler can't reach the phone when the moment comes, the phone shows it by itself. Whichever comes first is shown; the other is skipped. New emails, codes and messages still need internet: those can't be known ahead. Needs the new APK.

### Before you use it

- Install the new APK on the phone and run `update-pet` on the Linux laptop (then log out and back in).
- On Windows, run `butler-0.4.0-windows-setup.exe` from this release.
- Press **Connect Google** once more so Act on this can add Google Tasks.

### Known limits

- Nothing in this release has been tried on a real phone, Linux laptop or Windows PC yet; it's checked by tests and CI only.
- Windows is unsigned, so SmartScreen will warn before it installs ("More info" → "Run anyway").
- Gmail and Calendar sync were reported failing on 2026-11-02 and haven't been confirmed fixed, so anything that reads them may come back empty or with an error.

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
