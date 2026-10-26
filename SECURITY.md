# Security

Butler holds your saves, your Google sign-in and, if you turn it on, a way to run commands on your laptop. Please report anything that could expose those.

## Reporting a vulnerability

Don't open a public issue. Use **[Report a vulnerability](https://github.com/Anasabubakar/Butler-2.0/security/advisories/new)** on GitHub, which reaches the maintainer privately. Say what you found, how to reproduce it, and what an attacker could do with it. You'll get an answer within a week.

## Supported versions

Only the latest release and `main` get fixes.

## How Butler protects your data

- Devices prove themselves with `BUTLER_TOKEN`; the website uses your password, stored only as a PBKDF2 hash, and a signed cookie that lasts 30 days. Password guesses are limited to 5 a minute.
- Saved files are only served to a signed-in browser, from paths the server looked up itself.
- Keep `butler.env` and `.env` off GitHub (they're git-ignored). If the token leaks, change it in `butler.env`, run `docker compose up -d`, and update the phone.
- The organizer treats saved content as data, not instructions, because anything you save could contain text written to manipulate an AI.
- Remote control is off until you turn it on at the laptop. Commands need your secret word (stored only as a salted hash on the laptop), three misses switch it off, **Switch off** on the phone can only be undone at the laptop, and the laptop logs every command. The word travels with the token, so if the token leaks, change the word as well.
- Ask Butler never sends an email without your **Send**. The Google refresh token sits in the database on your server; **Disconnect** on the website revokes it.
- Connection (MCP) links and keys are encrypted in the database, only public `https://` addresses are allowed, and anything that sends, changes or deletes waits for your yes.
