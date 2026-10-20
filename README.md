# Butler

A personal companion that lives on your phone and laptop. Phase 1 is the **save library**: share anything from any app, and Butler stores it, titles it, tags it and groups it so you can find it again.

Everything runs on one machine you own: the database, the server, your files, and the website.

## What's here

| Path | What it is |
|---|---|
| `server/` | The Butler server (Deno): device saves, library API, sign-in, files, and serving the website |
| `server/lib/` | Rules (platform, kind, link cleanup), page metadata, the AI organizer, database and auth |
| `db/migrations/` | Postgres schema, applied automatically when the server starts |
| `web/` | The library website: search, browse by collection, platform and tag |
| `android/` | Android app: "Save to Butler" in every app's Share menu, with offline queueing, and Little Butler peeking from the corner |
| `deploy/` | Docker Compose setup for a VPS: Postgres, the server, HTTPS (Caddy), nightly backups |
| `tests/` | Unit tests |
| `desktop/gnome/` | Desktop pet for GNOME: peeks from the screen corner, saves and copies what you're looking at |

Coming next: Analyze and Solve on the desktop pet, and the pet on Android.

## Run it on your VPS

Written for an Oracle Cloud Always Free VM (Ubuntu, ARM or x86); any Linux box with Docker works.

1. **Point a domain at the VM.** Create an `A` record (e.g. `butler.yourdomain.com`) for the VM's public IP.
2. **Open ports 80 and 443.** On Oracle this needs both steps:
   - In the console: your VCN → Security List → add ingress rules for TCP 80 and 443 from `0.0.0.0/0`.
   - On the VM, Oracle's Ubuntu image blocks them in iptables too:
     ```sh
     sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. **Install Docker** and get the code:
   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   git clone https://github.com/Anasabubakar/Butler-2.0.git && cd Butler-2.0/deploy
   ```
4. **Fill in the settings:**
   ```sh
   cp .env.example .env                 # your domain and a database password
   cp butler.env.example butler.env     # tokens, password hash, Anthropic key
   openssl rand -hex 32                 # run twice: one for BUTLER_TOKEN, one for SESSION_SECRET
   docker compose run --rm butler run server/hash-password.ts   # type your website password, paste the result as BUTLER_PASSWORD_HASH
   ```
5. **Start it:**
   ```sh
   docker compose up -d --build
   ```
   Caddy gets an HTTPS certificate on its own. Open `https://butler.yourdomain.com` and sign in with your password.

Update later with `deploy/update.sh`, or set up automatic deploys below.

Quick check from anywhere:

```sh
curl -F device=laptop -F text="https://www.youtube.com/watch?v=dQw4w9WgXcQ" -F note="test" \
  -H "x-butler-token: <BUTLER_TOKEN>" https://butler.yourdomain.com/api/save
```

### Organizing with a local model instead of Claude

Butler can organize saves with a free model running on the VPS itself, through [Ollama](https://ollama.com). Add `COMPOSE_PROFILES=local-ai` to `.env`, then add `BUTLER_AI=local` to `butler.env` and leave out `ANTHROPIC_API_KEY`. Run `docker compose up -d`. The first save downloads the model (`gemma3:4b`, about 3 GB), and it can read images too.

What to expect on a 4-core ARM VM with no GPU: saving is still instant, and organizing happens in the background, one item at a time. Each item takes roughly half a minute, and an image takes longer. Titles and tags are decent, but summaries are plainer than Claude's and the model makes more mistakes. To switch to Claude later, change those two lines back.

### Automatic deploys

Once Butler runs on the VPS, GitHub can update it after every change to `main` that passes CI. It uses its own SSH key, which the server only lets run `deploy/update.sh`, so a leaked key can redeploy Butler but can't open a shell.

1. On your laptop, make the key:
   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/butler_deploy -N "" -C butler-deploy
   ```
2. On the VPS, allow it to run only the update script (paste the contents of `~/.ssh/butler_deploy.pub` in place of `<public key>`):
   ```sh
   echo 'command="/home/ubuntu/Butler-2.0/deploy/update.sh",restrict <public key>' >> ~/.ssh/authorized_keys
   ```
3. On your laptop, give GitHub the key and the server's identity:
   ```sh
   gh secret set DEPLOY_HOST --body ubuntu@145.241.215.176
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/butler_deploy
   ssh-keyscan -t ed25519 145.241.215.176 | gh secret set DEPLOY_KNOWN_HOSTS
   ```
   (Or add the three under the repo's Settings → Secrets and variables → Actions.)
4. Test it: Actions tab → **Deploy** → **Run workflow**.

Until the secrets exist, the Deploy workflow skips itself.

### Where your data lives

- Database: `deploy/data/postgres`
- Saved files: `deploy/data/files`
- Backups: `deploy/backups`, one compressed database dump a day, keeping 14

The backups sit on the same disk as everything else, so they protect against mistakes, not against losing the VM. Oracle can reclaim Always Free VMs that stay idle for a week. Copy `deploy/backups` and `deploy/data/files` somewhere else now and then (for example with `rclone` to Google Drive).

### Connect Google (calendar and email)

Ask Butler can add events to your Google Calendar and send email from your Gmail, after you tap **Send**. Set it up once:

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project, then enable the **Google Calendar API**, **Gmail API**, **People API** and **Google Drive API**.
2. **OAuth consent screen**: External, add your own address as a test user, then press **Publish app** so it's **In production**. Left in Testing, Google signs you out every 7 days. Google will call the app unverified; that's expected for a personal app, and you click past it once.
3. **Credentials → Create credentials → OAuth client ID → Web application**, with the redirect URI `https://butler.yourdomain.com/api/google/callback`.
4. Add the client ID and secret to `butler.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, plus `PUBLIC_URL=https://butler.yourdomain.com`, and run `docker compose up -d`.
5. On the website, press **Connect Google** and allow it.

Without this, calendar requests open a filled-in event for you to save, and email requests ask you to connect first.

### Backups to Google Drive

The server keeps a database dump a day in `deploy/backups`, but that dies with the server. Once Google is connected, Butler also copies the newest dump and every saved file to a **Butler backups** folder in your Drive, every 6 hours, keeping the last 14 dumps. It can only see files it made there (`drive.file`), nothing else in your Drive. Hover the Google button on the website to see the last backup; it shows ⚠ if one failed.

If you connected Google before backups existed, press the Google button to disconnect, then **Connect Google** again so it can ask for Drive.

To restore on a new server: set Butler up as above but start only the database (`docker compose up -d db`). Download the newest `butler-*.sql.gz` from Drive into `deploy/`, run `gunzip -c butler-*.sql.gz | docker compose exec -T db psql -U butler butler`, then `docker compose up -d`. Put the files from Drive's `files` folder back in `deploy/data/files`, turning each `__` in a name back into a `/`.

### Find similar and search by meaning

With `GEMINI_API_KEY` set, every organized item also gets an embedding (numbers that capture what it's about). On the website, the **≈** button on a card shows the items closest to it, and searches add a **Close in meaning** row, so "saving money" finds "budget tips" without the exact words. Items saved before this existed are filled in when the server starts.

## Install the Android app

Every push builds a debug APK. Download `butler-debug-apk` from the latest run on the repo's **Actions** tab, install it, open **Butler**, and enter:

- Save URL: `https://butler.yourdomain.com/api/save`
- Token: your `BUTLER_TOKEN`

So each new build installs over the old app (keeping its settings and switches), give CI one fixed signing key, once, from your laptop:

```sh
sudo apt install openjdk-17-jre-headless   # if keytool is missing
mkdir -p ~/.android
keytool -genkeypair -keystore ~/.android/butler.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Butler"
base64 -w0 ~/.android/butler.keystore | gh secret set ANDROID_DEBUG_KEYSTORE -R Anasabubakar/Butler-2.0
```

Without it, every build has a different key and Android makes you uninstall first. After adding it, uninstall once more and install the next build; from then on updates install over the top.

Then in TikTok, Instagram, YouTube, Chrome or Gallery: **Share → Save to Butler**, add a note if you like, tap **Save**. If you're offline it uploads when you're back.

### Little Butler on your phone

Tap **Start Little Butler** on the setup screen. It asks for two switches, one at a time:

1. **Display over other apps**, so the pet can peek from the corner.
2. **Butler** under **Accessibility**, so it can screenshot and tap for you. It only does that when you press one of its buttons. On Android 13 and newer, an app installed from an APK has this switch greyed out at first: open Butler's **App info**, tap **⋮**, choose **Allow restricted settings**, and try again.

Drag the pet anywhere on the screen; it stays where you drop it, and peeks again if you drop it on the bottom edge. Tap it for **Save this** (a screenshot plus the post's link, using Share → Copy link inside apps), **Copy this**, **Analyze this** and **Solve this**. It also has **Send to laptop** (the page, the selected text, or a screenshot) and, at the top of the menu, an **Ask me anything…** box (tap it to type) plus **Talk to Butler**: type or say what you want, like "remind me at 3 to call Mum" or "send this to my laptop". Talk uses the phone's own speech recognizer. "WhatsApp David I'm running late" or "send this to David on Telegram" opens the app with the message (and the screenshot, if you said "this") ready for you to press Send; Butler looks David up in your phone's contacts, asking for access the first time. Ask it to do something on screen ("search YouTube for jollof rice") and the pet taps, swipes and types for you step by step; tap the pet to stop it. It stops by itself before paying, sending, posting, deleting or typing passwords. Reminders and things your laptop sends arrive as notifications; files land in Downloads/Butler. Screenshots need Android 11 or newer, and Share, Analyze, Solve and Ask Butler need `GEMINI_API_KEY` on the server.

## Develop

```sh
deno test --allow-read --allow-net --allow-env tests/        # unit tests
deno task check                      # type-check the server
deno task start                      # server on :8080 (needs DATABASE_URL and the settings in butler.env.example)
cd web && npm install && npm run dev # website on :5173, calling the server on :8080
cd android && ./gradlew assembleDebug  # needs the Android SDK
```

## Security notes

- Devices prove themselves with `BUTLER_TOKEN`; the website uses your password, stored only as a PBKDF2 hash, and a signed cookie that lasts 30 days. Password guesses are limited to 5 a minute.
- Saved files are only served to a signed-in browser, from paths the server looked up itself.
- Keep `butler.env` and `.env` off GitHub (they're git-ignored). If the token leaks, change it in `butler.env`, run `docker compose up -d`, and update the phone.
- The organizer treats saved content as data, not instructions, because anything you save could contain text written to manipulate an AI.
- Ask Butler never sends an email without your **Send**. The Google refresh token sits in the database on your server; **Disconnect** on the website revokes it.
