// The privacy policy page (/privacy-policy), linked from the Telegram bot's profile and
// BotFather. Plain words about what this Butler server keeps and who it shares it with.
import { escape } from "./telegram.ts";

export function page(opts: { site: string; contact: string | null; updated: string }): string {
  const contact = opts.contact
    ? /^[^@\s]+@[^@\s]+$/.test(opts.contact)
      ? `<a href="mailto:${escape(opts.contact)}">${escape(opts.contact)}</a>`
      : escape(opts.contact)
    : "the person who runs this Butler server";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Butler privacy policy</title>
<meta name="description" content="What Butler keeps, who sees it, and how to delete it.">
<style>
  :root { color-scheme: light dark; --bg: #f7f7f8; --fg: #1d1d22; --muted: #5d5d68; --card: #fff; --line: #e4e4ea; --accent: #6d4aff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121216; --fg: #ececf1; --muted: #a3a3b0; --card: #1b1b21; --line: #2c2c35; --accent: #a993ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 32px 0 8px; }
  p, li { color: var(--fg); }
  .muted { color: var(--muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px 20px; margin-top: 20px; }
  a { color: var(--accent); }
  ul { padding-left: 1.2em; }
</style>
</head>
<body>
<main>
<h1>Butler privacy policy</h1>
<p class="muted">For ${escape(opts.site)} and its Telegram bot. Last updated ${escape(opts.updated)}.</p>

<div class="card">
<p><strong>In short:</strong> Butler is a personal assistant that one person runs for themselves. Its Telegram bot only answers that person and ignores everyone else. Nothing is sold, shared for advertising, or used to train anyone's AI by Butler.</p>
</div>

<h2>Who this is for</h2>
<p>This Butler server and its bot belong to one owner. If you aren't the owner, the bot doesn't answer you and keeps nothing you send it beyond what Telegram itself delivers to the server for a moment, which is thrown away.</p>

<h2>What Butler keeps</h2>
<ul>
<li>What the owner saves: links, notes, photos, files and voice notes sent to the library, plus the titles, summaries and tags Butler writes for them.</li>
<li>The conversation with Butler (kept up to a year) and short facts the owner told it to remember. The owner can see and delete these on the website.</li>
<li>Reminders, notes and messages between the owner's own devices, until they're delivered (copied text and laptop commands are deleted once delivered).</li>
<li>For Telegram: the owner's numeric Telegram user ID, so the bot knows who to answer. Not their phone number or contacts.</li>
<li>Small settings, like the owner's time zone.</li>
</ul>

<h2>Who else sees it</h2>
<ul>
<li><strong>Telegram</strong> carries messages between the owner and the bot. Bot chats aren't end-to-end encrypted, so Telegram can see them. See <a href="https://telegram.org/privacy">Telegram's privacy policy</a>.</li>
<li><strong>AI providers</strong> read what's needed to answer or sort a request: Google Gemini first, and if it fails, any backups the owner set up (OpenRouter, Groq or OpenAI), or a model on the server itself.</li>
<li><strong>Google</strong>, only if the owner connects their Google account: Butler reads their calendar, tasks, contacts and email to answer them, sends only the emails they confirm, and backs the library up to their Google Drive.</li>
<li><strong>Services the owner connects</strong> (MCP connections) get only what a request sends them, and anything that changes something asks the owner first.</li>
<li><strong>The Internet Archive</strong> gets a copy of public links the owner saves, so dead links can be rescued.</li>
</ul>

<h2>Where it's kept</h2>
<p>On the owner's own server, with daily backups on that server and, if connected, in the owner's Google Drive.</p>

<h2>Deleting it</h2>
<p>The owner can delete any save, the conversation and anything Butler remembers from the website, and can disconnect Telegram or Google at any time. Disconnecting Telegram forgets the Telegram user ID. Deleting the chat in Telegram removes it from Telegram but not from Butler's library.</p>

<h2>Questions</h2>
<p>Contact ${contact}.</p>
</main>
</body>
</html>`;
}
