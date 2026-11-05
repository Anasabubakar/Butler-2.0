# Features

Everything Butler does today, and how to switch each part on or off. Most settings live in `deploy/butler.env` (see [self-hosting](self-hosting.md)).

## Talking with Butler

Ask Butler first works out whether you want something done (a reminder, an email, a check of your calendar) or just want to talk. Actions are picked by a fast model. A conversation gets its own reply, written by a smarter model (Flash rather than Flash-Lite, `BUTLER_CHAT_MODEL` to choose), which:

- reads the conversation as real back-and-forth turns: the last 40 messages from the past week, since your last **New chat**;
- finds older chat that shares words with what you just said, so "when is my visa interview again?" finds what you told it last month;
- knows what it remembers about you, the time, and what it can do for you, so it offers a reminder instead of telling you to set one;
- can look things up on Google when the question needs today's facts;
- writes as much as the answer needs: short for small talk, longer for advice or explanations.

After each reply it looks, in the background, for new lasting facts about you (your people, plans, preferences), when **Learn about me** is on. You can see and forget them on the website.

How well it talks is checked on sample conversations in `tests/evals/chat.json`: `deno task eval-chat` runs them against your real AI key and prints the old and new replies with a 1 to 5 score each.

## Connections (MCP)

Ask Butler can use tools from other services that speak MCP (the Model Context Protocol): Zapier, Notion, GitHub, or a server you wrote. On the website, press **Connections**, give it a name, paste the server's link, and pick how Butler signs in: **Sign in (OAuth)** sends you to the service to log in and allow Butler, like Claude Desktop does; or paste a key (**API key (Bearer)** or **API key in a header**). Butler connects, lists the server's tools, and from then on picks one when it fits what you asked, like "add milk to my shopping list in Notion".

- Tools the server marks as read-only run straight away. Anything that could send, change or delete shows you exactly what it will do and waits for your yes on the phone or laptop. You can change this per tool: **Just do it**, **Ask me first** or **Off**.
- One tool per request, and what a tool sends back is only shown to you, never acted on, so a tool's reply can't make Butler use another tool.
- Links and keys are encrypted in the database (see `BUTLER_VAULT_KEY`) and never sent back to the browser.
- Only public `https://` addresses are allowed: nothing on your home network, the Docker network, or this server's own machine.
- **What Butler used lately** lists every call, whether you said yes first, and hovering shows what came back.
- **Signing in with OAuth** follows the MCP authorization spec. Butler reads the server's description to find its sign-in server, then signs in as: the app you made there (paste its client ID under **More options**), else Butler's own client document at `/oauth/client.json` when the service reads those (Vercel does), else an app Butler signs up for by itself. Sign-in uses a one-time PKCE code and comes back to `PUBLIC_URL/api/mcp/oauth/callback`. Tokens are encrypted like keys and refreshed shortly before they run out. If the service stops accepting them, the connection shows **Reconnect** and Butler stops offering its tools until you sign in again.
- **Logos.** When you connect something, Butler looks on the service's own website for its icon (the big or scalable one if there is a choice) and shows it on the card instead of the first letter. It checks again every week and whenever you press **Check again**, so a new logo shows up by itself. Butler only asks for the public home page and its icons, never sends any key, keeps only real small pictures (anything that could run code is refused) and falls back to the letter when it can't find one.
- Not yet: local (stdio) servers.

**GitHub:** GitHub doesn't let apps sign up by themselves, so make one first: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App, homepage `https://YOUR-BUTLER`, callback `https://YOUR-BUTLER/api/mcp/oauth/callback`. Generate a client secret. In Butler, use the link `https://api.githubcopilot.com/mcp/`, **Sign in (OAuth)**, and under **More options** paste the client ID, the secret, and scopes such as `repo read:user`.

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

## Email heads-ups

Butler reads each new email (every two minutes, once Google is connected) and texts every device only what matters, like a sharp assistant would:

- **Login codes**: "your Sterling Bank code is 482913 (valid for 5 mins)".
- **Password reset and confirm links**: the link, how long it lasts, and the username if the email gives one.
- **Money trouble**: a failed or declined payment, an invoice or bill due, a subscription about to lapse, with the link to pay or update your card.
- **Security alerts**: a new sign-in, a withdrawal request, a password change.
- **Deadlines and required steps**, with "want me to put that on your calendar?" (reply "yes").
- **People writing to you** who need an answer, an offer for your work, or a file to read ("say \"read it for me\"").
- **Anything else that matters**, like a flight changed, a parcel that couldn't be delivered, exam results, an answer to an application, or a notice from your bank, school or the government. The AI decides, strictly, and at most 4 of these go out an hour.
- **Events an hour before** they start, with the place and the ticket or join link. Events come from your email (tickets, webinars) and your Google Calendar, and the same event is told once. Today's events from email show in the morning brief too.

Cheap rules sort every email first, so newsletters, digests, sales, receipts and welcomes are left alone and the AI is asked only about the rest (at most `BUTLER_HEADS_UP_AI_PER_HOUR`, 30, of which at most `BUTLER_HEADS_UP_OTHER_AI_PER_HOUR`, 15, for email no rule recognised). Codes and reset links never go to an AI: they're pulled out by the rules, shown once, deleted as soon as each device has them, kept out of the conversation, and dropped unseen when they expire. An email that fails Gmail's sender check never has its code or link passed on; Butler warns you it may be phishing instead. Heads-ups that can wait (not codes, security alerts or events) are held during quiet hours, `BUTLER_QUIET_HOURS` (23:00-07:00). Switch it off in Settings → Email heads-ups, or `BUTLER_HEADS_UP=off`.

On the phone and laptop a heads-up shows like a text with a preview: the link's picture, title and site, and tapping it opens the link. Long links become short ones on your server (`/go/...`, gone after 30 days). Secret links (password resets, sign-in links) are never shortened or previewed. A login code has a **Copy code** button on the phone; on the laptop, tapping the note copies it, and the copied code stays out of clipboard history.

**Codes from SMS** (Android, off until you switch on Settings → SMS codes to laptop, which asks for SMS permission): when a text with a login code arrives, the phone sends just the code to your laptop, shown once with a Copy button, and gone after 15 minutes. The rest of the text never leaves the phone.

## Daily fact, headlines and the Friday check-in

- At 10:00 your time a **"did you know"** arrives, ending "want to know more?". Reply "yes" and Butler goes down the rabbit hole. It won't repeat a topic for about 40 days. `BUTLER_FACT_AT`, or the Daily fun fact switch in Settings.
- After the morning brief come **headlines** on your topics from the last day (`BUTLER_NEWS`, AI unless set): the AI picks the three that matter and says each in a line, with links. On a thin news day it says so instead of padding.
- On **Friday at 17:00**: "what did you actually get done this week?" Your reply is kept in your library as "Week of ...". `BUTLER_CHECKIN_AT`, or the Friday check-in switch in Settings.

## Roast me, research, read it for me

- **"Roast me"** (or "yab me", then "too weak, go deeper"): a roast built on what Butler really knows, your recent email subjects, your library and your spending. Never about health, family or anyone else, and off when Teasing is off.
- **"Research this"** or "what can I gain from the event?" in reply to a heads-up: Butler searches the web with Gemini and Google Search and answers with its sources.
- **"Read it for me"**: Butler finds the email, reads it and its PDF, picture or text attachments, and tells you the gist, the key points and what you need to do.

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

