# Features

Everything Butler does today, and how to switch each part on or off. Most settings live in `deploy/butler.env` (see [self-hosting](self-hosting.md)).

## Connections (MCP)

Ask Butler can use tools from other services that speak MCP (the Model Context Protocol): Zapier, Notion, GitHub, or a server you wrote. On the website, press **Connections**, give it a name, paste the server's link, and add its key if it needs one (most use **API key (Bearer)**). Butler connects, lists the server's tools, and from then on picks one when it fits what you asked, like "add milk to my shopping list in Notion".

- Tools the server marks as read-only run straight away. Anything that could send, change or delete shows you exactly what it will do and waits for your yes on the phone or laptop. You can change this per tool: **Just do it**, **Ask me first** or **Off**.
- One tool per request, and what a tool sends back is only shown to you, never acted on, so a tool's reply can't make Butler use another tool.
- Links and keys are encrypted in the database (see `BUTLER_VAULT_KEY`) and never sent back to the browser.
- Only public `https://` addresses are allowed: nothing on your home network, the Docker network, or this server's own machine.
- **What Butler used lately** lists every call, whether you said yes first, and hovering shows what came back.
- Not yet: servers that only sign in with OAuth, and local (stdio) servers.

**Zapier:** at [mcp.zapier.com](https://mcp.zapier.com), make a server, pick the actions you want, and generate a connection token (it's shown once). In Butler, use the link `https://mcp.zapier.com/api/v1/connect`, sign-in **API key (Bearer)**, and the token as the key.

## Recipes

A recipe is a set of instructions you save once and run by name, like Poke's recipes. On the website, press **Recipes**, give it a name ("Morning check") and write what Butler should do, the way you'd tell a person. You can tick which connections it may use (none ticked means any). Then say "run my morning check" to Ask Butler, or press **Run** on the website.

- A recipe can take up to 5 steps with tools that only read, using what each one sends back for the next step.
- A step that would send, change or delete is always the last step, and it waits for your yes. That holds even for tools you've set to **Just do it**, because inside a recipe, earlier tool replies could try to steer what it does next.
- If a recipe takes longer than about 18 seconds (`BUTLER_RECIPE_WAIT_MS`), Butler finishes it in the background and sends every device a note. A step waiting for your yes then shows under **Waiting for your yes** in Recipes on the website, for 24 hours.
- Waiting steps are kept in memory, so a deploy or restart forgets them and you run the recipe again.
- **Run on its own**: tick it and pick a time (your time zone, as your devices last reported it) and days. Butler runs it once on each of those days and sends every device the result as a note. If the server was down at that time it catches up within 3 hours, otherwise it skips that day.
- **Run on new email**: tick it and give a Gmail search, like `from:mybank.com subject:alert`. Every 2 minutes Butler looks for email matching it that came in since you saved the search, and runs the recipe once per email, with the sender, subject and text given to the recipe to work on. This needs Butler to read your email (`gmail.readonly`): if you connected Google before this existed, press **Connect Google** again. A check that fails shows on the recipe.
- **Start it from a link**: open "Start it from a link" on a recipe and press **Make a secret link**. Anything that can send a POST to it (a Zapier or IFTTT webhook, Tasker or MacroDroid on your phone, a script) starts the recipe, and whatever it sends (up to 16 KB) is given to the recipe to work on. Keep the link private; **New link** replaces it and **Turn off** removes it.
- What starts a recipe (an email, what a link was sent) is treated as data, never as instructions, and anything that changes things still waits for your yes. A recipe started this way runs at most once every 30 seconds and 30 times a day, so a noisy inbox or a leaked link can't flood you.


## Collections by topic

Each save goes in a collection named for what it's actually about, not where it came from: a GitHub repo for a CRM run by AI agents lands in **AI CRM**, not "GitHub" or "tech". To work that out Butler reads the link's page, a repo's description and README, and for YouTube what's said in the video (the save is sorted again once the video has been watched). Collections that already exist are reused, so similar saves end up together; the broader field (ai, cooking) goes in the tags. Saves from before this are sorted again in the background, a few a minute, oldest first; only their collection and tags change. Set `BUTLER_RESORT=off` to skip that.

## Find similar and search by meaning

With `GEMINI_API_KEY` set, every organized item also gets an embedding (numbers that capture what it's about). On the website, the **≈** button on a card shows the items closest to it, and searches add a **Close in meaning** row, so "saving money" finds "budget tips" without the exact words. Items saved before this existed are filled in when the server starts.

Ask Butler on the phone or laptop can also answer from your library: "what was that jollof recipe I saved?" or "open that TikTok about budgeting". It looks for the closest saves, answers from them only, and lists the ones it used with their links. It opens the first one if you said open, show, play or watch.

## Video notes

Save a YouTube video and Butler watches it (with Gemini) and writes a short summary plus its key points. Press **▸ Key points** on the note to read them. Ask Butler can answer from them too, like "what temperature did that jollof video say?". Set `BUTLER_VIDEO_NOTES=off` to stop it.

## Morning brief

Every morning at 08:00 your time, Butler sends a note to your phone and laptop. It has today's calendar, the reminders still to come, how much you saved in the last day, and one older save worth another look. Ask Butler "what's my day?" to get it any time. It learns your time zone from Ask Butler; set `BUTLER_BRIEF_AT` in `butler.env` for a different time, or `BUTLER_BRIEF=off` to stop it. If the server is down at 08:00, the brief comes when it's back, up to noon.

## Weekly recap

Every Sunday at 18:00 your time, Butler sends a note with what you saved that week: how many, by topic and app, your top tags, and three worth another look (ones you wrote a note on come first). Ask "what did I save this week?" for it any time. Set `BUTLER_RECAP_AT` for a different time, or `BUTLER_RECAP=off` to stop it.

## Price watch

Save a product page (Jumia, Konga, Amazon and most shops) and Butler reads its price from the page's structured data, the same data Google Shopping uses, then checks it twice a day. If it drops by 5% or more, every device gets a "📉 Price drop" note with the link, and the save's card shows the new price next to the old one. Shops that don't publish a price that way, or that block bots, aren't watched; Butler never guesses a price from the page text. Set `BUTLER_PRICE_WATCH=off` to stop it.

## Dead-link rescue

Every public link you save is also saved to the Internet Archive's Wayback Machine. Once a month Butler checks old links; if a page has disappeared, its note says so and opens the saved copy instead, and Ask Butler links to the copy too. Set `BUTLER_ARCHIVE=off` to stop it. Social posts (the Archive can't copy them), Google Docs, Dropbox and other private links, and links carrying a token or key are never sent, since archive.org copies are public.

## Share a note

Press the share button on a save in the Library to get a secret link to just that save (on the phone it opens the share sheet; on a computer it's copied). Anyone with the link sees a single sticky note with its title, summary and the original link, and WhatsApp or X show a preview. Nothing else in your library is visible. Shared notes wear a "shared" stamp; press 🔗 again and choose **Stop sharing** to kill the link.

## Remind me later

Press ⏰ on any note to bring it back later: in an hour, this evening, tomorrow morning, this weekend or next week. At that time it arrives as a reminder on all your devices, with its link.

## Spending log

Tell Butler what you spend, typed or out loud: "I spent 2,500 on suya", "paid 15k for transport". Ask "how much did I spend this week?" or "what did I spend on food this month?" and it adds it up (by plain arithmetic, not AI). The Sunday recap includes the week's spending. Amounts are in naira unless you say another currency; set `BUTLER_CURRENCY` (like `USD`) to change that.

## Focus timer

Ask Butler "focus for 25 minutes on my essay" (or just "pomodoro"). When the time is up, every device tells you to take a break. "Stop focus" cancels it.

## Streaks and milestones

Butler cheers on every device when you hit a round number of saves (10th, 25th, 50th, 100th…) or save something several days in a row (3, 7, 14, 30 days…). The morning brief shows your current streak.

## Clipboard sync

Turn on **Clipboard sync** in the laptop pet's menu, and whatever you copy on the laptop lands on your phone's clipboard within about 20 seconds. Copies from password managers are skipped, only your latest copy waits on the server, and it's deleted once the phone takes it. On the phone, turn on **Clipboard sync** in the pet's menu too, and it works the other way. Android doesn't let apps read the clipboard in the background, so Butler's Accessibility helper notices when you tap **Copy** (or see a "Copied" message), and a see-through screen opens for a split second to read it. Android then shows "Butler pasted from your clipboard"; that's expected. Copying with a keyboard shortcut, or in an app that copies without a Copy button or message, won't be noticed; use Ask Butler's "send what I copied to my laptop" then.

If sync works for a while and then stops, Android has paused Butler to save battery. Butler asks for this when you turn sync on; if you said no, go to Settings → Apps → Butler → Battery and pick **Unrestricted**. The laptop logs failed sends to the system journal (`journalctl -b /usr/bin/gnome-shell | grep Butler`).

## Clipboard history

Everything you copy on the laptop with Ctrl+C, text or pictures, is kept with the time you copied it. Press **Super+Shift+V** (or pick **Clipboard history** in the pet's menu) to search it, paste an old copy, pin, or delete. It stays on the laptop. See `desktop/gnome/README.md`.

## Control the laptop from your phone

Tap the phone's pet, then **Tell my laptop** (or switch the command sheet to **My laptop**), and type or say what you want: run Claude Code on a project until it's done, open something, or do a task on screen. The phone pet's bubble shows what the laptop is doing as it goes, with **Stop**, and the result when it ends (also as a silent notification, in case you weren't looking). It's off until you set a secret word and turn it on in the laptop pet's **Remote control** panel, and every command must contain that word. Setup and the safety rules are in `desktop/gnome/README.md`.

## Find my phone

Press **Ring my phone** in the laptop pet's menu or at the top of the website, or ask Butler "where's my phone?". Within about 20 seconds the phone rings at full alarm volume, even on silent, and buzzes for a minute. Tap the pet or the notification to stop it. It works the other way too ("ring my laptop"); the laptop unmutes and plays a ringtone. A ring that couldn't reach the device within 5 minutes is dropped, so it never goes off hours later.

