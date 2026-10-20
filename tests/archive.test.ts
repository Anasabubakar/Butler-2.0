import { test } from "node:test";
import assert from "node:assert/strict";
import { archive, check, worthArchiving } from "../server/lib/archive.ts";

/** A pretend website: each path answers with its status, and HEAD can be refused. */
function site(statuses: Record<string, number>, headStatus?: number) {
  const seen: string[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    const path = new URL(req.url).pathname;
    seen.push(`${req.method} ${path}`);
    if (req.method === "HEAD" && headStatus) return new Response(null, { status: headStatus });
    return new Response("page", { status: statuses[path] ?? 200 });
  });
  return { url: `http://localhost:${server.addr.port}`, seen, close: () => server.shutdown() };
}

test("social posts and non-web links aren't archived", () => {
  assert.equal(worthArchiving("https://www.nytimes.com/2026/10/01/story.html"), true);
  assert.equal(worthArchiving("https://www.tiktok.com/@a/video/1"), false);
  assert.equal(worthArchiving("https://x.com/a/status/1"), false);
  assert.equal(worthArchiving("ftp://files.example/a"), false);
});

test("private links and links with secrets in them stay off the public archive", () => {
  assert.equal(worthArchiving("https://docs.google.com/document/d/abc/edit"), false);
  assert.equal(worthArchiving("https://www.dropbox.com/s/abc/file.pdf"), false);
  assert.equal(worthArchiving("https://shop.example/reset?token=abc123"), false);
  assert.equal(worthArchiving("http://192.168.1.4/router"), false);
  assert.equal(worthArchiving("https://blog.example/post?ref=home"), true);
});

test("a page is dead only when the site says it's gone", async () => {
  const s = site({ "/gone": 410, "/missing": 404, "/broken": 500 });
  try {
    assert.equal(await check(`${s.url}/fine`), "alive");
    assert.equal(await check(`${s.url}/gone`), "dead");
    assert.equal(await check(`${s.url}/missing`), "dead");
    assert.equal(await check(`${s.url}/broken`), "unknown");
    assert.equal(await check("http://localhost:1/nothing-listens-here"), "unknown");
  } finally {
    await s.close();
  }
});

test("a site that fumbles HEAD gets a GET before being called dead", async () => {
  const s = site({}, 404);
  try {
    assert.equal(await check(`${s.url}/page`), "alive");
    assert.deepEqual(s.seen, ["HEAD /page", "GET /page"]);
  } finally {
    await s.close();
  }
});

test("archiving asks the Archive to save the page and links to the newest copy", async () => {
  const s = site({ "/save/https://blog.example/post": 200 });
  Deno.env.set("WAYBACK_URL", s.url);
  try {
    assert.equal(await archive("https://blog.example/post"), `${s.url}/web/2/https://blog.example/post`);
    assert.deepEqual(s.seen, ["GET /save/https://blog.example/post"]);
  } finally {
    Deno.env.delete("WAYBACK_URL");
    await s.close();
  }
});

test("a page the Archive can't copy isn't tried again", async () => {
  const s = site({ "/save/https://blog.example/post": 520 });
  Deno.env.set("WAYBACK_URL", s.url);
  try {
    assert.equal(await archive("https://blog.example/post"), "failed");
  } finally {
    Deno.env.delete("WAYBACK_URL");
    await s.close();
  }
});

test("a busy Archive means try again later", async () => {
  const s = site({ "/save/https://blog.example/post": 429 });
  Deno.env.set("WAYBACK_URL", s.url);
  try {
    assert.equal(await archive("https://blog.example/post"), "busy");
  } finally {
    Deno.env.delete("WAYBACK_URL");
    await s.close();
  }
});
