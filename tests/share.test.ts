import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "../server/lib/db.ts";
import { newToken, page, TOKEN_RE } from "../server/lib/share.ts";

const item = (over: Partial<Item>): Item => ({
  id: "11111111-1111-1111-1111-111111111111", created_at: "2026-10-01T09:00:00Z", device: "phone", kind: "link",
  url: null, body: null, note: null, file_path: null, mime: null, thumbnail: null, platform: null,
  title: null, summary: null, tags: [], category: null, status: "organized", error: null,
  board_x: null, board_y: null, board_tilt: null, ...over,
});

test("tokens are long, random and URL-safe", () => {
  const a = newToken(), b = newToken();
  assert.match(a, TOKEN_RE);
  assert.notEqual(a, b);
});

test("the page shows the note, escaped, with a preview for link apps", () => {
  const html = page(item({
    title: "Jollof <script>alert(1)</script>", summary: "Smoky & good", url: "https://www.tiktok.com/@chef/video/1",
    thumbnail: "https://cdn.example/t.jpg", tags: ["food"],
  }), "https://butler.example/s/TOKEN");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<h1>Jollof &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.match(html, /<meta property="og:description" content="Smoky &amp; good">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn.example\/t.jpg">/);
  assert.match(html, /href="https:\/\/www.tiktok.com\/@chef\/video\/1"/);
});

test("only web links become links, and saved pictures come from the shared link", () => {
  const html = page(item({ kind: "image", url: "javascript:alert(1)", file_path: "a/b.png", title: "Receipt" }),
    "https://butler.example/s/TOKEN");
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<img src="https:\/\/butler.example\/s\/TOKEN\/file"/);
  assert.doesNotMatch(html, /\/files\//); // never the private file address
});
