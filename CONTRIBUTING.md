# Contributing to Butler

Thanks for helping. Butler is a small project, so the rules are short.

## Ways to help

- **Try it and report what breaks.** Most features have only been tested on one Android phone and one GNOME laptop. An issue that says "on my Pixel 7 with Android 15, X happened" is gold.
- **Pick an issue** labelled `good first issue` or `help wanted`, and say you're on it so nobody doubles up.
- **Bring Butler to a new device.** iPhone, macOS and Windows are on the [roadmap](README.md#-roadmap). Open an issue first so we can agree on the approach.

## Set up

You need [Deno](https://deno.com) 2.5+, Node.js 22, Docker (for Postgres), and the Android SDK if you touch the app.

```sh
git clone https://github.com/Anasabubakar/Butler-2.0.git && cd Butler-2.0
docker run -d --name butler-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
cp deploy/butler.env.example butler.local.env   # fill in BUTLER_TOKEN, SESSION_SECRET and BUTLER_PASSWORD_HASH
deno task hash-password                          # prints the hash for BUTLER_PASSWORD_HASH
echo DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres >> butler.local.env
set -a && . ./butler.local.env && set +a         # load the settings into this shell
```

| What | Command |
|---|---|
| Unit tests | `deno test --allow-read --allow-write --allow-net --allow-env tests/` |
| Type-check the server | `deno task check` |
| Server on :8080 | `deno task start` |
| Website on :5173 | `cd web && npm install && npm run dev` (calls the server on :8080) |
| Android debug APK | `cd android && ./gradlew assembleDebug` |
| GNOME pet | see [`desktop/gnome/README.md`](desktop/gnome/README.md) |

Database migrations in `db/migrations/` run on their own when the server starts. Add a new numbered file; never edit one that has shipped.

## Pull requests

- Keep each commit small and about one thing, with a message that says what changed in plain words ("Show the price drop on the card", not "fix stuff").
- CI must pass: server tests and type-check, the Docker build, the website build and the Android build.
- If you change what a user sees, add a screenshot to the PR.
- Never commit secrets: `deploy/.env`, `deploy/butler.env`, keystores and API keys stay out of git.

## Design and voice

Read [`AGENTS.md`](AGENTS.md) before touching anything visual. In short: logos come from [`design/brand/logo/`](design/brand/logo/) only, website colours come from [`web/src/theme.css`](web/src/theme.css), and Butler's voice is set by [`server/persona.md`](server/persona.md), whose first part must not be edited.

## Releases

Releases are cut from `main` by the **Release** workflow (Actions → Release → Run workflow, with a version like `v0.3.0`). It builds the Android APK and the GNOME extension, tags the commit, and publishes the notes for that version from [`CHANGELOG.md`](CHANGELOG.md). Add your change under **Unreleased** there.

## License

By sending a pull request, you agree that your contribution is licensed under the [AGPL-3.0](LICENSE), like the rest of Butler.
