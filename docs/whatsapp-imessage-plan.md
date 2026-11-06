# Butler on WhatsApp and iMessage: the plan

Written 2026-11-06. No code yet. Facts checked against current docs (links at the bottom).

## The short answer

- **WhatsApp: yes, it can work**, using Meta's official WhatsApp Cloud API and a new SIM that has never been on WhatsApp. Replies to you are free. But there is one serious catch you need to decide on first (section 1.2): since 15 January 2026 Meta's terms ban "general-purpose AI assistants" from the WhatsApp Business API, and Butler is exactly that.
- **iMessage: not with an email alone.** Apple has no bot API. The only ways are (a) a Mac that stays on, signed in to Messages, running a bridge called BlueBubbles, or (b) paying a company like Sendblue about $100 a month for a line. And the bigger problem: **you use Android and Linux, so you can't send an iMessage to Butler yourself.** Today iMessage support would have zero users (section 2.3).
- **Recommendation:** build WhatsApp first, as a copy of the Telegram bot, owner-only. Park iMessage until either you have a Mac, or Butler becomes something other people use (that's the open-source plan, a separate decision).

---

## 1. WhatsApp

### 1.1 How it works

Butler gets its own WhatsApp number. You chat with that number from your normal WhatsApp. Meta sends each of your messages to Butler's server on the VPS (a "webhook", the same idea as the Telegram bot), and Butler replies through Meta's API.

What you need:

| Thing | Detail |
|---|---|
| A Meta developer account and app | Free. Made at developers.facebook.com, app type "Business". |
| A Meta business portfolio | Free. You can create one as an individual. Full **business verification** (legal documents) is needed only to message lots of people; for one owner you can likely stay unverified, but Meta may still ask for it. |
| A phone number | Must **not** be on any WhatsApp account (personal or Business app) and must be able to get an SMS or call for the code. Easiest: a new SIM (MTN/Airtel/Glo, around N1,000) that you never install WhatsApp on. Once it's on the API, that number **can't** be used in the WhatsApp app. |
| A payment card on the Meta account | Needed before Meta lets you use message templates (see costs). |
| A permanent access token | Made as a "system user" in Business Settings. Goes in `butler.env` on the VPS, like the Telegram token. Never in chat. |
| Webhook | `https://butler.anasmasama.dev/api/whatsapp/webhook`. Meta checks it once with a verify token, then signs every message with your app secret, and Butler rejects anything unsigned. |
| Display name | Meta reviews the name shown on the number ("Butler"). Can take a day or two. |

### 1.2 The catch: Meta's AI chatbot ban (please read)

On 15 January 2026 Meta changed the WhatsApp Business Solution terms. "AI Providers", including makers of "general-purpose artificial intelligence assistants", are "strictly prohibited" from using the WhatsApp Business API when the AI is the **primary** function (not "incidental or ancillary"), and Meta decides that "in its sole discretion". ChatGPT, Copilot and Perplexity all left WhatsApp because of it. TechCrunch named **Poke** as one of the services likely affected, which is a big part of why Poke lives on iMessage and SMS.

What this means for you, honestly:

- **Butler is a general-purpose AI assistant.** On a strict reading, it's the thing the rule bans.
- **The rule is aimed at companies offering AI to the public.** Butler is one person talking to their own tool, a handful of messages a day. Meta is very unlikely to notice or care. But "unlikely" is a guess, not a promise.
- **The worst case** is Meta disabling the app or the number. You'd lose the WhatsApp channel and that SIM's WhatsApp, nothing else. Telegram, the phone app and the laptop keep working. Your personal WhatsApp is not involved, as long as you use a separate number (that's one reason for the new SIM).
- **If Butler later goes public** (other people using it on WhatsApp through your number), that would clearly break the rule. A public, open-source Butler would have to tell each self-hoster to set up their own Meta app, and they'd carry the same risk.

**The unofficial route** (libraries like Baileys that log in as "WhatsApp Web" on a spare number): no Meta business account, no templates, no per-message cost, but it breaks WhatsApp's normal terms, Meta actively bans automated numbers, and it breaks whenever WhatsApp changes. I don't recommend it for anything you rely on.

My view: go official, keep it to your own number only, and accept a small risk on a throwaway SIM. If you're not comfortable with that, say so and we stop at Telegram.

### 1.3 What it costs

Since July 2025 Meta charges **per message**, not per conversation.

- **Free:** every normal reply (text, picture, voice note) Butler sends within **24 hours** of your last message to it. This is the "customer service window". Utility templates sent inside that window are free too.
- **Paid:** anything Butler sends **after 24 hours of silence from you** must be a pre-approved **template** (a fixed message with blanks, approved by Meta). Reminders and the morning brief fall here if you haven't messaged Butler for a day. Utility templates are a small per-message fee on Meta's rate card (Nigeria has its own row; I couldn't load the exact figure, so check it in WhatsApp Manager before turning templates on). Marketing templates are always paid and we won't use them.
- **Practical effect:** if you message Butler most days, almost everything is free. When the window is closed, Butler can send the reminder to Telegram and the phone app instead, and only use a paid template for things you mark urgent.

### 1.4 What to reuse from the Telegram bot

The Telegram bot (`server/lib/bot.ts`, `server/lib/telegram.ts`, `docs/telegram.md`) already does the hard parts: it talks to Ask Butler through one `Butler` interface, saves links and files, handles voice notes and pictures, asks "Yes/No" before sending emails, and gets reminders and notes as a device called "Telegram". It answers only its owner, who pairs once through a 10-minute link from the website.

WhatsApp will be built the same way:

- `server/lib/whatsapp.ts`: the Meta API client (send text, send buttons, download media, check the signature).
- The chat logic moves out of `bot.ts` into a shared core that both Telegram and WhatsApp use, so each new chat app only needs a thin adapter. (iMessage would plug into the same core later.)
- A device called "WhatsApp" that gets Butler's notes and reminders, with `alerts off` to mute it, like Telegram.
- Website: an Integrations card "WhatsApp", with a Connect button.
- Differences from Telegram: WhatsApp has at most 3 reply buttons (or a list), no inline search, no Mini App, and the 24-hour rule above.

### 1.5 Security: only you

- **Allowlist of your own number(s) only.** Pairing: the website shows a one-time code (10 minutes); you send `connect 123456` from your WhatsApp; Butler stores that WhatsApp id as the owner. Or set `WHATSAPP_OWNERS=234...` in `butler.env`. Anyone else gets silence, and their messages aren't stored.
- Every webhook call must carry Meta's signature (`X-Hub-Signature-256`, made with the app secret). Anything else is rejected.
- Laptop commands keep needing your secret word, and Butler can't delete your message on WhatsApp like it does on Telegram, so the word stays in that chat. Safer: no laptop control from WhatsApp in the first version.
- Login codes and reset links (the `forget` notes) are **not** sent to WhatsApp at all, since Butler can't delete them afterwards.
- The token and app secret live only in `butler.env` on the VPS, put there from a file on your laptop, never pasted in chat.

### 1.6 First slice (small, testable in one sitting)

1. Webhook with signature check, owner pairing, strangers ignored.
2. You send text, Butler answers through Ask Butler (same memory, same voice). Links you send get saved.
3. Integrations card with Connect and a status line.
4. Tests against a fake Meta server, like the Telegram tests.

Then, one at a time: voice notes and pictures; Yes/No buttons for emails; reminders and the brief inside the 24-hour window; one approved utility template ("Butler reminder: {{1}}") for when the window is closed.

---

## 2. iMessage

### 2.1 Why an email isn't enough

iMessage only runs on Apple devices. There is no official way for a server to send or receive iMessages for a person. An Apple ID email lets a **Mac, iPhone or iPad** sign in to iMessage; it does nothing by itself. So every real option needs Apple hardware somewhere, yours or someone else's.

### 2.2 The options

| Option | How | Cost | Risk |
|---|---|---|---|
| **A. Your own Mac + BlueBubbles** | A Mac signed in to a Butler Apple ID (an email you make for it), Messages open, BlueBubbles server running. It gives a REST API and webhooks, so it plugs into the VPS like Telegram. | A used Mac mini (any Mac on macOS Sierra or newer works; Catalina/Big Sur recommended), plus electricity. Mac must stay awake and online. | Apple may block the Apple ID if it looks like spam; low for one person. If the Mac sleeps or NEPA takes light, Butler goes quiet on iMessage. |
| **B. macOS in a virtual machine on Linux** | Docker-OSX with spoofed Apple hardware details. | Free | Breaks Apple's licence, fiddly, often breaks. Can't run on the ARM VPS. Not recommended. |
| **C. Paid iMessage API** | Sendblue, Linq (what Poke uses), Blooio and others run the Macs for you and give you a number. | Sendblue about **$100/month** per line (has a free sandbox). Linq about $250/month plus about $1,500 setup. Blooio about $289/month. | Costs more per year than the whole VPS project. Mostly US numbers. |
| **D. Apple Messages for Business** | Apple's official business chat. | Free from Apple, plus a provider | Needs a registered brand, an Apple-approved provider, Apple's review, and **live human agents during business hours**. Not possible for a personal assistant. |

### 2.3 The real question: who would use it?

- **You can't.** iMessage needs an iPhone, iPad or Mac on your side too. You have an Android phone and Linux laptop, so you'd message Butler's iMessage address from... nothing.
- **"People outside Nigeria use iMessage more"** is true, but today Butler has exactly one user, you. It answers only its owner, there's one login, and no table has a user id. Making Butler serve other people is the open-source / hosted decision from October (you chose **self-host first**: each person runs their own Butler).
- So iMessage only becomes useful when there's someone with an iPhone on the other end. In the self-host world, that's a self-hoster who **also owns a Mac**, and option A is the fit: they run BlueBubbles, paste its address and password into their Butler, done. Nobody pays a monthly fee.
- Poke can pay for Linq because it's a funded company with many users. Copying Poke's channel without Poke's users means paying $100 to $250 a month for nobody.

### 2.4 Recommendation for iMessage

Don't build it now. Once WhatsApp is done, the shared chat core makes an iMessage adapter (BlueBubbles) a small job. Build it when one of these is true:

1. You get a Mac (and an iPhone-using tester), or
2. Butler goes public and a self-hoster with a Mac asks for it.

Never pay for a hosted iMessage line for one user.

---

## 3. Order

1. **WhatsApp first slice** (section 1.6), after you decide on the AI-terms risk.
2. Real-phone test: text, a link, a 2-minute reminder inside the window.
3. Rest of WhatsApp (media, buttons, template).
4. iMessage via BlueBubbles, only when section 2.4 is true.

Meanwhile, Telegram is already live and does everything above for free with no rules about AI. It still hasn't been tested on real Telegram. Testing that first would tell us how much of the shared core actually works before we copy it.

## 4. What only you can do

**Decide:**
1. Are you OK with the Meta AI-terms risk on a separate SIM (section 1.2)? Yes or no.
2. iMessage: do you have, or plan to get, a Mac? If not, iMessage waits.

**If yes to WhatsApp, by hand (I can't do these):**
1. Buy a new SIM. Don't install WhatsApp on it. Keep it in a phone that can receive the SMS code.
2. At developers.facebook.com, log in with Facebook, create an app, type **Business**, and add the **WhatsApp** product. Create or pick a business portfolio when asked.
3. In WhatsApp Manager, **Add phone number**: enter the new SIM's number, display name "Butler", verify with the SMS code.
4. Add a **payment card** (Business Settings → WhatsApp accounts → Payment settings).
5. In Business Settings → **System users**, create an admin system user, give it the WhatsApp app, and generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
6. Put these in a file on your laptop (never in chat), and I'll move them into `butler.env` on the VPS: the token, the **app secret** (App settings → Basic), the **phone number ID** and **WhatsApp Business Account ID** (WhatsApp → API Setup).
7. After I deploy, paste the webhook address and verify token into WhatsApp → Configuration, and subscribe to **messages**.
8. On the Butler website, Integrations → WhatsApp → Connect, and send the code from your own WhatsApp.

## Sources

- Meta, Pricing on the WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp/pricing
- TechCrunch, WhatsApp changes its terms to bar general-purpose chatbots (2025-10-18, updated 2026-01-15): https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/
- Dataslayer, Meta bans general-purpose AI chatbots on WhatsApp Business: https://www.dataslayer.ai/blog/meta-bans-general-purpose-ai-chatbots-on-whatsapp-business
- bitbybit, WhatsApp Cloud API setup (number rules, payment method): https://knowledge.bitbybit.studio/integrations/whatsapp-cloud-api
- BlueBubbles server docs (macOS only, REST API, webhooks): https://docs.bluebubbles.app/server
- Sendblue, iMessage API pricing comparison (vendor page, 2026-03-29): https://www.sendblue.com/blog/imessage-api-pricing-comparison and https://www.sendblue.com/compare/sendblue-vs-linq
- Kanal, Apple Messages for Business in 2026: https://getkanal.com/blog/apple-messages-for-business
