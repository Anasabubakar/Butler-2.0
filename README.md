# Butler

A personal companion that lives on your phone and laptop. Phase 1 is the **save library**: share anything from any app, and Butler stores it, titles it, tags it and groups it so you can find it again.

The full plan, including what is out of scope and why, lives in the project's `plan/pet-plan.md`.

## What's here

| Path | What it is |
|---|---|
| `supabase/migrations/` | The `items` table (with full-text search) and the private `items` storage bucket |
| `supabase/functions/save/` | `POST` endpoint every device saves through |
| `supabase/functions/_shared/` | Rules (platform, kind, link cleanup), page metadata, and the AI organizer |
| `android/` | Android app: "Save to Butler" in every app's Share menu, with offline queueing |
| `tests/` | Unit tests for the rules and metadata parsing |

Coming next: the library website, then the Linux/Windows desktop pet (Tauri).

## Set up the server (once)

1. Create a free project at [supabase.com](https://supabase.com) and install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
2. Link and push the database:
   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Set the secrets. `BUTLER_TOKEN` is a long random string that every device sends to prove it's you:
   ```sh
   supabase secrets set BUTLER_TOKEN="$(openssl rand -hex 32)" ANTHROPIC_API_KEY=sk-ant-...
   ```
   Optional: `BUTLER_MODEL` picks the Claude model that organizes items (default `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper).
4. Deploy the function:
   ```sh
   supabase functions deploy save
   ```
   Your save URL is `https://<your-project-ref>.supabase.co/functions/v1/save`.

Quick check from the laptop:

```sh
curl -F device=laptop -F text="https://www.youtube.com/watch?v=dQw4w9WgXcQ" -F note="test" \
  -H "x-butler-token: $BUTLER_TOKEN" https://<your-project-ref>.supabase.co/functions/v1/save
```

## Install the Android app

Every push builds a debug APK. Download `butler-debug-apk` from the latest run on the repo's **Actions** tab, install it, open **Butler**, and paste the save URL and token.

Then in TikTok, Instagram, YouTube, Chrome or Gallery: **Share → Save to Butler**, add a note if you like, tap **Save**. If you're offline it uploads when you're back.

## Develop

```sh
node --experimental-strip-types --test tests/*.test.ts   # rules tests
deno check supabase/functions/save/index.ts               # type-check the function
cd android && ./gradlew assembleDebug                      # needs the Android SDK
```

## Security notes

- The token is the only thing protecting the save endpoint. Keep it out of screenshots and git, and rotate it with `supabase secrets set` if it leaks.
- The database has row-level security on with no public policies, so only the server functions can read or write items.
- The organizer treats saved content as data, not instructions, because anything you save could contain text written to manipulate an AI.
