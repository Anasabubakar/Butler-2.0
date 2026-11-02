# Butler in Telegram

Butler has a Telegram bot. It's the same Butler as the pet and the website: same memory, same voice, same library. It answers **only you**. Anyone else who finds it gets silence.

## What it does

- **Talk to it** like Ask Butler: "remind me to call Mum at 6", "what's my day?", "email Ada that I'm running late". Emails and anything that changes something in a connected app wait for you to tap **Send** or **Yes**.
- **Voice notes**: it hears what you said and does it.
- **Save** by sending a link, photo, file or a forwarded message. It replies "Saved", then shows the title and collection once it's sorted, with **Open**, **To laptop**, **To phone** and **Delete** buttons. Telegram lets bots download files up to 20 MB.
- **Ask about a photo** by adding a question as its caption.
- **Search**: `/find jollof`, or type `@YourBot jollof` in any chat to share a save there.
- **Your laptop**: `/laptop mango open YouTube` (with your own secret word). The bot deletes your message straight away so the word doesn't stay in the chat, and the laptop reports back here. `/stop` stops it; the button under each job can switch remote control off.
- **Butler comes to you**: reminders (with Snooze and Done), the morning brief, Butler's notes, price drops and things sent from your other devices arrive in the chat. `/alerts off` stops that (your phone and laptop still get them).
- **Library button**: the **Butler Library** button next to the message box opens your library inside Telegram, signed in.
- Commands: `/brief`, `/tasks`, `/inbox`, `/recap`, `/spent`, `/remind`, `/ring`, `/devices`, `/library`, `/new`, `/alerts`, `/help`.

## Set it up

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps (or use the bot you already made).
2. Get its token with `/mybots` → your bot → **API Token**. **Never paste the token in a chat, an issue or a screenshot.** If it ever shows anywhere, press **Revoke** there and use the new one.
3. Put it in `deploy/butler.env` on your server, next to the other secrets:

   ```sh
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ```

   `PUBLIC_URL` must be your https address (for example `https://butler.example.com`): the bot gets messages through a webhook there. Without it the bot asks Telegram for messages instead (fine for trying it at home).
4. Restart Butler (`docker compose up -d` in `deploy/`). The log says `telegram: @YourBot is running (webhook)`.
5. On the Butler website go to **Integrations → Telegram → Connect Telegram**, then **Open @YourBot and tap Start**. That link works once, for 10 minutes, and makes you the bot's only user. (Or set `TELEGRAM_OWNER_ID` to your numeric Telegram user id to lock it from the server.)

### BotFather settings

The bot only needs plain private chats. Everything else is extra ways in, so switch it off in `/mybots` → your bot → **Bot Settings**:

| Setting | Set it to | Why |
|---|---|---|
| Restrict bot usage | **On**, with only you | Telegram itself stops strangers reaching it, on top of Butler ignoring them. |
| Secretary mode | **Off** | It would let the bot read and send messages in your other chats. Butler doesn't use it. |
| Bot Management mode | **Off** | Lets the bot create and manage other bots. Not needed. |
| Guest chat mode | **Off** | Lets people summon the bot in chats it isn't in. Not needed. |
| Guard mode | **Off** | For gating group joins. Not needed. |
| Bot to bot communication | **Off** | Butler ignores other bots anyway. |
| Allow groups | **Off** | Butler is private; it leaves any group it's added to. |
| Inline mode | **On** | For `@YourBot jollof` sharing (only you get results). Placeholder: `Search your library…` |
| Inline location data | **Off** | Not used. |
| Threaded mode | Your choice | Works either way: replies stay in the topic you asked in. |
| Privacy policy | `https://<your Butler address>/privacy-policy` | Butler serves this page. |

## Settings

| Setting | What it does |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The bot's token. Without it there's no bot. |
| `TELEGRAM_OWNER_ID` | Optional: lock the bot to this Telegram user id instead of connecting from the website. |
| `TELEGRAM_WEBHOOK_SECRET` | Optional: your own webhook secret (16+ letters, numbers, `_` or `-`). By default one is made from the token. |
| `BUTLER_TELEGRAM=off` | Switch the bot off without removing the token. |
| `BUTLER_TELEGRAM_MODE=polling` | Ask Telegram for messages instead of using the webhook. |
| `BUTLER_CONTACT` | Optional contact (email or text) shown on the privacy policy page. |

## How it stays private

- The bot answers one Telegram user id. Everyone else, other bots, groups and channels get no reply at all, and inline searches from anyone else come back empty.
- Telegram signs every update with a secret only it and your server know (the `X-Telegram-Bot-Api-Secret-Token` header), so nobody can post fake messages to the webhook.
- The library Mini App signs you in only when Telegram's signed data says it's you (checked with the bot token, and no more than a day old).
- The bot never asks Telegram for business-account (Secretary) updates.
- Laptop commands go through the same secret word and kill switch as the phone. The bot never runs anything itself.
- Bot chats aren't end-to-end encrypted: Telegram can read them. Don't send passwords to any bot.
