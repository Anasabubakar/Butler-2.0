# Self-hosting Butler

Butler runs on one machine you own: the database, the server, your files and the website. This guide sets it up on a small Linux server with Docker.

## Run it on your server

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
   cp butler.env.example butler.env     # tokens, password hash, AI keys
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

## Organizing with a local model instead of Claude

Butler can organize saves with a free model running on the VPS itself, through [Ollama](https://ollama.com). Add `COMPOSE_PROFILES=local-ai` to `.env`, then add `BUTLER_AI=local` to `butler.env` and leave out `ANTHROPIC_API_KEY`. Run `docker compose up -d`. The first save downloads the model (`gemma3:4b`, about 3 GB), and it can read images too.

What to expect on a 4-core ARM VM with no GPU: saving is still instant, and organizing happens in the background, one item at a time. Each item takes roughly half a minute, and an image takes longer. Titles and tags are decent, but summaries are plainer than Claude's and the model makes more mistakes. To switch to Claude later, change those two lines back.

## Automatic deploys

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
   gh secret set DEPLOY_HOST --body ubuntu@<your-server-ip>
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/butler_deploy
   ssh-keyscan -t ed25519 <your-server-ip> | gh secret set DEPLOY_KNOWN_HOSTS
   ```
   (Or add the three under the repo's Settings → Secrets and variables → Actions.)
4. Test it: Actions tab → **Deploy** → **Run workflow**.

Until the secrets exist, the Deploy workflow skips itself.

## Where your data lives

- Database: `deploy/data/postgres`
- Saved files: `deploy/data/files`
- Backups: `deploy/backups`, one compressed database dump a day, keeping 14

The backups sit on the same disk as everything else, so they protect against mistakes, not against losing the VM. Oracle can reclaim Always Free VMs that stay idle for a week. Copy `deploy/backups` and `deploy/data/files` somewhere else now and then (for example with `rclone` to Google Drive).

## Connect Google (calendar and email)

Ask Butler can add events to your Google Calendar and send email from your Gmail, after you tap **Send**. Set it up once:

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project, then enable the **Google Calendar API**, **Gmail API**, **People API** and **Google Drive API**.
2. **OAuth consent screen**: External, add your own address as a test user, then press **Publish app** so it's **In production**. Left in Testing, Google signs you out every 7 days. Google will call the app unverified; that's expected for a personal app, and you click past it once.
3. **Credentials → Create credentials → OAuth client ID → Web application**, with the redirect URI `https://butler.yourdomain.com/api/google/callback`.
4. Add the client ID and secret to `butler.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, plus `PUBLIC_URL=https://butler.yourdomain.com`, and run `docker compose up -d`.
5. On the website, press **Connect Google** and allow it.

Without this, calendar requests open a filled-in event for you to save, and email requests ask you to connect first.


## Backups to Google Drive

The server keeps a database dump a day in `deploy/backups`, but that dies with the server. Once Google is connected, Butler also copies the newest dump and every saved file to a **Butler backups** folder in your Drive, every 6 hours, keeping the last 14 dumps. It can only see files it made there (`drive.file`), nothing else in your Drive. Hover the Google button on the website to see the last backup; it shows ⚠ if one failed.

If you connected Google before backups existed, press the Google button to disconnect, then **Connect Google** again so it can ask for Drive.

To restore on a new server: set Butler up as above but start only the database (`docker compose up -d db`). Download the newest `butler-*.sql.gz` from Drive into `deploy/`, run `gunzip -c butler-*.sql.gz | docker compose exec -T db psql -U butler butler`, then `docker compose up -d`. Put the files from Drive's `files` folder back in `deploy/data/files`, turning each `__` in a name back into a `/`.

