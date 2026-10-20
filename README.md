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
| `android/` | Android app: "Save to Butler" in every app's Share menu, with offline queueing |
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

## Install the Android app

Every push builds a debug APK. Download `butler-debug-apk` from the latest run on the repo's **Actions** tab, install it, open **Butler**, and enter:

- Save URL: `https://butler.yourdomain.com/api/save`
- Token: your `BUTLER_TOKEN`

Then in TikTok, Instagram, YouTube, Chrome or Gallery: **Share → Save to Butler**, add a note if you like, tap **Save**. If you're offline it uploads when you're back.

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
