// Public links for single notes: a page anyone with the link can open, showing that one
// note and nothing else from your library. Link previews (WhatsApp, X) get its title and picture.
import { encodeBase64Url } from "jsr:@std/encoding@1.0.10/base64url";
import type { Item } from "./db.ts";

/** A long random token, so links can't be guessed. */
export const newToken = () => encodeBase64Url(crypto.getRandomValues(new Uint8Array(18)));

export const TOKEN_RE = /^[\w-]{24}$/;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Only http(s) links are shown as links; anything else could run script. */
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

/** The shared note as a whole HTML page. `base` is where this page lives, like https://x/s/TOKEN. */
export function page(item: Item, base: string): string {
  const title = item.title ?? item.body?.slice(0, 80) ?? "A note";
  const about = item.summary ?? item.body?.slice(0, 300) ?? "";
  const link = safeUrl(item.url);
  const file = item.file_path ? `${base}/file` : null;
  const picture = item.kind === "image" && file ? file : safeUrl(item.thumbnail);
  const media = item.kind === "video" && file
    ? `<video src="${escape(file)}#t=0.1" controls playsinline preload="metadata"></video>`
    : picture
    ? `<img src="${escape(picture)}" alt="" referrerpolicy="no-referrer">`
    : "";
  const body = item.body && item.body !== about ? `<p class="body">${escape(item.body.slice(0, 4000))}</p>` : "";
  const tags = item.tags.length ? `<p class="tags">${item.tags.map((t) => `#${escape(t)}`).join(" ")}</p>` : "";
  const open = link
    ? `<a class="open" href="${escape(link)}" rel="noopener noreferrer">Open the original ↗</a>`
    : file && item.kind === "file"
    ? `<a class="open" href="${escape(file)}" download>Download the file ↓</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(about.slice(0, 200))}">
${picture ? `<meta property="og:image" content="${escape(picture)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px 16px; box-sizing: border-box;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #2b2620;
    background: radial-gradient(circle at 20% 30%, #d9b98c 0 1px, transparent 2px) 0 0 / 23px 19px, #c49a6c;
  }
  .note {
    position: relative; width: min(440px, 100%); padding: 30px 22px 20px; background: #fff3a8;
    box-shadow: 0 2px 2px rgb(0 0 0 / 15%), 0 18px 30px -12px rgb(0 0 0 / 45%); transform: rotate(-1.2deg);
    border-radius: 2px 2px 3px 22px / 2px 2px 3px 6px; animation: land .5s cubic-bezier(.2, .9, .3, 1.3);
  }
  .note::before {
    content: ""; position: absolute; top: -12px; left: calc(50% - 50px); width: 100px; height: 26px;
    background: rgb(255 255 255 / 55%); transform: rotate(-3deg); box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  }
  @keyframes land { from { opacity: 0; transform: translateY(-30px) rotate(4deg) scale(1.05); } }
  h1 { margin: 0 0 8px; font: 700 32px/1.05 Caveat, cursive; overflow-wrap: anywhere; }
  img, video { display: block; width: 100%; max-height: 60vh; object-fit: contain; margin: 0 0 12px; background: rgb(0 0 0 / 6%); }
  p { margin: 0 0 10px; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  .tags { color: rgb(43 38 32 / 65%); font-size: 13px; }
  .open { display: inline-block; margin-top: 6px; font-weight: 600; color: #6b2f00; }
  footer { margin-top: 18px; font-size: 12px; color: rgb(43 38 32 / 55%); }
  @media (prefers-reduced-motion: reduce) { .note { animation: none; } }
</style>
</head>
<body>
<main class="note">
${media}
<h1>${escape(title)}</h1>
${about ? `<p>${escape(about)}</p>` : ""}
${body}
${tags}
${open}
<footer>Shared from a Butler library</footer>
</main>
</body>
</html>`;
}
